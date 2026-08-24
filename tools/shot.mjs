// Fotografa la UI a costo zero di quota, per guardarla invece di descriverla.
//   node tools/shot.mjs <url> <fuori.png> [selettore-da-cliccare]
import { chromium } from 'playwright-core'
const [url, out, click] = process.argv.slice(2)
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 },
  colorScheme: process.env['DARK'] ? 'dark' : 'light' })
await page.goto(url, { waitUntil: 'networkidle' })
if (click) { await page.click(click); await page.waitForTimeout(700) }
await page.screenshot({ path: out })
await browser.close()
console.log('scritto', out)
