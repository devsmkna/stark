// Il server cloud di STARK: autenticazione, board sincronizzata, e l'uso unito fra i
// dispositivi di una persona.
//
// Gira sul VPS dietro Traefik (vedi cloud/docker-compose.yml). Il daemon locale è
// l'unico client: il browser non parla con questo server direttamente.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import { registra, login, revoca, chi } from './auth.ts'
import { leggiBoard, initBoard, creaTask, modificaTask } from './board.ts'
import { registraUso, leggiUso, type Invio } from './usage.ts'
import { sql } from './db/client.ts'
import { TunnelHub } from './tunnel.ts'

const PORTA = Number(process.env['PORT'] ?? 8787)

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Il corpo JSON di una richiesta, con un tetto.
 *
 * Il tetto è 64 KB per tutto — un task della board, delle credenziali — tranne per
 * l'invio dell'usage, che è l'unica rotta che manda **molte righe insieme**: al primo
 * invio di una macchina è tutto lo storico, spezzato in finestre. Il limite lì è
 * dichiarato dal chiamante invece di essere alzato per tutti, così una rotta nuova non
 * eredita per sbaglio un permesso pensato per un'altra.
 */
async function readJson<T>(req: IncomingMessage, maxBytes = 64 * 1024): Promise<T | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > maxBytes) throw new Error('corpo troppo grande')
    chunks.push(c as Buffer)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T } catch { return null }
}

function bearer(req: IncomingMessage): string {
  const h = String(req.headers['authorization'] ?? '')
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

// ─── pub/sub della board (stream event-driven) ──────────────────────────────
// I client connessi a `/board/stream` di un origin, in memoria. Quando una board
// cambia si notifica chi la sta guardando: è la stessa idea del flusso SSE del daemon.
const ascoltatori = new Map<string, Set<ServerResponse>>()

function sottoscrivi(origin: string, res: ServerResponse): void {
  let s = ascoltatori.get(origin)
  if (!s) { s = new Set(); ascoltatori.set(origin, s) }
  s.add(res)
  res.on('close', () => { s!.delete(res); if (s!.size === 0) ascoltatori.delete(origin) })
}

function notifica(origin: string, board: unknown): void {
  const s = ascoltatori.get(origin)
  if (!s) return
  for (const res of s) {
    try { res.write(`event: board\ndata: ${JSON.stringify(board)}\n\n`) } catch { /* client morto */ }
  }
}

export async function startCloud(): Promise<void> {
  // Le migrazioni si applicano a ogni avvio: sono cumulative e idempotenti, quindi
  // il server arriva sempre su uno schema aggiornato senza un passo a parte.
  await migrate(drizzle(sql), { migrationsFolder: './src/db/migrations' })

  // Il tunnel condivide il processo col cloud per una ragione sola: la verifica del
  // token è la stessa `chi()` sullo stesso Postgres, e due processi vorrebbero dire
  // due strade per la stessa domanda. Traefik gli instrada un hostname suo
  // (tunnel.starkapp.dev): è l'`Host` a decidere chi risponde, non il percorso.
  const tunnel = new TunnelHub(chi)
  const suTunnel = (req: IncomingMessage): boolean =>
    (req.headers.host ?? '').split(':')[0]?.toLowerCase().startsWith('tunnel.') ?? false

  const server = createServer(async (req, res) => {
    if (suTunnel(req)) {
      if (!tunnel.handleRequest(req, res)) {
        // Nessuna macchina indicata (né `?m=` né cookie): non c'è dove instradare.
        // Si spiega, perché chi arriva qui è di solito un link vecchio o un browser
        // nuovo — non un errore del server.
        send(res, 404, { error: 'nessuna macchina indicata: apri il QR dal pannello «Use STARK from your phone»' })
      }
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = req.method ?? 'GET'
    const origin = (url.searchParams.get('origin') ?? '').trim()
    try {
      if (method === 'POST' && path === '/api/register') {
        const body = await readJson<{ email?: string; password?: string }>(req)
        if (!body?.email || !body?.password) return send(res, 400, { error: 'email e password obbligatorie' })
        try {
          const fatto = await registra(body.email, body.password)
          return send(res, fatto ? 201 : 409, fatto ? { ok: true } : { error: 'email già registrata' })
        } catch (e) {
          return send(res, 400, { error: String((e as Error).message ?? e) })
        }
      }
      if (method === 'POST' && path === '/api/login') {
        const body = await readJson<{ email?: string; password?: string }>(req)
        if (!body?.email || !body?.password) return send(res, 400, { error: 'email e password obbligatorie' })
        const sessione = await login(body.email, body.password)
        if (!sessione) return send(res, 401, { error: 'email o password sbagliate' })
        return send(res, 200, { token: sessione.token, email: sessione.email })
      }
      if (method === 'POST' && path === '/api/logout') {
        await revoca(bearer(req))
        return send(res, 200, { ok: true })
      }
      if (method === 'GET' && path === '/api/me') {
        const email = await chi(bearer(req))
        if (!email) return send(res, 401, { error: 'non autenticato' })
        return send(res, 200, { email })
      }

      // ─── l'uso unito fra i dispositivi (dietro auth Bearer) ────────────────
      //
      // Niente `origin` in query, a differenza della board: qui la chiave è
      // l'utente, e sta già nel token. Un utente vede solo i propri numeri —
      // non c'è nessuna rotta che ne mostri di altri, ed è una scelta.
      if (path === '/api/usage') {
        const email = await chi(bearer(req))
        if (!email) return send(res, 401, { error: 'non autenticato' })

        if (method === 'POST') {
          const body = await readJson<Invio>(req, 2 * 1024 * 1024)
          if (!body) return send(res, 400, { error: 'corpo mancante o non JSON' })
          const esito = await registraUso(email, body)
          return send(res, esito.ok ? 200 : 400, esito)
        }
        if (method === 'GET') {
          // `from` e `to` sono giorni (`YYYY-MM-DD`), non millisecondi: il taglio in
          // giornate lo ha già fatto il daemon nel fuso della macchina che ha
          // lavorato, e rifarlo qui col fuso del VPS darebbe una seconda verità.
          const uso = await leggiUso(email, {
            from: url.searchParams.get('from') ?? undefined,
            to: url.searchParams.get('to') ?? undefined,
          })
          if (!uso) return send(res, 404, { error: 'utente sconosciuto' })
          return send(res, 200, uso)
        }
      }

      // ─── la board (dietro auth Bearer) ─────────────────────────────────────
      // L'`origin` arriva come query param, non come segmento di path: è un URL git
      // con slash, che in un segmento si romperebbe.
      if (origin && path.startsWith('/api/board')) {
        const email = await chi(bearer(req))
        if (!email) return send(res, 401, { error: 'non autenticato' })

        if (method === 'GET' && path === '/api/board') {
          return send(res, 200, await leggiBoard(origin))
        }
        if (method === 'GET' && path === '/api/board/stream') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          res.write(`event: board\ndata: ${JSON.stringify(await leggiBoard(origin))}\n\n`)
          sottoscrivi(origin, res)
          return
        }
        if (method === 'POST' && path === '/api/board/init') {
          const esito = await initBoard(origin)
          if (esito.ok) notifica(origin, await leggiBoard(origin))
          return send(res, esito.ok ? 200 : 400, esito)
        }
        if (method === 'POST' && path === '/api/board/task') {
          const body = await readJson<{ title?: string; priority?: string; body?: string }>(req)
          if (!body?.title) return send(res, 400, { error: 'titolo obbligatorio' })
          const esito = await creaTask(origin, email, {
            title: body.title, priority: body.priority, body: body.body,
          })
          if (esito.ok) notifica(origin, await leggiBoard(origin))
          return send(res, esito.ok ? 200 : 400, esito)
        }
        const em = /^\/api\/board\/task\/(\d+)\/edit$/.exec(path)
        if (method === 'POST' && em) {
          const body = await readJson<{
            status?: string; title?: string; priority?: string; claimed_by?: string; position?: number
          }>(req)
          const esito = await modificaTask(origin, email, Number(em[1]), body ?? {})
          if (esito.ok) notifica(origin, await leggiBoard(origin))
          return send(res, esito.ok ? 200 : 400, esito)
        }
      }

      send(res, 404, { error: 'non trovato' })
    } catch (e) {
      send(res, 500, { error: String((e as Error).message ?? e) })
    }
  })

  // L'upgrade WebSocket esiste solo per i daemon che si collegano al tunnel: su
  // qualunque altro percorso (o hostname) la connessione si chiude senza cerimonie.
  server.on('upgrade', (req, socket, head) => {
    if (suTunnel(req) && (req.url ?? '').split('?')[0] === '/connect') {
      void tunnel.handleUpgrade(req, socket, head)
      return
    }
    socket.destroy()
  })

  server.listen(PORTA, '0.0.0.0', () => {
    console.log(`cloud server su :${PORTA}`)
  })
}

// Avvio diretto: `node src/cloud/server.ts`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startCloud()
}
