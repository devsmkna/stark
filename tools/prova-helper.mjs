// Guarda l'helper nella UI vera, invece di descriverlo.
//   node tools/prova-helper.mjs [--chiedi]
// Con `--chiedi` manda anche un prompt vero (costa un turno corto).
import { chromium } from 'playwright-core'
import { rmSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const HOME = '/tmp/stark-helper-ui'
rmSync(HOME, { recursive: true, force: true })
mkdirSync(resolve(HOME, 'sessioni'), { recursive: true })
// Un journal finto, per avere qualcosa nell'elenco a fianco: l'helper deve vedersi
// **accanto** a una conversazione, non su una schermata vuota.
const sorgenti = readdirSync('/tmp').filter(d => d.startsWith('stark-offline-'))
const ultimo = sorgenti.sort().at(-1)
if (ultimo && existsSync(`/tmp/${ultimo}/s.jsonl`)) {
  cpSync(`/tmp/${ultimo}/s.jsonl`, resolve(HOME, 'sessioni', '11111111-1111-4111-8111-111111111111.jsonl'))
}

process.env['STARK_HOME'] = HOME
const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

const chiedi = process.argv.includes('--chiedi')
const b = await chromium.launch({ args: ['--no-sandbox'] })

async function giro(w, h, tag, scuro) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scuro ? 'dark' : 'light' })
  await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
  await p.waitForTimeout(1200)
  await p.click('[aria-label="Helper"]')
  await p.waitForSelector('.helper', { timeout: 5000 })
  // L'apertura vera costa un handshake: si aspetta che la chat ci sia.
  await p.waitForTimeout(4000)

  const m = await p.evaluate(() => {
    const h = document.querySelector('.helper')
    const side = document.querySelector('.side')
    const r = e => e ? +e.getBoundingClientRect().width.toFixed(1) : null
    const ro = document.querySelector('.hstatus .ro')
    const mdl = document.querySelector('.hstatus .mdl')
    const inp = document.querySelector('.hinput')
    const box = h?.getBoundingClientRect()
    return {
      larghezza: r(h), sidebar: r(side), finestra: innerWidth,
      frazione: h ? +(r(h) / innerWidth).toFixed(3) : null,
      dentroSchermo: box ? box.right <= innerWidth + 0.5 && box.left >= -0.5 : null,
      readOnlyVisibile: !!ro && ro.getBoundingClientRect().width > 0,
      chipModello: mdl?.textContent?.trim(),
      casellaLarga: r(inp),
      // premibile davvero, non solo disegnato li'
      chipPremibile: (() => {
        const q = mdl?.getBoundingClientRect(); if (!q) return null
        const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)
        return !!el && !!el.closest('.mdl')
      })(),
    }
  })
  console.log(tag, JSON.stringify(m))
  await p.screenshot({ path: `/tmp/h-${tag}.png` })

  // il menu dei modelli
  await p.click('.hstatus .mdl')
  await p.waitForTimeout(3500)
  const menu = await p.evaluate(() => {
    const pop = document.querySelector('.hpop')
    if (!pop) return { aperto: false }
    const r = pop.getBoundingClientRect()
    const voci = [...pop.querySelectorAll('.mi')].length
    const gruppi = [...pop.querySelectorAll('.pg')].map(e => e.textContent.trim())
    const fuori = [...pop.querySelectorAll('.mi')].filter(e => {
      const q = e.getBoundingClientRect()
      return q.right > innerWidth + .5 || q.left < -.5
    }).length
    const spunte = pop.querySelectorAll('.mi .tick').length
    const triangoli = pop.querySelectorAll('.mi .warn').length
    const avvisiGruppo = pop.querySelectorAll('.pnote').length
    return { aperto: true, larghezza: +r.width.toFixed(1), voci, gruppi, spunte, triangoli, avvisiGruppo,
      dentroSchermo: r.right <= innerWidth + .5 && r.left >= -.5, vociFuori: fuori,
      piuLargoDelPannello: r.width > document.querySelector('.helper').getBoundingClientRect().width }
  })
  console.log(tag + ':menu', JSON.stringify(menu))
  await p.screenshot({ path: `/tmp/h-${tag}-menu.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  if (chiedi && tag === 'largo') {
    await p.fill('.hinput', 'In una riga sola: cosa e\' un cgroup?')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(25000)
    const risposta = await p.evaluate(() => ({
      bolle: document.querySelectorAll('.hq').length,
      risposte: document.querySelectorAll('.ha').length,
      testo: document.querySelector('.ha')?.textContent?.slice(0, 160),
      elencoHaHelper: [...document.querySelectorAll('.sit .ttl')].map(e => e.textContent),
    }))
    console.log('risposta', JSON.stringify(risposta))
    await p.screenshot({ path: '/tmp/h-risposta.png' })
  }
  await p.close()
}

await giro(1400, 860, 'largo', false)
await giro(1400, 860, 'scuro', true)
await giro(390, 844, 'stretto', false)
await b.close()
await s.stop()
console.log('fatto')
