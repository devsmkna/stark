// Le icone dell'app e la favicon, generate dal marchio che c'è già invece che
// disegnate a parte.
//
//   node tools/gen-app-icons.mjs
//
// Le icone dell'app servono perché su iOS le notifiche push arrivano **solo** a un
// sito aggiunto alla schermata Home, e un sito senza icona ci finisce come uno
// screenshot della pagina. Il segno è la «A» col gradiente presa da
// `ui/src/components/Logo.svelte`: è la parte riconoscibile del marchio, ed è l'unica
// che regge a 180 pixel — la scritta intera, a quella misura, diventa cinque macchie.
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

// I due fondi non sono un capriccio: l'icona dell'app sta su una schermata Home, dove
// un riquadro scuro si stacca dallo sfondo, mentre la favicon sta nella barra delle
// schede, che nella stragrande maggioranza dei casi è chiara — un quadratino scuro lì
// sarebbe una macchia, non un marchio. `#0E1118` e `#FBFBFD` sono gli stessi `--ground`
// dei due temi in `ui/src/app.css`.
const SCURO = '#0E1118'
const CHIARO = '#FBFBFD'

// La «A» sta dentro Logo.svelte: la si prende da lì, non se ne tiene una copia.
const logo = readFileSync(resolve(RADICE, 'ui/src/components/Logo.svelte'), 'utf8')
const a = /<path fill="url\(#starkA\)" d="([^"]+)"/.exec(logo)
if (!a) throw new Error('la «A» col gradiente non si trova in Logo.svelte')

const pagina = (lato, fondo) => `<!doctype html><html><body style="margin:0">
${svg(lato, fondo, `<g transform="translate(0,238) scale(0.1,-0.1)"><path d="${a[1]}"/></g>`)}
</body></html>`

const svg = (lato, fondo, dentro) => `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6482F3"/><stop offset="1" stop-color="#9A6FEF"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="${fondo}"/>
  <g id="mark" fill="url(#g)">${dentro}</g>
</svg>`

/**
 * Centra il segno dentro i 100×100 e restituisce la trasformazione che l'ha fatto.
 * Il riquadro vero lo dice il browser (`getBBox`), non un numero indovinato: così
 * l'icona resta centrata anche se il logo cambia.
 * `aria` è quanto del lato occupa il segno: 62 per l'app (il sistema ci disegna attorno
 * la sua cornice), 82 per la favicon, che a 16 pixel non ha spazio da regalare — lì
 * l'aria attorno la mette già la barra delle schede.
 */
const centra = (p, aria) => p.evaluate((aria) => {
  const g = document.getElementById('mark')
  const b = g.getBBox()
  const s = aria / Math.max(b.width, b.height)
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  const t = `translate(${50 - cx * s} ${50 - cy * s}) scale(${s})`
  g.setAttribute('transform', t)
  return t
}, aria)

const browser = await chromium.launch({ args: ['--no-sandbox'] })

// Le icone dell'app: fondo scuro, e tre misure perché iOS e il manifest ne chiedono
// di diverse.
for (const lato of [180, 192, 512]) {
  const p = await browser.newPage({ viewport: { width: lato, height: lato } })
  await p.setContent(pagina(lato, SCURO))
  await centra(p, 62)
  writeFileSync(resolve(FUORI, `icona-${lato}.png`), await p.screenshot({ omitBackground: false }))
  console.log(`  ui/public/icona-${lato}.png`)
  await p.close()
}

// La favicon. Quella vera è l'SVG: una scheda la disegna a misure diverse (16, 32, e il
// doppio su schermo denso) e un vettore le regge tutte senza tenere in giro una PNG per
// ciascuna. Il PNG resta come ripiego per i browser che l'SVG non lo guardano, ed è la
// ragione per cui `index.html` dichiara entrambi.
{
  const p = await browser.newPage({ viewport: { width: 32, height: 32 } })
  await p.setContent(pagina(32, CHIARO))
  // La trasformazione si misura una volta e si scrive dentro l'SVG che finisce su
  // disco: il file deve stare in piedi da solo, senza un browser che lo centri.
  const t = await centra(p, 82)
  writeFileSync(
    resolve(FUORI, 'favicon.svg'),
    svg(100, CHIARO, `<g transform="${t}"><g transform="translate(0,238) scale(0.1,-0.1)"><path d="${a[1]}"/></g></g>`)
      .replace(' width="100" height="100"', '') + '\n',
  )
  console.log('  ui/public/favicon.svg')
  writeFileSync(resolve(FUORI, 'favicon-32.png'), await p.screenshot({ omitBackground: false }))
  console.log('  ui/public/favicon-32.png')
  await p.close()
}

await browser.close()
