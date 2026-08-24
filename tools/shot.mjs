// Fotografa la UI a costo zero di quota, per guardarla invece di descriverla.
//   node tools/shot.mjs <url> <fuori.png> [selettore-da-cliccare ...]
// I selettori si premono in fila: servono le schermate che stanno a due passi
// dall'apertura — gli effetti, per esempio, sono «scegli una chat» poi «apri».
import { chromium } from 'playwright-core'
const [url, out, ...clicks] = process.argv.slice(2)
// Nessun percorso a mano: playwright-core sa dov'è il browser che ha scaricato lui, e
// il numero di build cambia da macchina a macchina — scritto qui dentro, funzionava su
// una sola. Se manca: `npx playwright-core install chromium`.
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 },
  colorScheme: process.env['DARK'] ? 'dark' : 'light' })
// NON `networkidle`: la UI tiene aperti due flussi SSE — quello dell'elenco e
// quello della chat — quindi la rete non sta mai ferma e l'attesa scadrebbe sempre.
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(900)
for (const click of clicks) { await page.click(click); await page.waitForTimeout(700) }
await page.screenshot({ path: out })
await browser.close()
console.log('scritto', out)
