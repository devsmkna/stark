// Col multi-pannello ogni dock parla alla SUA chat, non a quella a fuoco. È il difetto
// latente scritto nel diario il 28 agosto (l'indagine di «premo invio, non succede
// nulla») e chiuso oggi: prima ogni comando del blocco in basso partiva con
// `store.selected`, cioè verso la chat a fuoco — e col clic ci si salvava solo per un
// effetto laterale (`focusPane` al pointerdown del pannello, che corre PRIMA del
// click). Chi entra dalla **tastiera** non sposta il fuoco: Tab fino alla casella del
// pannello di destra, poi Invio, e il prompt partiva per la chat di sinistra.
//
// La prova riproduce esattamente quella strada: due sessioni in split view, la
// chat a fuoco è quella di sinistra, e il prompt parte dalla casella di destra con
// focus programmático + Invio (nessun pointerdown, quindi nessun cambio di fuoco).
// Se l'id arriva, il turno nasce a destra; se non arriva, nasce a sinistra — e lo
// snapshot dei due journal lo dice senza ambiguità.
//
//   node tools/prova-dock-pannello.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const RADICE = resolve(import.meta.dirname, '..')
const CASA = mkdtempSync(resolve(tmpdir(), 'stark-dock-pannello-'))
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

const crea = async (nome) => {
  const r = await fetch(`${s.url}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ cwd: CASA, agent: 'opencode', model: MODELLO }),
  })
  if (!r.ok) { console.error(`${nome} non creata:`, r.status, await r.text()); process.exit(1) }
  return (await r.json()).id
}
const A = await crea('A')
const B = await crea('B')
console.log('sessioni', A.slice(0, 8), B.slice(0, 8))

let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${dettaglio && !ok ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}
const snapshot = async (id) => (await (await fetch(`${s.url}/api/sessions/${id}`, {
  headers: { authorization: `Bearer ${s.token}` },
})).json()).snapshot

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: 'dark' })
p.on('pageerror', e => console.log('[pageerror]', e.message))
p.on('console', m => { if (m.type() === 'error') console.log('[ui-error]', m.text()) })
await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
await p.waitForTimeout(1200)

// A a sinistra, poi B a destra col menu «Add to split view» (B non è ancora aperta:
// per la regola del menu è lei ad andare a destra).
await p.click(`text=${A.slice(0, 8)}`)
await p.waitForSelector('.composer textarea.input', { timeout: 15_000 })
await p.click(`text=${B.slice(0, 8)}`, { button: 'right' })
await p.click('text=Add to split view')
await p.waitForFunction(() => document.querySelectorAll('.composer textarea.input').length === 2,
  null, { timeout: 20_000 })

// La chat a fuoco torna A: un clic sulla riga di A (pointerdown sul pannello di
// sinistra farebbe lo stesso — qui basta la riga, ed è il gesto più economico).
await p.click(`text=${A.slice(0, 8)}`)
await p.waitForTimeout(300)
const fuoco = await p.evaluate(([a8, b8]) => {
  const on = [...document.querySelectorAll('.pane.on')]
  return {
    n: on.length,
    a: on.some(x => x.textContent?.includes(a8)),
    b: on.some(x => x.textContent?.includes(b8)),
  }
}, [A.slice(0, 8), B.slice(0, 8)])
check('a fuoco c\'è solo A, non B', fuoco.n === 1 && fuoco.a && !fuoco.b, JSON.stringify(fuoco))

// La casella di B prende il fuoco SENZA pointerdown: focus programmático, come fa
// chi arriva da tastiera (Tab) o da un assistente. Poi Invio manda.
const casellaB = p.locator('.pane', { hasText: B.slice(0, 8) })
  .locator('.composer textarea.input')
await casellaB.fill('seconda chat: rispondi solo: due')
const fuocoDopo = await p.evaluate(([a8, b8]) => {
  const on = [...document.querySelectorAll('.pane.on')]
  return on.some(x => x.textContent?.includes(b8))
}, [A.slice(0, 8), B.slice(0, 8)])
check('riempire la casella di B non sposta il fuoco', fuocoDopo === false)
// Due guardie contro l'inganno della sonda: il testo sta nella casella giusta
// (quella di B), quella di A è vuota, e l'elemento a fuoco è la casella di B —
// perché se la sonda riempisse la casella sbagliata, il verdetto non varrebbe niente.
const prima = await p.evaluate(([a8, b8]) => {
  const pane = (t) => [...document.querySelectorAll('.pane')]
    .find(x => x.textContent?.includes(t))
  const val = (t) => pane(t)?.querySelector('.composer textarea.input')?.value ?? null
  return {
    b: val(b8), a: val(a8),
    fuoco: document.activeElement?.closest('.pane')?.textContent?.includes(b8) ?? false,
  }
}, [A.slice(0, 8), B.slice(0, 8)])
check('il testo sta nella casella di B', prima.b === 'seconda chat: rispondi solo: due',
  JSON.stringify(prima.b))
check('la casella di A è vuota PRIMA dell\'invio', prima.a === '', JSON.stringify(prima.a))
check('l\'elemento a fuoco è la casella di B', prima.fuoco === true)
await casellaB.press('Enter')

// Il turno deve nascere in B — e in A non deve esserci niente. `turn.started` esce
// all'ingresso in coda/consegna, quindi basta aspettare che B ne abbia uno.
let snapB = null, snapA = null
for (let i = 0; i < 20; i++) {
  snapB = await snapshot(B)
  if ((snapB?.turns?.length ?? 0) > 0) break
  await p.waitForTimeout(500)
}
snapA = await snapshot(A)
check('il prompt mandato da B arriva a B',
  (snapB?.turns?.length ?? 0) === 1
  && JSON.stringify(snapB?.turns?.[0]?.prompt)?.includes('rispondi solo: due'),
  JSON.stringify(snapB?.turns?.map(t => t.prompt)))
check('ad A non è arrivato niente', (snapA?.turns?.length ?? 0) === 0,
  JSON.stringify(snapA?.turns?.map(t => t.prompt)))

// E il prompt non ha mai toccato la casella di A: il suo composer è ancora vuoto.
// Se il pannello non si trova più (qualunque ragione), lo si dice invece di crashare
// senza verdetto: una prova che muore a metà non distingue il verde dal rosso.
let vuotaA = null
try { vuotaA = await p.locator('.pane', { hasText: A.slice(0, 8) })
  .locator('.composer textarea.input').inputValue() }
catch { vuotaA = '(pannello A non trovato)' }
check('la casella di A è rimasta vuota', vuotaA === '', JSON.stringify(vuotaA))

await b.close()
await rmSync(CASA, { recursive: true, force: true })
console.log(falli === 0 ? '\nTUTTO VERDE' : `\n${falli} FALLIMENTI`)
process.exit(falli === 0 ? 0 : 1)
