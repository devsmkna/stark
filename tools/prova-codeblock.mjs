// Il blocco di codice si veste allo stesso modo dovunque `renderMarkdown` lo produca?
//
// Nasce dal difetto segnalato con uno screenshot (28 agosto 2026): nel pannello del
// piano il bottone «Copy» era quello **di default del browser** — riquadro bordato,
// font di sistema — perché tutta la veste stava nello scoped di `Conversation.svelte`,
// sotto `.prose`, e il piano non e' dentro `.prose`.
//
// Journal finto, casa in /tmp, porta effimera: non tocca ne' le conversazioni vere ne'
// il daemon acceso. Costo zero di quota — nessun processo agent, nessun turno.
//
//   node tools/prova-codeblock.mjs            misura e stampa
//   node tools/prova-codeblock.mjs foto.png   misura e fotografa
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-codeblock')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA
process.env['STARK_PORT'] = '0'
process.env['STARK_TOKEN'] = 'c0debl0c'.repeat(8)

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const righe = []
let seq = 0
const t0 = Date.now() - 600_000
const ev = (payload, dt = 0) => {
  seq += 1
  righe.push(JSON.stringify({ v: 1, seq, ts: t0 + dt, sessionId: id, payload }))
}

const FENCE = ['```bash', 'npm run stark', 'echo "due righe, per avere un blocco vero"', '```'].join('\n')

ev({ k: 'session.state', state: 'starting' })
ev({ k: 'session.created', agent: 'claude-code', cwd: process.cwd(), model: 'claude-opus-5[1m]',
  capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
    permissionAlways: true, questions: true, revert: false, toolProgress: false,
    fileBrowser: false, pty: false }, tools: [], commands: [] })

// 1. Il caso che funzionava: markdown nel flusso, dentro `.prose`.
ev({ k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: 'fammi vedere un comando' }] }, 1000)
ev({ k: 'text.started', partId: 'p1' }, 1000)
ev({ k: 'text.ended', partId: 'p1', text: `Ecco il comando:\n\n${FENCE}\n` }, 1000)
ev({ k: 'turn.ended', turnId: 't1', reason: 'completed' }, 1000)

// 2. Il caso rotto: lo stesso markdown dentro il pannello del piano (`.planbody`).
ev({ k: 'turn.started', turnId: 't2', prompt: [{ type: 'text', text: 'proponi un piano' }] }, 2000)
ev({ k: 'plan.proposed', requestId: 'r1',
  plan: `## Il piano\n\nPrima si lancia:\n\n${FENCE}\n\npoi si guarda cosa succede.\n` }, 2000)
// Il piano si approva: cosi' viene **riletto nel flusso** dentro `.planread`, che e'
// l'altro contenitore fuori da `.prose` e non richiede una chat viva. Il pannello vero
// (`.planbody`, quello dello screenshot) usa la stessa identica regola globale, ma
// compare solo con un processo dietro — e aprirne uno qui costerebbe un handshake senza
// aggiungere niente alla domanda.
ev({ k: 'plan.replied', requestId: 'r1', decision: 'approved', mode: 'acceptEdits' }, 2000)
ev({ k: 'turn.ended', turnId: 't2', reason: 'completed' }, 2000)
ev({ k: 'session.state', state: 'stopped' }, 2000)

writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')

const { startDaemon } = await import('../src/daemon/server.ts')
const d = await startDaemon({ port: 0 })
const url = `${d.url}/chat/${id}?token=${d.token}`
console.log('journal:', CASA)
console.log('url:    ', url)

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
// `DARK=1` per il tema scuro: il difetto e' stato segnalato da li, e un bottone che
// ricade sul default del browser si nota di piu' su fondo scuro.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 },
  colorScheme: process.env['DARK'] ? 'dark' : 'light' })
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(1200)
// Il turno va aperto: nel flusso i turni nascono richiusi.
// **Non** si clicca su tutti i turni: l'ultimo nasce gia' aperto, e un clic lo
// chiuderebbe. Misurato ispezionando il DOM prima di toccarlo — indovinare qui costava
// un giro, ed e' la stessa lezione del «guardare il posto sbagliato».
await page.click('.turn:first-child .thmain').catch(() => {})   // il turno col testo
await page.waitForTimeout(400)
await page.click('.row.answer').catch(() => {})                  // apre il piano riletto
await page.waitForTimeout(400)

const misura = await page.evaluate(() => {
  const leggi = (sel) => {
    const b = document.querySelector(sel)
    if (!b) return { trovato: false }
    const c = getComputedStyle(b)
    const pre = b.closest('.codeblock')?.querySelector('pre')
    const cp = pre ? getComputedStyle(pre) : null
    return {
      trovato: true,
      bordo: c.borderTopWidth, sfondo: c.backgroundColor, colore: c.color,
      corpo: c.fontSize, font: c.fontFamily.split(',')[0].trim(),
      preSfondo: cp?.backgroundColor ?? null, preBordo: cp?.borderTopWidth ?? null,
      preRaggio: cp?.borderBottomLeftRadius ?? null,
    }
  }
  return {
    prose: leggi('.prose .copybtn'),
    piano: leggi('.planread .copybtn'),
  }
})

console.log('\n' + '='.repeat(74))
for (const [dove, m] of Object.entries(misura)) {
  if (!m.trovato) { console.log(`${dove.padEnd(8)} NON TROVATO`); continue }
  console.log(`${dove.padEnd(8)} bordo=${m.bordo.padEnd(6)} sfondo=${m.sfondo.padEnd(22)} corpo=${m.corpo.padEnd(7)} font=${m.font}`)
  console.log(`${''.padEnd(8)} pre: sfondo=${String(m.preSfondo).padEnd(22)} bordo=${String(m.preBordo).padEnd(6)} raggio=${m.preRaggio}`)
}
const p = misura.prose, q = misura.piano
const uguali = p.trovato && q.trovato && p.bordo === q.bordo && p.corpo === q.corpo
  && p.font === q.font && p.preSfondo === q.preSfondo && p.preBordo === q.preBordo
console.log('-'.repeat(74))
console.log(uguali
  ? 'OK   il blocco si veste uguale nei due posti'
  : 'ROTT il pannello del piano NON ha la stessa veste del flusso')

const foto = process.argv[2]
if (foto) { await page.screenshot({ path: foto, fullPage: false }); console.log('foto:', foto) }
await browser.close()
await d.stop()
process.exit(uguali ? 0 : 1)
