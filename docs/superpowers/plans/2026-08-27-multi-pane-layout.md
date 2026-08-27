# Layout multi-pannello (split view) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere N chat aperte affiancate nella stessa pagina, in pannelli
ridimensionabili e trascinabili (orizzontale/verticale), aperti trascinando una riga
della sidebar su un pannello esistente.

**Architecture:** Estrarre la logica per-chat oggi dentro `Store` (snap/link/view/stream)
in una classe `Pane` riusabile; un albero puro `LayoutNode` (`ui/src/lib/layout.ts`,
niente Svelte) descrive la disposizione; `Store` tiene una mappa di `Pane` più
`layout: LayoutNode`, persistiti su `localStorage`; un componente ricorsivo nuovo
(`Workspace.svelte`) renderizza l'albero; `Conversation`/`Effects` diventano
pannello-consapevoli tramite due prop nuove (`id`, `setView`) invece di leggere
`store.selected`/chiamare `store.show()`.

**Tech Stack:** Svelte 5 (runes), TypeScript eseguito diretto (niente build per il
daemon), Vite per la UI. Nessuna libreria nuova.

## Global Constraints

- Node ≥ 22.18. TypeScript **eseguito diretto**: niente `tsc` per il daemon, solo
  `tsc --noEmit` per il typecheck. La UI invece si compila con Vite (`npm run ui:build`).
- `npm run check` (109 verifiche oggi) deve restare verde ad ogni commit: nessuna di
  queste task tocca `src/core`/`src/daemon`, ma va comunque rilanciato per sicurezza.
- Niente commenti che spiegano il COSA — solo il PERCHÉ quando non è ovvio (stile del
  repo: vedi qualunque file esistente).
- Le impostazioni del dispositivo (tema, font size, e ora il layout) vivono nel browser
  via `localStorage`, mai sul daemon — stessa regola di `textsize.svelte.ts`.
- Sotto 860px (`store.narrow`) il layout multi-pannello è **sempre ignorato**: si vede
  solo il pannello a fuoco.
- Una chat non può stare in due pannelli contemporaneamente.

---

## File Structure

**Creare:**
- `ui/src/lib/layout.ts` — tipo `LayoutNode` e funzioni pure (`splitLeaf`, `closeLeaf`,
  `resizeSplit`, `leafIds`, `reconcile`).
- `ui/src/lib/pane.svelte.ts` — classe `Pane` (uno stato $state per chat aperta).
- `ui/src/components/Workspace.svelte` — renderizza `store.layout` ricorsivamente.
- `src/cli/ui-check.ts` — verifiche a costo zero per `layout.ts` (stesso stile di
  `src/cli/offline-check.ts`: `check(name, ok, detail)`, niente framework di test).

**Modificare:**
- `ui/src/lib/store.svelte.ts` — `panes`, `layout`, `openPane`/`closePane`/`splitPane`/
  `resizePane`/`focusPane`, persistenza.
- `ui/src/components/Conversation.svelte` — prop `id`/`setView` al posto di
  `store.selected`/`store.show()`.
- `ui/src/components/Effects.svelte` — stessa cosa, più minimale (un solo uso).
- `ui/src/App.svelte` — schermo largo monta `<Workspace>`; schermo stretto passa
  `id={store.selected}` e `setView={v => store.show(v)}` com'era.
- `ui/src/components/Sidebar.svelte` — righe `draggable`, `dragstart` porta l'id.
- `ui/src/app.css` — stili per pannelli, divisori, overlay delle zone di drop.
- `package.json` — script `ui:check`.

---

## Task 1: `layout.ts` — l'albero puro

**Files:**
- Create: `ui/src/lib/layout.ts`
- Create: `src/cli/ui-check.ts`
- Modify: `package.json` (script `"ui:check": "node src/cli/ui-check.ts"`)

**Interfaces:**
- Produce:
  ```ts
  export type LayoutNode =
    | { type: 'leaf'; paneId: string }
    | { type: 'split'; dir: 'row' | 'col'; children: LayoutNode[]; sizes: number[] }

  /** Le foglie dell'albero, in ordine di visita. */
  export function leafIds(tree: LayoutNode): string[]

  /**
   * Divide la foglia `targetPaneId` in due, inserendo `newPaneId` sul lato `dir`.
   * Se il genitore della foglia è già uno split nella stessa direzione, aggiunge
   * un figlio invece di annidare (evita split-dentro-split della stessa direzione).
   * Lancia se `targetPaneId` non è nell'albero.
   */
  export function splitLeaf(
    tree: LayoutNode, targetPaneId: string, dir: 'row' | 'col', newPaneId: string,
  ): LayoutNode

  /**
   * Toglie la foglia `paneId`. Se il genitore resta con un figlio solo, il genitore
   * viene sostituito da quel figlio (collasso). Se `paneId` è l'unica foglia
   * dell'intero albero, restituisce `null` — l'albero vuoto non è rappresentabile
   * come `LayoutNode`, e chi chiama deve gestire quel caso a parte (§Store).
   */
  export function closeLeaf(tree: LayoutNode, paneId: string): LayoutNode | null

  /** Nuove proporzioni per i figli dello split che contiene `childPaneOrSplit` al
   *  suo interno diretto. `sizes` deve sommare a 1 (± 0.001); altrimenti lancia. */
  export function resizeSplit(tree: LayoutNode, parentPath: number[], sizes: number[]): LayoutNode

  /** Tiene solo le foglie il cui id passa `keep`; ricostruisce collassando i genitori
   *  svuotati. `null` se non ne resta nessuna. */
  export function reconcile(tree: LayoutNode, keep: (paneId: string) => boolean): LayoutNode | null
  ```
- Consumes: niente — è la base di tutto il resto.

- [ ] **Step 1: Scrivi `ui/src/lib/layout.ts` con i tipi e le funzioni sopra**

```ts
// L'albero che descrive come i pannelli sono disposti — nessuna dipendenza da Svelte
// o dal DOM, così si prova senza aprire un browser (§Store lo persiste così com'è,
// solo id di chat, mai snapshot).

export type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; dir: 'row' | 'col'; children: LayoutNode[]; sizes: number[] }

export function leafIds(tree: LayoutNode): string[] {
  if (tree.type === 'leaf') return [tree.paneId]
  return tree.children.flatMap(leafIds)
}

function findParentPath(tree: LayoutNode, paneId: string, path: number[] = []): number[] | null {
  if (tree.type === 'leaf') return tree.paneId === paneId ? path : null
  for (let i = 0; i < tree.children.length; i++) {
    const found = findParentPath(tree.children[i]!, paneId, [...path, i])
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

export function splitLeaf(
  tree: LayoutNode, targetPaneId: string, dir: 'row' | 'col', newPaneId: string,
): LayoutNode {
  const path = findParentPath(tree, targetPaneId)
  if (!path) throw new Error(`nessuna foglia ${targetPaneId} nell'albero`)
  const target = atPath(tree, path)
  const parentPath = path.slice(0, -1)
  const parent = parentPath.length || path.length === 0 ? atPath(tree, parentPath) : null

  // Il genitore diretto è già uno split nella stessa direzione: si aggiunge un
  // figlio invece di annidare uno split dentro un altro della stessa direzione,
  // che visivamente sarebbe indistinguibile da un figlio in più.
  if (parent && parent.type === 'split' && parent.dir === dir) {
    const idx = path[path.length - 1]!
    const n = parent.children.length + 1
    const evenSize = 1 / n
    const children = [...parent.children]
    const newLeaf: LayoutNode = { type: 'leaf', paneId: newPaneId }
    children.splice(idx + 1, 0, newLeaf)
    const sizes = children.map(() => evenSize)
    return replaceAtPath(tree, parentPath, { type: 'split', dir, children, sizes })
  }

  const wrapped: LayoutNode = {
    type: 'split', dir,
    children: [target, { type: 'leaf', paneId: newPaneId }],
    sizes: [0.5, 0.5],
  }
  return replaceAtPath(tree, path, wrapped)
}

export function closeLeaf(tree: LayoutNode, paneId: string): LayoutNode | null {
  const path = findParentPath(tree, paneId)
  if (!path) return tree
  if (path.length === 0) return null // era l'unica foglia dell'albero

  const parentPath = path.slice(0, -1)
  const parent = atPath(tree, parentPath)
  if (parent.type !== 'split') throw new Error('percorso invalido')
  const idx = path[path.length - 1]!
  const remaining = parent.children.filter((_, i) => i !== idx)

  if (remaining.length === 1) {
    // Un figlio solo resta: il genitore sparisce, quel figlio prende il suo posto.
    return replaceAtPath(tree, parentPath, remaining[0]!)
  }
  const evenSize = 1 / remaining.length
  const next: LayoutNode = { type: 'split', dir: parent.dir, children: remaining, sizes: remaining.map(() => evenSize) }
  return replaceAtPath(tree, parentPath, next)
}

export function resizeSplit(tree: LayoutNode, parentPath: number[], sizes: number[]): LayoutNode {
  const node = atPath(tree, parentPath)
  if (node.type !== 'split') throw new Error('il percorso non punta a uno split')
  if (sizes.length !== node.children.length) throw new Error('numero di proporzioni sbagliato')
  const sum = sizes.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.001) throw new Error(`le proporzioni sommano a ${sum}, non 1`)
  return replaceAtPath(tree, parentPath, { ...node, sizes })
}

export function reconcile(tree: LayoutNode, keep: (paneId: string) => boolean): LayoutNode | null {
  if (tree.type === 'leaf') return keep(tree.paneId) ? tree : null
  const children = tree.children.map(c => reconcile(c, keep)).filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]!
  const evenSize = 1 / children.length
  return { type: 'split', dir: tree.dir, children, sizes: children.map(() => evenSize) }
}
```

- [ ] **Step 2: Scrivi `src/cli/ui-check.ts` con le verifiche**

```ts
// Verifiche a costo zero per `ui/src/lib/layout.ts`: nessuna dipendenza da Svelte o
// dal browser, quindi girano con `node` puro come `src/cli/offline-check.ts` fa per
// il resto della catena. Stesso stile: `check(nome, condizione, dettaglio)`.

import {
  closeLeaf, leafIds, reconcile, resizeSplit, splitLeaf, type LayoutNode,
} from '../ui/src/lib/layout.ts'

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

const LEAF_A: LayoutNode = { type: 'leaf', paneId: 'a' }

// splitLeaf
{
  const t = splitLeaf(LEAF_A, 'a', 'row', 'b')
  check('splitLeaf: un split di due foglie', JSON.stringify(leafIds(t).sort()) === JSON.stringify(['a', 'b']))
  check('splitLeaf: la radice è uno split row', t.type === 'split' && t.dir === 'row')

  const t2 = splitLeaf(t, 'a', 'row', 'c')
  check('splitLeaf: stessa direzione del genitore aggiunge un figlio, non annida',
    t2.type === 'split' && t2.children.length === 3,
    JSON.stringify(t2))
  check('splitLeaf: le proporzioni tornano uniformi dopo l\'aggiunta',
    t2.type === 'split' && t2.sizes.every(s => Math.abs(s - 1 / 3) < 1e-9))

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
  check('closeLeaf: chiudere l\'ultimo figlio in più collassa allo split superstite',
    closed?.type === 'leaf' && closed.paneId === 'a', JSON.stringify(closed))

  const onlyOne = closeLeaf(LEAF_A, 'a')
  check('closeLeaf: chiudere l\'unica foglia dell\'albero torna null', onlyOne === null)

  const t3 = splitLeaf(splitLeaf(LEAF_A, 'a', 'row', 'b'), 'a', 'row', 'c') // a | c | b (c inserito dopo a)
  const t3closed = closeLeaf(t3, 'a')
  check('closeLeaf: chiudere una foglia in mezzo lascia le altre due',
    t3closed?.type === 'split' && t3closed.children.length === 2)
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
}

// reconcile
{
  const t = splitLeaf(splitLeaf(LEAF_A, 'a', 'row', 'b'), 'a', 'col', 'c') // (a sopra c) | b
  const kept = reconcile(t, id => id !== 'b')
  check('reconcile: toglie le foglie che non passano il filtro',
    kept !== null && JSON.stringify(leafIds(kept).sort()) === JSON.stringify(['a', 'c']), JSON.stringify(kept))

  const none = reconcile(t, () => false)
  check('reconcile: nessuna foglia superstite torna null', none === null)
}

let failed = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}
console.log(`\n${checks.length - failed}/${checks.length} verifiche passate`)
process.exitCode = failed === 0 ? 0 : 1
```

- [ ] **Step 3: Aggiungi lo script in `package.json`**

Nel blocco `"scripts"`, accanto a `"check"`, aggiungi:
```json
"ui:check": "node src/cli/ui-check.ts",
```

- [ ] **Step 4: Esegui e verifica che passi**

Run: `node src/cli/ui-check.ts`
Expected: `13/13 verifiche passate` (conta le righe `OK` sopra — se un numero non torna,
leggi quale riga dice `FAIL` e correggi `layout.ts`, non il test).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p ui/tsconfig.json` (o il comando di typecheck della UI già
in uso — controlla `ui/package.json`/`ui/tsconfig.json` se il path differisce)
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/layout.ts src/cli/ui-check.ts package.json
git commit -m "Layout multi-pannello: albero puro (layout.ts) con verifiche a costo zero"
```

---

## Task 2: `Pane` — la chat come unità riusabile

**Files:**
- Create: `ui/src/lib/pane.svelte.ts`
- Read first: `ui/src/lib/store.svelte.ts:316-339` (il metodo `select()` di oggi — la
  logica da estrarre è quella)
- Read first: `ui/src/lib/api.ts` (firme di `snapshot()` e `stream()`)

**Interfaces:**
- Consumes: `Api` (già in `ui/src/lib/api.ts`), `applyTo`/`SessionSnapshot` da
  `$core/reduce.ts`, `LinkStatus` da `./api.ts`.
- Produces:
  ```ts
  export class Pane {
    readonly chatId: string
    snap = $state<SessionSnapshot | null>(null)
    link = $state<LinkStatus>('connecting')
    view = $state<'chat' | 'effects'>('chat')
    constructor(chatId: string)
    /** Apre lo snapshot iniziale e sottoscrive lo stream. Non lancia: un errore
     *  all'apertura lascia `snap` a `null`, e chi chiama (Store) decide cosa dire
     *  (`refused`), stessa forma di `select()` oggi. */
    open(api: Api): Promise<{ ok: true } | { ok: false; error: string }>
    /** Ferma lo stream. Idempotente: chiamarla due volte non fa niente la seconda. */
    close(): void
  }
  ```

- [ ] **Step 1: Scrivi `ui/src/lib/pane.svelte.ts`**

```ts
// Una chat aperta in un pannello: snapshot, stato del collegamento, e quale delle
// due letture (conversazione o effetti) sta mostrando. Estratta da `Store.select()`/
// `back()`, che facevano esattamente questo per **una sola** chat alla volta — con
// più pannelli serve un'istanza per chat, non più un singolo campo nello Store.

import { applyTo, type SessionSnapshot } from '$core/reduce.ts'
import type { Api, LinkStatus } from './api.ts'

export class Pane {
  readonly chatId: string
  snap = $state<SessionSnapshot | null>(null)
  link = $state<LinkStatus>('connecting')
  view = $state<'chat' | 'effects'>('chat')

  #stopStream: (() => void) | null = null

  constructor(chatId: string) {
    this.chatId = chatId
  }

  async open(api: Api): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const { snapshot } = await api.snapshot(this.chatId)
      this.snap = snapshot
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    // `from` è letto a ogni tentativo, non fissato adesso: stessa ragione di
    // `Store.select()` — dopo una caduta il punto giusto è avanzato.
    this.#stopStream = api.stream(
      this.chatId,
      () => this.snap?.lastSeq ?? 0,
      e => { if (this.snap && e.sessionId === this.snap.sessionId) applyTo(this.snap, e) },
      s => { this.link = s },
    )
    return { ok: true }
  }

  close(): void {
    this.#stopStream?.()
    this.#stopStream = null
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p ui/tsconfig.json`
Expected: nessun errore. Se `Api`/`LinkStatus` non sono esportati da `./api.ts`,
aggiungi `export` lì (non duplicare i tipi).

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/pane.svelte.ts
git commit -m "Layout multi-pannello: Pane, la chat come unità riusabile"
```

---

## Task 3: `Store` — pannelli, layout, persistenza

**Files:**
- Modify: `ui/src/lib/store.svelte.ts`

**Interfaces:**
- Consumes: `Pane` (Task 2), `LayoutNode`/`splitLeaf`/`closeLeaf`/`resizeSplit`/
  `reconcile`/`leafIds` (Task 1).
- Produces (nuovi membri pubblici di `Store`):
  ```ts
  panes: Map<string, Pane>          // $state
  layout: LayoutNode | null          // $state — null solo se non c'è nessuna chat aperta
  openPane(chatId: string): Promise<void>
  closePane(chatId: string): void
  splitPane(targetChatId: string, dir: 'row' | 'col', newChatId: string): Promise<void>
  resizePane(parentPath: number[], sizes: number[]): void
  focusPane(chatId: string): void
  ```
  `Store.selected` resta con lo stesso significato di oggi (la chat a fuoco) — questo
  task lo fa sempre corrispondere a una foglia di `layout` quando `layout` non è `null`.

**Nota:** questo task tocca codice esistente e delicato (`select`, `back`, `wake`,
`remove`, `#apriDaIndirizzo`). Leggi tutto `store.svelte.ts` prima di modificarlo — è
già stato letto in questa sessione, non serve rileggerlo da capo se il contesto persiste.

- [ ] **Step 1: Import e nuovi campi**

In cima a `store.svelte.ts`, accanto agli import esistenti:
```ts
import { Pane } from './pane.svelte.ts'
import { closeLeaf, leafIds, reconcile, splitLeaf, resizeSplit, type LayoutNode } from './layout.ts'
```

Dentro la classe `Store`, accanto a `selected`/`snap`/`link` (NON toglierli ancora —
Task 4/7 li useranno finché la migrazione non è completa):
```ts
/** Le chat aperte in un pannello, per id di chat. Sovrainsieme di `selected`: quando
 *  `layout` non è null, ogni foglia ha un `Pane` qui dentro. */
panes = $state<Map<string, Pane>>(new Map())
/** La disposizione dei pannelli sullo schermo largo. `null` vuol dire nessun
 *  pannello aperto (stato equivalente a `selected === null` di oggi). Ignorato
 *  sotto la soglia stretta: là si vede solo `panes.get(selected)`. */
layout = $state<LayoutNode | null>(null)

#LAYOUT_KEY = 'stark.layout'
```

- [ ] **Step 2: `openPane`, `closePane`, `focusPane`**

Subito dopo `select()` (che resta invariato per ora):
```ts
/** Apre `chatId` in un pannello nuovo, affiancato a fianco di quello a fuoco (se
 *  c'è già un layout) o come primo e unico pannello. Se `chatId` è già aperto in
 *  un pannello, lo porta a fuoco invece di aprirne un secondo (§una chat = un
 *  pannello, dalla spec). */
async openPane(chatId: string): Promise<void> {
  if (this.panes.has(chatId)) { this.focusPane(chatId); return }
  const pane = new Pane(chatId)
  const esito = await pane.open(this.api)
  if (!esito.ok) { this.refused = esito.error; return }
  this.panes.set(chatId, pane)
  this.panes = new Map(this.panes)
  this.layout = this.layout === null
    ? { type: 'leaf', paneId: chatId }
    // Nessuna direzione "giusta" senza un bersaglio: si affianca in riga al pannello
    // a fuoco attuale, se ce n'è uno; altrimenti diventa la seconda foglia della
    // radice esistente in riga.
    : splitLeaf(this.layout, this.selected ?? leafIds(this.layout)[0]!, 'row', chatId)
  this.focusPane(chatId)
  this.#saveLayout()
}

/** Chiude il pannello di `chatId`: ferma lo stream, lo toglie dall'albero. Se era
 *  l'unico pannello aperto, torna allo stato vuoto (`layout = null`, `selected =
 *  null`) — stesso esito di `Store.back()` oggi. */
closePane(chatId: string): void {
  const pane = this.panes.get(chatId)
  if (!pane) return
  pane.close()
  this.panes.delete(chatId)
  this.panes = new Map(this.panes)
  if (this.layout) this.layout = closeLeaf(this.layout, chatId)
  if (this.selected === chatId) {
    const next = this.layout ? leafIds(this.layout)[0] ?? null : null
    this.selected = next
    if (next) go(next, this.panes.get(next)?.view ?? 'chat')
    else go(null, 'chat')
  }
  this.#saveLayout()
}

/** Sposta il fuoco (e l'indirizzo) su un pannello già aperto. Non fa niente se
 *  `chatId` non ha un pannello — usa `openPane` per aprirne uno nuovo. */
focusPane(chatId: string): void {
  if (!this.panes.has(chatId)) return
  this.selected = chatId
  go(chatId, this.panes.get(chatId)?.view ?? 'chat')
  this.#saveLayout()
}
```

- [ ] **Step 3: `splitPane`, `resizePane`**

```ts
/** Trascinare una chat dalla sidebar su un bordo di un pannello: apre `newChatId`
 *  come foglia nuova accanto a `targetChatId`, nella direzione `dir`. Se
 *  `newChatId` era già aperto altrove, lo sposta lì invece di duplicarlo. */
async splitPane(targetChatId: string, dir: 'row' | 'col', newChatId: string): Promise<void> {
  if (newChatId === targetChatId) return
  if (!this.layout) { await this.openPane(newChatId); return }
  if (this.panes.has(newChatId)) {
    // Già aperto: si sposta la foglia invece di duplicarla. Chiuderla e riaprirla
    // accanto al bersaglio è più semplice che spostare un nodo nell'albero, e il
    // `Pane` non viene ricreato — resta la stessa istanza, nessuna riapertura dello
    // stream.
    this.layout = closeLeaf(this.layout, newChatId)
    this.layout = this.layout
      ? splitLeaf(this.layout, targetChatId, dir, newChatId)
      : { type: 'leaf', paneId: newChatId }
    this.focusPane(newChatId)
    this.#saveLayout()
    return
  }
  const pane = new Pane(newChatId)
  const esito = await pane.open(this.api)
  if (!esito.ok) { this.refused = esito.error; return }
  this.panes.set(newChatId, pane)
  this.panes = new Map(this.panes)
  this.layout = splitLeaf(this.layout, targetChatId, dir, newChatId)
  this.focusPane(newChatId)
  this.#saveLayout()
}

/** Il divisore fra i figli dello split a `parentPath` è stato rilasciato con le
 *  nuove proporzioni. Chiamare solo al rilascio (`pointerup`), non ad ogni frame
 *  del trascinamento — vedi la nota sulla persistenza nella spec. */
resizePane(parentPath: number[], sizes: number[]): void {
  if (!this.layout) return
  this.layout = resizeSplit(this.layout, parentPath, sizes)
  this.#saveLayout()
}
```

- [ ] **Step 4: Persistenza — salvataggio e caricamento**

```ts
#saveLayout(): void {
  if (!this.layout) { try { localStorage.removeItem(this.#LAYOUT_KEY) } catch { /* modalità privata */ } return }
  try {
    localStorage.setItem(this.#LAYOUT_KEY, JSON.stringify({ tree: this.layout, focused: this.selected }))
  } catch { /* modalità privata: il layout non sopravvive al ricaricamento, va bene così */ }
}

/**
 * Ricostruisce il layout salvato dopo il primo elenco (stesso cancello di
 * `#apriDaIndirizzo`: prima di allora non si sa quali chat esistono davvero).
 * Le foglie che puntano a chat sparite vengono tolte; se non ne resta nessuna,
 * lo stato è quello vuoto di sempre.
 */
async #ripristinaLayout(): Promise<void> {
  let salvato: { tree: LayoutNode; focused: string | null } | null = null
  try {
    const raw = localStorage.getItem(this.#LAYOUT_KEY)
    if (raw) salvato = JSON.parse(raw)
  } catch { /* localStorage assente o JSON corrotto: si riparte senza layout */ }
  if (!salvato) return
  const vive = new Set(this.rows.map(r => r.id))
  const tree = reconcile(salvato.tree, id => vive.has(id))
  if (!tree) return
  for (const id of leafIds(tree)) {
    const pane = new Pane(id)
    const esito = await pane.open(this.api)
    if (esito.ok) { this.panes.set(id, pane); this.panes = new Map(this.panes) }
  }
  const superstiti = reconcile(tree, id => this.panes.has(id))
  if (!superstiti) return
  this.layout = superstiti
  const focused = salvato.focused && this.panes.has(salvato.focused) ? salvato.focused : leafIds(superstiti)[0]!
  this.selected = focused
  this.snap = this.panes.get(focused)?.snap ?? null
  this.link = this.panes.get(focused)?.link ?? 'connecting'
}
```

- [ ] **Step 5: Collega il ripristino al primo elenco**

In `start()`, dentro il callback di `sessionsStream` (cerca `if (!this.#partita) { this.#partita = true; void this.#apriDaIndirizzo() }`), il ripristino del layout deve avvenire **solo se l'indirizzo non ha già aperto una chat specifica** — altrimenti un link diretto a `/chat/<id>` verrebbe scavalcato dal layout salvato. Sostituisci quella riga con:

```ts
if (!this.#partita) {
  this.#partita = true
  void (async () => {
    await this.#apriDaIndirizzo()
    if (this.selected === null) await this.#ripristinaLayout()
  })()
}
```

- [ ] **Step 6: Typecheck e verifiche esistenti**

Run: `npx tsc --noEmit -p ui/tsconfig.json`
Expected: nessun errore. Se `go`/`leafIds` non risolvono, controlla i path di import
(`./route.ts`, `./layout.ts`).

Run: `npm run check` (dalla radice del repo)
Expected: `109/109 verifiche passate` — questo task non tocca `src/core`/`src/daemon`,
quindi deve restare identico a prima.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/store.svelte.ts
git commit -m "Layout multi-pannello: Store tiene i pannelli e la loro disposizione"
```

---

## Task 4: `Conversation.svelte` ed `Effects.svelte` diventano pannello-consapevoli

**Files:**
- Modify: `ui/src/components/Conversation.svelte`
- Modify: `ui/src/components/Effects.svelte`

**Interfaces:**
- Consumes: niente di nuovo da altri task — solo un cambio di prop.
- Produces: la nuova firma prop di entrambi i componenti:
  ```ts
  // prima: { store, snap, link }
  // dopo:
  { store, snap, link, id, setView }: {
    store: Store; snap: SessionSnapshot; link: LinkStatus
    id: string                                    // la chat che QUESTO pannello mostra
    setView: (v: 'chat' | 'effects') => void       // sostituisce `store.show(view)`
  }
  ```

**Perché `id` invece di dedurlo da `snap.sessionId`:** `snap.sessionId` esiste già e
in teoria basterebbe — ma renderlo una prop esplicita, invece di leggerlo dentro il
componente, rende visibile a chi lo chiama (`Workspace`, `App`) che ogni istanza sta
mostrando una chat precisa, non "quella a fuoco". Riduce il rischio di un domani
riscrivere per sbaglio `store.selected` dentro uno di questi due file.

- [ ] **Step 1: `Conversation.svelte` — aggiorna la firma prop**

Riga 20 circa, cambia:
```ts
let { store, snap, link }:
```
in:
```ts
let { store, snap, link, id, setView }:
```
e nel blocco tipo subito sotto aggiungi `id: string` e
`setView: (v: 'chat' | 'effects') => void` ai membri esistenti.

- [ ] **Step 2: Sostituisci gli usi di `store.row`/`store.live`/`store.selected` con le versioni locali**

Riga ~276, cambia:
```ts
const title = $derived(store.row?.title ?? project(snap.cwd))
```
in:
```ts
const row = $derived(store.rows.find(r => r.id === id))
const title = $derived(row?.title ?? project(snap.cwd))
```

Ogni altro `store.live` nel file (righe ~355, ~372, ~473 secondo il grep fatto in
sessione — verifica i numeri di riga attuali con `grep -n "store\.live" ui/src/components/Conversation.svelte`
prima di editare, potrebbero essere spostati) diventa `row?.live ?? false`.

Riga ~321-322:
```ts
if (store.selected && draft.trim() && draft !== title) {
  await store.rename(store.selected, draft)
```
diventa:
```ts
if (draft.trim() && draft !== title) {
  await store.rename(id, draft)
```

- [ ] **Step 3: Sostituisci le chiamate a comandi con l'id esplicito**

`store.sleep()` → `store.sleep(id)`.
`store.setMode('default')` → `store.setMode('default')` **non cambia** — `setMode`
manda `session.setMode` che nel daemon si applica alla sessione del comando, ma
`Store.setMode` oggi non accetta un id (`send({ c: 'session.setMode', mode })`,
target implicito `this.selected`). Aggiungi il parametro:

In `store.svelte.ts` (non in questo file — nota per non perdere il collegamento):
```ts
setMode(mode: PermissionMode, id = this.selected): Promise<boolean> { return this.send({ c: 'session.setMode', mode }, id) }
```
poi qui in `Conversation.svelte`: `store.setMode('default', id)`.

- [ ] **Step 4: Sostituisci `store.show('effects')` con `setView('effects')`**

Riga ~362: `onclick={() => store.show('effects')}` diventa `onclick={() => setView('effects')}`.

- [ ] **Step 5: `Effects.svelte` — stessa cosa, un solo punto**

Aggiorna la firma prop allo stesso modo (`id`, `setView`), poi riga ~69:
`onclick={() => store.show('chat')}` diventa `onclick={() => setView('chat')}`.
Se `Effects.svelte` non usa `id` per altro, va comunque accettato nella firma (anche
se inutilizzato lì) — `Workspace` lo passerà sempre, per uniformità con `Conversation`.

- [ ] **Step 6: Aggiorna il chiamante esistente in `App.svelte` (temporaneo — Task 7 lo riscrive del tutto)**

Riga ~86-89 di `App.svelte`, dove oggi c'è:
```svelte
{:else if store.snap && store.view === 'effects'}
  <Effects {store} snap={store.snap} />
{:else if store.snap}
  <Conversation {store} snap={store.snap} link={store.link} />
```
aggiungi le due prop nuove così il file continua a compilare (Task 7 sostituirà
questo blocco per intero, questo è solo per non rompere la build a metà):
```svelte
{:else if store.snap && store.view === 'effects'}
  <Effects {store} snap={store.snap} id={store.selected ?? ''} setView={v => store.show(v)} />
{:else if store.snap}
  <Conversation {store} snap={store.snap} link={store.link} id={store.selected ?? ''} setView={v => store.show(v)} />
```

- [ ] **Step 7: Build e typecheck**

Run: `npx tsc --noEmit -p ui/tsconfig.json && npm run ui:build` (dalla radice, o
`cd ui && npx vite build` — usa lo script che il repo ha già, vedi `package.json`)
Expected: nessun errore, build completa.

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/Conversation.svelte ui/src/components/Effects.svelte ui/src/App.svelte ui/src/lib/store.svelte.ts
git commit -m "Layout multi-pannello: Conversation/Effects prendono id e setView invece di store.selected"
```

---

## Task 5: `Workspace.svelte` — il renderizzatore ricorsivo

**Files:**
- Create: `ui/src/components/Workspace.svelte`
- Read first: `ui/src/components/Conversation.svelte`, `ui/src/components/Effects.svelte`
  (le firme prop finali dal Task 4), `ui/src/lib/layout.ts` (Task 1)

**Interfaces:**
- Consumes: `Store.layout`, `Store.panes`, `Store.focusPane`, `Store.closePane`,
  `Store.resizePane`, `LayoutNode` — tutti da task precedenti.
- Produces: componente `Workspace` con prop `{ store: Store }`, montato da `App.svelte`
  al posto del blocco singolo-pannello quando `store.layout !== null` e `!store.narrow`.

- [ ] **Step 1: Scrivi `Workspace.svelte`**

```svelte
<script lang="ts">
  // Renderizza `store.layout` ricorsivamente: una foglia è una chat con la sua
  // conversazione (o i suoi effetti) e la sua casella di scrittura — una
  // mini-conversazione completa e indipendente, non una vista in sola lettura.
  // Uno split è una riga o colonna flex coi divisori trascinabili.
  import type { LayoutNode } from '../lib/layout.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import Conversation from './Conversation.svelte'
  import Effects from './Effects.svelte'
  import Icon from './Icon.svelte'

  let { store, node = store.layout, path = [] }:
    { store: Store; node?: LayoutNode | null; path?: number[] } = $props()

  let trascinando = $state<number | null>(null) // indice del divisore in trascinamento, o null

  function onDividerDown(i: number): void {
    trascinando = i
  }
  function onDividerMove(e: PointerEvent, dir: 'row' | 'col', container: HTMLElement): void {
    if (trascinando === null || node?.type !== 'split') return
    const rect = container.getBoundingClientRect()
    const pos = dir === 'row' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height
    const sizes = [...node.sizes]
    // Il divisore `i` sta fra i figli i e i+1: sposta massa da uno all'altro,
    // tenendo fermi gli altri — è il comportamento minimo che un utente si aspetta
    // da un divisore, senza dover normalizzare l'intera riga ad ogni pixel.
    const i = trascinando
    const cumBefore = sizes.slice(0, i).reduce((a, b) => a + b, 0)
    const cumThrough = cumBefore + sizes[i]! + sizes[i + 1]!
    const nuovo = Math.min(Math.max(pos, cumBefore + 0.05), cumThrough - 0.05)
    sizes[i] = nuovo - cumBefore
    sizes[i + 1] = cumThrough - nuovo
    node.sizes = sizes // aggiornamento visivo immediato, non ancora salvato
  }
  function onDividerUp(): void {
    if (trascinando === null || node?.type !== 'split') { trascinando = null; return }
    store.resizePane(path, node.sizes)
    trascinando = null
  }

  function dragOverZone(e: DragEvent): 'center' | 'top' | 'bottom' | 'left' | 'right' {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const EDGE = 0.25
    if (y < EDGE) return 'top'
    if (y > 1 - EDGE) return 'bottom'
    if (x < EDGE) return 'left'
    if (x > 1 - EDGE) return 'right'
    return 'center'
  }

  let zonaAttiva = $state<string | null>(null)

  function onDrop(e: DragEvent, targetChatId: string): void {
    e.preventDefault()
    const nuovoId = e.dataTransfer?.getData('text/stark-chat-id')
    zonaAttiva = null
    if (!nuovoId) return
    const zona = dragOverZone(e)
    if (zona === 'center') { void store.focusPane(nuovoId) === undefined && void store.openPane(nuovoId); return }
    const dir = zona === 'left' || zona === 'right' ? 'row' : 'col'
    void store.splitPane(targetChatId, dir, nuovoId)
  }
</script>

{#if node?.type === 'leaf'}
  {@const pane = store.panes.get(node.paneId)}
  {#if pane?.snap}
    <div class="pane"
      role="presentation"
      ondragover={e => { e.preventDefault(); zonaAttiva = `${node.paneId}:${dragOverZone(e)}` }}
      ondragleave={() => { zonaAttiva = null }}
      ondrop={e => onDrop(e, node.paneId)}>
      <div class="paneh">
        <span class="panet">{pane.snap.cwd}</span>
        <button class="iconb" title="Close panel" onclick={() => store.closePane(node.paneId)}>
          <Icon name="i-x" />
        </button>
      </div>
      {#if zonaAttiva?.startsWith(`${node.paneId}:`)}
        <div class="dropzone {zonaAttiva.split(':')[1]}"></div>
      {/if}
      {#if pane.view === 'effects'}
        <Effects {store} snap={pane.snap} id={node.paneId} setView={v => { pane.view = v }} />
      {:else}
        <Conversation {store} snap={pane.snap} link={pane.link} id={node.paneId}
          setView={v => { pane.view = v }} />
      {/if}
    </div>
  {/if}
{:else if node?.type === 'split'}
  <div class="split {node.dir}"
    role="presentation"
    onpointermove={e => onDividerMove(e, node.dir, e.currentTarget as HTMLElement)}
    onpointerup={onDividerUp}>
    {#each node.children as child, i (i)}
      <div class="cell" style="flex-basis:{(node.sizes[i] ?? 0) * 100}%">
        <Workspace {store} node={child} path={[...path, i]} />
      </div>
      {#if i < node.children.length - 1}
        <div class="divider {node.dir}" role="separator" tabindex="-1"
          onpointerdown={() => onDividerDown(i)}></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .split { display: flex; width: 100%; height: 100%; }
  .split.col { flex-direction: column; }
  .cell { min-width: 0; min-height: 0; overflow: hidden; }
  .divider { flex: none; background: var(--line-2); cursor: col-resize; }
  .split.row > .divider { width: 4px; }
  .split.col > .divider { height: 4px; cursor: row-resize; }
  .pane { position: relative; display: flex; flex-direction: column; height: 100%; min-width: 0; }
  .paneh { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--line-2); flex: none; }
  .panet { flex: 1; font-size: 10.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dropzone { position: absolute; inset: 0; pointer-events: none; background: var(--accent-soft); opacity: .5; z-index: 3; }
  .dropzone.center { inset: 20% 20%; }
  .dropzone.top { inset: 0 0 75% 0; }
  .dropzone.bottom { inset: 75% 0 0 0; }
  .dropzone.left { inset: 0 75% 0 0; }
  .dropzone.right { inset: 0 0 0 75%; }
</style>
```

**Nota per chi implementa:** la riga
`if (zona === 'center') { void store.focusPane(nuovoId) === undefined && void store.openPane(nuovoId); return }`
è scritta male apposta per essere corretta qui — `focusPane` è sincrono (non
`Promise`), il `void ... === undefined` è un trucco confuso. Sostituiscila con:
```ts
if (zona === 'center') {
  if (store.panes.has(nuovoId)) store.focusPane(nuovoId)
  else void store.splitPane(targetChatId, 'row', nuovoId) // vedi Step 2 sotto: nessuna vera "sostituzione in loco" nell'MVP, si affianca
  return
}
```
Se emerge un modo più pulito per "sostituisci il pannello bersaglio con la chat
trascinata" mentre si implementa, preferiscilo — ma verifica prima con
`store.splitPane`/`closeLeaf` che non serva una funzione `replaceLeaf` nuova in
`layout.ts` (Task 1). Se serve, aggiungila lì con lo stesso trattamento a funzione
pura + verifica in `ui-check.ts`, non qui dentro come caso speciale.

- [ ] **Step 2: Aggiungi `draggable`/`dragstart` alla riga della sidebar**

In `ui/src/components/Sidebar.svelte`, trova la riga che oggi ha
`onclick={() => void store.select(row.id)}` (circa riga 176). Il contenitore di
quella riga (l'elemento cliccabile, probabilmente un `<button>` o `<div role="button">`
poco sopra quella riga — leggi il file per trovare l'elemento giusto) prende:
```svelte
draggable="true"
ondragstart={e => e.dataTransfer?.setData('text/stark-chat-id', row.id)}
```

- [ ] **Step 3: Verifica dal vivo con Playwright**

Non esiste automazione da riga di comando per il drag-and-drop di questo repo — va
verificato con uno screenshot/interazione reale, come da convenzione (`docs/ui-schermate.md`,
tutte le rifiniture mobile in CLAUDE.md sono verificate così). Usa gli strumenti
`mcp__playwright__*` (o `mcp__chrome-devtools__*`) già connessi in sessione:

1. Avvia il daemon di prova: `npm run daemon` in background, o riusa un journal
   esistente come fa `npm run check`.
2. Apri due chat nella UI, trascina la riga di una sulla metà destra dell'altra.
3. Screenshot: due pannelli affiancati, ognuno con la propria casella di scrittura.
4. Trascina il divisore fra i due, rilascia, ricarica la pagina: le proporzioni
   sono quelle lasciate (persistenza).
5. Chiudi un pannello con `×`: l'altro resta, a schermo intero.

Se qualunque di questi passi non si comporta come descritto, NON procedere al
task successivo — correggi qui.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/Workspace.svelte ui/src/components/Sidebar.svelte
git commit -m "Layout multi-pannello: Workspace, il renderizzatore ricorsivo con drag e resize"
```

---

## Task 6: `App.svelte` — monta `Workspace` sullo schermo largo

**Files:**
- Modify: `ui/src/App.svelte`

**Interfaces:**
- Consumes: `Workspace` (Task 5), `Store.layout`/`panes` (Task 3).

- [ ] **Step 1: Sostituisci il blocco Task-4-temporaneo con la versione finale**

Il blocco che Task 4/Step 6 aveva lasciato provvisorio:
```svelte
{:else if store.snap && store.view === 'effects'}
  <Effects {store} snap={store.snap} id={store.selected ?? ''} setView={v => store.show(v)} />
{:else if store.snap}
  <Conversation {store} snap={store.snap} link={store.link} id={store.selected ?? ''} setView={v => store.show(v)} />
```
diventa, per lo schermo largo (`!store.narrow`), il montaggio di `Workspace` intero
quando c'è un layout con più di una foglia — con **una** foglia sola il comportamento
deve restare visivamente identico a oggi (nessuna cornice di pannello superflua
attorno a un'unica chat a schermo intero). Quindi:

```svelte
{:else if store.layout && leafIds(store.layout).length > 1 && !store.narrow}
  <Workspace {store} />
{:else if store.snap && store.view === 'effects'}
  <Effects {store} snap={store.snap} id={store.selected ?? ''} setView={v => store.show(v)} />
{:else if store.snap}
  <Conversation {store} snap={store.snap} link={store.link} id={store.selected ?? ''} setView={v => store.show(v)} />
```

Aggiungi l'import in cima al file:
```ts
import Workspace from './components/Workspace.svelte'
import { leafIds } from './lib/layout.ts'
```

- [ ] **Step 2: Collega l'apertura da sidebar a `openPane` quando c'è già un layout**

`Store.select()` (chiamato da un click sulla sidebar) oggi sostituisce sempre il
pannello singolo. Con un layout multi-pannello attivo, un click semplice (non un
drag) deve continuare a fare la stessa cosa di sempre — **sostituire** il pannello a
fuoco, non aprirne uno nuovo affiancato: aprire un pannello nuovo è un'azione
esplicita (drag), non il click normale. Verifica che `Sidebar.svelte` continui a
chiamare `store.select(row.id)` sul click semplice, invariato — questo task non lo
tocca. `openPane`/`splitPane` si raggiungono **solo** dal drag (Task 5).

Nessun codice da scrivere in questo step: è una verifica di non-regressione. Apri
`Sidebar.svelte` e conferma che l'`onclick` esistente non è stato toccato dal Task 5.

- [ ] **Step 3: Build e verifica dal vivo**

Run: `npx tsc --noEmit -p ui/tsconfig.json && npx vite build` (dalla cartella `ui/`,
o lo script equivalente in `package.json` alla radice)
Expected: nessun errore.

Poi con Playwright/Chrome DevTools (screenshot reale, non dedotto):
1. Una sola chat aperta → schermo identico a prima di questo lavoro (nessun bordo
   di pannello, nessun bottone `×` superfluo).
2. Due chat aperte via drag → due pannelli, ognuno usabile indipendentemente
   (scrivi in uno, l'altro non cambia fuoco).
3. Schermo stretto (ridimensiona la finestra sotto 860px, o `resize_page`/
   `browser_resize` a 390px): un solo pannello visibile, quello a fuoco — il
   layout multi-pannello sparisce del tutto, come da spec.

- [ ] **Step 4: Commit**

```bash
git add ui/src/App.svelte
git commit -m "Layout multi-pannello: App monta Workspace sullo schermo largo con più di un pannello"
```

---

## Task 7: Stili — pannelli, divisori, zone di drop

**Files:**
- Modify: `ui/src/app.css` (variabili/stili condivisi, se `Workspace.svelte` ne ha
  bisogno oltre a quelli già scritti nel proprio blocco `<style>` al Task 5)

**Nota:** la maggior parte dello stile è già dentro `Workspace.svelte` (Task 5, scoped).
Questo task è di rifinitura, non di struttura — verifica dal vivo (screenshot) prima
di aggiungere qualunque cosa qui: se Task 5 già passa la verifica visiva, questo task
può risultare vuoto, e va bene così (non inventare stili senza un difetto osservato).

- [ ] **Step 1: Screenshot a 1400px e 390px del layout con 2 e 3 pannelli**

Usa Playwright/Chrome DevTools. Guarda in particolare: contrasto del divisore (deve
vedersi ma non dominare), l'header del pannello non deve rubare più di ~28px di
altezza (coerente con l'header della chat singola, misurato altrove in questo repo
a 22px dopo la rifinitura mobile — vedi CLAUDE.md, sezione «header della chat»).

- [ ] **Step 2: Correggi solo i difetti osservati, con la stessa misura A/B usata nel resto del repo**

(Nessun codice precompilato qui: dipende da cosa lo screenshot mostra. Segui lo
stile delle correzioni già documentate in CLAUDE.md — misura, non deduzione.)

- [ ] **Step 3: Commit (solo se sono stati fatti cambi)**

```bash
git add ui/src/app.css ui/src/components/Workspace.svelte
git commit -m "Layout multi-pannello: rifiniture visive verificate dal vivo"
```

---

## Task 8: Changelog

**Files:**
- Modify: `CLAUDE.md` (sezione "Stato attuale", segue lo stile narrativo del resto
  del file — leggi almeno gli ultimi 3-4 paragrafi prima di scrivere il tuo, per il
  tono e il livello di dettaglio)

- [ ] **Step 1: Aggiungi un paragrafo che descrive la feature, con la data odierna**

Segui esattamente lo stile esistente: cosa è stato chiesto, quali decisioni non
ovvie sono state prese (una chat = un pannello, il layout ignora lo schermo stretto,
persistenza solo nel browser) e perché, cosa è stato verificato dal vivo e come.
Non inventare numeri di verifica — riporta quelli reali da `npm run check` e
`node src/cli/ui-check.ts` dopo l'ultimo commit di questo piano.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Documenta il layout multi-pannello in CLAUDE.md"
```

---

## Verifica finale (prima di proporre il merge)

- [ ] `npm run check` → tutte le verifiche passano (numero invariato rispetto alla
  baseline registrata a inizio lavoro: 109/109)
- [ ] `node src/cli/ui-check.ts` → tutte le verifiche di `layout.ts` passano
- [ ] `npx tsc --noEmit -p ui/tsconfig.json` → nessun errore
- [ ] `npx vite build` (dentro `ui/`) → build completa senza errori
- [ ] Verifica dal vivo (Playwright/Chrome DevTools, screenshot reali): split
  orizzontale, split verticale, drag dalla sidebar, ridimensionamento con
  persistenza dopo reload, chiusura di un pannello, schermo stretto che ignora
  il layout — tutti e sei i punti della lista, uno per uno, non "sembra funzionare"
