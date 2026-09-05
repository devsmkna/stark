// Il lato daemon del tunnel: la WebSocket in uscita verso tunnel.starkapp.dev che
// rende STARK raggiungibile da fuori senza Tailscale e senza aprire porte.
//
// La forma è speculare a `cloud/src/tunnel.ts` (l'hub, che è anche dove sta scritto il
// protocollo): il server manda una `req`, qui la si rigioca contro il daemon locale su
// 127.0.0.1 e si rimanda indietro la risposta a pezzi, così una SSE arriva mentre
// nasce. Il daemon non sa di star parlando con sé stesso attraverso mezzo mondo — e
// non deve: passa tutto dalla porta vera, col guard e i suoi controlli interi.
//
// Chi può entrare da qui: chiunque conosca l'hostname del tunnel — che è pubblico —
// e la macchina. Cioè: il guard resta l'unica difesa, esattamente come su Tailscale,
// ma senza il recinto della tailnet attorno. È il motivo per cui questo si **accende
// per scelta** (`settings.tunnel`, spento di default): «apertura oltre localhost mai
// come default» è un requisito, non una preferenza.
//
// L'autenticazione verso il tunnel è il token di sessione del **cloud**: il tunnel è
// una feature per autenticati (card #7), e il token sta già su disco per la board.
// Viaggia nei sottoprotocolli WebSocket, non nell'URL: la WebSocket globale di Node
// non sa mandare intestazioni proprie, e un token in query finirebbe negli access log
// di chiunque stia in mezzo.

import { request as httpRequest } from 'node:http'
import { tokenCloud } from './cloud.ts'
import { machineId } from './usage-sync.ts'

/**
 * Dove vive il tunnel, cablato qui come `CLOUD_PREDEFINITO` e con la stessa
 * disciplina: è un fatto del prodotto, non della macchina, e `STARK_TUNNEL_URL` lo
 * sovrascrive per chi ha un deploy suo. Sempre la forma https: il `wss://` per la
 * WebSocket si deriva, così esiste una sola stringa da tenere giusta.
 */
const TUNNEL_PREDEFINITO = 'https://tunnel.starkapp.dev'

export function tunnelUrl(): string {
  const grezzo = process.env['STARK_TUNNEL_URL']?.trim()
  return (grezzo ? grezzo.replace(/\/+$/, '') : TUNNEL_PREDEFINITO)
}

/** L'hostname nudo, per il perimetro: il guard confronta `Host`, non URL. */
export function tunnelHost(): string {
  try { return new URL(tunnelUrl()).hostname } catch { return new URL(TUNNEL_PREDEFINITO).hostname }
}

export type StatoTunnel = {
  /** L'interruttore nelle impostazioni, come lo vede il client adesso. */
  attivo: boolean
  /** La WebSocket è su e ha fatto l'handshake. */
  connesso: boolean
  /** Dove risponde il tunnel (per la UI e per costruire link). */
  url: string
  /** La base del link di accoppiamento, con la macchina già dentro: la UI ci
   *  appende `&c=<codice>`. */
  pairUrl: string
  /** L'ultimo motivo per cui la connessione è caduta o non parte, se c'è. */
  errore?: string
}

export type TunnelClient = {
  stato(): StatoTunnel
  /** Riguarda subito le impostazioni invece di aspettare il prossimo giro. */
  tick(): void
  ferma(): void
}

type Frame =
  | { t: 'req'; id: number; method: string; path: string; headers: Record<string, string | string[]>; body?: string }

/**
 * Il client, con la stessa disciplina di `creaUsageSync`: `accesa()` si rilegge a
 * ogni giro, perché l'interruttore si può girare mentre il daemon è acceso e chi lo
 * spegne si aspetta che si spenga — non alla prossima riaccensione.
 */
export function creaTunnel(opts: {
  home: string
  porta: () => number
  accesa: () => boolean
  /** Iniettabili per la prova automatica (`tools/tunnel-cloud-check.ts`). */
  wsUrl?: string
  token?: () => string | null
}): TunnelClient {
  const wsBase = opts.wsUrl ?? `${tunnelUrl().replace(/^http/, 'ws')}/connect`
  const leggiToken = opts.token ?? (() => tokenCloud(opts.home))
  const macchina = machineId(opts.home)

  let ws: WebSocket | null = null
  let connesso = false
  let fermo = false
  let errore: string | undefined
  /** Backoff: si parte gentili e si arriva a un minuto. Un tunnel che non c'è non
   *  deve trasformare il daemon in un martello. */
  let attesa = 1_000
  let prossimo: ReturnType<typeof setTimeout> | null = null

  function pianifica(fra: number): void {
    if (prossimo) clearTimeout(prossimo)
    prossimo = setTimeout(giro, fra)
    prossimo.unref?.()
  }

  function giro(): void {
    if (fermo) return
    if (!opts.accesa()) {
      if (ws) { ws.close(); ws = null }
      errore = undefined
      pianifica(5_000)
      return
    }
    if (ws) { pianifica(5_000); return }
    const token = leggiToken()
    if (!token) {
      errore = 'serve il login al cloud'
      pianifica(15_000)
      return
    }
    apri(token)
  }

  function apri(token: string): void {
    errore = undefined
    let sock: WebSocket
    try {
      sock = new WebSocket(wsBase, ['stark-tunnel', `tok.${token}`, `mac.${macchina}`])
    } catch (e) {
      errore = String((e as Error).message ?? e)
      pianifica(attesa = Math.min(attesa * 2, 60_000))
      return
    }
    ws = sock
    sock.addEventListener('open', () => { connesso = true; attesa = 1_000 })
    sock.addEventListener('message', ev => { void suFrame(String(ev.data), sock) })
    sock.addEventListener('error', () => { errore = 'connessione al tunnel fallita' })
    sock.addEventListener('close', ev => {
      connesso = false
      if (ws === sock) ws = null
      // Un 401 all'handshake arriva come chiusura: se il token non vale più non è
      // un guasto di rete, e martellare non lo farà valere. Si ritenta piano.
      if (ev.code === 1006 && errore === undefined) errore = 'connessione caduta'
      if (!fermo) pianifica(attesa = Math.min(attesa * 2, 60_000))
    })
  }

  async function suFrame(testo: string, sock: WebSocket): Promise<void> {
    let f: Frame
    try { f = JSON.parse(testo) as Frame } catch { return }
    if (f.t !== 'req') return
    const manda = (obj: unknown): void => {
      if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(obj))
    }
    // La richiesta si rigioca sul daemon vero, da loopback: per il guard è una
    // richiesta locale col suo `Host` di tunnel — che sta nel perimetro — e le sue
    // credenziali. Qui non si decide niente.
    const r = httpRequest({
      host: '127.0.0.1', port: opts.porta(), method: f.method, path: f.path,
      headers: f.headers, setHost: false,
    }, res => {
      const headers: Record<string, string | string[]> = {}
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) headers[k] = v
      }
      manda({ t: 'res', id: f.id, status: res.statusCode ?? 502, headers })
      res.on('data', (d: Buffer) => manda({ t: 'chunk', id: f.id, b64: d.toString('base64') }))
      res.on('end', () => manda({ t: 'end', id: f.id }))
    })
    r.on('error', e => manda({ t: 'fail', id: f.id, error: String(e.message ?? e) }))
    if (f.body) r.write(Buffer.from(f.body, 'base64'))
    r.end()
  }

  giro()

  return {
    stato: () => ({
      attivo: opts.accesa(),
      connesso,
      url: tunnelUrl(),
      pairUrl: `${tunnelUrl()}/pair?m=${macchina}`,
      ...(errore ? { errore } : {}),
    }),
    tick: () => { attesa = 1_000; giro() },
    ferma: () => {
      fermo = true
      if (prossimo) clearTimeout(prossimo)
      if (ws) { ws.close(); ws = null }
      connesso = false
    },
  }
}
