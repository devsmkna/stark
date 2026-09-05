// La prova del tunnel, in-process: l'hub vero (cloud/src/tunnel.ts), il client vero
// (src/daemon/tunnel.ts), e in mezzo un daemon finto che risponde cose note. Niente
// Postgres: l'auth è iniettata, che è il motivo per cui è iniettabile.
//
//   node tools/tunnel-cloud-check.ts
//
// Cosa si prova, e perché proprio questo:
//   1. una richiesta con `?m=<slug>` arriva al daemon giusto, SENZA la `m` nel
//      percorso, e la risposta pianta il cookie d'instradamento;
//   2. la stessa richiesta col solo cookie arriva lo stesso (è la visita dopo);
//   3. una SSE attraversa il tunnel **mentre nasce**: si misurano i tempi d'arrivo
//      dei pezzi, non il loro numero — un proxy che bufferizza li consegna tutti,
//      solo tutti insieme alla fine (stessa lezione di `npm run tunnel`);
//   4. un corpo da 1 MB fa il giro intero e torna della misura giusta;
//   5. un token sbagliato NON entra: la prova che guarda il posto giusto è
//      `collegate` sull'hub, non l'assenza di un errore sul client;
//   6. **il dirottamento non funziona** (card #25): un secondo utente con lo STESSO
//      machine-id ottiene un ALTRO slug, e lo slug del primo continua a instradare
//      verso il primo — la chiave è derivata dall'identità, non dichiarata;
//   7. lo slug non è il machine-id: il QR non lo espone più;
//   8. senza macchina → 404; macchina sconosciuta → 502;
//   9. il freno per IP scatta sul martellamento dell'accoppiamento (per ultimo,
//      perché da lì in poi 127.0.0.1 è bruciato per un minuto).

import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TunnelHub } from '../cloud/src/tunnel.ts'
import { creaTunnel } from '../src/daemon/tunnel.ts'

let falliti = 0
function ok(cond: boolean, nome: string, dettaglio = ''): void {
  if (cond) console.log(`  ✓ ${nome}`)
  else { falliti++; console.error(`  ✗ ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`) }
}
const attendi = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Un daemon finto che si firma: serve a vedere DOVE una richiesta è atterrata. */
function fintoDaemon(firma: string): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/eco') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        firma, method: req.method, path: req.url,
        host: req.headers.host ?? null, cookie: req.headers.cookie ?? null,
      }))
      return
    }
    if (url.pathname === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      let n = 0
      const t = setInterval(() => {
        n++
        res.write(`data: evento-${n}\n\n`)
        if (n === 3) { clearInterval(t); res.end() }
      }, 120)
      return
    }
    if (url.pathname === '/grande') {
      let totale = 0
      req.on('data', (d: Buffer) => { totale += d.length })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ricevuti: totale }))
      })
      return
    }
    res.writeHead(404); res.end()
  })
}

const daemon1 = fintoDaemon('uno')
const daemon2 = fintoDaemon('due')
await new Promise<void>(r => daemon1.listen(0, '127.0.0.1', r))
await new Promise<void>(r => daemon2.listen(0, '127.0.0.1', r))
const porta1 = (daemon1.address() as { port: number }).port
const porta2 = (daemon2.address() as { port: number }).port

// ── l'hub, con l'auth iniettata: due utenti veri, un impostore ───────────────
const hub = new TunnelHub(async t => (
  t === 'tok-buono' ? { id: 'utente-1' } : t === 'tok-secondo' ? { id: 'utente-2' } : null
))
const fronte = createServer((req, res) => {
  if (!hub.handleRequest(req, res)) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'nessuna macchina indicata' }))
  }
})
fronte.on('upgrade', (req, socket, head) => {
  if ((req.url ?? '').split('?')[0] === '/connect') { void hub.handleUpgrade(req, socket, head); return }
  socket.destroy()
})
await new Promise<void>(r => fronte.listen(0, '127.0.0.1', r))
const portaFronte = (fronte.address() as { port: number }).port
const base = `http://127.0.0.1:${portaFronte}`
const wsUrl = `ws://127.0.0.1:${portaFronte}/connect`

// ── il client vero ───────────────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'stark-tunnel-check-'))
const client = creaTunnel({
  home, porta: () => porta1, accesa: () => true, wsUrl, token: () => 'tok-buono',
})
for (let i = 0; i < 50 && !client.stato().connesso; i++) await attendi(100)
ok(client.stato().connesso, 'il client si collega all\'hub')
ok(hub.collegate === 1, 'l\'hub vede una macchina collegata', `collegate=${hub.collegate}`)

const slug1 = new URL(client.stato().pairUrl).searchParams.get('m') ?? ''
const chiaveMacchina = readFileSync(join(home, 'machine-id'), 'utf8').trim()
ok(/^[0-9a-f]{16}$/.test(slug1), 'lo slug è quello derivato dall\'hub (16 esadecimali)', slug1)
ok(slug1 !== chiaveMacchina, 'il QR non espone più il machine-id')

// 1. instradamento con ?m= e cookie piantato
{
  const r = await fetch(`${base}/eco?x=1&m=${slug1}`)
  const corpo = await r.json() as { path: string }
  const cookie = r.headers.get('set-cookie') ?? ''
  ok(r.status === 200, 'con ?m= si arriva al daemon')
  ok(corpo.path === '/eco?x=1', 'la m sparisce dal percorso che il daemon vede', corpo.path)
  ok(cookie.includes(`stark-m=${slug1}`), 'la risposta pianta il cookie d\'instradamento', cookie)
  ok(cookie.includes('Secure') && cookie.includes('SameSite=Lax'), 'il cookie ha gli attributi giusti')
}

// 2. instradamento col solo cookie
{
  const r = await fetch(`${base}/eco`, { headers: { cookie: `stark-m=${slug1}` } })
  ok(r.status === 200, 'col solo cookie si arriva lo stesso')
}

// 3. la SSE attraversa mentre nasce
{
  const r = await fetch(`${base}/sse?m=${slug1}`)
  const tempi: number[] = []
  const inizio = Date.now()
  const reader = r.body!.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
    tempi.push(Date.now() - inizio)
  }
  const scarto = tempi.length >= 2 ? (tempi.at(-1) ?? 0) - (tempi[0] ?? 0) : 0
  ok(scarto >= 150, 'la SSE arriva a pezzi, non tutta alla fine', `pezzi=${tempi.length} scarto=${scarto}ms`)
}

// 4. un corpo grande fa il giro intero
{
  const corpo = Buffer.alloc(1024 * 1024, 7)
  const r = await fetch(`${base}/grande?m=${slug1}`, { method: 'POST', body: corpo })
  const j = await r.json() as { ricevuti: number }
  ok(j.ricevuti === corpo.length, 'un corpo da 1 MB torna della misura giusta', `ricevuti=${j.ricevuti}`)
}

// 5. un token sbagliato non entra
{
  const homeCattivo = mkdtempSync(join(tmpdir(), 'stark-tunnel-check-'))
  const intruso = creaTunnel({
    home: homeCattivo, porta: () => porta1, accesa: () => true, wsUrl, token: () => 'tok-cattivo',
  })
  await attendi(1_200)
  ok(!intruso.stato().connesso, 'un token sbagliato non si collega')
  ok(hub.collegate === 1, 'l\'hub continua a vedere UNA macchina', `collegate=${hub.collegate}`)
  intruso.ferma()
  rmSync(homeCattivo, { recursive: true, force: true })
}

// 6-7. il dirottamento non funziona: stesso machine-id, altro utente → altro slug
{
  const homeDue = mkdtempSync(join(tmpdir(), 'stark-tunnel-check-'))
  // L'attaccante conosce il machine-id della vittima: lo scrive pari pari nel suo.
  writeFileSync(join(homeDue, 'machine-id'), `${chiaveMacchina}\n`)
  const secondo = creaTunnel({
    home: homeDue, porta: () => porta2, accesa: () => true, wsUrl, token: () => 'tok-secondo',
  })
  for (let i = 0; i < 50 && !secondo.stato().connesso; i++) await attendi(100)
  ok(secondo.stato().connesso, 'il secondo utente si collega (è un utente valido)')
  ok(hub.collegate === 2, 'le macchine collegate sono DUE, non una sovrascritta', `collegate=${hub.collegate}`)
  const slug2 = new URL(secondo.stato().pairUrl).searchParams.get('m') ?? ''
  ok(slug2 !== slug1, 'stesso machine-id + altro utente = ALTRO slug', slug2)
  const r1 = await fetch(`${base}/eco?m=${slug1}`)
  const r2 = await fetch(`${base}/eco?m=${slug2}`)
  const f1 = (await r1.json() as { firma: string }).firma
  const f2 = (await r2.json() as { firma: string }).firma
  ok(f1 === 'uno', 'lo slug della vittima instrada ANCORA verso la vittima', f1)
  ok(f2 === 'due', 'lo slug dell\'altro instrada verso l\'altro', f2)
  secondo.ferma()
  rmSync(homeDue, { recursive: true, force: true })
}

// 8. i casi senza strada
{
  const r1 = await fetch(base)
  ok(r1.status === 404, 'senza macchina → 404', String(r1.status))
  const r2 = await fetch(`${base}/eco?m=0123456789abcdef`)
  ok(r2.status === 502, 'macchina sconosciuta → 502', String(r2.status))
  const testo = await r2.text()
  ok(testo.includes('S T A R K'), 'e la pagina è quella umana, nello stile di STARK')
}

// 9. il freno scatta (per ultimo: brucia l'IP per un minuto)
{
  let l429 = 0
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${base}/pair?m=${slug1}`)
    if (r.status === 429) l429++
    await r.arrayBuffer()
  }
  ok(l429 > 0, 'il martellamento dell\'accoppiamento incontra il 429', `429=${l429}/30`)
}

// ── chiusura ─────────────────────────────────────────────────────────────────
client.ferma()
hub.chiudi()
daemon1.close()
daemon2.close()
fronte.close()
rmSync(home, { recursive: true, force: true })

if (falliti > 0) { console.error(`\n${falliti} prove fallite`); process.exit(1) }
console.log('\ntutte le prove passano')
process.exit(0)
