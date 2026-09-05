// I `#NNN` in chat diventano chip contro la board — chip veri, falsi positivi, click
// (card #31, spec 2026-09-05).
//
// La board del daemon di prova non esiste (nessun `.stark/kanban/` nel cwd finto),
// quindi la si stubba dal browser con `page.route`: sia la rotta a fetch singolo
// (`/api/sessions/*/board`, usata da `Conversation.svelte` per risolvere i chip) sia
// il flusso SSE (`/api/sessions/*/boardstream`, usato da `Board.svelte` per il
// dettaglio dopo il click) — altrimenti la vista Board resterebbe su «Reading…» per
// sempre, perché quella non richiama mai il fetch singolo.
//
// Journal finto, casa in /tmp, porta effimera: non tocca né le conversazioni vere né
// il daemon acceso. Costo zero di quota — nessun processo agent, nessun turno.
//
//   node tools/prova-taskchip.mjs            misura e stampa
//   node tools/prova-taskchip.mjs foto.png   misura e fotografa
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-taskchip')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA
process.env['STARK_PORT'] = '0'
process.env['STARK_TOKEN'] = 't4skch1p'.repeat(8)

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const righe = []
let seq = 0
const t0 = Date.now() - 600_000
const ev = (payload, dt = 0) => {
  seq += 1
  righe.push(JSON.stringify({ v: 1, seq, ts: t0 + dt, sessionId: id, payload }))
}

// I tre casi della spec, in un solo testo: citazione valida, ripetizione + id
// inesistente, e la stessa cifra dentro un fence — dove `#NNN` è contenuto, non
// citazione, e deve restare testo puro anche se la board lo conosce.
const TESTO = [
  'Questa richiesta corrisponde a #12, lo prendo in carico.',
  '',
  "C'entra anche #12 di nuovo, e #999 che non esiste.",
  '',
  '```bash',
  'grep "#12" file.txt',
  '```',
].join('\n')

ev({ k: 'session.state', state: 'starting' })
ev({ k: 'session.created', agent: 'claude-code', cwd: process.cwd(), model: 'claude-opus-5[1m]',
  capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
    permissionAlways: true, questions: true, revert: false, toolProgress: false,
    fileBrowser: false, pty: false }, tools: [], commands: [] })

ev({ k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: 'chi se ne occupa?' }] }, 1000)
ev({ k: 'text.started', partId: 'p1' }, 1000)
ev({ k: 'text.ended', partId: 'p1', text: TESTO }, 1000)
ev({ k: 'turn.ended', turnId: 't1', reason: 'completed' }, 1000)
ev({ k: 'session.state', state: 'stopped' }, 1000)

writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')

const { startDaemon } = await import('../src/daemon/server.ts')
const d = await startDaemon({ port: 0 })
const url = `${d.url}/chat/${id}?token=${d.token}`
console.log('journal:', CASA)
console.log('url:    ', url)

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

// La board fissa dello stub: un solo task, «in-progress», con priorità alta e un
// claim — così la card blocco può mostrare tutti e tre i badge opzionali.
const BOARD = {
  cwd: process.cwd(), assente: false, binarioMancante: false,
  columns: [
    { status: 'in-progress', tasks: [
      { id: 12, title: 'Card permesso orfane', status: 'in-progress', priority: 'high', claimed_by: 'claude' },
    ] },
  ],
}

// Il gate d'accesso (login cloud obbligatorio, spec 2026-09-05): senza uno
// `email` in `/api/cloud/status` la UI resta sulla schermata di login e nessuna
// chat si vede mai. Non è cosa di questa prova — si stubba e via.
await page.route('**/api/cloud/status', r => r.fulfill({
  json: { url: null, email: 'prova@stark.test', server: 'ok' },
}))
await page.route('**/api/sessions/*/board', r => r.fulfill({ json: BOARD }))
// La vista Board non richiama mai il fetch singolo: legge solo il flusso SSE. Senza
// stubbarlo anche lui, il click aprirebbe una board vuota (`dati === null`) e il
// dettaglio non troverebbe mai il task #12 da mostrare.
await page.route('**/api/sessions/*/boardstream', r => r.fulfill({
  status: 200,
  contentType: 'text/event-stream',
  body: `data: ${JSON.stringify(BOARD)}\n\n`,
}))

let falli = 0
const assert = (nome, ok) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}`); if (!ok) falli++ }

await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(1200)
// Il turno nasce già aperto (è l'unico e l'ultimo): niente clic per riaprirlo, come
// documentato in prova-codeblock.mjs — cliccare qui lo chiuderebbe.
await page.waitForSelector('.prose .taskchip', { timeout: 10_000 }).catch(() => {})

const chipCount = await page.locator('.taskchip').count()
assert('due chip per #12, non tre', chipCount === 2)

const primoTitolo = await page.locator('.taskchip .ttl').first().textContent()
assert('il chip porta il titolo dalla board', primoTitolo === 'Card permesso orfane')

const cardCount = await page.locator('.taskcard').count()
assert('una sola card blocco, alla prima citazione', cardCount === 1)

const nessunNoveNoveNove = await page.locator('[data-task="999"]').count() === 0
const proseHaNoveNoveNove = (await page.locator('.prose').first().innerText()).includes('#999')
assert('#999 resta testo', nessunNoveNoveNove && proseHaNoveNoveNove)

const chipNelFence = await page.locator('pre .taskchip').count()
assert('dentro il fence #12 resta testo', chipNelFence === 0)

if (falli > 0) {
  console.log('\ncontenuto .prose:')
  console.log(await page.locator('.prose').first().innerHTML())
}

// Il click: apre la vista Board e il dettaglio del task citato.
await page.locator('.taskchip').first().click()
await page.waitForSelector('.dlg.board', { timeout: 10_000 }).catch(() => {})
await page.waitForSelector('.dt', { timeout: 10_000 }).catch(() => {})

const boardAperta = await page.locator('.dlg.board').count() === 1
assert('il click apre la vista Board', boardAperta)

const dettaglioTitolo = await page.locator('.dt').first().textContent()
assert('il dettaglio mostra il task citato', dettaglioTitolo === 'Card permesso orfane')

if (!boardAperta || dettaglioTitolo !== 'Card permesso orfane') {
  console.log('\ncontenuto dopo il click:')
  console.log(await page.content())
}

console.log('-'.repeat(74))
console.log(falli === 0 ? `OK   tutte le asserzioni passano` : `ROTT ${falli} asserzioni fallite`)

const foto = process.argv[2]
if (foto) { await page.screenshot({ path: foto, fullPage: false }); console.log('foto:', foto) }
await browser.close()
await d.stop()
process.exit(falli === 0 ? 0 : 1)
