// Il daemon: HTTP più SSE su 127.0.0.1.
//
// Perché SSE e non WebSocket. Il flusso che conta va in una direzione sola, dal daemon
// alla UI; i comandi risalgono come normali POST. SSE è uno standard che sta già in
// Node e nel browser, quindi non introduce dipendenze, e per giunta è la stessa forma
// che usa OpenCode — il che risparmierà lavoro al secondo adapter invece di crearne.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createGuard } from './security.ts'
import { serveUi } from './static.ts'
import { Registry, type OpenSpec } from './registry.ts'
import type { Command } from '../core/events.ts'

export type DaemonOptions = {
  port?: number
  model?: string
  configDir?: string
}

export type Daemon = {
  url: string
  token: string
  registry: Registry
  stop(): Promise<void>
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<Daemon> {
  let port = opts.port ?? 0
  const guard = createGuard(() => port)
  const guardToken = guard.token
  const registry = new Registry({
    ...(opts.model ? { model: opts.model } : {}),
    // Le sessioni dell'utente possono vivere fuori da ~/.claude. Se non si propaga
    // questa, i processi figli guardano nella cartella sbagliata: nessuna
    // conversazione da riprendere e forse nemmeno il login, con l'aria di essere rotti.
    configDir: opts.configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? undefined,
  })

  const server = createServer((req, res) => { void route(req, res, guard, registry, guardToken) })
  // Ascolto esplicito su 127.0.0.1: il default di Node è tutte le interfacce, che qui
  // significherebbe esporre alla LAN un processo che esegue comandi come root.
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r))
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : port

  return {
    url: `http://127.0.0.1:${port}`,
    token: guard.token,
    registry,
    async stop() {
      await registry.shutdown()
      await closeServer(server)
    },
  }
}

// ─── instradamento ──────────────────────────────────────────────────────────

async function route(
  req: IncomingMessage, res: ServerResponse,
  guard: ReturnType<typeof createGuard>, registry: Registry, token: string,
): Promise<void> {
  const motivo = guard.reject(req)
  if (motivo) {
    // Nessun dettaglio nel corpo: a chi bussa senza titolo non si spiega quale delle
    // difese l'ha fermato. Il motivo resta nei log del daemon.
    send(res, 403, { error: 'vietato' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true })

    if (method === 'GET' && path === '/api/sessions') {
      return send(res, 200, { sessions: registry.list() })
    }

    // Il flusso dell'**elenco**, non di una sessione. Esiste perché senza, per sapere
    // che una chat diversa da quella aperta è cambiata, alla barra laterale non
    // restava che richiedere `/api/sessions` a ripetizione.
    if (method === 'GET' && path === '/api/stream') {
      return listStream(req, res, registry)
    }

    // Le conversazioni nate nella CLI. Non è una rotta sulle sessioni di STARK: sono
    // cose che STARK non ha ancora, e che l'SDK sa elencare al posto nostro.
    if (method === 'GET' && path === '/api/importable') {
      return send(res, 200, { sessions: await registry.importable() })
    }
    if (method === 'POST' && path === '/api/importable') {
      const body = await readJson<{ sessionId?: string }>(req)
      if (!body?.sessionId) return send(res, 400, { error: 'sessionId obbligatorio' })
      const esito = await registry.importSession(body.sessionId)
      return send(res, esito.ok ? 201 : 409, esito)
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = await readJson<OpenSpec>(req)
      if (!body?.cwd) return send(res, 400, { error: 'cwd obbligatorio' })
      const id = await registry.open(body)
      return send(res, 201, { id, snapshot: registry.snapshot(id) })
    }

    const m = /^\/api\/sessions\/([0-9a-f-]{8,})(\/[a-z]+)?$/.exec(path)
    if (m) {
      const id = m[1]!
      const sub = m[2] ?? ''

      if (method === 'GET' && sub === '') {
        const s = registry.snapshot(id)
        return s ? send(res, 200, { snapshot: s }) : send(res, 404, { error: 'sconosciuta' })
      }
      if (method === 'GET' && sub === '/events') {
        const from = Number(url.searchParams.get('from') ?? 0)
        return send(res, 200, { events: registry.events(id, Number.isFinite(from) ? from : 0) })
      }
      if (method === 'GET' && sub === '/stream') {
        const from = Number(url.searchParams.get('from') ?? 0)
        return stream(req, res, registry, id, Number.isFinite(from) ? from : 0)
      }
      if (method === 'DELETE' && sub === '') {
        const esito = await registry.remove(id)
        return send(res, esito.ok ? 200 : 404, esito)
      }
      if (method === 'POST' && sub === '/command') {
        const cmd = await readJson<Command>(req)
        if (!cmd?.c) return send(res, 400, { error: 'comando malformato' })
        const esito = await registry.command(id, cmd)
        return send(res, esito.ok ? 200 : 409, esito)
      }
    }

    // Tutto ciò che non è /api è la UI. Sta in fondo di proposito: l'API ha la
    // precedenza, così un file compilato non potrà mai oscurare una rotta vera.
    if (!path.startsWith('/api/') && serveUi(req, res, token)) return

    send(res, 404, { error: 'non trovato' })
  } catch (e) {
    send(res, 500, { error: String((e as Error).message ?? e) })
  }
}

// ─── flusso degli eventi ────────────────────────────────────────────────────

function stream(
  req: IncomingMessage, res: ServerResponse, registry: Registry, id: string, from: number,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Nessuna intestazione CORS, di proposito: chi non è servito da qui non deve
    // poter leggere questo flusso.
  })
  res.write(': collegato\n\n')

  const unsubscribe = registry.subscribe(id, from, e => {
    // `id:` è il numero di sequenza: se la connessione cade, il client sa da dove
    // ripartire senza rileggere tutto e senza saltare niente.
    res.write(`id: ${e.seq}\nevent: canonical\ndata: ${JSON.stringify(e)}\n\n`)
  })

  // Un proxy o un firewall di mezzo chiude le connessioni mute. Il commento periodico
  // le tiene aperte senza inquinare il flusso: le righe che iniziano con `:` sono
  // ignorate dal client per specifica.
  const battito = setInterval(() => res.write(': .\n\n'), 15000)

  const chiudi = (): void => { clearInterval(battito); unsubscribe(); res.end() }
  req.on('close', chiudi)
  req.on('error', chiudi)
}

/**
 * Le righe dell'elenco, ogni volta che cambiano.
 *
 * Manda la lista intera e non un delta: sono poche decine di righe corte, e un
 * protocollo di differenze fra client e server sarebbe una seconda copia dello stato
 * da tenere allineata — cioè un altro posto in cui la UI può divergere dal journal.
 *
 * Il ritardo non è una comodità: un solo turno produce decine di eventi al secondo,
 * e ognuno cambia `lastSeq`. Senza, si ricalcolerebbe l'elenco — che rilegge da disco
 * i journal delle sessioni non vive — a ogni delta di testo.
 */
function listStream(req: IncomingMessage, res: ServerResponse, registry: Registry): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })

  let timer: ReturnType<typeof setTimeout> | null = null
  const invia = (): void => {
    timer = null
    res.write(`event: sessions\ndata: ${JSON.stringify({ sessions: registry.list() })}\n\n`)
  }
  invia()

  const unsubscribe = registry.watchAll(() => {
    if (timer === null) timer = setTimeout(invia, 250)
  })
  const battito = setInterval(() => res.write(': .\n\n'), 15000)

  const chiudi = (): void => {
    clearInterval(battito)
    if (timer) clearTimeout(timer)
    unsubscribe()
    res.end()
  }
  req.on('close', chiudi)
  req.on('error', chiudi)
}

// ─── utilità ────────────────────────────────────────────────────────────────

function send(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(s)
}

async function readJson<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // Un corpo senza limite è un modo di finire la memoria del daemon.
    if (size > 4 * 1024 * 1024) throw new Error('corpo troppo grande')
    chunks.push(c as Buffer)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T } catch { return null }
}

function closeServer(server: Server): Promise<void> {
  return new Promise(r => { server.closeAllConnections?.(); server.close(() => r()) })
}
