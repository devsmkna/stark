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
  import ModelPicker from './ModelPicker.svelte'
  import { colours, hhmm, project, projectName } from '../lib/view.ts'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import type { Store } from '../lib/store.svelte.ts'
  import type { SystemInfo, AgentModels } from '../lib/api.ts'

  let { store }: { store: Store } = $props()

  let cwd = $state('')
  /** `--continue`: riprende l'ultima conversazione di quella cartella invece di
   *  cominciarne una. Spenta di default — «New chat» vuol dire nuova. */
  let continua = $state(false)
  let chosen = $state<string | null>(null)
  let filter = $state('')

  // ─── un id scritto a mano ──────────────────────────────────────────────────
  //
  // Aveva una linguetta sua, ed era una linguetta di troppo: tre schede per due cose
  // che si fanno nello stesso posto. Adesso vive dentro la ricerca di «Import», che è
  // dove uno cerca una conversazione — e siccome gli id adesso si **vedono** su ogni
  // riga, cercarne uno è un gesto naturale invece di un campo da trovare.
  //
  // La capacità NON si è persa, ed era il punto: `Import` elenca i **60 trascritti più
  // recenti** (il limite di `listSessions` dell'SDK, `catalogue.ts`), mentre
  // `claude -r <id>` apre qualunque id. Senza questa strada STARK saprebbe fare meno
  // del CLI su un id di due mesi fa.
  const FORMA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const idCercato = $derived(FORMA_ID.test(filter.trim()) ? filter.trim() : null)
  function startResume(): void {
    if (idCercato && !store.working) void store.resumeById(idCercato)
  }

  // ─── il profilo, solo se c'è davvero una scelta da fare ────────────────────
  let profiles = $state<SystemInfo['agent']['profiles'] | null>(null)
  let profilePick = $state<string | null>(null)
  // ─── e con quale agent, stessa regola ─────────────────────────────────────
  // Compare solo se la macchina ne ha più di uno *installato*: una tendina con una
  // voce sola è un ostacolo, non una scelta. Chi non ha OpenCode non vede niente di
  // nuovo, ed è il comportamento giusto — non c'è niente da spiegargli.
  let agents = $state<NonNullable<SystemInfo['agents']> | null>(null)
  /** Cosa ha scelto l'utente nel picker (agent + modello, o `null` per il modello di
   *  default dell'agent). Assente finché non tocca il picker: prima di allora vale
   *  `defaultPick`, così la voce nasce già con dentro qualcosa e non vuota. */
  let modelChosen = $state<{ agent: string; model: string | null } | null>(null)
  let modelDdOpen = $state(false)

  // Il Finder nativo: parte `false` finché `/api/system` non risponde, quindi il
  // bottone nasce disabilitato — coerente col resto di STARK, che non mostra mai una
  // possibilità come attiva prima di averla verificata.
  let nativePicker = $state(false)
  let nativeBusy = $state(false)

  // Un solo effetto per una sola domanda: profili, agent e Finder arrivano tutti
  // dalla stessa risposta di `/api/system`. Il catalogo dei modelli è una richiesta
  // a parte (`caricaCatalogo`, condivisa con Dock/Helper/AgentPanel/Settings): la
  // voce «Model» qui sotto nasce già con l'icona e il nome veri, non solo l'id.
  $effect(() => {
    if (store.tab === 'new' && profiles === null) {
      void store.api.system().then(
        s => {
          profiles = s.agent.profiles
          agents = (s.agents ?? []).filter(a => a.available)
          nativePicker = s.nativeFolderPicker
        },
        () => { profiles = []; agents = []; nativePicker = false },
      )
      void store.caricaCatalogo()
    }
  })

  /** Il dialogo blocca la risposta HTTP finché l'utente non sceglie o annulla: può
   *  durare secondi o minuti, da qui `nativeBusy` invece di un fallimento apparente. */
  async function browseNative(): Promise<void> {
    nativeBusy = true
    try {
      const r = await store.api.browseNative()
      if (r.ok) cwd = r.path
    } catch {
      // silenzioso, come da spec: annullo o fallimento non mostrano errori
    } finally {
      nativeBusy = false
    }
  }

  const AGENT_NOMI: Record<string, string> = {
    'claude-code': 'Claude Code',
    opencode: 'OpenCode',
  }

  /** Il punto di partenza prima che l'utente tocchi il picker: il modello preferito
   *  (Settings → New chats start with → Model) se la sua casa è installata su questa
   *  macchina; altrimenti il primo agent disponibile, senza un modello preciso —
   *  «lascia decidere lui», come già faceva `start()` prima di questa voce. */
  const defaultPick = $derived.by(() => {
    const pref = store.settings?.preferredModel
    const disponibili = new Set((agents ?? []).map(a => a.id))
    if (pref && disponibili.has(pref.agent)) return { agent: pref.agent, model: pref.model as string | null }
    const primo = agents?.[0]?.id
    return primo ? { agent: primo, model: null } : null
  })
  const pick = $derived(modelChosen ?? defaultPick)
  const effectiveAgent = $derived(pick?.agent ?? null)

  /** L'agent e il modello del catalogo dietro `pick`, per il nome e l'icona vere
   *  nella riga chiusa — senza, la voce direbbe solo l'id fino al primo click. */
  const pickEntry = $derived.by(() => {
    const cat = store.catalogo
    if (!cat || !pick) return null
    const ag = cat.find(a => a.id === pick.agent)
    if (!ag) return null
    const modello = pick.model
      ? ag.models.find(m => m.id === pick.model || (m as any).resolved === pick.model)
      : null
    return { agent: ag, model: modello ?? ag.models[0] ?? null }
  })
  const pickIcon = $derived(pickEntry?.model
    ? getLobeIconUrl((pickEntry.model as any).resolved ?? pickEntry.model.id) : null)
  const pickLabel = $derived.by(() => {
    if (pickEntry?.model) {
      const label = pickEntry.model.label ?? pickEntry.model.id
      const mm = /^(.*?)\s*\((.+)\)\s*$/.exec(label)
      return mm ? mm[1]! : label
    }
    return pick ? (AGENT_NOMI[pick.agent] ?? pick.agent) : '—'
  })
  const pickAgentLabel = $derived(pickEntry?.agent.label ?? (pick ? (AGENT_NOMI[pick.agent] ?? pick.agent) : ''))
  // Assente vuol dire «non ancora deciso per questa cartella»: se STARK la conosce
  // già e ha un profilo salvato, non si chiede di nuovo — è deciso.
  const savedProfile = $derived(store.project(cwd.trim()).profile)
  // Il profilo è una cosa **di Claude Code** (`CLAUDE_CONFIG_DIR`): chiederlo per un
  // agent che non ce l'ha sarebbe una domanda senza risposta possibile.
  const showProfiles = $derived(
    cwd.trim().length > 0 && !savedProfile && (profiles?.length ?? 0) > 1
    && (effectiveAgent === null || effectiveAgent === 'claude-code'),
  )
  // `--continue` è una cosa **di Claude Code**: sull'adapter OpenCode il campo del
  // contratto (§1, `SessionSpec.continue`) c'è ma non è implementato, quindi la spunta
  // prometterebbe di riprendere una conversazione che parte comunque da zero. Finché
  // non lo implementa, la domanda non si fa — come già per il profilo qui sopra.
  const showContinue = $derived(effectiveAgent === null || effectiveAgent === 'claude-code')
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
      // Il modello preferito (chiesto dall'utente, 1º settembre 2026) è ormai il
      // punto di partenza del picker stesso (`defaultPick`), quindi qui basta
      // mandare cosa il picker mostra — `pick` — senza rimerge: la voce
      // «tranne il menu contestuale» resta vera perché quella strada non passa
      // da questo dialogo (la fa App.svelte).
      void store.newChat(cwd.trim(), {
        ...(showProfiles && effectiveProfile ? { profile: effectiveProfile } : {}),
        ...(pick?.agent ? { agent: pick.agent } : {}),
        ...(pick?.model ? { model: pick.model } : {}),
        ...(showContinue && continua ? { continue: true } : {}),
      })
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
      || (r.cwd ?? '').toLowerCase().includes(q)
      // Anche per id: adesso che si vedono su ogni riga, incollarne uno e ritrovarlo
      // è il gesto ovvio. Vale sia per l'id intero sia per le prime cifre.
      || r.sessionId.toLowerCase().includes(q))
  })

  /**
   * La riga «apri questo id» si mostra solo se l'elenco quell'id non ce l'ha.
   *
   * Sta **dopo** `shown` e non accanto a `idCercato` perché lo legge: più su sarebbe un
   * uso prima della dichiarazione. A runtime funzionava lo stesso — un `$derived` si
   * valuta quando lo si legge, cioè a componente già costruito — ed è proprio per
   * questo che non se ne accorgeva nessuno guardando lo schermo: l'ha detto `svelte-check`.
   */
  const mostraPerId = $derived(idCercato !== null && !shown.some(r => r.sessionId === idCercato))

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
      <div class="dt">
        {store.tab === 'new' ? 'New chat' : 'Import a conversation'}
      </div>
      <div class="ds">
        {store.tab === 'new' ? 'A folder is all it needs'
          : 'Started in the terminal — search by name, or paste an id'}
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
        <div class="flabel">Model</div>
        <!-- Sostituisce la scelta «Claude Code o OpenCode»: un modello implica la sua
             casa, quindi sceglierlo qui sceglie anche l'agent — non due domande, una.
             Nasce già con dentro il modello preferito (Settings → Agent → «New chats
             start with»), o il primo modello dell'unico agent installato; un click la
             riapre sul picker vero, ricerca compresa. -->
        <button type="button" class="inst instbtn modelbtn" class:on={modelDdOpen}
          onclick={() => { modelDdOpen = !modelDdOpen; if (modelDdOpen) void store.caricaCatalogo() }}>
          {#if pickIcon}
            <img class="mico" src={pickIcon} alt="" width="16" height="16" loading="lazy"
              onerror={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = 'none' }} />
          {:else}
            <span class="rd"></span>
          {/if}
          <span class="nm">{pickLabel}</span>
          <span class="where">{pickAgentLabel}<Icon name={modelDdOpen ? 'i-back' : 'i-fwd'} /></span>
        </button>
        {#if modelDdOpen}
          <div class="dd moddd">
            <ModelPicker catalogo={store.catalogo} corrente={pick?.model ?? pickEntry?.model?.id ?? ''}
              agenteCorrente={effectiveAgent ?? undefined}
              onScegli={(agent, model) => { modelChosen = { agent, model }; modelDdOpen = false }} />
          </div>
        {/if}
      </div>

      <div class="fgroup">
        <div class="flabel">Folder</div>
        <div class="pathrow">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field" autofocus bind:value={cwd} placeholder="/root/DevsMachna/stark"
            onkeydown={e => { if (e.key === 'Enter') start() }} />
          <button class="btn" type="button" onclick={openBrowse}>Open path…</button>
          <button class="btn finder" type="button" disabled={!nativePicker || nativeBusy}
            title={nativePicker ? 'Browse with the system Finder' : 'Not available on this machine (no native folder picker found)'}
            onclick={() => void browseNative()}>
            <Icon name="i-reveal" />{nativeBusy ? 'Waiting…' : 'Finder…'}
          </button>
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
                  <i class="dotk p{palette.get(project(r)) ?? 0}"></i> {projectName(r, store.settings?.projects)}
                </button>
              {/each}
            </div>
          {/if}
          <div class="hint">The folder decides the project and its colour. Type the full path,
            <b>Open path…</b> to browse the machine, or <b>Finder…</b> for the native picker.</div>
        {/if}
      </div>

      {#if showContinue}
      <div class="fgroup">
        <div class="flabel">Start</div>
        <label class="chk">
          <input type="checkbox" bind:checked={continua} />
          <span>Continue the last conversation in this folder</span>
        </label>
        <div class="hint">The same as <code>claude --continue</code>: the agent keeps the
          context of the most recent chat in that folder. STARK can't know which one it is
          before the handshake, so <b>the previous turns won't be shown here</b> — they count
          for the model, not on screen. If that folder has no earlier conversation, this
          starts a new chat.</div>
      </div>
      {/if}

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

  {:else if store.tab === 'import'}
    <div class="dlgb" style="gap:7px">
      <div class="chips" style="margin-bottom:2px">
        <span class="chip ro"><span class="lab">Agent</span>Claude Code</span>
        <span class="chip srch">
          <Icon name="i-search" />
          <input class="find" bind:value={filter} placeholder="Search" />
        </span>
      </div>

      {#if mostraPerId}
        <!-- L'elenco mostra i 60 trascritti più recenti: un id più vecchio non c'è,
             anche se il file esiste su disco. Qui si apre lo stesso, cercandolo per
             nome file in **tutti** i profili della macchina — cioè quello che fa
             `claude -r <id>`. -->
        <!-- Niente `.rd`: le altre righe si **scelgono** e poi si conferma con
             «Import», questa si **preme** e basta. Una pallina che non si riempie mai
             direbbe che c'è una selezione in corso quando non c'è. -->
        <button class="imp byid" onclick={startResume} disabled={store.working}>
          <div class="bd">
            <div class="t1"><span class="nm">Open this id</span></div>
            <div class="fp">Not in the list — that only shows the 60 most recent.
              STARK will look for this id across every Claude profile on this machine,
              import its history if it doesn't have it yet, and open it.</div>
            <div class="mt">{store.working ? 'opening…' : idCercato}</div>
          </div>
        </button>
      {/if}

      {#if store.importable === null}
        <div class="mid" style="padding:26px">Looking for conversations…</div>
      {:else if shown.length === 0 && !mostraPerId}
        <div class="mid" style="padding:26px">
          {store.importable.length === 0
            ? 'No conversation from the terminal was found on this machine.'
            : 'Nothing matches that.'}
        </div>
      {:else if shown.length === 0}
        <!-- Con la riga per id sopra, «Nothing matches that» si contraddirebbe: c'è
             eccome qualcosa da fare. Si dice l'altra metà, che è quella vera. -->
        <div class="mid" style="padding:14px 26px 20px">Nothing else matches that id.</div>
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
                  {projectName(r.cwd, store.settings?.projects)}{#if r.branch}{' · '}{r.branch}{/if}
                </span>
                <!-- L'id accorciato come un hash di git: otto cifre bastano a
                     riconoscerlo in un log o in un terminale, e l'intero sta nel
                     `title` — la riga è già fitta, e trentasei caratteri di uuid
                     spingerebbero fuori il nome della conversazione. Uno `span` e non
                     un bottone «copia»: questa riga **è** un bottone, e un bottone
                     dentro un bottone non è HTML valido. -->
                <span class="chip sid" title={r.sessionId}>{r.sessionId.slice(0, 8)}</span>
              </div>
              <!-- Il primo prompt in evidenza, non il titolo: il titolo lo scrive il
                   modello e si somigliano tutti; la prima frase scritta da te è quella
                   che fa dire «ah, è quella». -->
              {#if r.firstPrompt}<div class="fp">“{r.firstPrompt}”</div>{/if}
              <div class="mt">
                <!-- Quale agent: con due backend, «quale chat» dice anche «di chi».
                     L'etichetta arriva dal daemon (§1): la UI non conosce i nomi. -->
                {r.agentLabel}{' · '}{when(r.lastModified)}{#if r.sizeBytes}{' · '}{size(r.sizeBytes)}{/if}
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

  /* La voce «Model»: stesso vestito di `.inst`, ma apre il picker invece di
     scegliersi da sola. L'icona del modello sostituisce il pallino `.rd` quando
     c'è; il chevron dentro `.where` segna aperto/chiuso, come nelle tendine di
     Settings. */
  .modelbtn .mico { width: 16px; height: 16px; flex: none; border-radius: 4px; filter: var(--icon-f); }
  .modelbtn .where :global(svg.ic) { width: 11px; height: 11px; }
  /* La tendina del picker: stesso box `.dd`/`.moddd` di Settings — quel componente
     gestisce da solo ricerca, livelli e scelta, qui serve solo il contenitore. */
  .dd { margin: 2px 0 0; padding: 5px; background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 12px; }
  .moddd { padding: 4px; }
  input.field { width: 100%; }
  .pathrow { display: flex; gap: 6px; }
  .pathrow .field { flex: 1; }
  .pathrow .btn { flex: none; white-space: nowrap; }
  /* Icona + etichetta corta invece del testo per esteso: "Open path…" resta più
     largo di natura (nome+verbo), "Finder…" con l'icona di i-reveal basta a
     riconoscerlo senza allargare la riga quanto "Browse (system Finder)…". */
  .pathrow .btn.finder { display: inline-flex; align-items: center; gap: 5px; }
  .pathrow .btn.finder :global(svg.ic) { width: 12px; height: 12px; }

  .chk { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .chk input { margin: 0; }

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
  /* Più piccolo dei chip in cima alla modale: quelli sono comandi, questo è
     un'etichetta dentro una riga di un elenco fitto. */
  .imp .sid {
    flex: none; padding: 1px 6px; font-family: var(--mono); font-size: 9px;
    color: var(--muted); border-radius: 999px;
  }
  /* La riga «apri questo id» non ha un progetto né una data: senza un fondo suo
     sembrerebbe una conversazione a cui mancano dei pezzi, invece che un'azione. */
  .imp.byid { border: 1px dashed var(--line-2); border-radius: 9px; }
  .dotk.new { background: none; border: 1.5px solid var(--line-2); }
</style>
