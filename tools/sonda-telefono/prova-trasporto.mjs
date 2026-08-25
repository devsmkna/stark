// Misura se un trasporto lascia passare uno *stream*, non solo una richiesta.
//
//   node tools/sonda-telefono/prova-trasporto.mjs https://qualcosa.example
//   node tools/sonda-telefono/prova-trasporto.mjs http://127.0.0.1:4610   # riferimento
//
// Va lanciato mentre `npm run sonda` gira e il tunnel ci punta.
//
// Perche' tre prove e non una. Il 25 agosto il quick tunnel di Cloudflare ha dato 0 byte
// su SSE. Fermarsi li' avrebbe prodotto la conclusione «SSE non passa», e la contromisura
// sbagliata (cambiare content-type). Misurando ANCHE il chunked semplice e il WebSocket
// e' venuto fuori che bufferizza *qualunque* streaming HTTP e che solo il WebSocket passa
// — che e' la conclusione che poi decide l'architettura, perche' vorrebbe dire riaprire
// «HTTP + SSE, non WebSocket» contro la premessa con cui era stata chiusa.
//
// Il controllo che rende onesta la misura: si guarda anche una richiesta NON in streaming.
// Se quella passa e gli stream no, il server sta scrivendo e il proxy sta trattenendo —
// senza, «0 byte» potrebbe voler dire solo «non ho raggiunto niente».
const base = process.argv[2]
if (!base) { console.error('serve un indirizzo, es. https://xxx.trycloudflare.com'); process.exit(1) }
const SECONDI = Number(process.env['SONDA_ATTESA'] ?? 10)

const esito = (nome, ok, dettaglio) =>
  console.log(`  ${ok ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mNO  \x1b[0m'} ${nome.padEnd(30)} ${dettaglio}`)

async function leggiStream(percorso, cerca) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), SECONDI * 1000)
  let byte = 0, pezzi = 0, primoA = null
  const t0 = Date.now()
  try {
    const r = await fetch(base + percorso, { signal: ac.signal })
    for await (const c of r.body) { byte += c.length; pezzi++; primoA ??= Date.now() - t0 }
  } catch { /* l'abort e' come finisce sempre: stiamo misurando una cosa senza fine */ }
  clearTimeout(t)
  return { byte, pezzi, primoA }
}

console.log(`\n  Misuro ${base} per ~${SECONDI}s a prova.\n`)

// Controllo: una richiesta normale passa?
try {
  const t0 = Date.now()
  const r = await fetch(base + '/api/vapid')
  esito('richiesta normale', r.ok, `${r.status} in ${Date.now() - t0} ms`)
} catch (e) { esito('richiesta normale', false, e.message); console.log('\n  Irraggiungibile: il resto non direbbe nulla.\n'); process.exit(1) }

const sse = await leggiStream('/api/sse?chi=prova-trasporto')
esito('SSE (text/event-stream)', sse.byte > 0, sse.byte > 0
  ? `${sse.byte} byte in ${sse.pezzi} pezzi, primo a ${sse.primoA} ms` : '0 byte — bufferizzato')

const chunk = await leggiStream('/api/chunked')
esito('chunked (text/plain)', chunk.byte > 0, chunk.byte > 0
  ? `${chunk.byte} byte in ${chunk.pezzi} pezzi, primo a ${chunk.primoA} ms` : '0 byte — bufferizzato')

let ws = { n: 0, primoA: null }
try {
  const { default: WebSocket } = await import('ws')
  const sock = new WebSocket(base.replace(/^http/, 'ws') + '/api/ws')
  const t0 = Date.now()
  await new Promise(fine => {
    sock.on('message', () => { ws.n++; ws.primoA ??= Date.now() - t0 })
    sock.on('error', fine)
    setTimeout(() => { try { sock.close() } catch {} ; fine() }, SECONDI * 1000)
  })
  esito('WebSocket', ws.n > 0, ws.n > 0 ? `${ws.n} messaggi, primo a ${ws.primoA} ms` : 'nessun messaggio')
} catch { esito('WebSocket', false, '`ws` non installato — `npm install`') }

const streamOk = sse.byte > 0
console.log(streamOk
  ? '\n  Gli stream passano: SSE regge, e il daemon non va toccato.\n'
  : `\n  Gli stream NON passano${ws.n > 0 ? ', ma il WebSocket si\'' : ''}. Con questo trasporto SSE non e' utilizzabile:
  vorrebbe dire riaprire «HTTP + SSE, non WebSocket» contro la premessa con cui fu chiusa.\n`)
