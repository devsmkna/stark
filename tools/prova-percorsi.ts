// I percorsi citati in chat prendono i bottoni? E — la metà che conta — quelli che
// percorsi non sono restano testo?
//
// Perché questa prova esiste e non basta guardare la schermata: la funzione **fallisce
// in silenzio** in entrambi i versi. Se la rilevazione non scatta, il testo resta testo
// e non succede niente di visibile; se scatta troppo, spuntano due bottoni su `and/or` e
// uno di quei bottoni non aprirà mai niente. Nessuna delle due dà errore, e la prima è
// esattamente com'era prima della funzione — cioè indistinguibile dal non averla scritta.
//
// La domanda vera non è «i percorsi si accendono» ma «si accendono **solo** i percorsi»,
// quindi i casi negativi contano quanto i positivi e stanno nella stessa tabella.
//
// Casa in /tmp e porta effimera: non tocca né le conversazioni vere né il daemon acceso.
// **Costo zero di quota**: nessuna sessione viene aperta, l'elenco e la conversazione si
// disegnano dal journal.
//
// Uso:  node tools/prova-percorsi.ts          (lascia il daemon acceso e stampa l'indirizzo)
//       node tools/prova-percorsi.ts --check  (guida il browser, verifica e esce)

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const RADICE = resolve(import.meta.dirname, '..')
const CASA = resolve(tmpdir(), 'stark-prova-percorsi')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

/**
 * I casi, e cosa ci si aspetta. `si` vuol dire «deve prendere i bottoni».
 *
 * I negativi non sono riempitivo: sono i tre modi diversi di sbagliare. `addAppLinks`
 * somiglia a un file e non lo è; `core/reduce.ts` **somiglia a un percorso vero** e non
 * esiste (il file sta in `src/core/`), ed è il caso che una regola tipografica non può
 * distinguere in nessun modo; `and/or` ha la barra ed è una parola.
 */
const CASI: { testo: string; si: boolean; perche: string }[] = [
  { testo: 'CLAUDE.md', si: true, perche: 'file vero nella radice, senza cartella davanti' },
  { testo: 'ui/src/lib/percorsi.ts', si: true, perche: 'percorso vero, relativo al cwd' },
  { testo: 'docs/ui-schermate.md', si: true, perche: 'percorso vero' },
  { testo: 'core/reduce.ts', si: false, perche: 'sembra un percorso ma non esiste (è src/core/)' },
  { testo: 'addAppLinks', si: false, perche: 'nome di funzione' },
  { testo: 'and/or', si: false, perche: 'ha la barra ed è una parola' },
  { testo: '--permission-mode', si: false, perche: 'è un\'opzione' },
  { testo: 'npm run check', si: false, perche: 'è un comando: ha degli spazi' },
]

const id = 'aaaaaaaa-1111-4111-8111-111111111111'
const righe: string[] = []
let seq = 0
const t0 = Date.now() - 600_000
const ev = (payload: unknown): void => {
  seq += 1
  righe.push(JSON.stringify({ v: 1, seq, ts: t0 + seq * 1000, sessionId: id, payload }))
}
ev({ k: 'session.state', state: 'starting' })
// Il `cwd` è **il repo vero**: è relativamente a questo che il daemon guarda sul disco,
// e con una cartella finta ogni caso positivo fallirebbe per la ragione sbagliata.
ev({ k: 'session.created', agent: 'claude-code', cwd: RADICE,
  model: 'claude-opus-5[1m]',
  capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
    permissionAlways: true, questions: true, revert: false, toolProgress: false,
    fileBrowser: false, pty: false },
  tools: [], commands: [] })
ev({ k: 'session.renamed', title: 'percorsi citati' })
ev({ k: 'turn.started', turnId: 't1',
  prompt: [{ type: 'text', text: 'guarda @docs/ui-schermate.md e dimmi' }] })
ev({ k: 'text.started', partId: 'p1' })
ev({ k: 'text.ended', partId: 'p1',
  text: CASI.map(c => `- \`${c.testo}\` — ${c.perche}`).join('\n') })
ev({ k: 'turn.ended', turnId: 't1', reason: 'completed' })
ev({ k: 'session.state', state: 'idle' })
writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')

const { startDaemon } = await import('../src/daemon/server.ts')
const daemon = await startDaemon({ port: 0, token: 'prova'.padEnd(64, '0') })
const url = `${daemon.url}/?token=${daemon.token}`

if (!process.argv.includes('--check')) {
  console.log(url)
} else {
  const { chromium } = await import('playwright-core')
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } })
  await p.goto(url, { waitUntil: 'load' })
  await p.waitForTimeout(1000)
  await p.click('text=percorsi citati')
  // La decorazione è **asincrona di proposito** (una richiesta al daemon): il testo
  // compare subito, i bottoni un attimo dopo. Aspettare un tempo fisso qui sarebbe una
  // prova che passa o fallisce a seconda di quanto è carica la macchina.
  await p.waitForFunction(() => document.querySelectorAll('code.pth').length > 0,
    null, { timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(400)

  const visto = await p.evaluate(() => {
    const out: Record<string, { bottoni: number }> = {}
    for (const c of document.querySelectorAll<HTMLElement>('.prose code')) {
      const t = (c.getAttribute('data-path-cand') ?? c.textContent ?? '').trim()
      out[t] = { bottoni: c.querySelectorAll('.pthb').length }
    }
    return out
  })

  let n = 0, ko = 0
  for (const c of CASI) {
    n += 1
    const b = visto[c.testo]?.bottoni ?? 0
    const ok = c.si ? b === 2 : b === 0
    if (!ok) ko += 1
    console.log(`${ok ? 'OK  ' : 'NO  '} ${c.si ? 'bottoni  ' : 'testo    '} \`${c.testo}\``
      + `  (${b} bottoni) · ${c.perche}`)
  }

  // Richiudere e riaprire il turno. Difetto segnalato dall'utente il 28 agosto 2026:
  // i percorsi tornavano nudi, perché il `{@html}` rifà il DOM da zero e l'effetto che
  // decorava dipendeva da «quanti turni» e «quante parti» — due numeri che richiudere
  // un turno non cambia. Vale la pena che resti una prova e non solo una correzione:
  // è un difetto che **non si vede** guardando la schermata appena aperta, cioè
  // esattamente il modo in cui era passato.
  const conta = () => p.evaluate(() => ({
    cand: document.querySelectorAll('code[data-path-cand]').length,
    bottoni: document.querySelectorAll('.pthb').length,
  }))
  const prima = await conta()
  await p.click('.thmain'); await p.waitForTimeout(400)
  await p.click('.thmain'); await p.waitForTimeout(900)
  const dopo = await conta()
  n += 1
  const okRiapri = dopo.cand === prima.cand && dopo.bottoni === prima.bottoni && dopo.bottoni > 0
  if (!okRiapri) ko += 1
  console.log(`${okRiapri ? 'OK  ' : 'NO  '} richiuso e riaperto, i bottoni ci sono ancora`
    + `  (prima ${prima.bottoni}, dopo ${dopo.bottoni})`)

  // La citazione `@` nel prompt: si vede solo aprendo il prompt intero, che è dove è
  // stata messa — nella riga del turno sarebbe un bottone dentro un bottone.
  await p.click('.thmore').catch(() => {})
  await p.waitForTimeout(400)
  const cite = await p.evaluate(() =>
    [...document.querySelectorAll('.fullp .cita')].map(e => e.textContent))
  n += 1
  const okCita = cite.length === 1 && cite[0] === '@docs/ui-schermate.md'
  if (!okCita) ko += 1
  console.log(`${okCita ? 'OK  ' : 'NO  '} citazione @ premibile nel prompt intero`
    + `  (${JSON.stringify(cite)})`)

  await p.screenshot({ path: '/tmp/percorsi-vero.png', fullPage: true })
  console.log(`\nschermata: /tmp/percorsi-vero.png`)
  console.log(`${n - ko}/${n} verifiche passate`)
  await b.close()
  await daemon.stop()
  process.exit(ko ? 1 : 0)
}
