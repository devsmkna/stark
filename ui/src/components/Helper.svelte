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
  import { renderMarkdown } from '../lib/markdown.ts'
  import type { Store } from '../lib/store.svelte.ts'
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

  // Cosa e' in uso adesso. Due nomi per la stessa cosa: il catalogo elenca `default`,
  // lo snapshot riporta il modello **risolto** (`claude-opus-5[1m]`) — quindi si
  // confronta con tutti e due, se no la voce scelta non risulta mai selezionata.
  // Visto guardando: il chip diceva `claude-opus-5[1m]` e nel menu non era spuntato niente.
  const modelloOra = $derived(store.helperPick?.model ?? snap?.model ?? '')
  /**
   * Quale **voce** del menu e' quella in uso.
   *
   * Il confronto diretto non basta e nemmeno il ripiego su `resolved`: piu' voci
   * possono risolvere allo stesso modello — `Default (recommended)` e `Opus (1M
   * context)` sono lo stesso modello con due nomi — e segnarle entrambe non dice piu'
   * quale hai scelto. Visto guardando il menu: due spunte.
   *
   * L'ordine giusto e' quindi: **prima** un id esatto (l'utente ha scelto quella voce),
   * e solo se nessuna corrisponde si ripiega sul modello risolto, prendendo la prima —
   * che e' `default`, ed e' la voce vera quando nessuno ha scelto niente.
   */
  const idScelto = $derived.by(() => {
    const tutti = (store.catalogo ?? []).flatMap(a => a.models)
    if (tutti.some(m => m.id === modelloOra)) return modelloOra
    return tutti.find(m => m.resolved === modelloOra)?.id ?? modelloOra
  })
  const scelto = (m: { id: string }): boolean => m.id === idScelto
  /** Solo la coda del nome: `opencode/anthropic/claude-sonnet-5` in un chip da 100px
   *  mostrerebbe il provider e nient'altro, cioè la parte uguale per tutti. */
  const etichetta = $derived(modelloOra.split('/').pop() ?? '—')

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
        {#if store.catalogo === null}
          <div class="pg">Loading models…</div>
        {:else}
          {#each store.catalogo as a (a.id)}
            <div class="pg">
              {a.label}
              {#if a.models.length}<span class="cnt">{a.models.length}</span>{/if}
            </div>
            <!-- L'avviso dell'agent, una volta sola. Su ognuno dei 61 modelli sarebbe
                 lo sfondo invece di un avviso — difetto gia' corretto una volta. -->
            {#if a.note}
              <div class="pnote"><Icon name="i-warn" />{a.note}</div>
            {/if}
            {#if !a.available}
              <div class="mi off"><Icon name="i-block" /><span class="nm">{a.label}</span>
                <span class="why">{a.reason ?? 'not available'}</span></div>
            {/if}
            {#each a.models as m (m.id)}
              <button class="mi" class:on={scelto(m)}
                title={m.note ?? ''}
                onclick={() => void scegli(a.id, m.id)}>
                <span class="nm">{m.label ?? m.id}</span>
                {#if m.note}<span class="warn" aria-label="warning"><Icon name="i-warn" /></span>{/if}
                {#if riparte(a.id)}<span class="why">restarts</span>{/if}
                {#if scelto(m)}<span class="tick"><Icon name="i-check" /></span>{/if}
              </button>
            {/each}
          {/each}
        {/if}
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
      <button class="tune mdl" onclick={() => void apriMenu()}>
        <span class="nm">{etichetta}</span><Icon name="i-down" />
      </button>
    </div>
  </div>
</aside>
