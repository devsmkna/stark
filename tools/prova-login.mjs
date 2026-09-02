// Misura la schermata di login nel browser vero, invece di ragionare sul CSS.
//
// Nasce da una segnalazione con schermata allegata (2 settembre 2026): il logo aveva
// un rettangolo di sfondo che non c'entrava niente, e la riga «Server cloud non
// configurato: imposta STARK_CLOUD_URL sul daemon» si spezzava in quattro pezzi
// attorno al chip. Il CSS di `Login.svelte` non spiegava nessuna delle due cose — ed
// e' esattamente il caso in cui la regola del progetto dice di misurare invece di
// dedurre: piu' di una volta il colpevole «ovvio» era innocente.
//
// Il daemon lo avvia questa sonda su una porta effimera con una `STARK_HOME` sua:
// non tocca le conversazioni vere, e la schermata di login compare da se' perche'
// `STARK_CLOUD_URL` non e' configurata — che e' precisamente il caso segnalato.

import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const CASA = mkdtempSync(resolve(tmpdir(), 'stark-login-'))
mkdirSync(CASA, { recursive: true })
process.env['STARK_HOME'] = CASA
delete process.env['STARK_CLOUD_URL']   // il caso della segnalazione

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

let falli = 0
const check = (nome, ok, dettaglio = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}${dettaglio && !ok ? ` — ${dettaglio}` : ''}`)
  if (!ok) falli++
}

const b = await chromium.launch({ args: ['--no-sandbox'] })
// Il tema **scuro** per primo: e' quello della segnalazione, ed e' anche quello in cui
// un fondo sbagliato si nota di piu' — il rosso mattone dell'evidenziazione su una
// card scura era la cosa che saltava all'occhio nella schermata allegata.
const pagina = await b.newPage({ viewport: { width: 480, height: 700 }, colorScheme: 'dark' })
await pagina.goto(`${s.url}/?token=${s.token}`)
await pagina.waitForSelector('.lg-card', { timeout: 15000 })

const misura = () => pagina.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  const bg = (e) => getComputedStyle(e).backgroundColor
  const card = document.querySelector('.lg-card')
  const mark = document.querySelector('.lg-mark')
  const svg = mark?.querySelector('svg')
  const warn = document.querySelector('.lg-warn')
  // Il nome della variabile dentro l'avviso: `.lg-var` adesso, `code` prima della
  // correzione — si guardano tutti e due, così la sonda misura anche il difetto.
  const code = warn?.querySelector('.lg-var, code')

  // Quante righe occupa davvero un testo: i rettangoli veri, non un conteggio di
  // caratteri. E' la differenza fra «va a capo» e «si spezza».
  //
  // I `top` si raggruppano per **fascia**, non per valore esatto, e la prima versione
  // di questa sonda sbagliava proprio qui: contava i top distinti, e siccome il nome
  // della variabile e' in mono — metriche diverse dal testo attorno — il suo
  // rettangolo ha un `top` di un paio di pixel piu' in basso *sulla stessa riga*.
  // Risultato: «3 righe» su una frase che a schermo ne occupa 2. Una misura che
  // guarda il posto sbagliato non fallisce, mente.
  const righeDi = (el) => {
    if (!el) return 0
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter(r => r.height > 0)
    if (rects.length === 0) return 0
    const tolleranza = Math.max(6, rects[0].height / 2)
    const fasce = []
    for (const r of rects.sort((a, b) => a.top - b.top)) {
      if (!fasce.some(f => Math.abs(f - r.top) <= tolleranza)) fasce.push(r.top)
    }
    return fasce.length
  }

  return {
    card: r(card),
    mark: { rect: r(mark), bg: bg(mark) },
    svg: svg ? { rect: r(svg), bg: bg(svg), height: svg.getAttribute('height') } : null,
    warn: warn ? { rect: r(warn), bg: bg(warn), righe: righeDi(warn), testo: warn.innerText } : null,
    code: code ? { rect: r(code), bg: bg(code) } : null,
    // Chi disegna davvero dietro il logo, chiesto al browser invece che al CSS.
    dietroIlLogo: (() => {
      const q = svg?.getBoundingClientRect()
      if (!q) return null
      const el = document.elementFromPoint(q.x + 4, q.y + q.height / 2)
      return el ? { tag: el.tagName, cls: String(el.getAttribute('class') ?? ''), bg: bg(el.nodeType === 1 ? el : el.parentElement) } : null
    })(),
  }
})

const m = await misura()
console.log(JSON.stringify(m, null, 1))

// ─── cosa deve valere ───────────────────────────────────────────────────────

// 1. Il logo non ha un fondo suo: sta sulla card, e basta. Un rettangolo colorato
//    dietro le lettere e' quello che si vedeva nella segnalazione.
const trasparente = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
check('il logo non ha un rettangolo di sfondo',
  trasparente(m.mark.bg) && trasparente(m.svg.bg), `mark ${m.mark.bg} · svg ${m.svg.bg}`)

// 2. Il logo sta dentro la card, con il suo margine: nella segnalazione toccava i bordi.
const dentro = m.svg.rect.x >= m.card.x && (m.svg.rect.x + m.svg.rect.w) <= (m.card.x + m.card.w)
check('il logo sta dentro la card senza sbordare', dentro,
  `logo ${m.svg.rect.x}..${m.svg.rect.x + m.svg.rect.w} · card ${m.card.x}..${m.card.x + m.card.w}`)

// 3. L'avviso si legge come una frase, non come quattro frammenti attorno al chip.
//    Due righe sono naturali in una card da 360px; quattro vogliono dire spezzato.
if (m.warn) {
  check('l\'avviso sta in al massimo due righe', m.warn.righe <= 2, `${m.warn.righe} righe`)
  check('il chip non e\' piu\' alto della riga di testo',
    m.code === null || m.code.rect.h <= 22, `chip alto ${m.code?.rect.h}px`)
} else {
  check('l\'avviso «server non configurato» compare', false, 'nessun .warn in pagina')
}

// Le foto solo se qualcuno le chiede (`node tools/prova-login.mjs /tmp/login`), come
// le altre sonde: una prova che lascia file nella radice del repo a ogni giro sporca
// l'albero di chi la esegue.
const foto = process.argv[2]
if (foto) await pagina.screenshot({ path: `${foto}-scuro.png` })

// ─── e la stessa cosa sul chiaro ────────────────────────────────────────────
//
// I due temi non sono lo stesso disegno con un colore diverso: `color-mix` su una
// variabile che cambia puo' dare un fondo leggibile su uno e piatto sull'altro, e il
// difetto di partenza (`.mark` dell'evidenziazione) si vedeva su entrambi ma con due
// facce diverse. Costa un `emulateMedia` e un secondo giro di misure.
await pagina.emulateMedia({ colorScheme: 'light' })
await pagina.waitForTimeout(150)
const chiaro = await misura()
check('sul chiaro il logo non ha un rettangolo di sfondo',
  trasparente(chiaro.mark.bg) && trasparente(chiaro.svg.bg),
  `mark ${chiaro.mark.bg}`)
check('sul chiaro il logo sta dentro la card',
  chiaro.svg.rect.x >= chiaro.card.x
  && (chiaro.svg.rect.x + chiaro.svg.rect.w) <= (chiaro.card.x + chiaro.card.w))
check('sul chiaro l\'avviso sta in al massimo due righe',
  chiaro.warn.righe <= 2, `${chiaro.warn.righe} righe`)
if (foto) {
  await pagina.screenshot({ path: `${foto}-chiaro.png` })
  console.log(`schermate in ${foto}-scuro.png e ${foto}-chiaro.png`)
}

await b.close()
await s.stop()
rmSync(CASA, { recursive: true, force: true })
process.exitCode = falli === 0 ? 0 : 1
