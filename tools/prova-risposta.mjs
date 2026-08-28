// «Scrivo in "Type in your answer", premo invio, e non succede nulla» — segnalato il
// 28 agosto 2026 su una sessione in modalita' plan.
//
// Il sintomo ha tre cause possibili e diverse, quindi si guardano tutte e tre invece di
// sceglierne una:
//   1. il tasto arriva al gestore, o qualcuno se lo mangia prima?
//   2. la bozza si aggiorna mentre si scrive (il bottone «Send answer» si accende)?
//   3. parte davvero una richiesta al daemon?
// E si confronta **Invio con il clic sul bottone**: se il bottone manda e Invio no, il
// difetto e' nel gestore del tasto e non altrove.
//
// Costo ZERO di quota: la sessione si apre davvero — il box si monta solo con un
// processo dietro (`Dock.svelte`: `asking = live && pending`) — ma un'apertura e' solo
// l'handshake, nessun turno parte mai. La domanda si consegna dalla stessa porta da cui
// passerebbe se l'agent l'avesse fatta: journal, snapshot, watchers, come `onPayload`.
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-risposta')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

const { startDaemon } = await import('../src/daemon/server.ts')
const { applyTo } = await import('../src/core/reduce.ts')
const daemon = await startDaemon({ port: 0, token: 'risposta'.padEnd(64, '0') })

async function apri(questions, modo) {
  const id = await daemon.registry.open({ cwd: process.cwd() })
  const l = daemon.registry.live.get(id)
  const consegna = (p) => { const e = l.journal.append(p); applyTo(l.snapshot, e); for (const w of l.watchers) w(e) }
  // La modalita' della segnalazione: plan.
  if (modo) consegna({ k: 'session.option', kind: 'mode', value: modo })
  consegna({ k: 'question.asked', requestId: `req-${id}`, questions })
  return id
}

const DOMANDA = [{
  question: 'Quale approccio preferisci per il piano?',
  header: 'Approccio',
  multiSelect: false,
  options: [
    { label: 'Il primo', description: 'la via corta' },
    { label: 'Il secondo', description: 'la via lunga' },
  ],
}]
const idInvio = await apri(DOMANDA, 'plan')
const idClic = await apri(DOMANDA, 'plan')

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ args: ['--no-sandbox'] })

async function giro(id, comeMando) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errori = []; const poste = []
  page.on('console', m => { if (m.type() === 'error') errori.push(m.text().slice(0, 140)) })
  page.on('pageerror', e => errori.push('pageerror: ' + String(e.message).slice(0, 140)))
  page.on('request', r => { if (r.method() === 'POST') poste.push(r.url().split('/api/')[1] ?? r.url()) })
  await page.goto(`${daemon.url}/chat/${id}?token=${daemon.token}`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)

  const stato = () => page.evaluate(() => {
    const inp = document.querySelector('.qin')
    const send = [...document.querySelectorAll('.qfoot .opt')].find(b => /Send/.test(b.textContent ?? ''))
    return {
      casella: !!inp, valore: inp?.value ?? null,
      send: send ? (send.disabled ? 'spento' : 'acceso') : 'assente',
      refused: document.querySelector('.refused span')?.textContent ?? null,
    }
  })
  const out = { comeMando, prima: await stato() }
  if (!out.prima.casella) { await page.close(); return { ...out, nota: 'box non montato' } }

  // Si registra ogni keydown che arriva alla casella: se il tasto non ci arriva, e' un
  // altro problema da «ci arriva e non fa niente».
  await page.evaluate(() => {
    window.__tasti = []
    document.querySelector('.qin').addEventListener('keydown',
      e => window.__tasti.push({ key: e.key, composing: e.isComposing, defaultPrevented: e.defaultPrevented }))
  })
  await page.click('.qin')
  await page.type('.qin', 'la mia risposta a mano', { delay: 15 })
  await page.waitForTimeout(250)
  out.dopoScritto = await stato()

  const n = poste.length
  if (comeMando === 'Invio') await page.keyboard.press('Enter')
  else await page.click('.qfoot .opt.pri')
  await page.waitForTimeout(900)
  out.dopoMandato = await stato()
  out.postePartite = poste.slice(n)
  out.tasti = await page.evaluate(() => window.__tasti ?? [])
  out.errori = errori.slice(0, 3)
  await page.close()
  return out
}

// ── il caso a due pannelli ────────────────────────────────────────────────────
// `Conversation` riceve l'id della propria chat, ma a `Dock` passa solo `snap` e `live`:
// l'id si perde, e `Ask` manda con `store.send(cmd)`, che ricade su `store.selected` —
// cioe' sul pannello **a fuoco**. Con due chat affiancate, rispondere in quella non a
// fuoco dovrebbe mandare la risposta all'altra.
//
// Il layout si semina in `localStorage` invece di trascinare una riga: il trascinamento
// HTML5 in un browser pilotato e' fragile, e qui interessa lo stato, non il gesto.
async function dueRiquadri() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  const poste = []
  page.on('request', r => {
    if (r.method() !== 'POST') return
    const m = /\/api\/sessions\/([^/]+)\/command/.exec(r.url())
    if (m) poste.push({ verso: m[1], corpo: (() => { try { return JSON.parse(r.postData() ?? '{}').c } catch { return '?' } })() })
  })
  await page.goto(`${daemon.url}/?token=${daemon.token}`, { waitUntil: 'load' })
  await page.evaluate(([a, b]) => {
    localStorage.setItem('stark.layout', JSON.stringify({
      tree: { type: 'split', dir: 'row', sizes: [0.5, 0.5],
        children: [{ type: 'leaf', paneId: a }, { type: 'leaf', paneId: b }] },
      // A fuoco la PRIMA; si rispondera' nella seconda.
      focused: a,
    }))
  }, [idInvio, idClic])
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2200)

  const quanti = await page.evaluate(() => ({
    pannelli: document.querySelectorAll('.pane').length,
    caselle: document.querySelectorAll('.qin').length,
  }))
  if (quanti.pannelli < 2 || quanti.caselle < 2) { await page.close(); return { ...quanti, nota: 'non affiancati' } }

  // Si scrive nella casella del pannello di DESTRA (la seconda chat), senza toccare
  // prima l'intestazione: cliccare la casella non deve per forza spostare il fuoco.
  const dest = page.locator('.qin').nth(1)
  await dest.click(); await dest.type('risposta del pannello di destra', { delay: 12 })
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const esito = await page.evaluate(() => ({
    refused: document.querySelector('.refused span')?.textContent ?? null,
    valori: [...document.querySelectorAll('.qin')].map(i => i.value),
  }))
  await page.close()
  return { ...quanti, poste, ...esito }
}
const due = await dueRiquadri()
console.log('\n' + '='.repeat(70))
console.log('DUE PANNELLI — a fuoco il primo, si risponde nel secondo')
console.log('  chat a fuoco :', idInvio.slice(0, 8), ' chat in cui si risponde:', idClic.slice(0, 8))
console.log('  ', JSON.stringify(due))

for (const [id, come] of [[idInvio, 'Invio'], [idClic, 'clic su Send']]) {
  const r = await giro(id, come)
  console.log('\n' + '='.repeat(70))
  console.log(`MANDATO CON: ${r.comeMando}`)
  if (r.nota) { console.log('  ', r.nota); continue }
  console.log('  prima      ', JSON.stringify(r.prima))
  console.log('  dopo aver scritto', JSON.stringify(r.dopoScritto))
  console.log('  dopo mandato', JSON.stringify(r.dopoMandato))
  console.log('  POST partite', JSON.stringify(r.postePartite))
  console.log('  keydown visti', JSON.stringify(r.tasti.filter(t => t.key === 'Enter')))
  console.log('  errori      ', r.errori.length ? JSON.stringify(r.errori) : 'nessuno')
}
await browser.close(); await daemon.stop(); process.exit(0)
