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
