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
  const recenti = $derived([...store.rows].sort((a, b) => b.since - a.since))

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
</script>

<div class="side">
  <div class="sidetop">
    <Logo height={13} />
    <!-- I tre comandi in un contenitore loro, e non sciolti nella riga: spinge a destra
         **il gruppo**, con un passo uguale fra le icone. Sciolti, `margin-left:auto` era
         su entrambe le `.bell` e i due margini automatici si spartivano lo spazio libero
         (misurato: 23.9 · 23.9 · 7). -->
    <div class="acts">
    <!-- La campanella sta qui e non nella barra di stato perché le notifiche non sono
         di una chat ma di tutte. Premerla la prima volta è anche il momento in cui si
         chiede il permesso al browser: fuori da un gesto non si può nemmeno chiedere. -->
    <button class="bell" class:off={!store.calls.on}
      title={store.calls.explain} aria-label="Notifications"
      onclick={() => void store.calls.toggle()}>
      <Icon name={store.calls.on ? 'i-bell' : 'i-bell-off'} />
      {#if store.calls.on && store.calls.permission === 'default'}<i class="ask"></i>{/if}
    </button>
    <!-- L'interruttore della colonna dei task. Sta qui e non nella barra della chat
         perché la colonna è **una sola** per tutta la finestra: coi pannelli affiancati
         un bottone per pannello lascerebbe credere che ognuno abbia la sua. -->
    <button class="iconb" class:on={store.todoOpen}
      title={store.todoOpen ? 'Hide the todo column' : 'Show the todo column'}
      aria-label="Todo column" aria-pressed={store.todoOpen}
      onclick={() => store.toggleTodo()}>
      <Icon name="i-check" />
    </button>

    <!-- L'helper non e' di una chat: e' della macchina, come la campanella accanto.
         Nella barra di una conversazione comparirebbe una volta **per pannello aperto**,
         da quando le chat si affiancano. -->
    <button class="bell" class:off={!store.helperOn}
      title="Helper — a quick question, on the side" aria-label="Helper"
      onclick={() => void store.toggleHelper()}>
      <Icon name="i-chat" />
    </button>
    <!-- Il telefono sta qui, accanto a campanella e helper, e non nella barra di una
         conversazione: collegare un telefono è della **macchina**, non della chat che
         hai aperto — e dal telefono si arriva comunque all'elenco intero. -->
    <button class="bell" title="Use STARK from your phone" aria-label="Use STARK from your phone"
      onclick={() => { store.refused = null; store.dialog = { kind: 'phone' } }}>
      <Icon name="i-phone" />
    </button>
    <button class="plus" title="New chat" aria-label="New chat"
      onclick={() => { store.refused = null; store.dialog = { kind: 'new' } }}>
      <Icon name="i-plus" />
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

  <button class="sidefoot" title="Settings"
    onclick={() => { store.refused = null; store.dialog = { kind: 'settings' } }}>
    <Icon name="i-gear" /> Settings
  </button>
</div>

<style>
  /* Le righe sono <button> perché si premono: il vestito viene da app.css, qui c'è
     solo ciò che serve a togliere l'aspetto di pulsante senza perderne il mestiere. */
  /* La casella di ricerca. `type="search"` per averla svuotabile da tastiera e
     riconoscibile dal browser; l'aspetto è tutto qui, perché il reset di WebKit
     porterebbe con sé una lente e una X di sistema che non c'entrano con nessuna
     delle due qui presenti. */
  .find {
    display: flex; align-items: center; gap: 6px;
    margin: 0 5px 6px; padding: 3px 6px;
    border: 1px solid var(--line); border-radius: 7px; background: var(--surface);
    color: var(--muted);
  }
  .find:focus-within { border-color: var(--accent); }
  .find input {
    flex: 1; min-width: 0; font: inherit; font-size: 11.5px;
    border: 0; background: none; color: var(--ink); outline: none; padding: 1px 0;
  }
  .find input::-webkit-search-decoration,
  .find input::-webkit-search-cancel-button { display: none; }
  .clr {
    display: flex; border: 0; background: none; padding: 0; cursor: pointer;
    color: var(--muted); flex: none;
  }
  .clr:hover { color: var(--ink); }

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

  .sit, .sidefoot, .plus, .bell {
    background: none;
    border: 0;
    width: 100%;
    font: inherit;
    color: inherit;
  }
  /* Niente `padding` qui dentro. Ce n'era uno a zero, e vinceva su quello di `app.css`
     — `.plus.svelte-xxx` e `.sidetop .plus` hanno la stessa specificità, quindi decide
     l'ordine, e lo stile del componente viene dopo. Risultato: area premibile grande
     quanto l'icona, e i 4px con cui è calcolato il margine destro della testata
     semplicemente non c'erano. È la stessa trappola già registrata per `.seg` in
     Settings.svelte: due fogli che si contendono la stessa proprietà, e quello che
     sembra la fonte non lo è. La forma di questi bottoni sta tutta in `app.css`. */
  .plus, .bell { width: auto; display: flex; cursor: pointer; }
  /* Il puntino dice che il browser non ha ancora dato il permesso, e che premendo lo
     si chiede. Non è un errore: il suono intanto funziona già. */
  .bell { position: relative; }
  .bell .ask {
    position: absolute; top: -1px; right: -1px; width: 5px; height: 5px;
    border-radius: 50%; background: var(--accent);
  }
  .sit { width: calc(100% - 10px); }
  .sit:focus-visible, .sidefoot:focus-visible, .plus:focus-visible, .bell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .sidefoot { cursor: pointer; }
  .rn {
    width: 100%; font: inherit; font-size: 11.5px; font-weight: 600;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 5px;
    background: var(--surface); color: var(--ink); outline: none;
  }
</style>
