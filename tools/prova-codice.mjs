// Guarda i blocchi di codice colorati nella UI vera, invece di descriverli.
//   node tools/prova-codice.mjs
//
// Costo: zero quota. Il journal è sintetico — nessuna sessione parte, nessun turno.
//
// Cosa si vuole verificare, e che leggendo il codice non si vede: che la classe
// `language-*` sopravviva a DOMPurify (è il punto in cui l'informazione poteva
// sparire), che highlight.js produca davvero degli `<span>` colorati, che i colori
// cambino col tema, e che un linguaggio sconosciuto resti monospace invece di rompere
// il rendering di tutta la risposta.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOME = '/tmp/stark-codice'
rmSync(HOME, { recursive: true, force: true })
mkdirSync(resolve(HOME, 'sessioni'), { recursive: true })
const id = '33333333-3333-4333-8333-333333333333'

// I linguaggi sono quelli **misurati** sui trascritti veri, più i due casi al bordo:
// `hcl`, che highlight.js non porta, e un blocco senza tag.
const testo = [
  'Il comando da lanciare:', '',
  '```bash', '# la suite offline', 'npm run check --silent | tail -2', 'export N=3', '```', '',
  'La configurazione:', '',
  '```json', '{ "name": "stark", "deps": ["marked", 1] }', '```', '',
  'Un pezzo di codice:', '',
  '```ts', '// somma due numeri', 'export function somma(a: number, b: number): number {',
  '  return a + b', '}', '```', '',
  'Un linguaggio che highlight.js non ha:', '',
  '```hcl', 'resource "aws_s3_bucket" "b" { bucket = "x" }', '```', '',
  'E uno senza tag:', '',
  '```', 'niente da colorare', '```',
].join('\n')

let seq = 0
const ev = p => JSON.stringify({ v: 1, seq: ++seq, ts: Date.now(), sessionId: id, payload: p })
writeFileSync(resolve(HOME, 'sessioni', `${id}.jsonl`), [
  ev({ k: 'session.created', agent: 'claude-code', cwd: '/tmp', model: 'opus',
       capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
         permissionAlways: true, questions: true, revert: false, toolProgress: false,
         fileBrowser: false, pty: false } }),
  ev({ k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: 'fammi vedere del codice' }] }),
  ev({ k: 'text.started', partId: 'x' }),
  ev({ k: 'text.delta', partId: 'x', delta: testo }),
  ev({ k: 'text.ended', partId: 'x', text: testo }),
  ev({ k: 'turn.ended', turnId: 't1', reason: 'completed' }),
].join('\n') + '\n')

process.env['STARK_HOME'] = HOME
const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })

const b = await chromium.launch({ args: ['--no-sandbox'] })

async function giro(scuro) {
  const p = await b.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: scuro ? 'dark' : 'light' })
  await p.goto(`${s.url}/chat/${id}?token=${s.token}`, { waitUntil: 'load' })
  // Il turno arriva già aperto: cliccarlo lo CHIUDEREBBE, e la misura tornerebbe zero
  // blocchi. È costato un giro scoprirlo.
  await p.waitForTimeout(1800)

  const m = await p.evaluate(() => {
    const code = [...document.querySelectorAll('pre > code')]
    const tinte = new Set()
    // Per classe, non solo il totale: «7 tinte distinte» sta bene anche se una classe
    // importante e' rimasta del colore del testo. Cosi' si vede QUALE ruolo e' scoperto.
    const perClasse = {}
    // La baseline e' il colore del **codice**, non quello del `body`: `pre code` gira
    // gia' su `--ink-2`, quindi confrontare con `--ink` non avrebbe mai trovato niente
    // di scoperto — una verifica che non puo' fallire.
    const primo = document.querySelector('pre > code')
    const inkColore = primo ? getComputedStyle(primo).color : ''
    for (const sp of document.querySelectorAll('pre code span[class^="hljs-"]')) {
      const c = getComputedStyle(sp).color
      tinte.add(c)
      for (const cl of sp.classList) if (cl.startsWith('hljs-')) perClasse[cl] = c
    }
    const scoperte = Object.entries(perClasse).filter(([, c]) => c === inkColore).map(([k]) => k)
    return {
      blocchi: code.length,
      classi: code.map(c => (/language-[\w+-]+/.exec(c.className) ?? ['(nessuna)'])[0]),
      colorati: code.filter(c => c.classList.contains('hljs')).length,
      span: document.querySelectorAll('pre code span[class^="hljs-"]').length,
      tinte: [...tinte].sort(),
      perClasse,
      senzaColore: scoperte,
      etichette: [...document.querySelectorAll('.cblang')].map(e => e.textContent),
      // Il bottone Copy deve essere rimasto il primo della barra.
      copyPrimo: [...document.querySelectorAll('.cbbar')]
        .every(bar => bar.firstElementChild?.classList.contains('copybtn')),
    }
  })
  console.log(scuro ? 'scuro:' : 'chiaro:', m)
  await p.screenshot({ path: `/tmp/codice-${scuro ? 'scuro' : 'chiaro'}.png` })
  return m
}

const chiaro = await giro(false)
const scuro = await giro(true)
// Confrontare i **conteggi** non prova niente: due volte «7 tinte» sarebbe verde anche
// con la stessa identica tavolozza in entrambi i temi, cioè col caso che questa riga
// esiste per escludere. Si confrontano i valori.
const uguali = chiaro.tinte.filter(c => scuro.tinte.includes(c))
console.log(`\ntinte: ${chiaro.tinte.length} chiaro, ${scuro.tinte.length} scuro, `
  + `${uguali.length} in comune → ${uguali.length === 0 ? 'la tavolozza cambia col tema' : 'ATTENZIONE: qualcuna non cambia'}`)
console.log('  chiaro:', chiaro.tinte.join('  '))
console.log('  scuro :', scuro.tinte.join('  '))
// `hljs-punctuation` in `senzaColore` e' **atteso**, non un difetto: parentesi e virgole
// devono leggersi come testo normale, se no il blocco diventa un arcobaleno e il colore
// smette di voler dire qualcosa. Se ci comparisse `hljs-string` o `hljs-keyword`, quello
// sarebbe un buco vero.
console.log('screenshot: /tmp/codice-chiaro.png  /tmp/codice-scuro.png')

await b.close()
await s.close?.()
process.exit(0)
