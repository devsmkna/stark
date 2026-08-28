// Guida la UI vera fino a una conversazione OpenCode, e la fotografa.
//
// Non e' una prova automatica da suite: e' lo strumento con cui si **guarda** una cosa
// invece di descriverla, come `tools/shot.mjs` ma con dei passi dentro. Serve perche'
// il percorso «scegli l'agent → apri → scrivi → leggi la risposta» tocca UI, daemon e
// adapter insieme, e ognuno dei tre puo' funzionare da solo mentre la catena e' rotta.
//
//   node tools/prova-opencode-ui.mjs <url-con-token> <cartella> [fuori.png]

import { chromium } from 'playwright-core'

const [url, cartella, out = '/tmp/opencode-ui.png'] = process.argv.slice(2)
// argv[5] (facoltativo): il modello da scegliere dalla barra prima di scrivere.
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const passi = []
const passo = (t) => { passi.push(t); console.log('·', t) }

await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(1200)

await page.click('[title="New chat"], .plus, button[aria-label*="New"]')
await page.waitForTimeout(600)
passo('riquadro «New chat» aperto')

// La scelta dell'agent compare **solo** se la macchina ne ha piu' di uno installato:
// se non c'e', questa prova non ha senso e va detto invece di fallire per timeout.
const voce = page.locator('.instbtn', { hasText: 'OpenCode' })
if (await voce.count() === 0) {
  console.log('\nNIENTE DA PROVARE: la UI non offre OpenCode (non installato?)')
  await page.screenshot({ path: out }); await browser.close(); process.exit(2)
}
await voce.click()
passo('scelto OpenCode')

await page.fill('input[placeholder*="/"], .pathrow input', cartella)
await page.waitForTimeout(300)
await page.click('button.pri')
passo('premuto Start')

// Si aspetta la casella di scrittura: e' il segno che la sessione e' viva, e aspettarlo
// invece di contare i secondi e' la differenza fra una prova e un'illusione.
await page.waitForSelector('.dock textarea, textarea', { timeout: 60000 })
passo('la conversazione e\' aperta')

// Il modello: OpenCode sceglie il proprio default, che su questa macchina e' morto a
// monte. Cambiarlo dalla barra e' esattamente cio' che deve poter fare l'utente, quindi
// la prova lo fa **cliccando**, non via API.
const modello = process.argv[5]
if (modello) {
  const chip = page.locator('.status .tune', { hasText: '/' }).first()
  if (await chip.count() > 0) {
    await chip.click()
    await page.waitForTimeout(500)
    // Il menu mostra **l'etichetta** (`m.label ?? m.id`), non l'id: cercare l'id non
    // trova niente e il passo saltava in silenzio. Letto in `Status.svelte`.
    const voce = page.locator('.menu button.mi', { hasText: modello }).first()
    if (await voce.count() > 0) { await voce.click(); passo(`modello cambiato in ${modello}`) }
    else { console.log('  (nessuna voce «' + modello + '» nel menu)'); await page.keyboard.press('Escape') }
    await page.waitForTimeout(800)
  }
}

await page.fill('.dock textarea, textarea', 'Di\' soltanto: PRONTO')
await page.keyboard.press('Enter')
passo('prompt mandato')

// La risposta arriva quando il turno si chiude. Si guarda il DOM, non l'orologio.
let risposta = ''
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000)
  risposta = await page.evaluate(() => {
    const t = document.querySelectorAll('.turn')
    const ultimo = t[t.length - 1]
    return ultimo ? (ultimo.textContent ?? '').replace(/\s+/g, ' ').trim() : ''
  })
  if (/PRONTO/i.test(risposta.replace('Di\' soltanto: PRONTO', ''))) break
}
await page.waitForTimeout(800)
await page.screenshot({ path: out })

const barra = await page.evaluate(() => {
  const s = document.querySelector('.status')
  return s ? (s.textContent ?? '').replace(/\s+/g, ' ').trim() : '(nessuna barra)'
})
console.log('\nbarra di stato:', barra)
console.log('ultimo turno   :', risposta.slice(0, 200))
console.log('scritto', out)
await browser.close()
