<script lang="ts">
  // Le impostazioni: un riquadro quasi a tutto schermo, sette sezioni.
  //
  // La regola che le tiene insieme: **ogni voce dice la verità su cosa fa**. Dove STARK
  // non sa ancora fare una cosa, la voce resta in elenco spenta e con scritto perché
  // (Principio 5) — nasconderla farebbe credere che non esista, che è peggio che
  // sapere che non c'è ancora.
  //
  // E dove una cosa vive conta: la tabella dei permessi e i progetti stanno sul daemon,
  // perché cambiano cosa fa l'agent e devono valere da qualunque browser; il tema e i
  // suoni restano nel browser, perché sono del dispositivo.
  import Icon from './Icon.svelte'
  import type { Storage, SystemInfo } from '../lib/api.ts'
  import type { Call } from '../lib/notify.svelte.ts'
  import type { Theme } from '../lib/theme.svelte.ts'
  import type { TextSize } from '../lib/textsize.svelte.ts'
  import type { FontFamily } from '../lib/fontfamily.svelte.ts'
  import { project } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  type Sezione = 'permissions' | 'agent' | 'projects' | 'notifications' | 'appearance' | 'storage' | 'system'
  let sez = $state<Sezione>('permissions')
  /** Solo su schermo stretto: sei **dentro** una sezione, o stai guardando il menu.
   *  Si riparte sempre dal menu — aprire le impostazioni su una sezione a caso sarebbe
   *  entrare in una stanza senza aver visto la casa. */
  let dentro = $state(false)

  const SEZIONI: { id: Sezione; nome: string; icona: string }[] = [
    { id: 'permissions', nome: 'Permissions', icona: 'i-shield' },
    { id: 'agent', nome: 'Agent', icona: 'i-brain' },
    { id: 'projects', nome: 'Projects', icona: 'i-folder' },
    { id: 'notifications', nome: 'Notifications', icona: 'i-bell' },
    { id: 'appearance', nome: 'Appearance', icona: 'i-palette' },
    { id: 'storage', nome: 'Storage', icona: 'i-disk' },
    { id: 'system', nome: 'System', icona: 'i-monitor' },
  ]

  // ─── permessi ─────────────────────────────────────────────────────────────

  /** Categorie, non nomi di tool: `Bash` e `mcp__*` sono vocabolario di Claude Code,
   *  ed è ciò che il modello canonico esiste per non far uscire dall'adapter. */
  const CATEGORIE: { id: string; nome: string; desc: string }[] = [
    { id: 'shell', nome: 'Shell commands', desc: 'running anything in the terminal' },
    { id: 'edit', nome: 'Editing files', desc: 'writing, changing, deleting' },
    { id: 'read', nome: 'Reading files', desc: 'opening and searching the folder' },
    { id: 'net', nome: 'Network', desc: 'fetching pages, searching the web' },
    { id: 'agents', nome: 'Sub-agents', desc: 'spawning helpers that work on their own' },
    { id: 'external', nome: 'External tools', desc: 'Notion, Jira, anything connected' },
  ]

  async function setPerm(id: string, v: 'allow' | 'ask'): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({ ...s, permissions: { ...s.permissions, [id]: v } })
  }

  // ─── l'agent ──────────────────────────────────────────────────────────────

  async function setDesc(v: boolean): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({ ...s, toolDescriptions: v })
  }

  // ─── progetti ─────────────────────────────────────────────────────────────

  /** I progetti sono le cartelle che hanno una conversazione, più quelle che hanno già
   *  un'impostazione: una cartella silenziata resta in elenco anche a chat cancellate. */
  const progetti = $derived.by(() => {
    const m = new Map<string, string>()
    for (const r of store.rows) if (r.cwd) m.set(r.cwd, project(r.cwd))
    for (const cwd of Object.keys(store.settings?.projects ?? {})) {
      if (!m.has(cwd)) m.set(cwd, project(cwd))
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  })

  // ─── notifiche ────────────────────────────────────────────────────────────

  const EVENTI: { id: Call; nome: string; desc: string }[] = [
    { id: 'needsYou', nome: 'A chat is waiting for me', desc: 'a permission, or a question to answer' },
    { id: 'done', nome: 'A chat has finished', desc: 'the task is done, it now waits for a new prompt' },
    { id: 'stopped', nome: 'A chat stopped on its own', desc: 'an error, or the quota ran out' },
  ]

  const TEMI: { id: Theme; nome: string }[] = [
    { id: 'light', nome: 'Light' }, { id: 'dark', nome: 'Dark' }, { id: 'system', nome: 'System' },
  ]

  const TAGLIE: { id: TextSize; nome: string }[] = [
    { id: 'sm', nome: 'Small' }, { id: 'md', nome: 'Default' },
    { id: 'lg', nome: 'Large' }, { id: 'xl', nome: 'Extra large' },
  ]

  const FONT: { id: FontFamily; nome: string }[] = [
    { id: 'default', nome: 'Default' }, { id: 'system', nome: "This computer's font" },
  ]

  // ─── quello che si chiede al daemon solo quando serve ──────────────────────

  let storage = $state<Storage | null>(null)
  let system = $state<SystemInfo | null>(null)
  let errore = $state('')
  let erroreStorage = $state('')

  $effect(() => {
    // Si chiedono aprendo la sezione, non all'avvio: la diagnostica lancia un processo
    // per chiedergli la versione, e chi non apre mai System non deve pagarlo.
    if (sez === 'storage' && !storage) {
      void store.api.storage().then(s => { storage = s }, e => { erroreStorage = String(e.message ?? e) })
    }
    // 'projects' la chiede anche lei: le è servono i profili trovati sulla macchina
    // per la scelta per cartella, qui sotto.
    if ((sez === 'system' || sez === 'projects') && !system) {
      void store.api.system().then(s => { system = s }, e => { errore = String(e.message ?? e) })
    }
  })

  const mb = (n: number): string =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`

  let copiato = $state('')
  async function copia(che: string, testo: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(testo)
      copiato = che
      setTimeout(() => { if (copiato === che) copiato = '' }, 1500)
    } catch { store.refused = 'the browser did not allow copying' }
  }
</script>

<div class="scrim" role="presentation" onclick={() => { store.dialog = null }}></div>
<!-- Su schermo stretto le due colonne diventano **due schermate**, come l'elenco e la
     conversazione (§8 di ui-schermate.md): prima il menu, poi la sezione, con la freccia
     per tornare. Affiancate a 390px l'elenco si prendeva un terzo della larghezza per
     restare comunque illeggibile, e alla sezione ne restavano due terzi.
     `dentro` vale solo lì: su schermo largo le due colonne si vedono insieme, e questa
     variabile non tocca niente. -->
<div class="dlg wide">
  <div class="snav" class:via={store.narrow && dentro}>
    <!-- La X sta nell'intestazione della colonna di destra, che qui è l'altra
         schermata: senza questa, il menu sarebbe un vicolo cieco da cui si esce solo
         entrando in una sezione qualsiasi. -->
    {#if store.narrow}
      <div class="dlgh navh">
        <div class="dt">Settings</div>
        <button class="x" aria-label="Close" onclick={() => { store.dialog = null }}>
          <Icon name="i-x" />
        </button>
      </div>
    {/if}
    {#each SEZIONI as s (s.id)}
      <button class="sn" class:on={!store.narrow && sez === s.id}
        onclick={() => { sez = s.id; dentro = true }}>
        <Icon name={s.icona} /> {s.nome}
        <!-- Il segno che la riga **apre** qualcosa invece di selezionarlo: su schermo
             largo la selezione si vede dallo sfondo, qui la sezione non è accanto. -->
        {#if store.narrow}<span class="chev">›</span>{/if}
      </button>
    {/each}
  </div>

  <div class="dlgcol" class:via={store.narrow && !dentro}>
    <div class="dlgh">
      {#if store.narrow}
        <button class="iconb" aria-label="Back to settings" onclick={() => { dentro = false }}>
          <Icon name="i-back" />
        </button>
      {/if}
      <div class="dt">{SEZIONI.find(s => s.id === sez)?.nome}</div>
      <button class="x" aria-label="Close" onclick={() => { store.dialog = null }}>
        <Icon name="i-x" />
      </button>
    </div>

    <div class="dlgb">
      {#if !store.settings}
        <div class="hint">Loading…</div>

      <!-- ─── Permissions ─────────────────────────────────────────────── -->
      {:else if sez === 'permissions'}
        <div class="fgroup">
          <div class="flabel">Stop and ask me before…</div>
          <div>
            {#each CATEGORIE as c (c.id)}
              <div class="prow">
                <div><div class="pn">{c.nome}</div><div class="pd">{c.desc}</div></div>
                <span class="seg">
                  <button class:on={store.settings.permissions[c.id] !== 'ask'}
                    onclick={() => void setPerm(c.id, 'allow')}>let it</button>
                  <button class:on={store.settings.permissions[c.id] === 'ask'}
                    onclick={() => void setPerm(c.id, 'ask')}>ask me</button>
                </span>
              </div>
            {/each}
          </div>
          <div class="hint">Everything starts on <b>let it</b>. The classifier still inspects every
          single action — this only adds a human check on top, where you want one.</div>
          <!-- Gli hook si installano all'avvio della sessione: cambiarli a metà vorrebbe
               dire rinegoziare l'handshake di una conversazione che sta lavorando. Dirlo
               è meglio che lasciar credere che la spunta valga per tutti. -->
          <div class="notice">
            <Icon name="i-sliders" />
            <span><b>This applies to new chats.</b> A chat already open keeps the rules it started
            with — its checks are installed when the agent starts, not while it works.</span>
          </div>
        </div>

        <div class="hard">
          <div class="ht"><Icon name="i-block" /> Never, no exceptions</div>
          <div class="hs">These are not a stricter «ask me». They would block <b>before</b> the
          classifier ever sees the action, and nothing would get past them — not you, not the agent,
          not a per-chat override.</div>
          <div class="chips">
            <span class="chip" style="color:var(--muted)">Not built yet — STARK has no deny rules,
            so a hard boundary here would be a promise it cannot keep</span>
          </div>
        </div>

      <!-- ─── Agent ──────────────────────────────────────────────────── -->
      {:else if sez === 'agent'}
        <div class="fgroup">
          <div class="flabel">How the agent works</div>
          <div>
            <div class="prow">
              <div>
                <div class="pn">Command descriptions</div>
                <div class="pd">write <i>why</i> a command runs, not just what</div>
              </div>
              <span class="seg">
                <button class:on={store.settings.toolDescriptions !== false}
                  onclick={() => void setDesc(true)}>on</button>
                <button class:on={store.settings.toolDescriptions === false}
                  onclick={() => void setDesc(false)}>off</button>
              </span>
            </div>
          </div>
          <div class="hint">Without it a tool row shows only the command — and
          <code>grep -rn "claude-sonnet" src/</code> tells you nothing about what the agent was
          looking for. With it, that row reads «Find where the default model is decided».</div>
          <!-- Dire dove si va a scrivere non è un dettaglio tecnico: è l'unica cosa che
               l'utente non può dedurre da solo, ed è un file **suo**. -->
          <div class="notice">
            <Icon name="i-doc" />
            <span><b>This writes a rule into the agent's own memory.</b> STARK adds a marked block
            to <code>{store.memoria?.path ?? 'CLAUDE.md'}</code> and removes exactly that block when
            you switch it off — the rest of the file is never touched. Because the rule lives there
            and not here, it also applies outside STARK, in the terminal.</span>
          </div>
          {#if store.memoria?.error}
            <div class="notice">
              <Icon name="i-warn" />
              <span><b>That file could not be written.</b> {store.memoria.error}</span>
            </div>
          {/if}
        </div>

      <!-- ─── Projects ────────────────────────────────────────────────── -->
      {:else if sez === 'projects'}
        <div class="fgroup">
          <div class="flabel">Every project remembers its colour</div>
          <div>
            {#each progetti as [cwd, nome] (cwd)}
              <div class="pjrow">
                <span class="sw p{store.project(cwd).colour ?? 0}"></span>
                <div class="pjn"><div class="pn2">{nome}</div><div class="pjp">{cwd}</div></div>
                <span class="chips">
                  {#each [0, 1, 2, 3, 4, 5, 6] as i (i)}
                    <button class="sw p{i}" class:on={store.project(cwd).colour === i}
                      aria-label={`Colour ${i + 1}`}
                      onclick={() => void store.setProject(cwd, { colour: i })}></button>
                  {/each}
                </span>
              </div>
            {/each}
            {#if progetti.length === 0}
              <div class="hint">No projects yet — they appear here as soon as a chat has a folder.</div>
            {/if}
          </div>
          <div class="hint">Seven colours, assigned in alphabetical order until you pick one. A
          colour belongs to the <b>folder</b>, which is the only stable identity a project has.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Claude profile</div>
          <!-- Ogni sessione spawna il proprio processo (ADR-009): il `CLAUDE_CONFIG_DIR`
               viaggia nel suo `env`, non in quello del daemon. Due progetti su profili
               diversi non si toccano — è per questo che la scelta può essere per cartella. -->
          {#if !system}
            <div class="hint">{errore || 'Reading — STARK is asking the executable which version it is.'}</div>
          {:else if system.agent.profiles.length <= 1}
            <div class="hint">This machine has a single Claude profile — nothing to choose yet.
            A second one shows up here the moment a <code>~/.claude-*</code> folder exists.</div>
          {:else}
            {@const sys = system}
            {@const dflt = sys.agent.profiles.find(p => p.current)?.path}
            <div>
              {#each progetti as [cwd, nome] (cwd)}
                <div class="pjrow">
                  <span class="sw p{store.project(cwd).colour ?? 0}"></span>
                  <div class="pjn"><div class="pn2">{nome}</div><div class="pjp">{cwd}</div></div>
                  <span class="chips">
                    {#each sys.agent.profiles as p (p.path)}
                      <button class="chip" class:on={(store.project(cwd).profile ?? dflt) === p.path}
                        onclick={() => void store.setProject(cwd, { profile: p.path })}>{p.name}</button>
                    {/each}
                  </span>
                </div>
              {/each}
              {#if progetti.length === 0}
                <div class="hint">No projects yet — they appear here as soon as a chat has a folder.</div>
              {/if}
            </div>
            <div class="hint"><b>Quota is counted per profile</b>, which is the real reason this is
            a per-project choice: two projects on different profiles do not eat each other's week.
            This only reaches <b>chats you open from now on</b> — one already running keeps the
            profile it started with, same as model and mode.</div>
          {/if}
        </div>

      <!-- ─── Notifications ───────────────────────────────────────────── -->
      {:else if sez === 'notifications'}
        <div class="fgroup">
          <div class="flabel">Call me when…</div>
          <div>
            {#each EVENTI as e (e.id)}
              <div class="nrow">
                <div><div class="nn">{e.nome}</div><div class="nd">{e.desc}</div></div>
                <span class="rt">
                  <button class="tog" class:on={store.calls.on && store.calls.eventi[e.id]}
                    disabled={!store.calls.on}
                    aria-label={e.nome}
                    onclick={() => store.calls.setEvento(e.id, !store.calls.eventi[e.id])}><i></i></button>
                </span>
              </div>
            {/each}
          </div>
          {#if !store.calls.on}
            <div class="notice">
              <Icon name="i-bell" />
              <span><b>Everything is muted.</b> The bell at the top of the list turns it back on.</span>
            </div>
          {/if}
          <div class="hint"><b>Two different sounds on purpose.</b> «I'm done» and «I'm waiting for
          you» are opposite situations for whoever is listening. Choosing the sounds is not built
          yet — there are three, and they are the three above.</div>
        </div>

        <!-- Le notifiche che arrivano quando STARK **non è aperto**. Stanno qui e non
             sotto la campanella perché sono un'altra cosa: la campanella è il volume di
             questa scheda, questo è «avvisami anche quando la scheda non c'è». E sono
             **di questo dispositivo**: accenderle sull'iPhone non le accende altrove. -->
        <div class="fgroup">
          <div class="flabel">On this device, even when STARK is closed</div>
          <div>
            <div class="nrow">
              <div>
                <div class="nn">Push notifications</div>
                <div class="nd">
                  {#if store.push.stato === 'accese'}
                    on — the daemon calls this device{store.push.iscritti > 1
                      ? `, and ${store.push.iscritti - 1} other` : ''}
                  {:else if store.push.stato === 'negato'}
                    the browser blocked them for this site
                  {:else if store.push.stato === 'nonSupportato' || store.push.stato === 'nonDisponibile'}
                    not available here
                  {:else}
                    off — nothing reaches you with STARK closed
                  {/if}
                </div>
              </div>
              <span class="rt">
                <button class="tog" class:on={store.push.stato === 'accese'}
                  disabled={store.push.stato === 'nonSupportato'
                    || store.push.stato === 'nonDisponibile' || store.push.stato === 'negato'}
                  aria-label="Push notifications on this device"
                  onclick={() => void (store.push.stato === 'accese'
                    ? store.push.spegni() : store.push.accendi())}><i></i></button>
              </span>
            </div>
            {#if store.push.stato === 'accese'}
              <div class="nrow">
                <div><div class="nn">Send a test</div><div class="nd">proves it really arrives, without waiting for a real turn</div></div>
                <span class="rt">
                  <button class="btn" onclick={() => void store.push.prova()}>Send</button>
                </span>
              </div>
            {/if}
          </div>
          {#if store.push.motivo}
            <div class="notice">
              <Icon name="i-bell" />
              <span>{store.push.motivo}</span>
            </div>
          {/if}
          <div class="hint"><b>Different from the bell above.</b> That one is the volume of this
          tab, and it needs the tab open. This one is sent by the daemon, so it reaches you with
          the screen off — the only case where a notification is really worth something.
          The message travels <b>encrypted</b>, but it does pass through Apple's or Google's push
          servers: it is the one part of STARK that does not stay on your machine, which is why
          it is off until you turn it on.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Stay quiet for…</div>
          <div>
            <div class="nrow">
              <div><div class="nn">The chat I'm looking at</div><div class="nd">you can already see it happen</div></div>
              <span class="rt">
                <button class="tog" class:on={store.calls.zittoQui} aria-label="Quiet for the open chat"
                  onclick={() => store.calls.setZittoQui(!store.calls.zittoQui)}><i></i></button>
              </span>
            </div>
            {#each progetti as [cwd, nome] (cwd)}
              <div class="nrow">
                <div><div class="nn">{nome}</div><div class="nd">{cwd}</div></div>
                <span class="rt">
                  <button class="tog" class:on={store.project(cwd).muted === true}
                    aria-label={`Mute ${nome}`}
                    onclick={() => void store.setProject(cwd, { muted: !store.project(cwd).muted })}><i></i></button>
                </span>
              </div>
            {/each}
          </div>
          <div class="hint">Silence a whole project when it has one long job you don't want to hear
          about, and two short ones you do. This one is <b>saved on the machine</b>, not in this
          browser: it is a fact about the project.</div>
        </div>

        <div class="notice">
          <Icon name="i-bell" />
          <span><b>The dot in the list is not a notification.</b> It only works if you are already
          looking at STARK, and the whole point of these is being able to look somewhere else.</span>
        </div>

      <!-- ─── Appearance ──────────────────────────────────────────────── -->
      {:else if sez === 'appearance'}
        <div class="fgroup">
          <div class="flabel">Theme</div>
          <div class="chips">
            {#each TEMI as t (t.id)}
              <button class="chip" class:on={store.theme.scelto === t.id}
                onclick={() => store.theme.set(t.id)}>
                {#if store.theme.scelto === t.id}<Icon name="i-check" />{/if}{t.nome}
              </button>
            {/each}
          </div>
          <div class="hint"><b>System</b> is not the absence of a choice: it means follow the
          computer, which is the right one on a machine that turns dark in the evening. This is
          saved in <b>this browser</b> — the theme of a laptop in the dark is not the theme of a
          desktop in an office.</div>
          <div class="hint">Project colours live in <b>Projects</b>: a colour belongs to the
          project, not to a page about how STARK looks.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Text size</div>
          <div class="chips">
            {#each TAGLIE as t (t.id)}
              <button class="chip" class:on={store.textSize.scelto === t.id}
                onclick={() => store.textSize.set(t.id)}>
                {#if store.textSize.scelto === t.id}<Icon name="i-check" />{/if}{t.nome}
              </button>
            {/each}
          </div>
          <div class="hint">Everything scales together — the list, the conversation, the
          blocks — so nothing lines up wrong at a size STARK wasn't measured at by hand.
          Saved in <b>this browser</b>.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Font</div>
          <div class="chips">
            {#each FONT as f (f.id)}
              <button class="chip" class:on={store.font.scelto === f.id}
                onclick={() => store.font.set(f.id)}>
                {#if store.font.scelto === f.id}<Icon name="i-check" />{/if}{f.nome}
              </button>
            {/each}
          </div>
          <div class="hint">Commands and code always stay monospaced — this only changes
          what you read, not what you copy. Saved in <b>this browser</b>.</div>
        </div>

      <!-- ─── Storage ─────────────────────────────────────────────────── -->
      {:else if sez === 'storage'}
        <div class="fgroup">
          <div class="flabel">Journals</div>
          <div class="field">
            <Icon name="i-folder" />{storage?.home ?? 'reading…'}
          </div>
          <div class="hint">
            {#if storage}{storage.sessions.length}
              {storage.sessions.length === 1 ? 'chat' : 'chats'} · {mb(storage.bytes)}
            {:else}{erroreStorage || 'Reading…'}{/if}
          </div>
          <div class="warn">
            <Icon name="i-warn" />
            <span>A journal holds the <b>entire conversation</b>, including everything the agent
            read along the way. That is why it lives here and not inside your project folder — by
            construction, not because of a line in <code>.gitignore</code> that somebody can delete
            by mistake.</span>
          </div>
        </div>

        <div class="fgroup">
          <div class="flabel">Per chat</div>
          <div>
            {#each storage?.sessions ?? [] as s (s.id)}
              <div class="nrow">
                <div>
                  <div class="nn">{s.title}</div>
                  <div class="nd">{s.cwd ? project(s.cwd) : 'no folder'}</div>
                </div>
                <span class="rt">
                  <span class="mt">{mb(s.bytes)}</span>
                  <button class="btn dgr" style="padding:2px 8px;font-size:10px"
                    onclick={() => {
                      const row = store.rows.find(r => r.id === s.id)
                      if (row) { store.dialog = { kind: 'delete', row } }
                    }}>Delete</button>
                </span>
              </div>
            {/each}
          </div>
          <div class="hint">Deleting a journal removes <b>STARK's</b> view of the chat, and its
          attachments with it. The agent keeps its own transcript where it always did — the two are
          different memories with different jobs.</div>
        </div>

      <!-- ─── System ──────────────────────────────────────────────────── -->
      {:else if !system}
        <!-- Un'attesa dichiarata, non una parete di puntini: questa pagina chiede la
             versione a un eseguibile, quindi ci mette un secondo, e «sta leggendo» è
             un'informazione mentre «…» è un guasto travestito. -->
        <div class="hint">
          {errore || 'Reading — STARK is asking the executable which version it is.'}
        </div>

      {:else}
        {@const sys = system}
        <div class="fgroup">
          <div class="flabel">STARK</div>
          <div class="kv">
            <span class="k2">Address</span>
            <span class="v2">{sys.url}
              <button class="lnk" onclick={() => void copia('url', sys.url)}>
                {copiato === 'url' ? 'Copied' : 'Copy'}</button></span>
            <span class="k2">Token</span>
            <span class="v2">••••••••••••••••
              <button class="lnk" onclick={() => void copia('token', store.api.tokenValue)}>
                {copiato === 'token' ? 'Copied' : 'Copy'}</button></span>
            <span class="k2">Listening on</span><span class="v2">{system.listening}</span>
            <span class="k2">Home</span><span class="v2">{system.home}</span>
          </div>
          <div class="hint">The token now <b>stays the same across restarts</b>: it lives in
          <code>{system.home}/token</code> with <code>0600</code>, which is what lets
          you keep this tab open. Copy it to open STARK in a second browser. To replace it:
          <code>npm run stark:token -- --new</code>, then restart the daemon — it cannot be done
          from here without cutting this page off mid-sentence.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Claude Code</div>
          <div class="kv">
            <span class="k2">Executable</span>
            <span class="v2">{system.agent.executable ?? 'not found'}
              {#if system.agent.bundled}<span style="color:var(--muted)">— bundled, not yours</span>{/if}</span>
            <span class="k2">CLI</span>
            <span class="v2">{system.agent.cli ?? 'unknown'}
              <span style="color:var(--muted)">with SDK {system.agent.sdk ?? 'unknown'}</span></span>
            <span class="k2">Node</span><span class="v2">{system.agent.node}</span>
          </div>
          <div class="hint">The CLI version is <b>asked to the executable</b>, not guessed from the
          SDK number: the two track each other, but «track» is not «are equal», and this is the page
          you read when something does not add up.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Profiles found on this machine</div>
          <div class="kv">
            {#each system.agent.profiles as p (p.path)}
              <span class="k2">{p.name}{#if p.current}&nbsp;<span class="okk">in use</span>{/if}</span>
              <span class="v2">{p.path}
                <span style="color:var(--muted)">— {p.conversations}
                  {p.conversations === 1 ? 'conversation' : 'conversations'} ·
                  {p.mcpServers === 0 ? 'no MCP servers' : `${p.mcpServers} MCP servers`}</span></span>
            {/each}
          </div>
          <div class="warn">
            <Icon name="i-warn" />
            <span>This is the <code>CLAUDE_CONFIG_DIR</code> STARK passes to every agent it
            launches. Pointed at the wrong profile, an agent finds <b>no conversations to resume,
            and possibly no login</b> — looking broken for no reason at all. It is the single most
            confusing way this can fail.</span>
          </div>
        </div>

        <div class="fgroup">
          <div class="flabel">Auto mode</div>
          {#if store.snap && store.snap.models.length > 0}
            <div class="kv">
              {#each store.snap.models as m (m.id)}
                <span class="k2">{m.label ?? m.id}</span>
                <span class="v2">
                  {#if m.autoMode}<span class="okk">supported</span>
                  {:else}<span style="color:var(--wait)">not supported — falls back to Manual</span>{/if}
                </span>
              {/each}
            </div>
            <div class="hint">From the chat you have open: which models support auto mode is
            something the session reports, not something STARK knows on its own.</div>
          {:else}
            <div class="hint">Open a chat to see it: the list of models — and which of them support
            auto mode — comes from the session, not from a list written in here.</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Tutto qui dentro si preme, quindi è un <button>, e va tolto l'aspetto di pulsante
     che ci mette il browser. La trappola — presa tre volte prima di scriverla — è che
     `background: none` in un componente è **più specifico** delle regole di `app.css`:
     su `.chip`, `.tog` e `.sw`, che lì hanno un colore, lo spegne. Quindi sfondo e
     bordo si tolgono solo a chi in `app.css` non ne ha. */
  .sn, .seg button, .x, .lnk { border: 0; background: none; }
  .sn, .seg button, .x, .lnk, .chip, .tog, .sw {
    font: inherit; cursor: pointer; padding: 0;
  }
  .sn, .seg button, .x, .lnk { color: inherit; }
  .sn { width: 100%; text-align: left; padding: 5px 8px; }
  .seg button { padding: 2.5px 9px; font-size: 10px; }
  /* La voce scelta si deve **vedere**. `.seg button{background:none;color:inherit}` qui
     sopra è scoped, quindi più specifico di `.seg button.on` in app.css, e se lo
     mangiava: da quando esiste il pannello dei permessi la scelta si distingueva solo
     per il grassetto, che a 10px non è una differenza — l'interruttore sembrava spento
     in entrambe le posizioni. Trovato aggiungendo la voce «Command descriptions»,
     misurando il colore di sfondo invece di guardarlo: `rgba(0,0,0,0)` su tutti e due i
     bottoni, in tutte e due le sezioni. È la stessa malattia del menu dei comandi in
     Dock.svelte, e la cura è la stessa: ridichiarare qui, dove lo scoped vale. */
  .seg button.on { background: var(--accent-soft); color: var(--accent); }
  .chip { padding: 3.5px 8px; }
  .tog[disabled] { opacity: .4; cursor: default; }
  .lnk { color: var(--accent); font-weight: 600; font-family: var(--sans); font-size: 10px; }
  /* Forma e misura vengono da app.css: qui solo ciò che serve perché sia un pulsante,
     e il segno di quale hai scelto. */
  .sw { padding: 0; }
  .sw.on { outline: 2px solid var(--ink); outline-offset: 1px; }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .mt { font-size: 10px; color: var(--muted); }
  .sn:focus-visible, .seg button:focus-visible, .chip:focus-visible,
  .tog:focus-visible, .x:focus-visible, .sw:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
</style>
