// Misura A dell'anonimizzazione (docs/anonimizzazione.md §4).
//
// LA DOMANDA: il CLI di Claude Code accetta `ANTHROPIC_BASE_URL` **restando
// sull'abbonamento**? Tutta l'architettura del proxy locale dipende da questo. L'utente
// e' a quota fissa: se puntare la base URL altrove costringe a fatturare a chiave API,
// il costo non e' tecnico ma economico, e il progetto diventa un altro progetto.
//
// COSA FA: alza un proxy HTTP su 127.0.0.1 che inoltra tutto ad api.anthropic.com,
// registra chi bussa e con quali credenziali, e ci fa passare **un turno vero** di Haiku
// da una parola. Poi dice quattro cose che non si possono dedurre:
//
//   1. il CLI ci passa davvero? (se al proxy non bussa nessuno, la variabile e' ignorata
//      e la strada B non esiste in questa forma)
//   2. con quale credenziale? `authorization: Bearer sk-ant-oat…` e' il token OAuth
//      dell'abbonamento; `x-api-key: sk-ant-api…` sarebbe fatturazione a consumo
//   3. il turno arriva in fondo, o il CLI si rifiuta di lavorare su una base URL non sua?
//   4. che forma ha il corpo — cioe' **dove vive il testo** che un domani andrebbe
//      anonimizzato. La cattura resta su disco per il lavoro di dopo.
//
// COSTO: un turno di Haiku da una parola. Praticamente zero, ma non e' zero: qui un
// handshake non basta, perche' l'handshake e' locale e non tocca la rete.
//
// Uso:  node spike/proxy-base-url.ts

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdirSync, writeFileSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const UPSTREAM = 'api.anthropic.com'
const CAPTURE = new URL('./captures/proxy-base-url.jsonl', import.meta.url).pathname

// Il prefisso di percorso con cui un proxy **solo** instraderebbe per sessione
// (misura A-bis). `proxy-instradamento.ts` ha visto che sopravvive su `HEAD /api/hello`,
// che pero' il CLI fa con un client diverso (`Bun`) da quello dei messaggi (`stainless`):
// qui si verifica sulla richiesta che conta. Si toglie prima di inoltrare a monte.
const PREFISSO = '/s/PROVA-1234'
const senzaPrefisso = (u: string) => u.startsWith(PREFISSO) ? u.slice(PREFISSO.length) || '/' : u

type Bussata = {
  ts: number
  metodo: string
  url: string
  /** Come si e' presentato: lo schema e il prefisso, mai il segreto intero. */
  credenziale: string
  /** Le intestazioni che dicono qualcosa su chi e come, senza i valori sensibili. */
  intestazioni: Record<string, string>
  esito?: number
  corpoIn?: number
  corpoOut?: number
}

const bussate: Bussata[] = []
const catture: string[] = []

/** Mostra abbastanza da riconoscere il tipo di credenziale, mai abbastanza da usarla.
 *  E' esattamente la regola §6.1 del documento, applicata alla sonda che la studia. */
function credenziale(h: IncomingMessage['headers']): string {
  const auth = h['authorization']
  const key = h['x-api-key']
  if (typeof auth === 'string') {
    const [schema, valore = ''] = auth.split(' ')
    return `${schema} ${valore.slice(0, 14)}… (${valore.length} car.)`
  }
  if (typeof key === 'string') return `x-api-key ${key.slice(0, 14)}… (${key.length} car.)`
  return 'NESSUNA'
}

const INTERESSANTI = [
  'anthropic-version', 'anthropic-beta', 'user-agent', 'x-app', 'content-type',
  'x-stainless-package-version', 'x-stainless-runtime',
]

function proxy(req: IncomingMessage, res: ServerResponse) {
  const pezzi: Buffer[] = []
  req.on('data', (c: Buffer) => pezzi.push(c))
  req.on('end', () => {
    const corpo = Buffer.concat(pezzi)
    const nota: Bussata = {
      ts: Date.now(),
      metodo: req.method ?? '?',
      url: req.url ?? '?',
      credenziale: credenziale(req.headers),
      intestazioni: Object.fromEntries(
        INTERESSANTI.filter(k => req.headers[k]).map(k => [k, String(req.headers[k])]),
      ),
      corpoIn: corpo.length,
    }
    bussate.push(nota)
    catture.push(JSON.stringify({ verso: 'uscita', ...nota, corpo: corpo.toString('utf8').slice(0, 20_000) }))

    // Inoltro fedele: stesse intestazioni, tolto solo `host`, che deve dire l'upstream.
    const h = { ...req.headers }
    delete h['host']
    delete h['connection']
    const su = httpsRequest(
      { host: UPSTREAM, port: 443, path: senzaPrefisso(req.url ?? '/'), method: req.method, headers: { ...h, host: UPSTREAM } },
      giu => {
        nota.esito = giu.statusCode
        res.writeHead(giu.statusCode ?? 502, giu.headers)
        let n = 0
        const rispPezzi: Buffer[] = []
        giu.on('data', (c: Buffer) => { n += c.length; if (rispPezzi.length < 200) rispPezzi.push(c) })
        giu.on('end', () => {
          nota.corpoOut = n
          catture.push(JSON.stringify({
            verso: 'ritorno', url: req.url, esito: giu.statusCode, byte: n,
            corpo: Buffer.concat(rispPezzi).toString('utf8').slice(0, 20_000),
          }))
        })
        giu.pipe(res)
      },
    )
    su.on('error', e => {
      nota.esito = -1
      nota.intestazioni['errore-upstream'] = String((e as Error).message)
      res.writeHead(502).end('proxy: upstream ko')
    })
    su.end(corpo)
  })
}

async function main() {
  const server = createServer(proxy)
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const porta = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${porta}${PREFISSO}`
  console.log(`proxy in ascolto su ${base} → https://${UPSTREAM}\n`)

  const opts = buildOptions({ cwd: process.cwd(), mode: 'default', model: 'claude-haiku-4-5' }) as Record<string, unknown>
  // La variabile sotto misura. `CLAUDE_CONFIG_DIR` va propagata a mano: senza, il figlio
  // guarda in ~/.claude e non trova nemmeno il login (trappola gia' nota, CLAUDE.md).
  opts['env'] = { ...process.env, ANTHROPIC_BASE_URL: base }

  let risposta = ''
  let errore = ''
  let init: Record<string, unknown> = {}
  try {
    const q = query({
      prompt: 'Rispondi con la sola parola PONG, nientaltro.',
      options: opts as never,
    })
    init = await q.initializationResult() as Record<string, unknown>
    for await (const m of q) {
      const msg = m as Record<string, unknown>
      if (msg['type'] === 'assistant') {
        const c = (msg['message'] as Record<string, unknown>)?.['content']
        if (Array.isArray(c)) for (const b of c) if (b?.['type'] === 'text') risposta += String(b['text'])
      }
      if (msg['type'] === 'result') break
    }
  } catch (e) {
    errore = String((e as Error)?.message ?? e)
  }

  server.close()
  mkdirSync(new URL('./captures/', import.meta.url).pathname, { recursive: true })
  writeFileSync(CAPTURE, catture.join('\n') + '\n')

  // ── verdetto ────────────────────────────────────────────────────────────────
  console.log('─'.repeat(72))
  console.log(`handshake: modello=${init['model'] ?? '?'} modo=${init['current_permission_mode'] ?? '?'}`)
  console.log(`risposta del modello: ${risposta.trim() || '(nessuna)'}`)
  if (errore) console.log(`ERRORE: ${errore.slice(0, 400)}`)
  console.log('─'.repeat(72))
  console.log(`bussate al proxy: ${bussate.length}`)
  for (const b of bussate) {
    console.log(`  ${b.metodo} ${b.url}`)
    console.log(`     credenziale : ${b.credenziale}`)
    console.log(`     esito       : ${b.esito}  (${b.corpoIn} B su, ${b.corpoOut} B giu)`)
    for (const [k, v] of Object.entries(b.intestazioni)) console.log(`     ${k.padEnd(12)}: ${String(v).slice(0, 90)}`)
  }
  console.log('─'.repeat(72))
  if (bussate.length === 0) {
    console.log('VERDETTO: il CLI NON e passato dalla base URL. La variabile e ignorata,')
    console.log('          oppure il traffico esce da un altro punto. Strada B da rivedere.')
  } else {
    const oauth = bussate.some(b => /Bearer sk-ant-oat/.test(b.credenziale))
    const apikey = bussate.some(b => /x-api-key/.test(b.credenziale))
    console.log(`VERDETTO: il CLI passa dal proxy (${bussate.length} richieste).`)
    console.log(`          abbonamento (OAuth) : ${oauth ? 'SI' : 'no'}`)
    console.log(`          chiave API          : ${apikey ? 'SI' : 'no'}`)
    console.log(`          turno arrivato in fondo: ${risposta.trim() ? 'SI' : 'NO'}`)
    const msg = bussate.filter(b => b.url.includes('/v1/messages'))
    const conPref = msg.filter(b => b.url.startsWith(PREFISSO))
    console.log(`          prefisso di percorso tenuto su /v1/messages: `
      + `${msg.length === 0 ? 'nessuna richiesta' : conPref.length === msg.length ? 'SI' : `NO (${conPref.length}/${msg.length})`}`)
  }
  console.log(`cattura: ${CAPTURE}`)
}

main()
