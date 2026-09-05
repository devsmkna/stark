<script lang="ts">
  // L'elenco compatto: è la navigazione, non una barra di navigazione.
  //
  // Raggruppato per progetto, in ordine alfabetico (o nell'ordine scelto a mano,
  // `store.order`): dentro ogni progetto le righe restano ordinate per stato prima
  // che per tempo, così chi ti aspetta sta sempre sopra chi dorme.
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import type { Match, SessionMatches, SessionRow } from '../lib/api.ts'
  import {
    ORDER, colours, group, hhmm, label, needsYou, project, projectName, stamp,
  } from '../lib/view.ts'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import { leafIds } from '../lib/layout.ts'
  import type { Vista } from '../lib/viste.svelte.ts'
  import { quandoRiparte, quotaFerma } from '$core/quota.ts'
  import { longpress, longPressAppenaFatto } from '../lib/longpress.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '../lib/store.svelte.ts'
  import { zoomRoot } from '../lib/zoom.ts'

  let { store }: { store: Store } = $props()

  // ─── la maniglia che allarga la barra ─────────────────────────────────────
  //
  // Stessa meccanica dei divisori fra pannelli affiancati (`Workspace.svelte`): la
  // maniglia **prende il puntatore**, invece di lasciare l'ascolto a un contenitore.
  // Senza cattura, uscire dalla striscia col tasto premuto — cosa che capita di
  // continuo, è larga cinque pixel — interromperebbe il trascinamento a metà.
  let trascinando = $state(false)

  function giuManiglia(e: PointerEvent): void {
    trascinando = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  /**
   * `clientX` è in **pixel veri della finestra**; la larghezza che scriviamo è un
   * valore dichiarato su un figlio del root, che `Sizer` può avere zoomato. Senza la
   * divisione, al 135% la barra insegue il puntatore a una volta e mezza la sua
   * distanza e non lo raggiunge mai. Vedi `lib/zoom.ts` — è la stessa correzione del
   * menu contestuale in App.svelte.
   */
  function muoviManiglia(e: PointerEvent): void {
    if (!trascinando) return
    // Il bordo sinistro della barra, non zero: con la barra a filo di finestra è la
    // stessa cosa, ma qui non ci si affida a una coincidenza di layout.
    const sinistra = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().left ?? 0
    store.setSidebarWidth((e.clientX - sinistra) / zoomRoot(), false)
  }

  function suManiglia(): void {
    if (!trascinando) return
    trascinando = false
    store.setSidebarWidth(store.sidebarWidth) // su disco solo qui, non a ogni pixel
  }

  /** Da tastiera, per chi il trascinamento non lo può fare: frecce di 16px alla volta,
   *  Home riporta al valore di partenza. */
  function tastoManiglia(e: KeyboardEvent): void {
    const passo = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
    if (passo === 0 && e.key !== 'Home') return
    e.preventDefault()
    store.setSidebarWidth(e.key === 'Home' ? SIDEBAR_DEFAULT : store.sidebarWidth + passo)
  }

  const palette = $derived(colours(store.rows, store.settings?.projects ?? {}))

  // ─── quota finita ─────────────────────────────────────────────────────────
  //
  // La quota è del **piano**, non della conversazione: quando finisce non si ferma la
  // chat su cui stavi, si fermano tutte quelle di quel profilo insieme. È l'unico
  // guasto di STARK che non appartiene a nessuna riga in particolare, e per questo
  // l'unico che ha diritto a una banda sopra l'elenco invece che a un segno dentro una
  // chat: entrare in una per scoprire perché si è fermata l'altra non è una risposta.
  //
  // `rejected` e non `allowed_warning`: l'avviso «ci sei quasi» sta già nel pannellino
  // della barra di stato, dove c'è anche quanto ne resta. Qui si dice solo ciò che
  // toglie la possibilità di lavorare, se no la banda diventa arredamento.
  /**
   * L'orologio che serve qui non batte: si sveglia **una volta**, al momento del
   * reset. Un limite scaduto letto da un journal vecchio mostrerebbe un allarme
   * finito, e senza niente che lo rilegga resterebbe lì — su chat ferme non arrivano
   * eventi, quindi l'elenco non si aggiorna da solo proprio nel caso che conta.
   */
  let adesso = $state(Date.now())

  // La regola sta in `core/quota.ts`, dove si prova senza mettere in scena una quota
  // esaurita in un browser: il caso al bordo (un limite già ripartito, letto da un
  // journal vecchio) si sbaglia leggendo, non guardando.
  const ferme = $derived(store.rows.filter(r => quotaFerma(r.quota, adesso)))

  /**
   * Il reset più lontano fra quelli che ci fermano: se la finestra da 5 ore e quella
   * settimanale sono finite insieme, ripartire dalla prima non serve a niente. Dire
   * l'ora più vicina sarebbe una promessa che non si mantiene.
   */
  const riparte = $derived(quandoRiparte(ferme.map(r => r.quota), adesso))
  // Solo l'ora esatta, niente «fra 2h 14m»: il conto alla rovescia richiederebbe un
  // orologio al secondo, che è precisamente quello che è stato tolto dall'elenco il 26
  // agosto perché era calcolo per niente. E delle due formulazioni è questa a decidere
  // — «conviene rimandare a domani?» si risponde con un orario, non con una durata.
  // Il pannellino della barra di stato continua a darle entrambe, dove lo spazio c'è.

  /**
   * Su quale profilo. Si dice **solo se la macchina ne usa più d'uno**: con un profilo
   * solo è rumore — sarebbe l'unica risposta possibile — mentre con due è la differenza
   * fra «è finita tutta» e «è finita quella di lavoro, quella personale va».
   */
  // Una sveglia sola, all'istante del reset più vicino fra quelli che ci fermano.
  // Non è un intervallo: scatta una volta, e se nel frattempo arriva un'altra chat
  // ferma l'effetto si rifà e la riprogramma.
  $effect(() => {
    const prossimo = Math.min(...store.rows
      .filter(r => quotaFerma(r.quota, adesso) && r.quota!.resetsAt > 0)
      .map(r => r.quota!.resetsAt))
    if (!Number.isFinite(prossimo)) return
    // `+1000`: svegliarsi all'istante esatto rischia di rileggere un orologio che non
    // è ancora passato oltre, e di non far scattare niente.
    const t = setTimeout(() => { adesso = Date.now() }, prossimo - adesso + 1000)
    return () => clearTimeout(t)
  })

  const profili = $derived.by(() => {
    const p = store.settings?.projects ?? {}
    const tutti = new Set(Object.values(p).map(x => x.profile).filter(Boolean))
    if (tutti.size < 2) return []
    const nostri = new Set(ferme.map(r => (r.cwd ? p[r.cwd]?.profile : undefined)).filter(Boolean))
    return [...nostri] as string[]
  })

  /** Una sezione dell'elenco: un progetto, con le sue righe. */
  type Blocco = {
    key: string
    proj: string
    cwd: string | undefined
    rows: SessionRow[]
  }

  /**
   * `since`, non `lastTs`: `lastTs` avanza a ogni evento, quindi due chat "in progress"
   * si scavalcherebbero di continuo — una scrive un token, sale sopra l'altra, che ne
   * scrive uno e risale sopra la prima. `since` cambia solo quando lo stato cambia (§1,
   * `stateSince`): resta fermo per tutta la durata del turno, e la più recente a essere
   * *iniziata* sta sopra. Quando una finisce per prima, cambia gruppo con un `since`
   * nuovo — è così che finisce in cima al suo, senza bisogno di un caso speciale per
   * «chi ha risposto per primo».
   */
  const recentiAll = $derived([...store.rows].sort((a, b) => b.since - a.since))
  // Filtro "Solo non lette" dal menu … — se attivo mostra solo ciò che ti aspetta.
  // Dichiarato qui, prima del `$derived` che lo legge: uno stato dichiarato sotto la
  // riga che lo usa è un errore a runtime ("used before declaration"), non solo una
  // seccatura del typecheck.
  let soloNonLette = $state(false)
  const recenti = $derived(soloNonLette ? recentiAll.filter(r => needsYou(r.state)) : recentiAll)

  /** Le righe di una lista, raccolte per progetto, nell'ordine scelto dall'utente
   *  (`store.order`); chi non è stato riordinato resta in coda, alfabetico. */
  function perProgetto(righe: SessionRow[]): [string, SessionRow[]][] {
    const m = new Map<string, SessionRow[]>()
    for (const r of righe) {
      const p = project(r.cwd)
      const list = m.get(p)
      if (list) list.push(r); else m.set(p, [r])
    }
    return store.order.sort([...m.keys()]).map(name => [name, m.get(name)!])
  }

  const tree = $derived.by<Blocco[]>(() => {
    // Dentro un progetto le chat restano ordinate per stato **prima** che per tempo:
    // senza, una che dorme capiterebbe sopra una che ti sta aspettando. `ORDER` è lo
    // stesso elenco che dava l'ordine alle sezioni quando esisteva il raggruppamento
    // per stato — la convinzione «prima chi aspetta te» è una sola, e sta in un
    // posto solo.
    const peso = (r: SessionRow): number => ORDER.indexOf(group(r.state))
    return perProgetto(recenti).map(([name, rows]) => ({
      key: `p:${name}`,
      proj: name,
      // Preso da `rows` (non ancora svuotate): un progetto chiuso non deve perdere
      // la propria cwd solo perché le righe sotto sono nascoste.
      cwd: rows[0]?.cwd,
      // Chiuso: l'intestazione resta, le righe no.
      rows: store.collapse.isClosed(name) ? [] : [...rows].sort((a, b) => peso(a) - peso(b)),
    }))
  })

  /** Quante chat di un progetto ti aspettano — contate sulle righe vere, non su
   *  `tree`, che per un progetto chiuso le ha già svuotate. Serve solo chiuso: aperto,
   *  il pallino di ogni riga (`.unread`) dice già la stessa cosa una per una. */
  const needsCounts = $derived.by(() => {
    const m = new Map<string, number>()
    for (const r of recenti) {
      if (!needsYou(r.state)) continue
      const p = project(r.cwd)
      m.set(p, (m.get(p) ?? 0) + 1)
    }
    return m
  })

  // ─── cercare ──────────────────────────────────────────────────────────────
  //
  // Due ricerche in una casella sola, e la differenza conta. Il **titolo** lo filtra
  // il browser, perché i titoli sono già tutti qui: aspettare il daemon per nascondere
  // delle righe che ho già in mano sarebbe un ritardo inventato. Il **contenuto** lo
  // cerca il daemon, che è l'unico ad avere i journal — e li ha già ridotti in memoria
  // per l'elenco, quindi non rilegge niente.
  //
  // Restano separati anche a schermo: «si chiama così» e «ne parla dentro» sono due
  // risposte diverse, e mescolarle vorrebbe dire non poter dire quale delle due è.
  const perTitolo = $derived(
    store.query.trim().length < 2 ? [] : store.rows
      .filter(r => r.title.toLowerCase().includes(store.query.trim().toLowerCase()))
      .sort((a, b) => b.since - a.since),
  )

  let dentro = $state<SessionMatches[]>([])
  let cercando = $state(false)
  // `giro` è la stessa guardia contro il sorpasso del menu dei file (`Dock.svelte`):
  // due risposte possono tornare in ordine diverso da come sono partite, e senza
  // questo l'elenco mostrerebbe i risultati di due lettere fa.
  let giro = 0
  $effect(() => {
    const q = store.query.trim()
    if (q.length < 2) { giro++; dentro = []; cercando = false; return }
    const mio = ++giro
    cercando = true
    // Un'attesa breve prima di chiedere: qui, a differenza dei file, la risposta
    // costa — il daemon scorre i turni di **tutte** le conversazioni — e chi scrive
    // «parser» produrrebbe sei ricerche di cui cinque già inutili quando partono.
    const t = setTimeout(() => {
      void store.search(q).then(r => {
        if (mio !== giro) return
        dentro = r
        cercando = false
      })
    }, 150)
    return () => clearTimeout(t)
  })

  const inRicerca = $derived(store.query.trim().length >= 2)

  /** Il ritaglio con la corrispondenza evidenziata, senza ricercarla una seconda
   *  volta: `at` e `len` arrivano già calcolati da chi ha cercato (`core/search.ts`). */
  function pezzi(m: Match): [string, string, string] {
    return [m.snippet.slice(0, m.at), m.snippet.slice(m.at, m.at + m.len), m.snippet.slice(m.at + m.len)]
  }

  const CHI: Record<Match['kind'], string> = {
    prompt: 'you asked', answer: 'answered', tool: 'did',
  }

  let draft = $state('')

  function apriMenu(row: SessionRow, x: number, y: number): void {
    store.menu = { id: row.id, x, y }
  }

  function openMenu(e: MouseEvent, row: SessionRow): void {
    e.preventDefault()
    // Su Android la stessa pressione lunga fa pure il `contextmenu` nativo: se il
    // menu l'ha appena aperto il dito, questo evento è un doppione della stessa cosa.
    if (longPressAppenaFatto()) return
    apriMenu(row, e.clientX, e.clientY)
  }

  // ─── rinominare un progetto ───────────────────────────────────────────────
  //
  // Stato a parte da `draft`/`store.renaming`: quelli sono per una riga o una vista,
  // qui l'id è una cwd. Il menu che apre la modifica vive in App.svelte (stesso
  // `store.menu` del tasto destro sulle chat) — questa riga sa solo mostrare il
  // campo quando `store.renamingProject` punta a lei.
  let projectDraft = $state('')
  $effect(() => {
    const cwd = store.renamingProject
    if (cwd) projectDraft = projectName(cwd, store.settings?.projects)
  })
  async function commitProjectRename(cwd: string): Promise<void> {
    const raw = project(cwd)
    const value = projectDraft.trim()
    store.renamingProject = null
    if (value === raw) { await store.setProject(cwd, { name: undefined }); return }
    if (value && value !== (store.project(cwd).name ?? raw)) await store.setProject(cwd, { name: value })
  }

  function openMenuProject(e: MouseEvent, cwd: string | undefined): void {
    if (!cwd) return
    e.preventDefault()
    if (longPressAppenaFatto()) return
    store.menu = { id: cwd, x: e.clientX, y: e.clientY, kind: 'project' }
  }

  // ─── riordinare i progetti ────────────────────────────────────────────────
  //
  // Trascinare un progetto su un altro lo sposta alla sua posizione. Il bersaglio è
  // l'intestazione del progetto sotto il puntatore; l'ordine risultante lo tiene
  // `store.order` (vedi `order.svelte.ts`). `draggingProject` è separato da
  // `draggingChat`, così le zone di rilascio dei pannelli non si accendono.
  const allProjects = $derived([...new Set(store.rows.map(r => project(r.cwd)))])
  let dropTarget = $state<string | null>(null)

  function dragProjectStart(e: DragEvent, name: string): void {
    e.dataTransfer?.setData('text/stark-project-id', name)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    store.draggingProject = name
  }

  function dragProjectOver(e: DragEvent, name: string): void {
    if (!store.draggingProject || store.draggingProject === name) return
    e.preventDefault()
    dropTarget = name
  }

  function dropProject(e: DragEvent, name: string): void {
    e.preventDefault()
    const from = store.draggingProject
    dropTarget = null
    store.draggingProject = null
    if (from && from !== name) store.order.move(allProjects, from, name)
  }

  function dragProjectEnd(): void {
    store.draggingProject = null
    dropTarget = null
  }

  async function commit(row: SessionRow): Promise<void> {
    const text = draft
    store.renaming = null
    if (text.trim() && text !== row.title) await store.rename(row.id, text)
  }

  $effect(() => {
    const id = store.renaming
    if (id) {
      const v = store.viste.trova(id)
      draft = v ? v.name : store.rows.find(r => r.id === id)?.title ?? ''
    }
  })

  // ─── le viste ─────────────────────────────────────────────────────────────
  //
  /** La chiave con cui la sezione «Views» sta in `store.collapse`. I due underscore
   *  la tengono fuori dallo spazio dei nomi dei progetti, che sono percorsi. */
  const VISTE = '__views__'
  //
  // Una vista è una disposizione di pannelli con un nome (`lib/viste.svelte.ts`).
  // Prima non esisteva come cosa: affiancare due chat era uno stato dello schermo, e
  // un clic altrove lo scriveva via. Ora ha una riga sua, in cima — sopra i gruppi e
  // fuori dal loro `{#each}`, perché una vista non appartiene a uno stato né a un
  // progetto: dentro può averne due diversi.

  /** Cosa mostra la riga: i progetti coinvolti e se là dentro c'è qualcosa da
   *  guardare. Deriva dalle righe che l'elenco ha già — nessuna richiesta in più al
   *  daemon per una cosa che si sa. */
  function riassunto(v: Vista): { progetti: string[]; attesa: boolean; lavora: boolean; n: number } {
    const ids = leafIds(v.tree)
    const righe = ids.map(id => store.rows.find(r => r.id === id)).filter(Boolean) as SessionRow[]
    const progetti = [...new Set(righe.map(r => project(r.cwd)))]
    return {
      progetti,
      attesa: righe.some(r => needsYou(r.state)),
      // «Lavora» solo se nessuna aspetta: due segni sulla stessa riga direbbero due
      // cose insieme, e quella che conta è sempre quella che chiede a te.
      lavora: !righe.some(r => needsYou(r.state)) && righe.some(r => group(r.state) === 'Working'),
      n: ids.length,
    }
  }

  function apriMenuVista(v: Vista, x: number, y: number): void {
    store.menu = { id: v.id, x, y, kind: 'view' }
  }

  function openMenuVista(e: MouseEvent, v: Vista): void {
    e.preventDefault()
    if (longPressAppenaFatto()) return
    apriMenuVista(v, e.clientX, e.clientY)
  }

  function commitVista(v: Vista): void {
    const text = draft
    store.renaming = null
    if (text.trim() && text !== v.name) store.rinominaVista(v.id, text)
  }

  // Overflow "…" : raggruppa Notifiche / Todo / Helper / Telefono, come da screenshot 2.
  // Resta in testata solo [+] e […] — "Segui sistema" quindi niente forzatura dark.
  let moreOpen = $state(false)

  function closeMore(): void { moreOpen = false }

  $effect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') moreOpen = false }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
</script>

<div class="side" style="--side-w:{store.sidebarWidth}px">
  <!-- La maniglia del bordo destro. Sta dentro `.side` e non fra le due colonne
       perché la larghezza è una proprietà della barra, non del vuoto accanto: così
       sparisce da sé quando la barra è collassata o quando lo schermo è stretto, senza
       che nessun altro debba saperlo.
       Su schermo stretto non c'è (§8 di docs/ui-schermate.md: là la barra è tutta la
       schermata, e stringerla non vorrebbe dire niente). -->
  {#if !store.narrow}
    <div
      class="side-hdl" class:drag={trascinando}
      role="separator" aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={store.sidebarWidth} aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX}
      tabindex="0"
      onpointerdown={giuManiglia}
      onpointermove={muoviManiglia}
      onpointerup={suManiglia}
      onpointercancel={suManiglia}
      ondblclick={() => store.setSidebarWidth(SIDEBAR_DEFAULT)}
      onkeydown={tastoManiglia}
    ></div>
  {/if}
  <div class="sidetop">
    <Logo height={16} />
    <div class="acts">
      <button class="collapse" title="Collapse sidebar (mod+b)" aria-label="Collapse sidebar"
        onclick={() => store.toggleSidebar()}>
        <Icon name="i-panel" />
      </button>
    </div>
  </div>

  <!-- La ricerca sta **sopra** l'elenco e non dentro un pannello suo: cercare è un
       modo di guardare l'elenco, non un posto diverso in cui andare. Per questo i
       risultati prendono il posto dell'albero invece di aprirsi accanto. -->
  <div class="find">
    <Icon name="i-search" />
    <input
      type="search" placeholder="Search chats" aria-label="Search chats"
      bind:value={store.query}
      onkeydown={e => { if (e.key === 'Escape') store.query = '' }} />
    {#if store.query}
      <button class="clr" title="Clear search" aria-label="Clear search"
        onclick={() => { store.query = '' }}><Icon name="i-x" /></button>
    {/if}
  </div>

  {#if ferme.length > 0}
    <div class="quotaout" role="status">
      <Icon name="i-warn" />
      <div>
        <div class="qt">Quota reached</div>
        <div class="qs">
          {ferme.length === 1 ? 'One chat is' : `${ferme.length} chats are`} stopped until
          {#if riparte}<b>{stamp(riparte)}</b>{:else}the limit resets{/if}
          {#if profili.length > 0}<br />on {profili.map(p => p.replace(/^.*\//, '')).join(', ')}{/if}
        </div>
      </div>
    </div>
  {/if}

  <div class="scroller" style="flex:1;padding-bottom:6px">
    {#if inRicerca}
      {#if perTitolo.length > 0}
        <div class="gstate">Titles</div>
        {#each perTitolo as row (row.id)}
          <button class="sit" class:on={row.id === store.selected}
            use:longpress={(x, y) => apriMenu(row, x, y)}
            onclick={() => void store.select(row.id)}
            oncontextmenu={e => openMenu(e, row)}>
            {#if row.model && getLobeIconUrl(row.model)}
              <img class="micon" src={getLobeIconUrl(row.model) ?? ''} alt="" width="14" height="14"
                loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
            {:else}
              <span class="micon"></span>
            {/if}
            <div style="flex:1;text-align:left">
              <div class="ttl">{row.title}</div>
              <div class="meta">
                {hhmm(row.lastTs)}
                <span class="sst {label(row.state)}">{label(row.state)}</span>
                <i class="dotk p{palette.get(project(row.cwd)) ?? 0}"></i> {projectName(row.cwd, store.settings?.projects)}
              </div>
            </div>
          </button>
        {/each}
      {/if}

      {#if dentro.length > 0}
        <div class="gstate">Inside conversations</div>
        {#each dentro as s (s.sessionId)}
          <!-- Il titolo della conversazione, non un'etichetta di gruppo: `.gproj`
               avrebbe messo un maiuscoletto largo, che su un titolo lungo diventa
               tre righe e si legge come una sezione invece che come una chat. -->
          <button class="hitchat" onclick={() => void store.select(s.sessionId)}>
            <span class="ht">{s.title}</span>
            <!-- Quante in tutto, non quante ne vedi: con cinque righe mostrate e
                 quaranta trovate, tacere sul resto direbbe che sono cinque. -->
            <span class="cnt">{s.total}</span>
          </button>
          <!-- Chiave per indice, di proposito. Due corrispondenze possono cadere allo
               stesso punto dello stesso turno — il riassunto di un tool e la sua
               motivazione, per dirne una — e qualunque chiave costruita dal contenuto
               collide (visto succedere: `each_key_duplicate` sul primo giro nel
               browser vero). Qui non c'è identità da preservare: l'elenco si rifà
               tutto a ogni ricerca. -->
          {#each s.matches as m, i (i)}
            {@const [pre, hit, post] = pezzi(m)}
            <button class="hit" onclick={() => void store.apri(s.sessionId, m.turnId)}>
              <span class="who">{CHI[m.kind]}</span>
              <span class="snip">{pre}<mark>{hit}</mark>{post}</span>
            </button>
          {/each}
        {/each}
      {/if}

      {#if perTitolo.length === 0 && dentro.length === 0}
        <div class="mid" style="padding:20px 14px">
          {cercando ? 'Searching…' : 'Nothing found.'}
        </div>
      {/if}
    {:else}
    <!-- Le viste salvate. Sopra i gruppi e fuori dal loro `{#each}`: una vista non sta
         dentro uno stato né dentro un progetto — può contenerne due diversi, e
         infilarla in un gruppo vorrebbe dire sceglierne uno a caso. Non compare se non
         ce ne sono: una sezione vuota è rumore che insegna a saltare quella zona. -->
    {#if store.viste.lista.length > 0}
      <!-- Stessa `store.collapse` dei progetti, con una chiave che non può collidere
           con un nome di progetto: due meccanismi di apertura nella stessa colonna
           sarebbero due cose da imparare per lo stesso gesto. -->
      <button class="gstate vhead" class:closed={store.collapse.isClosed(VISTE)}
        aria-expanded={!store.collapse.isClosed(VISTE)}
        onclick={() => store.collapse.toggle(VISTE)}>
        <Icon name="i-down" class="chev" />
        <span>Views</span>
      </button>
      {#if !store.collapse.isClosed(VISTE)}
        {#each store.viste.lista as v (v.id)}
          {@const r = riassunto(v)}
          {#if store.renaming === v.id}
            <div class="sit">
              <!-- svelte-ignore a11y_autofocus -->
              <input class="rn" autofocus bind:value={draft}
                onblur={() => commitVista(v)}
                onkeydown={e => {
                  if (e.key === 'Enter') commitVista(v)
                  if (e.key === 'Escape') store.renaming = null
                }} />
            </div>
          {:else}
            <button class="sit vrow" class:on={store.viste.active === v.id}
              use:longpress={(x, y) => apriMenuVista(v, x, y)}
              onclick={() => void store.apriVista(v.id)}
              oncontextmenu={e => openMenuVista(e, v)}>
              <span class="vic"><Icon name="i-panel" /></span>
              <div style="flex:1;text-align:left;min-width:0">
                <div class="ttl">{v.name}</div>
                <div class="meta">
                  {r.n} panes
                  <!-- Al massimo tre pallini, poi il conto: una vista con sei progetti
                       dentro riempirebbe la riga di puntini che non si contano. -->
                  {#each r.progetti.slice(0, 3) as p (p)}<i class="dotk p{palette.get(p) ?? 0}"></i>{/each}
                  {#if r.progetti.length > 3}<span class="vmore">+{r.progetti.length - 3}</span>{/if}
                </div>
              </div>
              <!-- Il segno: le viste ora si chiudono, quindi una chat che chiede
                   qualcosa può finire fuori vista. Senza questo te ne accorgi solo
                   ripassando di lì per caso. -->
              {#if r.attesa}<i class="vsign asking" title="Something in here needs you"></i>
              {:else if r.lavora}<i class="vsign working" title="Something in here is working"></i>{/if}
            </button>
          {/if}
        {/each}
      {/if}
    {/if}
    {#each tree as section (section.key)}
      <!-- Un progetto è un nodo di albero: si apre e si chiude. Il quadrato di colore
           sta a sinistra come sulle righe delle chat, che portano lo stesso segno
           (§8); l'accordion sta a destra, dove si guarda per ultimo. -->
      {@const closed = store.collapse.isClosed(section.proj)}
      {@const n = needsCounts.get(section.proj) ?? 0}
      <button class="gstate dotted" class:closed
        class:drop={dropTarget === section.proj}
        aria-expanded={!closed}
        onclick={() => store.collapse.toggle(section.proj)}
        draggable="true"
        ondragstart={e => dragProjectStart(e, section.proj)}
        ondragover={e => dragProjectOver(e, section.proj)}
        ondragleave={() => { if (dropTarget === section.proj) dropTarget = null }}
        ondrop={e => dropProject(e, section.proj)}
        ondragend={dragProjectEnd}
        oncontextmenu={e => openMenuProject(e, section.cwd)}>
        <i class="dotk p{palette.get(section.proj) ?? 0}"></i>
        <span class="ghead">{projectName(section.cwd, store.settings?.projects)}</span>
        <!-- Compresso, il pallino di ogni riga sparisce con lei: il conto lo
             rimpiazza, se no chiudere un progetto nasconderebbe anche il fatto che
             qualcosa lì dentro ti aspetta. -->
        {#if closed && n > 0}<span class="gcount">{n}</span>{/if}
        <Icon name="i-down" class="chev" />
      </button>
      {#if section.cwd && store.renamingProject === section.cwd}
        <div class="pj-rn-row">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="rn" autofocus bind:value={projectDraft}
            onblur={() => void commitProjectRename(section.cwd ?? '')}
            onkeydown={e => {
              if (e.key === 'Enter') void commitProjectRename(section.cwd ?? '')
              if (e.key === 'Escape') store.renamingProject = null
            }} />
        </div>
      {/if}
      {#each section.rows as row (row.id)}
          {#if store.renaming === row.id}
            <!-- Rinominare non apre una schermata: il titolo diventa scrivibile dov'è.
                 svelte-ignore a11y_autofocus -->
            <div class="sit">
              <!-- svelte-ignore a11y_autofocus -->
              <input class="rn" autofocus bind:value={draft}
                onblur={() => void commit(row)}
                onkeydown={e => {
                  if (e.key === 'Enter') void commit(row)
                  if (e.key === 'Escape') store.renaming = null
                }} />
            </div>
          {:else}
            <button
              class="sit"
              class:on={row.id === store.selected}
              class:zz={group(row.state) === 'Sleeping'}
              use:longpress={(x, y) => apriMenu(row, x, y)}
              onclick={() => void store.select(row.id)}
              draggable="true"
              ondragstart={e => {
                e.dataTransfer?.setData('text/stark-chat-id', row.id)
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                store.draggingChat = row.id
              }}
              ondragend={() => { store.draggingChat = null }}
              oncontextmenu={e => openMenu(e, row)}
            >
              {#if row.model && getLobeIconUrl(row.model)}
                <img class="micon" src={getLobeIconUrl(row.model) ?? ''} alt="" width="14" height="14"
                  loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}
                <span class="micon"></span>
              {/if}
              <div style="flex:1;text-align:left">
                <div class="ttl">{row.title}</div>
                <div class="meta">
                  {hhmm(row.lastTs)}
                  <span class="sst {label(row.state)}">{label(row.state)}</span>
                </div>
              </div>
              {#if needsYou(row.state)}<span class="unread"></span>{/if}
            </button>
          {/if}
        {/each}
    {/each}

    {#if tree.length === 0}
      <div class="mid" style="padding:20px 14px">No chats yet.</div>
    {/if}
    {/if}
  </div>

  <!-- Il fondo della barra: i tre puntini a sinistra, «New Chat» a destra — lungo,
       perché è l'azione che si preme più spesso e non deve competere in un angolo
       da 22px con tutto il resto (notifiche, board, impostazioni: quello sta
       comunque dietro ai puntini). -->
  <div class="sidebottom">
    <button class="more" title="More" aria-label="More" aria-expanded={moreOpen}
      aria-haspopup="menu"
      onclick={(e) => { e.stopPropagation(); moreOpen = !moreOpen }}>
      <Icon name="i-more" />
    </button>
    <button class="newchat" title="New chat" aria-label="New chat"
      onclick={() => { store.refused = null; store.dialog = { kind: 'new' } }}>
      <Icon name="i-plus" />
      <span>New Chat</span>
    </button>
    {#if moreOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="more-scrim" onclick={closeMore} oncontextmenu={e => { e.preventDefault(); closeMore() }}></div>
      <div class="more-pop" role="menu">
        <button class="mp-item" role="menuitem"
          onclick={() => { void store.calls.toggle(); closeMore() }}>
          <Icon name={store.calls.on ? 'i-bell' : 'i-bell-off'} />
          <span class="mp-label">Notifications</span>
          {#if store.calls.on}<span class="mp-check"><Icon name="i-check" /></span>{/if}
        </button>
        <button class="mp-item" role="menuitem"
          onclick={() => { soloNonLette = false; closeMore() }}>
          <span class="mp-ico">{#if !soloNonLette}<Icon name="i-check" />{:else}<Icon name="i-circle" />{/if}</span>
          <span class="mp-label">Show completed</span>
        </button>
        <button class="mp-item" role="menuitem"
          onclick={() => { soloNonLette = true; closeMore() }}>
          <span class="mp-ico">{#if soloNonLette}<Icon name="i-check" />{:else}<Icon name="i-circle" />{/if}</span>
          <span class="mp-label">Unread only</span>
        </button>
        <hr class="mp-sep" />
        <!-- La board sta nel menu e non come bottone suo: un modo a tutto schermo
             come le impostazioni è roba dell'overflow, non un bottone sempre visibile. -->
        <button class="mp-item" role="menuitem"
          onclick={() => { store.toggleBoard(); closeMore() }}>
          <Icon name="i-brick" />
          <span class="mp-label">Board</span>
        </button>
        <hr class="mp-sep" />
        <button class="mp-item" role="menuitem"
          onclick={() => { store.refused = null; store.dialog = { kind: 'phone' }; closeMore() }}>
          <Icon name="i-phone" />
          <span class="mp-label">Connected devices</span>
        </button>
        <hr class="mp-sep" />
        <button class="mp-item" role="menuitem"
          onclick={() => { store.refused = null; store.dialog = { kind: 'settings' }; closeMore() }}>
          <Icon name="i-gear" />
          <span class="mp-label">Settings</span>
        </button>
        {#if store.aggiornamento?.installata}
          <hr class="mp-sep" />
          <!-- In sola lettura, di proposito: qui si mostra cosa gira, non si aggiorna
               niente — l'azione ha già il suo posto nella banda in cima. -->
          <div class="mp-item mp-static">
            <span class="mp-label">Version</span>
            <span class="mp-ver">{store.aggiornamento.installata}</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

</div>

<style>
  /* Le righe sono <button> perché si premono: il vestito viene da app.css, qui c'è
     solo ciò che serve a togliere l'aspetto di pulsante senza perderne il mestiere. */
  /* La casella di ricerca — pill tonda come nello screenshot 1: lente a sinistra,
     placeholder "Search chats", X a destra. Resta `type="search"` per tastiera. */
  /* 1) Sidebar sinistra stesso sfondo del pannello agente: in scuro le due tinte scure
        del design (`--panel-*`), in chiaro la tavolozza di base. Riscrivere i nomi del
        vocabolario su `.side` fa sì che tutte le classi qui dentro li prendano senza
        sapere da dove vengono. */
  :global(.side){
    background:var(--panel-bg); border-right:1px solid var(--panel-line);
    --side:var(--panel-bg); --surface:var(--panel-surface); --surface-2:var(--panel-surface-2); --surface-3:var(--panel-surface-3);
    --ink:var(--panel-ink); --ink-2:var(--panel-ink-2); --muted:var(--panel-muted);
    --line:var(--panel-line); --line-2:var(--panel-line-2);
    --accent:var(--panel-accent); --accent-soft:var(--panel-accent-soft);
  }
  /* La maniglia: invisibile finché non la si sfiora, come i divisori fra pannelli.
     Sta sopra il bordo destro e sborda di due pixel verso l'interno — una linea da un
     pixel si vede ma non si afferra, e cinque pixel di area sensibile sono il minimo
     per prenderla al primo colpo senza rubare clic alle righe dell'elenco. */
  .side-hdl {
    position: absolute; top: 0; bottom: 0; right: -2px; width: 5px;
    z-index: 5; cursor: col-resize; touch-action: none;
  }
  .side-hdl::after {
    content: ''; position: absolute; inset: 0 2px; border-radius: 2px;
    background: transparent; transition: background .12s;
  }
  .side-hdl:hover::after, .side-hdl.drag::after, .side-hdl:focus-visible::after {
    background: var(--accent);
  }
  .side-hdl:focus-visible { outline: none; }

  /* Header senza linea — nello screenshot non c'è separatore. */
  :global(.side .sidetop) { border-bottom: none; padding: 10px 10px 8px 12px; }
  .find {
    display: flex; align-items: center; gap: 7px;
    margin: 6px 8px 10px; padding: 4px 10px;
    border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
    color: var(--muted);
  }
  .find :global(svg.ic) { width: 13px; height: 13px; opacity: .85; }
  .find:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .find input {
    flex: 1; min-width: 0; font: inherit; font-size: 11px;
    border: 0; background: none; color: var(--ink); outline: none; padding: 1px 0; line-height: 1.2;
  }
  .find input::placeholder { color: var(--muted); }
  .find input::-webkit-search-decoration,
  .find input::-webkit-search-cancel-button { display: none; }
  .clr {
    display: flex; border: 0; background: none; padding: 2px; cursor: pointer;
    color: var(--muted); flex: none; border-radius: 50%;
  }
  .clr:hover { color: var(--ink); background: var(--surface-2); }

  /* Una riga di risultato non è una riga dell'elenco: non è una conversazione, è un
     punto **dentro** una. Per questo è rientrata sotto il titolo della chat e più
     bassa — il titolo sopra dice già di quale si tratta. */
  .hit {
    display: block; width: calc(100% - 10px); margin: 0 5px 1px; padding: 3px 7px 4px;
    text-align: left; border: 0; border-radius: 6px; background: none;
    font: inherit; color: var(--muted); cursor: pointer;
  }
  .hit:hover { background: var(--surface-2); }
  .hit:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .who {
    display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em;
    opacity: .7;
  }
  .snip {
    display: block; font-size: 11px; line-height: 1.35; color: var(--ink);
    /* Due righe al massimo: il ritaglio è già tagliato da chi cerca, ma un carattere
       stretto ce ne fa stare di più e tre righe per risultato spingono fuori vista
       tutti gli altri. */
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .snip mark { background: var(--user-bg); color: var(--ink); border-radius: 2px; }
  /* Il titolo sopra un gruppo di risultati. Si preme: porta alla conversazione
     senza scegliere un punto, che è cosa si vuole quando le corrispondenze sono
     tante e nessuna in particolare è quella giusta. */
  .hitchat {
    display: flex; align-items: baseline; gap: 8px;
    width: calc(100% - 10px); margin: 7px 5px 2px; padding: 0 7px;
    border: 0; background: none; font: inherit; font-size: 11.5px; font-weight: 600;
    color: var(--ink); cursor: pointer; text-align: left;
  }
  .hitchat:hover .ht { text-decoration: underline; }
  .hitchat .ht { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hitchat .cnt {
    flex: none; font-size: 10px; font-weight: 400; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* ─── le viste ──────────────────────────────────────────────────────────────
     La riga di una vista è una `.sit` come quella di una chat: nell'elenco è un posto
     dove si va, e darle una forma sua vorrebbe dire insegnare due volte la stessa
     cosa. Cambia solo cosa porta: l'icona dei pannelli al posto di quella del modello,
     e il segno di attenzione a destra. */
  .vhead {
    display: flex; align-items: center; gap: 4px;
    width: 100%; border: 0; background: none; cursor: pointer; text-align: left;
  }
  .vhead :global(svg.chev) { width: 12px; height: 12px; transition: transform .12s; }
  .vhead.closed :global(svg.chev) { transform: rotate(-90deg); }
  .vic { flex: none; display: grid; place-items: center; width: 14px; height: 14px; color: var(--muted); }
  .vic :global(svg.ic) { width: 13px; height: 13px; }
  .vmore { font-variant-numeric: tabular-nums; }
  /* Il segno di attenzione. Un punto e basta: la riga dice già di cosa si tratta, e
     un'etichetta come quelle di stato (`.sst`) qui sarebbe falsa — dentro una vista
     gli stati sono più d'uno, e nominarne uno solo direbbe una cosa non vera. */
  .vsign { flex: none; width: 7px; height: 7px; border-radius: 999px; }
  .vsign.asking { background: var(--wait); }
  .vsign.working { background: var(--work); }

  /* `.gstate` non è flex: lo diventa solo quando porta il quadrato del progetto. Senza,
     il segno resterebbe un carattere in linea e cadrebbe sotto la riga di base del
     testo invece che al suo centro. */
  .gstate.dotted { display: flex; align-items: center; gap: 6px; }
  /* Un progetto è un nodo di albero: l'intestazione è un <button> che apre e chiude.
     Togliere l'aspetto di pulsante senza perderne il mestiere, come le righe `.sit`.
     Niente `font`/`color: inherit` qui: `.gstate` (app.css) porta già `color: var(--muted)`
     e `font-weight: 600` — alla stessa specificità, un `inherit` scritto qui li avrebbe
     spenti, ed è esattamente il modo in cui l'intestazione del progetto aveva smesso di
     sembrare un'intestazione `.gstate`. Il reset del bottone lo fa già la regola globale
     `button{color:inherit;font-family:inherit;...}`. */
  .gstate.dotted {
    background: none; border: 0; width: 100%; text-align: left; cursor: pointer;
  }
  .gstate.dotted:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }
  /* L'accordion sta in fondo alla riga, non in testa: il colore e il nome sono ciò
     che identifica il progetto, l'apri/chiudi è un comando e i comandi si guardano
     per ultimi. Stessa direzione di sempre — giù aperto, verso destra chiuso — solo
     ruotando lo stesso chevron, non due icone diverse da tenere sincronizzate. */
  .gstate.dotted .chev {
    flex: none; width: 11px; height: 11px; color: var(--muted); margin-left: auto;
    transition: transform .12s ease;
  }
  .gstate.dotted.closed .chev { transform: rotate(-90deg); }
  .gstate.dotted .ghead {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .gstate.dotted:hover .chev { color: var(--ink); }
  /* Il bersaglio di un trascinamento: un bordo che dice «qui finisce». */
  .gstate.dotted.drop {
    background: var(--accent-soft); border-radius: 6px;
  }
  .gstate.dotted.drop .chev { color: var(--accent); }
  :global(.side .gstate) { font-size: 10px; letter-spacing: .10em; padding: 10px 10px 4px; }

  /* Il conto di quante chat aspettano, quando il progetto è chiuso e quindi le loro
     righe — e i loro pallini (`.unread`, stesso `--accent`) — non si vedono più. */
  .gcount {
    flex: none; min-width: 15px; padding: 1px 5px; border-radius: 999px;
    background: var(--accent); color: var(--on-accent);
    font-size: 9.5px; font-weight: 700; text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .sit, .sidefoot, .more, .newchat, .collapse {
    background: none;
    border: 0;
    width: 100%;
    font: inherit;
    color: inherit;
  }
  /* Testata: solo il logo e il collasso — [+] e […] sono scesi in fondo (vedi
     `.sidebottom`), dove stanno gli altri comandi della barra. */
  .collapse {
    width: 22px; height: 22px; border-radius: 7px; color: var(--muted);
    display: flex; cursor: pointer; align-items: center; justify-content: center;
  }
  .collapse :global(svg.ic) { width: 14px; height: 14px; }
  .collapse:hover { background: var(--surface-3); color: var(--ink); }

  /* Il fondo della barra: i puntini a sinistra, «New Chat» lunga a destra. */
  .sidebottom {
    position: relative; flex: none; display: flex; align-items: center; gap: 7px;
    padding: 8px 10px; border-top: 1px solid var(--line);
  }
  .more {
    flex: none; width: 30px; height: 30px; border-radius: 8px; color: var(--muted);
    display: flex; cursor: pointer; align-items: center; justify-content: center;
  }
  .more :global(svg.ic) { width: 14px; height: 14px; }
  .more:hover { background: var(--surface-3); color: var(--ink); }
  .more[aria-expanded="true"] { background: var(--surface-3); color: var(--ink); }
  /* «+ New Chat»: l'icona sostituisce il carattere, il testo dice cosa fa. È il
     bottone pieno della barra (viola #8b5cf6), come lo era il vecchio [+] isolato. */
  .newchat {
    flex: 1; height: 30px; border-radius: 8px; background: var(--accent); color: var(--on-accent);
    display: flex; cursor: pointer; align-items: center; justify-content: center; gap: 6px;
    font-size: 11.5px; font-weight: 600; box-shadow: 0 1px 2px rgba(16,20,32,.10);
  }
  .newchat :global(svg.ic) { width: 12px; height: 12px; }
  .newchat:hover { filter: brightness(1.06); }

  /* Sotto la soglia stretta la sidebar è tutto lo schermo (§8 di ui-schermate.md):
     «New Chat» lunga in fondo alla barra ci starebbe, ma è il gesto che si ripete
     più spesso su un dito solo — un tondo che galleggia sopra l'elenco, sempre
     raggiungibile senza scorrere fino in fondo, come un FAB. Il testo sparisce:
     l'icona da sola basta quando il bottone non è più in riga con altro. */
  @media (max-width: 860px) {
    .newchat {
      position: fixed;
      right: calc(env(safe-area-inset-right) + 16px);
      bottom: calc(env(safe-area-inset-bottom) + 16px);
      flex: none; width: 52px; height: 52px; padding: 0; border-radius: 50%;
      box-shadow: 0 6px 18px rgba(16,20,32,.28);
      z-index: 5;
    }
    .newchat span { display: none; }
    .newchat :global(svg.ic) { width: 20px; height: 20px; }
  }

  /* Menu … — fedele allo screenshot 2: card scura con bordi arrotondati, voci con icone a sinistra
     e spunta a destra, separator sottili. Segue il tema (surface/line) quindi "Segui sistema". */
  .more-scrim { position: fixed; inset: 0; z-index: 9; }
  .more-pop {
    /* Apre verso l'alto, ancorata a `.sidebottom`: il bottone che la apre sta in
       fondo alla barra adesso, non più in testata. */
    position: absolute; bottom: 100%; margin-bottom: 8px; left: 0; right: 0; z-index: 10;
    width: auto; padding: 6px;
    background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px;
    box-shadow: 0 12px 32px rgba(16,20,32,.18); display: flex; flex-direction: column; gap: 1px;
  }
  .mp-item {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0;
    border-radius: 8px; background: none; font: inherit; font-size: 11.5px; color: var(--ink);
    cursor: pointer; text-align: left;
  }
  .mp-item:hover { background: var(--surface-2); }
  .mp-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .mp-item svg.ic { width: 14px; height: 14px; flex: none; color: var(--muted); }
  .mp-label { flex: 1; min-width: 0; }
  .mp-ico { width: 14px; height: 14px; display: grid; place-items: center; flex: none; color: var(--muted); }
  .mp-ico svg.ic { width: 11px; height: 11px; }
  .mp-check { margin-left: auto; display: flex; color: var(--accent); }
  .mp-check svg.ic { width: 12px; height: 12px; color: var(--accent); }
  .mp-sep { margin: 4px 2px; border: 0; border-top: 1px solid var(--line); }
  .mp-static { cursor: default; }
  .mp-static:hover { background: none; }
  .mp-ver { color: var(--muted); font-variant-numeric: tabular-nums; }

  /* Posizionamento del menu rispetto alla testata. */
  :global(.side) { position: relative; }

  .sit { width: calc(100% - 10px); border-radius: 10px;
    /* La pressione lunga apre il menu: la selezione del testo e il callout di iOS
       non devono contendergli il gesto — un dito fermo su una riga vale «menu», non
       «seleziona». */
    -webkit-touch-callout: none; user-select: none; }
  .sit:focus-visible, .sidefoot:focus-visible, .more:focus-visible,
  .newchat:focus-visible, .collapse:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .sidefoot { cursor: pointer; }
  .rn {
    width: 100%; font: inherit; font-size: 11.5px; font-weight: 600;
    border: 1px solid var(--accent); border-radius: 10px; padding: 4px 8px;
    background: var(--surface); color: var(--ink); outline: none;
  }
  .pj-rn-row { padding: 0 10px 4px; }
  /* L'icona del modello a sinistra della riga. Il placeholder vuoto (`span.micon`)
     occupa lo stesso spazio dell'immagine, così le righe senza modello — o con un
     modello che non ha icona — restano allineate con le altre. */
  .micon { flex: none; width: 14px; height: 14px; display: inline-flex; border-radius: 3px; }
  img.micon { filter: var(--icon-f); opacity: .8; }
</style>
