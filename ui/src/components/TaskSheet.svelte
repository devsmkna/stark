<script lang="ts">
  // Il dettaglio del task aperto da un chip `#NNN` (card #35, poi #36).
  //
  // Il click su un chip non deve trascinare dentro la vista Board intera — colonne
  // larghe, dettaglio in-panel, un'impalcatura che qui non serve. Si apre SOLO il
  // dettaglio: foglio a tutto schermo su telefono, modale centrata da 860px in su
  // (la differenza è nel CSS in fondo, non nel codice). Lo scrive
  // `store.openBoardTask`; la Board col pannello laterale resta per chi la apre dal
  // suo bottone.
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
  let errore = $state('')

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
    errore = ''
    // `boardEdit` risolve anche sul rifiuto logico ({ok:false, motivo}): un `.catch`
    // da solo lo lascerebbe passare, e lo stato ottimistico resterebbe una bugia.
    // Come in Board.svelte si mostra il motivo — e in più si torna allo stato vero,
    // perché qui non c'è un flusso SSE che lo corregga da sé.
    const esito = await store.api.boardEdit(rif.sessione, originale.id, { status: nuovo })
      .catch(() => ({ ok: false, motivo: 'daemon unreachable' }))
    if (!esito.ok) {
      task = originale
      errore = esito.motivo ?? 'edit refused'
    }
  }
</script>

{#if store.taskSheet}
  <div class="scrim" role="presentation" onclick={chiudi}></div>
  <div class="tsheet">
    {#if task}
      <TaskDetail {task} {statuses}
        onstatus={(originale, nuovo) => { void cambiaStato(originale, nuovo) }}
        onclose={chiudi} />
      {#if errore}<div class="err">{errore}</div>{/if}
    {:else}
      <div class="vuoto">
        <span>{fallita ? 'This task is not on the board anymore.' : 'Reading…'}</span>
        <button class="x" aria-label="Close" onclick={chiudi}>Close</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Su telefono a tutto schermo (un "pannello a lato" lì non esiste, e un dialog
     piccolo renderebbe illeggibile proprio il corpo); da 860px in su — la stessa
     soglia di `store.narrow` — una modale centrata con la veste di `.dlg` (card #36).
     z-index 9 = la scala dei dialog dell'app (scrim 8, dlg 9, Splash/Login 12):
     un numero fuori scala finirebbe SOPRA lo Splash, che deve coprire tutto. */
  .tsheet { position: fixed; inset: 0; z-index: 9; background: var(--surface);
            display: flex; flex-direction: column; }
  @media (min-width: 860px) {
    .tsheet { inset: auto; left: 50%; top: 50%; transform: translate(-50%, -50%);
              width: min(520px, calc(100vw - 80px));
              max-height: min(640px, calc(100vh - 80px));
              border: 1px solid var(--line-2); border-radius: 12px;
              box-shadow: 0 24px 60px rgba(16, 20, 32, .32); overflow: hidden; }
  }
  .err { padding: 10px 14px; font-size: 11px; color: var(--stop); background: var(--stop-bg);
         border-top: 1px solid var(--line); }
  .vuoto { padding: 24px 16px; color: var(--muted); font-size: 12px; display: flex;
           flex-direction: column; gap: 14px; align-items: flex-start; }
  .vuoto .x { font: inherit; font-size: 11px; color: var(--ink); background: var(--surface);
              border: 1px solid var(--line-2); border-radius: 7px; padding: 5px 12px; cursor: pointer; }
</style>
