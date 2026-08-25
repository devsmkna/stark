<script lang="ts">
  // Le due porte per aggiungere un lavoro all'elenco, nello stesso riquadro.
  //
  // Perché due linguette e non una tendina sul `+`. Il `+` vuol dire «aggiungi una riga»
  // e le due strade fanno esattamente quello, quindi nessuna delle due merita di stare
  // un passo più indietro dell'altra. Ma soprattutto: una tendina si apre solo se sai
  // già che c'è qualcosa da scegliere, e chi non sa che STARK può riprendere una
  // conversazione nata nel terminale non andrà a cercarla lì. Con le linguette la
  // seconda porta **si vede**, e l'elenco di ciò che c'è da importare è la scoperta.
  //
  // «Niente opzioni qui» resta valido per la prima: modello, modalità e server MCP
  // servono *mentre* si lavora e si cambiano a caldo, dalla barra sotto la casella.
  //
  // Il profilo Claude è diverso e per questo sta qui: non si cambia a caldo (è una
  // `CLAUDE_CONFIG_DIR`, letta una volta sola all'avvio del processo figlio), e come
  // la cartella decide un'identità che dura quanto il progetto — non quanto la singola
  // conversazione. Compare **solo** quando serve davvero: la macchina ha più di un
  // profilo E questa cartella non ne ha già uno deciso (docs/ui-schermate.md §Projects).
  import Icon from './Icon.svelte'
  import { colours, hhmm, project } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import type { SystemInfo } from '../lib/api.ts'

  let { store }: { store: Store } = $props()

  let cwd = $state('')
  let chosen = $state<string | null>(null)
  let filter = $state('')

  // ─── il profilo, solo se c'è davvero una scelta da fare ────────────────────
  let profiles = $state<SystemInfo['agent']['profiles'] | null>(null)
  let profilePick = $state<string | null>(null)
  $effect(() => {
    if (store.tab === 'new' && profiles === null) {
      void store.api.system().then(
        s => { profiles = s.agent.profiles },
        () => { profiles = [] },
      )
    }
  })
  // Assente vuol dire «non ancora deciso per questa cartella»: se STARK la conosce
  // già e ha un profilo salvato, non si chiede di nuovo — è deciso.
  const savedProfile = $derived(store.project(cwd.trim()).profile)
  const showProfiles = $derived(cwd.trim().length > 0 && !savedProfile && (profiles?.length ?? 0) > 1)
  const effectiveProfile = $derived(
    profilePick ?? profiles?.find(p => p.current)?.path ?? profiles?.[0]?.path ?? null,
  )

  // ─── il dialogo «apri path» ─────────────────────────────────────────────
  // Il daemon gira come root e ha già accesso a tutto il filesystem (ADR-002):
  // mancava solo la rotta per elencarlo, non il permesso. Vedi `registry.browse`.
  let browsing = $state(false)
  let browsePath = $state('')
  let browseDirs = $state<string[]>([])
  let browseParent = $state<string | null>(null)
  let browseError = $state('')
  let browseLoading = $state(false)

  async function loadBrowse(path?: string): Promise<void> {
    browseLoading = true
    try {
      const r = await store.api.browse(path)
      browsePath = r.path
      browseParent = r.parent
      browseDirs = r.dirs
      browseError = r.error ?? ''
    } catch (e) {
      browseError = (e as Error).message
    } finally {
      browseLoading = false
    }
  }
  function openBrowse(): void {
    browsing = true
    void loadBrowse(cwd.trim() || undefined)
  }
  function useThisFolder(): void {
    cwd = browsePath
    browsing = false
  }

  // Le cartelle già viste, dalla più recente. Non sono una comodità: la cartella
  // decide il progetto e il suo colore, e riscriverla a mano è il modo più facile di
  // creare un progetto nuovo per un carattere di differenza.
  const recents = $derived.by(() => {
    const seen = new Set<string>()
    for (const r of [...store.rows].sort((a, b) => b.lastTs - a.lastTs)) {
      if (r.cwd) seen.add(r.cwd)
    }
    return [...seen].slice(0, 6)
  })

  // Lo stesso colore che il progetto ha nell'elenco: la pastiglia serve a
  // riconoscerlo senza leggere, e un colore diverso qui non riconoscerebbe niente.
  //
  // Un progetto che STARK non ha ancora **non prende un colore**, e prende un cerchio
  // vuoto. La tavolozza si assegna in ordine alfabetico su tutti i progetti noti:
  // aggiungerne uno qui sposterebbe il colore di quelli già nell'elenco, e un colore
  // che cambia da solo non identifica più niente.
  const palette = $derived(colours(store.rows))
  const known = (cwd: string | undefined): number | undefined => palette.get(project(cwd))

  const ready = $derived(cwd.trim().length > 0 && !store.working)

  function start(): void {
    if (ready) {
      void store.newChat(cwd.trim(), showProfiles && effectiveProfile ? { profile: effectiveProfile } : {})
    }
  }

  function goto(tab: 'new' | 'import'): void {
    store.tab = tab
    store.refused = null
    // Si richiede aprendo la linguetta e non all'avvio: legge dei file da disco, e chi
    // non importa mai non deve pagarlo.
    if (tab === 'import' && store.importable === null) void store.loadImportable()
  }

  const shown = $derived.by(() => {
    const rows = store.importable ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.title.toLowerCase().includes(q)
      || (r.firstPrompt ?? '').toLowerCase().includes(q)
      || (r.cwd ?? '').toLowerCase().includes(q))
  })

  const size = (n: number | undefined): string =>
    !n ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`

  function when(ts: number): string {
    const days = Math.floor((Date.now() - ts) / 86400000)
    return days >= 2 ? `${days} days ago` : (hhmm(ts) || new Date(ts).toLocaleDateString())
  }
</script>

<div class="scrim" role="presentation" onclick={() => { store.dialog = null }}></div>
<div class="dlg" style="width:{store.tab === 'import' ? 560 : 430}px">
  <div class="dlgh">
    <div>
      <div class="dt">{store.tab === 'new' ? 'New chat' : 'Import a conversation'}</div>
      <div class="ds">
        {store.tab === 'new'
          ? 'A folder is all it needs'
          : 'Started in the terminal, on this machine'}
      </div>
    </div>
    <div class="switch" style="margin-left:auto">
      <button class:on={store.tab === 'new'} onclick={() => goto('new')}>New</button>
      <button class:on={store.tab === 'import'} onclick={() => goto('import')}>Import</button>
    </div>
    <button class="x" aria-label="Close" onclick={() => { store.dialog = null }}>
      <Icon name="i-x" />
    </button>
  </div>

  {#if store.tab === 'new'}
    <div class="dlgb">
      <div class="fgroup">
        <div class="flabel">Agent</div>
        <div class="inst on"><span class="rd"></span><span class="nm">Claude Code</span>
          <span class="where"><Icon name="i-monitor" /> this machine</span></div>
        <div class="hint">One adapter in the MVP (ADR-004). A second agent is not hidden —
          it is not written yet.</div>
      </div>

      <div class="fgroup">
        <div class="flabel">Folder</div>
        <div class="pathrow">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field" autofocus bind:value={cwd} placeholder="/root/DevsMachna/stark"
            onkeydown={e => { if (e.key === 'Enter') start() }} />
          <button class="btn" type="button" onclick={openBrowse}>Open path…</button>
        </div>

        {#if browsing}
          <div class="browser">
            <div class="bpath" title={browsePath}>{browsePath}</div>
            <div class="blist">
              {#if browseParent !== null}
                <button class="brow up" type="button" onclick={() => void loadBrowse(browseParent ?? undefined)}>
                  <Icon name="i-folder" /> ..
                </button>
              {/if}
              {#each browseDirs as d (d)}
                <button class="brow" type="button"
                  onclick={() => void loadBrowse(`${browsePath.replace(/\/$/, '')}/${d}`)}>
                  <Icon name="i-folder" /> {d}
                </button>
              {/each}
              {#if !browseLoading && browseDirs.length === 0 && !browseError}
                <div class="mid" style="padding:14px 4px">No subfolders here.</div>
              {/if}
            </div>
            {#if browseError}
              <div class="warn" style="margin-top:6px"><Icon name="i-warn" /><span>{browseError}</span></div>
            {/if}
            <div class="bactions">
              <button class="btn" type="button" onclick={() => { browsing = false }}>Cancel</button>
              <button class="btn pri" type="button" onclick={useThisFolder}>Use this folder</button>
            </div>
          </div>
        {:else}
          {#if recents.length > 0}
            <div class="recents">
              {#each recents as r (r)}
                <button class="rec" onclick={() => { cwd = r }} title={r}>
                  <i class="dotk p{palette.get(project(r)) ?? 0}"></i> {project(r)}
                </button>
              {/each}
            </div>
          {/if}
          <div class="hint">The folder decides the project and its colour. Type the full path,
            or <b>Open path…</b> to browse the machine.</div>
        {/if}
      </div>

      {#if showProfiles}
        <div class="fgroup">
          <div class="flabel">Claude profile</div>
          {#each profiles ?? [] as p (p.path)}
            <button type="button" class="inst instbtn" class:on={effectiveProfile === p.path}
              onclick={() => { profilePick = p.path }}>
              <span class="rd"></span>
              <span class="nm">{p.name}</span>
              <span class="where">{p.conversations} {p.conversations === 1 ? 'chat' : 'chats'}
                {#if p.current}{' · current'}{/if}</span>
            </button>
          {/each}
          <div class="hint">This machine has more than one <code>CLAUDE_CONFIG_DIR</code> — login,
            MCP servers and memory differ by profile. <b>This project keeps whichever you pick</b>:
            the next chat on this folder won't ask again.</div>
        </div>
      {/if}

      {#if store.refused}
        <div class="warn"><Icon name="i-warn" /><span>{store.refused}</span></div>
      {/if}
    </div>

    <div class="dlgf">
      <button class="btn" onclick={() => { store.dialog = null }}>Cancel</button>
      <button class="btn pri" disabled={!ready} onclick={start}>
        {store.working ? 'Starting…' : 'Start'}
      </button>
    </div>

  {:else}
    <div class="dlgb" style="gap:7px">
      <div class="chips" style="margin-bottom:2px">
        <span class="chip ro"><span class="lab">Agent</span>Claude Code</span>
        <span class="chip srch">
          <Icon name="i-search" />
          <input class="find" bind:value={filter} placeholder="Search" />
        </span>
      </div>

      {#if store.importable === null}
        <div class="mid" style="padding:26px">Looking for conversations…</div>
      {:else if shown.length === 0}
        <div class="mid" style="padding:26px">
          {store.importable.length === 0
            ? 'No conversation from the terminal was found on this machine.'
            : 'Nothing matches that.'}
        </div>
      {:else}
        {#each shown as r (r.sessionId)}
          <button class="imp" class:on={chosen === r.sessionId} class:live={r.recent}
            disabled={r.already || !r.path}
            onclick={() => { chosen = r.sessionId }}>
            <span class="rd"></span>
            <div class="bd">
              <div class="t1">
                <span class="nm">{r.title}</span>
                <span class="pj">
                  {#if known(r.cwd) !== undefined}
                    <i class="dotk p{known(r.cwd)}"></i>
                  {:else}
                    <i class="dotk new" title="Not in STARK yet"></i>
                  {/if}
                  {project(r.cwd)}{#if r.branch}{' · '}{r.branch}{/if}
                </span>
              </div>
              <!-- Il primo prompt in evidenza, non il titolo: il titolo lo scrive il
                   modello e si somigliano tutti; la prima frase scritta da te è quella
                   che fa dire «ah, è quella». -->
              {#if r.firstPrompt}<div class="fp">“{r.firstPrompt}”</div>{/if}
              <div class="mt">
                {when(r.lastModified)}{#if r.sizeBytes}{' · '}{size(r.sizeBytes)}{/if}
                {#if r.already}{' · '}<b>already in STARK</b>{/if}
                {#if !r.path && !r.already}{' · '}<b>transcript file not found</b>{/if}
              </div>

              {#if r.recent && !r.already}
                <!-- Misurato, non prudenziale (P16): il disco resta coerente, i due
                     processi vivi divergono. Va detto adesso — dopo sarebbe tardi. -->
                <div class="warn" style="margin-top:4px">
                  <Icon name="i-warn" />
                  <span>Touched in the last few minutes, so it may be open in a terminal
                    right now. STARK can take it over and <b>nothing gets lost</b> — the
                    transcript on disk keeps both sides. But the two processes stop
                    seeing each other: whatever you do here, the terminal won't know.</span>
                </div>
              {/if}
            </div>
          </button>
        {/each}
      {/if}

      {#if store.refused}
        <div class="warn"><Icon name="i-warn" /><span>{store.refused}</span></div>
      {/if}
    </div>

    <div class="dlgf">
      <button class="btn" onclick={() => { store.dialog = null }}>Cancel</button>
      <button class="btn pri" disabled={!chosen || store.importing !== null}
        onclick={() => { if (chosen) void store.importChat(chosen) }}>
        {store.importing ? 'Importing…' : 'Import'}
      </button>
    </div>
  {/if}
</div>

<style>
  .x { background: none; border: 0; padding: 0; cursor: pointer; display: flex; color: var(--muted); }
  .rec, .btn { font: inherit; cursor: pointer; }
  .rec:focus-visible, .x:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* `.inst` esiste già per la riga «Claude Code», sempre sola e non cliccabile: qui
     serve anche come bottone, e i profili sono più di uno. */
  .instbtn { width: 100%; text-align: left; font: inherit; cursor: pointer; margin-bottom: 5px; }
  .instbtn:last-of-type { margin-bottom: 0; }
  .instbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  input.field { width: 100%; }
  .pathrow { display: flex; gap: 6px; }
  .pathrow .field { flex: 1; }
  .pathrow .btn { flex: none; white-space: nowrap; }

  /* Il browser di cartelle: stesso posto della casella che sostituisce, non un
     dialogo sopra il dialogo — aprirne un secondo sopra il primo per scegliere
     dove va il primo sarebbe esattamente la finestra dentro la finestra che il
     principio fondante di STARK vieta. */
  .browser {
    margin-top: 8px; border: 1px solid var(--line-2); border-radius: 8px;
    padding: 8px; background: var(--surface-2);
  }
  .bpath {
    font-family: var(--mono); font-size: 10px; color: var(--muted);
    margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .blist { max-height: 190px; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
  .brow {
    display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
    font: inherit; font-size: 11px; padding: 4.5px 6px; border-radius: 6px;
    background: none; border: 0; cursor: pointer; color: inherit;
  }
  .brow:hover { background: var(--surface-3); }
  .brow.up { color: var(--muted); }
  .brow:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .bactions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  input.field:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  input.field::placeholder { color: var(--muted); font-family: var(--sans); }
  .btn[disabled] { opacity: .5; cursor: default; }

  .switch button {
    border: 0; background: none; font: inherit; font-size: 10px;
    padding: 3px 10px; color: var(--muted); cursor: pointer;
  }
  .switch button.on { background: var(--surface-3); color: var(--ink); font-weight: 600; }
  .switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .srch { flex: 1; padding: 0 0 0 8px; }
  .find {
    border: 0; background: none; font: inherit; font-size: 10.5px;
    color: var(--ink); padding: 3px 8px 3px 5px; width: 100%; outline: none;
  }
  .find::placeholder { color: var(--muted); }

  /* Le righe si premono: sono la scelta. Una già importata resta in elenco, spenta,
     con scritto perché — nasconderla lascerebbe cercare qualcosa che c'è già. */
  .imp { width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; }
  .imp[disabled] { opacity: .5; cursor: default; }
  .imp:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .imp .fp { white-space: normal; }
  .dotk.new { background: none; border: 1.5px solid var(--line-2); }
</style>
