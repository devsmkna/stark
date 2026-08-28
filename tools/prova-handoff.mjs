// Guarda il picker dei modelli nella barra di stato, invece di descriverlo.
//   node tools/prova-handoff.mjs
//
// Costo: zero quota. Apre una sessione vera (l'handshake non è un turno) e **non**
// preme mai «Write handoff», che è l'unico bottone che spenderebbe qualcosa.
//
// Quello che si vuole vedere, e che leggendo il codice non si vede: che il menu del
// modello mostri il catalogo intero raggruppato per agent, che i modelli dell'altro
// agent portino la nota `handoff`, e che la conferma dica il costo **prima**.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const HOME = '/tmp/stark-handoff-ui'
rmSync(HOME, { recursive: true, force: true })
mkdirSync(resolve(HOME, 'sessioni'), { recursive: true })
const LAVORO = '/tmp/stark-handoff-lavoro'
mkdirSync(LAVORO, { recursive: true })

process.env['STARK_HOME'] = HOME
const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

// Una chat vera: il chip del modello è spento su una conversazione senza processo
// dietro (`modificabile()` guarda `store.live`), quindi un journal finto non basta.
const r = await fetch(`${s.url}/api/sessions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd: LAVORO }),
})
const { id } = await r.json()
console.log('chat', id)

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto(`${s.url}/chat/${id}?token=${s.token}`, { waitUntil: 'load' })
await p.waitForTimeout(4000)

// Il chip del modello è l'ultimo `.tune` della barra: gli altri sono le opzioni non-model.
const chip = p.locator('.status .r .tune').last()
await chip.click()
await p.waitForTimeout(3500)   // il catalogo: già scaldato dal daemon, ma la prima volta

const leggi = () => p.evaluate(() => {
  const menu = document.querySelector('.status .r .menu')
  if (!menu) return { errore: 'nessun menu' }
  const voci = [...menu.querySelectorAll('.mi')]
  const r = menu.getBoundingClientRect()
  const s = menu.querySelector('.msearch')
  const sr = s?.getBoundingClientRect()
  return {
    righe: voci.length,
    testi: voci.slice(0, 4).map(v => v.textContent.replace(/\s+/g, ' ').trim()),
    altezza: +r.height.toFixed(1),
    dentroSchermo: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
    // La casella deve restare visibile anche con l'elenco scrollato: è `sticky`.
    ricercaVisibile: !!sr && sr.bottom <= r.bottom + 1 && sr.top >= r.top - 1,
    ricercaInFondo: !!sr && Math.abs(sr.bottom - r.bottom) < 2,
    scartoSotto: sr ? +(r.bottom - sr.bottom).toFixed(1) : null,
    // Tutte le righe larghe uguali, e alte uguali: e' cio' che rende scorribile un
    // elenco di 151 voci. Si misura, perche' a occhio 2px di differenza non si vedono
    // ma 20 si'.
    larghezze: [...new Set(voci.map(v => +v.getBoundingClientRect().width.toFixed(0)))],
    altezze: [...new Set(voci.filter(v => !v.classList.contains('dis'))
      .map(v => +v.getBoundingClientRect().height.toFixed(0)))],
    sbordano: voci.filter(v => v.getBoundingClientRect().right > r.right + 1).length,
    menuW: +r.width.toFixed(0),
    pickW: +(menu.querySelector('.mpick')?.getBoundingClientRect().width.toFixed(0) ?? -1),
    pickDisplay: menu.querySelector('.mpick') ? getComputedStyle(menu.querySelector('.mpick')).display : '?',
    unaRigaDisplay: voci[2] ? getComputedStyle(voci[2]).display : '?',
    unaRigaW: voci[2] ? +voci[2].getBoundingClientRect().width.toFixed(0) : -1,
  }
})

console.log('1 · agent:', await leggi())
await p.screenshot({ path: '/tmp/handoff-1-agent.png' })

// Si entra in OpenCode, che è quello con 151 modelli.
await p.locator('.status .r .menu .mi', { hasText: 'OpenCode' }).first().click()
await p.waitForTimeout(400)
const dentro = await leggi()
console.log('2 · dentro OpenCode:', dentro)
await p.screenshot({ path: '/tmp/handoff-2-modelli.png' })

// La ricerca, con l'elenco scrollato in fondo: è il caso in cui `sticky` conta.
await p.locator('.status .r .menu').evaluate(m => { m.scrollTop = m.scrollHeight })
await p.waitForTimeout(200)
console.log('3 · scrollato in fondo:', await leggi())

await p.locator('.status .r .menu .msearch input').fill('sonnet')
await p.waitForTimeout(400)
const cercato = await leggi()
console.log('4 · cercando "sonnet":', cercato)
await p.screenshot({ path: '/tmp/handoff-3-ricerca.png' })

// La conferma: una voce di un altro agent. Non spende niente — apre solo il riquadro
// che dice cosa costerebbe. Si svuota prima la ricerca: con «sonnet» in casella l'unico
// risultato e' di Claude Code, cioe' proprio l'agent che NON ha la voce da premere —
// la prima versione di questa sonda diceva «nessuna voce di un altro agent» e sembrava
// un difetto della UI mentre era un difetto suo.
// Svuotare la ricerca riporta al gruppo in cui si era, non al primo livello: NON si
// riclicca «OpenCode», che li' dentro e' la riga «indietro» e farebbe uscire.
await p.locator('.status .r .menu .msearch input').fill('')
await p.waitForTimeout(300)
const altro = p.locator('.status .r .menu .mi', { has: p.locator('.tag', { hasText: 'handoff' }) }).first()
if (await altro.count()) {
  await altro.click()
  await p.waitForTimeout(600)
  const conferma = await p.evaluate(() => {
    const menu = document.querySelector('.status .r .menu')
    const nota = menu?.querySelector('.pnote')?.textContent.replace(/\s+/g, ' ').trim()
    const bottoni = [...(menu?.querySelectorAll('.hrow .mi') ?? [])].map(b => b.textContent.trim())
    const r = menu?.getBoundingClientRect()
    return {
      titolo: menu?.querySelector('.pg')?.textContent.trim(),
      bottoni,
      diceIlCosto: !!nota && /one turn/.test(nota),
      diceDoveVaIlFile: !!nota && /\.stark/.test(nota),
      dentroSchermo: !!r && r.left >= 0 && r.right <= innerWidth,
    }
  })
  console.log('5 · conferma:', conferma)
  await p.screenshot({ path: '/tmp/handoff-4-conferma.png' })
} else {
  console.log('5 · conferma: nessuna voce di un altro agent')
}

// ─── e a 390px ───────────────────────────────────────────────────────────────
// Sotto gli 860px la tendina non e' piu' ancorata al chip ma ai due bordi dello
// schermo (vedi il commento in Status.svelte), quindi la larghezza fissa da 290px NON
// si applica: e' il caso in cui una regola scritta per il desktop rompe il telefono, e
// va guardato invece che dedotto.
const q = await b.newPage({ viewport: { width: 390, height: 844 } })
await q.goto(`${s.url}/chat/${id}?token=${s.token}`, { waitUntil: 'load' })
await q.waitForTimeout(4000)
await q.locator('.status .r .tune').last().click()
await q.waitForTimeout(3000)
await q.locator('.status .r .menu .mi', { hasText: 'OpenCode' }).first().click()
await q.waitForTimeout(500)
const stretto = await q.evaluate(() => {
  const menu = document.querySelector('.status .r .menu')
  if (!menu) return { errore: 'nessun menu' }
  const voci = [...menu.querySelectorAll('.mi')]
  const r = menu.getBoundingClientRect()
  const sr = menu.querySelector('.msearch')?.getBoundingClientRect()
  return {
    righe: voci.length,
    larghezze: [...new Set(voci.map(v => +v.getBoundingClientRect().width.toFixed(0)))],
    dentroSchermo: r.left >= 0 && r.right <= innerWidth,
    sbordano: voci.filter(v => v.getBoundingClientRect().right > r.right + 1).length,
    ricercaVisibile: !!sr && sr.bottom <= r.bottom + 1,
    // Nessun testo tagliato di netto: l'ellissi c'e' o non serve.
    tagliati: voci.filter(v => {
      const lb = v.querySelector('.lb')
      return lb && lb.scrollWidth > lb.clientWidth + 1 && getComputedStyle(lb).textOverflow !== 'ellipsis'
    }).length,
  }
})
console.log('6 · a 390px:', stretto)
await q.screenshot({ path: '/tmp/handoff-5-stretto.png' })

// ─── e in tema scuro ─────────────────────────────────────────────────────────
// Non è ridondante: il bordo di default dei `<button>` (`2px outset`) su fondo chiaro
// quasi non si vede, su fondo scuro è una cornice grigia attorno a ogni riga. Il
// difetto è stato segnalato da uno screenshot in tema scuro, e lì va riguardato.
const d = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })
await d.goto(`${s.url}/chat/${id}?token=${s.token}`, { waitUntil: 'load' })
await d.waitForTimeout(4000)
await d.locator('.status .r .tune').last().click()
await d.waitForTimeout(3000)
await d.screenshot({ path: '/tmp/handoff-6-scuro.png' })
console.log('7 · scuro:', await d.evaluate(() => {
  const v = document.querySelector('.status .r .menu .mpick .mi')
  const c = v ? getComputedStyle(v) : null
  return { bordo: c?.borderWidth ?? '?', larghezza: v ? +v.getBoundingClientRect().width.toFixed(0) : -1 }
}))

console.log('\nscreenshot in /tmp/handoff-*.png')
await b.close()
await s.close?.()
process.exit(0)
