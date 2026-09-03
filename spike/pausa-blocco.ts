// La meccanica della pausa (docs/anonimizzazione.md §12bis, punto 1).
//
// «In dubbio, ferma» (D7) e' deciso come principio, non come meccanica HTTP: quando il
// proxy trattiene un `POST /v1/messages` per chiedere all'utente, dall'altra parte c'e'
// il client del CLI coi SUOI timeout e i SUOI retry — che non controlliamo e non
// conosciamo. Le due strade producono codice diverso:
//   - TRATTENERE la richiesta aperta finche' l'utente decide;
//   - FALLIRLA con un errore distinguibile e rimandarla dopo.
// Si sceglie misurando quanto il client regge, non deducendolo.
//
// DUE MODI:
//   node spike/pausa-blocco.ts                → «quanto regge»: il primo POST /v1/messages
//     viene trattenuto SENZA MAI rispondere ne' inoltrare. Si misura: dopo quanto il
//     client molla (chiude il socket), se e come ritenta, e cosa vede l'SDK.
//     COSTO: zero quota — niente raggiunge Anthropic.
//   node spike/pausa-blocco.ts --rilascio 90  → «la pausa e' vivibile?»: si trattiene 90 s
//     e POI si inoltra. Se il turno arriva in fondo, trattenere entro quella finestra e'
//     una strategia praticabile. COSTO: un turno di Haiku da una parola.
//
// TRAPPOLA EVITATA, da lasciare scritta: Node ammazza da solo le richieste che il server
// non serve (`requestTimeout` 300 s di default, piu' `headersTimeout`). Senza azzerarli,
// la sonda misurerebbe il timeout NOSTRO e lo chiamerebbe «il client ha mollato» — una
// prova che guarda il posto sbagliato non fallisce: mente.
//
// Cattura in spike/captures/pausa-blocco.jsonl (lezione di alias-tenuta: l'esito si
// archivia, non si affida al terminale).

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { appendFileSync, mkdirSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const UPSTREAM = 'api.anthropic.com'
const CATTURA = new URL('./captures/pausa-blocco.jsonl', import.meta.url).pathname
const RILASCIO = (() => {
  const i = process.argv.indexOf('--rilascio')
  return i >= 0 ? Number(process.argv[i + 1] ?? '90') * 1000 : null
})()
const T0 = Date.now()
const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's'

type Evento = { t: string; cosa: string; dettaglio?: string }
const eventi: Evento[] = []
function ev(cosa: string, dettaglio?: string) {
  const e = { t: t(), cosa, ...(dettaglio ? { dettaglio } : {}) }
  eventi.push(e)
  console.log(`  [${e.t.padStart(7)}] ${cosa}${dettaglio ? ' — ' + dettaglio : ''}`)
}

function inoltra(req: IncomingMessage, res: ServerResponse, corpo: Buffer) {
  const h = { ...req.headers }
  delete h['host']; delete h['connection']
  const su = httpsRequest(
    { host: UPSTREAM, port: 443, path: req.url ?? '/', method: req.method, headers: { ...h, host: UPSTREAM } },
    giu => { res.writeHead(giu.statusCode ?? 502, giu.headers); giu.pipe(res) },
  )
  su.on('error', e => { try { res.writeHead(502).end('upstream ko') } catch { /* socket gia' chiuso */ } })
  su.end(corpo)
}

let trattenute = 0

async function main() {
  mkdirSync(new URL('./captures/', import.meta.url).pathname, { recursive: true })
  const server = createServer((req, res) => {
    const pezzi: Buffer[] = []
    req.on('data', c => pezzi.push(c))
    req.on('end', () => {
      const corpo = Buffer.concat(pezzi)
      const eIlTurno = req.method === 'POST' && String(req.url).includes('/v1/messages')
      if (!eIlTurno) {
        ev(`passa ${req.method} ${req.url}`)
        inoltra(req, res, corpo)
        return
      }
      trattenute += 1
      const n = trattenute
      ev(`TRATTENGO il POST /v1/messages n.${n}`, `${corpo.length} B`)
      // Il client che molla si vede dal socket che si chiude sotto la risposta mai data.
      res.on('close', () => ev(`il client CHIUDE il tentativo n.${n}`))
      req.on('error', () => { /* reset del socket: gia' coperto da close */ })
      if (RILASCIO !== null && n === 1) {
        setTimeout(() => {
          ev(`RILASCIO il tentativo n.${n} dopo ${RILASCIO / 1000}s: inoltro a monte`)
          inoltra(req, res, corpo)
        }, RILASCIO)
      }
      // senza --rilascio: non si risponde mai. La misura E' il silenzio.
    })
  })
  // La trappola dei timeout di Node: azzerati, o misuriamo noi stessi.
  server.requestTimeout = 0
  server.headersTimeout = 0
  server.timeout = 0
  server.keepAliveTimeout = 0

  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const porta = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${porta}`
  console.log(`proxy su ${base} — modo: ${RILASCIO === null ? 'QUANTO REGGE (mai rispondere)' : `RILASCIO dopo ${RILASCIO / 1000}s`}\n`)

  // Tetto duro: una sonda che non finisce non ha il permesso di restare appesa.
  const boia = setTimeout(() => {
    ev('TETTO 12 minuti raggiunto: chiudo io')
    chiudi('tetto 12 min')
  }, 12 * 60_000)

  const opts = buildOptions({
    cwd: process.cwd(), mode: 'acceptEdits', model: 'claude-haiku-4-5', title: 'sonda pausa',
  }) as Record<string, unknown>
  opts['env'] = { ...process.env, ANTHROPIC_BASE_URL: base }

  let esitoSdk = ''
  try {
    const q = query({ prompt: 'Rispondi con la sola parola PONG, nientaltro.', options: opts as never })
    for await (const m of q) {
      const msg = m as Record<string, unknown>
      if (msg['type'] === 'assistant') ev('SDK: messaggio assistant')
      if (msg['type'] === 'result') {
        esitoSdk = `result ${msg['subtype']}` + (msg['is_error'] ? ' (errore)' : '')
        ev(`SDK: ${esitoSdk}`, String(msg['result'] ?? '').slice(0, 120))
        break
      }
    }
  } catch (e) {
    esitoSdk = `eccezione: ${String((e as Error)?.message ?? e).slice(0, 200)}`
    ev('SDK: eccezione', esitoSdk)
  }

  // Dopo che l'SDK ha chiuso, il CLI potrebbe avere ancora tentativi in canna:
  // si resta in ascolto ancora 45 s prima di tirare le somme.
  ev('SDK terminato: ascolto ancora 45s per eventuali ritentativi orfani')
  await new Promise(ok => setTimeout(ok, 45_000))
  clearTimeout(boia)
  chiudi(esitoSdk)

  function chiudi(esito: string): void {
    appendFileSync(CATTURA, JSON.stringify({
      quando: new Date().toISOString(),
      modo: RILASCIO === null ? 'quanto-regge' : `rilascio-${RILASCIO / 1000}s`,
      esitoSdk: esito, tentativi: trattenute, eventi,
    }) + '\n')
    console.log('\n' + '='.repeat(74))
    console.log(`LETTURA — tentativi trattenuti: ${trattenute} · esito SDK: ${esito}`)
    console.log(`cattura in ${CATTURA}`)
    process.exit(0)
  }
}

main()
