// Il pannello «telefono» mostra il comando giusto per il sistema su cui gira il daemon?
//
// Su questa macchina Tailscale c'e' ed e' collegato, quindi il passo «installato» e'
// verde e il testo non si vede mai. Per guardarlo davvero si intercetta `/api/phone` e
// si riscrive la risposta: `fatto: false` sul primo passo, e `so` a turno. Cosi' si vede
// la resa **vera** del componente per tutti e quattro i sistemi, non la si deduce dalla
// mappa nel sorgente.
//
// Costo zero di quota: nessun processo agent, casa in /tmp, porta effimera.
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-tailscale')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

const { startDaemon } = await import('../src/daemon/server.ts')
const d = await startDaemon({ port: 0, token: 'tailscale'.padEnd(64, '0') })

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ args: ['--no-sandbox'] })

for (const so of ['macos', 'linux', 'wsl', 'windows']) {
  const page = await browser.newPage({ viewport: { width: 620, height: 760 } })
  await page.route('**/api/phone', async route => {
    const res = await route.fetch()
    const body = await res.json()
    body.so = so
    // Il passo «installato» finto-non-fatto: e' l'unico stato in cui il testo si vede.
    body.tailscale.passi = body.tailscale.passi.map(p =>
      p.id === 'installato' ? { ...p, fatto: false } : p)
    await route.fulfill({ response: res, body: JSON.stringify(body) })
  })
  await page.goto(`${d.url}/?token=${d.token}`, { waitUntil: 'load' })
  await page.waitForTimeout(900)
  // Il bottone letto dal sorgente, non indovinato (`Sidebar.svelte`: la campanella e il
  // telefono condividono la classe `.bell`, li distingue l'aria-label).
  await page.click('button[aria-label="Use STARK from your phone"]')
  await page.waitForTimeout(700)
  const letto = await page.evaluate(() => {
    const passo = [...document.querySelectorAll('.passo')].find(p => /this machine/i.test(p.textContent ?? ''))
    if (!passo) return { trovato: false }
    return {
      trovato: true,
      testo: passo.querySelector('.d')?.textContent?.trim().slice(0, 70) ?? '',
      // `scrollWidth > clientWidth` vuol dire che una parte del comando e' fuori dal
      // riquadro: e' il difetto trovato guardando lo screenshot, e va misurato non
      // guardato — su un'altra larghezza taglierebbe un comando diverso.
      comandi: [...passo.querySelectorAll('.cmd')].map(c => {
        const code = c.querySelector('code')
        return {
          dove: c.querySelector('.dove')?.textContent ?? '',
          cmd: code?.textContent ?? '',
          tagliato: !!code && code.scrollWidth > code.clientWidth + 1,
        }
      }),
    }
  })
  console.log(`\n── ${so} ──`)
  if (!letto.trovato) { console.log('   pannello non trovato'); await page.close(); continue }
  console.log(`   ${letto.testo}…`)
  for (const c of letto.comandi) {
    console.log(`   ${c.dove ? c.dove + ': ' : ''}${c.cmd}${c.tagliato ? '   ← TAGLIATO' : ''}`)
  }
  if (process.argv[2]) await page.screenshot({ path: `${process.argv[2]}-${so}.png` })
  await page.close()
}
await browser.close(); await d.stop(); process.exit(0)
