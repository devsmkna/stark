// Verifiche a costo zero per `ui/src/lib/gruppi.ts`: come si raggruppa il lavoro
// dentro un turno. Nessuna dipendenza da Svelte o dal browser — girano con `node`
// puro, come `tools/layout-check.ts` fa per il layout dei pannelli, e per la stessa
// ragione: la parte che si sbaglia non è il disegno, è la regola.
//
// Sta in `tools/` e non in `src/cli/` perché il `tsconfig.json` della radice ha
// `rootDir: src`, e un file lì che importa da `ui/` farebbe smettere di compilare
// `npm run build`.

import { codaIndex, conta, groupParts, type Grp } from '../ui/src/lib/gruppi.ts'
import type { PartView } from '../src/core/reduce.ts'

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

// ─── parti finte, il minimo perché siano del tipo giusto ──────────────────────
let n = 0
const testo = (t = 'ora guardo il CSS'): PartView =>
  ({ kind: 'text', partId: `t${++n}`, text: t, open: false })
const tool = (done = true): PartView =>
  ({ kind: 'tool', callId: `c${++n}`, name: 'Bash', inputRaw: '{}', startedAt: 0, done, ok: done })
const pensiero = (text = 'mmm', open = false): PartView =>
  ({ kind: 'reasoning', partId: `r${++n}`, text, open })
const risposta = (): PartView =>
  ({ kind: 'answer', partId: `a${++n}`, of: 'question', asked: 'Da cosa partiamo?',
     answer: 'OpenCode', refused: false, at: 0 })
const compatta = (): PartView =>
  ({ kind: 'compact', partId: `k${++n}`, before: 100, at: 0 })
const ritenta = (): PartView =>
  ({ kind: 'retry', partId: `y${++n}`, attempt: 1, reason: 'overloaded', at: 0 })

const forma = (g: Grp[]): string => g.map(x =>
  x.kind === 'done' ? `D${x.parts.length}` : x.kind === 'live' ? 'L' : `S:${x.part.kind}`).join(' ')

// ─── il caso normale: lavoro + recap ──────────────────────────────────────────
{
  const parts = [pensiero(), tool(), testo(), tool(), tool(), testo('Fatto. Riepilogo.')]
  const g = groupParts(parts)
  check('il turno tipico diventa due blocchi: il lavoro e la risposta',
    forma(g) === 'D5 S:text', forma(g))
  const primo = g[0]!, secondo = g[1]!
  check('nel gruppo ci finiscono anche i testi interstiziali',
    primo.kind === 'done' && primo.parts.filter(p => p.kind === 'text').length === 1)
  check('il recap resta fuori, per intero',
    secondo.kind === 'solo' && secondo.part.kind === 'text'
    && secondo.part.text === 'Fatto. Riepilogo.')
}

// ─── il recap si riconosce dalla posizione, non dal fatto che sia un testo ────
{
  const parts = [testo(), tool(), testo(), tool()]
  const g = groupParts(parts)
  check('un turno che finisce su un tool non ha nessun recap: tutto dentro',
    forma(g) === 'D4', forma(g))
  check('codaIndex: -1 quando l\'ultima parte non è un testo', codaIndex(parts) === -1)
  check('codaIndex: l\'ultimo indice quando lo è', codaIndex([tool(), testo()]) === 1)
  check('codaIndex: un turno vuoto non ha coda', codaIndex([]) === -1)
}
{
  // Un testo a metà turno resta dentro anche se è l'ultimo testo del turno: quello
  // che conta è che dopo di lui sia successo dell'altro.
  const g = groupParts([tool(), testo('quasi finito'), tool(), tool()])
  check('l\'ultimo testo non è il recap se dopo continua il lavoro', forma(g) === 'D4', forma(g))
}

// ─── ciò che spezza il gruppo ─────────────────────────────────────────────────
{
  const g = groupParts([tool(), tool(), risposta(), tool(), testo('riepilogo')])
  check('una risposta spezza il gruppo in due', forma(g) === 'D2 S:answer D1 S:text', forma(g))
}
{
  // Il testo lungo che introduce la domanda: mediana 2631 caratteri sui journal veri,
  // cioè la taglia di un recap. Dentro il gruppo lascerebbe la risposta senza la
  // domanda a cui rispondeva.
  const g = groupParts([tool(), testo('ecco le tre vie, quale prendiamo?'), tool(), risposta(), testo('fatto')])
  check('il testo che introduce una domanda resta fuori',
    forma(g) === 'D1 S:text D1 S:answer S:text', forma(g))
}
{
  const g = groupParts([tool(), testo('scelgo?'), risposta(), testo('fatto')])
  check('vale anche quando la risposta arriva subito dopo il testo',
    forma(g) === 'D1 S:text S:answer S:text', forma(g))
}
{
  const g = groupParts([tool(), testo('nota'), tool(), tool(), risposta(), testo('fatto')])
  check('un testo a tre parti dalla risposta è narrazione, e resta dentro',
    forma(g) === 'D4 S:answer S:text', forma(g))
}
{
  const g = groupParts([tool(), compatta(), tool(), testo('fatto')])
  check('la compattazione spezza: è un taglio del flusso, non lavoro',
    forma(g) === 'D1 S:compact D1 S:text', forma(g))
  const g2 = groupParts([tool(), ritenta(), tool(), testo('fatto')])
  check('un retry spezza: spiega la pausa che si vede sopra',
    forma(g2) === 'D1 S:retry D1 S:text', forma(g2))
}

// ─── il turno vivo ────────────────────────────────────────────────────────────
{
  const g = groupParts([tool(), testo(), tool(), tool(false)])
  check('l\'operazione in corso resta fuori dal gruppo', forma(g) === 'D3 L', forma(g))
}
{
  const g = groupParts([tool(false)])
  check('un turno appena partito è solo la sua operazione viva', forma(g) === 'L', forma(g))
}
{
  const g = groupParts([tool(), testo('sto scrivendo la risposta…')])
  check('mentre il recap si scrive, è già fuori dal gruppo', forma(g) === 'D1 S:text', forma(g))
}
{
  // Il ragionamento aperto è «vivo» quanto un tool non finito: dice che il turno lo è.
  const g = groupParts([tool(), pensiero('sto pensando', true)])
  check('un ragionamento ancora aperto resta in vista', forma(g) === 'D1 L', forma(g))
}

// ─── il reasoning vuoto ───────────────────────────────────────────────────────
{
  const g = groupParts([tool(), pensiero(''), tool(), testo('fatto')])
  check('un ragionamento chiuso e vuoto non conta come parte', forma(g) === 'D2 S:text', forma(g))
  const g2 = groupParts([pensiero('')])
  check('un turno fatto solo di ragionamenti vuoti non produce blocchi',
    forma(g2) === '', forma(g2))
}

// ─── la chiave del gruppo, che tiene aperto ciò che hai aperto ────────────────
{
  const primo = tool()
  const g1 = groupParts([primo, tool(), tool(false)])
  const g2 = groupParts([primo, tool(), tool(), tool(false)])
  check('la chiave del gruppo non cambia mentre il lavoro cresce',
    g1[0]!.key === g2[0]!.key, `${g1[0]!.key} ≠ ${g2[0]!.key}`)
}

// ─── cosa dice l'intestazione ─────────────────────────────────────────────────
{
  const c = conta([tool(), testo(), tool(), pensiero('x')])
  check('l\'intestazione conta i tool e le note, non i ragionamenti',
    c.ops === 2 && c.note === 1, JSON.stringify(c))
  const c2 = conta([testo(), testo()])
  check('un gruppo di sole note ha zero operazioni', c2.ops === 0 && c2.note === 2)
}

// ─── il caso vero che ha fatto nascere tutto ──────────────────────────────────
{
  // 418 parti: una nota ogni tre o quattro tool. Con la regola di prima erano 103
  // blocchi in colonna, uno per ogni volta che l'agent apriva bocca.
  const parts: PartView[] = []
  for (let i = 0; i < 100; i++) { parts.push(testo(), tool(), tool(), tool()) }
  parts.push(testo('Fatte tutte e quattro.'))
  const g = groupParts(parts)
  check('cento narrazioni e trecento tool restano due blocchi',
    forma(g) === 'D400 S:text', forma(g))
}

// ─── esito ────────────────────────────────────────────────────────────────────
let ko = 0
for (const [name, ok, detail] of checks) {
  if (!ok) ko++
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`)
}
console.log(`\n${checks.length - ko}/${checks.length} verifiche`)
process.exit(ko === 0 ? 0 : 1)
