// Il difetto segnalato il 30 agosto: nel pannello agente il model picker si apre,
// ma premere una voce chiude il popup senza navigare. Nella status bar invece
// funziona: agent → provider → famiglia → modello.
//
// Perche' questa prova esiste e non basta leggere il codice: i due ospiti del
// ModelPicker differiscono per **quando** guardano il clic — la status bar chiude
// su `pointerdown` (window), il pannello su `click` (document) — e se il gestore
// del pannello vede il target gia' staccato dall'albero, `closest('.ap-pop')`
// torna null e chiude lui il menu che l'utente sta usando. E' un difetto che non
// dà errore da nessuna parte: si vede solo chiedendo al browser in che stato era
// il target quando ciascun gestore l'ha guardato.
//
//   node tools/prova-pannello-agente.mjs
//
// Casa in /tmp e porta effimera. La conversazione dell'elenco si disegna da un
// journal sintetico (quota zero); l'helper del pannello costa un handshake, e il
// catalogo e' quello vero della macchina. Nessun turno di modello.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RADICE = resolve(import.meta.dirname, '..')
const CASA = resolve('/tmp', 'stark-prova-pannello')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

// Un journal minimo: una conversazione finita. Il toggle del pannello sta
// nell'intestazione della conversazione, quindi senza una chat aperta non c'e'.
const id = 'bbbbbbbb-1111-4111-8111-111111111111'
const righe = []
let seq = 0
const t0 = Date.now() - 600_000
const ev = (payload) => {
  seq += 1
  righe.push(JSON.stringify({ v: 1, seq, ts: t0 + seq * 1000, sessionId: id, payload }))
}
ev({ k: 'session.state', state: 'starting' })
ev({ k: 'session.created', agent: 'claude-code', cwd: RADICE, model: 'claude-opus-5[1m]',
  capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
    permissionAlways: true, questions: true, revert: false, toolProgress: false,
    fileBrowser: false, pty: false }, tools: [], commands: [] })
ev({ k: 'session.renamed', title: 'sonda pannello agente' })
ev({ k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: 'una domanda' }] })
ev({ k: 'text.started', partId: 'p1' })
ev({ k: 'text.ended', partId: 'p1', text: 'una risposta' })
ev({ k: 'turn.ended', turnId: 't1', reason: 'completed' })
ev({ k: 'session.state', state: 'idle' })
writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: 'dark' })
p.on('pageerror', e => console.log('[pageerror]', e.message))
p.on('console', m => { if (m.type() === 'error') console.log('[ui-error]', m.text()) })
await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
await p.waitForTimeout(1000)

await p.click('text=sonda pannello agente')
await p.waitForTimeout(600)
await p.click('[aria-label="Toggle agent panel"]')
await p.waitForSelector('.agentpan')
// La tab Chat apre l'helper vero: handshake, nessun turno.
await p.click('.ap-tab:has-text("Chat")')
await p.waitForSelector('.ap-tune')
await p.waitForTimeout(4000)

// Le orecchie: una in cattura su pointerdown e click (prima di ogni gestore), e
// una su click aggiunta **per ultima** — quindi dopo il gestore delegato di
// Svelte e dopo quello del pannello — per vedere in che stato era il target
// quando chi guarda il clic **dopo** i gestori lo ha guardato.
await p.evaluate(() => {
  window.__log = []
  const guarda = (fase) => (e) => {
    const t = e.target
    window.__log.push({
      fase, tipo: e.type,
      target: `${(t.className?.toString?.() ?? '').slice(0, 24)}|${(t.textContent ?? '').trim().slice(0, 24)}`,
      collegato: t.isConnected,
      dentro: !!t.closest?.('.ap-pop, .ap-tune'),
      popEsiste: !!document.querySelector('.ap-pop'),
    })
  }
  document.addEventListener('pointerdown', guarda('pointerdown-cattura'), { capture: true })
  document.addEventListener('click', guarda('click-cattura'), { capture: true })
  document.addEventListener('click', guarda('click-dopo-tutti'))
})

/** Le voci del popup adesso: l'etichetta di ogni riga, per stampare il livello. */
const voci = () => p.evaluate(() =>
  [...document.querySelectorAll('.ap-pop .pk-row, .ap-pop .pk-mrow')]
    .map(x => x.querySelector('.pk-name-1')?.textContent
      ?? x.querySelector('.mname')?.textContent
      ?? x.textContent.trim().slice(0, 30)))

/** Un clic al centro della riga che contiene `testo`: il mouse vero, non un
 *  dispatch sintetico, perche' il difetto sta nella catena vera degli eventi. */
async function premi(testo) {
  const pt = await p.evaluate((t) => {
    const x = [...document.querySelectorAll('.ap-pop .pk-row, .ap-pop .pk-mrow')]
      .find(b => b.textContent.toLowerCase().includes(t.toLowerCase()))
    if (!x) return null
    const r = x.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, testo)
  if (!pt) { console.log(`  (niente voce «${testo}»)`); return false }
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(700)
  const stato = await p.evaluate(() => ({
    pop: !!document.querySelector('.ap-pop'),
    nVoci: document.querySelectorAll('.ap-pop .pk-row, .ap-pop .pk-mrow').length,
  }))
  console.log(`  premuto «${testo}» → popup: ${stato.pop ? 'aperto' : 'CHIUSO'}${stato.pop ? `, ${stato.nVoci} voci` : ''}`)
  return stato.pop
}

console.log('\n— apro il menu dei modelli —')
await p.click('.ap-tune')
// Le righe del picker (`pk-row`/`pk-mrow`): si aspetta un bottone vero, non il
// «Loading models…» che non è cliccabile.
await p.waitForFunction(() =>
  document.querySelectorAll('.ap-pop .pk-row, .ap-pop .pk-mrow').length > 0,
  null, { timeout: 25000 })
console.log('primo livello:', JSON.stringify(await voci()))
await p.screenshot({ path: '/tmp/ap-livello1.png' })

console.log('\n— clic sull\u2019agent OpenCode (quello con provider e famiglie) —')
await p.evaluate(() => { window.__log = [] })  // da qui conta solo questo clic
const live1 = await premi('opencode')
if (live1) console.log('secondo livello:', JSON.stringify(await voci()))
await p.screenshot({ path: '/tmp/ap-livello2.png' })

if (live1) {
  /** Il primo bottone utile del livello: abilitato e senza l'icona «indietro» —
   *  le righe-avviso dell'adapter (`mi.dis`) non si premono e non navigano. */
  const primoUtile = () => p.evaluate(() => {
    // Le righe-avviso non esistono più come `.mi.dis`: qui le righe disabilitate sono
    // solo gli agent spenti (`.pk-row.dis`), e il «back» non è più un bottone a sé
    // ma la riga di navigazione — si salta prendendo solo pk-row/pk-mrow.
    const x = [...document.querySelectorAll('.ap-pop .pk-row:not(.dis), .ap-pop .pk-mrow')][0]
    if (!x) return null
    const r = x.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2,
      testo: x.querySelector('.pk-name-1')?.textContent
        ?? x.querySelector('.mname')?.textContent
        ?? x.textContent.trim().slice(0, 30) }
  })

  console.log('\n— clic sul primo provider —')
  const provider = await primoUtile()
  const live2 = provider ? await premi(provider.testo) : false
  if (live2) console.log('terzo livello:', JSON.stringify(await voci()))
  await p.screenshot({ path: '/tmp/ap-livello3.png' })

  if (live2) {
    console.log('\n— clic sulla prima famiglia —')
    const fam = await primoUtile()
    const live3 = fam ? await premi(fam.testo) : false
    if (live3) console.log('quarto livello:', JSON.stringify((await voci()).slice(0, 8)))
    await p.screenshot({ path: '/tmp/ap-livello4.png' })

    if (live3) {
      console.log('\n— clic sul primo modello (cambia davvero chat) —')
      const modello = await primoUtile()
      if (modello) await premi(modello.testo)
      await p.waitForTimeout(6000)
      const fine = await p.evaluate(() => ({
        chip: document.querySelector('.ap-tune .mname')?.textContent ?? null,
        pop: !!document.querySelector('.ap-pop'),
        avvio: !!document.querySelector('.ap-empty'),
      }))
      console.log('dopo la scelta:', JSON.stringify(fine))
      await p.screenshot({ path: '/tmp/ap-dopo.png' })
    }
  }
}

console.log('\n— il log del clic su OpenCode, gesto dopo gesto —')
console.log(JSON.stringify(await p.evaluate(() => window.__log), null, 1))

await b.close()
await s.stop()
console.log('\nfatto')
