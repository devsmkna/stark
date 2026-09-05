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

Il QR di accoppiamento porta `https://tunnel.starkapp.dev/pair?m=<macchina>&c=<codice>`.
La `m` dice all'hub verso quale daemon girare la richiesta, la risposta pianta un
cookie `stark-m`, e da lì in poi i percorsi sono quelli veri (`/`, `/chat/<id>`): la
UI non sa di stare dietro un tunnel, e non deve. La `m` viene tolta dal percorso che
il daemon vede — è un fatto dell'instradamento, non della richiesta.

Limite noto: **due macchine nello stesso browser si contendono il cookie**. Si
risolve ri-scansionando il QR dell'altra macchina; un selettore è lavoro futuro, e
va disegnato prima che scritto.

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

## Cosa resta fuori (v1, scelto non dimenticato)

- **Rate limiting sull'hub**: oggi il freno è la difesa del daemon, non un contatore
  sul VPS. Da aggiungere se il nome diventa noto.
- **Backpressure sulla WebSocket**: una risposta enorme verso un telefono lento si
  accumula nel buffer dell'hub. I payload di STARK sono piccoli; da rifare se
  cambiano.
- **Selettore multi-macchina** sul telefono (vedi sopra).
- Corpi in salita oltre **32 MB** rifiutati (più grandi del più grande allegato
  ragionevole).

## Come si accende

Pannello «Use STARK from your phone» → «Enable the tunnel» (serve il login al
cloud), oppure `settings.tunnel: true`, oppure `POST /api/tunnel {"on":true}`.
Lo stato: `GET /api/tunnel`. Spegnere spegne davvero: l'interruttore si rilegge a
ogni giro, come `usageSync`.
