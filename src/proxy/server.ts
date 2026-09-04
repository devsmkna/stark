// Il proxy dell'anonimizzazione, in modalità OMBRA (docs/anonimizzazione.md §12bis).
//
// Sta fra l'agent e il provider (`ANTHROPIC_BASE_URL` / `options.baseURL` → qui), e in
// questa prima incarnazione NON tocca un byte: inoltra identico e registra cosa il
// filtro AVREBBE trovato. L'ombra esiste per misurare il tasso di falsi positivi su
// sessioni vere prima che il blocco esista — la scommessa rimasta è umana, non tecnica:
// un filtro che ferma troppo viene spento, e una funzione spenta non protegge niente.
//
// Le scelte che questo file incarna, tutte registrate nel quaderno:
//   - processo separato dal daemon (D15): un aggiornamento di STARK non uccide i turni
//     in volo. Un solo percorso, trasparente quando spento (D16).
//   - l'identità viaggia nel prefisso di percorso `/s/<id>` (D18, misura A-bis), e una
//     sessione non registrata NON si inoltra (§4.3): il proxy non è un relay aperto.
//   - i quattro doveri del §4bis.1: `HEAD /api/hello` passa (o il CLI si crede
//     offline); le intestazioni `anthropic-ratelimit-*` passano intatte (si inoltrano
//     TUTTE le intestazioni, senza lista); `signature` non si tocca (in ombra non si
//     tocca niente); il gzip passa com'è (in ombra la risposta non si legge).
//   - il registro scrive OGNI richiesta intera (D39): JSONL append-only in
//     `~/.stark/ombra/<id>.jsonl`, accanto ai journal che contengono già tutto.
//   - il controllo (`/control/*`) vuole il token del daemon: registrare una sessione è
//     un potere, e su una web app locale «è su localhost» non è una difesa (security.ts).
//
// Cosa qui NON c'è ancora, di proposito: il mascheramento, il blocco (con la meccanica
// della pausa misurata in §4.7: trattenere fino a 240 s, dedup per hash del corpo), il
// dizionario. Arrivano DOPO i numeri dell'ombra, nello stesso ordine del quaderno.

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { analizza } from './ombra.ts'

/** La porta di casa del proxy. Fissa come quella del daemon (4571), e diversa. */
export const PORTA_PROXY = 4573

export type Sessione = { upstream: URL; dal: number }

export type Proxy = {
  porta: number
  /** Quante sessioni sono registrate ora — per `stark status` e per le prove. */
  sessioni(): string[]
  close(): void
}

export type OpzioniProxy = {
  porta?: number
  /** La casa di STARK. Parametro e non modulo-costante: la lezione di `daemon-check` —
   *  chi risolve l'ambiente alla valutazione del modulo lo risolve prima delle prove. */
  home?: string
}

const ID_VALIDO = /^[A-Za-z0-9_-]{4,64}$/
const ROTTA_TRAFFICO = /^\/s\/([A-Za-z0-9_-]+)(\/.*)$/

/** Confronto a tempo costante fra due stringhe di lunghezza qualunque. */
function stessoSegreto(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function avviaProxy(opts: OpzioniProxy = {}): Promise<Proxy> {
  const home = opts.home ?? process.env['STARK_HOME'] ?? resolve(homedir(), '.stark')
  const cartellaOmbra = resolve(home, 'ombra')
  const registrate = new Map<string, Sessione>()

  /** Il token del daemon, letto a ogni richiesta di controllo: il file è piccolo, e
   *  così una rigenerazione dal daemon vale qui senza riavviare niente. Se non c'è,
   *  il controllo rifiuta: il proxy non si inventa un'identità propria. */
  function tokenValido(req: IncomingMessage): boolean {
    const auth = req.headers['authorization']
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false
    let atteso: string
    try { atteso = readFileSync(resolve(home, 'token'), 'utf8').trim() } catch { return false }
    if (!atteso) return false
    return stessoSegreto(auth.slice('Bearer '.length).trim(), atteso)
  }

  function controllo(req: IncomingMessage, res: ServerResponse, url: string): void {
    if (!tokenValido(req)) { res.writeHead(403).end('token mancante o errato'); return }
    if (req.method === 'GET' && url === '/control/stato') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ porta, ombra: true, sessioni: [...registrate.keys()] }))
      return
    }
    if (req.method === 'POST' && url === '/control/sessioni') {
      const pezzi: Buffer[] = []
      req.on('data', c => pezzi.push(c as Buffer))
      req.on('end', () => {
        let id = ''
        let upstream: URL | null = null
        try {
          const corpo = JSON.parse(Buffer.concat(pezzi).toString('utf8')) as { id?: unknown; upstream?: unknown }
          if (typeof corpo.id === 'string') id = corpo.id
          if (typeof corpo.upstream === 'string') upstream = new URL(corpo.upstream)
        } catch { /* risponde il 400 qui sotto */ }
        // `http:` è ammesso di proposito: le prove parlano con un upstream locale senza
        // TLS, e il perimetro vero è il loopback — il proxy ascolta solo su 127.0.0.1.
        if (!ID_VALIDO.test(id) || !upstream || !['https:', 'http:'].includes(upstream.protocol)) {
          res.writeHead(400).end('serve { id: [A-Za-z0-9_-]{4,64}, upstream: URL http(s) }')
          return
        }
        registrate.set(id, { upstream, dal: Date.now() })
        res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ prefisso: `/s/${id}` }))
      })
      return
    }
    const canc = url.match(/^\/control\/sessioni\/([A-Za-z0-9_-]+)$/)
    if (req.method === 'DELETE' && canc?.[1]) {
      registrate.delete(canc[1])
      res.writeHead(204).end()
      return
    }
    res.writeHead(404).end('rotta di controllo sconosciuta')
  }

  function traffico(req: IncomingMessage, res: ServerResponse, id: string, resto: string): void {
    const sessione = registrate.get(id)
    if (!sessione) {
      // Fail-closed, ed è la ricaduta di sicurezza di §4.3: un processo qualunque non
      // può usare il proxy come relay verso il provider, perché dovrebbe indovinare
      // l'id di una sessione viva.
      res.writeHead(403).end('sessione non registrata: il proxy non inoltra')
      return
    }
    const pezzi: Buffer[] = []
    req.on('data', c => pezzi.push(c as Buffer))
    req.on('end', () => {
      const corpo = Buffer.concat(pezzi)
      const { upstream } = sessione
      const h = { ...req.headers }
      delete h['host']; delete h['connection']
      const fai = upstream.protocol === 'https:' ? httpsRequest : httpRequest
      const t0 = Date.now()
      const su = fai(
        {
          host: upstream.hostname,
          port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
          method: req.method,
          path: resto,
          headers: { ...h, host: upstream.hostname },
        },
        giu => {
          // TUTTE le intestazioni passano — comprese `anthropic-ratelimit-*`, che il
          // pannellino della quota legge (§4bis.1). Una lista di intestazioni ammesse
          // sarebbe il posto dove questa promessa si romperebbe in silenzio.
          res.writeHead(giu.statusCode ?? 502, giu.headers)
          let byteGiu = 0
          giu.on('data', (c: Buffer) => { byteGiu += c.length })
          giu.on('end', () => registra(id, req, resto, corpo, giu.statusCode ?? 0, byteGiu, Date.now() - t0))
          giu.pipe(res)
        },
      )
      su.on('error', e => {
        try { res.writeHead(502).end('proxy: upstream irraggiungibile') } catch { /* socket già chiuso */ }
        registra(id, req, resto, corpo, -1, 0, Date.now() - t0, String((e as Error).message))
      })
      su.end(corpo)
    })
  }

  /** Una riga di registro per richiesta, intera (D39). Append-only, un file per
   *  sessione: la stessa forma del journal, la stessa coda da rileggere. */
  function registra(
    id: string, req: IncomingMessage, url: string, corpo: Buffer,
    esito: number, byteGiu: number, ms: number, errore?: string,
  ): void {
    const testo = corpo.toString('utf8')
    const analisi = corpo.length > 0 ? analizza(testo) : null
    try {
      appendFileSync(resolve(cartellaOmbra, `${id}.jsonl`), JSON.stringify({
        ts: Date.now(), metodo: req.method, url, esito, ms,
        byteSu: corpo.length, byteGiu,
        ...(errore ? { errore } : {}),
        ...(analisi
          ? { trovati: analisi.trovati, byteGuardati: analisi.byteGuardati, byteSaltati: analisi.byteSaltati }
          : {}),
        // D39: il corpo intero. È il registro che rende la promessa verificabile (D10):
        // quando il filtro sarà vero, «apri il registro, cerca il nome del tuo cliente,
        // non c'è» si legge da qui.
        ...(corpo.length > 0 ? { corpo: testo } : {}),
      }) + '\n')
    } catch (e) {
      // Il registro che non scrive non deve far cadere il turno: in ombra la priorità
      // è non rompere niente. Ma non deve nemmeno tacere.
      console.error(`[ombra] registro non scritto per ${id}: ${String((e as Error).message)}`)
    }
  }

  let porta = opts.porta ?? Number(process.env['STARK_PROXY_PORT'] ?? PORTA_PROXY)
  const server: Server = createServer((req, res) => {
    const url = String(req.url ?? '/')
    if (url.startsWith('/control/')) { controllo(req, res, url); return }
    const m = url.match(ROTTA_TRAFFICO)
    if (m?.[1] && m[2]) { traffico(req, res, m[1], m[2]); return }
    res.writeHead(403).end('qui si entra solo con un prefisso di sessione')
  })

  mkdirSync(cartellaOmbra, { recursive: true })
  return new Promise<Proxy>((ok, no) => {
    server.once('error', no)
    server.listen(porta, '127.0.0.1', () => {
      porta = (server.address() as { port: number }).port
      ok({ porta, sessioni: () => [...registrate.keys()], close: () => server.close() })
    })
  })
}
