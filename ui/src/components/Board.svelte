<script lang="ts">
  // La board del **progetto** — una bacheca in stile Jira/Trello, file-based e
  // agents-first, costruita sopra kanban-md. È la superficie di coordinamento centrale:
  // se un progetto ha una board, gli agent ci parlano quasi sempre, e questa vista la
  // mostra mentre lavorano (SSE + file-watching, come la colonna dei todo).
  //
  // Del progetto e non della chat: il file sta accanto al codice, quindi due
  // conversazioni sulla stessa cartella vedono la stessa board.
  import Icon from './Icon.svelte'
  import type { Store } from '../lib/store.svelte.ts'
  import type { Board, BoardTask } from '../lib/api.ts'
  import { projectName } from '../lib/view.ts'

  const { store }: { store: Store } = $props()

  // Di quale progetto si sta guardando la board. Default: il progetto della chat a
  // fuoco; il selettore in cima lo cambia. `null` finché non c'è un progetto a fuoco.
  let cwd = $state<string | null>(null)
  let dati = $state<Board | null>(null)
  let errore = $state('')
  let aperta = $state<BoardTask | null>(null)
  let crea = $state(false)
  let titolo = $state('')
  let priorita = $state('')
  let corpo = $state('')
  let occupato = $state(false)

  // I progetti noti, con una sessione per ciascuno: è l'unico manico per cui il daemon
  // risolve la cartella (mai un percorso dal browser). Default = il progetto a fuoco.
  const progetti = $derived(
    [...new Map(store.rows.filter(r => r.cwd).map(r => [r.cwd!, r.id])).entries()]
      .map(([c, id]) => ({ cwd: c, id })),
  )

  // Quando la board si apre senza una scelta, parte dal progetto della chat a fuoco;
  // se nessuna chat è a fuoco, dal primo progetto noto — così non resta «Reading…»
  // per sempre su una board che c'è.
  $effect(() => {
    if (cwd !== null) return
    const foc = store.selected ? store.rows.find(r => r.id === store.selected)?.cwd : undefined
    if (foc) cwd = foc
    else if (progetti.length > 0) cwd = progetti[0].cwd
  })

  // La sessione che fa da manico per la cartella scelta. È un `$derived` e non un
  // calcolo dentro l'effetto qui sotto **apposta**: `store.rows` cambia a ogni token
  // di qualunque chat viva, e leggerlo dentro l'effetto lo faceva ri-eseguire di
  // continuo — stream staccato e riattaccato, `dati = null` a ripetizione, la board
  // che sfarfalla (segnalato dall'utente il 5 settembre 2026). Un `$derived` che torna
  // lo stesso id non risveglia chi lo legge: l'effetto riparte **solo** quando l'id
  // cambia davvero, cioè quando si cambia progetto.
  const sessione = $derived(cwd ? store.rows.find(r => r.cwd === cwd)?.id : undefined)

  // Il flusso della board del progetto scelto. Cambiare progetto stacca l'uno e
  // attacca l'altro da sé, come fa la colonna dei todo con `store.todoScope`.
  $effect(() => {
    const s = sessione
    if (!s) { dati = null; return }
    // Si azzera solo qui, all'apertura di un flusso nuovo (progetto cambiato): non è
    // più un azzeramento a ogni evento globale, quindi non è più sfarfallio ma il
    // «Reading…» giusto mentre arriva la prima board del progetto scelto.
    dati = null
    errore = ''
    const perso = (st: string): void => { if (st === 'lost') errore = 'connessione persa' }
    return store.api.boardStream(s, b => { dati = b; errore = '' }, perso)
  })

  // Un click su un chip in chat arriva qui: si apre quel task, sempre — anche se la
  // Board era già aperta su un altro (regola del link prevedibile, come /chat/<id>).
  $effect(() => {
    const cerca = store.boardTask
    if (cerca == null || !dati || dati.assente) return
    const t = dati.columns.flatMap(c => c.tasks).find(t => t.id === cerca)
    if (t) { aperta = t; crea = false }
    store.boardTask = null
  })

  async function inizializza(): Promise<void> {
    if (!sessione) return
    occupato = true
    const esito = await store.api.boardInit(sessione)
    occupato = false
    if (!esito.ok && esito.motivo) errore = esito.motivo
  }

  async function salvaCrea(): Promise<void> {
    if (!sessione || !titolo.trim()) return
    occupato = true
    const esito = await store.api.boardCreate(sessione, {
      title: titolo.trim(), priority: priorita || undefined, body: corpo.trim() || undefined,
    })
    occupato = false
    if (esito.ok) { crea = false; titolo = ''; priorita = ''; corpo = '' }
    else if (esito.motivo) errore = esito.motivo
  }

  async function cambiaStato(t: BoardTask, status: string): Promise<void> {
    if (!sessione || status === t.status) return
    const esito = await store.api.boardEdit(sessione, t.id, { status })
    if (!esito.ok && esito.motivo) errore = esito.motivo
  }

  const PRIO: Record<string, string> = { low: 'p-low', medium: 'p-med', high: 'p-high', critical: 'p-crit' }
  const badge = (t: BoardTask): string => PRIO[t.priority ?? ''] ?? ''
</script>

<div class="scrim" role="presentation" onclick={() => store.toggleBoard()}></div>
<div class="dlg wide board">
  <div class="bh">
    <div class="bt">
      <Icon name="i-brick" />
      <span>Board</span>
      {#if dati?.name}<span class="bn">{dati.name}</span>{/if}
    </div>

    <!-- Il selettore del progetto: la board è del progetto, quindi «di quale progetto»
         è una domanda che si pone ogni volta. Default = la chat a fuoco. -->
    <select class="bp" aria-label="Project" bind:value={cwd}>
      {#each progetti as p (p.cwd)}
        <option value={p.cwd}>{projectName(p.cwd, store.settings?.projects)}</option>
      {/each}
    </select>

    <div class="bx">
      {#if dati && !dati.assente && !dati.binarioMancante}
        <button class="add" title="New task" aria-label="New task" onclick={() => { crea = !crea; aperta = null }}>
          <Icon name="i-plus" />
        </button>
      {/if}
      <button class="x" aria-label="Close board" onclick={() => store.toggleBoard()}>
        <Icon name="i-x" />
      </button>
    </div>
  </div>

  <div class="bb">
    {#if errore}
      <div class="empty">{errore}</div>
    {:else if dati === null}
      <div class="empty">Reading…</div>
    {:else if dati.binarioMancante}
      <div class="empty">kanban-md is not installed. Install it (or run
        <code>stark install</code> to bundle it) and reopen the board.</div>
    {:else if dati.assente}
      <div class="empty">
        No board in this project yet.
        <button class="btn" disabled={occupato} onclick={() => void inizializza()}>
          Initialize a board
        </button>
      </div>
    {:else if dati.columns.length === 0}
      <div class="empty">The board is here, but it has no columns.</div>
    {:else}
      <div class="cols">
        {#each dati.columns as col (col.status)}
          <div class="col">
            <div class="ch">
              <span class="cn">{col.status}</span>
              <span class="cc">{col.tasks.length}</span>
            </div>
            <div class="cd">
              {#each col.tasks as t (t.id)}
                <button class="card" class:on={aperta?.id === t.id}
                  onclick={() => { aperta = aperta?.id === t.id ? null : t; crea = false }}>
                  <div class="ct">{t.title}</div>
                  <div class="cm">
                    {#if badge(t)}<span class="prio {badge(t)}">{t.priority}</span>{/if}
                    {#if t.claimed_by}<span class="clm">@{t.claimed_by}</span>{/if}
                    {#if t.assignee}<span class="asg">{t.assignee}</span>{/if}
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if crea && dati && !dati.assente && !dati.binarioMancante}
    <!-- Il form di creazione è una modale centrata, non un blocco in fondo al body
         scrollabile: dentro `.bb` finiva sotto le colonne (che hanno min-height:100%)
         e restava appeso in fondo alla pagina, fuori vista. -->
    <div class="cscrim" role="presentation" onclick={() => { crea = false }}></div>
    <div class="cform">
      <div class="cfh">
        <span class="cft">New task</span>
        <button class="x" aria-label="Close" onclick={() => { crea = false }}>
          <Icon name="i-x" />
        </button>
      </div>
      <input class="fi" placeholder="Task title" bind:value={titolo} />
      <select class="fp" bind:value={priorita} aria-label="Priority">
        <option value="">priority…</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="critical">critical</option>
      </select>
      <textarea class="fb" placeholder="Description (optional)" bind:value={corpo}></textarea>
      <div class="fa">
        <button class="btn" disabled={occupato || !titolo.trim()} onclick={() => void salvaCrea()}>
          Create
        </button>
        <button class="btn" onclick={() => { crea = false; titolo = ''; priorita = ''; corpo = '' }}>
          Cancel
        </button>
      </div>
    </div>
  {/if}

  {#if aperta}
    <div class="det">
      <div class="dh">
        <span class="dt">{aperta.title}</span>
        <button class="x" aria-label="Close details" onclick={() => { aperta = null }}>
          <Icon name="i-x" />
        </button>
      </div>
      <div class="db">
        <div class="drow">
          <span class="dl">Status</span>
          <select value={aperta.status}
            onchange={(e) => {
              const nuovo = (e.currentTarget as HTMLSelectElement).value
              // `originale` cattura la card com'era **prima** dell'aggiornamento
              // ottimistico: senza, `cambiaStato` vedrebbe status già uguale e
              // tornerebbe senza editare nulla.
              const originale = aperta
              aperta = { ...aperta, status: nuovo }
              void cambiaStato(originale, nuovo)
            }}>
            {#each dati?.columns ?? [] as col (col.status)}
              <option value={col.status}>{col.status}</option>
            {/each}
          </select>
        </div>
        {#if aperta.priority}
          <div class="drow"><span class="dl">Priority</span><span>{aperta.priority}</span></div>
        {/if}
        {#if aperta.assignee}
          <div class="drow"><span class="dl">Assignee</span><span>{aperta.assignee}</span></div>
        {/if}
        {#if aperta.claimed_by}
          <div class="drow"><span class="dl">Claimed by</span><span>@{aperta.claimed_by}</span></div>
        {/if}
        {#if aperta.tags && aperta.tags.length > 0}
          <div class="drow"><span class="dl">Tags</span><span>{aperta.tags.join(', ')}</span></div>
        {/if}
        {#if aperta.due}
          <div class="drow"><span class="dl">Due</span><span>{aperta.due}</span></div>
        {/if}
        {#if aperta.blocked}
          <div class="drow"><span class="dl">Blocked</span><span>{aperta.blocked}</span></div>
        {/if}
        {#if aperta.body}
          <div class="dbody">{aperta.body}</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* `.dlg.wide` in app.css è `flex-direction:row` (serve a Settings, che ha due colonne);
     la board è una colonna — header sopra, body sotto, dettaglio a lato. Si forza qui,
     perché ereditare `row` spaccava tutto: header, colonne e dettaglio finivano uno
     accanto all'altro invece che impilati. */
  .board { width: auto; height: auto; flex-direction: column; }
  .bh { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 46px;
        flex: none; border-bottom: 1px solid var(--line); }
  .bt { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 12px; color: var(--ink); }
  .bt :global(svg) { width: 15px; height: 15px; }
  .bn { font-size: 10px; color: var(--muted); font-weight: 500; }
  .bp { font: inherit; font-size: 11px; color: var(--ink); background: var(--surface);
        border: 1px solid var(--line-2); border-radius: 7px; padding: 3px 6px; max-width: 220px; }
  .bx { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .x { background: none; border: 0; padding: 4px; cursor: pointer; color: var(--muted); display: flex; }
  .x:hover { color: var(--ink); }
  .add { background: none; border: 1px solid var(--line-2); border-radius: 7px; padding: 4px;
         cursor: pointer; color: var(--muted); display: flex; }
  .add:hover { color: var(--ink); }
  .bb { flex: 1; overflow: auto; padding: 14px; }
  .empty { color: var(--muted); font-size: 12px; padding: 24px 6px; line-height: 1.6; display: flex;
          flex-direction: column; gap: 10px; align-items: flex-start; }
  .cols { display: flex; gap: 12px; align-items: flex-start; min-height: 100%; }
  .col { flex: 1 1 0; min-width: 200px; max-width: 320px; display: flex; flex-direction: column;
         background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 10px; }
  .ch { display: flex; align-items: baseline; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .cn { font-size: 11px; font-weight: 600; color: var(--ink); text-transform: capitalize; }
  .cc { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .cd { padding: 6px; display: flex; flex-direction: column; gap: 6px; }
  .card { text-align: left; font: inherit; background: var(--surface); border: 1px solid var(--line-2);
          border-radius: 8px; padding: 8px 9px; cursor: pointer; color: var(--ink-2); }
  .card:hover { border-color: var(--line); }
  .card.on { border-color: var(--accent, #4f7cff); }
  .ct { font-size: 11px; line-height: 1.35; color: var(--ink); }
  .cm { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .prio { font-size: 9px; padding: 1px 6px; border-radius: 99px; text-transform: capitalize; }
  .p-low { color: var(--muted); background: var(--surface-2); }
  .p-med { color: #b7791f; background: rgba(183,121,31,.14); }
  .p-high { color: #c2410c; background: rgba(194,65,12,.14); }
  .p-crit { color: #dc2626; background: rgba(220,38,38,.14); }
  .clm, .asg { font-size: 9.5px; color: var(--muted); }
  .cscrim { position: absolute; inset: 0; background: rgba(16,20,32,.44); z-index: 10; }
  .cform { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); z-index: 11;
           width: 380px; max-width: calc(100% - 40px); border: 1px solid var(--line-2);
           border-radius: 12px; padding: 0; background: var(--surface);
           box-shadow: 0 24px 60px rgba(16,20,32,.32); display: flex; flex-direction: column; gap: 8px; }
  .cfh { display: flex; align-items: center; gap: 8px; padding: 10px 13px; border-bottom: 1px solid var(--line); }
  .cft { font-weight: 600; font-size: 12.5px; color: var(--ink); flex: 1; }
  .cform .fi, .cform .fb, .cform .fp { margin: 0 13px; font: inherit; font-size: 11px; color: var(--ink);
        background: var(--surface); border: 1px solid var(--line-2); border-radius: 7px; padding: 6px 8px; }
  .fb { min-height: 60px; resize: vertical; }
  .fa { display: flex; gap: 8px; padding: 4px 13px 13px; }
  .btn { font: inherit; font-size: 11px; padding: 5px 12px; border-radius: 7px; cursor: pointer;
         background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-2); }
  .btn:disabled { opacity: .5; cursor: default; }
  .det { position: absolute; right: 0; top: 46px; bottom: 0; width: 320px; background: var(--surface);
         border-left: 1px solid var(--line); display: flex; flex-direction: column; }
  .dh { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .dt { font-size: 12px; font-weight: 600; color: var(--ink); flex: 1; }
  .db { flex: 1; overflow: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .drow { display: flex; align-items: baseline; gap: 8px; font-size: 11px; }
  .drow select { font: inherit; font-size: 11px; color: var(--ink); background: var(--surface);
                 border: 1px solid var(--line-2); border-radius: 6px; padding: 2px 5px; }
  .dl { color: var(--muted); width: 90px; flex: none; }
  .dbody { margin-top: 6px; font-size: 11px; line-height: 1.5; color: var(--ink-2);
           white-space: pre-wrap; }
</style>
