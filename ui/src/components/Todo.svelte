<script lang="ts">
  // La colonna dei task del **progetto** della chat a fuoco.
  //
  // Del progetto e non della chat: il file sta accanto al codice, quindi due
  // conversazioni sulla stessa cartella vedono la stessa lista — che è quello che ci si
  // aspetta da una colonna che resta lì mentre si cambia chat.
  //
  // Sola lettura, per ora, e va detto invece di lasciarlo scoprire: se STARK scrivesse in
  // quel file diventerebbe un secondo scrittore mentre l'agent è in mezzo a un turno, e
  // due scritture che si sovrappongono si perdono a vicenda.
  import Icon from './Icon.svelte'
  import type { Store } from '../lib/store.svelte.ts'
  import type { Todos, TodoTask } from '../lib/api.ts'

  const { store }: { store: Store } = $props()

  let dati = $state<Todos | null>(null)
  let errore = $state('')

  // Si riaggancia quando cambia la chat a fuoco, perché cambia il progetto. Il flusso
  // manda subito lo stato di partenza, quindi non serve una lettura a parte prima.
  $effect(() => {
    const id = store.selected
    dati = null
    errore = ''
    if (!id) return
    const stacca = store.api.todoStream(id, t => { dati = t; errore = '' }, s => {
      if (s === 'lost') errore = 'connessione persa'
    })
    return stacca
  })

  const SEGNO: Record<TodoTask['state'], string> = {
    done: 'i-check', doing: 'i-dot', blocked: 'i-warn', todo: 'i-circle',
  }
  const vive = $derived((dati?.lists ?? []).filter(l => l.status === 'active' || l.status === 'paused'))
  const chiuse = $derived((dati?.lists ?? []).filter(l => l.status === 'done' || l.status === 'abandoned'))
  let mostraChiuse = $state(false)
  const fatti = (l: { tasks: TodoTask[] }): number => l.tasks.filter(t => t.state === 'done').length
</script>

<aside class="todocol">
  <div class="th">
    <span class="tt">Todo</span>
    {#if dati?.cwd}<span class="pj">{dati.cwd.replace(/\/+$/, '').split('/').pop()}</span>{/if}
    <button class="x" aria-label="Close todo" onclick={() => store.toggleTodo()}>
      <Icon name="i-x" />
    </button>
  </div>

  <div class="body">
    {#if !store.selected}
      <div class="empty">Pick a chat: the list belongs to its project.</div>
    {:else if errore}
      <div class="empty">{errore}</div>
    {:else if dati === null}
      <div class="empty">Reading…</div>
    {:else if dati.assente}
      <!-- «Non c'è ancora» non è «è vuota»: la prima è la condizione normale di un
           progetto nuovo, e dire come nasce una lista vale più di un vuoto muto. -->
      <div class="empty">No list yet.<br />Ask the agent to keep track of something and
        it will write one in <code>.stark/todo.json</code>.</div>
    {:else if dati.lists.length === 0}
      <div class="empty">The list file is here, but it has nothing in it.</div>
    {:else}
      {#each vive as l (l.id)}
        <div class="lst">
          <div class="lh">
            <span class="lt">{l.title}</span>
            <span class="cnt">{fatti(l)}/{l.tasks.length}</span>
          </div>
          {#if l.status === 'paused'}<div class="pau">paused</div>{/if}
          {#each l.tasks as t (t.id)}
            <div class="tk s-{t.state}">
              <Icon name={SEGNO[t.state]} />
              <div>
                <div class="tx">{t.text}</div>
                {#if t.note}<div class="nt">{t.note}</div>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}

      {#if chiuse.length > 0}
        <!-- Le chiuse ci sono ma non in mezzo alle altre: una barra che deve dire «cosa
             resta» non può avere metà righe già spuntate in cima. -->
        <button class="more" onclick={() => { mostraChiuse = !mostraChiuse }}>
          {mostraChiuse ? 'Hide' : 'Show'} {chiuse.length} closed
        </button>
        {#if mostraChiuse}
          {#each chiuse as l (l.id)}
            <div class="lst closed">
              <div class="lh"><span class="lt">{l.title}</span>
                <span class="cnt">{l.status}</span></div>
            </div>
          {/each}
        {/if}
      {/if}

      {#if dati.scartate > 0}
        <div class="warn"><Icon name="i-warn" />
          <span>{dati.scartate} entr{dati.scartate === 1 ? 'y' : 'ies'} skipped —
            {dati.motivo}</span></div>
      {/if}
    {/if}

    {#if dati?.motivo && dati.lists.length === 0 && !dati.assente}
      <div class="warn"><Icon name="i-warn" /><span>{dati.motivo}</span></div>
    {/if}
  </div>
</aside>

<style>
  .todocol {
    width: 258px; flex: none; display: flex; flex-direction: column;
    border-left: 1px solid var(--line); background: var(--surface-2); overflow: hidden;
  }
  .th {
    display: flex; align-items: center; gap: 7px; padding: 0 10px; height: 42px;
    flex: none; border-bottom: 1px solid var(--line);
  }
  .tt { font-weight: 600; font-size: 11px; }
  /* Quale progetto, perché la colonna resta mentre si cambia chat: senza questo, con due
     chat su cartelle diverse non si saprebbe di chi è la lista che si sta leggendo. */
  .pj { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { margin-left: auto; flex: none; background: none; border: 0; padding: 0; cursor: pointer;
       display: flex; color: var(--muted); }
  .body { flex: 1; overflow-y: auto; padding: 8px; }
  .empty { color: var(--muted); font-size: 10.5px; padding: 14px 4px; line-height: 1.5; }
  .lst { border: 1px solid var(--line-2); border-radius: 9px; background: var(--surface);
         padding: 7px 8px; margin-bottom: 7px; }
  .lst.closed { opacity: .6; }
  .lh { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; }
  .lt { font-size: 10.5px; font-weight: 600; flex: 1; min-width: 0; }
  .cnt { font-size: 9.5px; color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
  .pau { font-size: 9px; color: var(--muted); margin: -3px 0 5px; }
  .tk { display: flex; gap: 6px; align-items: flex-start; font-size: 10.5px; padding: 2px 0;
        color: var(--ink-2); }
  /* I nomi delle classi sono prefissati apposta. `app.css` ha già una `.doing .txt`
     globale — la riga «cosa sta facendo adesso» dell'elenco — che è monospace, su una
     riga sola e troncata coi puntini: chiamando `doing` e `txt` questi elementi se la
     prendevano tutta, e il task in corso compariva in monospace e tagliato mentre gli
     altri andavano a capo. È la stessa collisione già costata un giro con `.row` dei
     pannelli affiancati. Gli stili di Svelte sono scoped; i nomi delle classi no. */
  .tk.s-done { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1px; }
  .tk.s-doing { color: var(--ink); font-weight: 600; }
  .tk.s-blocked { color: var(--warn, var(--ink-2)); }
  .tx { line-height: 1.35; }
  .nt { font-size: 9.5px; color: var(--muted); margin-top: 1px; text-decoration: none; }
  .more { width: 100%; font: inherit; font-size: 10px; color: var(--muted); background: none;
          border: 0; padding: 5px; cursor: pointer; }
  .more:hover { color: var(--ink); }
  .warn { display: flex; gap: 6px; align-items: flex-start; font-size: 9.5px;
          color: var(--muted); padding: 6px 4px; }
</style>
