<script lang="ts">
  // L'elenco compatto: è la navigazione, non una barra di navigazione.
  //
  // Due modi di raggrupparlo, scelti dal bottone sopra la lista (`store.grouping`):
  // **per stato** e, dentro ogni stato, per progetto — sempre, anche quando il progetto
  // è uno solo, perché la struttura non deve cambiare forma sotto gli occhi; oppure
  // **per progetto**, in ordine alfabetico. Sono due domande diverse: la prima è «a
  // cosa devo rispondere adesso», la seconda «cosa sta succedendo su questo lavoro».
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import type { Match, SessionMatches, SessionRow } from '../lib/api.ts'
  import {
    ORDER, activityIcon, activityText, colours, group, hhmm, label, needsYou, project, stamp,
  } from '../lib/view.ts'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import { quandoRiparte, quotaFerma } from '$core/quota.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

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

  /**
   * Una sezione dell'elenco, con la stessa forma nei due modi di raggruppare: chi
   * disegna non deve sapere quale dei due è attivo, se no il `{#each}` diventerebbe due
   * `{#each}` che divergono al primo ritocco. `proj` c'è solo quando è il progetto a
   * fare da sezione — raggruppando per stato il pallino colorato sta sui sotto-gruppi.
   */
  type Blocco = {
    key: string
    head: string
    proj?: string
    sub: { name?: string; rows: SessionRow[] }[]
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

  /** Le righe di una lista, raccolte per progetto e i progetti in ordine alfabetico. */
  function perProgetto(righe: SessionRow[]): [string, SessionRow[]][] {
    const m = new Map<string, SessionRow[]>()
    for (const r of righe) {
      const p = project(r.cwd)
      const list = m.get(p)
      if (list) list.push(r); else m.set(p, [r])
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }

  const tree = $derived.by<Blocco[]>(() => {
    if (store.grouping.by === 'project') {
      // Dentro un progetto le chat restano ordinate per stato **prima** che per tempo:
      // fuori dal raggruppamento per stato nessuno lo fa più, e senza, una che dorme
      // capiterebbe sopra una che ti sta aspettando. `ORDER` è lo stesso elenco che dà
      // l'ordine alle sezioni nell'altro modo — la convinzione «prima chi aspetta te»
      // è una sola, e sta in un posto solo.
      const peso = (r: SessionRow): number => ORDER.indexOf(group(r.state))
      return perProgetto(recenti).map(([name, rows]) => ({
        key: `p:${name}`,
        head: name,
        proj: name,
        sub: [{ rows: [...rows].sort((a, b) => peso(a) - peso(b)) }],
      }))
    }
    return ORDER.map(g => ({
      key: `s:${g}`,
      head: g,
      sub: perProgetto(recenti.filter(r => group(r.state) === g))
        .map(([name, rows]) => ({ name, rows })),
    })).filter(x => x.sub.length > 0)
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

  function openMenu(e: MouseEvent, row: SessionRow): void {
    e.preventDefault()
    store.menu = { id: row.id, x: e.clientX, y: e.clientY }
  }

  async function commit(row: SessionRow): Promise<void> {
    const text = draft
    store.renaming = null
    if (text.trim() && text !== row.title) await store.rename(row.id, text)
  }

  $effect(() => {
    const id = store.renaming
    if (id) draft = store.rows.find(r => r.id === id)?.title ?? ''
  })

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

<div class="side">
  <div class="sidetop">
    <Logo height={16} />
    <div class="acts">
      <button class="plus" title="New chat" aria-label="New chat"
        onclick={() => { store.refused = null; store.dialog = { kind: 'new' } }}>
        <Icon name="i-plus" />
      </button>
      <button class="more" title="More" aria-label="More" aria-expanded={moreOpen}
        aria-haspopup="menu"
        onclick={(e) => { e.stopPropagation(); moreOpen = !moreOpen }}>
        <Icon name="i-more" />
      </button>
    </div>
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
        <!-- La board arriva da main e sta qui, non in testata: il design ha svuotato
             la barra a [+] e […] di proposito («come da screenshot 2»), e un modo a
             tutto schermo come le impostazioni è roba dell'overflow, non un bottone
             sempre visibile. -->
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
      </div>
    {/if}
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

  <!-- Raggruppare è un modo di guardare l'elenco, quindi il comando sta **sull'elenco**
       e non nelle impostazioni: la scelta si fa guardando il risultato, e andarla a
       cercare dietro un pannello vorrebbe dire sceglierla al buio. Sparisce mentre si
       cerca, perché lì l'albero non c'è: un comando che non muove niente di ciò che
       vedi è peggio di un comando assente. -->
  {#if !inRicerca && store.rows.length > 0}
    <div class="grpby">
      <span class="lbl">Group by</span>
      <span class="pick">
        <button class:on={store.grouping.by === 'project'}
          onclick={() => store.grouping.set('project')}>Project</button>
        <button class:on={store.grouping.by === 'status'}
          onclick={() => store.grouping.set('status')}>Status</button>
      </span>
    </div>
  {/if}

  <div class="scroller" style="flex:1;padding-bottom:6px">
    {#if inRicerca}
      {#if perTitolo.length > 0}
        <div class="gstate">Titles</div>
        {#each perTitolo as row (row.id)}
          <button class="sit" class:on={row.id === store.selected}
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
                <i class="dotk p{palette.get(project(row.cwd)) ?? 0}"></i> {project(row.cwd)}
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
    {#each tree as section (section.key)}
      <div class="gstate" class:dotted={section.proj}>
        {#if section.proj}<i class="dotk p{palette.get(section.proj) ?? 0}"></i>{/if}{section.head}
      </div>
      {#each section.sub as sub (sub.name ?? section.key)}
        {#if sub.name}
          <div class="gproj"><i class="dotk p{palette.get(sub.name) ?? 0}"></i> {sub.name}</div>
        {/if}
        {#each sub.rows as row (row.id)}
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
                <!-- Cosa sta facendo adesso. Solo sulle righe vive: chi ha finito, chi
                     dorme e chi è stato fermato non sta facendo niente, e una riga in
                     più su ognuna costerebbe l'altezza dell'elenco per dire nulla. -->
                {#if row.doing}
                  <div class="act">
                    <Icon name={activityIcon(row.doing)} />
                    <span>{activityText(row.doing)}</span>
                  </div>
                {/if}
              </div>
              {#if needsYou(row.state)}<span class="unread"></span>{/if}
            </button>
          {/if}
        {/each}
      {/each}
    {/each}

    {#if tree.length === 0}
      <div class="mid" style="padding:20px 14px">No chats yet.</div>
    {/if}
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

  /* La riga del raggruppamento.
     Il primo giro le aveva dato la voce delle intestazioni di sezione (`.gstate`):
     maiuscoletto spaziato, grassetto. Sbagliato, e l'utente l'ha detto guardandola —
     quella voce dice «da qui in giù c'è questa roba», mentre questa riga è un
     **comando**, e a 9.5px in maiuscolo pesava più delle sezioni vere che stanno sotto.
     Adesso è un'etichetta e basta: minuscola, muta, sottile. A farsi guardare è il
     controllo, non la parola che lo introduce.
     Il margine è 8+4 = 12px, cioè lo stesso di logo, lente della ricerca e pallino di
     progetto: erano quattro cose incolonnate su tre ascisse diverse (12, 12, 10). */
  .grpby {
    display: flex; align-items: center; gap: 8px;
    margin: 2px 8px 4px; padding: 0 4px;
    font-size: 10px; color: var(--muted);
  }
  .grpby .lbl { white-space: nowrap; }

  /* Non `.seg`: quella è la levetta a due vie delle impostazioni, dove sta dentro una
     tabella e un bordo pieno la separa dalla riga accanto. Qui è sola su un fondo
     piatto, e lo stesso bordo diventava un riquadro pesante attorno a due bottoni
     squadrati — «brutti», detto guardandoli. Qui la traccia è un fondo, e a essere
     disegnata è la voce **scelta**: sale sopra la traccia invece di accendersi. */
  .pick {
    margin-left: auto; flex: none;
    display: flex; gap: 2px; padding: 2px;
    border-radius: 999px; background: var(--surface-3);
  }
  .pick button {
    padding: 2.5px 10px; border: 0; border-radius: 999px;
    font: inherit; font-size: 10px; color: var(--muted); line-height: 1.5;
  }
  .pick button:hover:not(.on) { color: var(--ink); }
  .pick button.on {
    background: var(--surface); color: var(--ink); font-weight: 600;
    /* Invisibile in tema scuro, e va bene: là a staccare è già `--surface`, che è più
       **scuro** della traccia. In tema chiaro è il contrario — bianco su grigio — e
       l'ombra è ciò che le impedisce di sembrare un buco invece di una pastiglia. */
    box-shadow: 0 1px 1.5px rgba(0, 0, 0, .10);
  }
  .pick button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* `.gstate` non è flex: lo diventa solo quando porta il pallino del progetto, cioè
     solo raggruppando per progetto. Senza, il pallino resterebbe un carattere in linea
     e cadrebbe sotto la riga di base del testo invece che al suo centro. */
  .gstate.dotted { display: flex; align-items: center; gap: 6px; }
  /* Nomi progetto più grandi — nello screenshot STARK sotto WAITING è più grande del section header. */
  :global(.side .gstate) { font-size: 10px; letter-spacing: .10em; padding: 10px 10px 4px; }
  :global(.side .gproj) { font-size: 11.5px; font-weight: 700; letter-spacing: .02em; padding: 6px 10px 4px 12px; }

  .sit, .sidefoot, .plus, .more {
    background: none;
    border: 0;
    width: 100%;
    font: inherit;
    color: inherit;
  }
  /* Testata: Logo a sinistra, a destra solo [+] viola e […] — il resto è nel menu.
     [+] è l'unico bottone pieno della barra, come nello screenshot 1 (viola #8b5cf6). */
  .plus, .more { width: auto; display: flex; cursor: pointer; align-items: center; justify-content: center; }
  /* Plus più piccola nello screenshot: quadrato viola compatto, icona più piccola. */
  .plus {
    width: 22px; height: 22px; border-radius: 7px; background: var(--accent); color: var(--on-accent);
    border: 1px solid transparent; box-shadow: 0 1px 2px rgba(16,20,32,.10);
  }
  .plus :global(svg.ic) { width: 11px; height: 11px; }
  .plus:hover { filter: brightness(1.06); }
  .more {
    width: 22px; height: 22px; border-radius: 7px; color: var(--muted);
  }
  .more :global(svg.ic) { width: 14px; height: 14px; }
  .more:hover { background: var(--surface-3); color: var(--ink); }
  .more[aria-expanded="true"] { background: var(--surface-3); color: var(--ink); }

  /* Menu … — fedele allo screenshot 2: card scura con bordi arrotondati, voci con icone a sinistra
     e spunta a destra, separator sottili. Segue il tema (surface/line) quindi "Segui sistema". */
  .more-scrim { position: fixed; inset: 0; z-index: 9; }
  .more-pop {
    position: absolute; top: 40px; left: 8px; right: 8px; z-index: 10;
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

  /* Posizionamento del menu rispetto alla testata. */
  :global(.side) { position: relative; }

  .sit { width: calc(100% - 10px); border-radius: 10px; }
  .sit:focus-visible, .sidefoot:focus-visible, .plus:focus-visible, .more:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .sidefoot { cursor: pointer; }
  .rn {
    width: 100%; font: inherit; font-size: 11.5px; font-weight: 600;
    border: 1px solid var(--accent); border-radius: 10px; padding: 4px 8px;
    background: var(--surface); color: var(--ink); outline: none;
  }
  /* L'icona del modello a sinistra della riga. Il placeholder vuoto (`span.micon`)
     occupa lo stesso spazio dell'immagine, così le righe senza modello — o con un
     modello che non ha icona — restano allineate con le altre. */
  .micon { flex: none; width: 14px; height: 14px; display: inline-flex; border-radius: 3px; }
  img.micon { filter: var(--icon-f); opacity: .8; }
</style>
