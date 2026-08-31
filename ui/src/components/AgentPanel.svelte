<script lang="ts">
  import Icon from './Icon.svelte'
  import ModelPicker from './ModelPicker.svelte'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import type { AgentModels } from '../lib/api.ts'
  import type { PartView, TurnView } from '$core/reduce.ts'
  import { promptText, type TodoItem } from '$core/events.ts'

  let { store }: { store: Store } = $props()

  // ── tab ──────────────────────────────────────────────────────────
  // Allineato allo screenshot: PANNELLO AGENTE con 2 pill TODOs / Chat.
  // Se l'utente ha aperto helper → Chat, altrimenti TODOs. Poi resta dove lo mette.
  let tab = $state<'todos' | 'chat'>(store.helperOn ? 'chat' : 'todos')
  $effect(() => {
    // se apre da fuori (store.toggleTodo / toggleHelper) segui
    if (store.helperOn && !store.todoOpen) tab = 'chat'
    else if (store.todoOpen && !store.helperOn) tab = 'todos'
  })
  function selectTab(t: 'todos' | 'chat'): void {
    tab = t
    // Una tab **apre** la sua vista, non la fa da toggle: cliccare «Chat» quando è
    // già la tab attiva non deve chiudere il pannello. `apriHelper` è idempotente
    // (riusa l'helper vivo), quindi non serve un flag di stato qui.
    if (t === 'chat') {
      if (store.todoOpen) store.todoOpen = false
      if (!store.helperOn) store.helperOn = true
      if (!store.helper) void store.apriHelper()
    }
    if (t === 'todos') {
      if (!store.todoOpen) store.todoOpen = true
      if (store.helperOn) store.helperOn = false
    }
  }
  function close(): void {
    if (store.todoOpen) store.toggleTodo()
    if (store.helperOn) store.helperOn = false
  }

  // ── todos: la checklist della sessione (snap.todos) ──────────────
  //
  // Prima la colonna leggeva `.stark/todo.json` (i todo di progetto), ma i todo
  // che l'agent produce mentre lavora — almeno su OpenCode — arrivano come eventi
  // canonici `todo.updated` e finiscono in `snap.todos`, non in quel file. Claude
  // Code non ha la capability `todos` (sdk-options.ts), quindi là la lista resta
  // vuota: è un fatto dell'agent, non un guasto, e lo diciamo invece di mostrare
  // un elenco vuoto senza spiegazione.
  const todos = $derived<TodoItem[]>(store.snap?.todos ?? [])
  const inCorso = $derived(
    todos.filter(t => t.status === 'pending' || t.status === 'in_progress'),
  )
  const completati = $derived(
    todos.filter(t => t.status === 'completed' || t.status === 'cancelled'),
  )

  // ── helper ───────────────────────────────────────────────────────
  const snap = $derived(store.helper?.snap ?? null)
  const turns = $derived(snap?.turns ?? [])
  const lavora = $derived(snap?.state === 'busy' || snap?.state === 'starting')
  let testo = $state('')
  let scroller = $state<HTMLElement | null>(null)
  let box = $state<HTMLTextAreaElement | null>(null)
  let aperti = $state<Record<string, boolean>>({})
  let menu = $state(false)
  const quanto = $derived(turns.reduce((n: number, t: TurnView) => n + t.parts.reduce((m: number, p: PartView) => m + testoDi(p).length, 0), 0))
  let attaccato = $state(true)
  function onScroll(): void {
    const el = scroller; if (!el) return
    attaccato = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  $effect(() => { void quanto; void turns.length; if (!attaccato) return; const el = scroller; if (el) requestAnimationFrame(() => { if (attaccato) el.scrollTop = el.scrollHeight }) })
  function grow(): void { const el = box; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px` }
  async function regrow(): Promise<void> { await Promise.resolve(); grow() }
  async function manda(): Promise<void> {
    const t = testo.trim(); if (!t || lavora || store.helperBusy) return
    testo = ''; void regrow(); attaccato = true; await store.helperPrompt(t)
  }
  function tasto(e: KeyboardEvent): void { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void manda() } }
  function testoDi(p: PartView): string { return 'text' in p ? String((p as { text?: string }).text ?? '') : '' }

  // ─── il selettore del modello ─────────────────────────────────────────────
  async function apriMenu(): Promise<void> {
    menu = !menu
    if (menu) await store.caricaCatalogo()
  }
  /** Cosa è in uso adesso; quale voce corrisponda lo decide `ModelPicker`. */
  const modelloOra = $derived(store.helperPick?.model ?? snap?.model ?? '')
  /** L'icona del provider, come la mette la status bar della conversazione grande. */
  const iconaModello = $derived(getLobeIconUrl(modelloOra))
  /** Il nome completo del modello: un id lungo si tronca da solo nel chip stretto. */
  const nomeModello = $derived(modelloOra.split('/').pop() ?? '—')

  let hovered = $state(false)
  const fmtTokHover = (n: number | undefined): string => {
    if (!n) return '—'
    if (n >= 1_000_000) { const m = n / 1_000_000; return `${Number.isInteger(m) ? m : m.toFixed(1)}M` }
    if (n >= 1000) return `${Math.round(n / 1000)}k`
    return String(n)
  }
  const fmtCostoHover = (n: number): string =>
    `${n < 0.01 ? n.toFixed(4).replace(/0+$/, '') : Number.isInteger(n) ? String(n) : n.toFixed(2)}`
  const hoverInfo = $derived.by(() => {
    if (!hovered || menu) return null
    const catalogo = store.catalogo
    if (!catalogo || !modelloOra) return null
    const corrente = modelloOra
    const nel = (a: AgentModels) => a.models.find(m => m.id === corrente || (m as any).resolved === corrente)
    const agente = catalogo.find(a => a.id === (store.helperPick?.agent ?? snap?.agent))
    const ordine = agente ? [agente, ...catalogo.filter(a => a !== agente)] : catalogo
    for (const a of ordine) {
      const m = nel(a)
      if (m) {
        const accepts = (m as any).accepts as string[] | undefined
        const tipi = accepts ?? ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
        const has = (pref: string) => tipi.some(t => t.startsWith(pref))
        const inputTypes = accepts !== undefined && accepts.length === 0
          ? { text: true, image: false, video: false, audio: false, docs: false }
          : { text: true, image: has('image/'), video: has('video/'), audio: has('audio/'), docs: tipi.includes('application/pdf') }
        const costFree = !!(m as any).cost && (m as any).cost.input === 0 && (m as any).cost.output === 0
        return { agent: a, model: m, inputTypes, costFree }
      }
    }
    return null
  })
  async function scegli(agent: string, model: string): Promise<void> {
    menu = false
    await store.scegliHelper(agent, model)
  }
  /** Cambiare agent fa ripartire la conversazione: si dice prima, sulla voce. */
  function riparte(agent: string): boolean {
    const ora = store.helperPick?.agent ?? snap?.agent
    return !!ora && !!snap && turns.length > 0 && agent !== ora
  }
  /** Chiude su `pointerdown` e non su `click` perche' il clic su una voce di primo
   *  livello cambia il contenuto del popup **durante** la stessa distribuzione
   *  dell'evento: il nodo premuto si stacca da `.ap-pop`, e il `click`, quando
   *  arriva al document, lo vedrebbe fuori e chiuderebbe il menu che l'utente sta
   *  usando. Al `pointerdown` l'albero è ancora intatto — ed è il gesto con cui
   *  chiude la status bar (misurato: tools/prova-pannello-agente.mjs). */
  function chiudiMenu(e: PointerEvent): void {
    if (!(e.target as HTMLElement).closest('.ap-pop, .ap-tune')) menu = false
  }
  function esc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && menu) { e.stopPropagation(); menu = false }
  }
</script>

<svelte:document onpointerdown={chiudiMenu} onkeydown={esc} />

<aside class="agentpan" style="width:{(store.helperW || 300)}px" aria-label="Agent panel">
  <button class="hgrip" aria-label="Resize"
    onpointerdown={(e) => {
      const start = e.clientX, w0 = store.helperW
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const muovi = (m: PointerEvent): void => store.setHelperW(w0 + (start - m.clientX))
      const su = (): void => { el.removeEventListener('pointermove', muovi); el.removeEventListener('pointerup', su) }
      el.addEventListener('pointermove', muovi); el.addEventListener('pointerup', su)
    }}></button>

  <div class="ap-head">
    <span class="ap-title">AGENT PANEL</span>
    <button class="ap-x" aria-label="Close" onclick={close}><Icon name="i-x" /></button>
  </div>

  <!-- pill tabs TODOs / Chat -->
  <div class="ap-tabs" role="tablist">
    <button role="tab" class="ap-tab" class:on={tab === 'todos'} aria-selected={tab === 'todos'}
      onclick={() => selectTab('todos')}>TODOs</button>
    <button role="tab" class="ap-tab" class:on={tab === 'chat'} aria-selected={tab === 'chat'}
      onclick={() => selectTab('chat')}>Chat</button>
  </div>

  {#if tab === 'todos'}
    <div class="ap-body scroller">
      {#if !store.snap}
        <div class="ap-empty">Open a chat to see the TODOs.</div>
      {:else if todos.length === 0}
        <div class="ap-empty">
          {#if store.snap.capabilities?.todos === false}
            This agent does not keep a checklist while it works.
          {:else}
            No tasks. The agent will keep track of work here when it has something to do.
          {/if}
        </div>
      {:else}
        {#if inCorso.length > 0}
          <div class="ap-sec-head">IN PROGRESS</div>
          {#each inCorso as t (t.content)}
            <div class="ap-row">
              <span class="ap-box"
                >{#if t.status === 'in_progress'}<Icon name="i-dot" style="color:var(--accent)" />{:else}<Icon name="i-circle" />{/if}</span>
              <div class="ap-row-main">
                <div class="ap-row-title">{t.content}</div>
                {#if t.priority}<div class="ap-row-sub">{t.priority}</div>{/if}
              </div>
            </div>
          {/each}
          <hr class="ap-sep" />
        {/if}
        <div class="ap-sec-head">COMPLETED</div>
        {#if completati.length === 0}
          <div class="ap-empty">None completed.</div>
        {:else}
          {#each completati as t (t.content)}
            <div class="ap-row done">
              <span class="ap-box on"><Icon name="i-check" /></span>
              <div class="ap-row-main">
                <div class="ap-row-title strike">{t.content}</div>
              </div>
            </div>
          {/each}
        {/if}
      {/if}
    </div>
  {:else}
    <div class="ap-body scroller hconv" bind:this={scroller} onscroll={onScroll}>
      <!-- info sola lettura — con margin (richiesta) -->
      <div class="ap-notice">
        <Icon name="i-shield" />
        <span>Read-only — it can consult the project but not modify it. Temporary chat; it does not enter the main history.</span>
      </div>

      {#if store.helperRefused}<div class="hwarn">{store.helperRefused}</div>{/if}
      {#if !snap && store.helperBusy}<div class="ap-empty">Starting…</div>{/if}
      {#each turns as t (t.turnId)}
        {@const chiesto = promptText(t.prompt)}
        {#if chiesto}<div class="hq">{chiesto}</div>{/if}
        {#each t.parts as p, i (p.kind + i)}
          {#if p.kind === 'text'}<div class="ha">{@html renderMarkdown(testoDi(p))}</div>
          {:else if p.kind === 'tool'}<div class="htool" class:ko={p.done && p.ok===false}><Icon name={p.ok===false?'i-warn':'i-doc'} /><span>{p.intent ?? p.summary ?? p.name}</span></div>
          {:else if p.kind === 'reasoning'}<button class="hthink" onclick={() => aperti[p.partId]=!aperti[p.partId]}><Icon name="i-brain" /><span>{aperti[p.partId]?'hide thinking':'thought'}</span></button>{#if aperti[p.partId]}<div class="hthought">{testoDi(p)}</div>{/if}
          {/if}
        {/each}
        {#if t.ended && t.reason && t.reason!=='completed'}<div class="hwarn">{t.reason}</div>{/if}
      {/each}
      {#if lavora}<div class="hbusy"><i class="spin"></i><span>thinking…</span><button class="hstop" onclick={() => void store.helperStop()}><Icon name="i-stop" /></button></div>{/if}
    </div>

    <div class="ap-dock">
      {#if menu}
        <div class="ap-pop">
          <ModelPicker catalogo={store.catalogo} corrente={modelloOra}
            agenteCorrente={store.helperPick?.agent ?? snap?.agent}
            nota={a => (riparte(a) ? 'restarts' : null)}
            onScegli={(agent, model) => void scegli(agent, model)} />
        </div>
      {/if}
      <div class="ap-input-row">
        <textarea class="ap-input" bind:this={box} bind:value={testo} placeholder="Ask a quick question..." rows="1" oninput={grow} onkeydown={tasto} disabled={store.helperBusy}></textarea>
        <button class="ap-send" aria-label="Send" onclick={() => void manda()} disabled={!testo.trim() || lavora || store.helperBusy}><Icon name="i-send" /></button>
      </div>
      <div class="ap-status">
        <!-- Lo stesso chip della status bar della conversazione grande: icona del
             modello, nome, chevron. Solo i colori sono quelli del pannello. -->
        <span class="ap-tune-pop" onmouseenter={() => { hovered = true; if (!store.catalogo) void store.caricaCatalogo() }} onmouseleave={() => hovered = false}>
          <button class="ap-tune" onclick={() => void apriMenu()} aria-label="Model: {modelloOra}">
            {#if iconaModello}
              <img src={iconaModello} alt="" width="14" height="14" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy"
                onerror={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display='none' }} />
            {:else}
              <span class="mdot"></span>
            {/if}
            <span class="mname">{nomeModello}</span>
            <Icon name="i-down" />
          </button>
          {#if hovered && !menu && hoverInfo}
            {@const ic0 = getLobeIconUrl((hoverInfo.model as any).resolved ?? hoverInfo.model.id)}
            <div class="hover-card" role="tooltip">
              <div class="card">
                <div class="avatar">
                  {#if ic0}<img class="micon" src={ic0} alt="" width="15" height="15" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />{:else}<Icon name="i-brain" />{/if}
                </div>
                <div class="info">
                  <div class="title-row">
                    <div class="title">{hoverInfo.model.label ?? hoverInfo.model.id}</div>
                    <span class="input-types" title={`accepts: ${[hoverInfo.inputTypes.text ? 'text' : null, hoverInfo.inputTypes.image ? 'image' : null, hoverInfo.inputTypes.video ? 'video' : null, hoverInfo.inputTypes.audio ? 'audio' : null, hoverInfo.inputTypes.docs ? 'documents' : null].filter(Boolean).join(', ')}`}>
                      {#if hoverInfo.inputTypes.text}<Icon name="i-type" class="on" />{/if}
                      {#if hoverInfo.inputTypes.image}<Icon name="i-image" class="on" />{/if}
                      {#if hoverInfo.inputTypes.video}<Icon name="i-video" class="on" />{/if}
                      {#if hoverInfo.inputTypes.audio}<Icon name="i-audio" class="on" />{/if}
                      {#if hoverInfo.inputTypes.docs}<Icon name="i-doc" class="on" />{/if}
                    </span>
                  </div>
                  <div class="provider">{hoverInfo.agent.label}</div>
                  <div class="stats">
                    <span class="stat" class:free={hoverInfo.costFree}><span class="dollar">$</span>
                      {#if hoverInfo.costFree}<b>free</b>
                      {:else if (hoverInfo.model as any).cost}<span class="per-m">/M</span><b>{fmtCostoHover((hoverInfo.model as any).cost.input)} / {fmtCostoHover((hoverInfo.model as any).cost.output)}</b>
                      {:else}<b>—</b>{/if}
                    </span>
                    <span class="stat"><span class="k">context</span><b>{fmtTokHover((hoverInfo.model as any).contextWindow)}</b></span>
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </span>
      </div>
    </div>
  {/if}
</aside>

<style>
  .agentpan{
    flex:none; display:flex; flex-direction:column; background:var(--panel-bg); border-left:1px solid var(--panel-line);
    position:relative; overflow:hidden; border-radius: 14px 0 0 14px; /* staccata come nello screenshot */
    /* Il pannello ha le sue tinte: i `--panel-*` di app.css, che in scuro valgono il
       design scuro fisso e in chiaro la tavolozza di base. Riscrivere i nomi del
       vocabolario su questa radice fa sì che le classi qui sotto (e la tendina dei
       modelli, che sta dentro) le prendano senza dover sapere da dove vengono. */
    --side:var(--panel-bg); --surface:var(--panel-surface); --surface-2:var(--panel-surface-2); --surface-3:var(--panel-surface-3);
    --ink:var(--panel-ink); --ink-2:var(--panel-ink-2); --muted:var(--panel-muted);
    --line:var(--panel-line); --line-2:var(--panel-line-2);
    --accent:var(--panel-accent); --accent-soft:var(--panel-accent-soft);
  }
  .hgrip{position:absolute; left:-3px; top:0; bottom:0; width:7px; cursor:col-resize; background:none; border:0; padding:0; z-index:2}
  .hgrip:hover{background:color-mix(in srgb,var(--panel-accent) 12%,transparent)}
  .ap-head{display:flex; align-items:center; justify-content:space-between; padding:12px 12px 8px; flex:none}
  .ap-title{font-size:10px; letter-spacing:.12em; font-weight:700; color:var(--muted)}
  .ap-x{width:22px; height:22px; display:grid; place-items:center; background:none; border:0; color:var(--muted); cursor:pointer; border-radius:6px}
  .ap-x:hover{color:var(--ink); background:var(--surface-2)}
  .ap-x :global(svg.ic){width:13px; height:13px}

  /* pill tabs — stesso stile di Sidebar .pick (Group by), dimensioni invariate */
  .ap-tabs{
    margin: 0 12px 10px; padding:2px; display:flex; gap:2px; flex:none;
    background:var(--surface-3); border:0; border-radius:999px;
  }
  .ap-tab{
    flex:1; padding:6px 0; border:0; border-radius:999px; background:none; color:var(--muted);
    font:inherit; font-size:11.5px; font-weight:600; cursor:pointer;
  }
  .ap-tab:hover:not(.on){ color:var(--ink); }
  .ap-tab.on{background:var(--surface); color:var(--ink); box-shadow:0 1px 1.5px rgba(0, 0, 0, .10)}
  .ap-tab:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
  .ap-body{flex:1; overflow:auto; padding:8px 12px 12px; display:flex; flex-direction:column; gap:8px}
  .ap-sec-head{font-size:10px; letter-spacing:.10em; font-weight:600; color:var(--muted); margin:6px 0 4px}
  .ap-sep{border:0; border-top:1px solid var(--line); margin:10px 0}
  .ap-empty{color:var(--muted); font-size:11px; padding:12px 4px; line-height:1.5}
  .ap-row{display:flex; gap:8px; align-items:flex-start; padding:4px 0}
  .ap-box{width:16px; height:16px; border-radius:4px; border:1px solid var(--line-2); display:grid; place-items:center; flex:none; color:var(--muted); background:var(--surface)}
  .ap-box.on{background:var(--panel-done-bg); border-color:var(--panel-done); color:var(--panel-done)}
  .ap-box :global(svg.ic){width:10px; height:10px}
  .ap-box.on :global(svg.ic){width:10px; height:10px}
  .ap-row-main{flex:1; min-width:0}
  .ap-row-title{font-size:11.5px; color:var(--ink); line-height:1.35}
  .ap-row-title.strike{color:var(--muted); text-decoration:line-through}
  .ap-row-sub{font-size:9.5px; color:var(--muted); margin-top:1px}
  .ap-row.done .ap-row-title{color:var(--muted)}

  .ap-notice{
    display:flex; gap:8px; align-items:flex-start; padding:10px 11px; border-radius:10px;
    background:var(--surface); border:1px solid var(--panel-field); color:var(--ink-2); font-size:11px; line-height:1.4;
    margin: 10px 12px 14px;
  }
  .ap-notice :global(svg.ic){width:14px; height:14px; flex:none; color:var(--accent); margin-top:1px}
  /* Il fondo del pannello ricalca il dock dello spazio centrale (`Dock.svelte` +
     `.status` in app.css), misura per misura: le due colonne stanno affiancate a
     tutta altezza, e righe di altezza diversa si leggerebbero come due design.
     Padding sulle righe, non sul contenitore — come là. */
  .ap-dock{border-top:1px solid var(--line); padding:0; flex:none; position:relative; background:var(--panel-bg)}
  .ap-input-row{display:flex; gap:8px; align-items:center; padding:12px 16px}
  .ap-input{
    flex:1; resize:none; padding:9px 14px; border-radius:20px;
    background:var(--surface); border:1px solid var(--panel-field); color:var(--ink); font:inherit;
    font-size:12.5px; line-height:1.45; outline:none; max-height:160px;
  }
  .ap-input::placeholder{color:var(--muted)}
  .ap-input:focus{border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--panel-accent) 18%,transparent)}
  .ap-send{
    width:30px; height:30px; border-radius:50%; flex:none; border:0; background:var(--accent); color:var(--on-accent); display:grid; place-items:center; cursor:pointer;
  }
  .ap-send:disabled{opacity:.45; cursor:default}
  .ap-send :global(svg.ic){width:15px; height:15px}

  /* La status bar sotto la casella: stesso passo di `.status` (padding e altezza
     del chip compresi) e il chip del modello appoggiato a destra, come la parte
     destra della barra della conversazione grande (`.status .r .tune`). */
  .ap-status{display:flex; align-items:center; justify-content:flex-end; gap:9px; padding:5px 12px 7px}
  .ap-tune{
    display:inline-flex; align-items:center; gap:4px; border:0; background:none; padding:0;
    min-height:calc(1.45em + 4px); color:var(--ink); font:inherit; font-size:10px; cursor:pointer;
    max-width:100%;
  }
  .ap-tune .mname{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}
  .ap-tune :global(svg.ic){width:10px; height:10px; color:var(--muted); flex:none}
  .ap-tune .mdot{width:8px; height:8px; border-radius:50%; background:var(--muted); flex:none}
  .ap-tune:focus-visible{outline:2px solid var(--accent); outline-offset:1px}
  .ap-tune-pop{position:relative;display:inline-flex}
  .hover-card{
    position:absolute; bottom:calc(100% + 7px); right:0; width:280px;
    background:var(--panel-pop); border:1px solid var(--panel-field); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,.45); padding:4px; z-index:7;
    pointer-events:none;
  }
  .hover-card .card{display:flex;align-items:flex-start;gap:10px;padding:12px}
  .hover-card .avatar{width:30px;height:30px;border-radius:8px;border:1px solid var(--line-2);display:flex;align-items:center;justify-content:center;flex:none}
  .hover-card .avatar svg.ic{width:15px;height:15px}
  .hover-card .micon{filter:var(--icon-f)}
  .hover-card .info{flex:1;min-width:0}
  .hover-card .title{font-size:10px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hover-card .title-row{display:flex;align-items:center;gap:8px}
  .hover-card .title-row .title{flex:1;min-width:0}
  .hover-card .title-row .input-types{margin-left:auto;flex:none;display:inline-flex;gap:3px}
  .hover-card .provider{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hover-card .provider .sep{color:var(--line-2);margin:0 5px}
  .hover-card .stats{display:flex;gap:12px;margin-top:9px;flex-wrap:wrap}
  .hover-card .stat{display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--muted)}
  .hover-card .stat .k{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);opacity:.75;flex-shrink:0}
  .hover-card .stat .dollar{font-family:var(--mono);font-weight:700;color:var(--muted);width:8px;text-align:center;flex-shrink:0}
  .hover-card .stat .per-m{font-size:9px;color:var(--muted)}
  .hover-card .stat b{color:var(--ink);font-weight:600;margin-left:1px}
  .hover-card .stat.free b{color:var(--accent)}
  .hover-card .input-types svg.ic{width:11px;height:11px}
  .hover-card .input-types svg.ic.on{color:var(--ink)}

  /* La tendina dei modelli: sta **dentro** il pannello, larga quanto lui — un pannello
     trascinabile e il mobile hanno larghezze diverse, e una larghezza fissa più grande
     del pannello sporgeva a sinistra sopra la conversazione (segnalato il 30 agosto).
     Gli id lunghi si troncano con l'ellissi che `.mpick .lb` già fa. Le voci sono le
     stesse del menu della status bar (`.mi` ecc.), solo coi colori del pannello: i
     `--panel-*`, che in scuro valgono il design scuro fisso e in chiaro la tavolozza
     di base. */
  .ap-pop{
    position:absolute; left:16px; right:16px; bottom:calc(100% + 4px); width:auto;
    background:var(--panel-pop); border:1px solid var(--panel-field); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,.45); padding:4px; z-index:6; max-height:62vh; overflow:auto;
  }
  /* Le voci della tendina: stesse righe del menu di ogni altro posto, ma coi colori
     del pannello (i `--panel-*` di app.css, vedi sopra). */
  .ap-pop :global(.mi){
    display:flex; align-items:center; gap:7px; padding:4px 8px; border-radius:6px;
    font-size:11px; color:var(--ink-2); width:100%; background:none; border:0; font-family:inherit; text-align:left; cursor:pointer;
  }
  .ap-pop :global(button.mi:hover){background:var(--surface-2)}
  .ap-pop :global(.mi.on){background:color-mix(in srgb,var(--panel-accent) 16%,transparent); color:var(--ink); font-weight:600}
  .ap-pop :global(.mi.dis){color:var(--muted)}
  .ap-pop :global(.mi .tag){margin-left:auto; font-size:9.5px; color:var(--muted); flex:none}
  .ap-pop :global(.mi .sub){display:block; color:var(--muted); font-size:9.5px}
  .ap-pop :global(.mpick .lb),.ap-pop :global(.mpick .sub){display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .ap-pop :global(.mpick .tx){flex:1; min-width:0}
  .ap-pop :global(.msearch){
    position:sticky; bottom:0; display:flex; align-items:center; gap:7px; padding:6px 8px; margin-top:2px;
    border-top:1px solid var(--line); background:var(--surface); color:var(--muted);
  }
  .ap-pop :global(.msearch input){flex:1; min-width:0; border:0; background:none; color:var(--ink); font-family:inherit; font-size:10.5px; outline:none; padding:0}
  .ap-pop :global(.msearch input::placeholder){color:var(--muted)}

  /* helper inner reuse */
  .hconv{padding:0; gap:8px}
  .hq{background:var(--surface-2); border:1px solid var(--line-2); color:var(--ink)}
  .ha{color:var(--ink-2)}
  .hthought{border-left-color:var(--panel-field); color:var(--muted)}
  .spin{width:9px; height:9px; border-radius:50%; border:2px solid var(--panel-accent); border-right-color:transparent; animation:sp .9s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}

  @media (max-width: 860px){
    .agentpan{width:100% !important; border-radius:0; border-left:none}
    .hgrip{display:none}
  }
</style>
