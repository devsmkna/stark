// Il composer a riga singola (DS v10) si misura nel browser vero, non ragionando sul
// CSS — è la regola che ha già evitato due «correzioni» di un difetto inesistente.
// Questa prova apre una sessione OpenCode VIVA (modello gratuito, un turno breve:
// costo zero di quota) e misura quello che il DS promette:
//
//   1. la riga: lead (+) a sinistra, campo pillola, invio a destra — nell'ordine, con
//      le misure del DS (lead 40, campo ≥44, invio 36);
//   2. il menu del lead si apre SOPRA la riga, dentro lo schermo, e le voci si
//      premono davvero (elementFromPoint, non dispatch sintetici);
//   3. il picker: 440px, le colonne numeriche a destra (finestra, costo, stato)
//      ALLINEATE fra le righe — è la promessa per cui il DS passa da 344 a 440;
//   4. l'anello del contesto sul lead esiste e ha una percentuale;
//   5. mentre lavora: sweep sul campo e stop accanto all'invio;
//   6. da stretto (390px) il composer non straripa e il menu diventa foglio.
//
//   node tools/prova-composer-v10.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const RADICE = resolve(import.meta.dirname, '..')
const CASA = mkdtempSync(resolve(tmpdir(), 'stark-composer-'))
mkdirSync(CASA, { recursive: true })
process.env['STARK_HOME'] = CASA

// Il modello: gratuito se c'è, così il turno di misura non costa quota.
const { catalogoModelli } = await import('../src/adapters/opencode/adapter.ts')
const catalogo = await catalogoModelli()
const libero = catalogo.find(m => m.cost && m.cost.input === 0 && m.cost.output === 0)
const MODELLO = libero?.id ?? 'opencode/gpt-5-nano'
console.log(`modello: ${MODELLO}${libero ? ' (gratuito)' : ''}`)

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

// La sessione viva: un processo OpenCode in attesa, nessun turno ancora.
const crea = await fetch(`${s.url}/api/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
  body: JSON.stringify({ cwd: CASA, agent: 'opencode', model: MODELLO }),
})
if (!crea.ok) {
  console.error('sessione non creata:', crea.status, await crea.text())
  process.exit(1)
}
const { id } = await crea.json()
console.log('sessione', id)

const foglio_l = (z, zoom = 1) => z.l - (z.zl + 12 * zoom)
const foglio_r = (z, zoom = 1) => z.r - (z.zr - 12 * zoom)
let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${dettaglio && !ok ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}
const px = (n) => Math.round(n)

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: 'dark' })
p.on('pageerror', e => console.log('[pageerror]', e.message))
p.on('console', m => { if (m.type() === 'error') console.log('[ui-error]', m.text()) })
await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
await p.waitForTimeout(1200)

// Apro la chat: le righe nuove si chiamano «new chat <id8>», non col nome della
// cartella (il titolo arriva dopo, dal rename). Il composer esiste solo su una
// sessione viva.
await p.click(`text=${id.slice(0, 8)}`)
await p.waitForSelector('.composer .lead', { timeout: 15_000 })

// ─── 1. la riga ──────────────────────────────────────────────────────────────
const riga = await p.evaluate(() => {
  const q = (sel) => document.querySelector(sel)
  const r = (sel) => q(sel)?.getBoundingClientRect()
  const lead = r('.composer .lead-wrap')
  const field = r('.composer .field')
  const send = r('.composer .send')
  const input = q('.composer textarea.input')
  return {
    lead: lead && { x: lead.x, y: lead.y, w: lead.width, h: lead.height },
    field: field && { x: field.x, w: field.width, h: field.height },
    send: send && { x: send.x, w: send.width, h: send.height },
    placeholder: input?.placeholder ?? '',
    ordineOk: lead && field && send && lead.x < field.x && field.x < send.x,
  }
})
check('lead a sinistra, campo al centro, invio a destra', riga.ordineOk)
// La scala è quella del resto dell'app (bottoni 30px, voci di menu 10.5px, vecchia
// casella 12.5px), non quella del mockup: due riduzioni chieste dall'utente dopo il
// primo giro alle misure del DS tal quali.
check('lead 32px', riga.lead && px(riga.lead.w) === 32 && px(riga.lead.h) === 32, JSON.stringify(riga.lead))
check('campo 34px', riga.field && px(riga.field.h) === 34, String(riga.field?.h))
check('invio 30px', riga.send && px(riga.send.w) === 30 && px(riga.send.h) === 30, JSON.stringify(riga.send))
check('placeholder col modello', riga.placeholder.startsWith('Message ') && riga.placeholder.length > 9, riga.placeholder)
check('invio spento da vuoto', await p.evaluate(() =>
  document.querySelector('.composer .send')?.classList.contains('off') === true))

// L'anello del contesto: la variabile c'è, anche a zero.
const anello = await p.evaluate(() => {
  const el = document.querySelector('.composer .lead-wrap')
  return el ? getComputedStyle(el).getPropertyValue('--ctx').trim() : null
})
check('anello contesto sul lead', anello !== null && anello !== '', String(anello))

// ─── 2. il menu del lead ─────────────────────────────────────────────────────
const centro = async (sel) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].at(-1)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, sel)

await p.click('.composer .lead')
await p.waitForSelector('.leadbox.popup', { timeout: 3000 })
const menuBox = await p.evaluate(() => {
  const r = document.querySelector('.leadbox.popup')?.getBoundingClientRect()
  return r && { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }
})
check('menu dentro lo schermo', menuBox && menuBox.l >= 0 && menuBox.r <= menuBox.vw && menuBox.t >= 0, JSON.stringify(menuBox))
check('menu sopra il composer', menuBox && menuBox.b <= (await p.evaluate(() =>
  document.querySelector('.composer')?.getBoundingClientRect().top ?? 1e9)))

// Le voci si premono davvero: il centro di «Choose file» tocca la voce, non un velo.
const voce = await centro('.leadbox.popup .pop-item')
const sottoVoce = voce && await p.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y)
  return !!el?.closest('.pop-item')
}, [voce.x, voce.y])
check('le voci del menu sono premibili', sottoVoce === true)

// ─── 3. il picker ────────────────────────────────────────────────────────────
await p.click('.leadbox.popup .pop-item:has-text("Model")')
await p.waitForSelector('.leadbox.picker', { timeout: 3000 })
// Il picker apre al livello AGENTI (L0): per vedere le righe di modello si entra
// nell'agent della chat. E il catalogo arriva dal daemon: misurare prima sarebbe
// misurare il vuoto — la prima stesura di questa sonda l'ha fatto.
await p.waitForFunction(() => document.querySelectorAll('.pk-row').length > 0,
  null, { timeout: 20_000 })
// Si entra prima nell'agent della chat (il «this chat»), poi nei livelli interni di
// OpenCode — che ne ha quattro (agent → provider → famiglia → modello): si scende
// finché le righe di modello non compaiono, con un tetto per non ciclare all'infinito.
// Scegliere un modello di un ALTRO agent aprirebbe la conferma del passaggio, non
// chiuderebbe il menu: la discesa resta dentro l'agent di questa chat.
await p.click('.leadbox.picker .pk-row:has-text("this chat")')
await p.waitForTimeout(350)
for (let i = 0; i < 5; i++) {
  const livello = await p.evaluate(() => ({
    mrow: !!document.querySelector('.leadbox.picker .pk-mrow'),
    prow: !!document.querySelector('.leadbox.picker .pk-row'),
  }))
  if (livello.mrow || !livello.prow) break
  await p.click('.leadbox.picker .pk-row')
  await p.waitForTimeout(350)
}
const pk = await p.evaluate(() => {
  const box = document.querySelector('.leadbox.picker')
  const r = box?.getBoundingClientRect()
  const righe = [...(box?.querySelectorAll('.pk-mrow') ?? [])]
  const stati = righe.map(x => x.querySelector('.mstate')?.getBoundingClientRect().right ?? 0)
    .filter(x => x > 0)
  const spread = stati.length ? Math.max(...stati) - Math.min(...stati) : 0
  return {
    w: r?.width,
    modelli: righe.length,
    spread,
    head: !!box?.querySelector('.pk-head .pk-name'),
    meta: !!box?.querySelector('.pk-meta .price'),
    search: !!box?.querySelector('.pk-search input'),
    navCount: !!box?.querySelector('.pk-nav .nv-count'),
  }
})
check('picker 380px', pk.w !== undefined && Math.abs(pk.w - 380) <= 3, String(pk.w))
check('testa del picker col modello', pk.head && pk.meta && pk.search && pk.navCount)
check('righe modello presenti', pk.modelli > 0, String(pk.modelli))
check('colonne numeriche allineate (spread ≤ 1px)', pk.modelli > 0 && pk.spread <= 1, `spread ${px(pk.spread)}px`)

// Scegliere un modello chiude il menu: la scelta è un gesto che finisce.
const primaRiga = await centro('.leadbox.picker .pk-mrow')
if (primaRiga) {
  await p.mouse.click(primaRiga.x, primaRiga.y)
  await p.waitForTimeout(400)
  check('scegliere un modello chiude il menu', await p.evaluate(() => !document.querySelector('.leadbox')))
} else {
  check('scegliere un modello chiude il menu', false, 'nessuna riga da premere')
}

// ─── 4. MCP e chiusure ───────────────────────────────────────────────────────
await p.click('.composer .lead')
await p.waitForSelector('.leadbox.popup')
await p.click('.leadbox.popup .pop-item:has-text("MCP")')
await p.waitForTimeout(300)
const mcp = await p.evaluate(() => ({
  righe: document.querySelectorAll('.mcp-row').length,
  vuoto: [...document.querySelectorAll('.pk-empty')].some(x => x.textContent.includes('no servers')),
}))
check('pannello MCP: righe o elenco vuoto detto', mcp.righe > 0 || mcp.vuoto)
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
check('Esc chiude il menu', await p.evaluate(() => !document.querySelector('.leadbox')))

// ─── 5. scrivere, mandare, misurare il lavoro ────────────────────────────────
await p.click('.composer textarea.input')
await p.fill('.composer textarea.input', 'rispondi solo: ok')
check('invio acceso col testo', await p.evaluate(() =>
  !document.querySelector('.composer .send')?.classList.contains('off')))
await p.click('.composer .send')

// Busy: sweep sul campo, stop accanto all'invio (schermo largo).
await p.waitForSelector('.field .beam', { timeout: 30_000 })
const busy = await p.evaluate(() => {
  const stop = document.querySelector('.actions .stop.wide')
  const r = stop?.getBoundingClientRect()
  const send = document.querySelector('.composer .send')?.getBoundingClientRect()
  return {
    prog: !!document.querySelector('.field .beam'),
    // Il fascio copre TUTTO il bordo: la maschera lascia un anello, quindi il suo
    // box coincide con il campo — la prova guarda anche l'animazione dichiarata.
    animato: (() => {
      const b = document.querySelector('.field .beam')
      if (!b) return false
      const cs = getComputedStyle(b)
      return (cs.animationName || '').includes('beam') && cs.animationIterationCount === 'infinite'
    })(),
    stop: !!stop,
    accanto: r && send ? Math.abs(r.right - (send.left - 8)) < 3 : false,
  }
})
check('sweep sul campo mentre lavora', busy.prog)
check('il fascio gira attorno al bordo (animazione infinita)', busy.animato)
// L'angolo davvero avanza: due letture a distanza devono dare valori diversi. Una
// prova che guarda solo la dichiarazione resterebbe verde anche con un fascio fermo.
const angoli = []
for (let i = 0; i < 2; i++) {
  angoli.push(await p.evaluate(() =>
    getComputedStyle(document.querySelector('.field .beam')).getPropertyValue('--stark-beam').trim()))
  await p.waitForTimeout(350)
}
check("l'angolo del fascio avanza nel tempo", angoli[0] !== angoli[1],
  `${angoli[0]} → ${angoli[1]}`)
check('stop accanto all\'invio mentre lavora', busy.stop && busy.accanto)

// Attende la fine del turno (modello gratuito: di solito pochi secondi).
await p.waitForFunction(() => !document.querySelector('.field .beam'), null, { timeout: 120_000 })
check('il turno si chiude e lo sweep tace', true)

// Il menu d'uso: la riga Context con la sua cella costo.
await p.click('.composer .lead')
await p.waitForSelector('.leadbox.popup')
const usage = await p.evaluate(() => {
  const righe = [...document.querySelectorAll('.leadbox .u-row')]
  const ctx = righe.find(x => x.querySelector('.u-lbl')?.textContent === 'Context')
  return {
    righe: righe.length,
    ctx: !!ctx,
    barre: ctx ? !!ctx.querySelector('.u-bar span') : false,
    // La cella costo esiste solo se c'è spesa (chiesto dall'utente, 1º settembre 2026):
    // senza span la barra si allunga fino in fondo invece di lasciare un buco. Su un
    // modello gratuito la spesa è 0, quindi qui si accetta sia la cella sia il vuoto.
    costi: ctx ? ctx.querySelectorAll('.u-cost').length <= 1 : false,
    pct: ctx?.querySelector('.u-pct')?.textContent ?? '',
  }
})
check('pannello d\'uso: riga Context con barra, % e cella costo',
  usage.ctx && usage.barre && usage.costi, JSON.stringify(usage))
await p.keyboard.press('Escape')

// ─── 6. il campo cresce a righe intere ──────────────────────────────────────
// Tre righe di testo: l'altezza del campo deve essere un multiplo esatto del
// line-height più i suoi 8px di padding — una mezza riga si vedrebbe tagliata sul
// bordo, ed è il «troncato» che l'utente ha segnalato.
await p.fill('.composer textarea.input', 'a\nb\nc')
await p.waitForTimeout(200)
const cresci = await p.evaluate(() => {
  const h = document.querySelector('.composer .field')?.getBoundingClientRect().height
  return { h }
})
check('campo a tre righe cresce a righe intere (62.5±1)',
  cresci.h !== undefined && Math.abs(cresci.h - 62.5) <= 1, String(cresci.h))
await p.fill('.composer textarea.input', '')

// ─── 7. da stretto: niente straripamento, il menu è un foglio ────────────────
await p.setViewportSize({ width: 390, height: 780 })
await p.waitForTimeout(400)
const stretto = await p.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  vw: innerWidth,
}))
check('390px: nessuno straripamento orizzontale', stretto.scrollW <= stretto.vw + 1,
  `scroll ${stretto.scrollW} vs ${stretto.vw}`)
await p.click('.composer .lead')
await p.waitForSelector('.leadbox.popup')
// Il foglio sta ai bordi del SUO contenitore (la zona del composer), non del
// viewport: la prima stesura della sonda misurava nel viewport e vedeva 4px di
// cornice come un difetto che non c'era.
const zona = await p.evaluate(() => {
  const z = document.querySelector('.composer-zone')?.getBoundingClientRect()
  const el = document.querySelector('.leadbox.popup')
  const r = el?.getBoundingClientRect()
  return z && r && { zl: z.left, zr: z.right, l: r.left, r: r.right }
})
// Sotto la soglia stretta Sizer moltiplica lo zoom ×1.35: i pixel veri del rettangolo
// valgono il fattore. La prima stesura della sonda l'ignorava e vedeva un difetto
// che non c'era — è la trappola nota di ui/src/lib/zoom.ts.
const zoomStretto = await p.evaluate(() =>
  Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1)
check('menu a foglio ai due bordi della zona',
  zona && Math.abs(foglio_l(zona, zoomStretto)) <= 3 && Math.abs(foglio_r(zona, zoomStretto)) <= 3,
  JSON.stringify({ ...zona, zoom: zoomStretto }))

await b.close()
await rmSync(CASA, { recursive: true, force: true })
console.log(falli === 0 ? '\nTUTTO VERDE' : `\n${falli} FALLIMENTI`)
process.exit(falli === 0 ? 0 : 1)
