<script lang="ts">
  // La conversazione: turni richiudibili, e dentro ciascuno i blocchi di ciò che è
  // successo. Il turno è un contenitore, non un messaggio come gli altri: la richiesta
  // dell'utente ne è l'intestazione, e tutto il resto sta dentro.
  //
  // Quasi tutto è chiuso: tredici scambi di lavoro vero fanno circa quattrocento
  // blocchi, e l'unico modo di reggerli è mostrare i titoli. L'eccezione è la risposta
  // a parole, che non si richiude mai — è l'unica cosa scritta *per* l'utente.
  import Icon from './Icon.svelte'
  import FileBlock from './FileBlock.svelte'
  import Dock from './Dock.svelte'
  import type { LinkStatus } from '../lib/api.ts'
  import type { PartView, SessionSnapshot, TurnView } from '$core/reduce.ts'
  import { SvelteSet } from 'svelte/reactivity'
  import { promptText } from '$core/events.ts'
  import { colours, hhmm, project, since, toolIcon, turnStatus } from '../lib/view.ts'
  import { renderMarkdown } from '../lib/markdown.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap, link }:
    { store: Store; snap: SessionSnapshot; link: LinkStatus } = $props()

  // Di default è aperto il turno **attivo** — quello che l'agent sta davvero facendo,
  // che non è sempre l'ultimo: se mandi un messaggio mentre lavora ancora al
  // precedente, quello nuovo si accoda e non ha ancora un blocco. Aprire «l'ultimo»
  // alla lettera richiuderebbe il lavoro vero proprio mentre è in corso. Quando
  // nessun turno è attivo si torna alla regola semplice: l'ultimo. `!id` marca un
  // turno chiuso a mano: senza, richiuderlo non avrebbe effetto, perché la regola di
  // default lo riaprirebbe subito.
  let opened = $state<Set<string>>(new Set())
  const defaultOpenIdx = $derived.by((): number => {
    const attivo = snap.turns.findIndex(t => !t.ended)
    return attivo !== -1 ? attivo : snap.turns.length - 1
  })
  const isOpen = (t: TurnView, i: number): boolean =>
    opened.has(t.turnId) ? true : (i === defaultOpenIdx && !opened.has(`!${t.turnId}`))

  function toggle(t: TurnView, i: number): void {
    const next = new Set(opened)
    if (isOpen(t, i)) { next.delete(t.turnId); next.add(`!${t.turnId}`) }
    else { next.add(t.turnId); next.delete(`!${t.turnId}`) }
    opened = next
  }

  // ─── i singoli blocchi: reasoning e tool si aprono a loro volta ────────────
  // Chiusi di default per lo stesso motivo per cui lo è il turno: tredici scambi
  // veri fanno ~400 blocchi, e mostrarli per intero renderebbe illeggibile proprio
  // ciò che dovrebbe stare a colpo d'occhio.
  let openedBlocks = $state<Set<string>>(new Set())
  const blockOpen = (key: string): boolean => openedBlocks.has(key)
  function toggleBlock(key: string): void {
    const next = new Set(openedBlocks)
    if (next.has(key)) next.delete(key); else next.add(key)
    openedBlocks = next
  }
  /** L'input del tool, leggibile: già strutturato se è arrivato, grezzo se no. */
  const prettyInput = (part: Extract<PartView, { kind: 'tool' }>): string => {
    if (part.input !== undefined) {
      try { return JSON.stringify(part.input, null, 2) } catch { /* usa il grezzo */ }
    }
    return part.inputRaw
  }

  // ─── raggruppare le operazioni: solo quella in corso resta in vista ────────
  //
  // Bash, Read, il reasoning: non sono scritti per l'utente, sono il *come*. Uno
  // via l'altro diventano un muro che nasconde proprio il poco che è scritto per
  // lui — la risposta. Resta in piena vista solo l'operazione ancora in corso;
  // quelle finite si accorpano in «N operations», chiuso di default, che si apre
  // sull'elenco esatto di prima (ogni riga resta cliccabile per il suo dettaglio).
  //
  // «Consecutive» è la parola che conta: se in mezzo l'agent scrive del testo,
  // quel testo è la prova che si è fermato a dire qualcosa — accorpare oltre
  // quel punto nasconderebbe dove finiva un pensiero e cominciava il prossimo.
  type OpPart = Extract<PartView, { kind: 'tool' | 'reasoning' }>
  type Grp =
    | { kind: 'solo'; key: string; part: PartView }
    | { kind: 'live'; key: string; part: OpPart }
    | { kind: 'done'; key: string; parts: OpPart[] }

  const isOp = (p: PartView): p is OpPart => p.kind === 'tool' || p.kind === 'reasoning'
  const isLive = (p: OpPart): boolean => p.kind === 'tool' ? !p.done : p.open
  const keyOf = (p: PartView): string => p.kind === 'tool' ? p.callId : p.partId

  // Un `thinking` che Claude ha chiuso senza avere emesso un solo delta non è un
  // pensiero corto: è vuoto. Aprirlo mostrerebbe solo «…», che non è un contenuto,
  // è l'assenza travestita da riga cliccabile. Mentre è ancora aperto resta invece
  // in vista: lì il segnale «sta pensando» vale anche a zero caratteri, perché dice
  // che il turno è vivo.
  const isEmptyReasoning = (p: PartView): boolean =>
    p.kind === 'reasoning' && !p.open && p.text.trim() === ''

  function groupParts(parts: PartView[]): Grp[] {
    const out: Grp[] = []
    let buf: OpPart[] = []
    const flush = (): void => {
      if (buf.length === 0) return
      const last = buf[buf.length - 1]!
      if (isLive(last)) {
        const fatte = buf.slice(0, -1)
        if (fatte.length > 0) out.push({ kind: 'done', key: `d:${keyOf(fatte[0]!)}`, parts: fatte })
        out.push({ kind: 'live', key: `l:${keyOf(last)}`, part: last })
      } else {
        out.push({ kind: 'done', key: `d:${keyOf(buf[0]!)}`, parts: buf })
      }
      buf = []
    }
    for (const p of parts) {
      if (isEmptyReasoning(p)) continue
      if (isOp(p)) { buf.push(p); continue }
      flush()
      out.push({ kind: 'solo', key: keyOf(p), part: p })
    }
    flush()
    return out
  }

  /**
   * L'ultima cosa scritta per l'utente finisce con un punto di domanda? È il
   * messaggio più facile da perdere in un muro di testo, perché non somiglia a una
   * domanda — è una `answer`/`Ask` a somigliarci. Vale solo per l'ultimo blocco di
   * testo dell'ultimo turno: è l'unico che si può ancora perdere, il resto è storia.
   */
  const isOpenQuestion = (i: number, part: PartView): boolean => {
    if (part.kind !== 'text' || i !== snap.turns.length - 1) return false
    const testi = snap.turns[i]!.parts.filter((p): p is Extract<PartView, { kind: 'text' }> => p.kind === 'text')
    const ultimo = testi[testi.length - 1]
    return !!ultimo && ultimo.partId === part.partId && /\?\s*$/.test(part.text.trim())
  }

  // ─── auto-scroll ─────────────────────────────────────────────────────────
  // Segue il fondo finché l'utente non risale a leggere qualcosa: solo allora
  // smette, perché altrimenti lo strapperebbe via da quello che stava leggendo.
  // Torna a seguirlo da solo se l'utente riscende in fondo a mano.
  let scrollerEl = $state<HTMLDivElement | null>(null)
  let stick = $state(true)
  function onScroll(): void {
    if (!scrollerEl) return
    const gap = scrollerEl.scrollHeight - scrollerEl.scrollTop - scrollerEl.clientHeight
    stick = gap < 56
  }
  let lastSession = $state('')
  $effect(() => {
    if (snap.sessionId !== lastSession) { lastSession = snap.sessionId; stick = true }
  })
  $effect(() => {
    // Letture che fanno da dipendenza: quanti turni, quanti blocchi nell'ultimo, e
    // quanto testo — un `text.delta` cresce lo stesso blocco senza aggiungerne uno.
    const ultimo = snap.turns[snap.turns.length - 1]
    const misura = ultimo
      ? ultimo.parts.reduce((n, p) => n + (p.kind === 'text' || p.kind === 'reasoning' ? p.text.length : 1), 0)
      : 0
    void snap.turns.length; void misura
    if (stick && scrollerEl) {
      const el = scrollerEl
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    }
  })

  const promptOf = (t: TurnView): string => promptText(t.prompt)
  /** Gli allegati il cui file non si trova più. Non è stato dell'app, è stato del disco. */
  let persi = $state(new SvelteSet<string>())

  /** 34802 → «34.8k». I token si leggono per ordine di grandezza, non a una a una. */
  const kilo = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  /** Le immagini che hai mandato con quel turno: stanno prima del testo, come le ha
   *  viste il modello. I byte non sono nel journal, quindi si chiedono al daemon. */
  const immaginiOf = (t: TurnView): Extract<TurnView['prompt'][number], { type: 'image' }>[] =>
    t.prompt.filter(p => p.type === 'image')
  // Sulla lista intera, non su questa sola riga: la tavolozza si assegna in ordine
  // alfabetico fra TUTTI i progetti, quindi calcolarla su un elenco di uno darebbe
  // sempre il primo colore — e lo stesso progetto avrebbe due colori diversi nelle
  // due metà dello schermo, che è esattamente ciò che il colore serve a evitare.
  const colour = $derived(colours(store.rows).get(project(snap.cwd)) ?? 0)
  const title = $derived(store.row?.title ?? project(snap.cwd))

  /**
   * Su cosa ha lavorato un tool. Arriva **già pronto** dal modello canonico: fino a
   * ieri era questa funzione a frugare dentro `input` cercando `command`/`file_path`,
   * cioè a conoscere la forma di Claude Code fuori dall'adapter. Adesso quel mestiere
   * sta in `adapters/claude-code/summary.ts`, che è dove ha diritto di stare.
   * Il ripiego serve solo ai journal scritti prima, e mostra ciò che c'è senza
   * interpretarlo.
   */
  const subject = (part: Extract<PartView, { kind: 'tool' }>): string =>
    part.summary ?? part.inputRaw.slice(0, 120)

  /** Le modifiche prodotte da questa chiamata, per mostrarle dove sono accadute. */
  const editsOf = (callId: string) => snap.files.filter(f => f.callId === callId)

  let renaming = $state(false)
  let draft = $state('')

  function startRename(): void {
    draft = title
    renaming = true
  }
  async function commitRename(): Promise<void> {
    renaming = false
    if (store.selected && draft.trim() && draft !== title) {
      await store.rename(store.selected, draft)
    }
  }
</script>

<div class="col">
  <div class="bar">
    <i class="dotk p{colour}"></i>
    {#if renaming}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="rn" autofocus bind:value={draft}
        onblur={() => void commitRename()}
        onkeydown={e => {
          if (e.key === 'Enter') void commitRename()
          if (e.key === 'Escape') renaming = false
        }} />
    {:else}
      <!-- Rinominare non apre niente: il titolo diventa scrivibile dov'è. -->
      <button class="t" ondblclick={startRename} title="Double-click to rename">{title}</button>
    {/if}

    <button class="iconb" title="Put to sleep — frees memory, not quota"
      style="margin-left:auto" disabled={!store.live}
      onclick={() => void store.sleep()}><Icon name="i-moon" /></button>

    <button class="effbtn" style="margin-left:0" onclick={() => store.show('effects')}>
      <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
        {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      <Icon name="i-bars" />
    </button>
  </div>

  {#if link !== 'live' && store.live}
    <div class="offline">
      <Icon name={link === 'connecting' ? 'i-loader' : 'i-wifi-off'}
        style="animation:{link === 'connecting' ? 'sp 1.1s linear infinite' : 'none'}" />
      {link === 'connecting' ? 'Connecting…' : 'Connection lost — retrying, nothing is missed'}
    </div>
  {/if}

  <!-- Una riga sola per una reasoning e per un tool, in vista o dentro il gruppo
       collassato: lo stesso disegno, un posto solo da tenere allineato. -->
  {#snippet opRow(part: OpPart)}
    {#if part.kind === 'reasoning'}
      {@const key = `r:${part.partId}`}
      {@const ropen = blockOpen(key)}
      <button class="row think clickable" onclick={() => toggleBlock(key)}>
        <Icon name="i-brain" />
        <span class="k">Reasoning</span>
        <span class="v">{part.estimatedTokens ? `${part.estimatedTokens} tokens` : ''}</span>
        <span class="end">{ropen ? '▾' : '▸'}</span>
      </button>
      {#if ropen}
        <div class="blockbody">{part.text || '…'}</div>
      {/if}
    {:else}
      {@const key = `t:${part.callId}`}
      {@const topen = blockOpen(key)}
      <!-- `bad` solo se NON è bloccata: un'azione fermata dal classificatore torna
           comunque come tool fallito, e senza questa esclusione le due classi si
           sovrappongono e vince il rosso. Ma bloccato non è un fallimento — è
           «fermato, e puoi consentirlo tu». -->
      <button class="row clickable" class:bad={part.done && part.ok === false && !part.blocked}
           class:block={!!part.blocked} onclick={() => toggleBlock(key)}>
        <Icon name={part.blocked ? 'i-block' : toolIcon(part.name)} />
        <span class="k">{part.blocked ? 'Blocked' : part.name}</span>
        <span class="v">{subject(part)}</span>
        <span class="end">
          {#if part.blocked}stopped for safety
          {:else if !part.done}…
          {:else if part.ok}✓{:else}✗{/if}
          {topen ? '▾' : '▸'}
        </span>
      </button>
      {#if topen}
        <div class="blockbody">
          <div class="bblabel">Input</div>{prettyInput(part)}
          {#if part.error}
            <div class="bblabel err">Error</div>{part.error}
          {:else if part.output}
            <div class="bblabel">Output</div>{part.output}
          {/if}
        </div>
      {/if}

      <!-- I file toccati da questa chiamata, dove sono stati toccati. Lo stesso file
           può comparire più volte nel turno: sono modifiche avvenute in momenti
           diversi, e in mezzo l'agent ha fatto altro. -->
      {#each editsOf(part.callId) as edit (edit.ts)}
        <FileBlock edits={[edit]} narrow={store.narrow} />
      {/each}
    {/if}
  {/snippet}

  <div class="scroller conv" bind:this={scrollerEl} onscroll={onScroll}>
    {#each snap.turns as turn, i (turn.turnId)}
      {@const open = isOpen(turn, i)}
      {@const status = turnStatus(snap.turns, i)}
      <div class="turn" class:open class:active={status === 'active'} class:queued={status === 'queued'}>
        <button class="th" onclick={() => toggle(turn, i)}>
          <span class="cx">{open ? '▾' : '▸'}</span>
          <span class="tm">{hhmm(turn.startedAt)}</span>
          <span class="q">{promptOf(turn)}</span>
          <span class="n">
            {#if status === 'queued'}queued — waiting its turn
            {:else if status === 'active'}{turn.parts.length} {turn.parts.length === 1 ? 'block' : 'blocks'} · working…
            {:else}{turn.parts.length} {turn.parts.length === 1 ? 'block' : 'blocks'}{#if turn.endedAt}{' · '}{since(turn.startedAt, turn.endedAt)}{/if}{/if}
          </span>
        </button>

        {#if open}
          <div class="tb">
            {#if immaginiOf(turn).length > 0}
              <!-- Quello che gli hai fatto vedere, sopra a tutto: è la prima cosa che
                   il modello ha avuto davanti, e riaprendo due giorni dopo è la prima
                   che serve per capire di cosa si stava parlando. -->
              <div class="pimgs">
                {#each immaginiOf(turn) as img (img.ref)}
                  {#if persi.has(img.ref)}
                    <!-- Il file non c'è più: cancellato a mano, o un journal arrivato
                         da un'altra macchina senza la sua cartella di allegati. Dirlo
                         è meglio dell'icona di immagine rotta, che sembra un guasto
                         di STARK invece di un file che manca. -->
                    <span class="persa" title={img.name ?? 'image'}>
                      <Icon name="i-warn" />
                      {img.name ?? 'image'} — not on this machine
                    </span>
                  {:else}
                    <a href={`/api/sessions/${snap.sessionId}/blob/${img.ref}`}
                      target="_blank" rel="noreferrer" title={img.name ?? 'image'}>
                      <img src={`/api/sessions/${snap.sessionId}/blob/${img.ref}`}
                        alt={img.name ?? 'attachment'}
                        onerror={() => { persi = new SvelteSet([...persi, img.ref]) }} />
                    </a>
                  {/if}
                {/each}
              </div>
            {/if}
            {#each groupParts(turn.parts) as g (g.key)}
              {#if g.kind === 'solo'}
                {@const part = g.part}
                {#if part.kind === 'text'}
                  <!-- Sempre per intero: è l'unica cosa scritta per l'utente, e in
                       Markdown — è quello che il CLI stesso rende. Evidenziato se è
                       l'ultima cosa detta e finisce con un punto di domanda: è quello
                       che si perde più facilmente in un muro di testo. -->
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="prose" class:asked={isOpenQuestion(i, part)}>{@html renderMarkdown(part.text)}</div>

                {:else if part.kind === 'compact'}
                  <!-- Una riga che taglia il flusso, perché è esattamente quello che è
                       successo: sopra, il modello non ha più i messaggi per intero ma un
                       riassunto. È la spiegazione di metà delle volte in cui sembra aver
                       dimenticato qualcosa, e nasconderla lascerebbe quel «sembra». -->
                  <div class="compact">
                    <span class="l"></span>
                    <span class="t">
                      Context compacted{#if part.trigger === 'manual'}, because you asked{:else if part.trigger === 'auto'}, it had filled up{/if}
                      {#if part.after !== undefined}
                        · {kilo(part.before)} → {kilo(part.after)} tokens
                      {:else}
                        · {kilo(part.before)} tokens before
                      {/if}
                    </span>
                    <span class="l"></span>
                  </div>

                {:else if part.kind === 'answer'}
                  <!-- La richiesta non è passata di qui: si era espanso il blocco in
                       basso. Ciò che resta nel flusso è cosa hai risposto, dove è
                       successo, così che due giorni dopo si capisca cosa si era deciso. -->
                  <div class="row answer">
                    <Icon name={part.of === 'question' ? 'i-ask' : 'i-shield'} />
                    <span class="k">You</span>
                    <span class="v">{part.asked}</span>
                    <!-- Nessun rosso: aver detto di no non è un fallimento, è una
                         decisione. Il rosso qui la farebbe leggere come qualcosa
                         andato storto, e la prossima volta si esiterebbe a dirlo. -->
                    <span class="end" class:no={part.refused}>{part.answer}</span>
                  </div>
                {/if}

              {:else if g.kind === 'live'}
                <!-- L'unica operazione ancora in corso: resta in piena vista, perché
                     è l'unica di cui ha senso chiedersi «a che punto è». -->
                {@render opRow(g.part)}

              {:else}
                <!-- Finite, e accorpate: il *come* non serve più una volta che il
                     *cosa* è successo, a meno che non lo si chieda apposta. -->
                {@const gkey = g.key}
                {@const gopen = blockOpen(gkey)}
                <button class="row clickable ops" onclick={() => toggleBlock(gkey)}>
                  <Icon name="i-bars" />
                  <span class="k">{g.parts.length} {g.parts.length === 1 ? 'operation' : 'operations'}</span>
                  <span class="end">{gopen ? '▾' : '▸'}</span>
                </button>
                {#if gopen}
                  <div class="opgroup">
                    {#each g.parts as part (part.kind === 'tool' ? part.callId : part.partId)}
                      {@render opRow(part)}
                    {/each}
                  </div>
                {/if}
              {/if}
            {/each}

            {#if turn.ended && turn.reason !== 'completed'}
              <div class="row bad"><Icon name="i-warn" /><span class="k">Turn {turn.reason}</span></div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    {#if snap.turns.length === 0}
      <div class="mid">Nothing has happened in this chat yet. Write the first message below.</div>
    {/if}
  </div>

  <Dock {store} {snap} />
</div>

<style>
  /* Il turno attivo (l'agent ci sta davvero lavorando) e quello in coda (dietro un
     altro ancora in corso) si distinguono col colore già usato per gli stessi stati
     altrove in STARK: blu = working, ambra = tocca aspettare. */
  .turn.active { border-color: var(--work); }
  .turn.active > .th { border-left: 3px solid var(--work); padding-left: 8px; }
  .turn.queued { border-color: var(--wait); }
  .turn.queued > .th { border-left: 3px solid var(--wait); padding-left: 8px; }
  .turn.queued .n { color: var(--wait); }

  /* Un blocco (reasoning, tool) si apre come il turno: stesso segno, stesso posto.
     È un <button>, quindi il colore e il fondo che `.row` dà a un <div> vanno
     ridichiarati: lo user agent li sovrascrive con lo stile di sistema dei controlli
     altrimenti — è lo stesso motivo per cui `.th` più sopra fa `color: inherit`. */
  .row.clickable {
    width: 100%; border: 0; text-align: left; cursor: pointer;
    background: var(--surface-2); color: inherit; font: inherit;
  }
  .row.clickable.block { background: var(--wait-bg); color: var(--wait); }
  .row.clickable.bad { background: var(--stop-bg); color: var(--stop); }
  .row.clickable.think { color: var(--muted); }

  /* Il gruppo di operazioni finite: stesso disegno di una riga singola, ma il
     colore resta neutro apposta — non è successo niente lì dentro che meriti
     l'attenzione che un tool fallito o bloccato chiede con il suo colore. */
  .row.ops { color: var(--muted); }
  .row.ops .k { font-weight: 500; }
  .opgroup {
    display: flex; flex-direction: column; gap: 4px; margin: 2px 0 6px 8px;
    padding-left: 8px; border-left: 2px solid var(--line-2);
  }
  .row.clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .blockbody {
    white-space: pre-wrap; word-break: break-word; font-family: var(--mono);
    font-size: 10.5px; color: var(--ink-2); background: var(--surface);
    border: 1px solid var(--line-2); border-radius: 7px; padding: 7px 9px;
    margin: 2px 0 6px; max-height: 360px; overflow: auto;
  }
  .bblabel {
    font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: var(--muted); margin: 6px 0 2px;
  }
  .bblabel:first-child { margin-top: 0; }
  .bblabel.err { color: var(--stop); }

  /* La risposta che finisce con un punto di domanda: è quella che si perde più
     facilmente in un muro di testo, e per questo prende lo stesso ambra di ogni
     altro «tocca a te». */
  .prose.asked {
    background: var(--wait-bg); color: var(--ink);
    border: 1px solid var(--wait); border-radius: 8px; padding: 8px 10px; font-weight: 600;
  }

  /* La riga della compattazione: un taglio, non un blocco. */
  .compact { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
  .compact .l { flex: 1; height: 1px; background: var(--line-2); }
  .compact .t { font-size: 9.5px; color: var(--muted); white-space: nowrap; }

  /* Le immagini mandate col prompt: piccole, perché sono un promemoria di cosa hai
     mandato, non la cosa da guardare. Un clic le apre a grandezza vera. */
  .pimgs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .pimgs img {
    max-height: 96px; max-width: 220px; border-radius: 7px;
    border: 1px solid var(--line-2); display: block;
  }
  .pimgs a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .persa {
    display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px;
    border: 1px dashed var(--line-2); border-radius: 7px;
    font-size: 10px; color: var(--muted);
  }

  .th, .iconb, .effbtn { background: none; font: inherit; color: inherit; }
  .th { width: 100%; border: 0; text-align: left; }
  .th:focus-visible, .iconb:focus-visible, .effbtn:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }
  .iconb[disabled] { opacity: .4; cursor: default; }
  /* Il testo ora è HTML vero (Markdown reso), non più righe grezze da preservare a
     mano: `pre-wrap` avrebbe reintrodotto righe vuote fra i blocchi che il browser
     ignorerebbe altrimenti da solo. Gli elementi che Markdown può produrre prendono
     uno stile minimo, coerente col resto di STARK — non è un foglio di stile a sé,
     è `.prose` che impara qualche tag in più. */
  .prose :global(p) { margin: 0 0 8px; white-space: pre-wrap; }
  .prose :global(p:last-child) { margin-bottom: 0; }
  .prose :global(ul), .prose :global(ol) { margin: 0 0 8px; padding-left: 20px; }
  .prose :global(li) { margin: 2px 0; }
  .prose :global(li > p) { margin: 0; }
  .prose :global(h1), .prose :global(h2), .prose :global(h3),
  .prose :global(h4), .prose :global(h5), .prose :global(h6) {
    color: var(--ink); font-weight: 700; margin: 12px 0 6px; line-height: 1.3;
  }
  .prose :global(h1) { font-size: 15px; } .prose :global(h2) { font-size: 13.5px; }
  .prose :global(h3), .prose :global(h4), .prose :global(h5), .prose :global(h6) { font-size: 12px; }
  .prose :global(:first-child) { margin-top: 0; }
  .prose :global(a) { color: var(--accent); text-decoration: underline; }
  .prose :global(code) { font-family: var(--mono); font-size: .92em; }
  .prose :global(pre) {
    font-family: var(--mono); font-size: 10.5px; background: var(--surface);
    border: 1px solid var(--line-2); border-radius: 7px; padding: 8px 10px;
    margin: 0 0 8px; overflow: auto; white-space: pre;
  }
  .prose :global(pre code) { background: none; padding: 0; font-size: 1em; }
  .prose :global(blockquote) {
    margin: 0 0 8px; padding: 2px 10px; border-left: 3px solid var(--line-2);
    color: var(--muted);
  }
  .prose :global(hr) { border: 0; border-top: 1px solid var(--line-2); margin: 10px 0; }
  .prose :global(table) {
    border-collapse: collapse; margin: 0 0 8px; font-size: 10.5px;
    display: block; max-width: 100%; overflow-x: auto;
  }
  .prose :global(th), .prose :global(td) {
    border: 1px solid var(--line-2); padding: 4px 8px; text-align: left;
  }
  .prose :global(th) { background: var(--surface-2); color: var(--ink); font-weight: 700; }
  .prose :global(strong) { color: var(--ink); }

  .bar .t { border: 0; padding: 0; text-align: left; cursor: text; }
  .rn {
    font: inherit; font-size: 12.5px; font-weight: 600; flex: 1;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 6px;
    background: var(--surface); color: var(--ink); outline: none;
  }

  /* La risposta data non è né un successo né un errore: è una decisione, e si legge
     come tale. Il rosso resta per quelle negate. */
  .row.answer { background: var(--accent-soft); }
  .row.answer .end { color: var(--ink-2); font-weight: 600; }
  .row.answer .end.no { color: var(--wait); }
</style>
