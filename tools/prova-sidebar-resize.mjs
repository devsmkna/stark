// Misura nel browser vero la maniglia che allarga la barra laterale (card #32).
//
// Perché una sonda e non un ragionamento sul CSS: la trappola di questa feature non
// sta nella larghezza, sta nella **corrispondenza fra puntatore e bordo** quando il
// root è zoomato. `clientX` è in pixel veri, un `width` scritto su un figlio del root
// no — e al 135% una barra che insegue il puntatore senza dividere per lo zoom non lo
// raggiunge mai. Un difetto così non si vede leggendo il codice: si vede misurando
// dove finisce il bordo rispetto a dove sta il dito.
//
// Il gate d'accesso vuole una sessione cloud, quindi la sonda monta un cloud finto e
// scrive un token in una `STARK_HOME` sua — non tocca le conversazioni vere.

import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const cloud = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ email: 'prova@esempio.it' }))
})
await new Promise((ok) => cloud.listen(0, '127.0.0.1', ok))

const CASA = mkdtempSync(resolve(tmpdir(), 'stark-side-'))
mkdirSync(CASA, { recursive: true })
writeFileSync(resolve(CASA, 'cloud-token'), JSON.stringify({ token: 'finto', email: 'prova@esempio.it' }), { mode: 0o600 })
process.env['STARK_HOME'] = CASA
process.env['STARK_CLOUD_URL'] = `http://127.0.0.1:${cloud.address().port}`

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}

const MIN = 170, MAX = 460, DEFAULT = 212

const b = await chromium.launch({ args: ['--no-sandbox'] })
const pagina = await b.newPage({ viewport: { width: 1280, height: 800 } })
await pagina.goto(`${s.url}/?token=${s.token}`)
await pagina.waitForSelector('.side', { timeout: 15000 })

const largh = () => pagina.evaluate(() => Math.round(document.querySelector('.side').getBoundingClientRect().width))
const bordoDestro = () => pagina.evaluate(() => document.querySelector('.side').getBoundingClientRect().right)

check('si parte dalla larghezza di sempre', await largh() === DEFAULT, `${await largh()}px`)

/** Trascina la maniglia fino a `xFinale` (pixel veri della finestra) e rilascia. */
async function trascina(xFinale) {
  const m = await pagina.locator('.side-hdl').boundingBox()
  await pagina.mouse.move(m.x + m.width / 2, m.y + 200)
  await pagina.mouse.down()
  // Due passi invece di uno: un salto solo può essere consegnato come un unico
  // pointermove e nasconderebbe un calcolo che sbaglia solo in corsa.
  await pagina.mouse.move((m.x + xFinale) / 2, m.y + 220)
  await pagina.mouse.move(xFinale, m.y + 240)
  await pagina.mouse.up()
}

// ─── il caso normale: il bordo finisce dove sta il puntatore ──────────────────
await trascina(320)
check('trascinando si allarga', await largh() > DEFAULT, `${await largh()}px`)
check('il bordo segue il puntatore (±3px)', Math.abs(await bordoDestro() - 320) <= 3, `bordo a ${Math.round(await bordoDestro())}, puntatore a 320`)

// ─── i limiti: si fermano, invece di far sparire la barra ─────────────────────
await trascina(40)
check('non si stringe sotto il minimo', await largh() === MIN, `${await largh()}px`)
await trascina(1200)
check('non si allarga oltre il massimo', await largh() === MAX, `${await largh()}px`)

// ─── il doppio clic riporta al valore di partenza ─────────────────────────────
await pagina.locator('.side-hdl').dblclick()
check('doppio clic torna al valore di partenza', await largh() === DEFAULT, `${await largh()}px`)

// ─── sopravvive al ricaricamento (è una preferenza del dispositivo) ───────────
await trascina(300)
const prima = await largh()
await pagina.reload()
await pagina.waitForSelector('.side', { timeout: 15000 })
check('la larghezza sopravvive al ricaricamento', await largh() === prima, `${await largh()}px contro ${prima}px`)

// ─── la trappola vera: il root zoomato ────────────────────────────────────────
//
// `Sizer` zooma il root; se chi trascina non divide per quel fattore, il bordo resta
// indietro di quanto vale lo zoom. Qui lo zoom si mette a mano sul root — è la stessa
// proprietà CSS che usa Sizer, e questa sonda deve misurare l'effetto, non il percorso
// che ce lo porta.
await pagina.evaluate(() => { document.documentElement.style.zoom = '1.35' })
await trascina(400)
const scarto = Math.abs(await bordoDestro() - 400)
check('col root zoomato al 135% il bordo resta sotto il puntatore (±4px)', scarto <= 4, `scarto ${Math.round(scarto)}px`)
await pagina.evaluate(() => { document.documentElement.style.zoom = '' })

// ─── su schermo stretto la maniglia non c'è ───────────────────────────────────
await pagina.setViewportSize({ width: 700, height: 800 })
await pagina.waitForTimeout(200)
const strettoOk = await pagina.evaluate(() => {
  const side = document.querySelector('.side')
  if (!side) return { assente: true }
  return {
    maniglia: !!document.querySelector('.side-hdl'),
    // Larga quanto la finestra: la media query deve vincere sulla larghezza scelta col
    // mouse, ed è la ragione per cui quella passa da una variabile e non da uno style.
    piena: Math.abs(side.getBoundingClientRect().width - window.innerWidth) <= 1,
  }
})
check('su schermo stretto niente maniglia', strettoOk.assente || !strettoOk.maniglia, JSON.stringify(strettoOk))
check('su schermo stretto la barra è tutta la schermata', strettoOk.assente || strettoOk.piena, JSON.stringify(strettoOk))

await b.close()
await new Promise((ok) => cloud.close(ok))
await s.close?.()
rmSync(CASA, { recursive: true, force: true })

console.log(falli ? `\n${falli} verifiche fallite` : '\ntutto a posto')
process.exit(falli ? 1 : 0)
