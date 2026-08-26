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

  // ─── i capitoli: dove il contesto è stato azzerato, si chiude ──────────────
  //
  // `/clear` non è un comando come gli altri: quello che sta sopra il modello non ce
  // l'ha più, nemmeno riassunto. Lasciarlo scorrere uguale al resto è mostrare come
  // corrente qualcosa che non lo è, e la conversazione continua a crescere senza
  // dire dove ha smesso di contare. Quindi tutto ciò che precede un `/clear`, il
  // turno del comando compreso, si raccoglie in un capitolo **chiuso**: una riga sola
  // che si riapre cliccandoci, perché azzerato non vuol dire cancellato — il journal
  // ce l'ha ancora, ed è spesso lì che si va a rileggere *cosa* si stava facendo.
  //
  // L'ultimo capitolo è quello vivo: non ha intestazione e non si chiude, è la chat.
  type Chapter = { key: string; items: { turn: TurnView; i: number }[]; clearedAt?: number }
  const chapters = $derived.by((): Chapter[] => {
    const out: Chapter[] = []
    let cur: Chapter | undefined
    snap.turns.forEach((turn, i) => {
      if (!cur) { cur = { key: `ch:${turn.turnId}`, items: [] }; out.push(cur) }
      cur.items.push({ turn, i })
      // Il turno del `/clear` sta DENTRO il capitolo che chiude, non fuori: è l'ultima
      // cosa avvenuta con quel contesto ancora in piedi.
      if (turn.clearedAt !== undefined) { cur.clearedAt = turn.clearedAt; cur = undefined }
    })
    return out
  })
  let openedChapters = $state<Set<string>>(new Set())
  function toggleChapter(key: string): void {
    const next = new Set(openedChapters)
    if (next.has(key)) next.delete(key); else next.add(key)
    openedChapters = next
  }
  /** Quanti turni ci sono dentro, escluso il `/clear` che li ha chiusi: quello è il
   *  taglio, non uno degli scambi che si stanno riponendo. */
  const chapterTurns = (ch: Chapter): number => Math.max(0, ch.items.length - 1)

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

  /**
   * Il bottone «Copy» sopra un blocco di codice non è mai un elemento Svelte: nasce
   * come stringa HTML dentro `renderMarkdown` (vedi `markdown.ts`), quindi non c'è
   * niente a cui attaccare un `onclick` suo, né uno `$state` sensato — Svelte non sa
   * che esiste. Un solo listener delegato su `.prose` copre tutti i blocchi di quella
   * risposta, e la spunta «Copied» si scrive direttamente sul nodo cliccato: è DOM
   * grezzo, e trattarlo come tale è più semplice che fingerlo reattivo.
   *
   * Se la risposta si sta ancora scrivendo, un nuovo delta rifà l'HTML e il bottone
   * cliccato sparisce con lui: il `setTimeout` in sospeso non fa danni (agisce su un
   * nodo staccato dal documento), e quello nuovo nasce già con la scritta giusta.
   */
  async function onProseClick(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement

    // F1: il bottone «Open in …» accanto a un link riconosciuto. Vedi `addAppLinks`
    // in `markdown.ts` per perché non è il link stesso a essere riscritto.
    const appBtn = target.closest<HTMLElement>('[data-open-app]')
    if (appBtn) {
      const url = appBtn.getAttribute('data-url')
      const scheme = appBtn.getAttribute('data-scheme')
      if (url && scheme) await store.openApp(url, scheme)
      return
    }

    const btn = target.closest<HTMLElement>('[data-copy]')
    const pre = btn?.closest('.codeblock')?.querySelector('pre')
    if (!btn || !pre) return
    try {
      await navigator.clipboard.writeText(pre.textContent ?? '')
    } catch {
      store.refused = 'the browser did not allow copying'
      return
    }
    const label = btn.querySelector('span')
    btn.classList.add('done')
    if (label) label.textContent = 'Copied'
    setTimeout(() => {
      btn.classList.remove('done')
      if (label) label.textContent = 'Copy'
    }, 1500)
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
    // Letture che fanno da dipendenza: quanti turni, e quanto contenuto c'è **in tutti**
    // — un `text.delta` cresce lo stesso blocco senza aggiungerne uno, quindi contare i
    // blocchi non basta e serve anche la lunghezza del testo.
    //
    // Su **tutti** i turni e non solo sull'ultimo, ed è la correzione di un bug vero:
    // il turno che sta crescendo non è sempre l'ultimo. Se mandi un prompt mentre
    // l'agent lavora ancora al precedente, quello nuovo si accoda **subito** come turno
    // in fondo, vuoto e fermo (`queued`), mentre a scrivere resta quello prima. Guardando
    // solo l'ultimo, la misura restava zero per tutto il tempo: la dipendenza non
    // cambiava mai, l'effetto non ripartiva, e la conversazione smetteva di seguire il
    // fondo **proprio mentre l'agent scriveva**. Che è il momento in cui serve.
    // Il file sapeva già che «il turno attivo non è sempre l'ultimo» (vedi il commento
    // sopra `isOpen`): quella conoscenza era stata applicata a quale turno aprire, non
    // qui. Sommare su tutti costa un giro sui blocchi già in memoria — `length` di una
    // stringa non la riconta — e toglie di mezzo il caso speciale invece di inseguirlo.
    const misura = snap.turns.reduce((n, t) => n + t.parts.reduce(
      (m, p) => m + (p.kind === 'text' || p.kind === 'reasoning' ? p.text.length : 1), 0), 0)
    void snap.turns.length; void misura
    if (stick && scrollerEl) {
      const el = scrollerEl
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    }
  })

  /** Riportarsi in fondo e ricominciare a seguire. Le due cose insieme: scendere e basta
   *  lascerebbe `stick` falso, quindi la riga dopo si tornerebbe a restare indietro. */
  function toFoot(): void {
    if (!scrollerEl) return
    stick = true
    scrollerEl.scrollTo({ top: scrollerEl.scrollHeight, behavior: 'smooth' })
  }

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
   * Su cosa ha lavorato un tool — il *cosa*, non il *perché* (quello è `part.intent`,
   * F2, mostrato al suo posto nella riga qui sotto). Arriva **già pronto** dal
   * modello canonico: fino a ieri era questa funzione a frugare dentro `input`
   * cercando `command`/`file_path`, cioè a conoscere la forma di Claude Code fuori
   * dall'adapter. Adesso quel mestiere sta in `adapters/claude-code/summary.ts`, che
   * è dove ha diritto di stare. Il ripiego serve solo ai journal scritti prima, e
   * mostra ciò che c'è senza interpretarlo.
   */
  const subject = (part: Extract<PartView, { kind: 'tool' }>): string =>
    part.summary ?? part.inputRaw.slice(0, 120)

  /**
   * Il percorso che questo tool ha nominato, se ce n'è uno — non indovinato dal
   * testo, letto dagli stessi campi che `summary.ts` già riconosce come «un
   * percorso» (F3, Notion). `pattern`/`url`/`query`/`prompt`/`command` restano
   * fuori: un comando può *contenere* un percorso in mezzo ad altro, ma non è lui il
   * percorso, e sbagliare qui vorrebbe dire offrire di "rivelare" una stringa che
   * non esiste sul disco.
   */
  const PATH_KEYS = ['file_path', 'path', 'notebook_path']
  const pathOf = (part: Extract<PartView, { kind: 'tool' }>): string | undefined => {
    const o = part.input as Record<string, unknown> | undefined
    if (!o || typeof o !== 'object') return undefined
    for (const k of PATH_KEYS) {
      const v = o[k]
      if (typeof v === 'string' && v) return v
    }
    return undefined
  }

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
    <!-- Solo sullo schermo stretto: là la lista non e' affiancata, e senza questo
         non ci sarebbe modo di tornarci (§8 di ui-schermate.md). -->
    {#if store.narrow}
      <button class="iconb" title="Back to chats" onclick={() => store.back()}>
        <Icon name="i-back" />
      </button>
    {/if}
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
      <!-- Rinominare non apre niente: il titolo diventa scrivibile dov'è.
           Il titolo intero sta anche nel tooltip perché adesso la riga lo tronca coi
           puntini: senza, un titolo lungo diventerebbe illeggibile per intero senza
           entrare in modifica, cioè si perderebbe un'informazione per farne stare
           un'altra. Così la riga resta una, e il testo pieno resta a un dito. -->
      <button class="t" ondblclick={startRename} title="{title} — double-click to rename">{title}</button>
    {/if}

    <button class="iconb" title="Put to sleep — frees memory, not quota"
      style="margin-left:auto" disabled={!store.live}
      onclick={() => void store.sleep()}><Icon name="i-moon" /></button>

    <!-- Il conteggio in parole non ci sta su uno schermo stretto: sotto la soglia
         resta solo l'icona, stesso bottone, stessa destinazione — non è nascosta,
         è un'etichetta che qui non c'è spazio a scrivere per intero (Principio 5:
         quello che sparisce è il testo, non la funzione). -->
    <button class="effbtn" style="margin-left:0" onclick={() => store.show('effects')}
      title="{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} · {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}">
      {#if !store.narrow}
        <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
          {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      {/if}
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
      {@const revealPath = pathOf(part)}
      <!-- F3: quando il tool ha nominato un percorso, la riga si affianca a un
           secondo bottone che arriva lì — senza rubare il posto al clic che apre il
           dettaglio, ed è per questo che diventano due bottoni fratelli invece di
           uno dentro l'altro (non sarebbe HTML valido). Sugli altri tool (Bash senza
           percorso, WebFetch, …) la riga resta esattamente com'era. -->
      <div class="oprow" class:withreveal={!!revealPath}>
        <!-- `bad` solo se NON è bloccata: un'azione fermata dal classificatore torna
             comunque come tool fallito, e senza questa esclusione le due classi si
             sovrappongono e vince il rosso. Ma bloccato non è un fallimento — è
             «fermato, e puoi consentirlo tu». -->
        <button class="row clickable tool" class:bad={part.done && part.ok === false && !part.blocked}
             class:block={!!part.blocked} onclick={() => toggleBlock(key)}>
          <div class="rtop">
            <Icon name={part.blocked ? 'i-block' : toolIcon(part.name)} />
            <span class="k">{part.blocked ? 'Blocked' : part.name}</span>
            <!-- F2: quando l'agent ha scritto PERCHÉ (`intent`), è quella la riga
                 principale — dice dove sta andando, non solo cosa sta eseguendo. -->
            <span class="v" class:plain={!!part.intent}>{part.intent ?? subject(part)}</span>
            <span class="end">
              {#if part.blocked}stopped for safety
              {:else if !part.done}…
              {:else if part.ok}✓{:else}✗{/if}
              {topen ? '▾' : '▸'}
            </span>
          </div>
          {#if part.intent}
            <!-- Il soggetto esatto (comando, percorso) non sparisce dietro la
                 motivazione: resta visibile, sotto e più piccolo — un tooltip
                 avrebbe richiesto di sapere che c'era prima di poterlo cercare. -->
            <div class="rsub">{subject(part)}</div>
          {/if}
        </button>
        {#if revealPath}
          <button class="reveal" title="Reveal in file manager" aria-label="Reveal in file manager"
            onclick={() => void store.reveal(revealPath)}>
            <Icon name="i-reveal" />
          </button>
        {/if}
      </div>
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
        <FileBlock edits={[edit]} narrow={store.narrow} {store} />
      {/each}
    {/if}
  {/snippet}

  <div class="scroller conv" bind:this={scrollerEl} onscroll={onScroll}>
    {#each chapters as ch (ch.key)}
    {#if ch.clearedAt !== undefined}
      <!-- La riga che tiene chiuso tutto ciò che c'era prima del `/clear`. Ha le due
           stanghette della compattazione perché è lo stesso genere di fatto — un
           taglio nel flusso, non un blocco dentro il flusso — ma qui si apre, e
           quello che c'è sotto sono turni interi, non una nota. -->
      <button class="cleared" class:open={openedChapters.has(ch.key)}
        onclick={() => toggleChapter(ch.key)}
        title="The context was reset here: nothing above is still in the model's memory">
        <span class="l"></span>
        <span class="t">
          <span class="cx">{openedChapters.has(ch.key) ? '▾' : '▸'}</span>
          Context cleared · {chapterTurns(ch)} {chapterTurns(ch) === 1 ? 'turn' : 'turns'} before
          · {hhmm(ch.clearedAt)}
        </span>
        <span class="l"></span>
      </button>
    {/if}
    {#if ch.clearedAt === undefined || openedChapters.has(ch.key)}
    <!-- Riaperto, il capitolo resta **riconoscibile come passato**: rientrato e con una
         riga di lato. Senza, quei turni tornerebbero identici a quelli veri, e sarebbe
         di nuovo impossibile vedere a occhio dove il contesto smette di valere — che è
         il motivo per cui esiste tutto questo. -->
    <div class="chapter" class:past={ch.clearedAt !== undefined}>
    {#each ch.items as { turn, i } (turn.turnId)}
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
                  <!-- L'onclick qui sotto è delegazione, non un div-bottone: il div
                       resta testo normale, leggibile come sempre. Il click che
                       intercetta è dei `<button data-copy>` che `renderMarkdown`
                       disegna dentro — un bottone vero, già raggiungibile da tastiera,
                       il cui click nativo (anche quello sintetizzato da Invio/Spazio)
                       risale fin qui da solo. Un secondo handler qui sopra
                       aggiungerebbe rumore, non accessibilità. -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- L'evidenza ambra va sul PARAGRAFO che contiene la domanda,
                       non su tutto il blocco (bug B1): `renderMarkdown` la mette
                       sull'ultimo elemento del testo reso, non sul contenitore. -->
                  <div class="prose"
                    onclick={onProseClick}>{@html renderMarkdown(part.text, { asked: isOpenQuestion(i, part) })}</div>

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
                  {#if part.items && part.items.length > 0}
                    <!-- Le domande erano più d'una, ed erano domande diverse: una riga
                         sola con le risposte incollate da `·` costringeva a indovinare
                         quale stesse a quale. Qui ogni domanda si porta dietro la
                         propria risposta, nell'ordine in cui sono state lette. -->
                    <div class="answers">
                      <div class="ah">
                        <Icon name="i-ask" />
                        <span class="k">You answered</span>
                        {#if part.items.length > 1}
                          <span class="end">{part.items.length} questions</span>
                        {/if}
                      </div>
                      {#each part.items as it, n (it.asked)}
                        <div class="aq">
                          <span class="n">{n + 1}</span>
                          <span class="q" title={it.asked}>{it.asked}</span>
                          <!-- Una domanda saltata non inventa un trattino: dice che
                               non è stata risposta, che è un fatto diverso. -->
                          <span class="a">{it.answer || 'left unanswered'}</span>
                        </div>
                      {/each}
                    </div>
                  {:else}
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
    </div>
    {/if}
    {/each}

    {#if snap.turns.length === 0}
      <div class="mid">Nothing has happened in this chat yet. Write the first message below.</div>
    {/if}
  </div>

  <!-- La via di ritorno al fondo, quando si è risaliti a leggere.
       Compare **solo** quando la conversazione ha smesso di seguire, cioè quando ce n'è
       bisogno: un bottone che c'è sempre non direbbe niente, e qui il fatto che appaia è
       già l'informazione — «da qui in giù c'è roba che non stai vedendo».
       Sta fuori dallo scroller, in un contenitore alto **zero** appoggiato sopra il
       blocco di scrittura: così galleggia sulla conversazione senza rubarle spazio e
       senza che nessuno debba sapere quanto è alto il blocco sotto, che cambia con la
       casella, gli allegati e i comandi slash. -->
  <div class="tofoot">
    {#if !stick}
      <button class="downb" onclick={toFoot}
        title="Jump to the newest" aria-label="Jump to the newest">
        <Icon name="i-down" />
      </button>
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
  /* `.v` è monospace di default perché di solito porta un comando o un percorso —
     codice. La motivazione (F2) è una frase, non codice: qui riprende il font della
     UI, altrimenti «Look for the quota panel» si legge come un identificatore. */
  .row .v.plain { font-family: var(--sans); color: var(--ink-2); }
  /* La riga di un tool era un `<button class="row">` flex diretto; ora il flex sta
     su `.rtop` dentro di lui, per poter aggiungere sotto — solo quando c'è una
     motivazione (F2) — una seconda riga più piccola col comando esatto. Senza
     motivazione `.rtop` è tutto ciò che il bottone contiene: identica a prima.
     Scoperto su `.tool`, non su `.row.clickable` in generale: il reasoning e il
     gruppo «N operations» sono anche loro `.row.clickable`, ma restano un flex
     diretto — non hanno `.rtop`, e diventare un blocco li spezzerebbe su due righe
     senza motivo. */
  .row.clickable.tool { display: block; }
  .row.clickable.tool .rtop { display: flex; align-items: center; gap: 7px; }
  .row.clickable.tool .rsub {
    margin: 2px 0 0 21px; font-family: var(--mono); font-size: 9px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* F3: il bottone che arriva al file, attaccato alla riga del tool. `.oprow` senza
     `.withreveal` non cambia niente — è il caso normale, senza percorso da rivelare
     — quindi non tocca il disegno di ogni altra riga. */
  .oprow.withreveal { display: flex; align-items: stretch; border-radius: 7px; overflow: hidden; }
  .oprow.withreveal .row { border-radius: 0; }
  .oprow .reveal {
    flex: none; border: 0; border-left: 1px solid var(--line-2);
    background: var(--surface-2); color: var(--muted); padding: 0 9px; cursor: pointer;
  }
  .oprow .reveal:hover { color: var(--ink); background: var(--surface-3); }
  .oprow .reveal:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

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
     altro «tocca a te». Sul **paragrafo finale**, non su tutto il blocco (bug B1) —
     `markAsked` in `markdown.ts` marca l'ultimo elemento reso, qualunque tag sia; i
     margini di quel tag sono già `0` in alto (vedi le regole sopra), quindi non
     serve toglierne uno che non c'è. */
  .prose :global(.asked) {
    background: var(--wait-bg); color: var(--ink);
    border: 1px solid var(--wait); border-radius: 8px; padding: 8px 10px; font-weight: 600;
  }

  /* La riga della compattazione: un taglio, non un blocco. */
  .compact { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
  .compact .l { flex: 1; height: 1px; background: var(--line-2); }
  .compact .t { font-size: 9.5px; color: var(--muted); white-space: nowrap; }

  /* Il capitolo chiuso da un `/clear`. Stessa grammatica della compattazione — due
     stanghette e il fatto in mezzo — ma è un bottone: quello che tiene chiuso non è
     una nota, sono turni interi, e vanno poter riaperti. Più marcato della riga di
     compattazione (stanghette continue, testo non spento) perché il taglio è più
     netto: lì resta un riassunto, qui non resta niente. */
  .cleared {
    display: flex; align-items: center; gap: 8px; width: 100%;
    margin: 14px 0; padding: 0; background: none; border: 0; cursor: pointer;
    font: inherit; color: inherit;
  }
  .cleared .l { flex: 1; height: 1px; background: var(--line-2); }
  .cleared .t {
    font-size: 10.5px; color: var(--muted); white-space: nowrap;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .cleared .cx { font-size: 9px; opacity: .7; }
  .cleared:hover .t { color: var(--ink); }
  .cleared:hover .l { background: var(--muted); }
  /* Aperto, il capitolo è un contenitore: la riga diventa la sua intestazione e i
     turni che seguono sono suoi, quindi il margine sotto si stringe. */
  .cleared.open { margin-bottom: 6px; }

  /* `.conv` è una colonna flex con `gap: 8px`: il capitolo la interrompe, quindi se la
     rifà uguale dentro di sé — senza, i turni si incollerebbero fra loro. */
  /* Alto zero e `flex:none`: in una colonna flex non occupa una riga propria, quindi
     non sposta di un pixel né la conversazione né il blocco di scrittura. È solo il
     riferimento da cui il bottone si stacca verso l'alto. */
  .tofoot { position: relative; height: 0; flex: none; z-index: 4; }
  .downb {
    position: absolute; right: 16px; bottom: 10px;
    width: 30px; height: 30px; border-radius: 50%;
    display: grid; place-items: center; cursor: pointer;
    background: var(--surface); color: var(--ink-2);
    border: 1px solid var(--line-2);
    /* L'ombra non è decorazione: il bottone sta **sopra** del testo, e senza uno stacco
       si leggerebbe come parte della conversazione invece che come un comando. */
    box-shadow: 0 4px 14px rgba(16, 20, 32, .18);
  }
  .downb:hover { color: var(--ink); background: var(--surface-2); }
  .downb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .chapter { display: flex; flex-direction: column; gap: 8px; flex: none; }
  .chapter.past {
    padding-left: 12px; border-left: 2px solid var(--line);
    margin-left: 2px; opacity: .72;
  }
  .chapter.past:hover { opacity: 1; }

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
  /* Ogni `<pre>` che Markdown produce esce da `renderMarkdown` già avvolto in un
     `.codeblock` con sopra la barra del bottone «Copy» — vedi `markdown.ts`. Il
     margine che separava un blocco di codice dal successivo sta ora sul contenitore,
     non più sul `<pre>`, altrimenti si duplicherebbe con quello della barra. */
  .prose :global(.codeblock) { margin: 0 0 8px; }
  .prose :global(.cbbar) {
    display: flex; background: var(--surface-2);
    border: 1px solid var(--line-2); border-bottom: 0; border-radius: 7px 7px 0 0;
    padding: 3px;
  }
  /* In alto a sinistra, sempre visibile: è il pezzo di risposta che si copia più
     spesso, e un bottone che si scopre solo al passaggio del mouse costa un
     movimento in più proprio dove si vuole essere veloci. */
  .prose :global(.copybtn) {
    display: inline-flex; align-items: center; gap: 4px;
    font: inherit; font-size: 9.5px; color: var(--muted);
    background: none; border: 0; border-radius: 5px; padding: 3px 7px; cursor: pointer;
  }
  .prose :global(.copybtn svg.ic) { width: 11px; height: 11px; }
  .prose :global(.copybtn:hover) { background: var(--surface-3); color: var(--ink); }
  .prose :global(.copybtn:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
  .prose :global(.copybtn.done) { color: var(--done); }

  /* F1: il bottone accanto a un link riconosciuto. Inline come il link stesso — non
     va a capo da solo, segue il testo — perché è una seconda via per la stessa
     frase, non un blocco a parte come il codice. */
  .prose :global(.applink) {
    display: inline-flex; align-items: center; gap: 3px; vertical-align: middle;
    font: inherit; font-size: 9.5px; color: var(--accent);
    background: var(--accent-soft); border: 0; border-radius: 5px;
    padding: 2px 6px; margin-left: 4px; cursor: pointer;
  }
  .prose :global(.applink svg.ic) { width: 10px; height: 10px; }
  .prose :global(.applink:hover) { filter: brightness(0.94); }
  .prose :global(.applink:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
  .prose :global(pre) {
    font-family: var(--mono); font-size: 10.5px; background: var(--surface);
    border: 1px solid var(--line-2); border-radius: 0 0 7px 7px; padding: 8px 10px;
    margin: 0; overflow: auto; white-space: pre;
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
  /* Stesso blu-azzurro del blocco del prompt e di `.answers` in app.css: una
     domanda sola è la stessa categoria di cosa — l'utente che risponde —
     solo con un'unica riga invece del blocco a elenco. */
  .row.answer { background: var(--user-bg); }
  .row.answer .k { color: var(--user); }
  .row.answer .end { color: var(--ink-2); font-weight: 600; }
  .row.answer .end.no { color: var(--wait); }
</style>
