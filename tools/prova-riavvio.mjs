// Riavvia un daemon di prova dalla sua stessa UI, e misura che torni su.
//   node tools/prova-riavvio.mjs
// Costo zero di quota: nessuna sessione agent, solo il daemon.
//
// Gira su una `STARK_HOME` sua e su una porta sua: il riavvio passa da `stark up`, che
// senza questo accenderebbe (o spegnerebbe) il daemon vero dell'utente.
import { chromium } from 'playwright-core'
import { spawnSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOME = '/tmp/stark-riavvio-ui'
const PORTA = '45711'
const URL = `http://127.0.0.1:${PORTA}`
rmSync(HOME, { recursive: true, force: true })
mkdirSync(resolve(HOME, 'sessioni'), { recursive: true })

// Il daemon gira **in un altro processo**, non dentro questo script: riavviarsi vuol
// dire uscire, e un daemon in-process porterebbe giù la prova insieme a sé — la prima
// versione di questa sonda moriva esattamente lì, a metà della misura che contava.
const env = { ...process.env, STARK_HOME: HOME, STARK_PORT: PORTA }
const CLI = resolve('src/cli/stark.ts')
spawnSync(process.execPath, [CLI, 'up', '--no-open'], { env, stdio: 'inherit' })
const token = readFileSync(resolve(HOME, 'token'), 'utf8').trim()

const vivo = async () => {
  try {
    const r = await fetch(`${URL}/api/health`, { headers: { authorization: `Bearer ${token}` } })
    return r.ok
  } catch { return false }
}
const pidOra = () => {
  try { return Number(readFileSync(resolve(HOME, 'daemon.pid'), 'utf8').trim()) } catch { return null }
}
console.log('daemon', URL, 'pid', pidOra())

const esiti = []
const dice = (t, v) => { esiti.push([t, v]); console.log(t, JSON.stringify(v)) }

// Una conversazione **viva**, per misurare l'avviso che dice quante se ne fermano.
// Aprirla è solo l'handshake, quindi non costa quota (nessun turno parte mai).
const apertura = await fetch(`${URL}/api/sessions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd: HOME }),
})
console.log('chat di prova aperta:', apertura.status)

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto(`${URL}/?token=${token}`, { waitUntil: 'load' })
await p.waitForTimeout(1200)

// Settings → System
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.querySelector('use[href="#i-gear"]'))?.click()
})
await p.waitForTimeout(500)
await p.evaluate(() => {
  [...document.querySelectorAll('.sn')].find(x => x.textContent?.includes('System'))?.click()
})
await p.waitForTimeout(1500)

dice('il bottone c\'è e non riavvia da solo', await p.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Restart…')
  const r = b?.getBoundingClientRect()
  return {
    presente: !!b,
    dentroSchermo: r ? r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5 : null,
    // premibile davvero, non solo disegnato lì
    premibile: r ? !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      ?.closest('button') : null,
  }
}))

// Il primo clic **chiede**, non riavvia.
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Restart…')?.click()
})
await p.waitForTimeout(300)
dice('il primo clic chiede conferma e dice il costo', await p.evaluate(() => ({
  avviso: document.querySelector('.fgroup .notice')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 90),
  diceQuanteNeFerma: /stops \d+ running chat/.test(
    document.querySelector('.fgroup .notice')?.textContent ?? ''),
  conferma: [...document.querySelectorAll('button')].some(x => x.textContent?.trim() === 'Restart now'),
  annulla: [...document.querySelectorAll('button')].some(x => x.textContent?.trim() === 'Cancel'),
})))
dice('e il daemon è ancora vivo', { vivo: await vivo() })

// Annullare torna indietro senza fare niente.
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Cancel')?.click()
})
await p.waitForTimeout(200)
dice('Cancel torna al bottone', await p.evaluate(() => ({
  tornato: [...document.querySelectorAll('button')].some(x => x.textContent?.trim() === 'Restart…'),
})))

// ─── il riavvio vero ─────────────────────────────────────────────────────────
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Restart…')?.click()
})
await p.waitForTimeout(250)
const pidPrima = pidOra()
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Restart now')?.click()
})

// Muore…
let morto = false
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 250))
  if (!await vivo()) { morto = true; break }
}
dice('il daemon si ferma', { morto, dopo: 'al massimo 10s' })

// …e torna. La ricompilazione della UI ci mette un secondo o due, quindi si aspetta.
let tornato = false
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 500))
  if (await vivo()) { tornato = true; break }
}
dice('e torna su da solo', { tornato, pidDiverso: pidOra() !== pidPrima, pidPrima, pidDopo: pidOra() })

if (tornato) {
  // La pagina aperta si ricollega da sé: è la promessa scritta nell'avviso.
  await p.waitForTimeout(4000)
  dice('la pagina si ricollega senza ricaricare', await p.evaluate(() => ({
    // `.fatal` è il cartello «daemon irraggiungibile»: se il flusso è tornato, non c'è.
    collegata: !document.querySelector('.fatal'),
    elencoVisibile: !!document.querySelector('.side'),
    // «Restarting» deve **sparire** da sé: lasciarlo lì direbbe una cosa falsa mentre
    // tutto il resto della pagina si è già ricollegato.
    avvisoSparito: ![...document.querySelectorAll('.notice')]
      .some(n => n.textContent?.includes('Restarting')),
    bottoneTornato: [...document.querySelectorAll('button')]
      .some(x => x.textContent?.trim() === 'Restart…'),
  })))
}

await p.screenshot({ path: '/tmp/riavvio.png' })
await b.close()

// Si spegne il daemon di prova, che ora è un processo diverso da quello acceso qui.
spawnSync(process.execPath, [CLI, 'stop'], { env, stdio: 'inherit' })

const ko = esiti.filter(([, v]) => v && Object.values(v).some(x => x === false)).length
console.log(`\n${esiti.length - ko}/${esiti.length} misure senza sorprese`)
process.exit(0)
