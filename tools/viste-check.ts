// Verifiche a costo zero per la regola delle viste (`ui/src/lib/viste-regola.ts`):
// nessuna dipendenza da Svelte o dal browser, quindi girano con `node` puro come
// `tools/layout-check.ts`. Stesso stile: `check(nome, condizione, dettaglio)`.
//
// Cosa si prova qui, e perché non nel browser: la domanda «questo albero è ancora una
// vista?» si sbaglia ragionando, non guardando. Il caso che è costato di più è il
// selettore del pannello destro — una foglia che c'è ma non è una chat: contarla vuol
// dire far nascere una vista appena apri il selettore, e cancellarla se lo chiudi.

import { closeLeaf, replaceLeaf, splitLeaf, type LayoutNode } from '../ui/src/lib/layout.ts'
import { decisione, foglieVere } from '../ui/src/lib/viste-regola.ts'

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

const PICK = '__split_pick__'
const A: LayoutNode = { type: 'leaf', paneId: 'a' }

// foglieVere
{
  check('foglieVere: una chat sola', foglieVere(A, PICK).length === 1)
  check('foglieVere: albero assente, nessuna foglia', foglieVere(null, PICK).length === 0)

  const conPicker = splitLeaf(A, 'a', 'row', PICK)
  check('foglieVere: il selettore non conta come chat',
    foglieVere(conPicker, PICK).length === 1, JSON.stringify(foglieVere(conPicker, PICK)))
}

// decisione: la tabella dell'invariante, tutte e sei le caselle
{
  check('decisione: due chat e nessuna vista → nasce', decisione(2, false) === 'crea')
  check('decisione: due chat dentro una vista → si scrive', decisione(2, true) === 'scrivi')
  check('decisione: una chat dentro una vista → muore', decisione(1, true) === 'elimina')
  check('decisione: una chat e nessuna vista → si scrive', decisione(1, false) === 'scrivi')
  check('decisione: zero foglie dentro una vista → muore', decisione(0, true) === 'elimina')
  check('decisione: zero foglie e nessuna vista → si scrive', decisione(0, false) === 'scrivi')
}

// La sequenza vera: com'era il difetto, e com'è adesso.
{
  // 1. una chat. Nessuna vista.
  let tree: LayoutNode = A
  let vista = false
  const passo = (next: LayoutNode | null): string => {
    const d = decisione(foglieVere(next, PICK).length, vista)
    if (d === 'crea') vista = true
    if (d === 'elimina') vista = false
    if (next) tree = next
    return d
  }

  // 2. si apre il selettore accanto: **non** deve nascere niente.
  check('sequenza: aprire il selettore non crea una vista',
    passo(splitLeaf(tree, 'a', 'row', PICK)) === 'scrivi' && !vista)

  // 3. si sceglie una chat: adesso sì.
  check('sequenza: scegliere la seconda chat crea la vista',
    passo(replaceLeaf(tree, PICK, 'b')) === 'crea' && vista)

  // 4. se ne aggiunge una terza: la vista resta la stessa, si riscrive e basta.
  check('sequenza: un terzo pannello non crea una seconda vista',
    passo(splitLeaf(tree, 'b', 'col', 'c')) === 'scrivi' && vista)

  // 5. si chiudono due pannelli: al penultimo la vista muore.
  check('sequenza: chiudere il terzo pannello lascia la vista in piedi',
    passo(closeLeaf(tree, 'c')) === 'scrivi' && vista)
  check('sequenza: scendere a una chat sola elimina la vista',
    passo(closeLeaf(tree, 'b')) === 'elimina' && !vista)
}

let failed = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}
console.log(`\n${checks.length - failed}/${checks.length} verifiche passate`)
process.exitCode = failed === 0 ? 0 : 1
