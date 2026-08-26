// Sonda «continua da telefono»: misura cosa sa fare un telefono vero.
//
// Perche' esiste. Dal PC non si puo' dedurre nulla di utile: il contesto sicuro, il
// Service Worker e il Web Push dipendono da *quale* browser su *quale* sistema, e le
// risposte a memoria si sono gia' rivelate sbagliate una volta (vedi la pagina Notion
// «Continua da telefono», §4: `Version/27.0` letto come firma di Safari vero, e invece
// era il browser interno di Telegram).
//
// NON espone STARK. E' un server a se': non legge journal, non parla col daemon, non
// conosce il token. Si accende, ci si punta un tunnel, si guarda dal telefono, si spegne.
//
//   npm run sonda                     # poi punta un tunnel su 127.0.0.1:4610
//   node tools/sonda-telefono/prova-trasporto.mjs <url>   # misura SSE/chunked/WebSocket
//
// La regola che ha reso utile questa sonda, e da non perdere rifacendola: **misura piu'
// stati, non un si'/no**. Con il solo `serviceWorker:false` la conclusione sarebbe stata
// «iOS non puo'», ed era falsa. Sono le tre righe a confronto che dicono quale causa fosse.
import http from 'node:http'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { deflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'

const QUI = dirname(fileURLToPath(import.meta.url))
const PORTA = Number(process.env['SONDA_PORT'] ?? 4610)
// Lo stato sta in /tmp e non nel repo: un'iscrizione push vale per *quel* telefono e
// *quell'indirizzo*, quindi muore col tunnel. Conservarla sarebbe conservare spazzatura.
const STATO = resolve(tmpdir(), 'stark-sonda-telefono.json')

let webpush
try { webpush = (await import('web-push')).default } catch {
  console.error('\n  Manca `web-push`. E\' in devDependencies: lancia `npm install`.\n'); process.exit(1)
}

// Il `sub` della VAPID non e' burocrazia: Apple valida che sia un'email o un URL veri, e
// rifiuta con 403 BadJwtToken un dominio finto come "@localhost" o "@stark.local" — bug
// misurato dal vivo (vedi Notion "Continua da telefono" §3) e documentato anche altrove
// (github.com/openclaw/openclaw#83134, stesso sintomo su un'altra codebase). Si prova a
// riusare l'hostname vero della tailnet, che nello stesso issue risulta accettato da Apple;
// senza tailscale si avvisa che il push su iPhone non funzionera', invece di fallire muto.
const vapidSubject = process.env['SONDA_VAPID_SUBJECT'] ?? (() => {
  try {
    const j = JSON.parse(execFileSync('tailscale', ['status', '--json'], { timeout: 2000 }))
    const dns = j.Self?.DNSName?.replace(/\.$/, '')
    if (dns) return `https://${dns}`
  } catch {}
  console.log('\n  ATTENZIONE: nessun hostname tailscale trovato per il sub della VAPID.\n' +
    '  Uso un dominio finto: Apple lo rifiutera' + "'" + ' con 403 BadJwtToken, quindi su\n' +
    '  iPhone il push non arrivera\'. Imposta SONDA_VAPID_SUBJECT=mailto:tuo@indirizzo\n' +
    '  o https://un-host-vero per farlo funzionare.\n')
  return 'mailto:sonda@stark.local'
})()

const stato = existsSync(STATO) ? JSON.parse(readFileSync(STATO, 'utf8'))
  : { vapid: webpush.generateVAPIDKeys(), subs: [], log: [] }
const salva = () => writeFileSync(STATO, JSON.stringify(stato, null, 1))
webpush.setVapidDetails(vapidSubject, stato.vapid.publicKey, stato.vapid.privateKey)
console.log(`  VAPID sub: ${vapidSubject}`)
salva()

const T0 = Date.now()
const nota = (tipo, dati = {}) => {
  const r = { t: new Date().toISOString(), ms: Date.now() - T0, tipo, ...dati }
  stato.log.push(r); salva()
  console.log(`  ${String(r.ms).padStart(7)}ms  ${tipo.padEnd(26)} ${JSON.stringify(dati).slice(0, 220)}`)
}

const corpo = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)) })
const json = (res, o, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o))
}

// Icona generata a memoria: iOS non considera installabile un sito senza, ma un PNG
// binario nel repo per una sonda sarebbe peso senza motivo.
const ICONA = (() => {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) } return ~c >>> 0 }
  const pezzo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const S = 192, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((S * 3 + 1) * S)
  for (let y = 0; y < S; y++) { const o = y * (S * 3 + 1); raw[o] = 0
    for (let x = 0; x < S; x++) { raw[o + 1 + x * 3] = 17; raw[o + 2 + x * 3] = 17; raw[o + 3 + x * 3] = 17 } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pezzo('IHDR', ihdr),
    pezzo('IDAT', deflateSync(raw)), pezzo('IEND', Buffer.alloc(0))])
})()

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname

  if (p === '/icona.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(ICONA) }
  if (p === '/api/vapid') return json(res, { key: stato.vapid.publicKey })

  if (p === '/api/sub' && req.method === 'POST') {
    const sub = JSON.parse(await corpo(req))
    stato.subs = stato.subs.filter(s => s.endpoint !== sub.endpoint).concat(sub)
    nota('iscrizione', { servizio: new URL(sub.endpoint).host })
    return json(res, { ok: true, totale: stato.subs.length })
  }

  if (p === '/api/log' && req.method === 'POST') {
    const d = JSON.parse(await corpo(req)); nota(d.tipo ?? 'nota', d); return json(res, { ok: true })
  }

  // Push ritardato: fai partire, blocca lo schermo, metti via il telefono. E' l'unico
  // modo di provare la domanda vera — «mi chiama mentre non guardo?».
  if (p === '/api/push') {
    const fra = Number(url.searchParams.get('delay') ?? 30)
    nota('push-programmato', { fra, destinatari: stato.subs.length })
    setTimeout(async () => {
      for (const s of stato.subs) {
        try {
          // Contenuto vuoto per scelta, non per pigrizia: esce CHE e' successo, mai COSA.
          // Il Service Worker legge il resto dal daemon dopo essersi svegliato — ed e'
          // proprio quella `fetch` che questa sonda ha dimostrato possibile su iPhone.
          await webpush.sendNotification(s, JSON.stringify({ quando: Date.now() }), { TTL: 120 })
          nota('push-inviato', { servizio: new URL(s.endpoint).host })
        } catch (e) {
          // statusCode da solo non dice perche': un 403 di web-push arriva con un corpo
          // che di solito spiega la causa vera (VAPID scaduto, sub morta, chiave sbagliata).
          nota('push-fallito', { errore: String(e.statusCode ?? e.message), corpo: e.body ? String(e.body).slice(0, 300) : undefined, headers: e.headers })
        }
      }
    }, fra * 1000)
    return json(res, { ok: true, fra })
  }

  // SSE con la stessa forma di quello di STARK: battito, `id:` progressivo, ripresa da `?from=`.
  if (p === '/api/sse') {
    const chi = url.searchParams.get('chi') ?? '?'
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(': collegato\n\n')
    nota('sse-aperto', { chi })
    let n = 0; const da = Date.now()
    const tic = setInterval(() => { n++; res.write(`id: ${n}\nevent: tic\ndata: ${JSON.stringify({ n, t: Date.now() })}\n\n`) }, 2000)
    let chiuso = false
    const chiudi = () => { if (chiuso) return; chiuso = true; clearInterval(tic)
      nota('sse-chiuso', { chi, durata_s: Math.round((Date.now() - da) / 1000), tic: n }) }
    req.on('close', chiudi); req.on('error', chiudi)
    return
  }

  // Diagnostica del proxy: se anche questo arriva a 0 byte, non e' una stranezza di
  // `text/event-stream` — il proxy bufferizza qualunque risposta in streaming.
  if (p === '/api/chunked') {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
    let n = 0
    const tic = setInterval(() => { n++; res.write(`riga ${n} @ ${Date.now()}\n`) }, 2000)
    req.on('close', () => clearInterval(tic))
    return
  }

  if (p === '/api/risultati') return json(res, stato.log)
  if (p === '/api/azzera') { stato.log = []; salva(); return json(res, { ok: true }) }

  const file = resolve(QUI, 'public', p === '/' ? 'index.html' : p.slice(1))
  if (!file.startsWith(resolve(QUI, 'public') + '/') || !existsSync(file)) { res.writeHead(404); return res.end('no') }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
})

// WebSocket sullo stesso server e sulla stessa porta: un tunnel solo da puntare.
try {
  const { WebSocketServer } = await import('ws')
  const wss = new WebSocketServer({ server, path: '/api/ws' })
  wss.on('connection', ws => {
    nota('ws-aperto'); let n = 0
    const tic = setInterval(() => ws.send(JSON.stringify({ n: ++n, t: Date.now() })), 2000)
    ws.on('close', () => { clearInterval(tic); nota('ws-chiuso', { messaggi: n }) })
  })
} catch { console.log('  (`ws` non installato: la prova WebSocket non c\'e\'. `npm install`)') }

server.listen(PORTA, '127.0.0.1', () => {
  console.log(`
  Sonda su http://127.0.0.1:${PORTA} — STARK non c'entra e non e' esposto.

  1. puntaci un tunnel HTTPS (serve un contesto sicuro: in http il telefono
     non ha ne' Service Worker ne' notifiche — misurato, vedi Notion §3)
  2. apri l'indirizzo dal telefono IN SAFARI/CHROME, non dal browser interno
     di un'app di messaggistica: li' Service Worker e notifiche non esistono
  3. su iPhone: Condividi -> Aggiungi a Home, e riapri DALL'ICONA. Le notifiche
     esistono solo cosi'
  4. i risultati arrivano qui sotto da soli, e su GET /api/risultati
`)
})
