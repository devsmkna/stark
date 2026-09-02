// Eliminare un messaggio in coda si misura nel browser vero, non ragionando sul CSS —
// ed è anche l'unico modo di vedere il giro COMPLETO: il bottone, il comando, il
// `turn.ended` che torna dal flusso e la fila che smette di mostrare il turno in coda.
// Questa prova apre una sessione OpenCode VIVA (modello gratuito, due turni brevi di
// cui uno mai consegnato: costo zero di quota) e verifica:
//
//   1. un prompt mandato mentre l'agent lavora si accoda, e il suo turno porta la
//      × («Remove from queue») — che il turno attivo NON ha;
//   2. premere la × toglie l'etichetta «queue»: il turno resta nella conversazione
//      (il journal è append-only) ma non è più in coda;
//   3. lo snapshot dice la verità: il turno tolto è `ended` con `reason: 'aborted'`
//      e senza parti — mai consegnato, mai lavorato;
//   4. finito il primo turno, il tolto NON parte: la conversazione ha due turni, il
//      primo `completed`, il secondo `aborted` per sempre.
//
//   node tools/prova-coda-elimina.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const RADICE = resolve(import.meta.dirname, '..')
const CASA = mkdtempSync(resolve(tmpdir(), 'stark-coda-elimina-'))
mkdirSync(CASA, { recursive: true })
process.env['STARK_HOME'] = CASA

// Il modello: gratuito se c'è, così i turni di misura non costano quota.
const { catalogoModelli } = await import('../src/adapters/opencode/adapter.ts')
const catalogo = await catalogoModelli()
const libero = catalogo.find(m => m.cost && m.cost.input === 0 && m.cost.output === 0)
const MODELLO = libero?.id ?? 'opencode/gpt-5-nano'
console.log(`modello: ${MODELLO}${libero ? ' (gratuito)' : ''}`)

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

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

let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${dettaglio && !ok ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: 'dark' })
p.on('pageerror', e => console.log('[pageerror]', e.message))
p.on('console', m => { if (m.type() === 'error') console.log('[ui-error]', m.text()) })
await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
await p.waitForTimeout(1200)

await p.click(`text=${id.slice(0, 8)}`)
await p.waitForSelector('.composer textarea.input', { timeout: 15_000 })

// Primo prompt: parte davvero. Secondo: arriva mentre il primo è in volo, quindi si
// accoda — e il suo `turn.started` arriva subito, con l'etichetta «queue» a schermo.
await p.click('.composer textarea.input')
await p.fill('.composer textarea.input', 'elenca i numeri da 1 a 10, una riga ciascuno, nient\'altro')
await p.click('.composer .send')
await p.waitForSelector('.field .beam', { timeout: 30_000 })
await p.fill('.composer textarea.input', 'secondo prompt: rispondi solo: due')
await p.click('.composer .send')
await p.waitForSelector('.turn.queued .qtag', { timeout: 10_000 })
check('il secondo prompt si accoda (etichetta «queue»)', true)

// ─── 1. la × sta solo sul turno in coda ──────────────────────────────────────
const croci = await p.evaluate(() => {
  const c = [...document.querySelectorAll('.turn .thdel')]
  return {
    n: c.length,
    inCoda: c.every(x => !!x.closest('.turn.queued')),
    attiva: !!document.querySelector('.turn.active .thdel'),
  }
})
check('una × sola, dentro il turno in coda', croci.n === 1 && croci.inCoda, JSON.stringify(croci))
check('il turno attivo non ha la ×', croci.attiva === false)

// ─── 2. premere la × toglie il turno dalla fila ──────────────────────────────
// Playwright preme le coordinate vere del centro: se un velo le copre, fallisce —
// è il hit test vero, non un dispatch sintetico.
await p.click('.turn.queued .thdel')
await p.waitForFunction(() => document.querySelectorAll('.qtag').length === 0,
  null, { timeout: 10_000 })
const dopo = await p.evaluate(() => ({
  croci: document.querySelectorAll('.turn .thdel').length,
  turni: document.querySelectorAll('.turn').length,
}))
check('l\'etichetta e la × spariscono dal flusso', dopo.croci === 0, JSON.stringify(dopo))
check('il turno tolto resta nella conversazione (append-only)', dopo.turni === 2)

// ─── 3. lo snapshot dice la verità ───────────────────────────────────────────
const snap = (await (await fetch(`${s.url}/api/sessions/${id}`, {
  headers: { authorization: `Bearer ${s.token}` },
})).json()).snapshot
const tolto = snap.turns?.[1]
check('il turno tolto è ended/aborted e senza parti',
  tolto?.ended === true && tolto?.reason === 'aborted' && (tolto?.parts?.length ?? 0) === 0,
  JSON.stringify({ ended: tolto?.ended, reason: tolto?.reason, parti: tolto?.parts?.length }))

// ─── 4. il tolto non parte quando il primo finisce ───────────────────────────
await p.waitForFunction(() => !document.querySelector('.field .beam'), null, { timeout: 180_000 })
await p.waitForTimeout(1500) // un respiro: se il tolto fosse partito, qui si vedrebbe
const snap2 = (await (await fetch(`${s.url}/api/sessions/${id}`, {
  headers: { authorization: `Bearer ${s.token}` },
})).json()).snapshot
check('due turni, mai tre: il tolto non è mai partito', snap2.turns?.length === 2,
  `turni ${snap2.turns?.length}`)
check('il primo turno è completed, il secondo aborted per sempre',
  snap2.turns?.[0]?.reason === 'completed' && snap2.turns?.[1]?.reason === 'aborted',
  JSON.stringify(snap2.turns?.map(t => t.reason)))

await b.close()
await rmSync(CASA, { recursive: true, force: true })
console.log(falli === 0 ? '\nTUTTO VERDE' : `\n${falli} FALLIMENTI`)
process.exit(falli === 0 ? 0 : 1)
