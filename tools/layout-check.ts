// Verifiche a costo zero per `ui/src/lib/layout.ts`: nessuna dipendenza da Svelte o dal
// browser, quindi girano con `node` puro come `src/cli/offline-check.ts` fa per il resto
// della catena. Stesso stile: `check(nome, condizione, dettaglio)`, niente framework.
//
// Sta in `tools/` e non in `src/cli/` perché il `tsconfig.json` della radice ha
// `rootDir: src`, e un file lì dentro che importa da `ui/` lo violerebbe: `npm run build`
// smetterebbe di compilare. Il typecheck lo copre lo stesso — `ui/tsconfig.json` lo
// include, ed è quello che `npm run ui:check` legge.

import {
  closeLeaf, leafIds, reconcile, replaceLeaf, resizeSplit, splitLeaf, type LayoutNode,
} from '../ui/src/lib/layout.ts'

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

const LEAF_A: LayoutNode = { type: 'leaf', paneId: 'a' }

// splitLeaf
{
  const t = splitLeaf(LEAF_A, 'a', 'row', 'b')
  check('splitLeaf: un split di due foglie',
    JSON.stringify(leafIds(t).sort()) === JSON.stringify(['a', 'b']), JSON.stringify(t))
  check('splitLeaf: la radice è uno split row', t.type === 'split' && t.dir === 'row')

  const t2 = splitLeaf(t, 'a', 'row', 'c')
  check('splitLeaf: stessa direzione del genitore aggiunge un figlio, non annida',
    t2.type === 'split' && t2.children.length === 3, JSON.stringify(t2))
  check('splitLeaf: le proporzioni tornano uniformi dopo l\'aggiunta',
    t2.type === 'split' && t2.sizes.every(s => Math.abs(s - 1 / 3) < 1e-9))
  check('splitLeaf: il nuovo pannello sta subito dopo il bersaglio',
    JSON.stringify(leafIds(t2)) === JSON.stringify(['a', 'c', 'b']), JSON.stringify(leafIds(t2)))

  const t3 = splitLeaf(t, 'a', 'col', 'c')
  check('splitLeaf: direzione diversa annida uno split dentro il figlio',
    t3.type === 'split' && t3.dir === 'row' && t3.children[0]?.type === 'split'
    && t3.children[0].dir === 'col', JSON.stringify(t3))

  try {
    splitLeaf(LEAF_A, 'zzz', 'row', 'b')
    check('splitLeaf: lancia su una foglia inesistente', false)
  } catch {
    check('splitLeaf: lancia su una foglia inesistente', true)
  }
}

// closeLeaf
{
  const t = splitLeaf(LEAF_A, 'a', 'col', 'b')
  const closed = closeLeaf(t, 'b')
  check('closeLeaf: restando un figlio solo, il genitore collassa su di lui',
    closed?.type === 'leaf' && closed.paneId === 'a', JSON.stringify(closed))

  check('closeLeaf: chiudere l\'unica foglia dell\'albero torna null', closeLeaf(LEAF_A, 'a') === null)
  check('closeLeaf: una foglia che non c\'è lascia l\'albero com\'era', closeLeaf(t, 'zzz') === t)

  const t3 = splitLeaf(splitLeaf(LEAF_A, 'a', 'row', 'b'), 'a', 'row', 'c')
  const t3closed = closeLeaf(t3, 'a')
  check('closeLeaf: chiudere una foglia in mezzo lascia le altre due',
    t3closed?.type === 'split' && t3closed.children.length === 2, JSON.stringify(t3closed))
  check('closeLeaf: e ridistribuisce lo spazio in parti uguali',
    t3closed?.type === 'split' && t3closed.sizes.every(s => Math.abs(s - 0.5) < 1e-9))
}

// replaceLeaf
{
  const t = splitLeaf(LEAF_A, 'a', 'row', 'b')
  const swapped = replaceLeaf(t, 'b', 'c')
  check('replaceLeaf: cambia la chat lasciando la disposizione intatta',
    JSON.stringify(leafIds(swapped)) === JSON.stringify(['a', 'c'])
    && swapped.type === 'split' && swapped.sizes[0] === 0.5, JSON.stringify(swapped))
  check('replaceLeaf: sulla radice sostituisce tutto l\'albero',
    replaceLeaf(LEAF_A, 'a', 'z').type === 'leaf')
}

// resizeSplit
{
  const t = splitLeaf(LEAF_A, 'a', 'row', 'b')
  const resized = resizeSplit(t, [], [0.3, 0.7])
  check('resizeSplit: applica le proporzioni date',
    resized.type === 'split' && resized.sizes[0] === 0.3 && resized.sizes[1] === 0.7)
  try {
    resizeSplit(t, [], [0.3, 0.3])
    check('resizeSplit: lancia se le proporzioni non sommano a 1', false)
  } catch {
    check('resizeSplit: lancia se le proporzioni non sommano a 1', true)
  }
  try {
    resizeSplit(t, [0], [0.5, 0.5])
    check('resizeSplit: lancia se il percorso non punta a uno split', false)
  } catch {
    check('resizeSplit: lancia se il percorso non punta a uno split', true)
  }
}

// reconcile
{
  const t = splitLeaf(splitLeaf(LEAF_A, 'a', 'row', 'b'), 'a', 'col', 'c')
  const kept = reconcile(t, id => id !== 'b')
  check('reconcile: toglie le foglie che non passano il filtro',
    kept !== null && JSON.stringify(leafIds(kept).sort()) === JSON.stringify(['a', 'c']),
    JSON.stringify(kept))
  check('reconcile: un genitore rimasto con un figlio solo collassa',
    reconcile(t, id => id === 'a')?.type === 'leaf')
  check('reconcile: nessuna foglia superstite torna null', reconcile(t, () => false) === null)
}

let failed = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}
console.log(`\n${checks.length - failed}/${checks.length} verifiche passate`)
process.exitCode = failed === 0 ? 0 : 1
