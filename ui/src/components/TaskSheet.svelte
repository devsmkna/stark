<script lang="ts">
  // Il foglio del task su schermo stretto (card #35).
  //
  // Su mobile il click su un chip `#NNN` non deve trascinare dentro la vista Board
  // intera — colonne larghe, dettaglio in-panel, tutto pensato per un monitor. Qui si
  // apre SOLO il dettaglio, a tutto schermo, e la X riporta in chat. Lo scrive
  // `store.openBoardTask` quando `store.narrow` è vero; su desktop quel metodo
  // continua ad aprire la Board come prima.
  //
  // I dati si chiedono con un fetch singolo, non col flusso SSE della Board: il
  // foglio vive pochi secondi, e lo stato che mostra è quello del momento del click —
  // per il vivo c'è la Board. Se la board nel frattempo è sparita o il task non c'è
  // più, si degrada a un messaggio, mai a un errore (stessa regola dei chip).
  import TaskDetail from './TaskDetail.svelte'
  import type { Store } from '../lib/store.svelte.ts'
  import type { BoardTask } from '../lib/api.ts'

  const { store }: { store: Store } = $props()

  let task = $state<BoardTask | null>(null)
  let statuses = $state<string[]>([])
  let fallita = $state(false)

  $effect(() => {
    const rif = store.taskSheet
    task = null
    statuses = []
    fallita = false
    if (!rif) return
    store.api.board(rif.sessione).then((b) => {
      if (store.taskSheet !== rif) return // nel frattempo è cambiato o chiuso
      statuses = b.columns.map(c => c.status)
      task = b.columns.flatMap(c => c.tasks).find(t => t.id === rif.id) ?? null
      if (!task) fallita = true
    }).catch(() => { fallita = true })
  })

  function chiudi(): void { store.taskSheet = null }

  async function cambiaStato(originale: BoardTask, nuovo: string): Promise<void> {
    const rif = store.taskSheet
    if (!rif || nuovo === originale.status) return
    task = { ...originale, status: nuovo }
    await store.api.boardEdit(rif.sessione, originale.id, { status: nuovo }).catch(() => {})
  }
</script>

{#if store.taskSheet}
  <div class="scrim" role="presentation" onclick={chiudi}></div>
  <div class="tsheet">
    {#if task}
      <TaskDetail {task} {statuses}
        onstatus={(originale, nuovo) => { void cambiaStato(originale, nuovo) }}
        onclose={chiudi} />
    {:else}
      <div class="vuoto">
        <span>{fallita ? 'This task is not on the board anymore.' : 'Reading…'}</span>
        <button class="x" aria-label="Close" onclick={chiudi}>Close</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* A tutto schermo sotto la barra di sistema: su un telefono un "pannello a lato"
     non esiste, e un dialog piccolo renderebbe illeggibile proprio il corpo. */
  .tsheet { position: fixed; inset: 0; z-index: 60; background: var(--surface);
            display: flex; flex-direction: column; }
  .vuoto { padding: 24px 16px; color: var(--muted); font-size: 12px; display: flex;
           flex-direction: column; gap: 14px; align-items: flex-start; }
  .vuoto .x { font: inherit; font-size: 11px; color: var(--ink); background: var(--surface);
              border: 1px solid var(--line-2); border-radius: 7px; padding: 5px 12px; cursor: pointer; }
</style>
