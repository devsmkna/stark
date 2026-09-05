// Misura nel browser vero cosa si vede **mentre** STARK chiede al cloud chi sei.
//
// Nasce da una segnalazione (5 settembre 2026, card #30): all'avvio la schermata di
// login compariva e spariva da sola. Il gate decideva col valore iniziale dello stato
// — `cloudGate === null`, che vuol dire «non l'ho ancora chiesto», non «non sei
// autenticato» — e la risposta arrivava un istante dopo a rimettere a posto.
//
// Un lampo non si misura con un `waitForSelector`: quando quello torna, il lampo è già
// finito. Qui si guarda **durante**, con un osservatore piantato nella pagina prima che
// il bundle parta (`addInitScript` + `MutationObserver`), che segna tutto quello che è
// comparso. Se la card del login si è vista anche solo per un frame, resta scritta.
//
// Il cloud vero non c'entra: la sonda ne monta uno finto che risponde lento apposta,
// così la finestra in cui il difetto vive è larga e la misura non dipende dalla rete.

import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const RITARDO_MS = 600

// ─── il cloud finto: dice sempre «sì, sei tu», ma con calma ────────────────────
const cloud = createServer((req, res) => {
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ email: 'prova@esempio.it' }))
  }, req.url?.startsWith('/api/me') ? RITARDO_MS : 0)
})
await new Promise((ok) => cloud.listen(0, '127.0.0.1', ok))
const portaCloud = cloud.address().port

const CASA = mkdtempSync(resolve(tmpdir(), 'stark-gate-'))
mkdirSync(CASA, { recursive: true })
// Una sessione già valida su questa macchina: è il caso della segnalazione — chi il
// login lo ha già fatto non deve rivederlo.
writeFileSync(resolve(CASA, 'cloud-token'), JSON.stringify({ token: 'finto', email: 'prova@esempio.it' }), { mode: 0o600 })
process.env['STARK_HOME'] = CASA
process.env['STARK_CLOUD_URL'] = `http://127.0.0.1:${portaCloud}`

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url, '· cloud finto su', portaCloud, `(${RITARDO_MS}ms)`)

let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${dettaglio && !ok ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}

const b = await chromium.launch({ args: ['--no-sandbox'] })
const pagina = await b.newPage({ viewport: { width: 900, height: 700 } })

// L'osservatore parte prima del bundle: quello che compare dopo, comunque compaia,
// finisce in `window.__visti`.
await pagina.addInitScript(() => {
  window.__visti = []
  const guarda = () => {
    if (document.querySelector('.lg-card')) window.__visti.push('login')
    if (document.querySelector('.splash')) window.__visti.push('splash')
  }
  new MutationObserver(guarda).observe(document, { childList: true, subtree: true })
  document.addEventListener('DOMContentLoaded', guarda)
})

await pagina.goto(`${s.url}/?token=${s.token}`)

// Mentre il cloud finto sta ancora pensando: deve esserci lo splash, e nessun login.
// Si aspetta **uno dei due**, non lo splash: se si aspettasse solo quello, il difetto
// si presenterebbe come un timeout di Playwright invece che come una riga FAIL che
// dice cosa c'era al suo posto.
await pagina.waitForSelector('.splash, .lg-card', { timeout: 5000 })
const durante = await pagina.evaluate(() => ({
  splash: !!document.querySelector('.splash'),
  login: !!document.querySelector('.lg-card'),
}))
check('durante l\'attesa si vede lo splash', durante.splash)
check('durante l\'attesa NON si vede il login', !durante.login)

// Dopo: l'app, e il login non deve essersi visto **in nessun momento**.
// Il verdetto vero è cosa si è **visto**, non cosa c'è adesso: si lascia passare la
// risposta del cloud finto e poi si legge l'elenco dell'osservatore. Il `catch` c'è
// perché un fallimento qui deve diventare una riga FAIL leggibile, non una traccia.
await pagina.waitForFunction(() => !document.querySelector('.splash'), { timeout: 10000 }).catch(() => {})
const visti = await pagina.evaluate(() => window.__visti)
check('il login non è comparso nemmeno per un frame', !visti.includes('login'), `visti: ${visti.join(',') || 'nessuno'}`)
check('lo splash invece sì', visti.includes('splash'))

await b.close()
await new Promise((ok) => cloud.close(ok))
await s.close?.()
rmSync(CASA, { recursive: true, force: true })

console.log(falli ? `\n${falli} verifiche fallite` : '\ntutto a posto')
process.exit(falli ? 1 : 0)
