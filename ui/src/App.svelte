<script lang="ts">
  import Sprite from './components/Sprite.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Conversation from './components/Conversation.svelte'
  import Effects from './components/Effects.svelte'
  import NewChat from './components/NewChat.svelte'
  import Icon from './components/Icon.svelte'
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
    const apply = (): void => { store.narrow = mq.matches }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  })

  const menuRow = $derived(store.menu ? store.rows.find(r => r.id === store.menu?.id) : undefined)
</script>

<Sprite />

<div class="shell">
  {#if !store.hasToken}
    <div class="mid">
      <div>
        <p><b>No token.</b></p>
        <p>Open the address <code>npm run stark</code> prints when it starts. It carries the
        token once; STARK moves it into a cookie and clears it from the address bar.</p>
      </div>
    </div>
  {:else}
    <Sidebar {store} />

    {#if store.fatal}
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
    {:else if store.snap && store.view === 'effects'}
      <Effects {store} snap={store.snap} />
    {:else if store.snap}
      <Conversation {store} snap={store.snap} link={store.link} />
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
  {/if}

  <!-- Le azioni stanno dove sta l'oggetto: col tasto destro sulla riga. Non esiste
       una schermata «modifica chat» perché, con cartella e agent bloccati per
       costruzione, sarebbe un contenitore con dentro un campo solo. -->
  {#if store.menu && menuRow}
    <div class="ctx-menu" style="left:{store.menu.x}px;top:{store.menu.y}px">
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

  {#if store.dialog?.kind === 'new'}
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
        <button class="btn dgr" onclick={() => { store.dialog = null; void store.remove(row.id) }}>
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
