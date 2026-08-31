<script lang="ts">
  // L'helper: la chat di lato, larga un sesto (§17).
  //
  // Perché è un componente nuovo e non `Conversation` riusata. Quelle sono 1200 righe
  // costruite attorno a una conversazione di **lavoro**: turni richiudibili, effetti,
  // permessi, piano, quota, MCP, slash, `@file`, sticky del prompt. In 240px non
  // sarebbe un riuso ma un rifacimento, e soprattutto risponderebbe a domande che qui
  // nessuno pone. Qui la domanda è una sola: *cosa mi ha risposto*.
  //
  // Quindi niente turni da aprire e chiudere: una conversazione corta si legge tutta.
  // È l'eccezione che le regole del progetto già prevedono — «la risposta a parole si
  // mostra sempre intera» — applicata a una schermata dove *tutto* è risposta a parole.
  //
  // Il motore invece è lo stesso di sempre: `Pane`, `applyTo`, lo stesso snapshot. Il
  // §4 vale anche per una chat che non esiste su disco.
  import Icon from './Icon.svelte'
  import ModelPicker from './ModelPicker.svelte'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import { renderMarkdown } from '../lib/markdown.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import type { AgentModels } from '../lib/api.ts'
  import type { PartView, TurnView } from '$core/reduce.ts'
  import { promptText } from '$core/events.ts'

  let { store }: { store: Store } = $props()

  const snap = $derived(store.helper?.snap ?? null)
  const turns = $derived(snap?.turns ?? [])
  const lavora = $derived(snap?.state === 'busy' || snap?.state === 'starting')

  let testo = $state('')
  let scroller = $state<HTMLElement | null>(null)
  let box = $state<HTMLTextAreaElement | null>(null)
  let menu = $state(false)
  let aperti = $state<Record<string, boolean>>({})

  // Segue il fondo mentre la risposta arriva, come la conversazione grande. La misura
  // è la stessa: la somma del testo di tutti i turni, non solo dell'ultimo — con un
  // prompt in coda l'ultimo turno è quello accodato, vuoto e fermo, e guardare solo
  // lui lascerebbe la pagina indietro esattamente quando serve seguire.
  const quanto = $derived(
    turns.reduce((n: number, t: TurnView) => n + t.parts.reduce(
      (m: number, p: PartView) => m + testoDi(p).length, 0), 0),
  )
  let attaccato = $state(true)
  function onScroll(): void {
    const el = scroller
    if (!el) return
    attaccato = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  $effect(() => {
    void quanto; void turns.length
    if (!attaccato) return
    const el = scroller
    if (el) requestAnimationFrame(() => { if (attaccato) el.scrollTop = el.scrollHeight })
  })

  function grow(): void {
    const el = box
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }
  // Dopo un invio la casella si svuota, ma Svelte non scrive nel DOM in modo sincrono:
  // misurarla subito misurerebbe il testo appena mandato e ne fisserebbe l'altezza.
  // È lo stesso difetto già corretto in `Dock.svelte` il 26 agosto.
  async function regrow(): Promise<void> {
    await Promise.resolve()
    grow()
  }

  async function manda(): Promise<void> {
    const t = testo.trim()
    if (!t || lavora || store.helperBusy) return
    testo = ''
    void regrow()
    attaccato = true
    await store.helperPrompt(t)
  }

  function tasto(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void manda() }
  }

  // ─── il selettore: agent e modello insieme ────────────────────────────────
  async function apriMenu(): Promise<void> {
    menu = !menu
    if (menu) await store.caricaCatalogo()
  }

  // Cosa e' in uso adesso. Quale voce del menu corrisponda lo decide `ModelPicker`:
  // il catalogo elenca `default`, lo snapshot riporta il risolto (`claude-opus-5[1m]`),
  // e il confronto fra i due e' una regola sola, che sta con l'elenco.
  const modelloOra = $derived(store.helperPick?.model ?? snap?.model ?? '')
  /** Solo la coda del nome: `opencode/anthropic/claude-sonnet-5` in un chip da 100px
   *  mostrerebbe il provider e nient'altro, cioè la parte uguale per tutti. */
  const etichetta = $derived(modelloOra.split('/').pop() ?? '—')

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

  /** Cambiare agent fa ripartire la conversazione: si dice **prima**, sulla voce, non
   *  dopo averla persa. Vero solo quando una conversazione c'è già. */
  function riparte(agent: string): boolean {
    const ora = store.helperPick?.agent ?? snap?.agent
    return !!ora && !!snap && turns.length > 0 && agent !== ora
  }

  function chiudiMenu(e: MouseEvent): void {
    if (!(e.target as HTMLElement).closest('.hpop, .hstatus')) menu = false
  }

  // Escape chiude, come ogni altro menu di STARK. Trovato guidando la UI vera: il
  // menu restava aperto e copriva la conversazione, quindi da tastiera non c'era
  // modo di tornare a leggere senza sceglierne uno.
  function esc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && menu) { e.stopPropagation(); menu = false }
  }

  function testoDi(p: PartView): string {
    return 'text' in p ? String((p as { text?: string }).text ?? '') : ''
  }
</script>

<svelte:document onclick={chiudiMenu} onkeydown={esc} />

<aside class="helper" style="width:{store.helperW}px" aria-label="Helper">
  <!-- Il bordo che si trascina. `pointer` e non `mouse`: da telefono il pannello è a
       tutto schermo e non si ridimensiona, ma su un tablet col dito sì. -->
  <button class="hgrip" aria-label="Resize helper"
    onpointerdown={(e) => {
      const start = e.clientX, w0 = store.helperW
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const muovi = (m: PointerEvent): void => store.setHelperW(w0 + (start - m.clientX))
      const su = (): void => {
        el.removeEventListener('pointermove', muovi)
        el.removeEventListener('pointerup', su)
      }
      el.addEventListener('pointermove', muovi)
      el.addEventListener('pointerup', su)
    }}></button>

  <div class="hbar">
    <Icon name="i-chat" />
    <div class="t">Helper</div>
    <button class="hb" title="Start over" aria-label="Start over"
      onclick={() => void store.svuotaHelper()}><Icon name="i-trash" /></button>
    <button class="hb" title="Close" aria-label="Close helper"
      onclick={() => { store.helperOn = false }}><Icon name="i-x" /></button>
  </div>

  <div class="scroller hconv" bind:this={scroller} onscroll={onScroll}>
    {#if store.helperRefused}
      <div class="hwarn">{store.helperRefused}</div>
    {/if}

    {#if !snap && store.helperBusy}
      <div class="hempty">Starting…</div>
    {:else if turns.length === 0 && !store.helperBusy}
      <!-- Cosa può e cosa non può, detto **prima** invece di lasciarlo scoprire da un
           rifiuto. È l'unico momento in cui c'è spazio per dirlo. -->
      <div class="hempty">
        <p><b>A question, right now.</b></p>
        <p>This chat is read-only and leaves nothing behind: it disappears when you
        reload, and never shows up in your list.</p>
      </div>
    {/if}

    {#each turns as t (t.turnId)}
      {@const chiesto = promptText(t.prompt)}
      {#if chiesto}<div class="hq">{chiesto}</div>{/if}
      {#each t.parts as p, i (p.kind + i)}
        {#if p.kind === 'text'}
          <div class="ha">{@html renderMarkdown(testoDi(p))}</div>
        {:else if p.kind === 'tool'}
          <!-- Una riga sola. Leggere l'helper lo può fare, e sapere **su cosa** ha
               guardato è metà della risposta; ma qui non c'è spazio per aprirla, e non
               c'è niente da approvare. -->
          <div class="htool" class:ko={p.done && p.ok === false}>
            <Icon name={p.ok === false ? 'i-warn' : 'i-doc'} />
            <span>{p.intent ?? p.summary ?? p.name}</span>
          </div>
        {:else if p.kind === 'reasoning'}
          <!-- Chiuso, ma non nascosto: la regola del progetto è che si veda che c'è. -->
          <button class="hthink" onclick={() => { aperti[p.partId] = !aperti[p.partId] }}>
            <Icon name="i-brain" />
            <span>{aperti[p.partId] ? 'hide thinking' : 'thought'}</span>
          </button>
          {#if aperti[p.partId]}<div class="hthought">{testoDi(p)}</div>{/if}
        {/if}
      {/each}
      {#if t.ended && t.reason && t.reason !== 'completed'}
        <div class="hwarn">{t.reason}</div>
      {/if}
    {/each}

    {#if lavora}
      <div class="hbusy"><i class="spin"></i><span>thinking…</span>
        <button class="hstop" aria-label="Stop" title="Stop"
          onclick={() => void store.helperStop()}><Icon name="i-stop" /></button>
      </div>
    {/if}
  </div>

  <div class="hdock">
    {#if menu}
      <div class="hpop">
        <ModelPicker catalogo={store.catalogo} corrente={modelloOra}
          agenteCorrente={store.helperPick?.agent ?? snap?.agent}
          nota={a => (riparte(a) ? 'restarts' : null)}
          onScegli={(agent, model) => void scegli(agent, model)} />
      </div>
    {/if}

    <textarea class="hinput" bind:this={box} bind:value={testo}
      placeholder="Ask something…" rows="1"
      oninput={grow} onkeydown={tasto} disabled={store.helperBusy}></textarea>

    <div class="hstatus">
      <!-- Un fatto, non un comando: niente vestito da chip premibile. -->
      <span class="ro" title="Read-only: it can read, it cannot change anything">
        <Icon name="i-shield" />read-only
      </span>
      <span class="hmodel-pop" onmouseenter={() => { hovered = true; if (!store.catalogo) void store.caricaCatalogo() }} onmouseleave={() => hovered = false}>
        <button class="tune mdl" onclick={() => void apriMenu()}>
          <span class="nm">{etichetta}</span><Icon name="i-down" />
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
</aside>

<style>
  .hmodel-pop{position:relative;display:inline-flex}
  .hover-card{
    position:absolute; bottom:calc(100% + 7px); right:0; width:280px;
    background:var(--surface); border:1px solid var(--line-2); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,.18); padding:4px; z-index:7;
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
</style>
