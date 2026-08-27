// L'albero che descrive come i pannelli sono disposti sullo schermo largo.
//
// Nessuna dipendenza da Svelte né dal DOM, di proposito: così la parte che sbaglia
// davvero — dove finisce una foglia nuova, cosa collassa quando una sparisce — si prova
// con `node` puro invece che con un browser (vedi `tools/layout-check.ts`). Lo Store lo
// persiste così com'è: dentro ci sono solo id di chat, mai snapshot.

export type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; dir: 'row' | 'col'; children: LayoutNode[]; sizes: number[] }

/** Le foglie dell'albero, in ordine di visita. */
export function leafIds(tree: LayoutNode): string[] {
  if (tree.type === 'leaf') return [tree.paneId]
  return tree.children.flatMap(leafIds)
}

/** Il percorso della foglia `paneId`: gli indici da seguire dalla radice in giù.
 *  `[]` vuol dire «è la radice», `null` «non c'è». */
function findPath(tree: LayoutNode, paneId: string, path: number[] = []): number[] | null {
  if (tree.type === 'leaf') return tree.paneId === paneId ? path : null
  for (let i = 0; i < tree.children.length; i++) {
    const found = findPath(tree.children[i]!, paneId, [...path, i])
    if (found) return found
  }
  return null
}

function atPath(tree: LayoutNode, path: number[]): LayoutNode {
  let node = tree
  for (const i of path) {
    if (node.type !== 'split') throw new Error('percorso invalido')
    node = node.children[i]!
  }
  return node
}

function replaceAtPath(tree: LayoutNode, path: number[], next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  if (tree.type !== 'split') throw new Error('percorso invalido')
  const [head, ...rest] = path
  const children = tree.children.map((c, i) => (i === head ? replaceAtPath(c, rest, next) : c))
  return { ...tree, children }
}

/**
 * Divide la foglia `targetPaneId` in due, inserendo `newPaneId` sul lato `dir`.
 * Se il genitore della foglia è già uno split nella stessa direzione, aggiunge un
 * figlio invece di annidare: uno split dentro un altro della stessa direzione sarebbe
 * visivamente indistinguibile da un figlio in più, ma renderebbe i divisori annidati.
 * Lancia se `targetPaneId` non è nell'albero.
 */
export function splitLeaf(
  tree: LayoutNode, targetPaneId: string, dir: 'row' | 'col', newPaneId: string,
): LayoutNode {
  const path = findPath(tree, targetPaneId)
  if (!path) throw new Error(`nessuna foglia ${targetPaneId} nell'albero`)
  const target = atPath(tree, path)
  const parentPath = path.slice(0, -1)
  const parent = path.length === 0 ? null : atPath(tree, parentPath)

  if (parent && parent.type === 'split' && parent.dir === dir) {
    const idx = path[path.length - 1]!
    const children = [...parent.children]
    children.splice(idx + 1, 0, { type: 'leaf', paneId: newPaneId })
    return replaceAtPath(tree, parentPath, { type: 'split', dir, children, sizes: uniform(children.length) })
  }

  const wrapped: LayoutNode = {
    type: 'split', dir,
    children: [target, { type: 'leaf', paneId: newPaneId }],
    sizes: [0.5, 0.5],
  }
  return replaceAtPath(tree, path, wrapped)
}

/**
 * Toglie la foglia `paneId`. Se il genitore resta con un figlio solo, il genitore
 * viene sostituito da quel figlio (collasso). Se `paneId` è l'unica foglia dell'intero
 * albero restituisce `null`: l'albero vuoto non è rappresentabile come `LayoutNode`, e
 * chi chiama deve gestire quel caso a parte.
 */
export function closeLeaf(tree: LayoutNode, paneId: string): LayoutNode | null {
  const path = findPath(tree, paneId)
  if (!path) return tree
  if (path.length === 0) return null

  const parentPath = path.slice(0, -1)
  const parent = atPath(tree, parentPath)
  if (parent.type !== 'split') throw new Error('percorso invalido')
  const idx = path[path.length - 1]!
  const remaining = parent.children.filter((_, i) => i !== idx)

  if (remaining.length === 1) return replaceAtPath(tree, parentPath, remaining[0]!)
  return replaceAtPath(tree, parentPath, {
    type: 'split', dir: parent.dir, children: remaining,
    sizes: rinormalizza(parent.sizes.filter((_, i) => i !== idx)),
  })
}

/** Sostituisce la foglia `paneId` con `newPaneId`, lasciando la disposizione intatta.
 *  È il drop al centro di un pannello: la chat cambia, il riquadro no. */
export function replaceLeaf(tree: LayoutNode, paneId: string, newPaneId: string): LayoutNode {
  const path = findPath(tree, paneId)
  if (!path) throw new Error(`nessuna foglia ${paneId} nell'albero`)
  return replaceAtPath(tree, path, { type: 'leaf', paneId: newPaneId })
}

/** Nuove proporzioni per i figli dello split a `parentPath`. `sizes` deve sommare a 1
 *  (± 0.001); altrimenti lancia. */
export function resizeSplit(tree: LayoutNode, parentPath: number[], sizes: number[]): LayoutNode {
  const node = atPath(tree, parentPath)
  if (node.type !== 'split') throw new Error('il percorso non punta a uno split')
  if (sizes.length !== node.children.length) throw new Error('numero di proporzioni sbagliato')
  const sum = sizes.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.001) throw new Error(`le proporzioni sommano a ${sum}, non 1`)
  return replaceAtPath(tree, parentPath, { ...node, sizes })
}

/** Tiene solo le foglie il cui id passa `keep`; ricostruisce collassando i genitori
 *  svuotati. `null` se non ne resta nessuna. */
export function reconcile(tree: LayoutNode, keep: (paneId: string) => boolean): LayoutNode | null {
  if (tree.type === 'leaf') return keep(tree.paneId) ? tree : null
  const tenuti = tree.children
    .map((c, i) => [reconcile(c, keep), i] as const)
    .filter((v): v is readonly [LayoutNode, number] => v[0] !== null)
  if (tenuti.length === 0) return null
  if (tenuti.length === 1) return tenuti[0]![0]
  return {
    type: 'split', dir: tree.dir,
    children: tenuti.map(([c]) => c),
    // Le proporzioni dei superstiti si tengono e si rinormalizzano, non si azzerano:
    // `reconcile` gira anche al ricaricamento, quando di solito non cade nessuna
    // foglia — uniformare lì vorrebbe dire che i divisori tornano in mezzo ogni volta,
    // cioè che ridimensionare un pannello non si ricorda. Visto dal vivo, non dedotto.
    sizes: rinormalizza(tenuti.map(([, i]) => tree.sizes[i] ?? 1 / tree.children.length)),
  }
}

const uniform = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

/** Le stesse proporzioni relative, riportate a somma 1. Se la somma è zero — non
 *  dovrebbe succedere, ma un `localStorage` scritto a mano può contenere qualunque
 *  cosa — si ripiega su parti uguali invece di dividere per zero. */
function rinormalizza(sizes: number[]): number[] {
  const somma = sizes.reduce((a, b) => a + b, 0)
  return somma > 0 ? sizes.map(s => s / somma) : uniform(sizes.length)
}
