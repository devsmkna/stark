// Il tunnel di STARK: la strada per raggiungere il daemon di casa quando non c'è
// Tailscale, e — per scelta di prodotto, 5 settembre 2026 — quella di default.
//
// La forma è un proxy HTTP rovesciato sopra una WebSocket. Il daemon apre **lui** la
// connessione, in uscita, verso `wss://tunnel.starkapp.dev/connect`: niente porte
// aperte a casa, niente NAT da attraversare, e l'autenticazione è quella che il
// daemon ha già — il token di sessione del cloud (card #7: è una feature per
// autenticati). Un telefono che apre `https://tunnel.starkapp.dev/...` parla con
// questo modulo, che gira la richiesta sulla WebSocket giusta e rimanda indietro la
// risposta com'è arrivata, pezzo per pezzo.
//
// Cosa questo modulo NON fa, di proposito:
//   - non autentica il telefono: quello è mestiere del daemon (token per dispositivo,
//     codice di accoppiamento), e farlo anche qui vorrebbe dire due verità. Il tunnel
//     decide solo *verso quale macchina* girare la richiesta, mai *se* la richiesta
//     ha titolo — il 403 lo dice il daemon, che è l'unico a sapere.
//   - non tocca i corpi: quello che entra esce identico. L'unica intestazione che
//     aggiunge è il Set-Cookie dell'instradamento (vedi sotto).
//
// L'instradamento: la prima visita porta `?m=<machine>` nel QR di accoppiamento, e la
// risposta pianta un cookie `stark-m`. Da lì in poi il cookie basta, e i percorsi
// restano quelli veri (`/`, `/chat/<id>`): la UI del daemon non sa di essere dietro
// un tunnel, e non deve. Due macchine nello stesso browser si contendono il cookie —
// limite noto, scritto in docs/tunnel.md, si risolve ri-scansionando.
//
// Onestà sul perimetro: qui il TLS termina, quindi questo processo vede il traffico
// in chiaro. È la stessa TCB del cloud (il VPS è già dentro), ed è il motivo per cui
// il tunnel sta su un server nostro e non su un tunnel di terzi — la premessa
// dell'ADR sull'accesso da fuori casa non cambia, cambia solo chi fa la fatica.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'

/** Da token cloud a identità, o `null`. Iniettabile: la prova automatica non ha un
 *  Postgres, e il tunnel non deve pretenderne uno per essere provato. */
export type TunnelAuth = (token: string) => Promise<string | null>

/** Cosa il server manda al daemon. Il corpo viaggia intero nella `req`: i corpi veri
 *  di STARK sono JSON piccoli e allegati nell'ordine dei MB, e bufferizzarli è più
 *  semplice di un framing a pezzi in salita. In discesa invece si framma (`chunk`),
 *  perché una risposta SSE non finisce mai e va consegnata mentre nasce. */
type VersoDaemon =
  | { t: 'req'; id: number; method: string; path: string; headers: Record<string, string | string[]>; body?: string }
type DalDaemon =
  | { t: 'res'; id: number; status: number; headers: Record<string, string | string[]> }
  | { t: 'chunk'; id: number; b64: string }
  | { t: 'end'; id: number }
  | { t: 'fail'; id: number; error: string }

/** Le intestazioni hop-by-hop non attraversano un proxy (RFC 9110 §7.6.1): valgono
 *  per una connessione, e qui di connessioni ce ne sono due. */
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'])

const COOKIE_MACCHINA = 'stark-m'
/** Un corpo in salita oltre questo si rifiuta: più grande del più grande allegato
 *  ragionevole, più piccolo di quel che farebbe male bufferizzare. */
const MAX_CORPO = 32 * 1024 * 1024

type Collegata = { ws: WebSocket; email: string; viva: boolean }

export class TunnelHub {
  #auth: TunnelAuth
  #macchine = new Map<string, Collegata>()
  #pendenti = new Map<WebSocket, Map<number, ServerResponse>>()
  #prossimoId = 1
  #battito: ReturnType<typeof setInterval> | null = null
  #wss = new WebSocketServer({ noServer: true, handleProtocols: (ps) => ps.has('stark-tunnel') ? 'stark-tunnel' : false })

  constructor(auth: TunnelAuth) {
    this.#auth = auth
    // Un daemon che sparisce senza chiudere (rete mobile, sospensione) lascerebbe la
    // voce nella mappa e le richieste ad aspettare: il battito lo scopre e lo chiude.
    this.#battito = setInterval(() => {
      for (const [id, c] of this.#macchine) {
        if (!c.viva) { c.ws.terminate(); this.#macchine.delete(id); continue }
        c.viva = false
        c.ws.ping()
      }
    }, 30_000)
    this.#battito.unref?.()
  }

  /** Quante macchine sono collegate adesso. Per la diagnostica, non per decidere. */
  get collegate(): number { return this.#macchine.size }

  chiudi(): void {
    if (this.#battito) clearInterval(this.#battito)
    for (const c of this.#macchine.values()) c.ws.terminate()
    this.#macchine.clear()
  }

  /**
   * L'upgrade del daemon su `/connect`.
   *
   * Credenziali nei **sottoprotocolli** (`tok.<token>`, `mac.<machine>`), non
   * nell'URL: il client è la WebSocket globale di Node, che come quella del browser
   * non sa mandare intestazioni proprie — e un token in query string finirebbe in
   * qualunque access log qualcuno accenda in mezzo.
   */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const protocolli = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim())
    const token = protocolli.find(p => p.startsWith('tok.'))?.slice(4) ?? ''
    const macchina = protocolli.find(p => p.startsWith('mac.'))?.slice(4) ?? ''
    const email = token ? await this.#auth(token) : null
    if (!email || !macchina) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    this.#wss.handleUpgrade(req, socket, head, ws => {
      // Ultimo che arriva vince: un daemon riavviato si ripresenta prima che il
      // battito scopra il cadavere della connessione vecchia, e deve poter entrare.
      const vecchia = this.#macchine.get(macchina)
      if (vecchia) vecchia.ws.terminate()
      const c: Collegata = { ws, email, viva: true }
      this.#macchine.set(macchina, c)
      this.#pendenti.set(ws, new Map())
      ws.on('pong', () => { c.viva = true })
      ws.on('message', (dati) => this.#dalDaemon(ws, dati.toString()))
      ws.on('close', () => {
        if (this.#macchine.get(macchina)?.ws === ws) this.#macchine.delete(macchina)
        // Le richieste rimaste appese muoiono col daemon: meglio un errore subito
        // che un telefono che aspetta un timeout.
        for (const res of this.#pendenti.get(ws)?.values() ?? []) {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'macchina scollegata' }))
        }
        this.#pendenti.delete(ws)
      })
      ws.on('error', () => { /* il close qui sopra fa già tutto */ })
    })
  }

  /**
   * Una richiesta HTTP arrivata sull'hostname del tunnel. Torna `false` se non è
   * roba nostra (nessuna macchina indicata): il chiamante risponde come crede.
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x')
    const dalQuery = url.searchParams.get('m')
    const macchina = dalQuery ?? leggiCookie(req, COOKIE_MACCHINA)
    if (!macchina) return false

    const c = this.#macchine.get(macchina)
    if (!c) {
      // La macchina non è collegata: pagina umana, non JSON nudo — chi arriva qui è
      // un telefono, e il caso tipico è il computer spento o il tunnel spento.
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(paginaScollegata())
      return true
    }

    // `m` esce dal percorso che il daemon vede: è un fatto dell'instradamento, non
    // della richiesta. Il cookie lo tiene per le visite dopo.
    url.searchParams.delete('m')
    const path = url.pathname + (url.search || '')

    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP.has(k)) continue
      headers[k] = v
    }

    const pezzi: Buffer[] = []
    let totale = 0
    req.on('data', (d: Buffer) => {
      totale += d.length
      if (totale > MAX_CORPO) { req.destroy(); res.destroy(); return }
      pezzi.push(d)
    })
    req.on('end', () => {
      const id = this.#prossimoId++
      this.#pendenti.get(c.ws)?.set(id, res)
      // Il Set-Cookie dell'instradamento si decide qui ma si scrive quando arriva la
      // `res` del daemon (vedi #dalDaemon): serve la sua writeHead per non separare
      // status e intestazioni.
      if (dalQuery) daPiantare.set(res, dalQuery)
      const corpo = Buffer.concat(pezzi)
      const frame: VersoDaemon = {
        t: 'req', id, method: req.method ?? 'GET', path, headers,
        ...(corpo.length > 0 ? { body: corpo.toString('base64') } : {}),
      }
      c.ws.send(JSON.stringify(frame))
      res.on('close', () => { this.#pendenti.get(c.ws)?.delete(id) })
    })
    return true
  }

  #dalDaemon(ws: WebSocket, testo: string): void {
    let f: DalDaemon
    try { f = JSON.parse(testo) as DalDaemon } catch { return }
    const mappa = this.#pendenti.get(ws)
    const res = mappa?.get(f.id)
    if (!res) return
    switch (f.t) {
      case 'res': {
        const headers = { ...f.headers }
        const cookie = daPiantare.get(res)
        if (cookie) {
          daPiantare.delete(res)
          const esistenti = headers['set-cookie']
          const nostro = `${COOKIE_MACCHINA}=${cookie}; Path=/; Secure; SameSite=Lax; Max-Age=31536000`
          headers['set-cookie'] = [...(Array.isArray(esistenti) ? esistenti : esistenti ? [esistenti] : []), nostro]
        }
        res.writeHead(f.status, headers)
        // `flushHeaders` non serve: writeHead + il primo chunk partono da soli, e per
        // una SSE il daemon manda subito il primo evento.
        break
      }
      case 'chunk':
        res.write(Buffer.from(f.b64, 'base64'))
        break
      case 'end':
        res.end()
        mappa?.delete(f.id)
        break
      case 'fail':
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: f.error }))
        mappa?.delete(f.id)
        break
    }
  }
}

/** Il cookie da piantare sulla risposta, deciso alla richiesta e scritto alla
 *  `res` del daemon. WeakMap: se la risposta muore prima, sparisce da sola. */
const daPiantare = new WeakMap<ServerResponse, string>()

function leggiCookie(req: IncomingMessage, nome: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const parte of raw.split(';')) {
    const [k, ...resto] = parte.trim().split('=')
    if (k === nome) return resto.join('=') || null
  }
  return null
}

/** Stessa lingua e stessa forma della pagina 403 del daemon (`server.ts`): chi
 *  incontra STARK da un telefono deve vedere lo stesso prodotto ovunque bussi. */
function paginaScollegata(): string {
  return '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>STARK</title><style>body{margin:0;min-height:100dvh;display:flex;'
    + 'align-items:center;justify-content:center;font:15px/1.6 system-ui,sans-serif;'
    + 'background:#FBFBFD;color:#171A22;padding:24px;text-align:center}'
    + '@media(prefers-color-scheme:dark){body{background:#0E1118;color:#E8EAF0}}'
    + 'p{max-width:300px;color:#767D90}b{letter-spacing:.14em}</style>'
    + '<div><p><b>S T A R K</b><br><br>This machine is not connected right now.<br>'
    + 'Turn it on (or enable the tunnel in STARK), then try again.</p></div>'
}
