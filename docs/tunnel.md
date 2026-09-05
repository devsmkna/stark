# Il tunnel — accesso da fuori senza Tailscale

Deciso e scritto il 5 settembre 2026. **Questa è la strada di default** per
raggiungere STARK dal telefono; Tailscale resta la seconda, intera com'era
(`docs/fuori-casa.md` racconta la terza, quella a mano con `ssh -R`, che questo
lavoro manda in pensione per l'uso quotidiano).

> ADR da registrare su Notion: la decisione «tunnel proprio su VPS proprio, default
> davanti a Tailscale» qui c'è solo come fatto del codice. La premessa dell'ADR
> sull'accesso da fuori (il VPS entra nella TCB, Cloudflare no perché terminerebbe
> il TLS) non cambia: cambia chi fa la fatica.

## La forma

Un proxy HTTP rovesciato sopra una WebSocket, in due metà speculari:

- **`cloud/src/tunnel.ts`** — l'hub, dentro lo stesso processo del cloud (stesso
  Postgres, stessa `chi()` per i token: due processi sarebbero due verità).
  Traefik gli instrada `tunnel.starkapp.dev`; è l'`Host` a decidere, non il percorso.
- **`src/daemon/tunnel.ts`** — il client. Il daemon apre **lui** la connessione, in
  uscita, verso `wss://tunnel.starkapp.dev/connect`: niente porte aperte a casa,
  niente NAT. Si autentica col token di sessione del **cloud** (è una feature per
  autenticati, card #7) più il `machine-id` di usage-sync — nei **sottoprotocolli**
  WebSocket, non nell'URL, perché la WebSocket globale di Node non manda
  intestazioni proprie e un token in query finirebbe negli access log.

Il protocollo sta scritto nei tipi di `cloud/src/tunnel.ts` (`VersoDaemon` /
`DalDaemon`): una `req` col corpo intero in salita, `res`/`chunk`/`end`/`fail` a
pezzi in discesa — a pezzi perché una SSE non finisce mai e va consegnata mentre
nasce. La prova che lo verifica misura **quando** arrivano i pezzi, non quanti:
`node tools/tunnel-cloud-check.ts`.

## L'instradamento

Il QR di accoppiamento porta `https://tunnel.starkapp.dev/pair?m=<slug>&c=<codice>`.
La `m` dice all'hub verso quale daemon girare la richiesta, la risposta pianta un
cookie `stark-m`, e da lì in poi i percorsi sono quelli veri (`/`, `/chat/<id>`): la
UI non sa di stare dietro un tunnel, e non deve. La `m` viene tolta dal percorso che
il daemon vede — è un fatto dell'instradamento, non della richiesta.

**Lo slug non è il machine-id** (hardening del 5 settembre, card #25): è
`sha256(userId:machineKey)` troncato a 16 esadecimali, derivato **dall'hub** e
comunicato al daemon nel frame `benvenuto`. La differenza è la difesa dal
dirottamento: con la chiave dichiarata dal daemon, chiunque avesse un account e
conoscesse il machine-id di un altro poteva presentarsi con quella chiave e rubarsi
l'instradamento (Bearer dei telefoni compreso). Con la chiave derivata
dall'identità, lo stesso machine-id sotto un altro account produce un'ALTRA chiave:
per catturare il traffico di qualcuno serve il suo token cloud. Bonus: il QR ora
espone lo slug, non il machine-id — e due account sulla stessa macchina (che sono
legittimi) convivono con due slug.

Limite noto: **due macchine nello stesso browser si contendono il cookie**. Si
risolve ri-scansionando il QR dell'altra macchina, o rifacendo il giro di login
qui sotto; un selettore persistente è lavoro futuro.

## La strada senza QR (5 settembre 2026)

Da un desktop senza camera il QR non si scansiona, e `tunnel.starkapp.dev` nudo
dava un 404. Ora la radice senza cookie è una **pagina di login** dell'hub: si
entra con l'account cloud, l'hub guarda quali macchine collegate sono tue (lo sa
già: lo slug è derivato da `userId`), e — una sola → dritti su `/pair`; più
d'una → lista coi nomi (il daemon manda l'hostname nell'handshake, `lab.` in
base64url); zero → si spiega cosa accendere. Poi si batte il **codice di
accoppiamento**, come dal QR: la pagina del codice resta del daemon, e l'hub
continua a non sapere niente di codici e token.

Dettagli che contano: il login è **usa-e-getta** (la sessione creata per
verificare si revoca subito: al browser va solo il cookie d'instradamento, mai un
token cloud); le credenziali sbagliate rispondono con un **redirect**, mai col
render del POST (un refresh non deve riproporre la password); freno dedicato da
**10 tentativi/min per IP**. La password da sola non apre niente: scopre la
porta, e la porta chiede comunque il codice.

## MFA (TOTP) e device fidati (5 settembre 2026)

Opzionale, spento di default, opt-in sull'account. Tre strati distinti:

- **Account** (chi): password + TOTP (RFC 6238, `cloud/src/totp.ts`, `node:crypto`;
  provato sui vettori dell'appendice B in `tools/totp-check.ts`). Enrolment in due
  passi — genera il segreto, mostra il QR, e accende **solo** dopo che l'utente prova
  di leggerlo — così un segreto scritto ma non verificato non chiude fuori nessuno.
  All'accensione: dieci **codici di recupero** monouso, mostrati una volta sola,
  salvati hashati (scrypt).
- **Device** (quale browser/iPhone): un device nuovo, dopo login+MFA, si autorizza
  col **codice di pairing** — che è la prova di accesso alla macchina o a un device
  già fidato. Una volta autorizzato ha il token del device e non chiede più niente.
  I codici di recupero valgono anche qui: la via d'uscita quando sei remoto senza
  niente di fidato in mano.
- **Macchina** (il guard): invariato — a rilasciare il token del device resta il
  daemon. L'hub verifica identità + MFA e instrada; non conia mai token del daemon.

Al login del tunnel: se l'account ha il TOTP, la pagina chiede il codice (o un codice
di recupero) dopo la password, con `mfa=1` nell'URL — mai `m`, che è il parametro
della macchina. Un codice mancante non dice se la password era giusta. Il freno
dedicato sul login (10/min per IP) copre il brute-force del secondo fattore.

Gestione da **Settings → Cloud → Two-factor**: accendere (QR + verifica), i codici di
recupero, spegnere (chiede la password — un device rubato con la sessione aperta non
deve poter togliere la seconda difesa). Tutto passa dal daemon: il browser non parla
mai col cloud.

**Follow-up dichiarato**: l'approvazione «con un tap da un altro device fidato» senza
scrivere il codice. Il canale del codice copre già «dalla macchina o da un device
fidato»; il tap è comodità in più (frame di controllo hub→daemon, coda di richieste,
una superficie nell'app principale), da fare quando serve.

## La sicurezza, detta intera

- Il daemon **non cambia di un byte** le sue difese: la richiesta rigiocata da
  loopback passa dal guard con l'`Host` del tunnel (che sta nel perimetro come
  costante di prodotto, fonte `tunnel` — stessa disciplina di `CLOUD_PREDEFINITO`,
  override `STARK_TUNNEL_URL`) e con le credenziali che porta. Il 403 lo dice il
  daemon; l'hub instrada e basta.
- Ammettere l'hostname nel perimetro **sempre** (interruttore spento compreso) non
  apre niente: quel nome risolve sul VPS, non su questa macchina, quindi non è
  utilizzabile per un rebinding verso il loopback.
- **Cosa cambia davvero rispetto a Tailscale**: sparisce il recinto della rete
  privata. Acceso il tunnel, chiunque conosca l'hostname pubblico può bussare al
  guard — lo fermano il token per dispositivo (32 byte, confronto costante) e il
  codice di accoppiamento (8 caratteri senza ambigui, 5 minuti, un uso, 3
  tentativi). È il motivo per cui `settings.tunnel` è **spento di default**:
  «apertura oltre localhost sempre come scelta esplicita, mai come default» è un
  requisito, e il default di prodotto («il tunnel è la strada di default») parla
  della *preferenza fra le strade*, non dell'accensione.
- L'hub termina il TLS: il VPS vede il traffico in chiaro. Era già nella TCB per
  il cloud; il tunnel non ce lo mette, ce lo conferma.
- Il token cloud del daemon viaggia nei sottoprotocolli dentro il TLS, mai in URL.

## I freni sull'hub (card #25)

- **Rate limit per IP**, finestra fissa da un minuto: 300 richieste generali, 20
  su `/pair` e `/api/phone/claim` (la superficie senza credenziale), 30 handshake
  `/connect`. L'IP è l'X-Forwarded-For scritto da Traefik, affidabile da quando la
  porta 8787 non è più pubblicata: al processo arriva solo Traefik.
- **Tetti di memoria**: corpi in salita oltre 32 MB rifiutati, 64 MB totali di
  buffer in volo, 128 richieste pendenti per macchina. Oltre: 503 con retry-after.
- **Registrazione dietro invito** (`CLOUD_INVITE` sull'ambiente del server; senza
  la variabile è chiusa): «autenticato» non è più una soglia che chiunque supera da
  solo. La UI di registrazione (card #17) dovrà chiedere il codice.
- **Sessioni cloud a scadenza**: 90 giorni dalla nascita, poi il daemon rifà il
  login. La revoca resta la difesa pronta; la scadenza è la rete sotto. Cambio
  password: `POST /api/password {current,new}` — revoca le altre sessioni.

## Cosa resta fuori (scelto, non dimenticato)

- **Backpressure sulla WebSocket**: una risposta enorme verso un telefono lento si
  accumula nel buffer dell'hub. I payload di STARK sono piccoli; da rifare se
  cambiano.
- **Selettore multi-macchina** sul telefono (vedi sopra).

## Come si accende

Pannello «Use STARK from your phone» → «Enable the tunnel» (serve il login al
cloud), oppure `settings.tunnel: true`, oppure `POST /api/tunnel {"on":true}`.
Lo stato: `GET /api/tunnel`. Spegnere spegne davvero: l'interruttore si rilegge a
ogni giro, come `usageSync`.
