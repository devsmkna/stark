# Raggiungere STARK da fuori casa

STARK ascolta **solo** su `127.0.0.1`, e resta così: non c'è nessuna variabile per
cambiare l'indirizzo di ascolto, e non serve. Per arrivarci da fuori si mette davanti un
proxy che termina il TLS e si ricollega al loopback — è quello che fa `tailscale serve`,
ed è quello che fanno un tunnel `ssh -R`, `cloudflared` e `frp`.

Quello che cambia è **chi dice il nome pubblico**. Tailscale lo sa da sé
(`tailscale status --json`); gli altri no, e va scritto:

```sh
STARK_PUBLIC_HOST=stark.tuodominio.it
```

Le fonti si **sommano**: chi ha Tailscale e un dominio proprio li ha entrambi. Senza
niente, il perimetro resta solo-localhost — che è il default e il comportamento di
sempre.

> **Il perimetro si legge una volta sola, all'avvio.** Dichiarare un nome a daemon
> acceso non ha effetto: il telefono si becca un `403` che sembra un problema di token.
> Dopo averlo impostato, `stark stop && stark up`.

`stark status` dice cosa ha letto **il processo in esecuzione**, non l'ambiente della
tua shell — che è la domanda giusta quando qualcosa non torna. Lo stesso lo mostrano le
impostazioni di STARK, in System → «Reachable as».

---

## Perché non un tunnel Cloudflare

Funziona, è gratis (Tunnel è incluso, e Zero Trust è gratuito fino a 50 utenti), e ci
sono due ragioni per non usarlo:

- **Cloudflare termina il TLS**, quindi vede in chiaro prompt, risposte, diff e comandi.
  E siccome vede, può anche **scrivere**: un `POST /api/sessions/:id/command` verso un
  processo che gira come root. Mettere una terza parte in quella posizione non è neutro.
- **Il buffering SSE non è chiuso.** `cloudflared` dovrebbe passare le risposte con
  `Content-Type: text/event-stream` senza trattenerle — e STARK quell'header lo manda —
  ma [l'issue #1449](https://github.com/cloudflare/cloudflared/issues/1449) descrive
  esattamente il nostro caso (SSE su GET consegnato tutto insieme alla chiusura).
  Se lo si sceglie comunque, `npm run tunnel` è lì per misurarlo invece di sperarci.

---

## La strada consigliata: un VPS proprio + Traefik

Il TLS lo termina una macchina tua. Il costo onesto: **il VPS entra nella TCB** — se lo
compromettono vedono tutto e possono parlare col daemon. È un rischio che controlli,
invece di delegarlo.

### 1. Il tunnel, dalla macchina di STARK al VPS

```sh
ssh -N -R 127.0.0.1:4571:127.0.0.1:4571 stark@vps.tuodominio.it
```

> ⚠️ **Il prefisso `127.0.0.1:` non è decorativo.** Senza (o con `GatewayPorts yes` sul
> VPS) la 4571 finisce **pubblica** sull'IP del VPS in HTTP nudo, scavalcando Traefik, il
> TLS e l'mTLS, e lasciando il solo token a difendere un processo root. È l'errore più
> costoso di questa pagina.

Come servizio, così regge i riavvii e la caduta della linea:

```ini
# /etc/systemd/system/stark-tunnel.service   (sulla macchina di STARK)
[Unit]
Description=Tunnel di STARK verso il VPS
After=network-online.target

[Service]
ExecStart=/usr/bin/ssh -N -T \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:4571:127.0.0.1:4571 stark@vps.tuodominio.it
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`ExitOnForwardFailure=yes` serve a non restare con un tunnel «su» che non inoltra niente
(succede quando la porta sul VPS è ancora occupata dalla connessione precedente);
`ServerAlive*` è ciò che fa accorgere del cambio di rete invece di restare appesi.

### 2. DNS

Un record `A` per `stark.tuodominio.it` che punta al VPS, **in «DNS only»** — nuvola
**grigia**, non arancione.

> ⚠️ Lasciandolo proxied, Cloudflare torna in mezzo: hai pagato il VPS per niente e ti
> sei ripreso il rischio di buffering che volevi evitare. È l'errore più facile da fare,
> perché il DNS di solito è già lì.

### 3. Traefik sul VPS

Traefik non bufferizza le risposte streaming: `responseForwarding.flushInterval` vale
100 ms di default, ma la documentazione dice che *«is ignored when ReverseProxy
recognizes a response as a streaming response; for such responses, writes are flushed to
the client immediately»*. Non c'è niente da configurare — c'è però una cosa da **non**
fare: aggiungere il middleware `buffering`, che rimetterebbe il problema.

Il tunnel termina sul **loopback dell'host**. Se Traefik gira in Docker, `127.0.0.1` è il
loopback del *container*, non dell'host:

```yaml
# docker-compose.yml del VPS, servizio traefik
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Non legare invece l'`ssh -R` all'IP del bridge (`172.17.0.1`): esporrebbe la 4571 a
**ogni** container del VPS.

Configurazione dinamica (file provider):

```yaml
# /etc/traefik/dynamic/stark.yml
http:
  routers:
    stark:
      rule: "Host(`stark.tuodominio.it`)"
      entryPoints: [websecure]
      service: stark
      tls:
        certResolver: letsencrypt
        options: stark-mtls
  services:
    stark:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:4571"

tls:
  options:
    stark-mtls:
      clientAuth:
        caFiles:
          - /etc/traefik/certs/stark-ca.crt
        clientAuthType: RequireAndVerifyClientCert
```

> ⚠️ Una `TLSOption` che Traefik non riesce a risolvere fa rispondere **404** al router,
> non un errore di certificato: il sintomo non somiglia alla causa. Se vedi 404 su un
> host che esiste, guarda lì per primo.

### 4. mTLS: perché, e non solo come

Il token di STARK è 32 byte confrontati a tempo costante: non si forza. Il problema è
un altro — su Internet pubblica diventa raggiungibile tutto ciò che sta **prima** del
controllo del token: il parser HTTP di Node, la lettura del corpo col tetto a 32 MB, il
server dei file statici. Piccolo, non zero, e qualunque difetto lì sarebbe esecuzione di
codice come root da Internet.

Il criterio è: *nessuna richiesta non autenticata deve arrivare al processo che gira come
root*. Con mTLS, chi non ha il certificato non completa nemmeno l'handshake.

```sh
# la CA (una volta sola, tienila offline)
openssl genrsa -out stark-ca.key 4096
openssl req -x509 -new -key stark-ca.key -days 3650 -out stark-ca.crt -subj "/CN=STARK CA"

# un certificato per dispositivo — uno per telefono, uno per portatile
openssl genrsa -out iphone.key 2048
openssl req -new -key iphone.key -out iphone.csr -subj "/CN=iphone"
openssl x509 -req -in iphone.csr -CA stark-ca.crt -CAkey stark-ca.key -CAcreateserial \
  -days 825 -out iphone.crt
# iOS vuole un PKCS#12 (e Safari non importa .p12 senza password)
openssl pkcs12 -export -inkey iphone.key -in iphone.crt -certfile stark-ca.crt -out iphone.p12
```

Su iPhone: si manda il `.p12` a sé stessi, si installa il profilo (Impostazioni → Profilo
scaricato), **e poi** si va in Impostazioni → Generali → Info → Certificati attendibili
per fidarsi della CA. La prima volta Safari chiede quale certificato usare; dopo, no.

**Uno per dispositivo, non uno condiviso**: è l'unica cosa in tutta questa catena che si
possa revocare senza toccare le altre. Il token di STARK resta obbligatorio anche dietro
mTLS: due controlli indipendenti, nessuno dei due delegato all'altro.

### 5. Le notifiche

Senza Tailscale il `sub` della VAPID lo prende dal perimetro, quindi con
`STARK_PUBLIC_HOST` impostata non c'è altro da fare. Se il nome pubblico non c'è, va
dichiarato a mano — Apple **valida** quel campo e rifiuta il push con
`403 BadJwtToken` se è finto:

```sh
STARK_VAPID_SUBJECT=mailto:tuo@indirizzo
```

Entrambe le variabili vanno messe dove il daemon le vede davvero. `stark start`/`stark up`
le passano a systemd (`--setenv`) perché un servizio transiente parte con un ambiente
pulito: sono nell'elenco di `ambiente()` in `src/cli/stark.ts`, e vanno tenute lì.

---

## Verificare, invece di sperare

```sh
npm run tunnel -- https://stark.tuodominio.it
```

Non costa quota: non manda nessun prompt. Apre il flusso dell'elenco e guarda **quando**
arrivano i pezzi, non quanti — perché un proxy che bufferizza li consegna tutti, solo
tutti insieme alla fine, e contarli non distingue un flusso vivo da uno morto. Controlla
tre cose: che il primo pezzo arrivi subito, che i battiti (uno ogni 15 s) arrivino mentre
la finestra è aperta, e che la connessione regga i 40 secondi senza cadere — che è il
difetto dei proxy con un idle timeout corto.

Le prove su `Host`/`Origin` falsificato **non** si fanno da qui e la prova lo dice: le
riscrive il proxy, non arrivano mai al perimetro. Quelle stanno in `npm run daemon`, che
gira sul loopback dove il perimetro è l'unica cosa in mezzo.

## Collegare un telefono (28 agosto 2026)

Il giro qui sopra resta vero e resta il fondamento; quello che cambia è **come ci si
arriva**. Non più un indirizzo con dentro il token da riscrivere a mano, ma il bottone
col telefono in cima all'elenco.

### Cosa vedi

Il pannello non spiega cosa fare: **mostra cosa manca**, e ogni riga è misurata sulla
macchina (`src/daemon/tailscale.ts`), non raccontata.

| passo | come si misura | lo fa STARK |
|---|---|---|
| Tailscale su questa macchina | `tailscale status --json` risponde | no |
| macchina collegata all'account | `BackendState: Running` | **sì** — `tailscale up` |
| certificati HTTPS abilitati | `CertDomains` non vuoto | no: è una spunta nella console web del tuo account |
| STARK pubblicato sulla tailnet | `serve status --json` ha un handler verso la porta di **questo** daemon | **sì** — `tailscale serve --bg` |
| Tailscale sul telefono | un peer con `OS` iOS/Android e `Online: true` | no |

Le spunte si accendono **da sole**, ogni due secondi, finché non è tutto verde: due dei
cinque passi li fai altrove — la console di Tailscale, l'app sul telefono — e devi
vederli arrivare qui senza chiudere e riaprire. Quando è tutto verde il pannello smette
di rileggere e mostra una cosa sola: il codice.

L'ultimo passo dice anche **come si chiama** il telefono che ha trovato (`iphone-11`):
riconoscerlo è ciò che distingue «l'app è installata» da «l'app è installata su un altro
telefono».

### Il codice

Otto caratteri, cinque minuti, **un uso solo**, tre tentativi. Alfabeto senza `0/O` e
`1/I/L`, che si sbagliano a leggere da uno schermo. Del codice sta su disco solo
l'impronta, e il confronto è a tempo costante. È lo stesso accoppiamento del bot Telegram
e non è una coincidenza: era già stato pensato una volta, e due meccanismi che divergono
sono due superfici da rivedere invece di una.

Dal telefono si apre il **link fisso** — `https://<macchina>.ts.net/` — e si scrive il
codice. Da lì in poi quel telefono è dentro, con la UI intera.

### Il pezzo delicato: una porta che si apre e si richiude

Per scrivere il codice il telefono deve caricare una pagina **senza avere ancora una
credenziale**, e fino a oggi qualunque richiesta senza token era 403. Quindi:

- si passa senza credenziale su **due sole rotte**, `/pair` e `POST /api/phone/claim`
  (`ROTTE_ACCOPPIAMENTO` in `security.ts` — l'elenco sta lì e non nelle rotte, perché una
  porta aperta va aperta in un posto solo);
- e **solo mentre un codice è vivo**. Fuori da quei cinque minuti il link fisso risponde
  403 esattamente come prima: la superficie non autenticata non è accesa in permanenza,
  esiste quando l'hai chiesta tu premendo il bottone;
- le altre tre difese **non** cadono: anche per accoppiare bisogna arrivare dal loopback,
  con un `Host` che è questa macchina e un `Origin` nostro.

La pagina è una stringa nel daemon (`pagina-pair.ts`), non un file di `ui/dist`. Non è
pigrizia: una pagina della UI vera tirerebbe dentro il suo JavaScript e il suo CSS, cioè
`/assets/*`, e per farla funzionare senza credenziale bisognerebbe aprire anche quelli.

### Quanto dura, e come si chiude

**Finché non lo scolleghi tu.** È la risposta alla domanda aperta §5 («che durata deve
avere la credenziale sul telefono»), presa il 28 agosto 2026: un telefono viene chiuso e
riaperto dal sistema di continuo, e una credenziale che scade ti chiude fuori proprio
quando il computer non ce l'hai davanti. A difendere è la **revoca**, non la scadenza —
l'elenco dei dispositivi collegati sta nello stesso pannello, con un bottone che li
stacca subito.

Da qui una trappola che è stata chiusa scrivendo il codice, e vale la pena saperla:
`serveUi` pianta un cookie a ogni caricamento della pagina, e finché la credenziale era
una sola poteva piantare quella. Con un telefono che ne ha una propria e revocabile,
piantare sempre quella globale vorrebbe dire **consegnargli la chiave maestra** al primo
caricamento, cioè annullare la revoca prima ancora di averla scritta. Ora si ripianta la
credenziale con cui si è entrati (`guard.credenziale()`), e per un telefono dura 400
giorni invece di 24 ore — perché la prima richiesta di un segnalibro è l'HTML nudo, senza
intestazioni né JavaScript: vive solo del cookie.
