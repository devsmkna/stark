<script lang="ts">
  import Sprite from './components/Sprite.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Helper from './components/Helper.svelte'
  import Conversation from './components/Conversation.svelte'
  import Effects from './components/Effects.svelte'
  import NewChat from './components/NewChat.svelte'
  import Settings from './components/Settings.svelte'
  import Todo from './components/Todo.svelte'
  import Icon from './components/Icon.svelte'
  import Workspace from './components/Workspace.svelte'
  import { Store } from './lib/store.svelte.ts'

  const store = new Store()

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

  const menuRow = $derived(store.menu ? store.rows.find(r => r.id === store.menu?.id) : undefined)

  // §8 di docs/ui-schermate.md, deciso il 24 agosto 2026: sotto la soglia stretta non
  // ci sono due colonne rimpicciolite, ce n'è una alla volta — come WhatsApp e
  // Telegram. L'elenco è la schermata quando non c'è una chat aperta; la chat (o gli
  // effetti, o «sta aprendo», o l'errore di collegamento) la sostituisce quando c'è.
  // Larga, invece, sono sempre affiancate: sono questi due booleani a fare tutta la
  // differenza, il resto del template sotto non cambia.
  // Su schermo stretto l'helper e' una schermata, non una colonna: un sesto di
  // telefono non e' una chat, e' una colonna di sillabe. Prende il posto di tutto,
  // come le impostazioni. Su schermo largo si affianca e non toglie niente a nessuno.
  const soloHelper = $derived(store.narrow && store.helperOn)
  const showList = $derived(!soloHelper && (!store.narrow || (store.selected === null && !store.fatal)))
  const showRight = $derived(!soloHelper && (!store.narrow || store.selected !== null || !!store.fatal))
</script>

<Sprite />

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
      <div class="mid">
        <div>
          <p><b>The daemon is not answering.</b></p>
          <p>STARK keeps trying. If you stopped it, start it again with
          <code>npm run stark:start</code>: this tab reconnects on its own, and the
          address stays the same.</p>
        </div>
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
      <div class="mid">Opening…</div>
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

    <!-- Sotto la soglia stretta la colonna non c'è: 258px su 390 sarebbero due terzi
         dello schermo per una cosa che si guarda di sfuggita, e §8 di ui-schermate.md
         dice che lì si mostra una schermata alla volta. La preferenza resta salvata,
         quindi tornando su uno schermo largo la colonna si ritrova aperta. -->
    {#if store.todoOpen && !store.narrow}
      <Todo {store} />
    {/if}

    <!-- L'helper: terzo figlio di `.shell`, **fuori** dall'albero dei pannelli. Non e'
         una chat del lavoro — non si dispone, non si salva, non si ritrova — quindi
         metterlo dentro `layout` avrebbe voluto dire insegnare all'albero un'eccezione.
         Sotto la soglia stretta `soloHelper` ha gia' spento gli altri due, e questo
         resta solo in scena. -->
    {#if store.helperOn}
      <Helper {store} />
    {/if}
  {/if}

  <!-- Le azioni stanno dove sta l'oggetto: col tasto destro sulla riga. Non esiste
       una schermata «modifica chat» perché, con cartella e agent bloccati per
       costruzione, sarebbe un contenitore con dentro un campo solo. -->
  {#if store.menu && menuRow}
    <div class="ctx-menu" style="left:{store.menu.x}px;top:{store.menu.y}px">
      <!-- Sta in cima e ha una riga sua perché è l'unica voce che NON agisce su questa
           chat: agisce sul suo progetto. Aprire la seconda conversazione su una cartella
           su cui stai già lavorando non deve passare da «New chat» e da un percorso da
           ritrovare — la cartella la sa già la riga su cui hai premuto. -->
      <button class="mi" disabled={!menuRow.cwd}
        title={menuRow.cwd ?? 'This chat has no folder: there is nothing to open another one in'}
        onclick={() => {
          const cwd = menuRow.cwd
          store.menu = null
          store.refused = null
          if (!cwd) return
          // Il profilo Claude del progetto lo rilegge `newChat` da sé, come fa `wake()`:
          // senza, la seconda chat partirebbe con la `CLAUDE_CONFIG_DIR` di default e
          // sembrerebbe rotta senza motivo apparente.
          void store.newChat(cwd).then(() => {
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
      <hr />
      <button class="mi" onclick={() => { store.renaming = menuRow.id; store.menu = null }}>
        <Icon name="i-pencil" /> Rename
      </button>
      <button class="mi" disabled={!menuRow.live}
        title={menuRow.live ? 'Frees memory, not quota' : 'Already stopped'}
        onclick={() => { const id = menuRow.id; store.menu = null; void store.sleep(id) }}>
        <Icon name="i-moon" /> Put to sleep
      </button>
      <hr />
      <button class="mi dgr"
        onclick={() => { store.dialog = { kind: 'delete', row: menuRow }; store.menu = null }}>
        <Icon name="i-trash" /> Delete
      </button>
    </div>
    <div class="catch" role="presentation" onclick={() => { store.menu = null }}
      oncontextmenu={e => { e.preventDefault(); store.menu = null }}></div>
  {/if}

  {#if store.dialog?.kind === 'settings'}
    <Settings {store} />
  {:else if store.dialog?.kind === 'new'}
    <NewChat {store} />
  {:else if store.dialog?.kind === 'delete'}
    {@const row = store.dialog.row}
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
</div>

<!-- L'audio parte sospeso finché l'utente non tocca la pagina: è una regola del
     browser, non una scelta nostra. Il primo gesto qualunque lo sblocca, così il primo
     lavoro che finisce si sente davvero invece di essere il gesto che sblocca e basta. -->
<svelte:document
  onpointerdown={() => store.calls.unlock()}
  onkeydown={e => {
    store.calls.unlock()
    if (e.key !== 'Escape') return
    if (store.menu) store.menu = null
    else if (store.dialog) store.dialog = null
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

  .btn { cursor: pointer; }
</style>
