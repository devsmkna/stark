<script lang="ts">
  import Sprite from './components/Sprite.svelte'
  import Sidebar from './components/Sidebar.svelte'
import Helper from './components/Helper.svelte'
import Splash from './components/Splash.svelte'
import AgentPanel from './components/AgentPanel.svelte'
import Board from './components/Board.svelte'
import Conversation from './components/Conversation.svelte'
import Effects from './components/Effects.svelte'
import NewChat from './components/NewChat.svelte'
import Phone from './components/Phone.svelte'
import Settings from './components/Settings.svelte'
import Todo from './components/Todo.svelte'
  import Icon from './components/Icon.svelte'
  import Workspace from './components/Workspace.svelte'
  import Palette from './components/Palette.svelte'
  import { Store } from './lib/store.svelte.ts'
  import type { SessionRow } from './lib/api.ts'
  import { AZIONI, combos } from './lib/actions.ts'
  import { matches, parse } from './lib/shortcuts.ts'
  import { zoomRoot } from './lib/zoom.ts'

  const store = new Store()

  /**
   * L'unico gancio da tastiera dell'app: guarda il registro delle azioni e, se la
   * combinazione corrisponde, la esegue.
   *
   * La regola che vale più del codice: dentro una casella di testo una scorciatoia
   * **senza `mod` non scatta**. Una lettera nuda è testo, e prendersela vorrebbe dire
   * che scrivendo un prompt si aprono finestre da sole; con `mod` invece deve scattare
   * eccome, se no ⌘K morirebbe proprio dove si sta il 90% del tempo — nella casella.
   */
  function scorciatoia(e: KeyboardEvent): void {
    const dentroTesto = (() => {
      const t = e.target as HTMLElement | null
      if (!t) return false
      const tag = t.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
    })()
    const mappa = combos(store.settings?.shortcuts)
    for (const a of AZIONI) {
      const c = parse(mappa[a.id])
      if (!c) continue
      if (dentroTesto && !c.mod) continue
      if (!matches(e, c)) continue
      e.preventDefault()
      esegui(a.id)
      return
    }
  }

  function esegui(id: string): void {
    if (id === 'board') { store.toggleBoard(); return }
    if (id !== 'palette') return
    // Premerla di nuovo mentre è aperta la chiude: è la stessa combinazione, e
    // riaprirla sopra sé stessa non vuol dire niente.
    store.dialog = store.dialog?.kind === 'palette' ? null : { kind: 'palette' }
  }

  $effect(() => {
    void store.start()
    return () => store.dispose()
  })

  // Sotto una certa larghezza l'affiancato non ci sta: là non si rimpicciolisce, si
  // cambia forma (docs/ui-schermate.md §4). Un ascoltatore solo per tutta l'app.
  $effect(() => {
    const mq = matchMedia('(max-width: 860px)')
    const apply = (): void => {
      store.narrow = mq.matches
      // Bottoni e testo pensati per un mouse sono piccoli sotto un dito: la stessa
      // soglia che cambia la forma della schermata (§8) alza anche la dimensione.
      store.textSize.refresh(store.narrow)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  })

  // Lo splash di apertura non deve fare lampi su un'apertura istantanea: quando
  // `aprendo` sale, si aspetta 150 ms prima di mostrarsi — se nel frattempo l'apertura
  // è finita non compare proprio. È un contatore, non un booleano, perché `select`,
  // `splitPane` e `scegliSplit` si annidano: solo lo zero vuol dire «davvero finito».
  let mostroApertura = $state(false)
  $effect(() => {
    if (store.aprendo > 0) {
      const handle = setTimeout(() => { mostroApertura = true }, 150)
      return () => { clearTimeout(handle); mostroApertura = false }
    }
    mostroApertura = false
  })

  const menuRow = $derived(store.menu ? store.rows.find(r => r.id === store.menu?.id) : undefined)

  // Dove disegnare il menu del tasto destro. Non è `store.menu` così com'è: quelle
  // sono le coordinate del puntatore, cioè **pixel veri della finestra**, mentre un
  // `left` scritto su un elemento dentro il root zoomato è in unità del root. Al 135%
  // dello schermo stretto il menu finiva a 1,35 volte la distanza dall'angolo — misurato
  // in Chromium: clic a (189, 290), menu disegnato a (255, 391). Vedi lib/zoom.ts.
  let menuEl = $state<HTMLElement | null>(null)
  let menuPos = $state<{ x: number, y: number } | null>(null)

  // La misura vera dell'elemento serve solo per l'altra metà: un menu aperto in fondo
  // all'elenco sfonderebbe il bordo, e le sue ultime voci non si potrebbero premere.
  // Il rettangolo è già in pixel veri, quindi il confronto con la finestra è diretto e
  // la divisione arriva una volta sola, alla fine.
  $effect(() => {
    const m = store.menu
    const el = menuEl
    if (!m || !el) { menuPos = null; return }
    const f = zoomRoot()
    const r = el.getBoundingClientRect()
    const bordo = 6
    const x = Math.max(bordo, Math.min(m.x, window.innerWidth - r.width - bordo))
    const y = Math.max(bordo, Math.min(m.y, window.innerHeight - r.height - bordo))
    menuPos = { x: x / f, y: y / f }
  })

  // §8 di docs/ui-schermate.md, deciso il 24 agosto 2026: sotto la soglia stretta non
  // ci sono due colonne rimpicciolite, ce n'è una alla volta — come WhatsApp e
  // Telegram. L'elenco è la schermata quando non c'è una chat aperta; la chat (o gli
  // effetti, o «sta aprendo», o l'errore di collegamento) la sostituisce quando c'è.
  // Larga, invece, sono sempre affiancate: sono questi due booleani a fare tutta la
  // differenza, il resto del template sotto non cambia.
  // Pannello agente unificato (TODOs + Chat) — su stretto prende tutto.
  const rightOpen = $derived(store.todoOpen || store.helperOn)
  const soloPanel = $derived(store.narrow && rightOpen)
  // retrocompat: vecchio soloHelper usato solo per decidere layout stretto
  const soloHelper = $derived(soloPanel)
  const showList = $derived(!soloPanel && (!store.narrow || (store.selected === null && !store.fatal)))
  const showRight = $derived(!soloPanel && (!store.narrow || store.selected !== null || !!store.fatal))
</script>

<Sprite />

<!-- ─── c'è una versione nuova ──────────────────────────────────────────────────
     In cima e per tutta la larghezza, non dentro la barra laterale come la banda della
     quota: quella parla delle **chat** che si sono fermate, e sta accanto all'elenco
     delle chat. Questa parla dell'installazione intera, che non appartiene a nessuna
     delle due colonne.
     Compare solo se il daemon, accendendosi, ha visto una **release** più nuova di
     quella su disco: un push su `main` non fa comparire niente (vedi core/release.ts).
     Si può chiudere, e resta chiusa per quella versione: ricorda senza insistere. -->
{#if store.mostraAggiornamento}
  <div class="upd" role="status">
    <!-- `i-import` e non `i-down`: il secondo e' un chevron, cioe' «apri», e qui non
         c'e' niente da aprire. Questo e' la freccia che scende dentro un contenitore —
         l'icona che ovunque vuol dire «scarica». -->
    <Icon name={store.aggiornamentoInCorso ? 'i-loader' : 'i-import'} />
    <div class="ut">
      {#if store.aggiornamentoInCorso}
        Updating to {store.aggiornamento?.ultima}… STARK restarts and this tab reloads.
      {:else}
        <!-- Da telefono restano le parole che dicono il fatto: quale versione c'e'.
             Quella che si ha e' scritta nelle impostazioni, e su una riga larga 390px
             costava tre righe su quattro. `&nbsp;` e non uno spazio normale: Svelte
             taglia lo spazio iniziale dentro un elemento, e senza questo le due meta'
             si attaccherebbero su schermo largo (stessa trappola gia' trovata sul chip
             del contesto nella barra di stato). -->
        STARK <b>{store.aggiornamento?.ultima}</b> is available<span class="lbl"
          >&nbsp;— you have {store.aggiornamento?.installata}</span>.
      {/if}
    </div>
    {#if !store.aggiornamentoInCorso}
      <button class="ub" onclick={() => void store.aggiorna()}
        >Update<span class="lbl">&nbsp;to the last version</span></button>
      <!-- Il comando c'è comunque, e non è una ripetizione del bottone: il riavvio del
           daemon passa da `/bin/sh` (riavvio.ts), quindi su Windows nativo il bottone
           non ha ancora una strada. Lì questa riga è l'unica via, e vale la pena che ci
           sia per tutti invece di comparire solo dove serve. -->
      <code class="uc">stark update</code>
      <button class="ux" title="Not now" aria-label="Dismiss"
        onclick={() => store.chiudiAggiornamento()}><Icon name="i-x" /></button>
    {/if}
  </div>
{/if}

<div class="shell">
  <!-- Si prova comunque, e ci si arrende solo se il daemon dice davvero di no.
       Prima bastava non avere un token **in memoria** per fermarsi qui — ma il token non
       è l'unico modo di essere autenticati: c'è anche il cookie, che il daemon accetta e
       che dura un giorno. Su iOS è esattamente il caso dell'app della schermata Home, che
       ha una memoria separata da Safari: il cookie ce l'ha, il token no. La pagina si
       caricava (quindi il cookie funzionava) e la UI si rifiutava di provare lo stesso,
       mostrando «No token» sopra un daemon perfettamente raggiungibile.
       Segnalato dall'utente con uno screenshot, 26 agosto 2026. Adesso il messaggio
       compare solo dopo un rifiuto vero — `refusedAuth`, cioè un 403 all'apertura. -->
  {#if store.refusedAuth}
    <div class="mid">
      <div>
        <p><b>No token.</b></p>
        <p>Open the address <code>stark</code> prints when it starts. It carries the
        token once; STARK moves it into a cookie and clears it from the address bar.</p>
      </div>
    </div>
  {:else}
    {#if showList}
      <Sidebar {store} />
    {/if}

    {#if !showRight}
      <!-- Schermo stretto, niente selezionato: la lista sopra è già tutta la
           schermata, e ripetere qui «pick a chat» sarebbe una seconda voce che dice
           la stessa cosa mentre non si vede nemmeno. -->
    {:else if store.fatal}
      <!-- Il testo era «The daemon is not answering: the daemon is not answering»: il
           motivo dal negozio ripeteva la frase del riquadro. Qui la frase sta in un
           posto solo, e dice anche cosa fare — che è l'unica cosa utile in quel momento. -->
      <!-- Durante un aggiornamento il daemon **deve** essere giù: è il momento in cui si
           spegne per riaccendersi col codice nuovo. Il testo di sotto manderebbe a
           riavviarlo a mano, cioè a fare esattamente la cosa sbagliata proprio mentre
           tutto sta funzionando. Trovato guardando lo screenshot del giro vero, non
           leggendo il codice: la banda in cima diceva «STARK restarts», e due righe
           sotto la pagina diceva il contrario. -->
      <div class="mid">
        {#if store.aggiornamentoInCorso}
          <div>
            <p><b>Updating.</b></p>
            <p>STARK is off for a moment — it comes back on its own, and this tab
            reloads. Nothing to do.</p>
          </div>
        {:else}
          <div>
            <p><b>The daemon is not answering.</b></p>
            <p>STARK keeps trying. If you stopped it, start it again with
            <code>npm run stark:start</code>: this tab reconnects on its own, and the
            address stays the same.</p>
          </div>
        {/if}
      </div>
    <!-- Schermo largo: il posto della conversazione lo prende l'albero, **anche con
         una foglia sola**. Non è una cornice in più — con un pannello solo `Workspace`
         non disegna niente attorno alla chat (niente `×`, niente riga di fuoco) — ma è
         l'unico modo di avere una zona di rilascio su cui trascinare la seconda: senza,
         da una chat sola non si potrebbe mai arrivare a due.
         Sotto la soglia stretta il layout è ignorato del tutto (§8 di
         ui-schermate.md): si vede solo il pannello a fuoco, col template di sempre. -->
    {:else if !store.narrow && store.layout}
      <Workspace {store} />
    {:else if store.snap && store.view === 'effects'}
      <Effects {store} snap={store.snap} id={store.selected ?? ''} setView={v => store.show(v)} />
    {:else if store.snap}
      <Conversation {store} snap={store.snap} link={store.link}
        id={store.selected ?? ''} setView={v => store.show(v)} />
    {:else if store.selected}
      <Splash message="Opening…" />
    {:else if !store.loaded}
      <Splash message="Starting…" />
    {:else if store.loaded && store.rows.length === 0}
      <div class="mid">
        <div>
          <p><b>No chats yet.</b></p>
          <p>Press <b>+</b> at the top left to start one, or run <code>npm run slice</code>
          in a terminal.</p>
        </div>
      </div>
    {:else}
      <!-- Il messaggio di rifiuto vive nel blocco in basso, che senza una chat aperta
           non c'è: un indirizzo che punta a una conversazione cancellata rimbalzava qui
           in silenzio, e sembrava che il tasto non avesse fatto niente. -->
      <div class="mid">
        {#if store.refused}
          <div>
            <p><b>{store.refused}</b></p>
            <p>Pick a chat on the left.</p>
          </div>
        {:else}Pick a chat on the left.{/if}
      </div>
    {/if}

    <!-- Pannello agente unificato: rispetta il design screenshot (card scura, pill TODOs/Chat). -->
    {#if soloPanel}
      <AgentPanel {store} />
    {:else if rightOpen && !store.narrow}
      <AgentPanel {store} />
    {/if}
  {/if}

  <!-- Le azioni stanno dove sta l'oggetto: col tasto destro sulla riga — o, dove il
       tasto destro non c'è, con la pressione lunga (`lib/longpress.ts`). Non esiste
       una schermata «modifica chat» perché, con cartella e agent bloccati per
       costruzione, sarebbe un contenitore con dentro un campo solo. -->
  {#snippet vociMenu(row: SessionRow)}
    <!-- Sta in cima e ha una riga sua perché è l'unica voce che NON agisce su questa
         chat: agisce sul suo progetto. Aprire la seconda conversazione su una cartella
         su cui stai già lavorando non deve passare da «New chat» e da un percorso da
         ritrovare — la cartella la sa già la riga su cui hai premuto. -->
    <button class="mi" disabled={!row.cwd}
      title={row.cwd ?? 'This chat has no folder: there is nothing to open another one in'}
      onclick={() => {
        const cwd = row.cwd
        store.menu = null
        store.refused = null
        if (!cwd) return
        // Il profilo Claude del progetto lo rilegge `newChat` da sé, come fa `wake()`:
        // senza, la seconda chat partirebbe con la `CLAUDE_CONFIG_DIR` di default e
        // sembrerebbe rotta senza motivo apparente.
        // Modello e agent li porta dietro la riga: «qui» vuol dire nello stesso
        // progetto **e** con lo stesso modello — e il model id appartiene all'agent
        // che l'ha dichiarato, quindi si portano insieme.
        void store.newChat(cwd, {
          ...(row.model ? { model: row.model } : {}),
          ...(row.agent ? { agent: row.agent } : {}),
        }).then(() => {
          // Se non si è aperta — la cartella è stata cancellata nel frattempo — il
          // motivo va letto da qualche parte. `store.refused` si vede nel blocco di
          // scrittura, che però esiste solo se una conversazione è aperta: senza
          // questo, con l'elenco a fuoco e nessuna chat aperta, il clic non farebbe
          // niente e non lo direbbe. La modale lo mostra, ed è anche il posto in cui
          // si corregge il percorso.
          if (store.refused) store.dialog = { kind: 'new' }
        })
      }}>
      <Icon name="i-plus" /> New chat here
    </button>
    <button class="mi" disabled={store.narrow}
      title={store.narrow ? 'This screen is too narrow for split view' : undefined}
      onclick={() => {
        const id = row.id
        store.menu = null
        // Chat già aperta: la divisione si apre accanto a lei, con a destra il
        // selettore di che ci va — la chat resta a sinistra. Chat chiusa: è lei
        // ad andare a destra, accanto a quella a fuoco.
        if (store.panes.has(id)) store.apriSceltaSplit(id)
        else void store.openPane(id)
      }}>
      <Icon name="i-panel" /> Add to split view
    </button>
    <hr />
    <button class="mi" onclick={() => { store.renaming = row.id; store.menu = null }}>
      <Icon name="i-pencil" /> Rename
    </button>
    <button class="mi" disabled={row.state === 'sleeping'}
      title={row.state === 'sleeping' ? 'Already sleeping'
        : row.live ? 'Frees memory, not quota'
        : 'Nothing is running: it just moves under Sleeping'}
      onclick={() => { const id = row.id; store.menu = null; void store.sleep(id) }}>
      <Icon name="i-moon" /> Put to sleep
    </button>
    <hr />
    <button class="mi dgr"
      onclick={() => { store.dialog = { kind: 'delete', row }; store.menu = null }}>
      <Icon name="i-trash" /> Delete
    </button>
  {/snippet}

  {#if store.menu && menuRow}
    {#if store.narrow}
      <!-- Da tocco il menu non sta sotto il dito: sta in fondo allo schermo, dove il
           pollice arriva. Porta il titolo della chat perché la riga può essere fuori
           vista — un menu in fondo deve saper dire a chi si riferisce. -->
      <div class="sheet" role="menu">
        <div class="grab" role="presentation"></div>
        <div class="shead">{menuRow.title}</div>
        {@render vociMenu(menuRow)}
      </div>
    {:else}
      <!-- La prima posizione è già quella giusta rispetto al cursore: l'effetto qui
           sopra la ritocca solo se il menu sfonda un bordo, così non c'è un fotogramma
           in cui compare nell'angolo sbagliato. -->
      <div class="ctx-menu" bind:this={menuEl}
        style="left:{(menuPos?.x ?? store.menu.x / zoomRoot())}px;top:{(menuPos?.y ?? store.menu.y / zoomRoot())}px">
        {@render vociMenu(menuRow)}
      </div>
    {/if}
    <div class="catch" role="presentation" onclick={() => { store.menu = null }}
      oncontextmenu={e => { e.preventDefault(); store.menu = null }}></div>
  {/if}

  {#if store.dialog?.kind === 'palette'}
    <Palette {store} />
  {:else if store.dialog?.kind === 'settings'}
    <Settings {store} />
  {:else if store.dialog?.kind === 'new'}
    <NewChat {store} />
  {:else if store.dialog?.kind === 'phone'}
    <Phone {store} />
  {:else if store.dialog?.kind === 'delete'}    {@const row = store.dialog.row}
    <div class="scrim" role="presentation" onclick={() => { store.dialog = null }}></div>
    <div class="dlg" style="width:380px">
      <div class="dlgh"><div class="dt">Delete this chat?</div></div>
      <div class="dlgb">
        <div class="hint" style="font-size:11px">
          <b>{row.title}</b>
        </div>
        <!-- Nessun cestino: il journal è la conversazione, e cancellarlo la cancella. -->
        <div class="warn">
          <Icon name="i-warn" />
          <span>This removes its journal — the whole history, {row.turns}
            {row.turns === 1 ? 'turn' : 'turns'}. There is no undo.</span>
        </div>
      </div>
      <div class="dlgf">
        <button class="btn" onclick={() => { store.dialog = null }}>Cancel</button>
        <button class="btn dgr" onclick={() => { const id = row.id; store.dialog = null; void store.remove(id) }}>
          Delete
        </button>
      </div>
    </div>
  {/if}

  <!-- Il «modo» board: una vista a tutto schermo, come le impostazioni. Non è un
       dialog (non c'è un `kind`): è un modo che si apre e si chiude col bottone. -->
  {#if store.boardOpen}
    <Board {store} />
  {/if}

  <!-- L'apertura di una chat che dura (da telefono, su rete lenta) copre tutto con lo
       splash: finché `aprendo` non torna a zero il riquadro non deve mostrare nulla di
       in mezzo — la lista dietro non è ancora quella giusta. -->
  {#if mostroApertura}
    <Splash />
  {/if}
</div>

<!-- L'audio parte sospeso finché l'utente non tocca la pagina: è una regola del
     browser, non una scelta nostra. Il primo gesto qualunque lo sblocca, così il primo
     lavoro che finisce si sente davvero invece di essere il gesto che sblocca e basta. -->
<svelte:document
  onpointerdown={() => store.calls.unlock()}
  onkeydown={e => {
    store.calls.unlock()
    if (e.key === 'Escape') {
      if (store.menu) store.menu = null
      else if (store.dialog) store.dialog = null
      return
    }
    scorciatoia(e)
  }} />

<style>
  .mid p { margin: 0 0 8px; max-width: 46ch; }

  /* Il menu è ancorato al puntatore, quindi alla finestra e non al documento:
     l'elenco scorre sotto, e un menu che scorresse con lui punterebbe a una riga
     diversa da quella su cui è stato aperto. */
  .ctx-menu { position: fixed; }
  .ctx-menu .mi {
    width: 100%; border: 0; background: none; font: inherit; text-align: left; cursor: pointer;
  }
  .ctx-menu .mi:not([disabled]):hover { background: var(--surface-2); }
  .ctx-menu .mi[disabled] { opacity: .45; cursor: default; }
  .ctx-menu .mi:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  /* Sotto il menu, e sopra tutto il resto: il primo clic altrove lo chiude e basta. */
  .catch { position: fixed; inset: 0; z-index: 5; }

  /* Da tocco il menu è un foglio in fondo allo schermo, non un popup sotto il dito:
     il pollice coprirebbe le voci, e un tocco che manca il bersaglio stretto è il
     gesto più facile sbagliare. Z-index sopra il `.catch`, come il menu largo. */
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 6;
    background: var(--surface);
    border: 1px solid var(--line-2); border-bottom: 0;
    border-radius: 14px 14px 0 0;
    padding: 4px 6px max(8px, env(safe-area-inset-bottom));
    box-shadow: 0 -12px 40px rgba(16,20,32,.25);
    animation: salire .16s ease-out;
  }
  @keyframes salire { from { transform: translateY(40%); opacity: .5 } }
  /* La maniglia: dice «questo è un foglio» prima ancora di leggere niente. */
  .grab { width: 36px; height: 4px; border-radius: 999px; background: var(--line-2); margin: 4px auto 6px; }
  .shead {
    font-size: 11px; font-weight: 600; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    padding: 2px 8px 7px; border-bottom: 1px solid var(--line); margin-bottom: 3px;
  }
  /* Voci alte: sotto un dito, mirare una riga da 20px è il gesto che manca. */
  .sheet .mi { padding: 12px 10px; font-size: 13.5px; border-radius: 10px; }
  .sheet hr { margin: 3px 6px; }

  .btn { cursor: pointer; }
</style>
