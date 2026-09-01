<script lang="ts">
  // Le impostazioni: un riquadro quasi a tutto schermo, nove sezioni.
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
  import type { StatoTelefono, Storage, SystemInfo } from '../lib/api.ts'
  import type { Stats } from '$core/stats.ts'
  import type { Call } from '../lib/notify.svelte.ts'
  import type { Theme } from '../lib/theme.svelte.ts'
  import { MIN as TAGLIA_MIN, MAX as TAGLIA_MAX, STEP as TAGLIA_STEP } from '../lib/textsize.svelte.ts'
  import type { FontFamily } from '../lib/fontfamily.svelte.ts'
  import { MODE_BLURB, MODE_ICON, project } from '../lib/view.ts'
  import { AZIONI, combos } from '../lib/actions.ts'
  import { conflicts, format, fromEvent, parse, stringify } from '../lib/shortcuts.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  type Sezione = 'permissions' | 'agent' | 'shortcuts' | 'projects' | 'notifications' | 'phone'
    | 'appearance' | 'usage' | 'storage' | 'system'
  let sez = $state<Sezione>('permissions')
  /** Solo su schermo stretto: sei **dentro** una sezione, o stai guardando il menu.
   *  Si riparte sempre dal menu — aprire le impostazioni su una sezione a caso sarebbe
   *  entrare in una stanza senza aver visto la casa. */
  let dentro = $state(false)

  const SEZIONI: { id: Sezione; nome: string; icona: string }[] = [
    { id: 'permissions', nome: 'Permissions', icona: 'i-shield' },
    { id: 'agent', nome: 'Agent', icona: 'i-brain' },
    { id: 'shortcuts', nome: 'Shortcuts', icona: 'i-bolt' },
    { id: 'projects', nome: 'Projects', icona: 'i-folder' },
    { id: 'notifications', nome: 'Notifications', icona: 'i-bell' },
    { id: 'phone', nome: 'Phone', icona: 'i-phone' },
    { id: 'appearance', nome: 'Appearance', icona: 'i-palette' },
    { id: 'usage', nome: 'Usage', icona: 'i-chart' },
    { id: 'storage', nome: 'Storage', icona: 'i-disk' },
    { id: 'system', nome: 'System', icona: 'i-monitor' },
  ]

  // ─── scorciatoie ──────────────────────────────────────────────────────────

  /** Quale azione sta aspettando una combinazione. Una alla volta: due catture insieme
   *  vorrebbero dire non sapere a chi assegnare il tasto che arriva. */
  let catturo = $state<string | null>(null)

  const mappa = $derived(combos(store.settings?.shortcuts))
  const scontri = $derived(conflicts(mappa))

  /**
   * Registra la combinazione **premendola**, non scrivendola.
   *
   * Scriverla a parole è il modo più facile per salvarne una che non esiste — `ctlr+k`
   * non dà errore, semplicemente non scatta mai. Premendola, ciò che si salva è
   * esattamente ciò che il browser vedrà arrivare.
   */
  async function cattura(id: string, e: KeyboardEvent): Promise<void> {
    e.preventDefault()
    // E si ferma **qui**: senza, lo stesso evento sale fino al gancio globale, che nel
    // frattempo ha già la combinazione appena salvata (il salvataggio aggiorna lo
    // stato prima di sentire il daemon) — e assegnare una scorciatoia la eseguiva
    // all'istante. Visto succedere guidando la UI: registrata ⌘⇧P, si apriva la
    // palette sopra le impostazioni.
    e.stopPropagation()
    // Esc annulla la cattura invece di essere assegnato: è l'unica via d'uscita che
    // vale ovunque in STARK, e prendersela qui la toglierebbe proprio a chi si è
    // appena infilato in una modalità che aspetta un tasto.
    if (e.key === 'Escape') { catturo = null; return }
    const c = fromEvent(e)
    if (!c) return                       // un modificatore da solo non è una scorciatoia
    catturo = null
    await salvaCombo(id, stringify(c))
  }

  async function salvaCombo(id: string, valore: string | null): Promise<void> {
    const s = store.settings
    if (!s) return
    const next = { ...(s.shortcuts ?? {}) }
    // Tornare al default vuol dire **togliere** la voce, non scriverci sopra il valore
    // di partenza: se un domani il default cambia, chi non l'ha mai toccata deve
    // prendersi quello nuovo invece di restare inchiodata al vecchio.
    if (valore === null) delete next[id]
    else next[id] = valore
    await store.saveSettings({ ...s, shortcuts: next })
  }

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

  /** Il modello preferito delle chat nuove. La scelta passa per il **catalogo vero**
   *  (store.catalogo — ciò che gli agent di questa macchina dichiarano): un elenco
   *  scritto qui sarebbe un secondo posto che mente sui modelli che esistono. Il
   *  catalogo si carica alla prima visita della sezione, non all'avvio: chi non
   *  guarda mai questa pagina non lo paga.
   *
   *  Non tocca il «New chat here» del menu contestuale (porta il modello della chat
   *  da cui si è premuto, per scelta) né le chat riprese. */
  async function salvaPreferita(v: string | null): Promise<void> {
    const s = store.settings
    if (!s) return
    if (!v) {
      await store.saveSettings({ ...s, preferredModel: undefined })
      return
    }
    const [agent = '', model = ''] = v.split('\u0000')
    await store.saveSettings({ ...s, preferredModel: { agent, model } })
  }

  // Il catalogo: gli agent con i loro modelli, come lo dichiara la macchina.
  let catalogo = $state<NonNullable<typeof store.catalogo> | null>(null)
  $effect(() => {
    if (sez === 'agent' && catalogo === null && store.catalogo === null) {
      void store.caricaCatalogo()
    }
  })
  $effect(() => { if (store.catalogo && catalogo === null) catalogo = store.catalogo })

  /** La coppia selezionata, come chiave per il `<select>`: agent e id uniti da un
   *  separatore che nessun id contiene. */
  const chiavePreferita = (a: string, m: string): string => `${a}\u0000${m}`
  const preferitaChiave = $derived(store.settings?.preferredModel
    ? chiavePreferita(store.settings.preferredModel.agent, store.settings.preferredModel.model)
    : '')

  const ETICHETTA_AGENT: Record<string, string> = { 'claude-code': 'Claude Code', opencode: 'OpenCode' }

  async function setDesc(v: boolean): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({ ...s, toolDescriptions: v })
  }

  /** La modalità con cui partono le chat nuove. Non tocca quelle già aperte: i loro
   *  hook sono stati installati all'avvio, e rinegoziarli a metà turno non si può. */
  async function salvaModo(agent: string, m: string): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({
      ...s,
      defaultModes: { ...(s.defaultModes ?? {}), [agent]: m },
      // La preferenza unica resta allineata per l'agent di default: un file scritto
      // oggi deve restare leggibile da una versione che non conosce `defaultModes`.
      ...(agent === 'claude-code' ? { defaultMode: m } : {}),
    })
  }

  // ─── quali agent, e quali modalità hanno ──────────────────────────────────
  // Le voci NON sono scritte qui: le dichiara l'agent (ADR-014). Prima c'erano `auto` e
  // `default` a mano nel browser — due parole di Claude Code, che su un altro agent non
  // vogliono dire niente.
  let agenti = $state<NonNullable<SystemInfo['agents']> | null>(null)
  let telStato = $state<StatoTelefono | null>(null)
  $effect(() => {
    if (agenti === null) {
      void store.api.system().then(
        s => { agenti = (s.agents ?? []).filter(a => a.available && a.modes.length > 0) },
        () => { agenti = [] },
      )
    }
  })
  const AGENT_NOMI: Record<string, string> = { 'claude-code': 'Claude Code', opencode: 'OpenCode' }
  const modoDi = (id: string): string =>
    store.settings?.defaultModes?.[id]
    ?? (id === 'claude-code' ? (store.settings?.defaultMode ?? '') : '')
    ?? ''

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

  const FONT: { id: FontFamily; nome: string }[] = [
    { id: 'default', nome: 'Default' }, { id: 'system', nome: "This computer's font" },
  ]

  // ─── quello che si chiede al daemon solo quando serve ──────────────────────

  let storage = $state<Storage | null>(null)
  let system = $state<SystemInfo | null>(null)
  let errore = $state('')
  let erroreStorage = $state('')

  // ─── uso ──────────────────────────────────────────────────────────────────
  //
  // Non c'è niente da salvare qui: sono venti numeri **derivati** dai journal che ci
  // sono già. Quindi nessun contatore da scrivere, nessun evento nuovo, e la risposta
  // vale anche per tutto il passato — comprese le conversazioni di prima che questa
  // schermata esistesse.

  const PERIODI: { id: string; nome: string; giorni?: number }[] = [
    { id: 'today', nome: 'Today', giorni: 0 },
    { id: '7d', nome: '7 days', giorni: 7 },
    { id: '30d', nome: '30 days', giorni: 30 },
    { id: 'all', nome: 'All' },
  ]
  let periodo = $state('7d')
  let uso = $state<Stats | null>(null)
  let erroreUso = $state('')

  /** L'inizio del periodo scelto, a **mezzanotte**: «7 days» vuol dire sette giornate,
   *  non sette volte ventiquattr'ore a partire da adesso — se no la barra di oggi
   *  sarebbe mezza e quella di sette giorni fa pure. */
  function daQuando(id: string): number | undefined {
    const p = PERIODI.find(x => x.id === id)
    if (!p || p.giorni === undefined) return undefined
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime() - p.giorni * 86_400_000
  }

  $effect(() => {
    // Rileggere a ogni cambio di periodo: il filtro lo applica il daemon, che è
    // l'unico ad avere gli snapshot — mandarli qui per tagliarli nel browser vorrebbe
    // dire spedire la storia intera di ogni conversazione per calcolare venti numeri.
    if (sez !== 'usage') return
    const p = periodo
    const from = daQuando(p)
    void store.api.stats(from === undefined ? {} : { from }).then(
      s => { if (periodo === p) { uso = s; erroreUso = '' } },
      e => { if (periodo === p) { erroreUso = String(e.message ?? e) } })
  })

  const migliaia = (n: number): string => n.toLocaleString()

  /**
   * I giorni **senza uso** vanno disegnati lo stesso, a zero.
   *
   * `perGiorno` riporta solo i giorni in cui è successo qualcosa, che è la cosa
   * giusta per un dato; ma incollare quelle barre una accanto all'altra disegna un
   * asse falso — sei giorni sparsi su due settimane sembrerebbero sei giorni di fila.
   * Il buco è un'informazione: dice che quel giorno STARK non l'hai aperto.
   */
  function giorniPieni(righe: Stats['perGiorno']): { day: string; prompts: number; ms: number }[] {
    const primo = righe[0]?.day
    const ultimo = righe[righe.length - 1]?.day
    if (!primo || !ultimo) return []
    const visti = new Map(righe.map(r => [r.day, r.c]))
    const out: { day: string; prompts: number; ms: number }[] = []
    // Mezzogiorno e non mezzanotte: sommando 24 ore da mezzanotte si inciampa nel
    // cambio dell'ora legale, e una giornata sparirebbe o si sdoppierebbe.
    const d = new Date(`${primo}T12:00:00`)
    const fine = new Date(`${ultimo}T12:00:00`)
    while (d <= fine && out.length < 400) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const c = visti.get(key)
      out.push({ day: key, prompts: c?.prompts ?? 0, ms: c?.agentMs ?? 0 })
      d.setDate(d.getDate() + 1)
    }
    return out
  }

  /** Un tempo che si legge a colpo d'occhio. I secondi spariscono oltre l'ora: su
   *  quaranta ore di lavoro non dicono niente e allungano la riga. */
  function durata(ms: number): string {
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

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
    // Aprendo la sezione, non all'avvio: legge lo stato di Tailscale, che costa due
    // `execFile`. Stessa condotta della diagnostica qui sotto.
    if (sez === 'phone' && telStato === null) void store.api.phone().then(x => { telStato = x })
  })

  const mb = (n: number): string =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`

  let copiato = $state('')
  // ─── il link da portare in un altro browser ────────────────────────────────
  //
  // `location.origin` e non `sys.url`: quello dice sempre `http://127.0.0.1:<porta>`,
  // che è giusto per un'altra finestra su questa macchina e sbagliato per tutto il
  // resto. L'indirizzo da cui stai leggendo questa pagina funziona in entrambi i casi —
  // se sei entrato dal telefono via Tailscale o dal dominio pubblico, è quello.
  //
  // Punta alla **chat aperta** se ce n'è una, perché è il caso per cui uno copia un
  // link. Il valore non si indovina: la riga qui sotto mostra esattamente l'indirizzo
  // che finirà negli appunti, col solo token mascherato — come la riga «Token» sopra.
  const linkAltrove = $derived(
    `${location.origin}${store.selected ? `/chat/${store.selected}` : '/'}?token=${store.api.tokenValue}`)
  const linkMostrato = $derived(
    `${location.origin}${store.selected ? `/chat/${store.selected}` : '/'}?token=•••`)

  // ─── riavvio del daemon ────────────────────────────────────────────────────
  //
  // Serve a prendersi un aggiornamento senza tornare al terminale: `git pull` e poi
  // questo bottone. Ricompila anche `ui/dist`, che è un artefatto locale — senza,
  // dopo un pull che tocca `ui/` il browser continuerebbe a ricevere il pacchetto
  // vecchio e il riavvio sembrerebbe non aver fatto niente.
  let riavvio = $state<'no' | 'conferma' | 'in corso'>('no')
  /** Quante conversazioni hanno un processo dietro: sono figlie del daemon, quindi si
   *  fermano tutte. È il costo, e va detto **prima**, non scoperto dopo. */
  const vive = $derived(store.rows.filter(r => r.live).length)

  async function riavvia(): Promise<void> {
    riavvio = 'in corso'
    try {
      await store.api.restart(true)
      // Non si chiude il dialogo e non si ricarica: il flusso cade da sé e la pagina
      // si ricollega quando il daemon torna, che è ciò che già fa dopo un riavvio da
      // terminale. Ricaricare adesso significherebbe chiedere una pagina a un
      // processo che si sta spegnendo.
      // E poi si aspetta che torni, per **smettere** di dire «Restarting»: senza, la
      // riga resterebbe lì anche a daemon tornato — cioè direbbe una cosa falsa
      // proprio mentre tutto il resto della pagina si è già ricollegato.
      const torna = async (): Promise<void> => {
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 500))
          try {
            const r = await fetch('/api/health', { headers: store.api.authHeaders })
            if (r.ok) { riavvio = 'no'; return }
          } catch { /* ancora spento: è quello che stiamo aspettando */ }
        }
        // Un minuto senza risposta non è più «sta ripartendo»: è qualcosa da guardare.
        riavvio = 'no'
        store.refused = 'STARK did not come back — check daemon.log'
      }
      void torna()
    } catch (e) {
      riavvio = 'no'
      const msg = (e as Error).message
      // Il caso che capita **per primo a chiunque**, e che senza questa riga sembra un
      // bottone rotto: il daemon acceso è più vecchio di questa pagina. Node legge i
      // `.ts` all'avvio, quindi un processo partito prima che questa rotta esistesse
      // non ce l'ha e risponde 404 — e la UI, che invece è appena stata ricompilata, il
      // bottone ce l'ha. È l'uovo e la gallina di ogni riavvio-da-dentro: la prima
      // volta si passa dal terminale, dalla seconda in poi basta questo bottone.
      store.refused = msg.startsWith('404')
        ? 'This daemon is older than this page: it does not have the restart route yet. '
          + 'Restart it once from a terminal (`stark stop` then `stark up`) — after that, '
          + 'this button works.'
        : `restart failed: ${msg}`
    }
  }

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

        <!-- Il modello preferito delle chat nuove. Sta DOPO le modalità perché
             risponde alla domanda gemella: con che MODE partono, con che MODELLO
             partono. L'elenco è il catalogo vero raggruppato per agent — optgroup,
             non una lista appiattita: 151 modelli di un agent solo in fila con
             l'intestazione che dice di chi è, era la lezione del picker. -->
        <div class="fgroup">
          <div class="flabel">New chats start with model…</div>
          <div class="prow">
            <div>
              <div class="pn">Preferred model</div>
              <div class="pd">new chats open with it — except «New chat here», which
              carries the model of the chat you pressed</div>
            </div>
            <!-- Value, non bind: la fonte è lo store (le impostazioni che il daemon
                 ha scritto davvero), non uno stato locale che diverrebbe la verità
                 al posto suo. -->
            <select class="inp sel" value={preferitaChiave}
              onchange={(e) => void salvaPreferita((e.currentTarget as HTMLSelectElement).value || null)}>
              <option value="">Default — the agent's own first choice</option>
              {#each catalogo ?? [] as a (a.id)}
                <optgroup label={ETICHETTA_AGENT[a.id] ?? a.label ?? a.id}>
                  {#each a.models as m (m.id)}
                    <option value={chiavePreferita(a.id, m.id)}
                      selected={preferitaChiave === chiavePreferita(a.id, m.id)}>
                      {m.label ?? m.id}
                    </option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <div class="hint">The preference is bound to its agent: if a chat picks a
          different agent, the preferred model doesn't exist there and the agent's
          own default applies.</div>
        </div>

        <!-- La modalità di partenza. Era l'unica differenza strutturale fra STARK e il
             terminale, e non si poteva toccare: `auto` era cablato nel registro.
             Misurato il 27 agosto 2026 — `claude` senza `--permission-mode` parte in
             `default`.
             Dopo ADR-014 le voci non stanno più qui: le dichiara l'agent, e ce n'è un
             riquadro per ciascuno. Senza scelta salvata parte la prima che l'agent
             dichiara disponibile — non `auto`, che è una parola di Claude Code. -->
        {#each agenti ?? [] as a (a.id)}
          <div class="fgroup">
            <div class="flabel">New chats start in…{#if (agenti?.length ?? 0) > 1}
              <span style="color:var(--muted)"> · {AGENT_NOMI[a.id] ?? a.id}</span>{/if}</div>
            <!-- Lo **stesso pannello** che si apre dalla barra della chat (`Status.svelte`):
                 una riga per modalità, con icona, nome e cosa fa sulla riga stessa. Prima
                 erano cinque parole in fila e le descrizioni raccolte in un blocco sotto,
                 quindi per sapere cosa faceva «acceptEdits» bisognava rileggerlo altrove e
                 riappaiarlo a mano — la scelta e la sua conseguenza stavano in due posti.
                 Le voci **spente** ora restano in elenco con la ragione accanto, come nella
                 barra: prima venivano filtrate via, perché un controllo a segmenti non sa
                 dire «questa non si può, ed ecco perché» — una riga sì, ed è il Principio 5
                 (mai nascosta, disabilitata con la spiegazione). -->
            <div class="menu modes" role="radiogroup"
              aria-label="Starting mode for {AGENT_NOMI[a.id] ?? a.id}">
              {#each a.modes as m (m.mode)}
                {@const scelta = modoDi(a.id) === m.mode}
                <button class="mi" class:on={scelta} class:dis={!m.available}
                  role="radio" aria-checked={scelta} disabled={!m.available}
                  onclick={() => void salvaModo(a.id, m.mode)}>
                  <Icon name={MODE_ICON[m.mode] ?? 'i-shield'}
                    style={scelta ? 'color:var(--accent)' : ''} />
                  <!-- Stessa precedenza della barra: `reason` dice perché una voce è
                       spenta e viene prima; `note` è la descrizione dell'agent; e
                       `MODE_BLURB` resta il ripiego per chi non ne dichiara nessuna. -->
                  <span class="mtxt">{m.label ?? m.mode}<span class="sub"
                    >{m.reason ?? m.note ?? MODE_BLURB[m.mode] ?? ''}</span></span>
                  {#if !m.available}<span class="tag">unavailable</span>
                  {:else if scelta}<Icon name="i-check" style="color:var(--accent)" />{/if}
                </button>
              {/each}
            </div>
            <!-- Questa è prosa su una MISURA fatta su Claude Code, non una regola del
                 modello: mostrarla sotto le modalità di un altro agent sarebbe dire una
                 cosa falsa. La parte funzionale — quali modalità esistono — viene
                 dall'agent; questa è documentazione, ed è legata a chi è stato misurato. -->
            {#if a.id === 'claude-code'}
              <div class="hint">Measured, so you can choose knowing: the same work in
              <b>auto</b> and <b>default</b> cost the same tokens (190k against 190k), and the
              classifier did not move the plan quota by a single percentage point over 32 tool
              calls — it is below what the meter can see. The real difference is not the bill,
              it is whether you get interrupted.</div>
            {/if}
          </div>
        {/each}

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

      <!-- ─── Shortcuts ───────────────────────────────────────────────── -->
      {:else if sez === 'shortcuts'}
        <div class="fgroup">
          <div class="flabel">Keyboard</div>
          <div>
            {#each AZIONI as a (a.id)}
              {@const combo = parse(mappa[a.id])}
              {@const scontro = combo ? scontri[stringify(combo)] : undefined}
              <div class="prow">
                <div>
                  <div class="pn">{a.label}</div>
                  <div class="pd">{a.hint}</div>
                </div>
                <span class="kbrow">
                  <button class="kb" class:cap={catturo === a.id}
                    onclick={() => { catturo = catturo === a.id ? null : a.id }}
                    onkeydown={e => { if (catturo === a.id) void cattura(a.id, e) }}>
                    {catturo === a.id ? 'Press a key…' : format(combo)}
                  </button>
                  {#if mappa[a.id] !== a.default}
                    <button class="lnk" onclick={() => void salvaCombo(a.id, null)}>reset</button>
                  {/if}
                </span>
              </div>
              {#if scontro && scontro.length > 1}
                <div class="notice">
                  <Icon name="i-warn" />
                  <span><b>Two actions share this shortcut.</b> The first one in this list wins:
                  {scontro.map(id => AZIONI.find(x => x.id === id)?.label ?? id).join(', ')}.</span>
                </div>
              {/if}
            {/each}
          </div>
          <div class="hint">Shortcuts live on this machine, with the rest of the settings — so
            they follow you across browsers. What is saved says <code>mod</code>, not ⌘ or Ctrl:
            each device resolves it to the key it actually has, which is why the same setting
            works on a Mac and on a PC.</div>
          <div class="notice">
            <Icon name="i-bolt" />
            <span>While you are typing, only shortcuts that use <code>mod</code> fire — a bare
            letter is text, and taking it would open windows while you write a prompt.
            <b>Esc can't be assigned</b>: it is how everything closes, this capture included.</span>
          </div>
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

      {:else if sez === 'phone'}
        <!-- Qui c'è la **porta**, non una seconda copia del pannello. Il pannello vero è
             `Phone.svelte`, e ci si arriva anche dall'icona in cima all'elenco: due
             schermate che dicono la stessa cosa sono due schermate da tenere allineate,
             e la prima volta che divergono nessuno sa quale ha ragione. Quello che sta
             qui è ciò che una schermata di impostazioni deve dire da sé — a che punto
             sei — più la via per andare avanti. -->
        <div class="ssub">
          A phone reaches STARK through your Tailscale network: nothing is published to
          the internet, and the connection still arrives from this machine's loopback.
        </div>
        <div class="prow">
          <div>
            <div class="pn">Tailscale account</div>
            <div class="pd">
              {#if telStato === null}Checking…
              {:else if telStato.tailscale.host}Signed in as {telStato.tailscale.host}
              {:else}This machine is not signed in{/if}
            </div>
          </div>
          <button class="btn" style="margin-left:auto"
            onclick={() => { store.dialog = { kind: 'phone' } }}>
            {telStato?.tailscale.host ? 'Open' : 'Connect Tailscale account'}
          </button>
        </div>
        <div class="prow">
          <div>
            <div class="pn">Connected phones</div>
            <div class="pd">
              {#if telStato === null}—
              {:else if telStato.devices.length === 0}None yet
              {:else}{telStato.devices.map(d => d.nome).join(', ')}{/if}
            </div>
          </div>
          <button class="btn" style="margin-left:auto"
            onclick={() => { store.dialog = { kind: 'phone' } }}>Connect a phone</button>
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
          <div class="flabel">Text size — {store.textSize.scelto}%</div>
          <input class="slider" type="range" min={TAGLIA_MIN} max={TAGLIA_MAX} step={TAGLIA_STEP}
            value={store.textSize.scelto}
            oninput={(e) => store.textSize.set(Number(e.currentTarget.value))} />
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
      <!-- ─── Usage ───────────────────────────────────────────────────── -->
      {:else if sez === 'usage'}
        <div class="fgroup">
          <div class="seg">
            {#each PERIODI as p (p.id)}
              <button class:on={periodo === p.id} onclick={() => { periodo = p.id }}>{p.nome}</button>
            {/each}
          </div>
        </div>

        {#if erroreUso}
          <!-- Un errore si dice. Disegnare degli zeri al suo posto direbbe «non l'hai
               mai usato», che è la bugia peggiore proprio su questa schermata. -->
          <div class="hint">{erroreUso}</div>
        {:else if !uso}
          <div class="hint">Reading the journals…</div>
        {:else}
          <div class="fgroup">
            <div class="ucells">
              <div class="ucell"><b>{migliaia(uso.totale.prompts)}</b><span>prompts</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.chars)}</b><span>characters typed</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.conversations)}</b><span>conversations</span></div>
              <div class="ucell"><b>{durata(uso.totale.agentMs)}</b><span>agent working</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.tools)}</b><span>operations</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.files)}</b><span>files touched</span></div>
            </div>
            <div class="hint">
              «Agent working» is the time the agent spent on your turns — not the time you
              spent in STARK, which nobody measures and which it would be wrong to claim.
            </div>
          </div>

          <div class="fgroup">
            <div class="flabel">Tokens</div>
            <div class="ucells">
              <div class="ucell"><b>{migliaia(uso.totale.tokens.input)}</b><span>input</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.tokens.output)}</b><span>output</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.tokens.cacheRead)}</b><span>cache read</span></div>
              <div class="ucell"><b>{migliaia(uso.totale.tokens.cacheWrite)}</b><span>cache write</span></div>
            </div>
            <!-- Niente dollari, di proposito: su un abbonamento a quota fissa quello è
                 un prezzo di listino API, non una spesa, e in una schermata di
                 statistiche si leggerebbe come denaro uscito. -->
            <div class="hint">No cost in dollars: on a fixed-quota plan that number is an API
            list price, not money you spent. What runs out is quota, and the status bar tracks it.</div>
          </div>

          {#if uso.totale.aborted + uso.totale.errored + uso.totale.interrupted > 0}
            <div class="fgroup">
              <div class="flabel">Turns that ended badly</div>
              <div class="hint">
                {uso.totale.aborted} stopped by you · {uso.totale.errored} errored ·
                {uso.totale.interrupted} cut short by a crash
              </div>
            </div>
          {/if}

          {#if uso.perGiorno.length > 1}
            {@const giorni = giorniPieni(uso.perGiorno)}
            {@const max = Math.max(...giorni.map(x => x.prompts), 1)}
            <div class="fgroup">
              <div class="flabel">By day</div>
              <!-- Nessuna libreria di grafici: sono N div con un'altezza in percentuale.
                   Aggiungere una dipendenza per un istogramma sarebbe sproporzionato. -->
              <div class="ubars">
                {#each giorni as g (g.day)}
                  <div class="ubar" title="{g.day} · {g.prompts} prompts · {durata(g.ms)}">
                    <!-- Un giorno a zero resta **vuoto**: un moncherino alto due pixel si
                         leggerebbe come «poco», e poco non è niente. -->
                    {#if g.prompts > 0}
                      <div style="height:{Math.max(4, (g.prompts / max) * 100)}%"></div>
                    {/if}
                  </div>
                {/each}
              </div>
              <div class="hint">{giorni[0]?.day} → {giorni[giorni.length - 1]?.day}
              · tallest bar is {max} prompts</div>
            </div>
          {/if}

          <div class="fgroup">
            <div class="flabel">By project</div>
            <div>
              {#each uso.perProgetto as r (r.key)}
                <div class="nrow">
                  <div>
                    <div class="nn">{r.key === 'unknown' ? 'no folder' : project(r.key)}</div>
                    <div class="nd">{migliaia(r.c.prompts)} prompts · {migliaia(r.c.chars)} chars</div>
                  </div>
                  <span class="rt"><span class="mt">{durata(r.c.agentMs)}</span></span>
                </div>
              {/each}
            </div>
          </div>

          <div class="fgroup">
            <div class="flabel">By agent and model</div>
            <div>
              {#each [...uso.perAgent, ...uso.perModello] as r (r.key)}
                <div class="nrow">
                  <div><div class="nn">{r.key}</div>
                    <div class="nd">{migliaia(r.c.prompts)} prompts</div></div>
                  <span class="rt"><span class="mt">{durata(r.c.agentMs)}</span></span>
                </div>
              {/each}
            </div>
            <!-- Il modello è quello **attuale** della chat, non quello di ogni turno, che
                 nel journal per turno non c'è: una chat spostata a metà strada finisce
                 tutta sull'ultimo. È il dato che esiste; l'alternativa è inventarlo. -->
            <div class="hint">A chat counts under the model it is on <b>now</b> — the journal does
            not record a model per turn.</div>
          </div>

          <div class="fgroup">
            <div class="hint">Counted from the conversations on <b>this machine</b>. Journals do not
            sync between machines, so your other computer has its own numbers.</div>
          </div>
        {/if}

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
            <span class="k2">Open elsewhere</span>
            <!-- Stessa forma delle righe «Address» e «Home» qui sopra: il valore va a capo
                 se non ci sta, invece di essere troncato. Su uno schermo stretto un URL
                 mozzato coi puntini non serve a niente — questo è un indirizzo da
                 leggere e da riconoscere, non un'etichetta. -->
            <span class="v2" title={linkMostrato}>{linkMostrato}
              <button class="lnk" onclick={() => void copia('link', linkAltrove)}>
                {copiato === 'link' ? 'Copied' : 'Copy link'}</button></span>
            <span class="k2">Listening on</span><span class="v2">{system.listening}</span>
            {#if system.perimeter?.open}
              <span class="k2">Reachable as</span>
              <span class="v2">{#each system.perimeter.hosts as h, i}{i > 0 ? ', ' : ''}{h.host}<span
                style="color:var(--muted)">&nbsp;({h.source})</span>{/each}</span>
            {/if}
            <span class="k2">Home</span><span class="v2">{system.home}</span>
          </div>
          {#if system.perimeter?.open}
            <div class="notice"><b>STARK is reachable from outside this machine.</b> Anyone who
            can reach those names <b>and</b> has the token can make an agent run commands as root
            here. That is the point — it is how you use STARK from your phone — but it is not the
            default: it was turned on with <code>STARK_PUBLIC_HOST</code> (or by Tailscale) on the
            machine itself, and it can only be turned off there, because the perimeter is read once
            when the daemon starts.</div>
          {/if}
          <div class="hint"><b>Open elsewhere</b> is the address plus the token, which is what
          another browser needs: the token is dropped from the address bar on the first load and
          moved into a cookie, so the URL you copy from there has nothing in it. It is needed
          <b>once per browser</b> — after that the cookie does the work. Treat that link like a
          root password: whoever has it can make an agent run commands on this machine.</div>
          <div class="hint">The token now <b>stays the same across restarts</b>: it lives in
          <code>{system.home}/token</code> with <code>0600</code>, which is what lets
          you keep this tab open. To replace it:
          <code>npm run stark:token -- --new</code>, then restart the daemon — it cannot be done
          from here without cutting this page off mid-sentence.</div>
        </div>

        <div class="fgroup">
          <div class="flabel">Updates</div>
          {#if riavvio === 'no'}
            <div class="prow">
              <div>
                <div class="pn">Restart the daemon</div>
                <div class="pd">picks up new code, and rebuilds the UI</div>
              </div>
              <button class="opt" onclick={() => { riavvio = 'conferma' }}>Restart…</button>
            </div>
          {:else if riavvio === 'conferma'}
            <div class="notice">
              <Icon name="i-warn" />
              <span>
                {#if vive > 0}
                  <b>This stops {vive} running {vive === 1 ? 'chat' : 'chats'}.</b>
                  Every agent runs as a child of the daemon, so a turn in progress dies mid-way.
                  The conversations stay — you wake them again afterwards.
                {:else}
                  <b>No chat is running right now</b>, so nothing is interrupted.
                {/if}
                This page reconnects on its own once STARK is back.
              </span>
            </div>
            <div class="prow">
              <div><div class="pd">Rebuilding the UI takes a second or two.</div></div>
              <span class="kbrow">
                <button class="opt" onclick={() => { riavvio = 'no' }}>Cancel</button>
                <button class="opt pri" onclick={() => void riavvia()}>Restart now</button>
              </span>
            </div>
          {:else}
            <div class="notice">
              <Icon name="i-loader" />
              <span><b>Restarting.</b> The connection is about to drop — this page comes back
              by itself. If it does not, STARK is at <code>{sys.url}</code>.</span>
            </div>
          {/if}
          <div class="hint">The same as <code>stark stop</code> then <code>stark up</code> in a
          terminal, run from here: a detached helper waits for this process to die, rebuilds
          <code>ui/dist</code> and starts the new one. A process cannot restart itself — that
          helper is the whole trick.</div>
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

  /* La combinazione si legge come un tasto, non come un'etichetta: è la stessa cosa
     che si preme, quindi somigliargli aiuta a riconoscerla in mezzo al testo. */
  .kbrow { display: flex; align-items: center; gap: 8px; flex: none; }
  .kb {
    min-width: 78px; padding: 3px 9px; cursor: pointer;
    border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2);
    color: inherit; font-family: var(--mono); font-size: 11px;
  }
  .kb.cap { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  /* Forma e misura vengono da app.css: qui solo ciò che serve perché sia un pulsante,
     e il segno di quale hai scelto. */
  .sw { padding: 0; }
  .sw.on { outline: 2px solid var(--ink); outline-offset: 1px; }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .mt { font-size: 10px; color: var(--muted); }

  /* I numeri dell'uso. `auto-fill` invece di un numero di colonne: la stessa griglia
     serve su schermo largo e sotto gli 860px, dove ci stanno due celle invece di tre,
     e una media query direbbe la stessa cosa in due posti. */
  /* `.ucells` e non `.ugrid`: quel nome esiste gia' in app.css (`26px 1fr`, la griglia
     dell'uso della quota) e vinceva su questa — la stessa collisione gia' costata una
     volta con `.row`/`.split`. Un nome nuovo, non una gara di specificita'. */
  .ucells { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
  .ucell {
    display: flex; flex-direction: column; gap: 2px;
    padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--surface-2);
  }
  .ucell b { font-size: 17px; font-variant-numeric: tabular-nums; }
  .ucell span { font-size: 10px; color: var(--muted); }

  /* L'istogramma: le barre crescono dal basso, quindi `align-items:flex-end`. Il
     contenitore ha un'altezza fissa perché una percentuale ha bisogno di qualcosa di
     cui essere una percentuale. */
  /* `justify-content:flex-start` con un tetto per barra: senza, sei giorni si
     spartiscono la larghezza e diventano lastre, che si leggono come un'altra cosa. */
  .ubars { display: flex; align-items: flex-end; justify-content: flex-start; gap: 2px; height: 64px; }
  .ubar { flex: 1 1 0; max-width: 22px; height: 100%; display: flex; align-items: flex-end; min-width: 3px; }
  .ubar > div { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; }
  /* ─── Le modalità di partenza ──────────────────────────────────────────────
     Il pannello è quello globale — `.menu` e `.mi` in `app.css`, gli stessi che la
     barra della chat apre col chip della modalità — così le due schermate che
     scelgono la stessa cosa si somigliano invece di somigliarsi per caso. Qui si
     ridichiara solo ciò che cambia fra una tendina e una sezione delle impostazioni:
     la larghezza (là è un riquadro sospeso, qui è la colonna), l'ombra (serve a
     staccare una tendina dal contenuto sotto; dentro un pannello opaco è rumore) e la
     misura del testo, che nel resto della sezione è quella di `.prow`, non quella più
     stretta della barra.
     Il reset del bottone va rifatto qui, e non è una dimenticanza di `app.css`: là
     `.mi` è solo forma e colore, e ogni componente che la usa toglie da sé l'aspetto
     di pulsante del browser (`Status.svelte` fa lo stesso). Senza, queste righe
     avrebbero il bordo grigio e il fondo di sistema. */
  /* La tendina del modello preferito: piena larghezza della colonna e sotto al
     titolo — a destra, come i segmenti, non ci sta: gli id dei modelli sono lunghi
     (opencode/nemotron-3.5-lightning-free) e su un pannello stretto spingerebbero
     fuori la riga. Il vestito segue le caselle del resto della sezione. */
  select.sel {
    width: 100%; margin-top: 8px; font: inherit; font-size: 11px; color: var(--ink);
    background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 8px;
    padding: 6px 9px; cursor: pointer;
  }
  select.sel:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .modes { width: auto; box-shadow: none; }
  .modes .mi {
    width: 100%; border: 0; background: none; color: var(--ink); font: inherit;
    text-align: left; cursor: pointer;
    align-items: flex-start; gap: 8px; padding: 7px 9px; font-size: 11px;
  }
  /* L'icona sta sulla prima riga del testo, non in mezzo alle due: la riga è alta due
     righe (nome e descrizione) e centrarla la lascerebbe a metà fra le due, cioè
     accanto a niente. Stessa ragione per `align-items: flex-start` qui sopra. */
  .modes .mi :global(svg.ic) { flex: none; margin-top: 1.5px; }
  .modes .mtxt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .modes .mi .sub { font-size: 10px; line-height: 1.4; }
  /* `.mtxt` e non `.mn`, che in `app.css` è già la riga **tolta** di un diff, colore
     `--del` compreso: la classe esisteva, la regola vinceva, e i nomi delle modalità
     venivano rosso-salmone. Misurato leggendo il colore calcolato, non guardando lo
     screenshot — è la stessa collisione di `.row` con la riga di un tool, che era
     costata i pannelli affiancati. */
  /* La spunta va spinta a destra da qui e non da uno stile inline come nella barra:
     la riga finisce col nome, e senza questo la spunta resterebbe appiccicata a lui. */
  .modes .mi > :global(svg.ic:last-child) { margin-left: auto; margin-top: 2.5px; }
  .modes .mi[disabled] { cursor: default; color: var(--muted); }
  .modes .mi:not([disabled]):hover { background: var(--surface-2); }
  .modes .mi.on { background: var(--accent-soft); }
  .modes .mi.on:hover { background: var(--accent-soft); }
  .modes .mi:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .sn:focus-visible, .seg button:focus-visible, .chip:focus-visible,
  .tog:focus-visible, .x:focus-visible, .sw:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
</style>
