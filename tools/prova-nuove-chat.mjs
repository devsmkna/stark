// Le due strade per una chat nuova e le loro regole diverse (chieste dall'utente,
// 1º settembre 2026):
//   1. la PREFERITA: impostata (Settings → Agent), vale per le chat che nascono
//      dal dialogo «New chat» — il + dell'elenco;
//   2. «New chat here» del menu contestuale: porta il modello DELLA CHAT da cui
//      si è premuto, non la preferita — è la sua ragione di esistere.
// E la regola del confine: la preferenza è vincolata all'agent — si è scelto un
// altro agent, il suo default vince.
//   node tools/prova-nuove-chat.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
const RADICE = resolve(import.meta.dirname, '..')
const CASA = mkdtempSync(resolve(tmpdir(), 'stark-nuove-'))
process.env['STARK_HOME'] = CASA
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })

let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${!ok && dettaglio ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}

const h = { 'content-type': 'application/json', authorization: `Bearer ${s.token}` }

// La preferita: OpenCode, modello gratuito e noto (gpt-5-nano).
const scrivi = await fetch(`${s.url}/api/settings`, { method: 'PUT', headers: h,
  body: JSON.stringify({ permissions: {}, projects: {}, toolDescriptions: true,
    defaultMode: 'auto', preferredModel: { agent: 'opencode', model: 'opencode/gpt-5-nano' } }) })
check('la preferita si salva', scrivi.ok
  && (await scrivi.json()).settings.preferredModel?.model === 'opencode/gpt-5-nano')

// Una chat VIVA con un modello DIVERSO, per la strada del menu contestuale.
const crea = await fetch(`${s.url}/api/sessions`, { method: 'POST', headers: h,
  body: JSON.stringify({ cwd: RADICE, agent: 'opencode', model: 'opencode/kimi-k3' }) })
const prima = await crea.json()

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: 'dark' })
p.on('pageerror', e => { console.log('[pageerror]', e.message); falli++ })
p.on('console', m => { if (m.type() === 'error') console.log('[ui-error]', m.text()) })
await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
await p.waitForFunction((q) => [...document.querySelectorAll('.sit')].some(x => x.textContent?.includes(q)),
  prima.id.slice(0, 8), { timeout: 60_000 })
await p.click(`.sit:has-text("${prima.id.slice(0, 8)}")`)
await p.waitForSelector('.composer .lead', { timeout: 60_000 })

// ─── 1. il menu contestuale ─────────────────────────────────────────────────
const bb = await p.locator(`.sit:has-text("${prima.id.slice(0, 8)}")`).boundingBox()
await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' })
await p.waitForSelector('.ctx-menu')
await p.click('.ctx-menu .mi:has-text("New chat here")')
await p.waitForTimeout(2500)
const elenco1 = await (await fetch(`${s.url}/api/sessions`, { headers: h })).json()
const nuove1 = (elenco1.sessions ?? []).filter(x => x.id !== prima.id)
check('menu contestuale: una chat nuova appare', nuove1.length >= 1,
  `sessioni ${(elenco1.sessions ?? []).length}`)
const qui = nuove1[0]
check('menu contestuale: stessa cartella', qui?.cwd === RADICE, qui?.cwd)
check('menu contestuale: stesso modello della chat sorgente',
  qui?.model === 'opencode/kimi-k3', String(qui?.model))
check('menu contestuale: NON ha preso la preferita', qui?.model !== 'opencode/gpt-5-nano',
  String(qui?.model))

// ─── 2. il dialogo New chat col + ───────────────────────────────────────────
await p.click('[aria-label="New chat"]')
await p.waitForSelector('.dlg')
// la cartella: la stessa del progetto, digitata a mano
await p.fill('.dlg input', RADICE)
await p.waitForTimeout(300)
// Lo start: la voce va cercata per testo; la cartella si compila da sola? Il
// dialogo chiede conferma col bottone «Start» (o simile).
const start = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.dlg button')].find(x =>
    (x.textContent ?? '').trim() === 'Start')
  const r = btn?.getBoundingClientRect()
  return btn && r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, t: btn.textContent?.trim() } : null
})
if (!start) { check('dialogo New chat: bottone di avvio', false, 'non trovato'); }
else {
  await p.mouse.click(start.x, start.y)
  await p.waitForTimeout(2500)
  const elenco2 = await (await fetch(`${s.url}/api/sessions`, { headers: h })).json()
  const nuove2 = (elenco2.sessions ?? []).filter(x => x.id !== prima.id && x.id !== qui.id)
  const pref = nuove2[0]
  console.log('[diagnostica] nuova dal dialogo:', JSON.stringify(pref))
  console.log('[diagnostica] bottoni dlg al fill:', JSON.stringify(await p.evaluate(() =>
    [...document.querySelectorAll('.dlg button')].map(x => x.textContent?.trim()).slice(0, 10))))
  check('dialogo New chat: una chat nuova appare', !!pref, JSON.stringify((elenco2.sessions ?? []).map(x => x.id.slice(0, 8))))
  check('dialogo New chat: parte con la PREFERITA', pref?.model === 'opencode/gpt-5-nano',
    String(pref?.model))
  check('dialogo New chat: parte con l\'agent della preferita', pref?.agent === 'opencode',
    String(pref?.agent))
}

await b.close()
console.log(falli === 0 ? 'TUTTO VERDE' : `${falli} FALLIMENTI`)
process.exit(falli === 0 ? 0 : 1)
