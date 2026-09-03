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
  import ModelPicker from './ModelPicker.svelte'
  import QRCode from 'qrcode'
  import type { CloudStatus, StatoTelefono, Storage, SystemInfo } from '../lib/api.ts'
  import type { Stats } from '$core/stats.ts'
  import type { Call } from '../lib/notify.svelte.ts'
  import type { Theme } from '../lib/theme.svelte.ts'
  import { MIN as TAGLIA_MIN, MAX as TAGLIA_MAX, STEP as TAGLIA_STEP } from '../lib/textsize.svelte.ts'
  import { ZOOM_CHAT_MIN, ZOOM_CHAT_MAX, ZOOM_CHAT_STEP } from '../lib/lettura.svelte.ts'
  import type { FontFamily } from '../lib/fontfamily.svelte.ts'
  import { MODE_BLURB, MODE_ICON, project } from '../lib/view.ts'
  import { AZIONI, combos } from '../lib/actions.ts'
  import { conflicts, format, fromEvent, parse, stringify } from '../lib/shortcuts.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  type Sezione = 'permissions' | 'agent' | 'shortcuts' | 'projects' | 'notifications' | 'phone'
    | 'appearance' | 'usage' | 'storage' | 'system' | 'cloud'
  // Si apre sempre sulla **prima** sezione del menu, che è Agent (chiesto
  // dall'utente, 2 settembre 2026): prima partiva da System — l'ultima aggiunta, non
  // la più guardata — e chi apriva le impostazioni si ritrovava nella diagnostica.
  let sez = $state<Sezione>('agent')
  /** Solo su schermo stretto: sei **dentro** una sezione, o stai guardando il menu.
   *  Si riparte sempre dal menu — aprire le impostazioni su una sezione a caso sarebbe
   *  entrare in una stanza senza aver visto la casa. */
  let dentro = $state(false)
  let storageConfirm: string | null = $state(null)
  let swpopOpen: string | null = $state(null)
  let projectFilter = $state('')
  let agentDdOpen: string | null = $state(null)

  const SEZIONI: { id: Sezione; nome: string; icona: string }[] = [
    { id: 'agent', nome: 'Agent', icona: 'i-brain' },
    { id: 'appearance', nome: 'Appearance', icona: 'i-palette' },
    { id: 'phone', nome: 'Connectivity', icona: 'i-wifi' },
    { id: 'notifications', nome: 'Notifications', icona: 'i-bell' },
    { id: 'projects', nome: 'Projects', icona: 'i-folder' },
    { id: 'shortcuts', nome: 'Shortcuts', icona: 'i-bolt' },
    { id: 'storage', nome: 'Storage', icona: 'i-disk' },
    { id: 'system', nome: 'System', icona: 'i-monitor' },
    { id: 'usage', nome: 'Usage', icona: 'i-chart' },
    { id: 'cloud', nome: 'Cloud', icona: 'i-cloud' },
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

  /** La coppia selezionata, come chiave per il selettore: agent e id uniti da un
   *  separatore che nessun id contiene. */
  const chiavePreferita = (a: string, m: string): string => `${a}\u0000${m}`
  /** Cosa legge la riga quando è chiusa: il default, o la coppia come la conosce il
   *  resto di STARK (agent/model). */
  const preferitaEtichetta = $derived(store.settings?.preferredModel
    ? `${store.settings.preferredModel.agent}/${store.settings.preferredModel.model}`
    : 'Default — the agent\'s own first choice')

  const ETICHETTA_AGENT: Record<string, string> = { 'claude-code': 'Claude Code', opencode: 'OpenCode' }

  async function setDesc(v: boolean): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({ ...s, toolDescriptions: v })
  }

  // ─── freccia su / Esc ─────────────────────────────────────────────────────

  async function setHistoryArrowUp(v: boolean): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({ ...s, historyArrowUp: v })
  }

  async function setInterruptEscape(v: boolean): Promise<void> {
    const s = store.settings
    if (!s) return
    await store.saveSettings({ ...s, interruptEscape: v })
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
  const progettiFiltrati = $derived(
    projectFilter.trim() === ''
      ? progetti
      : progetti.filter(([cwd, nome]) =>
          nome.toLowerCase().includes(projectFilter.toLowerCase()) ||
          cwd.toLowerCase().includes(projectFilter.toLowerCase())
        )
  )

  // ─── notifiche ────────────────────────────────────────────────────────────

  const EVENTI: { id: Call; nome: string; desc: string; icona: string }[] = [
    { id: 'needsYou', nome: 'A chat is waiting for me', desc: 'a permission, or a question to answer', icona: 'i-ask' },
    { id: 'done', nome: 'A chat has finished', desc: 'the task is done, it now waits for a new prompt', icona: 'i-check' },
    { id: 'stopped', nome: 'A chat stopped on its own', desc: 'an error, or the quota ran out', icona: 'i-warn' },
  ]

  const TEMI: { id: Theme; nome: string }[] = [
    { id: 'light', nome: 'Light' }, { id: 'dark', nome: 'Dark' }, { id: 'system', nome: 'System' },
  ]

  const FONT_UI: { id: FontFamily; nome: string }[] = [
    { id: 'default', nome: 'Default' },
    { id: 'system', nome: "This computer's font" },
    { id: 'Arial', nome: 'Arial' },
    { id: 'Georgia', nome: 'Georgia' },
    { id: 'Verdana', nome: 'Verdana' },
  ]
  const FONT_CODE: { id: FontFamily; nome: string }[] = [
    { id: 'default', nome: 'Default' },
    { id: 'system', nome: "This computer's font" },
    { id: 'Consolas', nome: 'Consolas' },
    { id: 'Courier New', nome: 'Courier New' },
  ]

  // ─── la scelta del font ────────────────────────────────────────────────────
  //
  // Portava un selettore con ricerca sopra `queryLocalFonts`, l'elenco dei font
  // **installati sulla macchina** chiesto al browser dentro il gesto di apertura. In
  // pratica il permesso non arriva mai in questo ambiente — misurato: sempre
  // `NotAllowedError`, anche concedendolo dal prompt del browser — e un selettore che
  // promette "i tuoi font" e non ne mostra mai nessuno è peggio di non promettere
  // niente. Al posto della query, un paio di font classici del browser: sempre
  // presenti, nessun permesso da chiedere.
  let fontDdOpen = $state<'ui' | 'code' | null>(null)

  /** Una tendina aperta alla volta. */
  function apriFont(quale: 'ui' | 'code'): void {
    fontDdOpen = fontDdOpen === quale ? null : quale
  }
  function chiudiFont(): void { fontDdOpen = null }
  /** Cosa legge la riga quando è chiusa. «Default» non è lo stesso nome per le due
   *  righe — Inter per il testo, JetBrains Mono per il codice — perché sono due
   *  `STACK` diversi in `fontfamily.svelte.ts`. */
  const fontEtichetta = (f: FontFamily, quale: 'ui' | 'code' = 'ui'): string =>
    f === 'default' ? (quale === 'code' ? 'JetBrains Mono' : 'Inter')
      : f === 'system' ? "This computer's font" : f

  // ─── quello che si chiede al daemon solo quando serve ──────────────────────

  let storage = $state<Storage | null>(null)
  let system = $state<SystemInfo | null>(null)
  let cloud = $state<CloudStatus | null>(null)
  let cloudEmail = $state('')
  let cloudPassword = $state('')
  let cloudErrore = $state('')
  let cloudLavoro = $state(false)
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
    if (sez === 'cloud' && cloud === null) void store.api.cloudStatus().then(x => { cloud = x })
  })

  async function faiLogin(): Promise<void> {
    cloudLavoro = true
    cloudErrore = ''
    const esito = await store.api.cloudLogin(cloudEmail.trim(), cloudPassword)
    cloudLavoro = false
    if (esito.ok) {
      cloudPassword = ''
      cloud = { url: cloud?.url ?? null, email: esito.email ?? null, server: 'ok' }
    } else {
      cloudErrore = esito.motivo ?? 'login fallito'
    }
  }

  async function faiLogout(): Promise<void> {
    cloudLavoro = true
    await store.api.cloudLogout()
    cloudLavoro = false
    cloud = { url: cloud?.url ?? null, email: null, server: cloud?.server ?? 'ok' }
  }

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

  // ─── il QR del pairing ─────────────────────────────────────────────────────
  //
  // NON è `linkAltrove`: quello è `location.origin`, giusto per un'altra finestra su
  // *questa* macchina e sbagliato per un telefono, che deve raggiungerla da fuori — è
  // perché il QR mostrava `127.0.0.1` anche guardando la pagina da Tailscale. Stessa
  // ricetta di Phone.svelte: un codice a uso singolo che scade, con l'indirizzo di
  // Tailscale letto da `telStato`, generato su richiesta col bottone «Show QR code».
  let qr = $state<string | null>(null)
  let pairCodice = $state<{ codice: string; scade: number } | null>(null)
  let pairErrore = $state<string | null>(null)
  let pairAdesso = $state(Date.now())
  const pairRestano = $derived(
    pairCodice ? Math.max(0, Math.round((pairCodice.scade - pairAdesso) / 1000)) : 0)

  $effect(() => {
    if (!pairCodice) return
    const t = setInterval(() => { pairAdesso = Date.now() }, 1000)
    return () => clearInterval(t)
  })
  // Il codice scaduto sparisce da solo, come in Phone.svelte: lasciarlo a schermo
  // vorrebbe dire mostrare qualcosa che il telefono scoprirebbe non funzionare più.
  $effect(() => { if (pairCodice && pairRestano === 0) pairCodice = null })

  async function mostraCodicePairing(): Promise<void> {
    pairErrore = null
    try { pairCodice = await store.api.phoneCode() }
    catch { pairErrore = 'Could not create a code' }
  }

  $effect(() => {
    // `tailscale.url` porta già la barra finale (`https://host/`): senza togliere quella,
    // `${url}/pair` diventava `https://host//pair`, un doppio slash che il telefono non
    // apriva. Misurato dall'utente il 3 settembre 2026.
    const url = telStato?.tailscale.url?.replace(/\/+$/, '')
    if (!pairCodice || !url) { qr = null; return }
    let vivo = true
    void QRCode.toDataURL(`${url}/pair?c=${pairCodice.codice}`, { margin: 1, width: 240 })
      .then(d => { if (vivo) qr = d })
      .catch(() => { if (vivo) qr = null })
    return () => { vivo = false }
  })

  // ─── riavvio del daemon ────────────────────────────────────────────────────
  //
  // Serve a prendersi un aggiornamento senza tornare al terminale: `git pull` e poi
  // questo bottone. Ricompila anche `ui/dist`, che è un artefatto locale — senza,
  // dopo un pull che tocca `ui/` il browser continuerebbe a ricevere il pacchetto
  // vecchio e il riavvio sembrerebbe non aver fatto niente.
  let riavvio = $state<'no' | 'conferma' | 'in corso'>('no')

  // ─── il controllo esplicito degli aggiornamenti ────────────────────────────
  //
  // Un bottone che non dice niente sembra rotto: qui lo stato gira **fino alla
  // risposta**, e la risposta c'è sempre — disponibile o no. Il giro è un `ls-remote`
  // verso il remoto del repo (zero oggetti scaricati): non è un download.
  let checkStato = $state<'no' | 'gira' | 'fatto'>('no')
  let checkEsito = $state('')
  let ultimoCheck = $state<string | null>(null)
  async function controllaOra(): Promise<void> {
    checkStato = 'gira'
    try {
      const s = await store.api.checkUpdate()
      store.aggiornamento = s
      checkEsito = s.errore
        ? `Could not check: ${s.errore}`
        : s.disponibile
          ? `Version v${s.ultima} is available — install it from the banner above.`
          : `You are on the latest version (v${s.installata}).`
      ultimoCheck = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    } catch (e) {
      checkEsito = `Could not check: ${(e as Error).message}`
    } finally {
      checkStato = 'fatto'
    }
  }
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

      <!-- ─── Agent — v11 (ex Permissions) ──────────────────────────────── -->
      {:else if sez === 'permissions' || sez === 'agent'}
        <div class="banner red"><span class="bi"><Icon name="i-block" /></span><span class="bt"><span class="b1">“Never” is not available yet</span><span class="b2">STARK has no deny rules: a hard boundary here would be a promise it cannot keep. Everything below is a human check on top of the classifier, not a wall.</span></span></div>
        <div class="sec">
          <div class="sec-h"><span class="t">Stop and ask me before</span><span class="line"></span><span class="act"><button class="btn" onclick={() => { for(const c of CATEGORIE) void setPerm(c.id,'allow') }}>Reset to let it</button></span></div>
          {#each CATEGORIE as c (c.id)}
            <div class="prow"><span class="o-body"><span class="o-t">{c.nome}</span><span class="o-sub">{c.desc}</span></span><span class="seg perm"><button class:on={store.settings.permissions[c.id]!=='ask'} onclick={() => void setPerm(c.id,'allow')}>let it</button><button class:on={store.settings.permissions[c.id]==='ask'} onclick={() => void setPerm(c.id,'ask')}>ask me</button></span></div>
          {/each}
          <div class="note info"><Icon name="i-bell" /><p><b>This applies to new chats.</b> A chat already open keeps the rules it started with — its checks are installed when the agent starts, not while it works.</p></div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">New chats start with</span><span class="line"></span></div>
          <div class="dfrow" class:open={agentDdOpen === 'model'} onclick={() => { agentDdOpen = agentDdOpen === 'model' ? null : 'model' }}><span class="o-body"><span class="o-t">Model</span><span class="o-sub">except “New chat here”, which carries the model of the chat you pressed</span></span><span class="dfval">{preferitaEtichetta} <Icon name={agentDdOpen === 'model' ? 'i-back' : 'i-fwd'} /></span></div>
          {#if agentDdOpen === 'model'}
            <!-- Lo stesso `ModelPicker` della Dock, di Helper e di AgentPanel: una
                 ricerca sola invece di tre, e la stessa già misurata («troppo lungo»,
                 220px di lista). Qui in più c'è `onClear`, perché solo questa
                 preferenza — a differenza di una chat viva — può restare senza
                 valore («lascia decidere l'agent»). -->
            <div class="dd moddd">
              <ModelPicker catalogo={catalogo} corrente={store.settings?.preferredModel?.model ?? ''}
                onScegli={(agent, model) => { void salvaPreferita(chiavePreferita(agent, model)); agentDdOpen = null }}
                onClear={() => { void salvaPreferita(null); agentDdOpen = null }}
                clearLabel="Default — the agent's own first choice" />
            </div>
          {/if}
          <div class="dfrow" class:open={agentDdOpen === 'claude-code'} onclick={() => agentDdOpen = agentDdOpen === 'claude-code' ? null : 'claude-code'}><span class="o-body"><span class="o-t">Claude Code mode</span><span class="o-sub">a classifier checks every action, no cards</span></span><span class="dfval">{modoDi('claude-code') || 'auto'} <Icon name={agentDdOpen === 'claude-code' ? 'i-back' : 'i-fwd'} /></span></div>
          {#if agentDdOpen === 'claude-code'}
            <div class="dd">
              {#each ['auto','default','acceptEdits','plan','dontAsk'] as m (m)}
                <div class="dd-item" class:on={modoDi('claude-code') === m} onclick={() => { void salvaModo('claude-code', m); agentDdOpen = null }}>
                  <span class="dd-ico"><Icon name={MODE_ICON[m] ?? 'i-bolt'} /></span><span class="dd-body"><span class="dd-n">{m}</span><span class="dd-d">{MODE_BLURB[m] ?? ''}</span></span>{#if modoDi('claude-code') === m}<Icon name="i-check" />{/if}
                </div>
              {/each}
              <div class="dd-item off"><span class="dd-ico"><Icon name={MODE_ICON['bypassPermissions'] ?? 'i-block'} /></span><span class="dd-body"><span class="dd-n">bypassPermissions</span><span class="dd-d">Refused by the CLI when it runs as root — not a STARK restriction</span></span><span class="tag-off">unavailable</span></div>
            </div>
          {/if}
          <div class="dfrow" class:open={agentDdOpen === 'opencode'} onclick={() => agentDdOpen = agentDdOpen === 'opencode' ? null : 'opencode'}><span class="o-body"><span class="o-t">OpenCode mode</span><span class="o-sub">all tools, no restrictions</span></span><span class="dfval">{modoDi('opencode') || 'build'} <Icon name={agentDdOpen === 'opencode' ? 'i-back' : 'i-fwd'} /></span></div>
          {#if agentDdOpen === 'opencode'}
            <div class="dd">
              {#each ['build','default','acceptEdits','plan','dontAsk'] as m (m)}
                <div class="dd-item" class:on={(modoDi('opencode') || 'build') === m} onclick={() => { void salvaModo('opencode', m); agentDdOpen = null }}>
                  <span class="dd-ico"><Icon name={MODE_ICON[m] ?? 'i-bolt'} /></span><span class="dd-body"><span class="dd-n">{m}</span><span class="dd-d">{MODE_BLURB[m] ?? m}</span></span>{#if (modoDi('opencode') || 'build') === m}<Icon name="i-check" />{/if}
                </div>
              {/each}
              <div class="dd-item off"><span class="dd-ico"><Icon name="i-block" /></span><span class="dd-body"><span class="dd-n">bypassPermissions</span><span class="dd-d">Refused by the CLI when it runs as root — not a STARK restriction</span></span><span class="tag-off">unavailable</span></div>
            </div>
          {/if}
          <div class="hint">The model preference is bound to its agent. Measured: auto and default cost the same tokens.</div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">How the agent works</span><span class="line"></span><span class="collab">on</span></div>
          <div class="prow"><span class="o-body"><span class="o-t">Command descriptions</span><span class="o-sub">write <i>why</i> a command runs, not just what</span></span><span class="seg perm"><button class:on={store.settings.toolDescriptions!==false} onclick={() => void setDesc(true)}>on</button><button class:on={store.settings.toolDescriptions===false} onclick={() => void setDesc(false)}>off</button></span></div>
          <div class="note info"><Icon name="i-doc" /><p><b>This writes a rule into the agent's own memory.</b> STARK adds a marked block to <code>{store.memoria?.path ?? 'CLAUDE.md'}</code> and removes exactly that block when you switch it off.</p></div>
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

        <div class="fgroup">
          <div class="flabel">In the box</div>
          <div>
            <div class="prow">
              <div>
                <div class="pn">↑ recalls what you sent</div>
                <div class="pd">on an empty line, like a shell's history</div>
              </div>
              <span class="seg">
                <button class:on={store.settings.historyArrowUp !== false}
                  onclick={() => void setHistoryArrowUp(true)}>on</button>
                <button class:on={store.settings.historyArrowUp === false}
                  onclick={() => void setHistoryArrowUp(false)}>off</button>
              </span>
            </div>
            <div class="prow">
              <div>
                <div class="pn">Esc stops the running turn</div>
                <div class="pd">and, if nothing else is queued behind it, brings the prompt back
                  so you don't have to retype it</div>
              </div>
              <span class="seg">
                <button class:on={store.settings.interruptEscape !== false}
                  onclick={() => void setInterruptEscape(true)}>on</button>
                <button class:on={store.settings.interruptEscape === false}
                  onclick={() => void setInterruptEscape(false)}>off</button>
              </span>
            </div>
          </div>
          <div class="hint">These two are always the same key — there's nothing to capture,
            only whether they fire.</div>
        </div>

      <!-- ─── Projects — v11 ──────────────────────────────────────────── -->
      {:else if sez === 'projects'}
        <div class="sec">
          <div class="sec-h"><span class="t">Projects</span><span class="line"></span>
            {#if progetti.length >= 7}
              <span class="filter"><Icon name="i-search" /><input placeholder="Filter projects…" bind:value={projectFilter} /></span>
            {/if}
            <span class="collab">profile</span>
          </div>
          {#each progettiFiltrati as [cwd, nome] (cwd)}
            {@const col = store.project(cwd).colour ?? 0}
            <div class="pjrow" class:open={swpopOpen === cwd}>
              <span class="pj-dot" style="--c:var(--p{col+1})" onclick={() => swpopOpen = swpopOpen === cwd ? null : cwd}></span>
              <span class="o-body"><span class="o-t">{nome}</span><span class="o-sub mono">{cwd}</span></span>
              {#if system && system.agent.profiles.length >= 1}
                {@const dflt = system.agent.profiles.find(p=>p.current)?.path}
                <span class="seg perm">
                  {#each system.agent.profiles as p (p.path)}
                    <button class:on={(store.project(cwd).profile ?? dflt)===p.path} onclick={() => void store.setProject(cwd,{profile:p.path})}>{p.name}</button>
                  {/each}
                </span>
              {/if}
            </div>
            {#if swpopOpen === cwd}
              <div class="swpop">
                {#each [0,1,2,3,4,5,6] as c (c)}
                  <span class="sw-c" class:on={col === c} style="--c:var(--p{c+1})" onclick={() => { void store.setProject(cwd, { colour: c }); swpopOpen = null }}></span>
                {/each}
              </div>
            {/if}
          {/each}
          {#if progetti.length===0}<div class="empty"><span class="e-ico"><Icon name="i-folder" /></span><span class="e1">No projects yet</span><span class="e2">Start a chat and it appears here</span></div>{:else if progettiFiltrati.length===0}<div class="hint">No match for “{projectFilter}”</div>{/if}
          <div class="hint">Seven colours, assigned in alphabetical order until you pick one. A colour belongs to the <b>folder</b>.</div>
          <div class="note info"><Icon name="i-bell" /><p><b>Quota is counted per profile.</b> Two projects on different profiles do not eat each other's week.</p></div>
        </div>

      <!-- ─── Notifications — v11 ───────────────────────────────────── -->
      {:else if sez === 'notifications'}
        <div class="sec">
          <div class="sec-h"><span class="t">Events</span><span class="line"></span></div>
          {#each EVENTI as e (e.id)}
            <div class="orow" class:dim={!store.calls.on}>
              <!-- L'icona dell'evento, e non una colonna di etichette: la colonna
                   «EMAIL» era il sedimento di un disegno a colonne che qui non c'è,
                   e una parola mai spiegata non diceva niente. -->
              <span class="e-ico"><Icon name={e.icona} /></span>
              <span class="o-body"><span class="o-t">{e.nome}</span><span class="o-sub">{e.desc}</span></span>
              <button class="sw" class:on={store.calls.on && store.calls.eventi[e.id]} disabled={!store.calls.on} aria-label={e.nome} onclick={() => store.calls.setEvento(e.id, !store.calls.eventi[e.id])}><span class="kn"></span></button>
            </div>
          {/each}
          {#if !store.calls.on}<div class="note warn"><Icon name="i-bell" /><p><b>Everything is muted.</b> The bell at the top of the list turns it back on.</p></div>{/if}
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Push on this device</span><span class="line"></span></div>
          <div class="orow">
            <span class="o-body"><span class="o-t">Push notifications</span><span class="o-sub mono">{#if store.push.stato==='accese'}on — the daemon calls this device{store.push.iscritti>1?`, and ${store.push.iscritti-1} other`:''}{:else if store.push.stato==='negato'}the browser blocked them{:else if store.push.stato==='nonSupportato' || store.push.stato==='nonDisponibile'}not available here{:else}off — nothing reaches you with STARK closed{/if}</span></span>
            <button class="sw" class:on={store.push.stato==='accese'} disabled={store.push.stato==='nonSupportato' || store.push.stato==='nonDisponibile' || store.push.stato==='negato'} aria-label="Push" onclick={() => void (store.push.stato==='accese'?store.push.spegni():store.push.accendi())}><span class="kn"></span></button>
          </div>
          {#if store.push.stato==='accese'}
            <div class="orow"><span class="o-body"><span class="o-t">Send a test</span><span class="o-sub">proves it really arrives</span></span><button class="btn" onclick={() => void store.push.prova()}>Send</button></div>
          {/if}
          {#if store.push.motivo}<div class="note"><Icon name="i-bell" /><p>{store.push.motivo}</p></div>{/if}
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Stay quiet for</span><span class="line"></span></div>
          <div class="orow"><span class="o-body"><span class="o-t">The chat I'm looking at</span><span class="o-sub">you can already see it happen</span></span><button class="sw" class:on={store.calls.zittoQui} aria-label="Quiet for open chat" onclick={() => store.calls.setZittoQui(!store.calls.zittoQui)}><span class="kn"></span></button></div>
          {#each progetti as [cwd, nome] (cwd)}
            <div class="orow"><span class="o-body"><span class="o-t">{nome}</span><span class="o-sub mono">{cwd}</span></span><button class="sw" class:on={store.project(cwd).muted===true} aria-label={`Mute ${nome}`} onclick={() => void store.setProject(cwd,{muted:!store.project(cwd).muted})}><span class="kn"></span></button></div>
          {/each}
        </div>
        <div class="note neutral"><Icon name="i-bell" /><p><b>The dot in the list is not a notification.</b> It only works if you are already looking at STARK.</p></div>

      {:else if sez === 'phone'}
        <div class="sec">
          <div class="sec-h"><span class="t">Connectivity</span><span class="line"></span></div>
          {#if telStato?.tailscale.host}
            <div class="banner green"><span class="bi"><Icon name="i-wifi" /></span><span class="bt"><span class="b1">Connected via Tailscale</span><span class="b2">{telStato.tailscale.host} · nothing is published to the internet</span></span><button class="btn" onclick={() => { store.dialog = { kind: 'phone' } }}>Open</button></div>
          {:else}
            <div class="banner neutral"><span class="bi"><Icon name="i-wifi" /></span><span class="bt"><span class="b1">Not connected</span><span class="b2">A phone reaches STARK through your Tailscale network</span></span><button class="btn" onclick={() => { store.dialog = { kind: 'phone' } }}>Connect</button></div>
          {/if}
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Address</span><span class="line"></span></div>
          <div class="pathbox"><span class="fi"><Icon name="i-globe" /></span><span class="p">{system?.url ?? '—'}</span><span class="r">{system?.listening ?? ''}</span><button class="btn" onclick={() => void copia('url', system?.url ?? '')}>{copiato==='url'?'Copied':'Copy'}</button></div>
          {#if system?.perimeter?.open}
            <div class="note info"><Icon name="i-warn" /><p>Reachable as {#each system.perimeter.hosts as h}{h.host} ({h.source}) {/each} · STARK_PUBLIC_HOST or Tailscale, read once at daemon start.</p></div>
          {/if}
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Token</span><span class="line"></span></div>
          <div class="pathbox"><span class="fi"><Icon name="i-shield" /></span><span class="p secret">••••••••••••••••</span><button class="btn" onclick={() => void copia('token', store.api.tokenValue)}>{copiato==='token'?'Copied':'Copy'}</button><button class="btn" onclick={() => { store.dialog = { kind: 'phone' } }}>Manage</button></div>
          <div class="hint">Treat that link like a root password: whoever has it can make an agent run commands on this machine. <button class="lnk" onclick={() => void copia('link', linkAltrove)}>Copy link</button> <span style="color:var(--muted)">{linkMostrato}</span></div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Paired devices</span><span class="line"></span></div>
          {#if telStato === null}
            <div class="hint">Checking…</div>
          {:else if telStato.devices.length===0}
            <div class="empty"><span class="e-ico"><Icon name="i-phone" /></span><span class="e1">No phones yet</span><span class="e2">Pair a phone to get push notifications</span></div>
          {:else}
            {#each telStato.devices as d (d.id)}
              <div class="dev"><span class="d-ico"><Icon name="i-phone" /></span><span class="d-body"><span class="d-name">{d.nome}</span><span class="d-meta">{d.id}</span></span><span class="d-seen">{(d as any).seen ?? (d as any).visto ?? ''}</span><button class="icon-btn ghost" onclick={() => { store.dialog = { kind: 'phone' } }}><Icon name="i-x" /></button></div>
            {/each}
          {/if}
          {#if !telStato?.tailscale.pronto}
            <div class="pair">
              <span class="pair-qr"><Icon name="i-phone" /></span>
              <span class="pair-body">
                <span class="pt">Pair a new phone</span>
                <span class="ps">Connect this machine to Tailscale first — see Connectivity above.</span>
              </span>
            </div>
          {:else if !pairCodice}
            <div class="pair">
              <span class="pair-qr"><Icon name="i-phone" /></span>
              <span class="pair-body">
                <span class="pt">Pair a new phone</span>
                <span class="ps">Good for 5 minutes and a single phone.</span>
                <span class="linkbox"><button class="btn" onclick={() => void mostraCodicePairing()}>Show QR code</button>{#if pairErrore}<span style="color:var(--stop)">{pairErrore}</span>{/if}</span>
              </span>
            </div>
          {:else if !qr}
            <div class="pair">
              <span class="pair-qr"><span class="spin"></span></span>
              <span class="pair-body">
                <span class="pt">Pair a new phone</span>
                <span class="ps">Scan the QR from your phone, or type the code by hand.</span>
              </span>
            </div>
          {:else}
            <div class="pair">
              <!-- Il QR vero, non un segnaposto: `qrcode` è già dipendenza e
                   Phone.svelte lo usa per lo stesso gesto. Porta l'indirizzo di
                   Tailscale e un codice a uso singolo — mai il token, e mai
                   `location.origin`, che da questa stessa pagina letta in locale
                   direbbe `127.0.0.1`, inutile per un telefono. -->
              <span class="pair-qr"><img src={qr} alt="QR code — scan to pair a phone" width="120" height="120" /></span>
              <span class="pair-body">
                <span class="pt">Pair a new phone</span>
                <span class="ps">Scan the QR from your phone, or type the code below by hand.</span>
                <span class="linkbox"><span class="lk">{pairCodice.codice}</span><span style="color:var(--muted); font-size:11px">Expires in {Math.floor(pairRestano / 60)}:{String(pairRestano % 60).padStart(2, '0')} · one use</span></span>
              </span>
            </div>
          {/if}
        </div>

      <!-- ─── Appearance — v11 ────────────────────────────────────────── -->
      {:else if sez === 'appearance'}
        <div class="sec">
          <div class="sec-h"><span class="t">Theme</span><span class="line"></span><span class="pill">this browser</span></div>
          <div class="segbig">
            {#each TEMI as t (t.id)}
              <button class:on={store.theme.scelto===t.id} onclick={() => store.theme.set(t.id)}><Icon name={t.id==='light'?'i-palette':t.id==='dark'?'i-moon':'i-monitor'} />{t.nome}</button>
            {/each}
          </div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Size</span><span class="line"></span><span class="pill">this browser</span></div>
          <div class="prow num"><span class="o-body"><span class="o-t">Interface zoom</span><span class="o-sub">sidebar, panels, settings — everything but the conversation</span></span><span class="numstack">{#if store.textSize.scelto !== 100}<button class="linkbtn small" title="Back to 100%" onclick={() => store.textSize.set(100)}><Icon name="i-reset" />Reset</button>{/if}<span class="numf"><button onclick={() => store.textSize.set(Math.max(TAGLIA_MIN, store.textSize.scelto-TAGLIA_STEP))}>−</button><span class="val">{store.textSize.scelto}%</span><button onclick={() => store.textSize.set(Math.min(TAGLIA_MAX, store.textSize.scelto+TAGLIA_STEP))}>+</button></span></span></div>
          <!-- Solo `.tb` — risposta e blocchi — non l'intestazione col prompt: vedi il
               commento in lettura.svelte.ts sul perché non può zoomare anche lei. -->
          <div class="prow num"><span class="o-body"><span class="o-t">Chat text</span><span class="o-sub">answers and the blocks inside them</span></span><span class="numstack">{#if store.lettura.zoomChat !== 100}<button class="linkbtn small" title="Back to 100%" onclick={() => store.lettura.setZoomChat(100)}><Icon name="i-reset" />Reset</button>{/if}<span class="numf"><button onclick={() => store.lettura.setZoomChat(Math.max(ZOOM_CHAT_MIN, store.lettura.zoomChat - ZOOM_CHAT_STEP))}>−</button><span class="val">{store.lettura.zoomChat}%</span><button onclick={() => store.lettura.setZoomChat(Math.min(ZOOM_CHAT_MAX, store.lettura.zoomChat + ZOOM_CHAT_STEP))}>+</button></span></span></div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Font</span><span class="line"></span><span class="pill">this browser</span></div>
          <!-- `queryLocalFonts` non arriva mai al permesso in questo ambiente: al posto
               della lista "i tuoi font" che non si popolava mai, una tendina fissa con
               un paio di font classici del browser — nessun permesso da chiedere. -->
          <div class="dfrow" class:open={fontDdOpen === 'ui'} onclick={() => apriFont('ui')}><span class="o-body"><span class="o-t">Interface font</span><span class="o-sub">the font you are reading right now</span></span><span class="dfval">{fontEtichetta(store.font.scelto)} <Icon name="i-fwd" /></span></div>
          {#if fontDdOpen === 'ui'}
            <div class="dd fontdd">
              {#each FONT_UI as f (f.id)}
                <div class="dd-item" class:on={store.font.scelto === f.id} style={f.id === 'default' || f.id === 'system' ? '' : `font-family:'${f.id}'`} onclick={() => { store.font.set(f.id); chiudiFont() }}>
                  <span class="dd-body"><span class="dd-n">{f.nome}</span></span>{#if store.font.scelto === f.id}<Icon name="i-check" />{/if}
                </div>
              {/each}
            </div>
          {/if}
          <div class="dfrow" class:open={fontDdOpen === 'code'} onclick={() => apriFont('code')}><span class="o-body"><span class="o-t">Code font</span><span class="o-sub mono">grep -rn "model" src/</span></span><span class="dfval">{fontEtichetta(store.font.codeScelto, 'code')} <Icon name="i-fwd" /></span></div>
          {#if fontDdOpen === 'code'}
            <div class="dd fontdd">
              {#each FONT_CODE as f (f.id)}
                <div class="dd-item" class:on={store.font.codeScelto === f.id} style={f.id === 'default' || f.id === 'system' ? '' : `font-family:'${f.id}'`} onclick={() => { store.font.setCode(f.id); chiudiFont() }}>
                  <span class="dd-body"><span class="dd-n">{f.nome}</span></span>{#if store.font.codeScelto === f.id}<Icon name="i-check" />{/if}
                </div>
              {/each}
            </div>
          {/if}
          <div class="hint">Commands and code always stay monospaced.</div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Reading</span><span class="line"></span><span class="pill">this browser</span></div>
          <div class="prow"><span class="o-body"><span class="o-t">Conversation width</span><span class="o-sub">how wide a line gets before it wraps</span></span><span class="seg perm"><button class:on={store.lettura.larghezza==='stretta'} onclick={() => store.lettura.setLarghezza('stretta')}>720px</button><button class:on={store.lettura.larghezza==='larga'} onclick={() => store.lettura.setLarghezza('larga')}>900px</button><button class:on={store.lettura.larghezza==='tutta'} onclick={() => store.lettura.setLarghezza('tutta')}>full</button></span></div>
          <div class="orow"><span class="o-body"><span class="o-t">Reduce animations</span><span class="o-sub">panels appear instead of sliding</span></span><button class="sw" class:on={store.lettura.riduciAnimazioni} aria-label="Reduce animations" onclick={() => store.lettura.setRiduciAnimazioni(!store.lettura.riduciAnimazioni)}><span class="kn"></span></button></div>
        </div>

      <!-- ─── Usage — v11 ─────────────────────────────────────────────── -->
      {:else if sez === 'usage'}
        <div class="sec">
          <div class="sec-h"><span class="t">Period</span><span class="line"></span></div>
          <div class="tabs">
            {#each PERIODI as p (p.id)}
              <button class:on={periodo === p.id} onclick={() => { periodo = p.id }}>{p.nome}</button>
            {/each}
          </div>
        </div>
        {#if erroreUso}
          <div class="sec"><div class="note err"><Icon name="i-warn" /><p>{erroreUso}</p></div></div>
        {:else if !uso}
          <div class="sec"><div class="hint">Reading the journals…</div></div>
        {:else}
          <div class="sec">
            <div class="cards">
              <div class="card"><span class="c-n">{migliaia(uso.totale.prompts)}</span><span class="c-l">prompts</span></div>
              <div class="card"><span class="c-n">{migliaia(uso.totale.chars)}</span><span class="c-l">characters typed</span></div>
              <div class="card"><span class="c-n">{migliaia(uso.totale.conversations)}</span><span class="c-l">conversations</span></div>
              <div class="card spend"><span class="c-n">{durata(uso.totale.agentMs)}</span><span class="c-l">agent working</span></div>
            </div>
            <div class="note neutral"><Icon name="i-bell" /><p>“Agent working” is the time the agent spent on your turns — not the time you spent in STARK.</p></div>
          </div>
          <div class="sec">
            <div class="sec-h"><span class="t">Tokens and cost</span><span class="line"></span><span class="act"><span class="pill">{migliaia(uso.totale.chars)} chars typed</span></span></div>
            <div class="trow"><span class="t-k">Input</span><span class="t-tok">{migliaia(uso.totale.tokens.input)}</span><span class="t-bar"><span style="width:{(uso.totale.tokens.input/Math.max(1,uso.totale.tokens.input+uso.totale.tokens.output))*100}%"></span></span><span class="t-cost">—</span></div>
            <div class="trow"><span class="t-k">Output</span><span class="t-tok">{migliaia(uso.totale.tokens.output)}</span><span class="t-bar"><span style="width:{(uso.totale.tokens.output/Math.max(1,uso.totale.tokens.input+uso.totale.tokens.output))*100}%"></span></span><span class="t-cost">—</span></div>
            <div class="trow"><span class="t-k">Cache read</span><span class="t-tok">{migliaia(uso.totale.tokens.cacheRead)}</span><span class="t-bar"><span style="width:30%"></span></span><span class="t-cost">—</span></div>
            <div class="trow"><span class="t-k">Cache write</span><span class="t-tok">{migliaia(uso.totale.tokens.cacheWrite)}</span><span class="t-bar"><span style="width:20%"></span></span><span class="t-cost">—</span></div>
            <div class="note neutral"><Icon name="i-bell" /><p>No cost in dollars: on a fixed-quota plan that number is a list price, not money you spent.</p></div>
          </div>
          {#if uso.perGiorno.length > 1}
            {@const giorni = giorniPieni(uso.perGiorno)}
            {@const max = Math.max(...giorni.map(x => x.prompts), 1)}
            <div class="sec">
              <div class="sec-h"><span class="t">By day</span><span class="line"></span><span class="act"><span class="seg"><button class="on">prompts</button><button>spend</button></span></span></div>
              <div class="chart">
                {#each giorni as g (g.day)}
                  <div class="cbar" title="{g.day} · {g.prompts} prompts · {durata(g.ms)}">
                    {#if g.prompts > 0}<div class="cb" style="height:{Math.max(4,(g.prompts/max)*100)}%"></div>{:else}<div class="cb" style="height:2px;opacity:.15"></div>{/if}
                    <div class="cl">{g.day.slice(5)}</div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <div class="sec">
            <div class="sec-h"><span class="t">By project</span><span class="line"></span></div>
            {#each uso.perProgetto as r (r.key)}
              <div class="brow">
                <span class="b-body"><span class="b-name">{r.key==='unknown'?'no folder':project(r.key)}</span><span class="b-meta">{migliaia(r.c.prompts)} prompts · {durata(r.c.agentMs)}</span></span>
                <span class="b-time">{migliaia(r.c.chars)} ch</span><span class="b-cost">{durata(r.c.agentMs)}</span>
              </div>
            {/each}
          </div>
          <div class="sec">
            <div class="sec-h"><span class="t">By agent and model</span><span class="line"></span></div>
            {#each [...uso.perAgent, ...uso.perModello] as r (r.key)}
              <div class="brow"><span class="b-body"><span class="b-name">{r.key}</span><span class="b-meta">{migliaia(r.c.prompts)} prompts</span></span><span class="b-time">{durata(r.c.agentMs)}</span></div>
            {/each}
            <div class="note neutral"><Icon name="i-bell" /><p>A chat counts under the model it is on <b>now</b>.</p></div>
          </div>
        {/if}

      {:else if sez === 'storage'}
        <div class="sec">
          <div class="sec-h"><span class="t">Journals</span><span class="line"></span><span class="act"><button class="btn" onclick={() => { if(storage?.home) void store.reveal(storage.home) }}>Reveal</button><button class="btn" onclick={() => void copia('storage', storage?.home ?? '')}>{copiato==='storage'?'Copied':'Copy path'}</button></span></div>
          <div class="pathbox"><span class="fi"><Icon name="i-folder" /></span><span class="p">{storage?.home ?? 'reading…'}</span><span class="r">{#if storage}{storage.sessions.length} chats · {mb(storage.bytes)}{:else}{erroreStorage || 'Reading…'}{/if}</span></div>
          <div class="note info"><Icon name="i-warn" /><p>A journal holds the entire conversation, attachments included. It lives here and not in the project folder by construction, not because of a line in <code>.gitignore</code> that somebody can delete by mistake.</p></div>
        </div>
        <div class="sec">
          <div class="sec-h"><span class="t">Per chat</span><span class="line"></span><span class="act"><button class="btn"><Icon name="i-sliders" />Size</button></span></div>
          {#if !storage}
            <div class="hint">{erroreStorage || 'Reading…'}</div>
          {:else if storage.sessions.length===0}
            <div class="empty"><span class="e-ico"><Icon name="i-folder" /></span><span class="e1">No journals yet</span><span class="e2">Start a chat and it appears here</span></div>
          {:else}
            {@const maxBytes = Math.max(...storage.sessions.map(s=>s.bytes),1)}
            {#each storage.sessions as s (s.id)}
              {#if storageConfirm === s.id}
                <div class="jrow confirm">
                  <span class="j-body"><span class="j-title">{s.title}</span><span class="j-proj">{s.cwd ? project(s.cwd) : 'no folder'}</span></span>
                  <span class="j-confirm">Delete this journal and free {mb(s.bytes)}?</span>
                  <button class="btn" onclick={() => storageConfirm = null}>Cancel</button>
                  <button class="btn solid-danger" onclick={async () => { const ok = await store.api.remove(s.id); if(ok.ok){ storage = await store.api.storage(); storageConfirm = null } else { storageConfirm = null; store.refused = ok.error ?? 'delete failed' } }}>Delete</button>
                </div>
              {:else}
                <div class="jrow">
                  <span class="j-body"><span class="j-title">{s.title}</span><span class="j-proj">{s.cwd ? project(s.cwd) : 'no folder'}</span></span>
                  <span class="j-bar"><span style="width:{(s.bytes/maxBytes)*100}%"></span></span>
                  <span class="j-size">{mb(s.bytes)}</span>
                  <button class="icon-btn" title="Delete journal" onclick={() => storageConfirm = s.id}><Icon name="i-trash" /></button>
                </div>
              {/if}
            {/each}
          {/if}
          <div class="hint">Deleting a journal removes <b>STARK's</b> view of the chat, and its attachments with it. The agent keeps its own transcript where it always did.</div>
        </div>

      <!-- ─── System — v11 ─────────────────────────────────────────────── -->
      {:else if !system}
        <div class="sec">
          <div class="hint">{errore || 'Reading — STARK is asking the executable which version it is.'}</div>
        </div>
      {:else}
        {@const sys = system}
        <!-- STARK -->
        <div class="sec">
          <div class="sec-h">
            <span class="t">STARK</span><span class="line"></span>
            <span class="act">
              {#if riavvio === 'no'}
                <button class="btn" disabled={checkStato === 'gira'}
                  onclick={() => void controllaOra()}>
                  {#if checkStato === 'gira'}<span class="spin"></span>Checking…{:else}<Icon name="i-reset" />Check for updates{/if}
                </button>
                <button class="btn danger" onclick={() => { riavvio = 'conferma' }}><Icon name="i-loader" />Restart daemon</button>
              {:else if riavvio === 'conferma'}
                <button class="btn" onclick={() => { riavvio = 'no' }}>Cancel</button>
                <button class="btn primary" onclick={() => void riavvia()}>Restart now</button>
              {:else}
                <button class="btn" disabled><span class="spin"></span>Restarting…</button>
              {/if}
            </span>
          </div>
          {#if riavvio === 'in corso'}
            <div class="banner amber">
              <span class="bi"><Icon name="i-loader" /></span>
              <span class="bt"><span class="b1">Daemon restarting</span><span class="b2">this tab reconnects on its own · running agents keep their state</span></span>
            </div>
          {:else if store.aggiornamento?.disponibile}
            <div class="banner info">
              <span class="bi"><Icon name="i-import" /></span>
              <span class="bt"><span class="b1">v{store.aggiornamento.ultima} available</span><span class="b2">released · installs and restarts the daemon</span></span>
              <button class="btn primary" onclick={() => void store.aggiorna()}>Install v{store.aggiornamento.ultima}</button>
            </div>
          {/if}
          {#if checkStato !== 'no'}
            <!-- Il feedback del bottone, **dopo** la risposta: «hai l'ultima» è un
                 fatto, non un silenzio. Un bottone che non dice nulla sembra rotto,
                 ed è esattamente il difetto che è stato segnalato. -->
            <div class="note ok" style="margin-top:10px">
              <Icon name="i-check" />
              <p>{checkEsito}</p>
            </div>
          {/if}
          <!-- Le righe di stato sono testo, non card: il fondo che avevano veniva
               dalla classe `.row` globale della conversazione (riga di un tool), che
               qui non c'entra niente. `.sysrow` è un nome suo. -->
          <div class="sysrow"><span class="k">Version</span><span class="v">v{store.aggiornamento?.installata || sys.agent.cli || 'unknown'}</span><span class="m" class:ok={!store.aggiornamento?.disponibile} class:warn={store.aggiornamento?.disponibile}>· {store.aggiornamento?.disponibile ? `v${store.aggiornamento.ultima} available` : 'up to date'}</span></div>
          <div class="sysrow"><span class="k">Daemon</span><span class="v"><span class="dot" style="background:var({riavvio === 'in corso' ? '--wait' : '--done'})"></span> {riavvio === 'in corso' ? 'stopping' : 'running'}</span><span class="m">{vive} chats · {sys.listening}</span></div>
          <div class="sysrow"><span class="k">Runtime</span><span class="v">{sys.agent.node ?? 'unknown'}</span></div>
          <div class="sysrow"><span class="k">Last checked</span><span class="v">{ultimoCheck ?? (store.aggiornamento ? 'at daemon start' : '—')}</span></div>
          {#if riavvio === 'conferma'}
            <div class="note warn"><Icon name="i-warn" /><p>{#if vive>0}<b>This stops {vive} running {vive===1?'chat':'chats'}.</b> Every agent runs as a child of the daemon, so a turn in progress dies mid-way. The conversations stay — you wake them again afterwards.{:else}<b>No chat is running right now</b>, so nothing is interrupted.{/if} This page reconnects on its own once STARK is back.</p></div>
          {/if}
        </div>
        <!-- Agents -->
        <div class="sec" style={riavvio === 'in corso' ? 'opacity:.45' : ''}>
          <div class="sec-h"><span class="t">Agents</span><span class="line"></span></div>
          <div class="agent">
            <div class="a-top">
              <span class="a-name">Claude Code</span><span class="a-ver">{sys.agent.cli ?? 'unknown'}</span>
              {#if sys.agent.bundled}<span class="pill">bundled</span>{:else}<span class="pill">system</span>{/if}
              <span class="a-right"><span class="dot" style="background:var(--done)"></span>available</span>
            </div>
            <div class="a-sub"><span>SDK {sys.agent.sdk ?? 'unknown'}</span><span class="sep">·</span><span>{sys.agent.profiles.reduce((n,p)=>n+p.conversations,0)} conversations</span></div>
            <div class="a-path"><span class="p" title={sys.agent.executable ?? ''}>{sys.agent.executable ?? 'not found'}</span><button class="copy" onclick={() => void copia('agent', sys.agent.executable ?? '')}><Icon name="i-copy" /></button></div>
          </div>
          {#if sys.diagnosticaAgenti?.['opencode'] && sys.diagnosticaAgenti['opencode'].available !== false}
            {@const diaOc = sys.diagnosticaAgenti['opencode']!}
            <div class="agent">
              <div class="a-top"><span class="a-name">OpenCode</span><span class="a-ver">{diaOc.cli ?? 'unknown'}</span><span class="pill">system</span><span class="a-right"><span class="dot" style="background:var(--done)"></span>available</span></div>
              <div class="a-sub"><span>SDK {diaOc.sdk ?? 'unknown'}</span><span class="sep">·</span><span>{store.catalogo?.find(c=>c.id==='opencode')?.models.length ?? '…'} models</span></div>
              <div class="a-path"><span class="p" title={diaOc.executable ?? ''}>{diaOc.executable ?? 'not found'}</span><button class="copy" onclick={() => void copia('agent-opencode', diaOc.executable ?? '')}><Icon name="i-copy" /></button></div>
            </div>
          {:else if sys.diagnosticaAgenti?.['opencode']}
            <div class="agent">
              <div class="a-top"><span class="a-name">OpenCode</span><span class="pill">system</span><span class="a-right"><span class="dot" style="background:var(--stop)"></span>not answering</span></div>
            </div>
          {/if}
        </div>
        <!-- Claude profiles -->
        <div class="sec">
          <div class="sec-h"><span class="t">Claude profiles</span><span class="line"></span><span class="act"><span class="pill">CLAUDE_CONFIG_DIR</span></span></div>
          {#each sys.agent.profiles as p (p.path)}
            <div class="prof" class:on={p.current}>
              <span class="p-name">{p.name}</span>
              {#if p.current}<span class="pill accent">in use</span>{/if}
              <span class="p-path">{p.path}</span>
              <span class="p-meta">{p.conversations} conversations · {p.mcpServers===0?'no MCP':`${p.mcpServers} MCP`}</span>
            </div>
          {/each}
          <div class="note warn"><Icon name="i-warn" /><p>Every agent STARK launches inherits this profile. Point it at the wrong one and the agent starts with no conversations to resume, and possibly no login.</p></div>
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

  /* ── v11 design — mappato su variabili esistenti, no hex ── */
  .snav { width:206px; flex:none; background:var(--surface); border-right:1px solid var(--line); padding:14px 10px; }
  .sn { display:flex; align-items:center; gap:11px; height:34px; padding:0 10px; border-radius:8px; font-size:13px; color:var(--muted); width:100%; text-align:left; }
  .sn :global(svg.ic) { width:16px; height:16px; color:var(--muted); flex:none; }
  .sn:hover { background:var(--surface-2); color:var(--ink); }
  .sn.on { background:var(--surface-2); color:var(--ink); }
  .sn.on :global(svg.ic) { color:var(--accent); }
  .sn .chev { margin-left:auto; color:var(--muted); font-size:13px; }
  .dlgcol { flex:1; min-width:0; padding:18px 26px 26px; }
  .dlgh { display:flex; align-items:center; margin-bottom:6px; }
  .dlgh .dt { font-size:15px; font-weight:600; color:var(--ink); }
  .dlgh .x { margin-left:auto; width:28px; height:28px; border-radius:8px; border:none; background:transparent; color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; }
  .dlgh .x:hover { background:var(--surface-2); color:var(--ink); }
  .sec { margin-top:26px; }
  .sec:first-of-type { margin-top:20px; }
  .sec-h { display:flex; align-items:center; gap:10px; margin-bottom:11px; }
  .sec-h .t { font-size:10px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
  .sec-h .line { flex:1; height:1px; background:var(--line); }
  .sec-h .act { display:flex; gap:8px; }
  .btn { height:28px; padding:0 12px; border-radius:8px; border:1px solid var(--line-2); background:var(--surface-2); color:var(--muted); font-family:inherit; font-size:12px; font-weight:500; display:inline-flex; align-items:center; gap:7px; cursor:pointer; transition:.15s; }
  .btn:hover { background:var(--surface-3); color:var(--ink); border-color:var(--muted); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  .btn.primary:hover { filter:brightness(1.08); }
  .btn.danger:hover { border-color:var(--stop); color:var(--stop); background:var(--stop-bg); }
  .btn[disabled] { opacity:.45; cursor:default; }
  .btn .spin { width:11px; height:11px; border-radius:50%; border:1.5px solid var(--line-2); border-top-color:var(--accent); animation:spin .8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .row { display:flex; align-items:center; gap:14px; padding:6px 0; }
  .row .k { width:132px; flex:none; font-size:12.5px; color:var(--muted); }
  .row .v { font-family:var(--mono); font-size:12.5px; color:var(--ink); display:flex; align-items:center; gap:6px; }
  .row .m { font-family:var(--mono); font-size:11.5px; color:var(--muted); }
  .dot { width:6px; height:6px; border-radius:50%; flex:none; display:inline-block; }
  .pill { font-family:var(--mono); font-size:10px; padding:2px 6px; border-radius:5px; background:var(--surface-2); color:var(--muted); border:1px solid var(--line); }
  .pill.accent { color:var(--accent); border-color:color-mix(in srgb, var(--accent) 35%, transparent); background:var(--accent-soft); }
  .pill.ok { color:var(--done); border-color:color-mix(in srgb, var(--done) 30%, transparent); background:var(--done-bg); }
  .banner { display:flex; align-items:flex-start; gap:12px; padding:13px 15px; border-radius:12px; background:var(--surface-2); border:1px solid var(--line); margin-bottom:12px; }
  .banner .bi { color:var(--muted); display:flex; flex:none; margin-top:1px; }
  .banner .bt { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
  .banner .b1 { font-size:13px; color:var(--ink); font-weight:600; line-height:1.35; }
  .banner .b2 { font-size:12px; line-height:1.6; color:var(--muted); }
  .banner .btn, .banner .pill { align-self:center; flex:none; }
  .banner.info { background:var(--accent-soft); border-color:color-mix(in srgb, var(--accent) 28%, transparent); }
  .banner.info .bi { color:var(--accent); }
  .banner.amber { background:var(--wait-bg); border-color:color-mix(in srgb, var(--wait) 30%, transparent); }
  .banner.amber .bi { color:var(--wait); }
  .banner.amber .b1 { color:var(--wait); }
  .banner.green { background:var(--done-bg); border-color:color-mix(in srgb, var(--done) 28%, transparent); }
  .banner.green .bi { color:var(--done); }
  .banner.green .b1 { color:var(--done); }
  .banner.red { background:var(--stop-bg); border-color:color-mix(in srgb, var(--stop) 30%, transparent); }
  .banner.red .bi { color:var(--stop); }
  .banner.red .b1 { color:var(--stop); }
  .agent { padding:11px 0; border-top:1px solid var(--line); }
  .agent:first-of-type { border-top:none; padding-top:2px; }
  .a-top { display:flex; align-items:center; gap:9px; }
  .a-name { font-size:13px; font-weight:500; color:var(--ink); }
  .a-ver { font-family:var(--mono); font-size:12px; color:var(--ink); }
  .a-right { margin-left:auto; display:flex; align-items:center; gap:9px; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .a-sub { display:flex; gap:9px; margin-top:5px; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .a-sub .sep { opacity:.45; }
  .a-path { display:flex; align-items:center; gap:8px; margin-top:5px; }
  .a-path .p { flex:1; min-width:0; font-family:var(--mono); font-size:10.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; direction:rtl; text-align:left; }
  .a-path .copy { width:22px; height:22px; flex:none; border:none; background:transparent; color:var(--muted); border-radius:5px; display:flex; align-items:center; justify-content:center; cursor:pointer; }
  .a-path .copy:hover { background:var(--surface-2); color:var(--ink); }
  .prof { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:8px; cursor:pointer; }
  .prof:hover { background:var(--surface-2); }
  .prof.on { background:var(--surface-2); }
  .p-name { font-family:var(--mono); font-size:12.5px; color:var(--ink); }
  .p-path { font-family:var(--mono); font-size:10.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .p-meta { margin-left:auto; flex:none; font-family:var(--mono); font-size:10.5px; color:var(--muted); }
  .note { display:flex; align-items:flex-start; gap:12px; margin-top:12px; padding:13px 15px; border-radius:12px; background:var(--surface-2); border:1px solid var(--line); }
  .note :global(svg.ic) { color:var(--muted); flex:none; margin-top:2px; width:14px; height:14px; }
  .note p { margin:0; font-size:12px; line-height:1.6; color:var(--muted); }
  .note.info { background:var(--accent-soft); border-color:color-mix(in srgb, var(--accent) 28%, transparent); }
  .note.info :global(svg.ic) { color:var(--accent); }
  .note.warn { background:var(--wait-bg); border-color:color-mix(in srgb, var(--wait) 30%, transparent); }
  .note.warn :global(svg.ic) { color:var(--wait); }
  .note.err { background:var(--stop-bg); border-color:color-mix(in srgb, var(--stop) 30%, transparent); }
  .note.err :global(svg.ic) { color:var(--stop); }
  .note.ok { background:var(--done-bg); border-color:color-mix(in srgb, var(--done) 28%, transparent); }
  .note.ok :global(svg.ic) { color:var(--done); }
  .note.neutral { background:var(--surface-2); border-color:var(--line); }
  .pathbox { display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; }
  .pathbox .fi { color:var(--muted); display:flex; flex:none; }
  .pathbox .p { flex:1; min-width:0; font-family:var(--mono); font-size:12.5px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pathbox .r { flex:none; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .jrow { display:flex; align-items:center; gap:14px; padding:9px 8px; border-bottom:1px solid var(--line); border-radius:8px; }
  .jrow:last-of-type { border-bottom:none; }
  .jrow:hover { background:var(--surface-2); }
  .j-body { flex:1; min-width:0; display:flex; align-items:baseline; gap:9px; }
  .j-title { font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .j-proj { flex:none; font-family:var(--mono); font-size:10.5px; color:var(--muted); }
  .j-bar { flex:none; width:86px; height:3px; border-radius:3px; background:var(--line); overflow:hidden; }
  .j-bar span { display:block; height:100%; border-radius:3px; background:var(--accent); opacity:.7; }
  .j-size { flex:none; width:64px; text-align:right; font-family:var(--mono); font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .icon-btn { flex:none; width:26px; height:26px; border-radius:6px; border:none; background:transparent; color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:.15s; }
  .icon-btn:hover { background:var(--stop-bg); color:var(--stop); }
  .jrow.confirm { background:var(--stop-bg); border:1px solid color-mix(in srgb, var(--stop) 28%, transparent); }
  .hint { margin-top:12px; font-size:11.5px; line-height:1.55; color:var(--muted); }
  .empty { display:flex; flex-direction:column; align-items:center; gap:7px; padding:38px 0 30px; }
  .empty .e-ico { color:var(--muted); opacity:.5; margin-bottom:9px; }
  .empty .e1 { font-size:13px; color:var(--muted); }
  .empty .e2 { font-size:11.5px; color:var(--muted); }
  .cards { display:flex; gap:10px; flex-wrap:wrap; }
  .card { flex:1; min-width:112px; background:var(--surface-2); border:1px solid var(--line); border-radius:12px; padding:12px 13px; display:flex; flex-direction:column; gap:5px; }
  .card .c-n { font-family:var(--mono); font-size:18px; color:var(--ink); font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
  .card .c-l { font-size:11px; color:var(--muted); }
  .card.spend { background:var(--accent-soft); border-color:color-mix(in srgb, var(--accent) 32%, transparent); }
  .card.spend .c-n { color:var(--accent); }
  .badline { display:flex; align-items:center; gap:16px; margin-top:12px; font-size:11.5px; color:var(--muted); }
  .badline .bl-tot { margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .trow { display:flex; align-items:center; gap:14px; padding:7px 0; border-bottom:1px solid var(--line); }
  .trow .t-k { width:96px; flex:none; font-size:12.5px; color:var(--muted); }
  .trow .t-tok { flex:1; text-align:right; font-family:var(--mono); font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; }
  .trow .t-bar { flex:none; width:86px; height:3px; border-radius:3px; background:var(--line); overflow:hidden; }
  .trow .t-bar span { display:block; height:100%; border-radius:3px; background:var(--accent); opacity:.65; }
  .trow .t-cost { flex:none; width:62px; text-align:right; font-family:var(--mono); font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; }
  .seg { display:inline-flex; gap:2px; background:var(--surface-2); border:1px solid var(--line); border-radius:6px; padding:2px; }
  .seg button { border:none; background:transparent; color:var(--muted); font-family:var(--mono); font-size:10.5px; padding:4px 9px; border-radius:4px; cursor:pointer; }
  .seg button.on { background:var(--surface-3); color:var(--ink); }
  .orow { display:flex; align-items:center; gap:16px; padding:10px 0; border-bottom:1px solid var(--line); }
  .orow .o-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .orow .o-t { font-size:13px; color:var(--ink); }
  .orow .o-sub { font-size:11.5px; color:var(--muted); }
  .orow .o-sub.mono { font-family:var(--mono); font-size:10.5px; color:var(--muted); }
  .sw { flex:none; width:34px; height:19px; border-radius:19px; background:var(--line-2); display:flex; align-items:center; padding:2px; cursor:pointer; transition:.18s; }
  .sw .kn { width:15px; height:15px; border-radius:50%; background:var(--muted); transition:.18s; }
  .sw.on { background:var(--accent); }
  .sw.on .kn { background:#fff; transform:translateX(15px); }
  .pjrow { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
  .pj-dot { flex:none; width:14px; height:14px; border-radius:5px; background:var(--c); cursor:pointer; box-shadow:0 0 0 0 rgba(255,255,255,0); transition:.15s; }
  .segbig { display:inline-flex; gap:6px; }
  .segbig button { display:inline-flex; align-items:center; gap:8px; height:34px; padding:0 16px; border:1px solid var(--line-2); background:var(--surface-2); color:var(--muted); font-family:inherit; font-size:13px; border-radius:8px; cursor:pointer; transition:.15s; }
  .segbig button.on { border-color:var(--accent); background:var(--accent-soft); color:var(--accent); }
  .numf { flex:none; display:inline-flex; align-items:center; border:1px solid var(--line-2); border-radius:8px; background:var(--surface-2); overflow:hidden; }
  .numf button { width:28px; height:28px; border:none; background:transparent; color:var(--muted); font-family:inherit; font-size:14px; line-height:1; cursor:pointer; }
  .numf .val { width:54px; text-align:center; font-family:var(--mono); font-size:12.5px; color:var(--ink); font-variant-numeric:tabular-nums; }
  /* ── v11 missing — tabs/chart/brow/filter/swpop/collab/dd/dfrow/pair/dev ── */
  .tabs { margin-left:auto; display:inline-flex; gap:3px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; padding:3px; }
  .tabs button { border:none; background:transparent; color:var(--muted); font-family:inherit; font-size:11.5px; font-weight:500; padding:5px 11px; border-radius:6px; cursor:pointer; }
  .tabs button:hover { color:var(--ink); }
  .tabs button.on { background:var(--surface-3); color:var(--ink); }
  .chart { display:flex; align-items:flex-end; gap:10px; height:104px; padding-top:4px; }
  .cbar { width:34px; height:100%; display:flex; flex-direction:column; justify-content:flex-end; gap:7px; }
  .cbar .cb { width:100%; background:var(--accent); opacity:.8; border-radius:4px 4px 2px 2px; }
  .cbar .cl { font-family:var(--mono); font-size:9.5px; color:var(--muted); text-align:center; }
  .brow { display:flex; align-items:center; gap:14px; padding:9px 0; border-bottom:1px solid var(--line); }
  .brow:last-of-type { border-bottom:none; }
  .b-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .b-name { font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .b-meta { font-family:var(--mono); font-size:10.5px; color:var(--muted); }
  .b-time { flex:none; width:64px; text-align:right; font-family:var(--mono); font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .b-cost { flex:none; width:62px; text-align:right; font-family:var(--mono); font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; }
  .filter { display:inline-flex; align-items:center; gap:8px; flex:none; padding:5px 10px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--muted); }
  .filter input { width:130px; background:transparent; border:none; outline:none; color:var(--ink); font-family:inherit; font-size:11.5px; }
  .filter input::placeholder { color:var(--muted); }
  .swpop { display:flex; gap:9px; padding:11px 13px; margin:0 0 10px 26px; width:max-content; background:var(--surface-2); border:1px solid var(--line-2); border-radius:12px; }
  .sw-c { width:18px; height:18px; border-radius:6px; background:var(--c); cursor:pointer; transition:.15s; }
  .sw-c:hover { transform:scale(1.12); }
  .sw-c.on { box-shadow:0 0 0 2px var(--surface), 0 0 0 3.5px var(--ink); }
  .collab { flex:none; font-family:var(--mono); font-size:9.5px; letter-spacing:.06em; color:var(--muted); width:34px; text-align:center; }
  .orow.dim { opacity:.45; }
  .dfrow { display:flex; align-items:center; gap:16px; padding:11px 0; border-bottom:1px solid var(--line); cursor:pointer; }
  .dfrow:last-of-type { border-bottom:none; }
  .dfrow:hover .dfval { color:var(--ink); }
  .dfrow.open .dfval { color:var(--accent); }
  .dfval { flex:none; display:flex; align-items:center; gap:8px; font-family:var(--mono); font-size:12px; color:var(--muted); transition:.15s; }
  .dfval .chv { color:var(--muted); display:flex; }
  .dd { margin:2px 0 10px; padding:5px; background:var(--surface-2); border:1px solid var(--line-2); border-radius:12px; }
  .dd-item { display:flex; align-items:center; gap:11px; padding:8px 10px; border-radius:8px; cursor:pointer; }
  .dd-item:hover { background:var(--surface-3); }
  .dd-item.on { background:var(--surface-3); }
  .dd-item.off { opacity:.5; cursor:default; }
  .dd-item.off:hover { background:transparent; }
  .dd-ico { flex:none; display:flex; color:var(--muted); }
  .dd-item.on .dd-ico { color:var(--accent); }
  .dd-body { flex:1; min-width:0; display:flex; align-items:baseline; gap:10px; }
  .dd-n { font-family:var(--mono); font-size:12.5px; color:var(--ink); flex:none; }
  .dd-d { font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tag-off { flex:none; font-family:var(--mono); font-size:10px; color:var(--stop); }
  .dd-sep { height:1px; background:var(--line); margin:5px 8px; }
  .dd.fontdd .dd-item { padding:9px 10px; }
  .dd.fontdd .dd-n { font-size:13.5px; }
  .linkbtn { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:5px; border:none; background:transparent; color:var(--accent); font-family:inherit; font-size:11.5px; cursor:pointer; padding:0; }
  .linkbtn:hover { color:var(--accent); filter:brightness(1.1); }
  .linkbtn.small { font-size:11px; gap:5px; }
  .pair { display:flex; align-items:flex-start; gap:18px; padding:16px; border-radius:12px; background:var(--surface-2); border:1px solid var(--line); }
  .pair-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; }
  .pair-body .pt { font-size:13px; font-weight:500; color:var(--ink); }
  .pair-body .ps { font-size:11.5px; line-height:1.55; color:var(--muted); }
  .linkbox { display:flex; align-items:center; gap:9px; margin-top:2px; padding:7px 9px; border-radius:8px; background:var(--surface); border:1px solid var(--line); color:var(--muted); }
  .linkbox .lk { flex:1; min-width:0; font-family:var(--mono); font-size:10.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .linkbox .btn { height:24px; padding:0 9px; flex:none; font-size:11px; }
  .spin-dot { width:7px; height:7px; border-radius:50%; background:var(--accent); animation:pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:.25} 50%{opacity:1} }
  .dev { display:flex; align-items:center; gap:12px; padding:9px 4px; border-bottom:1px solid var(--line); }
  .dev:last-of-type { border-bottom:none; }
  .dev .d-ico { color:var(--muted); display:flex; flex:none; }
  .d-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .d-name { font-size:13px; color:var(--ink); }
  .d-meta { font-family:var(--mono); font-size:10.5px; color:var(--muted); }
  .d-seen { flex:none; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .hint b { color:var(--ink); font-weight:600; }
  .note.flat { margin-top:20px; }
  .trow.total { border-top:1px solid var(--line-2); border-bottom:none; margin-top:4px; padding-top:9px; }
  .trow.total .t-k { color:var(--ink); font-weight:500; }
  .pathbox .p.secret { letter-spacing:.14em; color:var(--muted); }

  /* ─── impostazioni del 2 settembre 2026 ───────────────────────────────────
     Quattro cure, tutte chieste guardando la pagina viva:
     1. il titolo di una riga si **legge** prima della descrizione: peso su `.o-t`,
        colore neutro su `.o-sub`, e un `gap` che li separa senza dover guardare.
        Prima i due pesi erano uguali e la descrizione si leggeva come continuazione
        del titolo — su una riga con descrizione lunga non si capiva dove finisse
        l'uno e cominciasse l'altra.
     2. il valore dei selettori chiude la riga **a destra**, come una colonna di
        tabella: a sinistra si leggerà ciò che la riga è, a destra ciò che vale ora.
     3. la riga di stato di System (`.sysrow`) non prende il fondo della `.row`
        globale, che è la riga di un tool dentro un turno e qui non c'entra.
     4. il pannello del modello preferito è un selettore con ricerca: fila lunghe
        su due righe, con agent e provider che dicono *di chi* è il modello. */
  .orow .o-t, .prow .o-t, .dfrow .o-t, .prow .pn { font-weight:600; }
  .orow .o-sub, .prow .o-sub, .dfrow .o-sub, .prow .pd { margin-top:2px; }
  /* Il corpo colonna di `.prow` e `.dfrow` esisteva solo per `.orow`: nelle altre due
      la descrizione finiva **in linea** col titolo, e il colore lo ereditava da lui
      (misurato: `display:block`, colore `--ink`). Stesse regole del design v11. */
  .prow .o-body, .dfrow .o-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .prow .o-t, .dfrow .o-t { font-size:13px; color:var(--ink); }
  .prow .o-sub, .dfrow .o-sub { font-size:11.5px; line-height:1.5; color:var(--muted); }
  .prow .o-sub.mono, .dfrow .o-sub.mono { font-family:var(--mono); font-size:10.5px; color:var(--muted); }

  /* Il valore a destra: `margin-left:auto` e non `flex:1` sul corpo, perché il
     corpo deve restare largo quanto il suo testo — è lo spazio fra i due a
     crescere. */
  .dfrow .dfval { margin-left:auto; }
  .prow .seg { margin-left:auto; }
  .prow .kbrow { margin-left:auto; }
  .prow .pn { font-size:13px; color:var(--ink); }
  .prow .pd { font-size:11.5px; color:var(--muted); }

  /* Le due colonne dello zoom (reset + stepper) viaggiano insieme, allineate a destra:
     il reset compare solo quando serve, e la colonna non si sposta quando appare. */
  .numstack { flex:none; display:inline-flex; align-items:center; gap:10px; margin-left:auto; }
  .numstack .linkbtn { color:var(--accent); }
  .numstack .linkbtn :global(svg.ic) { width:11px; height:11px; }

  /* La riga di stato di System. Niente fondo, niente bordo: è un elenco chiave-valore,
     non un blocco dentro la conversazione. */
  .sysrow { display:flex; align-items:baseline; gap:14px; padding:7px 0; }
  .sysrow .k { width:132px; flex:none; font-size:12.5px; font-weight:600; color:var(--ink); }
  .sysrow .v { font-family:var(--mono); font-size:12.5px; color:var(--ink-2); display:flex; align-items:center; gap:6px; min-width:0; }
  .sysrow .m { font-family:var(--mono); font-size:11.5px; color:var(--muted); margin-left:auto; }
  .sysrow .m.ok { color:var(--done); }
  .sysrow .m.warn { color:var(--wait); }

  /* L'icona di un evento in Notifications: stessa grammatica del `.dd-ico`, con lo
     stesso posto che aveva la colonna di testo mai spiegata. */
  .orow .e-ico { flex:none; display:flex; color:var(--muted); }
  .orow .e-ico :global(svg.ic) { width:15px; height:15px; }

  /* Il pannello di scelta modello con ricerca: fila, non griglia. Il nome in mono
     resta un manico, agent e provider dicono di chi è. */
  /* `.moddd` ospita `<ModelPicker>`, non righe `.dd-item`: quel componente gestisce da
     sé lo scorrimento della sua lista (220px, la stessa misura del dock). Il solo
     ritocco che serve qui è il padding — 4px, non i 5px di `.dd` — perché la casella
     di ricerca del picker si stacca dal bordo con un margine negativo tarato su 4px
     (`.pk-search{margin:2px -4px -4px}`), la stessa cornice che usa nel dock. */
  .moddd { padding:4px; }

  /* Il QR vero nel blocco di pairing: il fondo resta bianco fisso (contrasto per la
     fotocamera, non per il tema), l'immagine ci sta dentro senza dilatarsi. */
  .pair-qr { flex:none; padding:8px; border-radius:8px; background:#fff; display:flex; }
  .pair-qr img { display:block; width:120px; height:120px; }
  .pair-qr .spin { width:14px; height:14px; margin:53px; border-radius:50%;
    border:1.5px solid var(--line-2); border-top-color:var(--accent); animation:spin .8s linear infinite; }
  .pair .linkbox { margin-top:2px; }
  .pair .ps { max-width:34ch; }
</style>
