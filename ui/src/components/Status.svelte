<script lang="ts">
  // La barra sotto la casella di scrittura.
  //
  // Le tre cose che si cambiano *mentre* si lavora stanno qui e non in una schermata
  // di opzioni, perché è l'unico posto che si ha sotto gli occhi mentre si scrive il
  // primo messaggio — che è esattamente il momento in cui ci si accorge di volerle
  // diverse. Modello e modalità cambiano a caldo: nessun «riavvia per applicare».
  //
  // Le voci che non si possono usare restano in elenco, spente, **con scritto chi le
  // rifiuta** (Principio 5). Nasconderle farebbe sembrare STARK meno capace del CLI.
  import Icon from './Icon.svelte'
  import ModelPicker from './ModelPicker.svelte'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import type { SessionSnapshot } from '$core/reduce.ts'
  import type { QuotaWindow, SessionOption } from '$core/events.ts'
  import { optionsFrom } from '$core/adapter.ts'
  import { MODE_BLURB, MODE_ICON, project, since, stamp, tilde, until } from '../lib/view.ts'
  import type { GitInfo } from '../lib/api.ts'
  import type { Store } from '../lib/store.svelte.ts'

  // `live` per pannello, non `live`: vedi Dock.svelte.
  let { store, snap, live }: { store: Store; snap: SessionSnapshot; live: boolean } = $props()

  // Era un elenco chiuso di tre. Ora e' l'`id` del selettore aperto, e la UI non sa
  // quali esistano: li dichiara l'agent (ADR-014).
  let open = $state<string | null>(null)
  let bar = $state<HTMLElement | null>(null)

  /**
   * Su quale ramo sta la cartella. Non è nel journal e non ha un evento canonico: è un
   * fatto del **filesystem**, e chi fa `git checkout` in un terminale accanto non manda
   * niente a STARK. Quindi si chiede, invece di ricordarlo.
   *
   * Si richiede quando cambia la cartella e a ogni **confine di turno** — gli stessi due
   * momenti in cui STARK chiede già quota e contesto. Non è un orologio: leggere
   * `snap.state` qui dentro fa ripartire l'effetto solo quando la sessione entra o esce
   * dal lavoro, e su una chat ferma non parte più niente. È anche il momento giusto:
   * se il ramo è cambiato, a cambiarlo è stato quasi sempre il turno appena finito.
   */
  let git = $state<GitInfo | null>(null)
  /** Per quale cartella si è già chiesto. Non è `$state`: serve a **ricordare**, non a
   *  ridisegnare — e leggere `git` qui dentro creerebbe un anello, perché è l'effetto
   *  stesso a scriverlo. */
  let chiesto = ''
  $effect(() => {
    const cwd = snap.cwd
    // Letto **prima** di qualunque `await`, se no la dipendenza non verrebbe registrata
    // e l'effetto non ripartirebbe al confine del turno.
    const lavora = snap.state === 'busy' || snap.state === 'starting'
    if (!cwd) { git = null; chiesto = ''; return }
    // Un turno ne muove **due**, di confini: quando comincia e quando finisce. Chiedere
    // su entrambi raddoppierebbe le richieste per sapere due volte la stessa cosa — se
    // il ramo è cambiato, a cambiarlo è stato il turno, quindi la risposta che conta è
    // quella dopo. Su una cartella di cui non si sa ancora niente si chiede lo stesso:
    // una chat aperta **mentre** lavora resterebbe senza ramo fino a fine turno.
    if (lavora && chiesto === cwd) return
    chiesto = cwd
    let vivo = true
    void store.api.git(cwd).then(g => { if (vivo) git = g })
    return () => { vivo = false }
  })


  /**
   * I selettori da disegnare (ADR-014).
   *
   * Su un journal scritto prima, `options` è vuoto e ci sono ancora `mode`/`modes` e
   * `model`/`models`: si ricostruiscono con **la stessa funzione** che usano gli
   * adapter, invece di tenere qui un secondo modo di comporli. Una conversazione
   * vecchia si disegna quindi con lo stesso codice di una nuova.
   */
  const opts = $derived<SessionOption[]>(
    snap.options.length > 0
      ? snap.options
      : optionsFrom({ mode: snap.mode, modes: snap.modes, model: snap.model, models: snap.models }),
  )
  const sinistra = $derived(opts.filter(o => o.kind !== 'model'))
  const destra = $derived(opts.filter(o => o.kind === 'model'))

  /** Si può cambiare adesso? La capability è dell'agent, `live` è dello stato. */
  function modificabile(o: SessionOption): boolean {
    if (!live) return false
    if (o.kind === 'mode') return snap.capabilities?.switchMode !== false
    if (o.kind === 'model') return snap.capabilities?.switchModel !== false
    return true
  }
  /** Come si chiama una scelta: l'etichetta dell'agent, o il valore nudo. */
  const nome = (v: string, l?: string): string => l ?? v

  // Il chip dice quanti ne hai accesi, non quanti ne esistono: è la cosa che cambia
  // cosa succede al prossimo turno.
  const mcpLabel = $derived.by(() => {
    const on = snap.mcpServers.filter(s => s.enabled).length
    return on === 0 ? 'none' : String(on)
  })

  /**
   * Cosa dice la riga di un server. Gli stati sono quelli del protocollo e si mostrano
   * come sono: `needs-auth` non è un errore di STARK e non si nasconde — si dice cosa
   * fare, che è una cosa che si fa dal terminale e non da qui.
   */
  function mcpBlurb(s: SessionSnapshot['mcpServers'][number]): string {
    if (!s.enabled) return 'off for this chat'
    switch (s.status) {
      case 'connected': return 'connected'
      case 'pending': return 'connects the first time it is used'
      case 'needs-auth': return `needs a login: run \`claude mcp login ${s.name}\` in a terminal`
      case 'failed': return s.error ? `failed: ${s.error}` : 'failed'
      default: return s.status
    }
  }

  // `usage.updated` arriva a fine turno dal vivo, ma un trascritto importato non ce
  // l'ha: là i token stanno solo nei singoli turni. Sommarli è l'unica misura onesta
  // di quanto è costata la conversazione, e senza questo ripiego una chat importata
  // direbbe «0 tokens» su quattrocento blocchi.
  const usage = $derived.by(() => {
    const u = snap.usage
    if (u.input + u.output + u.cacheRead + u.cacheWrite > 0) return u
    const somma = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const t of snap.turns) {
      if (!t.usage) continue
      somma.input += t.usage.input; somma.output += t.usage.output
      somma.cacheRead += t.usage.cacheRead; somma.cacheWrite += t.usage.cacheWrite
    }
    return somma
  })
  const total = $derived(usage.input + usage.output + usage.cacheRead + usage.cacheWrite)

  /**
   * Quanto è piena la finestra **adesso**, non quanto è costata la conversazione
   * finora: sono due domande diverse, e `usage`/`total` qui sopra rispondono alla
   * seconda. Questa guarda solo l'ultima lettura — l'ultimo turno vero, o quella
   * cumulativa se `usage.updated` non è ancora arrivato dal vivo — perché un turno
   * nuovo non si porta dietro i token del turno prima se non sono rientrati nel
   * prompt di adesso.
   */
  const now = $derived.by(() => {
    const u = snap.usage
    if (u.input + u.output + u.cacheRead + u.cacheWrite > 0) return u
    for (let i = snap.turns.length - 1; i >= 0; i--) {
      const tu = snap.turns[i]?.usage
      if (tu) return tu
    }
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  })
  const nowTotal = $derived(now.input + now.output + now.cacheRead + now.cacheWrite)

  /**
   * Quanto è piena la finestra, secondo Claude Code stesso — non un conto di STARK.
   *
   * Bug trovato il 26 agosto 2026: il vecchio calcolo divideva `nowTotal` per una
   * finestra **indovinata dal nome del modello** (`contextWindowFor`), e quel nome
   * poteva arrivare con un suffisso che il confronto testuale non riconosceva
   * (`claude-opus-5[1m]`): la finestra sembrava 200K invece di un milione, e un
   * contesto vero al 21% appariva 100%. La correzione non è un conto più furbo — è
   * chiedere a `getContextUsage()`, la stessa domanda a cui risponde `/context` nel
   * terminale, invece di ricostruirla da soli.
   *
   * `snap.contextUsage` arriva quando STARK lo chiede (avvio, fine turno, apertura
   * del pannellino — vedi `refreshContext` nell'adapter). Finché non è ancora
   * arrivato — la primissima frazione di secondo, o un journal scritto prima che
   * STARK sapesse fare questa domanda — si ripiega sul vecchio conto approssimato,
   * che è meglio di niente ma non va scambiato per quello vero.
   */
  const ctx = $derived(snap.contextUsage)
  const contextWindow = $derived(
    ctx?.maxTokens
    ?? snap.models.find(m => m.id === snap.model || m.resolved === snap.model)?.contextWindow,
  )
  const pct = $derived(
    ctx ? Math.min(100, Math.round(ctx.percentage))
      : contextWindow ? Math.min(100, Math.round((nowTotal / contextWindow) * 100))
      : null,
  )
  /** Quando manca `ctx` si mostra il totale grezzo di sempre; quando c'è, il totale
   *  vero che Claude Code riporta — non necessariamente uguale, e quello vero vince. */
  const totalNow = $derived(ctx?.totalTokens ?? nowTotal)

  const PALETTE = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)', 'var(--p6)', 'var(--p7)']

  /**
   * I blocchi della barra. Con `ctx` sono le categorie **vere** di Claude Code —
   * prompt di sistema, tool, MCP, memoria, messaggi, riserva di auto-compattazione —
   * non più `input`/`output`/`cache*`, che raccontano una fattura API, non uno
   * spazio occupato. «Free space» non è un blocco: è il resto della barra che gli
   * altri blocchi non riempiono, e disegnarlo lo farebbe sembrare «pieno» sempre.
   * Senza `ctx` si ripiega sui quattro blocchi di sempre.
   */
  const segments = $derived.by(() => {
    if (ctx) {
      if (!ctx.maxTokens) return []
      const of = (n: number): number => (n / ctx.maxTokens) * 100
      return ctx.categories
        .filter(c => c.name !== 'Free space' && c.tokens > 0)
        .map((c, i) => ({ label: c.name, n: c.tokens, pct: of(c.tokens), colour: PALETTE[i % PALETTE.length]! }))
    }
    if (!contextWindow) return []
    const of = (n: number): number => (n / contextWindow) * 100
    return [
      { label: 'input', n: now.input, pct: of(now.input), colour: 'var(--accent)' },
      { label: 'output', n: now.output, pct: of(now.output), colour: 'var(--p4)' },
      { label: 'cache read', n: now.cacheRead, pct: of(now.cacheRead), colour: 'var(--done)' },
      { label: 'cache write', n: now.cacheWrite, pct: of(now.cacheWrite), colour: 'var(--wait)' },
    ].filter(s => s.n > 0)
  })

  // ─── quanto ne resta del piano ────────────────────────────────────────────
  //
  // Tre voci, e sono tre domande diverse: quanto contesto ha in mano *questa* chat,
  // quanto hai consumato della finestra corta (5 ore), quanto della settimana. Le
  // ultime due non sono della conversazione ma del piano — le consumano anche le altre
  // chat e l'altra macchina — ed è per questo che si rileggono invece di sommarle qui.
  const sessionWin = $derived(snap.quotaWindows.find(w => w.kind === 'session'))
  const weeklyWin = $derived(snap.quotaWindows.find(w => w.kind === 'weekly' && !w.scope))
  const weeklyScoped = $derived(snap.quotaWindows.filter(w => w.kind === 'weekly' && w.scope))

  // Il conto alla rovescia si muove da solo, al minuto: mostrarlo fermo mentre la
  // finestra si avvicina sarebbe peggio che non mostrarlo. Mezzo minuto di passo basta
  // — sotto il minuto quel numero non cambia comunque.
  // Si chiama `clock` e non `now` perché `now` qui sopra è già preso, e vuol dire
  // un'altra cosa: l'ultima lettura dei token. Due `now` nello stesso file sarebbero
  // due trappole.
  let clock = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => { clock = Date.now() }, 30_000)
    return () => clearInterval(t)
  })

  /** Da quanto è vecchia la misura. Se ha più di due minuti si dice, perché nel
   *  frattempo la quota la consumano anche gli altri e nessuno ce lo viene a dire. */
  const stale = $derived(
    snap.quotaWindowsAt && clock - snap.quotaWindowsAt > 120_000 ? snap.quotaWindowsAt : null,
  )

  // Si rilegge quando l'utente apre il pannellino: è l'unico momento in cui quel numero
  // deve essere fresco. Non più di una volta ogni quindici secondi — aprire e chiudere
  // due volte non è una richiesta nuova.
  let ultimaLettura = 0
  function peek(): void {
    const t = Date.now()
    if (t - ultimaLettura < 15_000) return
    ultimaLettura = t
    void store.refreshQuota()
    void store.refreshContext()
  }

  /** Verde finché c'è margine, ambra quando ne resta poco, rosso quando è quasi finita.
   *  Le soglie sono di lettura, non del piano: il piano dice solo la percentuale. */
  const meterColour = (used: number): string =>
    used >= 90 ? 'var(--stop)' : used >= 75 ? 'var(--wait)' : 'var(--accent)'

  /**
   * Il semaforo di `quota.updated`, che è un'altra cosa dal livello: dice se l'ultima
   * richiesta è passata. Si mostra **solo quando non è «allowed»** — un avviso che c'è
   * sempre non è un avviso — e si appoggia alla finestra a cui si riferisce.
   */
  function alarm(kind: 'session' | 'weekly'): string | null {
    const q = snap.quota
    if (!q || q.status === 'allowed') return null
    const sua = q.kind === 'five_hour' ? 'session' : 'weekly'
    if (sua !== kind) return null
    return q.status === 'rejected' ? 'limit reached' : 'close to the limit'
  }

  const fmt = (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

  /** `mcp` non e' un selettore: e' l'unica voce della barra che la UI conosce per
   *  nome, perche' accende piu' cose insieme invece di sceglierne una. */
  function choose(what: string): void {
    open = open === what ? null : what
    // Il catalogo si chiede aprendo, non prima: la barra si disegna su ogni chat e su
    // ogni pannello, e chiederlo all'avvio vorrebbe dire pagarlo anche a chi il menu
    // non lo apre mai. Costa comunque zero dopo la prima volta — il daemon lo tiene, e
    // lo scalda da solo all'accensione.
    if (open) void store.caricaCatalogo()
    if (!open) { conferma = null; store.handoff = null }
  }

  // ─── passare a un altro agent ─────────────────────────────────────────────
  //
  // Dentro lo stesso agent cambiare modello e' un parametro. Fra due agent non lo e':
  // la conversazione vive dentro il CLI (ADR-009), quindi si scrive un passaggio di
  // consegne e se ne apre un'altra. La tendina e' la stessa, l'esito no — e per questo
  // la seconda strada passa da una conferma che dice il costo prima di pagarlo.
  let conferma = $state<{ agent: string; model: string; label: string } | null>(null)

  function scegliModello(optId: string, agent: string, model: string): void {
    if (agent === snap.agent) {
      open = null
      conferma = null
      void store.setOption(optId, model)
      return
    }
    conferma = { agent, model, label: model.split('/').pop() ?? model }
  }

  async function passa(via: 'agent' | 'journal'): Promise<void> {
    const scelta = conferma ?? (store.handoff?.fase === 'chiede' ? store.handoff : null)
    if (!scelta) return
    await store.passaAdAltroAgent(scelta.agent, scelta.model, via)
    // Andata: il pannello mostra gia' la chat nuova, e questa tendina appartiene alla
    // vecchia. Se invece e' rimasto uno stato (`chiede`, `fallito`), il menu resta
    // aperto apposta, perche' e' li' che c'e' la domanda o il motivo.
    if (store.handoff === null) { conferma = null; open = null }
  }
</script>

<svelte:window onpointerdown={e => {
  if (open && bar && !bar.contains(e.target as Node)) open = null
}} />
<svelte:document onkeydown={e => { if (e.key === 'Escape') open = null }} />

<div class="status" bind:this={bar}>
  <div class="l">
    <!-- I selettori che l'agent dichiara (ADR-014). La barra non sa quali siano:
         disegna quelli che le arrivano. Prima qui c'era un chip per la modalità, con le
         sei parole di Claude Code scritte nel browser. -->
    {#each sinistra as o (o.id)}
      <span class="pop">
        <!-- `aria-label` non è un di più: sotto la soglia stretta l'etichetta sparisce e
             le icone sono `aria-hidden`, quindi senza questo il bottone resterebbe **senza
             nome** per chi legge a voce — cioè premibile e muto. Il `title` da solo farebbe
             da nome, ma direbbe «Permissions» invece di quale valore è attivo. -->
        <button class="tune" disabled={!modificabile(o)} onclick={() => choose(o.id)}
          aria-label="{o.label}: {o.value}"
          title={modificabile(o) ? o.label : 'This chat has no process behind it right now'}>
          {#if o.kind === 'mode'}
            <Icon name={MODE_ICON[o.value] ?? 'i-shield'} style="color:var(--accent)" />
          {/if}
          <span class="lbl">{o.value}</span>
          {#if o.choices.length > 1}<Icon name="i-down" />{/if}
        </button>
        {#if open === o.id}
          <div class="menu">
            {#each o.choices as c (c.value)}
              <button class="mi" class:on={c.value === o.value} class:dis={!c.available}
                disabled={!c.available}
                onclick={() => { open = null; void store.setOption(o.id, c.value) }}>
                {#if o.kind === 'mode'}
                  <Icon name={MODE_ICON[c.value] ?? 'i-shield'}
                    style={c.value === o.value ? 'color:var(--accent)' : ''} />
                {/if}
                <!-- La descrizione viene dall'agent quando ce l'ha (`note`), e solo in
                     mancanza dalle frasi che la UI conosce. `reason` è un'altra cosa:
                     dice perché una voce è **spenta**, e quando c'è viene prima.
                     `MODE_BLURB` resta come ripiego per i journal scritti prima di
                     ADR-014, che non portano nessuna descrizione — non come verità su
                     un agent che non l'ha dichiarata. -->
                <span>{nome(c.value, c.label)}<span class="sub"
                  >{c.reason ?? c.note ?? MODE_BLURB[c.value] ?? ''}</span></span>
                {#if !c.available}<span class="tag">unavailable</span>
                {:else if c.value === o.value}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
              </button>
            {/each}
          </div>
        {/if}
      </span>
    {/each}

    <span class="pop">
      <!-- Gli strumenti esterni si accendono per chat, e di partenza sono spenti: una
           conversazione che ereditasse tutti i server della macchina costerebbe circa
           5× di contesto per turno, cioè quota, e aprirebbe una via d'uscita ai dati
           che nessuno ha chiesto. Spenti è il default, non il limite: qui si accendono. -->
      <button class="tune" onclick={() => choose('mcp')} disabled={!live}
        title={live ? 'External tool servers, for this chat'
          : 'Wake this chat to change its tool servers'}>
        <span style="color:var(--muted)">MCP</span>{mcpLabel}<Icon name="i-down" />
      </button>
      {#if open === 'mcp'}
        <!-- I 290px sono per lo schermo largo: sotto la soglia stretta `.menu` prende
             la larghezza fissa data da CSS (§8), e uno stile inline la scavalcherebbe
             comunque — inline vince sempre su un foglio esterno, media query o no. -->
        <div class="menu" style={store.narrow ? '' : 'width:290px'}>
          {#each snap.mcpServers as s (s.name)}
            <!-- Il menu **non** si chiude accendendo: accenderne due è il caso normale, e
                 richiuderlo a ogni tocco costringerebbe a riaprirlo per la seconda. Si
                 chiude col clic fuori, come gli altri. -->
            <button class="mi" class:on={s.enabled}
              onclick={() => void store.setMcp(s.name, !s.enabled)}>
              <Icon name="i-plug" />
              <span>{s.name}<span class="sub">{mcpBlurb(s)}</span></span>
              {#if s.enabled}
                <Icon name="i-check" style="margin-left:auto;color:var(--accent)" />
              {/if}
            </button>
          {/each}
          {#if snap.mcpServers.length === 0}
            <div class="mi dis">
              <Icon name="i-plug" />
              <!-- Non è un guasto: questa cartella non ne ha, o la chat è nata prima
                   che STARK sapesse chiederglielo. Dirlo è meglio di un elenco vuoto. -->
              <span>no servers here<span class="sub">Nothing configured for this folder.
                `claude mcp add` in a terminal, then wake this chat.</span></span>
            </div>
          {/if}
        </div>
      {/if}
    </span>

    <!-- Il percorso è la voce che si toglie sotto la soglia stretta (chiesto
         dall'utente da telefono, 26 agosto 2026: «voglio solo modalità, mcp, modello
         e contesto»). Il nome del progetto resta comunque leggibile nell'intestazione
         della conversazione, sopra: qui sparisce il percorso per intero, non
         l'informazione di in quale cartella si è. -->
    <span class="cwd">
      <span class="sep">·</span>
      <Icon name="i-folder" style="flex:none" />
      <!-- Il **nome** della cartella, non il percorso: quello è lungo, tutto uguale nei
           primi due terzi fra un progetto e l'altro, e la parte che distingue è l'ultimo
           pezzo — cioè la sola che veniva mangiata dall'ellissi quando lo spazio
           stringeva. Il percorso intero resta a un passo, nel titolo. È la stessa parola
           che l'elenco a sinistra usa per il progetto (`project`), e sono la stessa cosa:
           averne due che si scrivono in modo diverso costringerebbe a tradurre fra le
           due colonne per capire che è la stessa chat. -->
      <span class="path" title={snap.cwd ?? ''}>{project(snap.cwd)}</span>
      <!-- Il ramo, quando la cartella è dentro un repo. Non compare mai «no branch»: là
           dove git non c'è, non c'è un fatto da riportare — sarebbe una riga in più su
           ogni chat per dire niente. Testa staccata: si mostra la sigla del commit, che
           è l'unica risposta vera alla domanda «dove sono». -->
      {#if git?.branch}
        <span class="branch"
          title={git.detached
            ? `Detached HEAD at ${git.branch}`
            : `On branch ${git.branch}`}>
          <Icon name="i-branch" style="flex:none" />
          <span class="bname">{git.branch}</span>
        </span>
      {/if}
    </span>
  </div>

  <div class="r">
    <!-- Il selettore del modello, che ha una presentazione sua: il valore e' l'unico
         della barra la cui lunghezza non si conosce in anticipo, quindi va troncato. -->
    {#each destra as o (o.id)}
      {@const iconUrl = getLobeIconUrl(o.value)}
      {@const scelta = o.choices.find(c => c.value === o.value)}
      <span class="pop">
        <button class="tune" disabled={!modificabile(o) || o.choices.length === 0}
          onclick={() => choose(o.id)}
          aria-label="{o.label}: {o.value}"
          title={o.choices.length === 0
            ? 'This chat was recorded before STARK carried the model list'
            : o.label}>
          {#if iconUrl}
            <img src={iconUrl} alt="" width="14" height="14" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy"
              onerror={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display='none' }} />
          {:else}
            <span class="mdot"></span>
          {/if}
          <span class="mname">{nome(o.value, scelta?.label) || '—'}</span>
          {#if o.choices.length > 0}<Icon name="i-down" />{/if}
        </button>
        {#if open === o.id}
          <!-- Larghezza dichiarata, come la tendina MCP: senza, `.menu` si adatta al
               contenuto e le righe vengono di larghezze diverse una dall'altra — con
               151 modelli dai nomi di lunghezza qualunque, un bordo destro che balla a
               ogni riga. Sotto la soglia stretta no: lì la tendina è già ancorata ai
               due bordi. -->
          <div class="menu" style={store.narrow ? '' : 'width:290px'}>
            {#if conferma}
              <!-- Il costo si dice **prima**, non dopo: questo clic apre un'altra
                   conversazione e spende un turno, e sono le due cose che chi sceglie un
                   modello da una tendina non si aspetta. -->
              <div class="pg">Switch to {conferma.label}?</div>
              <div class="pnote">
                <Icon name="i-warn" />
                {conferma.agent} can't continue this conversation: it lives inside
                {snap.agent}. STARK will ask the current model to write a handoff file in
                <code>.stark/</code> — that costs one turn — then open a new chat here, in
                this same panel. This one stays in the list.
              </div>
              <div class="hrow">
                <button class="mi" onclick={() => { conferma = null }}>Cancel</button>
                <button class="mi on" onclick={() => void passa('agent')}>Write handoff</button>
              </div>
            {:else if store.handoff?.fase === 'chiede'}
              <div class="pg">This chat is {store.handoff.state}</div>
              <div class="pnote">
                <Icon name="i-warn" />
                Only a live session can write its own handoff. Waking it costs a wake plus
                one turn; the journal version is free but says less — what happened, not
                what's left to do.
              </div>
              <div class="hrow">
                <button class="mi" onclick={() => void passa('journal')}>From journal (free)</button>
                <button class="mi on" onclick={() => void passa('agent')}>Wake and write</button>
              </div>
            {:else if store.handoff?.fase === 'corso'}
              <div class="pg">Handing off to {store.handoff.model}…</div>
              <div class="pnote">The current model is writing the handoff file. This is a
                real turn: it can take a while.</div>
            {:else if store.handoff?.fase === 'fallito'}
              <div class="pnote"><Icon name="i-warn" />{store.handoff.error}</div>
              <div class="hrow">
                <button class="mi" onclick={() => { store.handoff = null }}>Back</button>
              </div>
            {:else}
              <!-- Lo **stesso** picker dell'helper: stessa regola su quale voce risulti
                   selezionata, stesso raggruppamento per agent. Vedi ModelPicker. -->
              <ModelPicker catalogo={store.catalogo} corrente={o.value}
                agenteCorrente={snap.agent}
                nota={a => (a === snap.agent ? null : 'handoff')}
                onScegli={(agent, model) => scegliModello(o.id, agent, model)} />
            {/if}
          </div>
        {/if}
      </span>
    {/each}

    <span class="sep">·</span>

    <!-- Nessuna cifra in denaro, mai: l'abbonamento è a quota fissa, quindi i soldi
         non sono la risorsa che scarseggia. Si dice quanto lavoro è passato di qui e
         quando la finestra si riapre. -->
    <button class="ctx" type="button" onpointerenter={peek} onfocus={peek}>
      <span class="cprog" style="--pct:{pct ?? 0}" aria-hidden="true"></span>
      {#if pct !== null}{pct}%{:else}{fmt(total)} tokens{/if}
      <span class="tip">
        <div class="tr"><span>Context window</span>
          <b>{pct !== null ? `${pct}%` : '—'}</b></div>
        {#if contextWindow}
          <!-- Da telefono la scomposizione per categoria non si mostra: sono sei o sette
               voci con numeri piccoli, e su una colonna larga un dito diventano un muro
               proprio dentro il pannellino che dovrebbe dire **una** cosa. Resta il
               valore complessivo — la percentuale sopra e i token qui sotto — che è
               quello per cui il pannellino si apre. Su schermo largo le categorie
               restano: là lo spazio c'è, e sapere *cosa* riempie il contesto è la
               ragione per cui sono state messe (sono quelle vere di Claude Code, non un
               conto nostro). -->
          {#if !store.narrow}
            <div class="segbar">
              {#each segments as s (s.label)}
                <i style="width:{s.pct}%;background:{s.colour}" title="{s.label}: {fmt(s.n)}"></i>
              {/each}
            </div>
          {:else}
            <!-- Una barra sola, come quelle delle finestre del piano qui sotto: dice
                 quanto è pieno senza dire di cosa. -->
            <div class="meter"><i style="width:{Math.min(100, pct ?? 0)}%;background:var(--accent)"></i></div>
          {/if}
          <div class="tr">
            <!-- «Right now» quando la fonte è `getContextUsage()` (è una domanda fatta
                 apposta, non un residuo dell'ultimo turno); «last turn» nel ripiego
                 vecchio, dove è davvero solo l'ultima lettura passata di qui. -->
            <small>{fmt(totalNow)} of {fmt(contextWindow)} tokens
              {ctx ? '· right now' : '· last turn'}</small>
          </div>
          {#if !store.narrow}
            <div class="seglegend">
              {#each segments as s (s.label)}
                <span><i style="background:{s.colour}"></i>{s.label} {fmt(s.n)}</span>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="tr"><small>This chat predates the context-window field —
            showing raw tokens only.</small></div>
        {/if}
        <hr />

        <!-- 2. e 3.: non sono della conversazione, sono del **piano**. La quota la
             consumano anche le altre chat e l'altra macchina, quindi questi due numeri
             non si possono sommare qui: si chiedono, e si dice quando sono stati letti. -->
        {@render window_(sessionWin, 'Session · 5 hours', 'session', false)}
        <hr />
        {@render window_(weeklyWin, 'Weekly', 'weekly', false)}
        {#each weeklyScoped as w (w.scope)}
          {@render window_(w, `Weekly · ${w.scope}`, 'weekly', true)}
        {/each}

        {#if stale}
          <div class="tr"><small class="faint">read {since(stale, clock)} ago{
            live ? '' : ' — this chat has no process behind it now'}</small></div>
        {/if}
      </span>
    </button>
  </div>
</div>

<!--
  Una finestra del piano. Tre righe e non una: la percentuale è il numero, la barra è
  il colpo d'occhio, e il reset va detto **nei due formati** — «fra quanto» dice se
  conviene aspettare, «quando» dice se conviene rimandare a domani. Su un'attesa di
  giorni la prima da sola non basta a decidere.
-->
{#snippet window_(w: QuotaWindow | undefined, label: string, kind: 'session' | 'weekly',
  sub: boolean)}
  {#if w}
    {@const warn = sub ? null : alarm(kind)}
    <div class="tr" class:sub>
      <span>{label}{#if warn}<em class="alarm">{warn}</em>{/if}</span>
      <b>{w.used !== undefined ? `${w.used}%` : '—'}</b>
    </div>
    {#if w.used !== undefined}
      <div class="meter" class:sub>
        <i style="width:{Math.min(100, w.used)}%;background:{meterColour(w.used)}"></i>
      </div>
    {/if}
    {#if w.resetsAt}
      <div class="tr" class:sub>
        <small>resets in {until(clock, w.resetsAt)} · {stamp(w.resetsAt)}</small>
      </div>
    {/if}
  {:else}
    <div class="tr"><span>{label}</span><b>—</b></div>
    <!-- Non è un guasto e non è uno zero: è che nessuno l'ha ancora chiesto al piano,
         o il piano non lo dice (chiave API, Bedrock, Vertex). Dirlo è meglio di
         disegnare una barra vuota, che si leggerebbe come «non hai consumato niente». -->
    <div class="tr"><small>{live
      ? 'the plan has not reported this window yet'
      : 'wake this chat to read it — a sleeping chat has no one to ask'}</small></div>
  {/if}
{/snippet}

<style>
  /* Il chip si preme, quindi è un <button>: qui c'è solo ciò che serve a togliergli
     l'aspetto di pulsante senza togliergli il mestiere. */
  .tune { font: inherit; font-size: 10px; cursor: pointer; }
  .tune[disabled] { cursor: default; opacity: .6; }
  .tune:focus-visible, .ctx:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* Pill context con anello progresso — niente underline */
  button.ctx { font: inherit; font-size: 10px; cursor: default; }

  /* La barra segmentata: un blocco per ciascuna delle quattro voci che già
     esistevano come numeri qui sotto — non un dato nuovo, solo un modo di
     vederlo a colpo d'occhio invece di doverli sommare a mente. */
  .segbar {
    display: flex; height: 6px; border-radius: 3px; overflow: hidden;
    background: var(--surface-3); margin: 4px 0 6px;
  }
  .segbar i { display: block; height: 100%; }
  .seglegend {
    display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 9px;
    color: var(--muted); margin-bottom: 2px;
  }
  .seglegend span { display: inline-flex; align-items: center; gap: 4px; }
  .seglegend i {
    width: 7px; height: 7px; border-radius: 2px; display: inline-block; flex: none;
  }

  /* La barra di una finestra del piano. Stessa grammatica della segbar qui sopra —
     «pieno» vuol dire pieno della finestra — ma un blocco solo, perché una finestra
     è un numero solo e non ha parti da confrontare. */
  .meter {
    height: 6px; border-radius: 3px; overflow: hidden;
    background: var(--surface-3); margin: 3px 0 5px;
  }
  .meter i { display: block; height: 100%; }
  /* Le settimane per modello sono figlie di quella generale: rientrano, così chi
     guarda può saltarle in blocco quando gli interessa solo il totale. */
  .tr.sub { padding-left: 12px; }
  .meter.sub { margin-left: 12px; }
  /* Compare solo quando il piano ha detto di no, o quasi: un avviso sempre acceso
     smette di essere un avviso. */
  .alarm { font-style: normal; color: var(--stop); margin-left: 6px; }
  .faint { font-style: italic; }

  .pop { position: relative; display: inline-flex; }
  /* Le tendine si aprono verso l'alto: sotto non c'è niente, la barra è l'ultima riga. */
  /* Il tetto NON è una rifinitura per il telefono: è un'invariante — un menu non può
     essere più alto dello schermo. Fino ad oggi non si notava perché Claude Code offre
     otto modelli; OpenCode ne offre **61**, e senza questo le voci in fondo finiscono
     sopra il bordo superiore e non si possono premere (misurato: Playwright rifiuta il
     clic, «element is outside of the viewport»). È il secondo agent che fa emergere un
     difetto della UI, non dell'adapter. */
  .pop .menu {
    position: absolute; bottom: calc(100% + 7px); left: 0; z-index: 7;
    max-height: min(60vh, 420px); overflow-y: auto;
  }
  .r .pop .menu { left: auto; right: 0; }
  /* Misurato dal vivo a 390px: ancorarsi al PROPRIO bottone — stretto quanto la sua
     etichetta — funziona solo se il popup ci sta dentro allo spazio che resta da lì
     al bordo. Per «mode» (primo, `left:0`) resta dentro per un caso fortunato di
     posizione; per «MCP» (secondo `left:0`, ma largo 290px) sconfina di oltre 100px a
     destra; per «model» (`right:0` su un bottone stretto dentro `.r`) il bordo
     sinistro finisce fuori schermo di oltre 200px. Tre bottoni, tre posizioni, e
     nessuno dei tre ha davvero spazio per un pannello di 250-290px accanto a sé.
     Sotto la soglia stretta si esce dal flusso e ci si ancora allo stesso punto per
     tutti e tre — vicino al fondo, dove l'utente sta già guardando (è la stessa area
     in cui «mode» capitava già di funzionare bene) — invece che al bottone di turno. */
  /* Ancorate al **blocco in basso**, non al fondo della finestra.
     `position:fixed; bottom:12px` le apriva a filo dello schermo, cioè addosso ai
     bottoni che le avevano aperte e alla casella di scrittura: si sceglieva un server
     MCP senza più vedere quale chip lo stava mostrando, e la metà bassa della tendina
     copriva l'unica parte di schermo che serve tenere libera. Adesso la tendina finisce
     **dove comincia** il blocco (`bottom: 100%` di `.dock`, più 8px d'aria): sopra c'è
     la conversazione, che scorre ed è la cosa che si può coprire.
     Perché `static` sui due contenitori: `position:absolute` cerca il primo antenato
     posizionato, e `.pop` (relative, per l'ancoraggio su schermo largo) e `.status`
     (relative) lo intercetterebbero prima di `.dock`. Neutralizzarli qui li salta
     entrambi senza toccare il caso largo, che resta ancorato al proprio bottone. */
  @media (max-width: 860px) {
    .status { position: static; }
    .pop { position: static; }
    .pop .menu, .r .pop .menu {
      position: absolute; left: 12px; right: 12px; bottom: calc(100% + 8px); top: auto;
      width: auto; max-height: 60vh; overflow-y: auto;
    }
  }

  /* Il reset e gli stati di `.mi` stavano qui, e qui valevano solo per le righe scritte
     in questo file: `ModelPicker` disegna le stesse `.mi` e non le vedeva. Sono in
     app.css, accanto alla definizione della classe. */
</style>
