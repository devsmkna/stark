<script lang="ts">
  // Renderizza `store.layout` ricorsivamente.
  //
  // Una foglia è una chat intera — conversazione (o effetti) **e** casella di scrittura:
  // una mini-conversazione completa e indipendente, non una vista in sola lettura. Uno
  // split è una riga o una colonna flex, con un divisore trascinabile fra i fratelli.
  import type { LayoutNode } from '../lib/layout.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import Conversation from './Conversation.svelte'
  import Effects from './Effects.svelte'
  import Workspace from './Workspace.svelte'

  let { store, node = store.layout, path = [] }:
    { store: Store; node?: LayoutNode | null; path?: number[] } = $props()

  // ─── divisori ───────────────────────────────────────────────────────────────

  let box: HTMLElement | undefined = $state()
  let trascinando = $state<number | null>(null)

  /**
   * Il divisore prende il puntatore invece di lasciare l'ascolto al contenitore: senza
   * cattura, uscire dal riquadro col mouse premuto — cosa che capita di continuo, un
   * divisore è largo quattro pixel — interrompe il trascinamento a metà. Il calcolo
   * resta relativo al contenitore, che è il riquadro dentro cui le proporzioni valgono.
   */
  function giu(e: PointerEvent, i: number): void {
    trascinando = i
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function muovi(e: PointerEvent): void {
    if (trascinando === null || node?.type !== 'split' || !box) return
    const rect = box.getBoundingClientRect()
    const pos = node.dir === 'row'
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height
    const i = trascinando
    const sizes = [...node.sizes]
    // Il divisore `i` sta fra i figli `i` e `i+1`: si sposta massa dall'uno all'altro
    // tenendo fermi gli altri. È il minimo che ci si aspetta da un divisore, e evita
    // di rinormalizzare l'intera riga a ogni pixel. Il 5% è il fondo sotto cui un
    // pannello non è più usabile, solo stretto abbastanza da non poterlo riafferrare.
    const prima = sizes.slice(0, i).reduce((a, b) => a + b, 0)
    const fine = prima + sizes[i]! + sizes[i + 1]!
    const nuovo = Math.min(Math.max(pos, prima + 0.05), fine - 0.05)
    sizes[i] = nuovo - prima
    sizes[i + 1] = fine - nuovo
    node.sizes = sizes // subito a schermo; su disco solo al rilascio
  }

  function su(): void {
    if (trascinando !== null && node?.type === 'split') store.resizePane(path, node.sizes)
    trascinando = null
  }

  // ─── zone di rilascio ───────────────────────────────────────────────────────

  type Zona = 'center' | 'top' | 'bottom' | 'left' | 'right'

  /** Il quarto di riquadro più vicino al puntatore, o il centro. */
  function zonaDi(e: DragEvent): Zona {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const BORDO = 0.25
    if (y < BORDO && y <= x && y <= 1 - x) return 'top'
    if (y > 1 - BORDO && 1 - y <= x && 1 - y <= 1 - x) return 'bottom'
    if (x < BORDO) return 'left'
    if (x > 1 - BORDO) return 'right'
    return 'center'
  }

  let zona = $state<Zona | null>(null)

  function lascia(e: DragEvent, bersaglio: string): void {
    e.preventDefault()
    const nuovo = e.dataTransfer?.getData('text/stark-chat-id') ?? store.draggingChat
    const dove = zona
    zona = null
    store.draggingChat = null
    if (!nuovo || !dove) return
    if (dove === 'center') { void store.replacePane(bersaglio, nuovo); return }
    void store.splitPane(bersaglio, dove === 'left' || dove === 'right' ? 'row' : 'col', nuovo)
  }
</script>

{#if node?.type === 'leaf'}
  {@const id = node.paneId}
  {@const pane = store.panes.get(id)}
  <div class="pane" class:on={store.selected === id}
    role="presentation"
    onpointerdowncapture={() => store.focusPane(id)}>
    {#if pane?.snap}
      {#if pane.view === 'effects'}
        <Effects {store} snap={pane.snap} {id} setView={v => { pane.view = v }}
          onClose={() => store.closePane(id)} />
      {:else}
        <Conversation {store} snap={pane.snap} link={pane.link} {id}
          setView={v => { pane.view = v }} onClose={() => store.closePane(id)} />
      {/if}
    {:else}
      <div class="mid">Opening…</div>
    {/if}

    <!-- La zona di rilascio esiste **solo** durante un trascinamento di chat, e per
         questo copre tutto il pannello: sotto ci sono già altri bersagli (la casella
         accetta immagini), e due significati sullo stesso pixel si contendono il drop.
         Fuori dal trascinamento non c'è niente qui sopra. -->
    {#if store.draggingChat && store.draggingChat !== id}
      <div class="drop" role="presentation"
        ondragover={e => { e.preventDefault(); zona = zonaDi(e) }}
        ondragleave={() => { zona = null }}
        ondrop={e => lascia(e, id)}>
        {#if zona}<div class="hint {zona}"></div>{/if}
      </div>
    {/if}
  </div>
{:else if node?.type === 'split'}
  <div class="split {node.dir}" bind:this={box}>
    {#each node.children as child, i (i)}
      <div class="cell" style="flex:{node.sizes[i] ?? 1 / node.children.length}">
        <Workspace {store} node={child} path={[...path, i]} />
      </div>
      {#if i < node.children.length - 1}
        <div class="div {node.dir}" class:drag={trascinando === i}
          role="separator" aria-orientation={node.dir === 'row' ? 'vertical' : 'horizontal'}
          onpointerdown={e => giu(e, i)}
          onpointermove={muovi}
          onpointerup={su}
          onlostpointercapture={su}></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .split { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .split.col { flex-direction: column; }
  /* `flex-basis:0` con `flex-grow` proporzionale: le proporzioni valgono sullo spazio
     vero, non sul contenuto — se no un pannello con dentro un turno larghissimo si
     prenderebbe più della sua parte. */
  .cell { flex-basis: 0; min-width: 0; min-height: 0; overflow: hidden; display: flex; }
  .cell > :global(*) { flex: 1; min-width: 0; min-height: 0; }

  .div { flex: none; background: var(--line); position: relative; }
  .split.row > .div { width: 1px; cursor: col-resize; }
  .split.col > .div { height: 1px; cursor: row-resize; }
  /* Un pixel si vede ma non si afferra: l'area sensibile è più larga della linea,
     e sborda sui pannelli senza spostarli di nulla. */
  .div::after {
    content: ''; position: absolute; inset: -3px;
  }
  .div:hover, .div.drag { background: var(--accent); }

  .pane { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; }
  .pane > :global(.col) { flex: 1; min-width: 0; min-height: 0; }
  /* Quale pannello riceve i comandi della barra in basso: una riga sola in cima, dove
     un bordo su tutti e quattro i lati mangerebbe spazio a ogni pannello per dire una
     cosa che riguarda uno solo. */
  .pane.on::before {
    content: ''; position: absolute; inset: 0 0 auto 0; height: 2px;
    background: var(--accent); z-index: 4; pointer-events: none;
  }

  .drop { position: absolute; inset: 0; z-index: 6; }
  .hint {
    position: absolute; background: var(--accent); opacity: .28;
    outline: 1px solid var(--accent); pointer-events: none;
  }
  .hint.center { inset: 12%; }
  .hint.top { inset: 0 0 50% 0; }
  .hint.bottom { inset: 50% 0 0 0; }
  .hint.left { inset: 0 50% 0 0; }
  .hint.right { inset: 0 0 0 50%; }
</style>
