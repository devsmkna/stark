// Misura A-bis: un proxy **solo** per tutte le sessioni sa a chi appartiene una richiesta?
//
// Il dizionario e' per progetto (docs/anonimizzazione.md §5), ma il CLI apre una
// connessione HTTP e manda un `POST /v1/messages` in cui non c'e' niente che dica quale
// progetto sia. Con un proxy per sessione la domanda non esisteva; con uno solo va
// risolta, e la strada pulita e' mettere l'identita' **nella base URL stessa**:
//
//     ANTHROPIC_BASE_URL = http://127.0.0.1:PORT/s/<sessione>
//
// Funziona pero' solo se il CLI **rispetta il prefisso di percorso** invece di buttarlo
// via e chiamare `/v1/messages` nudo.
//
// COSTO: ZERO quota. Il generatore di prompt non finisce mai, quindi nessun turno parte;
// basta la sonda di raggiungibilita' che il CLI fa da solo all'avvio (`HEAD /api/hello`,
// vista nella misura A) per sapere se il prefisso sopravvive.
//
// Uso:  node spike/proxy-instradamento.ts

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const PREFISSO = '/s/PROVA-1234'
const visti: string[] = []

function orecchio(req: IncomingMessage, res: ServerResponse) {
  visti.push(`${req.method} ${req.url}`)
  // Si risponde da soli, senza inoltrare: la domanda e' solo che forma ha l'URL.
  // 200 vuoto sulla sonda di raggiungibilita', cosi' il CLI non si crede offline.
  res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
}

async function main() {
  const server = createServer(orecchio)
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const porta = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${porta}${PREFISSO}`
  console.log(`in ascolto su http://127.0.0.1:${porta}, base URL dichiarata: ${base}\n`)

  const opts = buildOptions({ cwd: process.cwd(), mode: 'default', model: 'claude-haiku-4-5' }) as Record<string, unknown>
  opts['env'] = { ...process.env, ANTHROPIC_BASE_URL: base }

  // Generatore che non finisce mai: la sessione si alza, nessun turno parte.
  // (La trappola opposta e' registrata in spike/costo-vs-cli.ts: un generatore *vuoto*
  //  chiude lo stdin e il processo muore prima che si possa chiedere qualcosa.)
  const q = query({
    prompt: (async function* () { await new Promise(() => {}) })() as never,
    options: opts as never,
  })
  try {
    await q.initializationResult()
    console.log('handshake fatto.')
  } catch (e) {
    console.log(`handshake ko: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
  }
  // Un attimo perche' la sonda di raggiungibilita' arrivi: e' asincrona rispetto all'handshake.
  await new Promise(r => setTimeout(r, 4000))
  try { await (q as unknown as { interrupt(): Promise<void> }).interrupt() } catch { /* niente */ }
  server.close()
  process.exitCode = 0

  console.log('─'.repeat(64))
  console.log(`richieste viste: ${visti.length}`)
  for (const v of visti) console.log(`  ${v}`)
  console.log('─'.repeat(64))
  const conPrefisso = visti.filter(v => v.includes(PREFISSO))
  if (visti.length === 0) {
    console.log('VERDETTO: nessuna richiesta. Il CLI non ha bussato prima del primo turno,')
    console.log('          oppure il prefisso gli ha impedito di partire. Da rifare con un turno.')
  } else if (conPrefisso.length === visti.length) {
    console.log('VERDETTO: il prefisso di percorso SOPRAVVIVE. Un proxy solo puo instradare')
    console.log('          per URL, senza dipendere da intestazioni personalizzate.')
  } else if (conPrefisso.length === 0) {
    console.log('VERDETTO: il prefisso viene BUTTATO VIA. Serve un altro modo di dire')
    console.log('          al proxy di chi e la richiesta (porta per sessione, o header).')
  } else {
    console.log('VERDETTO: MISTO — alcune lo tengono, altre no. Instradare per URL non basta.')
  }
  process.exit(0)
}

main()
