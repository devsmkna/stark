// Le icone dell'app, generate dal marchio che c'è già invece che disegnate a parte.
//
//   node tools/gen-app-icons.mjs
//
// Servono perché su iOS le notifiche push arrivano **solo** a un sito aggiunto alla
// schermata Home, e un sito senza icona ci finisce come uno screenshot della pagina.
// Il segno è la «A» col gradiente presa da `ui/src/components/Logo.svelte`: è la parte
// riconoscibile del marchio, ed è l'unica che regge a 180 pixel — la scritta intera,
// a quella misura, diventa cinque macchie.
//
// Rigenerarle è questo comando. Il sorgente resta il logo, quindi non esistono due
// disegni da tenere allineati: se cambia il logo, si rilancia.

import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const QUI = dirname(fileURLToPath(import.meta.url))
const RADICE = resolve(QUI, '..')
const FUORI = resolve(RADICE, 'ui/public')

// La «A» sta dentro Logo.svelte: la si prende da lì, non se ne tiene una copia.
const logo = readFileSync(resolve(RADICE, 'ui/src/components/Logo.svelte'), 'utf8')
const a = /<path fill="url\(#starkA\)" d="([^"]+)"/.exec(logo)
if (!a) throw new Error('la «A» col gradiente non si trova in Logo.svelte')

const pagina = (lato) => `<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6482F3"/><stop offset="1" stop-color="#9A6FEF"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="#0E1118"/>
  <g id="mark" fill="url(#g)"><g transform="translate(0,238) scale(0.1,-0.1)"><path d="${a[1]}"/></g></g>
</svg></body></html>`

const browser = await chromium.launch({ args: ['--no-sandbox'] })
for (const lato of [180, 192, 512]) {
  const p = await browser.newPage({ viewport: { width: lato, height: lato } })
  await p.setContent(pagina(lato))
  // Il riquadro vero del segno lo dice il browser, non un numero indovinato: si misura
  // e lo si centra, così l'icona resta centrata anche se il logo cambia.
  await p.evaluate(() => {
    const g = document.getElementById('mark')
    const b = g.getBBox()
    const s = 62 / Math.max(b.width, b.height)          // 62 su 100: il resto è aria
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    g.setAttribute('transform', `translate(${50 - cx * s} ${50 - cy * s}) scale(${s})`)
  })
  const png = await p.screenshot({ omitBackground: false })
  writeFileSync(resolve(FUORI, `icona-${lato}.png`), png)
  console.log(`  ui/public/icona-${lato}.png`)
  await p.close()
}
await browser.close()
