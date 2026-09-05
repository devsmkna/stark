// La prova del tunnel, in-process: l'hub vero (cloud/src/tunnel.ts), il client vero
// (src/daemon/tunnel.ts), e in mezzo un daemon finto che risponde cose note. Niente
// Postgres: l'auth è iniettata, che è il motivo per cui è iniettabile.
//
//   node tools/tunnel-cloud-check.ts
//
// Cosa si prova, e perché proprio questo:
//   1. una richiesta con `?m=` arriva al daemon giusto, SENZA la `m` nel percorso, e
//      la risposta pianta il cookie d'instradamento;
//   2. la stessa richiesta col solo cookie arriva lo stesso (è la visita dopo);
//   3. una SSE attraversa il tunnel **mentre nasce**: si misurano i tempi d'arrivo
//      dei pezzi, non il loro numero — un proxy che bufferizza li consegna tutti,
//      solo tutti insieme alla fine (stessa lezione di `npm run tunnel`);
//   4. un corpo da 1 MB fa il giro intero e torna della misura giusta;
//   5. un token sbagliato NON entra: la prova che guarda il posto giusto è
//      `collegate` sull'hub, non l'assenza di un errore sul client;
//   6. senza macchina → 404; macchina sconosciuta → 502.

import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
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

// ── il daemon finto ──────────────────────────────────────────────────────────
const daemon = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/eco') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      method: req.method, path: req.url,
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
await new Promise<void>(r => daemon.listen(0, '127.0.0.1', r))
const portaDaemon = (daemon.address() as { port: number }).port

// ── l'hub, con l'auth iniettata ──────────────────────────────────────────────
const hub = new TunnelHub(async t => (t === 'tok-buono' ? 'utente@test' : null))
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

// ── il client vero ───────────────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'stark-tunnel-check-'))
const client = creaTunnel({
  home, porta: () => portaDaemon, accesa: () => true,
  wsUrl: `ws://127.0.0.1:${portaFronte}/connect`, token: () => 'tok-buono',
})
for (let i = 0; i < 50 && !client.stato().connesso; i++) await attendi(100)
ok(client.stato().connesso, 'il client si collega all\'hub')
ok(hub.collegate === 1, 'l\'hub vede una macchina collegata', `collegate=${hub.collegate}`)

const macchina = new URL(client.stato().pairUrl).searchParams.get('m') ?? ''
ok(macchina.length > 0, 'il pairUrl porta la macchina')

// 1. instradamento con ?m= e cookie piantato
{
  const r = await fetch(`${base}/eco?x=1&m=${macchina}`)
  const corpo = await r.json() as { path: string }
  const cookie = r.headers.get('set-cookie') ?? ''
  ok(r.status === 200, 'con ?m= si arriva al daemon')
  ok(corpo.path === '/eco?x=1', 'la m sparisce dal percorso che il daemon vede', corpo.path)
  ok(cookie.includes(`stark-m=${macchina}`), 'la risposta pianta il cookie d\'instradamento', cookie)
  ok(cookie.includes('Secure') && cookie.includes('SameSite=Lax'), 'il cookie ha gli attributi giusti')
}

// 2. instradamento col solo cookie
{
  const r = await fetch(`${base}/eco`, { headers: { cookie: `stark-m=${macchina}` } })
  ok(r.status === 200, 'col solo cookie si arriva lo stesso')
}

// 3. la SSE attraversa mentre nasce
{
  const r = await fetch(`${base}/sse?m=${macchina}`)
  const tempi: number[] = []
  const inizio = Date.now()
  const reader = r.body!.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
    tempi.push(Date.now() - inizio)
  }
  // Tre eventi a 120 ms: se arrivano in streaming, fra il primo e l'ultimo pezzo
  // passano almeno ~200 ms. Se un buffer li consegna insieme, lo scarto è ~0.
  const scarto = tempi.length >= 2 ? (tempi.at(-1) ?? 0) - (tempi[0] ?? 0) : 0
  ok(scarto >= 150, 'la SSE arriva a pezzi, non tutta alla fine', `pezzi=${tempi.length} scarto=${scarto}ms`)
}

// 4. un corpo grande fa il giro intero
{
  const corpo = Buffer.alloc(1024 * 1024, 7)
  const r = await fetch(`${base}/grande?m=${macchina}`, { method: 'POST', body: corpo })
  const j = await r.json() as { ricevuti: number }
  ok(j.ricevuti === corpo.length, 'un corpo da 1 MB torna della misura giusta', `ricevuti=${j.ricevuti}`)
}

// 5. un token sbagliato non entra
{
  const homeCattivo = mkdtempSync(join(tmpdir(), 'stark-tunnel-check-'))
  const intruso = creaTunnel({
    home: homeCattivo, porta: () => portaDaemon, accesa: () => true,
    wsUrl: `ws://127.0.0.1:${portaFronte}/connect`, token: () => 'tok-cattivo',
  })
  await attendi(1_200)
  ok(!intruso.stato().connesso, 'un token sbagliato non si collega')
  ok(hub.collegate === 1, 'l\'hub continua a vedere UNA macchina', `collegate=${hub.collegate}`)
  intruso.ferma()
  rmSync(homeCattivo, { recursive: true, force: true })
}

// 6. i casi senza strada
{
  const r1 = await fetch(base)
  ok(r1.status === 404, 'senza macchina → 404', String(r1.status))
  const r2 = await fetch(`${base}/eco?m=non-esiste`)
  ok(r2.status === 502, 'macchina sconosciuta → 502', String(r2.status))
  const testo = await r2.text()
  ok(testo.includes('S T A R K'), 'e la pagina è quella umana, nello stile di STARK')
}

// ── chiusura ─────────────────────────────────────────────────────────────────
client.ferma()
hub.chiudi()
daemon.close()
fronte.close()
rmSync(home, { recursive: true, force: true })

if (falliti > 0) { console.error(`\n${falliti} prove fallite`); process.exit(1) }
console.log('\ntutte le prove passano')
process.exit(0)
