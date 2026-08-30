<script lang="ts">
  import Icon from './Icon.svelte'
  import ModelPicker from './ModelPicker.svelte'
  import { renderMarkdown } from '../lib/markdown.ts'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import type { Store } from '../lib/store.svelte.ts'
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
  function grow(): void { const el = box; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px` }
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
  async function scegli(agent: string, model: string): Promise<void> {
    menu = false
    await store.scegliHelper(agent, model)
  }
  /** Cambiare agent fa ripartire la conversazione: si dice prima, sulla voce. */
  function riparte(agent: string): boolean {
    const ora = store.helperPick?.agent ?? snap?.agent
    return !!ora && !!snap && turns.length > 0 && agent !== ora
  }
  function chiudiMenu(e: MouseEvent): void {
    if (!(e.target as HTMLElement).closest('.ap-pop, .ap-tune')) menu = false
  }
  function esc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && menu) { e.stopPropagation(); menu = false }
  }
</script>

<svelte:document onclick={chiudiMenu} onkeydown={esc} />

<aside class="agentpan" style="width:{(store.helperW || 300)}px" aria-label="Pannello agente">
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
    <span class="ap-title">PANNELLO AGENTE</span>
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
        <div class="ap-empty">Apri una chat per vedere i TODO.</div>
      {:else if todos.length === 0}
        <div class="ap-empty">
          {#if store.snap.capabilities?.todos === false}
            Questo agent non tiene una checklist mentre lavora.
          {:else}
            Nessun task. L'agent terrà traccia del lavoro qui quando avrà qualcosa da fare.
          {/if}
        </div>
      {:else}
        {#if inCorso.length > 0}
          <div class="ap-sec-head">IN CORSO</div>
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
        <div class="ap-sec-head">COMPLETATI</div>
        {#if completati.length === 0}
          <div class="ap-empty">Nessun completato.</div>
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
        <span>Sola lettura — può consultare il progetto ma non modificarlo. Chat temporanea, non entra nella cronologia principale.</span>
      </div>

      {#if store.helperRefused}<div class="hwarn">{store.helperRefused}</div>{/if}
      {#if !snap && store.helperBusy}<div class="ap-empty">Avvio…</div>{/if}
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
        <textarea class="ap-input" bind:this={box} bind:value={testo} placeholder="Fai una domanda veloce..." rows="1" oninput={grow} onkeydown={tasto} disabled={store.helperBusy}></textarea>
        <button class="ap-send" aria-label="Send" onclick={() => void manda()} disabled={!testo.trim() || lavora || store.helperBusy}><Icon name="i-send" /></button>
      </div>
      <div class="ap-status">
        <!-- Lo stesso chip della status bar della conversazione grande: icona del
             modello, nome, chevron. Solo i colori sono quelli del pannello. -->
        <button class="ap-tune" onclick={() => void apriMenu()} aria-label="Model: {modelloOra}">
          {#if iconaModello}
            <img src={iconaModello} alt="" width="14" height="14" style="flex:none;border-radius:3px;filter:brightness(0) invert(1)" loading="lazy"
              onerror={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display='none' }} />
          {:else}
            <span class="mdot"></span>
          {/if}
          <span class="mname">{nomeModello}</span>
          <Icon name="i-down" />
        </button>
      </div>
    </div>
  {/if}
</aside>

<style>
  .agentpan{
    flex:none; display:flex; flex-direction:column; background:#080C18; border-left:1px solid #1C2333;
    position:relative; overflow:hidden; border-radius: 14px 0 0 14px; /* staccata come nello screenshot */
  }
  .hgrip{position:absolute; left:-3px; top:0; bottom:0; width:7px; cursor:col-resize; background:none; border:0; padding:0; z-index:2}
  .hgrip:hover{background:rgba(122,92,250,.12)}
  .ap-head{display:flex; align-items:center; justify-content:space-between; padding:12px 12px 8px; flex:none}
  .ap-title{font-size:10px; letter-spacing:.12em; font-weight:700; color:#6B7488}
  .ap-x{width:22px; height:22px; display:grid; place-items:center; background:none; border:0; color:#6B7488; cursor:pointer; border-radius:6px}
  .ap-x:hover{color:#E6E8F0; background:#1A1F2E}
  .ap-x :global(svg.ic){width:13px; height:13px}

  /* pill tabs — stesso stile di Sidebar .pick (Group by), dimensioni invariate */
  .ap-tabs{
    margin: 0 12px 10px; padding:2px; display:flex; gap:2px; flex:none;
    background:#1C2333; border:0; border-radius:999px;
  }
  .ap-tab{
    flex:1; padding:6px 0; border:0; border-radius:999px; background:none; color:#6B7488;
    font:inherit; font-size:11.5px; font-weight:600; cursor:pointer;
  }
  .ap-tab:hover:not(.on){ color:#E6E8F0; }
  .ap-tab.on{background:#131A2A; color:#E6E8F0; box-shadow:0 1px 1.5px rgba(0, 0, 0, .10)}
  .ap-tab:focus-visible{ outline:2px solid #7A5CFA; outline-offset:1px; }
  .ap-body{flex:1; overflow:auto; padding:8px 12px 12px; display:flex; flex-direction:column; gap:8px}
  .ap-sec-head{font-size:10px; letter-spacing:.10em; font-weight:600; color:#6B7488; margin:6px 0 4px}
  .ap-sep{border:0; border-top:1px solid #1C2333; margin:10px 0}
  .ap-empty{color:#6B7488; font-size:11px; padding:12px 4px; line-height:1.5}
  .ap-row{display:flex; gap:8px; align-items:flex-start; padding:4px 0}
  .ap-box{width:16px; height:16px; border-radius:4px; border:1px solid #2A3347; display:grid; place-items:center; flex:none; color:#6B7488; background:#0E1424}
  .ap-box.on{background:#0F2A1D; border-color:#1B4D2E; color:#1DBA54}
  .ap-box :global(svg.ic){width:10px; height:10px}
  .ap-box.on :global(svg.ic){width:10px; height:10px}
  .ap-row-main{flex:1; min-width:0}
  .ap-row-title{font-size:11.5px; color:#E6E8F0; line-height:1.35}
  .ap-row-title.strike{color:#8A91A2; text-decoration:line-through}
  .ap-row-sub{font-size:9.5px; color:#6B7488; margin-top:1px}
  .ap-row.done .ap-row-title{color:#8A91A2}

  .ap-notice{
    display:flex; gap:8px; align-items:flex-start; padding:10px 11px; border-radius:10px;
    background:#131A2A; border:1px solid #1E2535; color:#C2C8D6; font-size:11px; line-height:1.4;
    margin: 10px 12px 14px;
  }
  .ap-notice :global(svg.ic){width:14px; height:14px; flex:none; color:#7A5CFA; margin-top:1px}
  .ap-dock{border-top:1px solid #1C2333; padding:8px; flex:none; position:relative; background:#080C18}
  .ap-input-row{display:flex; gap:8px; align-items:flex-end}
  .ap-input{
    flex:1; min-height:36px; max-height:120px; resize:none; padding:8px 12px; border-radius:18px;
    background:#131A2A; border:1px solid #1E2535; color:#E6E8F0; font:inherit; font-size:11.5px; outline:none;
  }
  .ap-input::placeholder{color:#6B7488}
  .ap-input:focus{border-color:#7A5CFA; box-shadow:0 0 0 3px rgba(122,92,250,.18)}
  .ap-send{
    width:34px; height:34px; border-radius:50%; flex:none; border:0; background:#7A5CFA; color:#fff; display:grid; place-items:center; cursor:pointer;
  }
  .ap-send:disabled{opacity:.45; cursor:default}
  .ap-send :global(svg.ic){width:14px; height:14px}

  /* La status bar sotto la casella: per ora solo il modello. Stessa forma del chip
     della barra di stato della conversazione grande (`.tune`): icona del provider,
     nome, chevron — solo i colori sono quelli del pannello. */
  .ap-status{display:flex; align-items:center; gap:8px; padding:8px 2px 0}
  .ap-tune{
    display:inline-flex; align-items:center; gap:5px; border:1px solid #1E2535; border-radius:8px;
    padding:3px 8px; background:#131A2A; color:#E6E8F0; font:inherit; font-size:10px; cursor:pointer;
    max-width:100%;
  }
  .ap-tune .mname{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}
  .ap-tune :global(svg.ic){width:10px; height:10px; color:#6B7488; flex:none}
  .ap-tune .mdot{width:8px; height:8px; border-radius:50%; background:#6B7488; flex:none}
  .ap-tune:hover{border-color:#7A5CFA}
  .ap-tune:focus-visible{outline:2px solid #7A5CFA; outline-offset:1px}

  /* La tendina dei modelli: sta **dentro** il pannello, larga quanto lui — un pannello
     trascinabile e il mobile hanno larghezze diverse, e una larghezza fissa più grande
     del pannello sporgeva a sinistra sopra la conversazione (segnalato il 30 agosto).
     Gli id lunghi si troncano con l'ellissi che `.mpick .lb` già fa. Le voci sono le
     stesse del menu della status bar (`.mi` ecc.), solo coi colori del pannello. */
  .ap-pop{
    position:absolute; left:8px; right:8px; bottom:calc(100% + 4px); width:auto;
    background:#0E1424; border:1px solid #1E2535; border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,.45); padding:4px; z-index:6; max-height:62vh; overflow:auto;
  }
  /* Le voci della tendina: stesse righe del menu di ogni altro posto, ma coi colori
     del pannello — qui non ci sono le variabili del tema, il pannello è scuro fisso. */
  .ap-pop :global(.mi){
    display:flex; align-items:center; gap:7px; padding:4px 8px; border-radius:6px;
    font-size:11px; color:#C2C8D6; width:100%; background:none; border:0; font-family:inherit; text-align:left; cursor:pointer;
  }
  .ap-pop :global(button.mi:hover){background:#1A1F2E}
  .ap-pop :global(.mi.on){background:rgba(122,92,250,.16); color:#E6E8F0; font-weight:600}
  .ap-pop :global(.mi.dis){color:#6B7488}
  .ap-pop :global(.mi .tag){margin-left:auto; font-size:9.5px; color:#6B7488; flex:none}
  .ap-pop :global(.mi .sub){display:block; color:#6B7488; font-size:9.5px}
  .ap-pop :global(.mpick .lb),.ap-pop :global(.mpick .sub){display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .ap-pop :global(.mpick .tx){flex:1; min-width:0}
  .ap-pop :global(.msearch){
    position:sticky; bottom:0; display:flex; align-items:center; gap:7px; padding:6px 8px; margin-top:2px;
    border-top:1px solid #1C2333; background:#131A2A; color:#6B7488;
  }
  .ap-pop :global(.msearch input){flex:1; min-width:0; border:0; background:none; color:#E6E8F0; font-family:inherit; font-size:10.5px; outline:none; padding:0}
  .ap-pop :global(.msearch input::placeholder){color:#6B7488}

  /* helper inner reuse */
  .hconv{padding:0; gap:8px}
  .hq{background:#1A1F2E; border:1px solid #242B3D; color:#E6E8F0}
  .ha{color:#C2C8D6}
  .hthought{border-left-color:#1E2535; color:#8A91A2}
  .spin{width:9px; height:9px; border-radius:50%; border:2px solid #7A5CFA; border-right-color:transparent; animation:sp .9s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}

  @media (max-width: 860px){
    .agentpan{width:100% !important; border-radius:0; border-left:none}
    .hgrip{display:none}
  }
</style>
