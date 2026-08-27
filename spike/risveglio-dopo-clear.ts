// Un `/clear` sopravvive allo Sleep? (bug trovato il 27 agosto 2026 su una chat vera)
//
// `spec.resume.ref` fa due mestieri: dà il nome al journal e dice al CLI quale
// conversazione riprendere. Di norma coincidono — all'apertura STARK passa il proprio
// id come `sessionId` — ma un `/clear` sposta la conversazione del CLI su un id nuovo,
// dichiarato nel `system:init` che segue (→ `session.resumeRef`). Riprendere il vecchio
// id riapre la conversazione di **prima** del taglio.
//
// Questa sonda lo prova sul comportamento, non sui numeri: una parola nascosta prima
// del `/clear`, e la domanda «che parola?» dopo il risveglio. Se il fix regge, il
// modello non deve saperla.
//
// COSTA QUOTA: quattro turni corti (nessun tool). Da rifare a ogni salto di versione
// del CLI, perché il pezzo su cui poggia — quale id il CLI dichiara dopo un reset —
// non è documentato.
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-clear-resume')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })
const CWD = resolve(tmpdir(), 'stark-clear-resume-cwd')
mkdirSync(CWD, { recursive: true })
// Stesso vincolo di `daemon-check`: `registry.ts` risolve `STARK_HOME` al load del
// modulo, quindi l'import va **dopo** l'assegnazione e non può essere statico.
process.env['STARK_HOME'] = CASA

const { Registry } = await import('../src/daemon/registry.ts')
const reg = new Registry({})

/** Aspetta che una condizione sullo snapshot diventi vera. Guardare lo **stato** non
 *  basta e il primo giro di questa sonda ci è cascato: fra il `prompt()` e il momento
 *  in cui la sessione diventa `busy` passa un istante, quindi «non è busy» è vero
 *  anche *prima* che il turno cominci — la sonda leggeva un turno mai partito e
 *  trovava risposte vuote. Si aspetta il **fatto**: il turno in più, e la sua fine. */
async function finche(id: string, pred: (s: NonNullable<ReturnType<typeof reg.snapshot>>) => boolean): Promise<void> {
  for (let i = 0; i < 1200; i++) {
    const s = reg.snapshot(id)
    if (s && pred(s)) return
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('atteso invano')
}
const ferma = (id: string): Promise<void> =>
  finche(id, s => s.state !== 'busy' && s.state !== 'starting')
/** Il testo che l'agent ha scritto nell'ultimo turno. */
const risposta = (id: string): string => {
  const t = reg.snapshot(id)?.turns.at(-1)
  return (t?.parts ?? []).filter(p => p.kind === 'text').map(p => p.text).join(' ').trim()
}
const contesto = (id: string): number => reg.snapshot(id)?.contextUsage?.totalTokens ?? -1

const dimmi = async (id: string, testo: string): Promise<string> => {
  const prima = reg.snapshot(id)?.turns.length ?? 0
  await reg.command(id, { c: 'session.prompt', text: testo })
  // `ended` è un **booleano**, non un campo opzionale: `!== undefined` era vero anche
  // su un turno appena aperto, quindi la sonda tirava dritto e mandava il prompt dopo
  // dentro il turno prima — che infatti risultava `aborted`. Si guarda il valore.
  await finche(id, s => s.turns.length > prima && s.turns.at(-1)?.ended === true)
  return risposta(id)
}

const id = await reg.open({ cwd: CWD })
await ferma(id)
console.log(`OK sessione ${id.slice(0, 8)}  ref di partenza ${reg.snapshot(id)?.resumeRef?.slice(0, 8)}`)

await dimmi(id, 'Ricorda questa parola: MELANZANA. Rispondi solo «ok».')
const primaDelClear = contesto(id)
console.log(`OK parola nascosta          contesto ${primaDelClear} token`)

await dimmi(id, '/clear')
const dopoIlClear = contesto(id)
const refDopoIlClear = reg.snapshot(id)?.resumeRef
console.log(`OK /clear                   contesto ${dopoIlClear} token  ref ${refDopoIlClear?.slice(0, 8)}`)
console.log(`OK il ref è cambiato?       ${refDopoIlClear !== id ? 'SÌ — ed è il caso che rompeva' : 'no (allora il CLI non ha spostato niente)'}`)

await reg.command(id, { c: 'session.sleep' })
console.log('OK sleep')

await reg.open({ cwd: CWD, resume: { ref: id } })
await ferma(id)
const alRisveglio = contesto(id)
console.log(`OK risveglio                contesto ${alRisveglio} token`)

const detta = await dimmi(id, 'Che parola ti avevo chiesto di ricordare? Se non lo sai, rispondi NONLOSO.')
console.log(`OK «che parola?»            ${detta.slice(0, 120)}`)

const ricorda = /MELANZANA/i.test(detta)
console.log('OK')
console.log(`OK il /clear è sopravvissuto allo Sleep? ${ricorda ? 'NO — il contesto è tornato indietro' : 'SÌ'}`)
console.log(`OK   contesto: ${primaDelClear} prima → ${dopoIlClear} dopo il clear → ${alRisveglio} al risveglio`)
await reg.command(id, { c: 'session.close' })
process.exit(ricorda ? 1 : 0)
