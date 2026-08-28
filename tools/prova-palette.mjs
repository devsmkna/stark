// Guarda la palette e le scorciatoie nella UI vera invece di descriverle.
//   node tools/prova-palette.mjs
// Costo zero di quota: journal finti, nessun processo agent.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOME = '/tmp/stark-palette-ui'
rmSync(HOME, { recursive: true, force: true })
mkdirSync(resolve(HOME, 'sessioni'), { recursive: true })

// Tre conversazioni finte, con nomi che servono a distinguere il filtro: due sullo
// stesso progetto e una con «TODOLIST» nel titolo, che è il caso raccontato.
const chat = (id, titolo, cwd, ts) => {
  const carichi = [
    { k: 'session.created', cwd, model: 'claude-opus-5', mode: 'auto' },
    { k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: titolo }] },
    { k: 'turn.ended', turnId: 't1', reason: 'completed' },
    { k: 'session.state', state: 'closed' },
  ]
  const righe = carichi.map((payload, i) =>
    JSON.stringify({ v: 1, seq: i + 1, ts: ts + i, sessionId: id, payload }))
  writeFileSync(resolve(HOME, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')
}
const T = 1780000000000
chat('11111111-1111-4111-8111-111111111111', 'TODOLIST del progetto', '/tmp/alfa', T)
chat('22222222-2222-4222-8222-222222222222', 'rifare la barra di stato', '/tmp/alfa', T + 1000)
chat('33333333-3333-4333-8333-333333333333', 'il tunnel non regge', '/tmp/beta', T + 2000)

process.env['STARK_HOME'] = HOME
const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log('daemon', s.url)

const b = await chromium.launch({ args: ['--no-sandbox'] })
// `mod` è ⌘ su Mac e Ctrl altrove: la prova deve premere il tasto della macchina su
// cui gira, se no misura una scorciatoia che su quella macchina non esiste.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const esiti = []
const dice = (t, v) => { esiti.push([t, v]); console.log(t, JSON.stringify(v)) }

for (const [w, h, tag] of [[1400, 900, 'desktop'], [390, 844, 'mobile']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
  await p.waitForTimeout(1500)

  // ─── si apre con la scorciatoia, non con un bottone ─────────────────────────
  await p.keyboard.press(`${MOD}+k`)
  await p.waitForTimeout(300)
  dice(`${tag}: la scorciatoia apre la palette`, { aperta: await p.locator('.pal').count() === 1 })

  await p.screenshot({ path: `/tmp/palette-aperta-${tag}.png` })
  const dentro = await p.evaluate(() => {
    const d = document.querySelector('.pal')
    if (!d) return null
    const r = d.getBoundingClientRect()
    return {
      righe: document.querySelectorAll('.pal .prow').length,
      dentroSchermo: r.right <= innerWidth + .5 && r.left >= -.5 && r.bottom <= innerHeight + .5,
      fuocoInCasella: document.activeElement?.classList.contains('field'),
      primaScelta: document.querySelector('.pal .prow.on') === document.querySelector('.pal .prow'),
    }
  })
  dice(`${tag}: com'è messa`, dentro)

  // ─── si filtra scrivendo ────────────────────────────────────────────────────
  await p.keyboard.type('todolist')
  await p.waitForTimeout(200)
  dice(`${tag}: «todolist» stringe a una riga`, await p.evaluate(() => ({
    righe: document.querySelectorAll('.pal .prow').length,
    titolo: document.querySelector('.pal .prow .pt')?.textContent?.trim(),
  })))

  // ─── Invio entra nella chat ─────────────────────────────────────────────────
  await p.keyboard.press('Enter')
  await p.waitForTimeout(1200)
  dice(`${tag}: Invio apre quella conversazione`, await p.evaluate(() => ({
    palletteChiusa: document.querySelectorAll('.pal').length === 0,
    indirizzo: location.pathname,
    titoloInBarra: document.querySelector('.bar .t')?.textContent?.trim(),
  })))

  // ─── il filtro prende anche il progetto ─────────────────────────────────────
  await p.keyboard.press(`${MOD}+k`)
  await p.waitForTimeout(250)
  await p.keyboard.type('alfa')
  await p.waitForTimeout(200)
  dice(`${tag}: si cerca anche per progetto`, await p.evaluate(() => ({
    righe: document.querySelectorAll('.pal .prow').length,
  })))

  // ─── le frecce muovono la scelta, Esc chiude ────────────────────────────────
  await p.keyboard.press('ArrowDown')
  await p.waitForTimeout(120)
  dice(`${tag}: la freccia sposta la scelta`, await p.evaluate(() => {
    const righe = [...document.querySelectorAll('.pal .prow')]
    return { indice: righe.findIndex(r => r.classList.contains('on')) }
  }))
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
  dice(`${tag}: Esc chiude`, { chiusa: await p.locator('.pal').count() === 0 })

  // ─── la regola che conta: dentro una casella, solo con `mod` ────────────────
  // Una lettera nuda è testo. Se la palette si aprisse scrivendo un prompt sarebbe
  // peggio che non averla; con ⌘ invece deve aprirsi eccome, perché è lì che si sta.
  // La casella dell'elenco: una chat finta è ferma, quindi il suo dock non ha una
  // textarea da usare — questa è una casella di testo come quella, e la regola è la
  // stessa (`INPUT` o `TEXTAREA`, dice il gancio).
  const casella = p.locator('.find input').first()
  if (await casella.count()) {
    await casella.click()
    await p.keyboard.type('k')
    await p.waitForTimeout(150)
    const dopoLettera = await p.locator('.pal').count()
    await p.keyboard.press(`${MOD}+k`)
    await p.waitForTimeout(250)
    dice(`${tag}: nella casella, K scrive e mod+K apre`, {
      letteraNonApre: dopoLettera === 0,
      modApre: await p.locator('.pal').count() === 1,
    })
    await p.keyboard.press('Escape')
    await p.waitForTimeout(150)
  }

  await p.screenshot({ path: `/tmp/palette-${tag}.png` })
  await p.close()
}

// ─── la sezione nelle impostazioni ────────────────────────────────────────────
{
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
  await p.goto(`${s.url}/?token=${s.token}`, { waitUntil: 'load' })
  await p.waitForTimeout(1500)
  await p.click('[aria-label="Settings"], .side [title="Settings"]').catch(() => {})
  await p.waitForTimeout(400)
  if (!(await p.locator('.dlg').count())) {
    // il bottone cambia nome fra le versioni: si prende quello con l'icona giusta
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => x.querySelector('use[href="#i-gear"]'))
      b?.click()
    })
    await p.waitForTimeout(500)
  }
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.sn')].find(x => x.textContent?.includes('Shortcuts'))
    b?.click()
  })
  await p.waitForTimeout(400)
  await p.screenshot({ path: '/tmp/palette-sezione.png' })
  dice('settings: la sezione c\'è e mostra la combinazione', await p.evaluate(() => {
    const kb = document.querySelector('.kb')
    return { presente: !!kb, testo: kb?.textContent?.trim(), righe: document.querySelectorAll('.kb').length }
  }))

  // riassegnare: si preme il bottone e poi il tasto vero
  await p.click('.kb')
  await p.waitForTimeout(200)
  const inCattura = await p.evaluate(() => document.querySelector('.kb')?.textContent?.trim())
  await p.keyboard.press(`${MOD}+Shift+P`)
  await p.waitForTimeout(600)
  dice('settings: la combinazione si registra premendola', await p.evaluate(() => ({
    dialogo: !!document.querySelector('.dlg'),
    sezione: document.querySelector('.dt')?.textContent?.trim() ?? null,
    testo: document.querySelector('.kb')?.textContent?.trim() ?? null,
    reset: !!document.querySelector('.lnk'),
  })))
  console.log('   (in cattura diceva:', inCattura, ')')

  // e sopravvive: la nuova scorciatoia apre, la vecchia no
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  await p.keyboard.press(`${MOD}+k`)
  await p.waitForTimeout(250)
  const vecchia = await p.locator('.pal').count()
  await p.keyboard.press(`${MOD}+Shift+P`)
  await p.waitForTimeout(250)
  // La vecchia **non** deve aprire: il nome dice l'attesa, se no una misura giusta
  // sembrerebbe un rosso.
  dice('settings: dopo il cambio vale la nuova, non la vecchia', {
    vecchiaZitta: vecchia === 0, nuovaApre: await p.locator('.pal').count() === 1,
  })
  await p.screenshot({ path: '/tmp/palette-settings.png' })
  await p.close()
}

await b.close()
await s.stop()
const ko = esiti.filter(([, v]) => v && Object.values(v).some(x => x === false)).length
console.log(`\n${esiti.length - ko}/${esiti.length} misure senza sorprese`)
