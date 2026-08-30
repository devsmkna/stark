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
  import type { Todos, TodoTask, TodoList } from '../lib/api.ts'
  import { project } from '../lib/view.ts'

  const { store }: { store: Store } = $props()

  let dati = $state<Todos | null>(null)
  let tutti = $state<Todos[] | null>(null)
  let errore = $state('')

  // Due flussi, e ne vive **uno solo** alla volta: quello che l'ambito non sta mostrando
  // sarebbe una seconda sottoscrizione SSE che consuma una connessione e un watcher per
  // cartella per disegnare niente. `$effect` legge `store.todoScope`, quindi cambiare
  // ambito stacca l'uno e attacca l'altro da sé.
  $effect(() => {
    const tutto = store.todoScope === 'all'
    const id = store.selected
    dati = null
    tutti = null
    errore = ''
    const perso = (s: string): void => { if (s === 'lost') errore = 'connection lost' }
    if (tutto) return store.api.todosStream(t => { tutti = t.projects; errore = '' }, perso)
    if (!id) return
    return store.api.todoStream(id, t => { dati = t; errore = '' }, perso)
  })

  const SEGNO: Record<TodoTask['state'], string> = {
    done: 'i-check', doing: 'i-dot', blocked: 'i-warn', todo: 'i-circle',
  }
  const viva = (l: TodoList): boolean => l.status === 'active' || l.status === 'paused'
  const vive = $derived((dati?.lists ?? []).filter(viva))
  const chiuse = $derived((dati?.lists ?? []).filter(l => !viva(l)))
  let mostraChiuse = $state(false)
  // Le chiuse di «All» hanno il proprio interruttore per progetto: uno solo per tutta la
  // colonna aprirebbe in blocco le liste finite di dieci cartelle, che è rumore, non
  // informazione. La chiave è il `cwd`, che è ciò che distingue i gruppi.
  let apertePerProgetto = $state<Record<string, boolean>>({})
  const fatti = (l: { tasks: TodoTask[] }): number => l.tasks.filter(t => t.state === 'done').length
  const restano = (p: Todos): number =>
    p.lists.filter(viva).reduce((n, l) => n + l.tasks.filter(t => t.state !== 'done').length, 0)
</script>

{#snippet lista(l: TodoList, chiusa: boolean)}
  <div class="lst" class:closed={chiusa}>
    <div class="lh">
      <span class="lt">{l.title}</span>
      <span class="cnt">{fatti(l)}/{l.tasks.length}{chiusa ? ` · ${l.status}` : ''}</span>
    </div>
    {#if l.status === 'paused'}<div class="pau">paused</div>{/if}
    {@render righe(l.tasks)}
  </div>
{/snippet}

{#snippet righe(tasks: TodoTask[])}
  {#each tasks as t (t.id)}
    <div class="tk s-{t.state}">
      <Icon name={SEGNO[t.state]} />
      <div>
        <div class="tx">{t.text}</div>
        {#if t.note}<div class="nt">{t.note}</div>{/if}
      </div>
    </div>
  {/each}
{/snippet}

<aside class="todocol">
  <div class="th">
    <span class="tt">Todo</span>
    {#if store.todoScope === 'project' && dati?.cwd}<span class="pj">{project(dati.cwd)}</span>{/if}
    <button class="x" aria-label="Close todo" onclick={() => store.toggleTodo()}>
      <Icon name="i-x" />
    </button>
  </div>

  <!-- Le liste sono del progetto, quindi «di quale progetto» è una domanda che si pone
       ogni volta: sta in cima e non nelle impostazioni, dove sarebbe una scelta presa una
       volta per sempre invece che il modo in cui si guarda la colonna adesso. -->
  <div class="seg" role="group" aria-label="Todo scope">
    <button class:on={store.todoScope === 'project'} onclick={() => store.setTodoScope('project')}
      >This project</button>
    <button class:on={store.todoScope === 'all'} onclick={() => store.setTodoScope('all')}
      >All</button>
  </div>

  <div class="body">
    {#if store.todoScope === 'all'}
      {#if errore}
        <div class="empty">{errore}</div>
      {:else if tutti === null}
        <div class="empty">Reading…</div>
      {:else if tutti.length === 0}
        <div class="empty">No lists in any known project.<br />STARK looks in the folders of
          the chats it knows.</div>
      {:else}
        {#each tutti as p (p.cwd)}
          {@const aperte = apertePerProgetto[p.cwd] === true}
          {@const ch = p.lists.filter(l => !viva(l))}
          <div class="grp">
            <!-- Il nome della cartella, col percorso nel `title`: due progetti possono
                 chiamarsi uguale, e in «All» stanno uno sotto l'altro. -->
            <div class="gh" title={p.cwd}>
              <span class="gn">{project(p.cwd)}</span>
              {#if restano(p) > 0}<span class="gc">{restano(p)} left</span>{/if}
            </div>
            {#if p.motivo}<div class="warn"><Icon name="i-warn" /><span>{p.motivo}</span></div>{/if}
            {#each p.lists.filter(viva) as l (l.id)}{@render lista(l, false)}{/each}
            {#if ch.length > 0}
              <button class="more"
                onclick={() => { apertePerProgetto = { ...apertePerProgetto, [p.cwd]: !aperte } }}>
                {aperte ? 'Hide' : 'Show'} {ch.length} closed
              </button>
              {#if aperte}
                {#each ch as l (l.id)}{@render lista(l, true)}{/each}
              {/if}
            {/if}
          </div>
        {/each}
      {/if}
    {:else if !store.selected}
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
      {#each vive as l (l.id)}{@render lista(l, false)}{/each}

      {#if chiuse.length > 0}
        <!-- Le chiuse ci sono ma non in mezzo alle altre: una barra che deve dire «cosa
             resta» non può avere metà righe già spuntate in cima. -->
        <button class="more" onclick={() => { mostraChiuse = !mostraChiuse }}>
          {mostraChiuse ? 'Hide' : 'Show'} {chiuse.length} closed
        </button>
        {#if mostraChiuse}
          {#each chiuse as l (l.id)}{@render lista(l, true)}{/each}
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
  /* `background:none` e `color:inherit` sono espliciti perché `app.css` colora già la
     voce scelta di un `.seg`: senza, lo scoped di questo file la coprirebbe e la
     posizione attiva resterebbe invisibile — è lo stesso difetto già costato un giro in
     `Settings.svelte`. Qui il colore lo mettiamo noi, quindi non c'è gara. */
  .seg { display: flex; gap: 2px; margin: 8px 8px 0; padding: 2px; flex: none;
         border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); }
  .seg button { flex: 1; font: inherit; font-size: 10px; padding: 3px 0; cursor: pointer;
                border: 0; border-radius: 6px; background: none; color: var(--muted); }
  .seg button.on { background: var(--surface-2); color: var(--ink); font-weight: 600; }
  .body { flex: 1; overflow-y: auto; padding: 8px; }
  /* Il progetto è un'intestazione, non una scheda: in «All» le schede sono le liste, e
     dargliene una attorno farebbe due bordi concentrici per ogni riga. */
  .grp { margin-bottom: 10px; }
  .gh { display: flex; align-items: baseline; gap: 6px; padding: 2px 2px 5px; }
  .gn { font-size: 10px; font-weight: 600; color: var(--muted); text-transform: uppercase;
        letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gc { font-size: 9.5px; color: var(--muted); margin-left: auto; flex: none;
        font-variant-numeric: tabular-nums; }
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
