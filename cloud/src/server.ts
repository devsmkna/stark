// Il server cloud di STARK: oggi autenticazione, domani sincronizzazione della board.
//
// Gira sul VPS dietro Traefik (vedi cloud/docker-compose.yml). Il daemon locale è
// l'unico client: il browser non parla con questo server direttamente.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import { registra, login, revoca, chi } from './auth.ts'
import { sql } from './db/client.ts'

const PORTA = Number(process.env['PORT'] ?? 8787)

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJson<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 64 * 1024) throw new Error('corpo troppo grande')
    chunks.push(c as Buffer)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T } catch { return null }
}

function bearer(req: IncomingMessage): string {
  const h = String(req.headers['authorization'] ?? '')
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

export async function startCloud(): Promise<void> {
  // Le migrazioni si applicano a ogni avvio: sono cumulative e idempotenti, quindi
  // il server arriva sempre su uno schema aggiornato senza un passo a parte.
  await migrate(drizzle(sql), { migrationsFolder: './src/db/migrations' })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = req.method ?? 'GET'
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
      send(res, 404, { error: 'non trovato' })
    } catch (e) {
      send(res, 500, { error: String((e as Error).message ?? e) })
    }
  })

  server.listen(PORTA, '0.0.0.0', () => {
    console.log(`cloud server su :${PORTA}`)
  })
}

// Avvio diretto: `node src/cloud/server.ts`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startCloud()
}
