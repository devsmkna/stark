<script lang="ts">
  // La conversazione: turni richiudibili, e dentro ciascuno i blocchi di ciò che è
  // successo. Il turno è un contenitore, non un messaggio come gli altri: la richiesta
  // dell'utente ne è l'intestazione, e tutto il resto sta dentro.
  //
  // Quasi tutto è chiuso: tredici scambi di lavoro vero fanno circa quattrocento
  // blocchi, e l'unico modo di reggerli è mostrare i titoli. L'eccezione è la risposta
  // a parole, che non si richiude mai — è l'unica cosa scritta *per* l'utente.
  import Icon from './Icon.svelte'
  import FileBlock from './FileBlock.svelte'
  import Dock from './Dock.svelte'
  import type { LinkStatus } from '../lib/api.ts'
  import type { PartView, SessionSnapshot, TurnView } from '$core/reduce.ts'
  import { SvelteSet } from 'svelte/reactivity'
  import { promptText } from '$core/events.ts'
  import { colours, dayBanner, hhmm, project, projectName, since, timeOnly, toolIcon, turnStatus } from '../lib/view.ts'
  import { renderMarkdown } from '../lib/markdown.ts'
  import { osservaPercorsi, pezziConCitazioni } from '../lib/percorsi.ts'
  import { decoraColoriTesto } from '../lib/colori.ts'
  import { zoomRoot } from '../lib/zoom.ts'
  import {
    conta, groupParts, isLive, keyOf, type Grp, type OpPart,
  } from '../lib/gruppi.ts'
  import type { Store, View } from '../lib/store.svelte.ts'

  // `id` e `setView` invece di `store.selected`/`store.show()`: con più pannelli
  // aperti insieme, «la chat a fuoco» non è più la chat che *questo* componente sta
  // mostrando. Passarli come prop rende visibile a chi monta il componente che ogni
  // istanza parla di una chat precisa — e toglie il modo di sbagliarsi dall'interno.
  let { store, snap, link, id, setView, onClose }:
    {
      store: Store; snap: SessionSnapshot; link: LinkStatus
      id: string
      setView: (v: View) => void
      /** Chiude il pannello che mostra questa chat. C'è solo quando i pannelli sono
       *  più di uno: il `×` sta nella barra che esiste già invece che in una seconda
       *  intestazione sopra, che ripeterebbe il titolo e ruberebbe una riga di altezza. */
      onClose?: () => void
    } = $props()

  /** La riga dell'elenco di **questa** chat, non di quella a fuoco. */
  const row = $derived(store.rows.find(r => r.id === id))
  const live = $derived(row?.live ?? false)

  // Di default è aperto il turno **attivo** — quello che l'agent sta davvero facendo,
  // che non è sempre l'ultimo: se mandi un messaggio mentre lavora ancora al
  // precedente, quello nuovo si accoda e non ha ancora un blocco. Aprire «l'ultimo»
  // alla lettera richiuderebbe il lavoro vero proprio mentre è in corso. Quando
  // nessun turno è attivo si torna alla regola semplice: l'ultimo. `!id` marca un
  // turno chiuso a mano: senza, richiuderlo non avrebbe effetto, perché la regola di
  // default lo riaprirebbe subito.
  //
  // Aperti sono **due**, non uno: quello in corso e quello prima. Mandare un prompt
  // nuovo, con un turno solo, richiudeva sotto il naso di chi stava ancora leggendo la
  // risposta appena arrivata — e quella risposta è spesso il motivo per cui si sta
  // scrivendo il prompt dopo. Due basta e tre no: il penultimo si chiude da sé quando
  // ne parte un altro, se no dopo dieci prompt la conversazione è di nuovo un muro.
  // Chi vuole tenerne aperto un terzo lo apre a mano, e resta aperto: `opened` vince
  // sempre sulla regola di default.
  let opened = $state<Set<string>>(new Set())
  const defaultOpenIdx = $derived.by((): number => {
    const attivo = snap.turns.findIndex(t => !t.ended)
    return attivo !== -1 ? attivo : snap.turns.length - 1
  })
  const isOpen = (t: TurnView, i: number): boolean =>
    opened.has(t.turnId)
      ? true
      : ((i === defaultOpenIdx || i === defaultOpenIdx - 1) && !opened.has(`!${t.turnId}`))

  function toggle(t: TurnView, i: number): void {
    const next = new Set(opened)
    if (isOpen(t, i)) { next.delete(t.turnId); next.add(`!${t.turnId}`) }
    else { next.add(t.turnId); next.delete(`!${t.turnId}`) }
    opened = next
  }

  // ─── i capitoli: dove il contesto è stato azzerato, si chiude ──────────────
  //
  // `/clear` non è un comando come gli altri: quello che sta sopra il modello non ce
  // l'ha più, nemmeno riassunto. Lasciarlo scorrere uguale al resto è mostrare come
  // corrente qualcosa che non lo è, e la conversazione continua a crescere senza
  // dire dove ha smesso di contare. Quindi tutto ciò che precede un `/clear`, il
  // turno del comando compreso, si raccoglie in un capitolo **chiuso**: una riga sola
  // che si riapre cliccandoci, perché azzerato non vuol dire cancellato — il journal
  // ce l'ha ancora, ed è spesso lì che si va a rileggere *cosa* si stava facendo.
  //
  // L'ultimo capitolo è quello vivo: non ha intestazione e non si chiude, è la chat.
  type Chapter = { key: string; items: { turn: TurnView; i: number }[]; clearedAt?: number }
  const chapters = $derived.by((): Chapter[] => {
    const out: Chapter[] = []
    let cur: Chapter | undefined
    snap.turns.forEach((turn, i) => {
      if (!cur) { cur = { key: `ch:${turn.turnId}`, items: [] }; out.push(cur) }
      cur.items.push({ turn, i })
      // Il turno del `/clear` sta DENTRO il capitolo che chiude, non fuori: è l'ultima
      // cosa avvenuta con quel contesto ancora in piedi.
      if (turn.clearedAt !== undefined) { cur.clearedAt = turn.clearedAt; cur = undefined }
    })
    // Un `/clear` appena dato lascia `cur` vuoto: il capitolo vivo non esiste ancora
    // perché non è successo ancora niente dentro di lui. Lo si apre lo stesso, vuoto,
    // perché è **lui** a spingere i tagli sopra il bordo (vedi `.chapter.live` nel CSS):
    // senza, subito dopo un `/clear` resterebbero le due righe a mezz'aria in cima a una
    // schermata per il resto deserta — che è esattamente il caso da cui nasce questa
    // regola. La conversazione appare vuota, ed è onesto: il contesto lo è.
    if (!cur && out.length > 0) out.push({ key: 'ch:live', items: [] })
    return out
  })
  let openedChapters = $state<Set<string>>(new Set())
  function toggleChapter(key: string): void {
    const next = new Set(openedChapters)
    if (next.has(key)) next.delete(key); else next.add(key)
    openedChapters = next
  }
  /** Quanti turni ci sono dentro, escluso il `/clear` che li ha chiusi: quello è il
   *  taglio, non uno degli scambi che si stanno riponendo. */
  const chapterTurns = (ch: Chapter): number => Math.max(0, ch.items.length - 1)

  /** Il turno che apre una giornata nuova, con l'etichetta da mostrare sopra di lui —
   *  come WhatsApp: il giorno si dice una volta sola, non su ogni riga. Calcolato
   *  sull'ordine con cui i capitoli si disegnano davvero, non su `snap.turns`: un
   *  capitolo chiuso non mostra le sue righe, e il primo giorno visibile deve restare
   *  quello del primo turno che si vede, non quello del primo turno in assoluto. */
  const dayBanners = $derived.by(() => {
    const m = new Map<string, string>()
    let lastDay: string | undefined
    for (const ch of chapters) {
      for (const { turn } of ch.items) {
        if (!turn.startedAt) continue
        const day = new Date(turn.startedAt).toDateString()
        if (day !== lastDay) {
          m.set(turn.turnId, dayBanner(turn.startedAt))
          lastDay = day
        }
      }
    }
    return m
  })

  // ─── i singoli blocchi: reasoning e tool si aprono a loro volta ────────────
  // Chiusi di default per lo stesso motivo per cui lo è il turno: tredici scambi
  // veri fanno ~400 blocchi, e mostrarli per intero renderebbe illeggibile proprio
  // ciò che dovrebbe stare a colpo d'occhio.
  let openedBlocks = $state<Set<string>>(new Set())
  const blockOpen = (key: string): boolean => openedBlocks.has(key)
  function toggleBlock(key: string): void {
    const next = new Set(openedBlocks)
    if (next.has(key)) next.delete(key); else next.add(key)
    openedBlocks = next
  }
  /** L'input del tool, leggibile: già strutturato se è arrivato, grezzo se no. */
  const prettyInput = (part: Extract<PartView, { kind: 'tool' }>): string => {
    if (part.input !== undefined) {
      try { return JSON.stringify(part.input, null, 2) } catch { /* usa il grezzo */ }
    }
    return part.inputRaw
  }

  // ─── raggruppare il lavoro: fra il prompt e la risposta c'è UN blocco ──────
  //
  // La regola sta in `lib/gruppi.ts` — cosa entra nel gruppo, cosa lo spezza, cos'è il
  // recap — perché è la parte che si sbaglia davvero e lì si prova con `node` puro
  // (`npm run gruppi:check`). Qui resta solo il *come si disegna*: una riga chiusa che
  // conta cosa c'è dentro, e l'operazione in corso che le resta fuori.

  /**
   * L'ultima cosa scritta per l'utente finisce con un punto di domanda? È il
   * messaggio più facile da perdere in un muro di testo, perché non somiglia a una
   * domanda — è una `answer`/`Ask` a somigliarci. Vale solo per l'ultimo blocco di
   * testo dell'ultimo turno: è l'unico che si può ancora perdere, il resto è storia.
   */
  const isOpenQuestion = (i: number, part: PartView): boolean => {
    if (part.kind !== 'text' || i !== snap.turns.length - 1) return false
    const testi = snap.turns[i]!.parts.filter((p): p is Extract<PartView, { kind: 'text' }> => p.kind === 'text')
    const ultimo = testi[testi.length - 1]
    return !!ultimo && ultimo.partId === part.partId && /\?\s*$/.test(part.text.trim())
  }

  /**
   * Il bottone «Copy» sopra un blocco di codice non è mai un elemento Svelte: nasce
   * come stringa HTML dentro `renderMarkdown` (vedi `markdown.ts`), quindi non c'è
   * niente a cui attaccare un `onclick` suo, né uno `$state` sensato — Svelte non sa
   * che esiste. Un solo listener delegato su `.prose` copre tutti i blocchi di quella
   * risposta, e la spunta «Copied» si scrive direttamente sul nodo cliccato: è DOM
   * grezzo, e trattarlo come tale è più semplice che fingerlo reattivo.
   *
   * Se la risposta si sta ancora scrivendo, un nuovo delta rifà l'HTML e il bottone
   * cliccato sparisce con lui: il `setTimeout` in sospeso non fa danni (agisce su un
   * nodo staccato dal documento), e quello nuovo nasce già con la scritta giusta.
   */
  async function onProseClick(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement

    // F1: il bottone «Open in …» accanto a un link riconosciuto. Vedi `addAppLinks`
    // in `markdown.ts` per perché non è il link stesso a essere riscritto.
    const appBtn = target.closest<HTMLElement>('[data-open-app]')
    if (appBtn) {
      const url = appBtn.getAttribute('data-url')
      const scheme = appBtn.getAttribute('data-scheme')
      if (url && scheme) await store.openApp(url, scheme)
      return
    }

    // I due bottoni dentro un percorso citato. Stessa delegazione dei blocchi di
    // codice e per la stessa ragione: nascono come DOM grezzo dentro `decoraPercorsi`,
    // quindi non c'è nessun elemento Svelte a cui attaccare un `onclick`.
    const cp = target.closest<HTMLElement>('[data-copy-path]')
    if (cp) {
      const p = cp.getAttribute('data-copy-path') ?? ''
      try { await navigator.clipboard.writeText(p) }
      catch { store.refused = 'the browser did not allow copying'; return }
      // La spunta si scrive sul nodo, non in uno stato: il prossimo delta rifà
      // l'HTML e se la porta via da sé.
      cp.classList.add('done')
      setTimeout(() => cp.classList.remove('done'), 3000)
      return
    }
    const rv = target.closest<HTMLElement>('[data-reveal-path]')
    if (rv) { await store.reveal(rv.getAttribute('data-reveal-path') ?? '', snap.sessionId); return }

    const btn = target.closest<HTMLElement>('[data-copy]')
    const pre = btn?.closest('.codeblock')?.querySelector('pre')
    if (!btn || !pre) return
    try {
      await navigator.clipboard.writeText(pre.textContent ?? '')
    } catch {
      store.refused = 'the browser did not allow copying'
      return
    }
    const label = btn.querySelector('span')
    btn.classList.add('done')
    if (label) label.textContent = 'Copied'
    setTimeout(() => {
      btn.classList.remove('done')
      if (label) label.textContent = 'Copy'
    }, 1500)
  }

  // ─── auto-scroll ─────────────────────────────────────────────────────────
  // Segue il fondo finché l'utente non risale a leggere qualcosa: solo allora
  // smette, perché altrimenti lo strapperebbe via da quello che stava leggendo.
  // Torna a seguirlo da solo se l'utente riscende in fondo a mano.
  let scrollerEl = $state<HTMLDivElement | null>(null)
  let stick = $state(true)
  function onScroll(): void {
    if (!scrollerEl) return
    const gap = scrollerEl.scrollHeight - scrollerEl.scrollTop - scrollerEl.clientHeight
    stick = gap < 56
  }
  let lastSession = $state('')
  $effect(() => {
    if (snap.sessionId !== lastSession) { lastSession = snap.sessionId; stick = true }
  })

  // ─── l'altezza dell'intestazione del turno ────────────────────────────────
  // La pill del gruppo operations aperto si appiccica ESATTAMENTE sotto
  // l'intestazione del turno, che è già sticky a `top:0`. Quanto vale «sotto»
  // non si dichiara a mano: l'header è ~33px, ma un numero scritto qui sarebbe
  // caduto alla prima modifica del suo padding — e lo zoom del testo cambia i
  // pixel veri, non quelli che le lunghezze CSS valgono dentro il root. Si
  // misura quindi il rettangolo vero (getBoundingClientRect) e lo si riporta
  // in unità locali dividendo per lo zoom: la stessa conversione di `zoom.ts`,
  // che registra la regola per il menu del tasto destro.
  let thH = $state(34)
  const misuraTh = (el: HTMLElement): { destroy(): void } => {
    const leggi = (): void => { thH = el.getBoundingClientRect().height / zoomRoot() }
    const ro = new ResizeObserver(leggi)
    ro.observe(el)
    return { destroy: () => ro.disconnect() }
  }

  /**
   * I percorsi citati diventano copiabili e apribili — **dopo** che il testo è
   * comparso, mai prima: la domanda «questo file esiste?» va al daemon, cioè è
   * asincrona, e legarla al rendering vorrebbe dire che un daemon lento ritarda la
   * **lettura** della risposta.
   *
   * Si osserva il DOM invece di elencare le dipendenze. La prima versione dipendeva da
   * «quanti turni» e «quante parti», e richiudere e riaprire un turno non cambia né
   * l'uno né l'altro — ma rifà l'HTML da zero, quindi i percorsi tornavano nudi
   * (misurato: 5 candidati, 0 bottoni). Aggiungere `open` alle dipendenze avrebbe
   * chiuso quel caso e lasciato aperti quelli che non ho ancora incontrato.
   */
  $effect(() => {
    const el = scrollerEl
    if (!el) return
    return osservaPercorsi(el, snap.sessionId, store.api)
  })
  $effect(() => {
    // Letture che fanno da dipendenza: quanti turni, e quanto contenuto c'è **in tutti**
    // — un `text.delta` cresce lo stesso blocco senza aggiungerne uno, quindi contare i
    // blocchi non basta e serve anche la lunghezza del testo.
    //
    // Su **tutti** i turni e non solo sull'ultimo, ed è la correzione di un bug vero:
    // il turno che sta crescendo non è sempre l'ultimo. Se mandi un prompt mentre
    // l'agent lavora ancora al precedente, quello nuovo si accoda **subito** come turno
    // in fondo, vuoto e fermo (`queued`), mentre a scrivere resta quello prima. Guardando
    // solo l'ultimo, la misura restava zero per tutto il tempo: la dipendenza non
    // cambiava mai, l'effetto non ripartiva, e la conversazione smetteva di seguire il
    // fondo **proprio mentre l'agent scriveva**. Che è il momento in cui serve.
    // Il file sapeva già che «il turno attivo non è sempre l'ultimo» (vedi il commento
    // sopra `isOpen`): quella conoscenza era stata applicata a quale turno aprire, non
    // qui. Sommare su tutti costa un giro sui blocchi già in memoria — `length` di una
    // stringa non la riconta — e toglie di mezzo il caso speciale invece di inseguirlo.
    const misura = snap.turns.reduce((n, t) => n + t.parts.reduce(
      (m, p) => m + (p.kind === 'text' || p.kind === 'reasoning' ? p.text.length : 1), 0), 0)
    void snap.turns.length; void misura
    if (stick && scrollerEl) {
      const el = scrollerEl
      // `stick` si rilegge **dentro** il frame, non solo qui fuori. Fra il momento in
      // cui l'effetto gira e quello in cui il frame arriva, qualcun altro può aver
      // deciso che non si sta più seguendo il fondo — è quello che fa l'effetto qui
      // sotto, quando si arriva da un risultato di ricerca. Senza questa rilettura la
      // pagina saltava in fondo **dopo** essersi portata sul turno trovato, e il salto
      // sembrava non essere mai avvenuto (misurato: turno a -684px, scroll incollato
      // al massimo).
      requestAnimationFrame(() => { if (stick) el.scrollTop = el.scrollHeight })
    }
  })

  /**
   * Arrivare da un risultato di ricerca: aprire il turno trovato e portarcisi.
   *
   * Tre cose insieme, e ognuna serve. Il turno va **aperto**, perché di default lo è
   * solo l'ultimo e la corrispondenza sta quasi sempre dentro uno chiuso. Va aperto
   * anche il suo **capitolo**, se sta sopra un `/clear`: quelli sono chiusi per scelta,
   * e portare in vista qualcosa che non è renderizzato non porta in vista niente. E
   * `stick` va spento, altrimenti l'effetto dell'auto-scroll — che gira subito dopo,
   * perché il contenuto è appena cambiato — riporta in fondo cancellando il salto.
   *
   * Si aspetta un frame prima di misurare: il turno che si è appena aperto non ha
   * ancora la sua altezza, e `scrollIntoView` su un elemento alto zero atterra nel
   * punto sbagliato.
   *
   * Quarta cosa, arrivata col raggruppamento del lavoro: vanno aperti anche i
   * **gruppi** del turno. Da quando i testi ci finiscono dentro, la corrispondenza
   * può stare lì — e portare in vista un turno in cui la frase cercata è dentro una
   * riga chiusa è di nuovo «non portare in vista niente», la stessa malattia del
   * capitolo qui sopra. Si aprono tutti e non quello giusto perché una `Match` porta
   * il `turnId` e non la parte (`core/search.ts`): dirlo con precisione vorrebbe
   * dire allargare il contratto della ricerca fin dal daemon. E chi arriva da una
   * ricerca ha chiesto di vedere, non di stare calmo — è l'unico posto in cui il
   * muro è la risposta giusta.
   */
  $effect(() => {
    const turnId = store.mostra
    if (!turnId) return
    const i = snap.turns.findIndex(t => t.turnId === turnId)
    if (i === -1) return          // snapshot non ancora arrivato: si riproverà
    store.mostra = null
    stick = false
    opened = new Set(opened).add(turnId)
    const ch = chapters.find(c => c.items.some(x => x.turn.turnId === turnId))
    if (ch?.clearedAt !== undefined) openedChapters = new Set(openedChapters).add(ch.key)
    const blocchi = new Set(openedBlocks)
    for (const g of groupParts(snap.turns[i]!.parts)) if (g.kind === 'done') blocchi.add(g.key)
    openedBlocks = blocchi
    requestAnimationFrame(() => {
      const el = scrollerEl?.querySelector(`[data-turn="${CSS.escape(turnId)}"]`)
      // Istantaneo e non `smooth`: un'animazione di scorrimento è interrompibile, e
      // qui sotto continua ad arrivare contenuto dal flusso. Arrivare subito nel
      // punto giusto è più utile che arrivarci con grazia e a volte no.
      el?.scrollIntoView({ block: 'start' })
      // Un lampo, non un colore che resta: dice «è questo» a chi è appena arrivato,
      // e sparisce da sé perché da lì in poi sarebbe una marcatura senza significato.
      el?.classList.add('found')
      setTimeout(() => el?.classList.remove('found'), 1600)
    })
  })

  /** Riportarsi in fondo e ricominciare a seguire. Le due cose insieme: scendere e basta
   *  lascerebbe `stick` falso, quindi la riga dopo si tornerebbe a restare indietro. */
  function toFoot(): void {
    if (!scrollerEl) return
    stick = true
    scrollerEl.scrollTo({ top: scrollerEl.scrollHeight, behavior: 'smooth' })
  }

  const promptOf = (t: TurnView): string => promptText(t.prompt)

  /** Il prompt che si sta guardando per intero, o `null`. È di questa schermata e non
   *  dello store: nessun altro componente ha bisogno di saperlo, e metterlo là vorrebbe
   *  dire un altro stato globale da tenere in ordine. */
  let promptAperto = $state<string | null>(null)

  /** Copia il prompt intero. Stesso pattern dei bottone di copia dei blocchi codice:
   *  il `span` dentro il bottone passa da "Copy" a "Copied" e torna dopo un secondo e
   *  mezzo — la conferma avviene dove il dito ha premuto, non in un toast che nessuno
   *  cercava. */
  async function copiaPrompt(e: MouseEvent): Promise<void> {
    const btn = (e.currentTarget as HTMLElement).closest('button')
    try {
      await navigator.clipboard.writeText(promptAperto ?? '')
    } catch {
      store.refused = 'the browser did not allow copying'
      return
    }
    if (!btn) return
    btn.classList.add('done')
    const label = btn.querySelector('span')
    if (label) label.textContent = 'Copied'
    setTimeout(() => {
      btn.classList.remove('done')
      if (label) label.textContent = 'Copy'
    }, 1500)
  }
  /** Gli allegati il cui file non si trova più. Non è stato dell'app, è stato del disco. */
  let persi = $state(new SvelteSet<string>())

  /** 34802 → «34.8k». I token si leggono per ordine di grandezza, non a una a una. */
  const kilo = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  /** Le immagini che hai mandato con quel turno: stanno prima del testo, come le ha
   *  viste il modello. I byte non sono nel journal, quindi si chiedono al daemon. */
  const immaginiOf = (t: TurnView): Extract<TurnView['prompt'][number], { type: 'image' }>[] =>
    t.prompt.filter(p => p.type === 'image')
  /** Gli altri allegati — un PDF, un testo. Non hanno un'anteprima da mostrare: hanno
   *  un nome e un peso, ed è quello che dice cosa avevi mandato. */
  const fileOf = (t: TurnView): Extract<TurnView['prompt'][number], { type: 'file' }>[] =>
    t.prompt.filter(p => p.type === 'file')
  /** 683131 → «683 kB». Su un allegato il peso è l'unica misura che si legge a colpo. */
  const peso = (n: number): string =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} kB`
  // Sulla lista intera, non su questa sola riga: la tavolozza si assegna in ordine
  // alfabetico fra TUTTI i progetti, quindi calcolarla su un elenco di uno darebbe
  // sempre il primo colore — e lo stesso progetto avrebbe due colori diversi nelle
  // due metà dello schermo, che è esattamente ciò che il colore serve a evitare.
  const colour = $derived(colours(store.rows).get(project(snap.cwd)) ?? 0)
  const title = $derived(row?.title ?? projectName(snap.cwd, store.settings?.projects))

  /** Info utili per un bug report, in un blocco solo: id, titolo, agent, modello,
   *  stato, cwd. Presa dallo snapshot — nessun dato nuovo, solo raccolto in un posto. */
  let debugCopiato = $state(false)
  async function copiaDebug(): Promise<void> {
    const righe = [
      `ID: ${snap.sessionId}`,
      `Titolo: ${title}`,
      `Agent: ${snap.agent ?? '—'}`,
      `Modello: ${snap.model ?? '—'}`,
      `Modalità: ${snap.mode ?? '—'}`,
      `Stato: ${snap.state}${snap.stateReason ? ` (${snap.stateReason})` : ''}`,
      `Errore: ${snap.error ?? '—'}`,
      `Cartella: ${snap.cwd ?? '—'}`,
      `Ultimo evento (seq): ${snap.lastSeq}`,
      `Ultimo evento (ora): ${new Date(snap.lastTs).toISOString()}`,
      `Da quanto in questo stato: ${new Date(snap.stateSince).toISOString()}`,
      `Resume ref: ${snap.resumeRef ?? '—'}`,
      `Turni: ${snap.turns.length}`,
      `File toccati: ${snap.files.length}`,
      `Comandi shell: ${snap.shell.length}`,
      `Live: ${live}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(righe)
      debugCopiato = true
      setTimeout(() => { debugCopiato = false }, 1500)
    } catch { store.refused = 'the browser did not allow copying' }
  }

  /**
   * Su cosa ha lavorato un tool — il *cosa*, non il *perché* (quello è `part.intent`,
   * F2, mostrato al suo posto nella riga qui sotto). Arriva **già pronto** dal
   * modello canonico: fino a ieri era questa funzione a frugare dentro `input`
   * cercando `command`/`file_path`, cioè a conoscere la forma di Claude Code fuori
   * dall'adapter. Adesso quel mestiere sta in `adapters/claude-code/summary.ts`, che
   * è dove ha diritto di stare. Il ripiego serve solo ai journal scritti prima, e
   * mostra ciò che c'è senza interpretarlo.
   */
  const subject = (part: Extract<PartView, { kind: 'tool' }>): string =>
    part.summary ?? part.inputRaw.slice(0, 120)

  /** L'operazione ancora in corso, se c'è: al più una per turno. Non ha un blocco suo
   *  — sta in testa alla pill del gruppo («ops · notes · duration»), perché è la stessa
   *  cosa che quella pill riassume: l'ultima operazione, quella non ancora finita. */
  const livePart = (groups: Grp[]): OpPart | undefined => {
    const g = groups.find((x) => x.kind === 'live')
    return g ? g.part : undefined
  }

  /** La chiave dell'ultimo gruppo `done`, o `undefined` se non ce n'è. L'operazione
   *  in corso sta in testa alla riga di **quell'** gruppo: è l'ultima cosa accaduta,
   *  e i gruppi prima sono lavoro già finito che non la riguarda. */
  const lastDoneKey = (groups: Grp[]): string | undefined => {
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i]!.kind === 'done') return groups[i]!.key
    }
    return undefined
  }

  /**
   * Il percorso che questo tool ha nominato, se ce n'è uno — non indovinato dal
   * testo, letto dagli stessi campi che `summary.ts` già riconosce come «un
   * percorso» (F3, Notion). `pattern`/`url`/`query`/`prompt`/`command` restano
   * fuori: un comando può *contenere* un percorso in mezzo ad altro, ma non è lui il
   * percorso, e sbagliare qui vorrebbe dire offrire di "rivelare" una stringa che
   * non esiste sul disco.
   */
  const PATH_KEYS = ['file_path', 'path', 'notebook_path']
  const pathOf = (part: Extract<PartView, { kind: 'tool' }>): string | undefined => {
    const o = part.input as Record<string, unknown> | undefined
    if (!o || typeof o !== 'object') return undefined
    for (const k of PATH_KEYS) {
      const v = o[k]
      if (typeof v === 'string' && v) return v
    }
    return undefined
  }

  /** Le modifiche prodotte da questa chiamata, per mostrarle dove sono accadute. */
  const editsOf = (callId: string) => snap.files.filter(f => f.callId === callId)

  // Trascinare il pannello: la barra è la sua maniglia. Stesso meccanismo della riga
  // dell'elenco (`Sidebar.svelte`), quindi `Workspace` non deve imparare niente di
  // nuovo — e `replacePane`/`splitPane` sanno già che una chat già aperta si **sposta**
  // invece di duplicarsi. Solo con più pannelli aperti: con uno solo non c'è nessun
  // altro riquadro su cui lasciarla cadere, ed è esattamente ciò che dice `onClose`.
  const dragHandle = $derived(onClose !== undefined)
  function onDragStart(e: DragEvent): void {
    e.dataTransfer?.setData('text/stark-chat-id', id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    store.draggingChat = id
  }
  const onDragEnd = (): void => { store.draggingChat = null }

  let renaming = $state(false)
  let draft = $state('')

  function startRename(): void {
    draft = title
    renaming = true
  }
  async function commitRename(): Promise<void> {
    renaming = false
    if (draft.trim() && draft !== title) {
      await store.rename(id, draft)
    }
  }

  function toggleAgent(): void {
    const open = store.todoOpen || store.helperOn
    if (open) {
      if (store.todoOpen) store.toggleTodo()
      if (store.helperOn) store.helperOn = false
    } else {
      if (store.helperW === 0) {
        const w = Math.max(220, Math.min(Math.round(innerWidth / 2.5), Math.round(innerWidth / 6)))
        store.setHelperW(w)
      }
      store.toggleTodo()
    }
  }
</script>

<div class="col">
  <div class="bar" draggable={dragHandle ? 'true' : 'false'}
    ondragstart={onDragStart} ondragend={onDragEnd}>
    <!-- Solo sullo schermo stretto: là la lista non e' affiancata, e senza questo
         non ci sarebbe modo di tornarci (§8 di ui-schermate.md). -->
    {#if store.narrow}
      <button class="iconb" title="Back to chats" onclick={() => store.back()}>
        <Icon name="i-back" />
      </button>
    {/if}
    <i class="dotk p{colour}"></i>
    {#if renaming}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="rn" autofocus bind:value={draft}
        onblur={() => void commitRename()}
        onkeydown={e => {
          if (e.key === 'Enter') void commitRename()
          if (e.key === 'Escape') renaming = false
        }} />
    {:else}
      <!-- Rinominare non apre niente: il titolo diventa scrivibile dov'è.
           Il titolo intero sta anche nel tooltip perché adesso la riga lo tronca coi
           puntini: senza, un titolo lungo diventerebbe illeggibile per intero senza
           entrare in modifica, cioè si perderebbe un'informazione per farne stare
           un'altra. Così la riga resta una, e il testo pieno resta a un dito. -->
      <button class="t" ondblclick={startRename} title="{title} — double-click to rename">{title}</button>
    {/if}

    <button class="iconb" title={debugCopiato ? 'Copied' : 'Copy debug info'}
      onclick={() => void copiaDebug()}>
      <Icon name={debugCopiato ? 'i-check' : 'i-copy'} />
    </button>

    <!-- Il conteggio in parole non ci sta su uno schermo stretto: sotto la soglia
         resta solo l'icona, stesso bottone, stessa destinazione — non è nascosta,
         è un'etichetta che qui non c'è spazio a scrivere per intero (Principio 5:
         quello che sparisce è il testo, non la funzione). -->
    <button class="effbtn" style="margin-left:auto" onclick={() => setView('effects')}
      title="{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} · {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}">
      {#if !store.narrow}
        <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
          {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      {/if}
      <Icon name="i-bars" />
    </button>

    <button class="iconb" title="Put to sleep — frees memory, not quota"
      style="margin-left:0" disabled={!live}
      onclick={() => void store.sleep(id)}><Icon name="i-moon" /></button>

    <button class="iconb" title="Toggle agent panel" aria-label="Toggle agent panel"
      aria-pressed={store.todoOpen || store.helperOn}
      onclick={toggleAgent}><Icon name="i-panel" /></button>

    {#if onClose}
      <button class="iconb" title="Close panel" onclick={onClose}><Icon name="i-x" /></button>
    {/if}
  </div>

  {#if link !== 'live' && live}
    <div class="offline">
      <Icon name={link === 'connecting' ? 'i-loader' : 'i-wifi-off'}
        style="animation:{link === 'connecting' ? 'sp 1.1s linear infinite' : 'none'}" />
      {link === 'connecting' ? 'Connecting…' : 'Connection lost — retrying, nothing is missed'}
    </div>
  {/if}

  <!-- Una riga sola per una reasoning e per un tool, in vista o dentro il gruppo
       collassato: lo stesso disegno, un posto solo da tenere allineato. -->
  {#snippet opRow(part: OpPart)}
    {#if part.kind === 'reasoning'}
      {@const key = `r:${part.partId}`}
      {@const ropen = blockOpen(key)}
      <button class="row think clickable" onclick={() => toggleBlock(key)}>
        <Icon name="i-brain" />
        <span class="k">Reasoning</span>
        <!-- Solo se c'è: senza token lo span sarebbe un code-chip vuoto, un
             rettangolino scuro senza testo — aberrazione visiva segnalata dall'utente
             il 29 agosto 2026. -->
        {#if part.estimatedTokens}
          <span class="v">{part.estimatedTokens} tokens</span>
        {/if}
        <span class="end chev" class:open={ropen}><Icon name="i-fwd" style="width:9px;height:9px" /></span>
      </button>
      {#if ropen}
        <div class="blockbody">{part.text || '…'}</div>
      {/if}
    {:else}
      {@const key = `t:${part.callId}`}
      {@const topen = blockOpen(key)}
      {@const revealPath = pathOf(part)}
      <!-- F3: quando il tool ha nominato un percorso, la riga si affianca a un
           secondo bottone che arriva lì — senza rubare il posto al clic che apre il
           dettaglio, ed è per questo che diventano due bottoni fratelli invece di
           uno dentro l'altro (non sarebbe HTML valido). Sugli altri tool (Bash senza
           percorso, WebFetch, …) la riga resta esattamente com'era. -->
      <div class="oprow" class:withreveal={!!revealPath}>
        <!-- `bad` solo se NON è bloccata: un'azione fermata dal classificatore torna
             comunque come tool fallito, e senza questa esclusione le due classi si
             sovrappongono e vince il rosso. Ma bloccato non è un fallimento — è
             «fermato, e puoi consentirlo tu». -->
        <button class="row clickable tool" class:bad={part.done && part.ok === false && !part.blocked}
             class:block={!!part.blocked} onclick={() => toggleBlock(key)}>
          <div class="rtop">
            <Icon name={part.blocked ? 'i-block' : toolIcon(part.name)} />
            <span class="k">{part.blocked ? 'Blocked' : part.name}</span>
            <!-- F2: quando l'agent ha scritto PERCHÉ (`intent`), è quella la riga
                 principale — dice dove sta andando, non solo cosa sta eseguendo. -->
            <span class="v" class:plain={!!part.intent}>{part.intent ?? subject(part)}</span>
            <span class="end" style="display:inline-flex;align-items:center;gap:4px">
              <!-- Un lavoro che continua per conto suo **vince** sull'esito della
                   chiamata, e non è un dettaglio di stile: il `tool_result` del
                   lancio torna positivo subito, quindi senza questa riga si
                   leggerebbe «✓» sopra un lavoro ancora in corso. Vedi `task` in
                   `reduce.ts`. -->
              {#if part.task && !part.task.status}
                {part.task.kind === 'agent' ? 'agent running' : 'running'}
              {:else if part.task?.status === 'failed'}failed
              {:else if part.blocked}stopped for safety
              {:else if !part.done}…
              {:else if part.ok}<Icon name="i-check" style="width:11px;height:11px;color:var(--done)" />
              {:else}<Icon name="i-x" style="width:11px;height:11px;color:var(--stop)" />{/if}
              <span class="chev" class:open={topen}><Icon name="i-fwd" style="width:9px;height:9px" /></span>
            </span>
          </div>
          {#if part.intent}
            <!-- Il soggetto esatto (comando, percorso) non sparisce dietro la
                 motivazione: resta visibile, sotto e più piccolo — un tooltip
                 avrebbe richiesto di sapere che c'era prima di poterlo cercare. -->
            <div class="rsub">{subject(part)}</div>
          {/if}
          <!-- Il resoconto del lavoro, quando arriva. Su un sub-agent è **l'unica**
               cosa che ne resta: il suo lavoro interno non passa da questo canale, e
               il CLI ne manda solo il riassunto. Sta nella riga chiusa e non dentro
               il dettaglio perché è la risposta alla domanda per cui si era guardata
               quella riga — «com'è andata?» — e farla aprire vorrebbe dire nasconderla
               proprio a chi era tornato apposta per leggerla. -->
          {#if part.task?.summary}
            <div class="tsum" class:bad={part.task.status === 'failed'}>{part.task.summary}</div>
          {/if}
        </button>
        {#if revealPath}
          <button class="reveal" title="Reveal in file manager" aria-label="Reveal in file manager"
            onclick={() => void store.reveal(revealPath, snap.sessionId)}>
            <Icon name="i-reveal" />
          </button>
        {/if}
      </div>
      {#if topen}
        <div class="blockbody">
          <div class="bblabel">Input</div>{prettyInput(part)}
          {#if part.error}
            <div class="bblabel err">Error</div>{part.error}
          {:else if part.output}
            <div class="bblabel">Output</div>{part.output}
          {/if}
        </div>
        <!-- Un'azione fermata dal classificatore non è un fallimento, ed è l'unico
             punto di STARK in cui l'utente resterebbe senza sapere cosa fare: il
             blocco non è una richiesta di permesso, quindi non c'è niente da premere
             e nessuna card che salga dal basso.
             Le tre vie d'uscita sono **quelle del CLI**, non nostre — le stesse che
             il CLI scrive al modello: prova un'altra strada, il sola-lettura passa
             comunque, torna dopo. Le ripetiamo a te perché il modello le legge e tu
             no, e la GUI esiste per non farti indovinare cosa sta succedendo.
             Quello che NON c'è, di proposito: un «consenti questa e riprova». Il CLI
             non lo offre, e ignora apposta le voci di `permissions.allow` che
             aggirerebbero il classificatore — quindi metterlo qui sarebbe STARK che
             fa di più del CLI proprio su una difesa. La via vera è cambiare
             modalità, ed è quella che il bottone offre. -->
        {#if part.blocked === 'classifier'}
          <div class="blocknote">
            <div class="bn1">Auto mode stopped this. It is not a failure, and not a question for you.</div>
            <ul>
              <li>The agent can try another way — that is what it was told to do.</li>
              <li>Reading files and searching still work: they never go through the classifier.</li>
              <li>You can come back to this later.</li>
            </ul>
            <!-- La spiegazione vale sempre, il bottone no: cambiare modalità è un comando
                 a un processo, e su una chat che dorme non c'è nessuno a riceverlo. Su
                 una conversazione riletta dal journal resta comunque giusto sapere
                 **perché** quell'azione non è avvenuta — è la domanda che ci si fa
                 rileggendo, mesi dopo, un lavoro che si era fermato. -->
            {#if live}
              <div class="bn2">
                To decide these yourself instead of leaving them to auto mode, switch this chat to
                <b>ask me</b>. It applies from now on, so you will need to ask again for this one.
              </div>
              <button class="btn" onclick={() => void store.setMode('default', id)}>
                Switch to «ask me»
              </button>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- I file toccati da questa chiamata, dove sono stati toccati. Lo stesso file
           può comparire più volte nel turno: sono modifiche avvenute in momenti
           diversi, e in mezzo l'agent ha fatto altro. -->
      {#each editsOf(part.callId) as edit (edit.ts)}
        <FileBlock edits={[edit]} narrow={store.narrow} {store} />
      {/each}
    {/if}
  {/snippet}

  <!-- L'operazione in corso, ridotta a icona e testo: sta in testa alla pill del
       gruppo («ops · notes · duration»), non in un blocco suo. Per un comando bash che
       ha sia descrizione sia comando si mostra solo la descrizione (`intent`): è ciò
       che l'agent ha scritto per dire *perché*, e il comando esatto resta nel
       dettaglio quando il gruppo si apre. -->
  {#snippet liveTag(part: OpPart)}
    {#if part.kind === 'reasoning'}
      <Icon name="i-brain" />
      <span class="m live">Thinking</span>
    {:else}
      <Icon name={toolIcon(part.name)} />
      <span class="m live">{part.intent ?? subject(part)}</span>
    {/if}
  {/snippet}

  <div class="scroller conv" bind:this={scrollerEl} onscroll={onScroll}
    style="--th-h:{thH}px">
    {#each chapters as ch (ch.key)}
    {#if ch.clearedAt !== undefined}
      <!-- La riga che tiene chiuso tutto ciò che c'era prima del `/clear`. Ha le due
           stanghette della compattazione perché è lo stesso genere di fatto — un
           taglio nel flusso, non un blocco dentro il flusso — ma qui si apre, e
           quello che c'è sotto sono turni interi, non una nota. -->
      <button class="cleared" class:open={openedChapters.has(ch.key)}
        onclick={() => toggleChapter(ch.key)}
        title="The context was reset here: nothing above is still in the model's memory">
        <span class="l"></span>
        <span class="t">
          <span class="cx chev" class:open={openedChapters.has(ch.key)}><Icon name="i-fwd" style="width:9px;height:9px" /></span>
          Context cleared · {chapterTurns(ch)} {chapterTurns(ch) === 1 ? 'turn' : 'turns'} before
          · {hhmm(ch.clearedAt)}
        </span>
        <span class="l"></span>
      </button>
    {/if}
    {#if ch.clearedAt === undefined || openedChapters.has(ch.key)}
    <!-- Riaperto, il capitolo resta **riconoscibile come passato**: rientrato e con una
         riga di lato. Senza, quei turni tornerebbero identici a quelli veri, e sarebbe
         di nuovo impossibile vedere a occhio dove il contesto smette di valere — che è
         il motivo per cui esiste tutto questo. -->
    <!-- `live` è il capitolo corrente quando sopra di lui c'è almeno un taglio: è quello
         che si prende **tutta** l'altezza dello scroller, così i «Context cleared» finiscono
         sopra il bordo e si vedono solo risalendo. Vedi `.chapter.live` nel CSS. -->
    <div class="chapter" class:past={ch.clearedAt !== undefined}
      class:live={ch.clearedAt === undefined && chapters.length > 1}>
    {#if ch.items.length === 0}
      <!-- Il capitolo vivo esiste ma è ancora vuoto: hai appena dato `/clear` e non hai
           più scritto niente. Senza questa riga la schermata sarebbe **deserta** — i
           tagli stanno sopra il bordo — e una schermata vuota si legge come un guasto,
           non come «il contesto è vuoto». È anche l'unico posto in cui va detto che
           sopra c'è ancora tutto: quando un turno c'è, è il turno stesso a dire dove
           sei, e qui non c'è niente a dirlo. -->
      <div class="mid">The context is empty from here. Scroll up for what came before.</div>
    {/if}
    {#each ch.items as { turn, i } (turn.turnId)}
      {@const open = isOpen(turn, i)}
      {@const status = turnStatus(snap.turns, i)}
      {@const groups = groupParts(turn.parts)}
      {@const opLive = livePart(groups)}
      {@const doneTail = lastDoneKey(groups)}
      {#if dayBanners.has(turn.turnId)}
        <div class="daysep" role="separator" aria-label={dayBanners.get(turn.turnId)}>
          <span>{dayBanners.get(turn.turnId)}</span>
        </div>
      {/if}
      {#if i === snap.turns.length - 1 && snap.turns.length > 1}
        <!-- Un filo sottile prima dell'ULTIMO turno: gli ultimi due messaggi si
             confondevano, e la domanda che torna è «quale dei due è quello nuovo».
             Un filo e non un bordo grosso: è un riferimento, non un titolo. Scompare
             da solo su una chat con un turno solo — un separatore sopra il primo
             messaggio segna un confine che non c'è. -->
        <div class="turnsep" aria-hidden="true"></div>
      {/if}
      <div class="turn" data-turn={turn.turnId}
        class:open class:active={status === 'active'} class:queued={status === 'queued'}>
        <!-- Il contenitore è un `div` e non più il bottone stesso: dentro ce ne stanno
             due, e un bottone dentro un bottone non è HTML valido. È la stessa forma di
             `.oprow`, dove la riga del tool e la lente per il file sono fratelli. -->
        <div class="th" use:misuraTh>
          <button class="thmain" onclick={() => toggle(turn, i)} title={promptOf(turn)}>
            {#if status === 'queued'}<span class="qtag">queue</span>{/if}
            <span class="q">{@html decoraColoriTesto(promptOf(turn))}</span>
          </button>
          <button class="thmore" title="Show the full prompt"
            aria-label="Show the full prompt"
            onclick={() => { promptAperto = promptOf(turn) }}>…</button>
          {#if status === 'queued'}
            <!-- Togli dalla fila. Esiste solo qui perché solo qui ha un senso: un
                 turno già consegnato non si richiama. L'esito non si tocca a mano —
                 il `turn.ended` che l'adapter scrive arriva dal flusso e il turno
                 smette di essere «queued» da solo. -->
            <button class="thdel" title="Remove from queue"
              aria-label="Remove from queue"
              onclick={() => void store.dequeue(turn.turnId)}>
              <Icon name="i-x" style="width:10px;height:10px" />
            </button>
          {/if}
          <span class="tm">{timeOnly(turn.startedAt)}</span>
          <button class="thacc" aria-label="Toggle turn" onclick={() => toggle(turn, i)}>
            <span class="cx chev" class:open={open}><Icon name="i-fwd" style="width:9px;height:9px" /></span>
          </button>
        </div>

        {#if open}
          <div class="tb">
            {#if immaginiOf(turn).length > 0}
              <!-- Quello che gli hai fatto vedere, sopra a tutto: è la prima cosa che
                   il modello ha avuto davanti, e riaprendo due giorni dopo è la prima
                   che serve per capire di cosa si stava parlando. -->
              <div class="pimgs">
                {#each immaginiOf(turn) as img (img.ref)}
                  {#if persi.has(img.ref)}
                    <!-- Il file non c'è più: cancellato a mano, o un journal arrivato
                         da un'altra macchina senza la sua cartella di allegati. Dirlo
                         è meglio dell'icona di immagine rotta, che sembra un guasto
                         di STARK invece di un file che manca. -->
                    <span class="persa" title={img.name ?? 'image'}>
                      <Icon name="i-warn" />
                      {img.name ?? 'image'} — not on this machine
                    </span>
                  {:else}
                    <a href={`/api/sessions/${snap.sessionId}/blob/${img.ref}`}
                      target="_blank" rel="noreferrer" title={img.name ?? 'image'}>
                      <img src={`/api/sessions/${snap.sessionId}/blob/${img.ref}`}
                        alt={img.name ?? 'attachment'}
                        onerror={() => { persi = new SvelteSet([...persi, img.ref]) }} />
                    </a>
                  {/if}
                {/each}
              </div>
            {/if}
            {#if fileOf(turn).length > 0}
              <!-- Stessa ragione delle immagini qui sopra, senza l'anteprima: un PDF
                   non si guarda da 96px. Il link lo apre con l'applicazione del
                   browser, che è ciò che serve per rileggerlo davvero. -->
              <div class="pfiles">
                {#each fileOf(turn) as f (f.ref)}
                  <a class="pfile" href={`/api/sessions/${snap.sessionId}/blob/${f.ref}`}
                    target="_blank" rel="noreferrer" title={f.name ?? f.mediaType}>
                    <Icon name="i-file" />
                    <span class="n">{f.name ?? f.mediaType}</span>
                    <span class="b">{peso(f.bytes)}</span>
                  </a>
                {/each}
              </div>
            {/if}
            {#each groups as g (g.key)}
              {#if g.kind === 'solo'}
                {@const part = g.part}
                {#if part.kind === 'text'}
                  <!-- Sempre per intero: è l'unica cosa scritta per l'utente, e in
                       Markdown — è quello che il CLI stesso rende. Evidenziato se è
                       l'ultima cosa detta e finisce con un punto di domanda: è quello
                       che si perde più facilmente in un muro di testo. -->
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <!-- L'onclick qui sotto è delegazione, non un div-bottone: il div
                       resta testo normale, leggibile come sempre. Il click che
                       intercetta è dei `<button data-copy>` che `renderMarkdown`
                       disegna dentro — un bottone vero, già raggiungibile da tastiera,
                       il cui click nativo (anche quello sintetizzato da Invio/Spazio)
                       risale fin qui da solo. Un secondo handler qui sopra
                       aggiungerebbe rumore, non accessibilità. -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- L'evidenza ambra va sul PARAGRAFO che contiene la domanda,
                       non su tutto il blocco (bug B1): `renderMarkdown` la mette
                       sull'ultimo elemento del testo reso, non sul contenitore. -->
                  <div class="prose"
                    onclick={onProseClick}>{@html renderMarkdown(part.text, { asked: isOpenQuestion(i, part) })}</div>

                {:else if part.kind === 'compact'}
                  <!-- Una riga che taglia il flusso, perché è esattamente quello che è
                       successo: sopra, il modello non ha più i messaggi per intero ma un
                       riassunto. È la spiegazione di metà delle volte in cui sembra aver
                       dimenticato qualcosa, e nasconderla lascerebbe quel «sembra». -->
                  <div class="compact">
                    <span class="l"></span>
                    <span class="t">
                      Context compacted{#if part.trigger === 'manual'}, because you asked{:else if part.trigger === 'auto'}, it had filled up{/if}
                      {#if part.after !== undefined}
                        · {kilo(part.before)} → {kilo(part.after)} tokens
                      {:else}
                        · {kilo(part.before)} tokens before
                      {/if}
                    </span>
                    <span class="l"></span>
                  </div>

                {:else if part.kind === 'retry'}
                  <!-- Il modello non ha risposto e l'agent riprova. Sta nel flusso e non
                       nell'intestazione perché è successo **lì**: è la spiegazione della
                       pausa che si vede sopra. Senza questa riga, un turno che riprova
                       tre volte e uno che parte al primo colpo sono identici a schermo —
                       e non sono la stessa cosa. -->
                  <div class="compact">
                    <span class="l"></span>
                    <span class="t" title={part.reason}>
                      <!-- `&nbsp;` e non uno spazio normale: Svelte **taglia** lo spazio
                           iniziale dentro un blocco, e si leggeva «attempt 1· Provider»
                           attaccato. Stessa trappola già registrata per la barra. -->
                      Retried · attempt {part.attempt}{#if part.reason}&nbsp;· {part.reason}{/if}
                    </span>
                    <span class="l"></span>
                  </div>

                {:else if part.kind === 'answer'}
                  <!-- La richiesta non è passata di qui: si era espanso il blocco in
                       basso. Ciò che resta nel flusso è cosa hai risposto, dove è
                       successo, così che due giorni dopo si capisca cosa si era deciso. -->
                  {#if part.of === 'plan'}
                    <!-- Il piano approvato è l'unica «risposta» che vale la pena
                         rileggere per intero: è il documento su cui l'agent ha
                         lavorato da lì in poi, e nel journal non è scritto da
                         nessun'altra parte. Quindi non è una riga con un testo
                         tagliato, è un blocco che si apre — chiuso di default come
                         tutto il resto, perché una volta approvato lo si rilegge
                         solo quando ci si chiede *perché* ha fatto in quel modo. -->
                    {@const pkey = `plan:${part.partId}`}
                    {@const popen = blockOpen(pkey)}
                    <button class="row clickable answer" onclick={() => toggleBlock(pkey)}>
                      <Icon name="i-doc" />
                      <span class="k">You</span>
                      <span class="v">{part.refused ? 'sent the plan back' : 'approved the plan'}</span>
                      <span class="end" class:no={part.refused} style="display:inline-flex;align-items:center;gap:4px">
                        {part.answer}
                        <span class="chev" class:open={popen}><Icon name="i-fwd" style="width:9px;height:9px" /></span>
                      </span>
                    </button>
                    {#if popen}
                      <div class="planread">{@html renderMarkdown(part.asked)}</div>
                    {/if}
                  {:else if part.items && part.items.length > 0}
                    <!-- Le domande erano più d'una, ed erano domande diverse: una riga
                         sola con le risposte incollate da `·` costringeva a indovinare
                         quale stesse a quale. Qui ogni domanda si porta dietro la
                         propria risposta, nell'ordine in cui sono state lette. -->
                    <div class="answers">
                      <div class="ah">
                        <Icon name="i-ask" />
                        <span class="k">You answered</span>
                        {#if part.items.length > 1}
                          <span class="end">{part.items.length} questions</span>
                        {/if}
                      </div>
                      {#each part.items as it, n (it.asked)}
                        <div class="aq">
                          <span class="n">{n + 1}</span>
                          <span class="q" title={it.asked}>{it.asked}</span>
                          <!-- Una domanda saltata non inventa un trattino: dice che
                               non è stata risposta, che è un fatto diverso. -->
                          <span class="a">{it.answer || 'left unanswered'}</span>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="row answer">
                      <Icon name={part.of === 'question' ? 'i-ask' : 'i-shield'} />
                      <span class="k">You</span>
                      <span class="v">{part.asked}</span>
                      <!-- Nessun rosso: aver detto di no non è un fallimento, è una
                           decisione. Il rosso qui la farebbe leggere come qualcosa
                           andato storto, e la prossima volta si esiterebbe a dirlo. -->
                      <span class="end" class:no={part.refused}>{part.answer}</span>
                    </div>
                  {/if}
                {/if}
              {:else if g.kind === 'done'}
                <!-- Finite, e accorpate: il *come* non serve più una volta che il
                     *cosa* è successo, a meno che non lo si chieda apposta. Ogni
                     gruppo sta al suo posto cronologico — è lì che è successo. -->
                {@const gkey = g.key}
                {@const gopen = blockOpen(gkey)}
                {@const c = conta(g.parts)}
                {@const nOps = c.ops}
                {@const nNote = c.note}
                <button class="row clickable ops" class:pin={gopen} onclick={() => toggleBlock(gkey)}>
                  <span class="ops-meta">
                    {#if g.key === doneTail && opLive}
                      {@render liveTag(opLive)}
                      <span class="dot">·</span>
                    {/if}
                    <span class="m">{nOps} ops</span>
                    <span class="dot">·</span>
                    <span class="m">{nNote} notes</span>
                    <span class="dot">·</span>
                    <span class="m">{#if turn.endedAt}{since(turn.startedAt, turn.endedAt)}{:else}…{/if}</span>
                  </span>
                  <span class="end chev" class:open={gopen}><Icon name="i-fwd" style="width:9px;height:9px" /></span>
                </button>
                {#if gopen}
                  <div class="opgroup">
                    {#each g.parts as part (keyOf(part))}
                      {#if part.kind === 'text'}
                        <!-- La narrazione al suo posto cronologico, in tono minore:
                             è la didascalia di ciò che le sta sotto, non una risposta.
                             Stesso Markdown di ogni altro testo — dentro ci finiscono
                             `codice` e liste, e renderlo grezzo qui lo farebbe leggere
                             peggio proprio dove si è aperto per capire cos'è successo. -->
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div class="prose note" onclick={onProseClick}>{@html renderMarkdown(part.text)}</div>
                      {:else if part.kind === 'tool' || part.kind === 'reasoning'}
                        {@render opRow(part)}
                      {/if}
                    {/each}
                  </div>
                {/if}
              {/if}
            {/each}

            {#if turn.ended && turn.reason !== 'completed'}
              <div class="row bad">
                <Icon name="i-warn" /><span class="k">Turn {turn.reason}</span>
                {#if turn.detail}<span class="v plain">{turn.detail}</span>{/if}
              </div>
            {/if}

            {#if opLive && doneTail === undefined}
              <!-- Il turno è appena partito e non c'è ancora un gruppo di lavoro
                   finito: l'operazione in corso sta da sola, nella stessa pill che
                   altrimenti riassumerebbe «ops · notes · duration». -->
              <div class="row ops">
                <span class="ops-meta">{@render liveTag(opLive)}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
    </div>
    {/if}
    {/each}

    {#if snap.turns.length === 0}
      <div class="mid">Nothing has happened in this chat yet. Write the first message below.</div>
    {/if}
  </div>

  <!-- La via di ritorno al fondo, quando si è risaliti a leggere.
       Compare **solo** quando la conversazione ha smesso di seguire, cioè quando ce n'è
       bisogno: un bottone che c'è sempre non direbbe niente, e qui il fatto che appaia è
       già l'informazione — «da qui in giù c'è roba che non stai vedendo».
       Sta fuori dallo scroller, in un contenitore alto **zero** appoggiato sopra il
       blocco di scrittura: così galleggia sulla conversazione senza rubarle spazio e
       senza che nessuno debba sapere quanto è alto il blocco sotto, che cambia con la
       casella, gli allegati e i comandi slash. -->
  <div class="tofoot">
    {#if !stick}
      <button class="downb" onclick={toFoot}
        title="Jump to the newest" aria-label="Jump to the newest">
        <Icon name="i-down" />
      </button>
    {/if}
  </div>

  <Dock {store} {snap} {live} {id} />
</div>

<!-- Il prompt per intero. Stesso riquadro di ogni altra finestra dell'app — `.dlg` ha
     già il tetto di larghezza e altezza, quindi da telefono non esce dallo schermo e su
     un prompt lungo scorre invece di allungarsi. Il testo sta in un `pre`: un prompt
     porta a capo, rientri ed elenchi, e riflowarlo come un paragrafo cambierebbe la
     cosa che si è aperto il pannello per rileggere. -->
{#if promptAperto !== null}
  <div class="scrim" role="presentation" onclick={() => { promptAperto = null }}></div>
  <div class="dlg" style="width:520px">
    <div class="dlgh">
      <div class="dt">Your prompt</div>
      <div class="dlgacts">
        <button class="copyp" aria-label="Copy prompt" onclick={copiaPrompt}>
          <Icon name="i-copy" /><span>Copy</span>
        </button>
        <button class="x" aria-label="Close" onclick={() => { promptAperto = null }}>
          <Icon name="i-x" />
        </button>
      </div>
    </div>
    <div class="dlgb">
      <!-- Le citazioni con `@` diventano premibili **qui** e non nella riga del turno,
           e la ragione è strutturale, non estetica: quella riga *è* un bottone (apre il
           turno), e un bottone dentro un bottone non è HTML valido — è scritto tre righe
           sopra di essa, e ci sono cascato lo stesso. Qui invece il prompt sta per conto
           suo, ed è anche il posto giusto: la riga serve a **riconoscere** il turno,
           questa finestra a **rileggerlo**, e agire appartiene alla seconda.
           Si riconoscono dalla `@` e solo da quella: è una citazione dichiarata, scelta
           da un menu che il CLI ha riempito, non una somiglianza tipografica — quindi
           non serve chiedere al daemon se esiste, lo sapeva già chi l'ha scritta. -->
      <pre class="fullp">{#each pezziConCitazioni(promptAperto) as pz}{#if pz.cita}<button
        class="cita" title="Reveal in file manager: {pz.t}"
        onclick={() => void store.reveal(pz.t, snap.sessionId)}>@{pz.t}</button>{:else}{@html decoraColoriTesto(pz.t)}{/if}{/each}</pre>
    </div>
  </div>
{/if}

<svelte:document onkeydown={e => { if (e.key === 'Escape' && promptAperto !== null) promptAperto = null }} />

<style>
  /* I comandi in testa al popup «Your prompt»: copia e chiudi, raggruppati a destra.
     `.copyp` segue il vocabolario dei bottoni di copia dei blocchi codice — stessa
     icona, stesso gioco Copied/done — solo più piccolo, perché vive in un'intestazione. */
  .dlgacts{margin-left:auto;display:flex;align-items:center;gap:2px}
  .copyp{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:10px;
    color:var(--muted);background:none;border:0;border-radius:5px;padding:3px 6px;
    cursor:pointer;flex:none}
  .copyp svg.ic{width:11px;height:11px}
  .copyp:hover{background:var(--surface-2);color:var(--ink)}
  .copyp:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  .copyp.done{color:var(--done)}

  /* Il turno attivo (l'agent ci sta davvero lavorando) e quello in coda (dietro un
     altro ancora in corso) si distinguono col colore già usato per gli stessi stati
     altrove in STARK: blu = working, ambra = tocca aspettare. Il segno è la barretta
     `::before` in app.css (2px, una sola da cima a fondo, `--user` o `--wait`): le
     due `border-color` qui sotto erano morte — `.turn` ha `border:0` — e sembravano
     dire una cosa che non disegnavano. */
  .turn.queued .n { color: var(--wait); }
  /* L'etichetta «queue» in testa alla riga: giallo, maiuscoletto strette, la stessa
     voce che la barra laterale usa per gli stati (`gstate`). Sta nel bottone del
     prompt, non accanto: far parte del prompt la rende premibile con lui, e la
     `flex:none` impedisce all'ellissi del prompt di mangiarsela. */
  .qtag {
    flex: none; color: var(--wait); font-size: 9.5px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .08em;
  }

  /* Un blocco (reasoning, tool) si apre come il turno: stesso segno, stesso posto.
     È un <button>, quindi il colore e il fondo che `.row` dà a un <div> vanno
     ridichiarati: lo user agent li sovrascrive con lo stile di sistema dei controlli
     altrimenti — è lo stesso motivo per cui `.th` più sopra fa `color: inherit`. */
  .row.clickable {
    width: 100%; border: 0; text-align: left; cursor: pointer;
    background: var(--surface-2); color: inherit; font: inherit;
  }
  /* I singoli blocchi operations (reasoning, tool) non sono contenitori: niente
     pill, niente bordo, niente fondo — sono righe a tutta larghezza, e a separarle
     è il solo gap del gruppo. L'unica cosa che porta un fondo qui dentro è il testo
     monospace, che si legge come un tag `code`: fondo scuro e lilla. Ciò che è una
     frase resta sul fondo della riga, nel font della UI. */
  .row.clickable.think,
  .row.clickable.tool {
    border: 0; border-radius: 0; background: none; color: var(--muted); font-size: 11px;
  }
  .row.clickable.think { display: flex; align-items: center; gap: 5px; }
  /* La riga di un tool era un `<button class="row">` flex diretto; ora il flex sta
     su `.rtop` dentro di lui, per poter aggiungere sotto — solo quando c'è una
     motivazione (F2) — una seconda riga più piccola col comando esatto. Senza
     motivazione `.rtop` è tutto ciò che il bottone contiene: identica a prima. */
  .row.clickable.tool { display: block; }
  .row.clickable.tool .rtop { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .row.clickable.tool .rtop .v { min-width: 0; }
  .row.clickable.tool .rsub {
    display: inline-block; max-width: 100%; vertical-align: top;
    margin: 2px 0 0 21px;
    font-family: var(--mono); font-size: 9px;
    color: var(--code); background: var(--code-bg);
    padding: 1px 5px; border-radius: 5px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Gli stati di un tool restano segnali di colore sul testo della riga — un
     fallimento è rosso, un'azione fermata dal classificatore ambra — ma senza
     fondo: la riga è testo, non un riquadro. */
  .row.clickable.bad { color: var(--stop); }
  .row.clickable.block { color: var(--wait); }
  /* Il testo monospace dentro le righe operations si legge come un tag `code`:
     JetBrains Mono e i due token `--code`/`--code-bg` (lilla su notte in scuro,
     chip su carta in chiaro), con lo stesso piccolo padding e angolo. Vale SOLO
     per il codice — soggetto, percorso, comando — e non per la motivazione (F2),
     che è una frase e resta sul fondo della riga. */
  .row.clickable.think .v:not(.plain),
  .row.clickable.tool .rtop .v:not(.plain) {
    font-family: var(--mono); font-size: 10px;
    color: var(--code); background: var(--code-bg);
    padding: 1px 5px; border-radius: 5px;
  }
  .row .v.plain { font-family: var(--sans); color: var(--ink-2); }

  /* F3: il bottone che arriva al file, accanto alla riga del tool. `.oprow` senza
     `.withreveal` non cambia niente — è il caso normale, senza percorso da rivelare
     — quindi non tocca il disegno di ogni altra riga. È un controllo tondo e
     leggero: sta a fianco della riga, che ora è a tutta larghezza, quindi la lente
     finisce al bordo destro del turno. */
  .oprow.withreveal { display: flex; align-items: center; gap: 6px; }
  .oprow .reveal {
    flex: none; border: 1px solid var(--line-2); border-radius: 50%;
    background: none; color: var(--muted); width: 26px; height: 26px;
    padding: 0; cursor: pointer; display: inline-flex; align-items: center;
    justify-content: center;
  }
  .oprow .reveal :global(svg) { width: 12px; height: 12px; }
  .oprow .reveal:hover { color: var(--ink); background: var(--surface-2); }
  .oprow .reveal:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Il gruppo di operazioni finite: una pill arrotondata con bordo sottile,
     non più una riga a tutta larghezza. Testo "X ops · Y notes · MMm SSs"
     separato da dot, con chevron per aprire/chiudere. Allineata a sinistra
     nel corpo del turno (22px) e rientrata rispetto al prompt (12px). */
  .row.ops { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line-2); border-radius: 20px; padding: 5px 12px; margin: 0; color: var(--muted); font-size: 11px; background: none; align-self: flex-start; }
  .row.ops .ops-meta { display: flex; align-items: center; gap: 6px; justify-content: flex-start; }
  .row.ops .ops-meta .m { flex: none; text-align: left; font-weight: 400; font-size: 11px; color: var(--muted); }
  .row.ops .ops-meta .dot { flex: none; color: var(--muted); opacity: .5; font-size: 11px; line-height: 1; }
  /* L'operazione in corso, in testa alla riga: icona piccola e testo un filo più
     scuro del resto, perché è la cosa che sta succedendo *adesso* mentre il resto
     della riga è già passato. */
  .row.ops .ops-meta :global(svg.ic) { width: 11px; height: 11px; }
  .row.ops .ops-meta .m.live { color: var(--ink-2); font-weight: 500; }
  .row.ops .end { color: var(--muted); font-size: 11px; flex: none; display: inline-flex; align-items: center; }
  .row.clickable.ops { background: none; align-self: flex-start; }
  /* Il gruppo aperto resta richiudibile da dove si è: la pill si appiccica sotto
     l'intestazione del turno — già sticky lei a `top:0` — e da lì si richiude
     senza risalire a mano tutto il blocco. L'offset è l'altezza dell'header
     misurata dall'azione `misuraTh` (`--th-h`, in unità locali del root zoomato):
     a mano sarebbe stato un numero che cade alla prima modifica dei suoi 33px.
     Diviso per `--conv-body-zoom` perché questa pill vive dentro `.tb`, che ha un
     secondo zoom — quello di «Chat text» in Settings — che l'header non ha: un
     `top` in unità locali di `.tb` rende `× zoomRoot × conv-body-zoom` pixel veri,
     e l'header ne vale solo `× zoomRoot`. Senza la divisione la pill scivolerebbe
     sempre più giù dell'header a ogni scatto di «Chat text» sopra 100%.
     Vale solo da aperto: da chiuso la pill è una riga sola al suo posto, e non
     c'è nulla da richiudere. Il fondo opaco copre il contenuto che le scorre
     dietro — ed è lo stesso colore che le sta dietro anche da ferma, quindi
     a riposo non si vede. Due gruppi aperti nello stesso turno si sovrapporrebbero
     alla stessa quota: l'ultimo disegnato copre il primo, ed è il compromesso
     accettato — il caso comune è un gruppo aperto per turno. */
  .row.ops.pin {
    position: sticky; top: calc(var(--th-h, 34px) / var(--conv-body-zoom, 1)); z-index: 1;
    background: var(--surface);
  }
  .opgroup {
    display: flex; flex-direction: column; gap: 1px; margin: 2px 0 6px 8px;
    padding-left: 8px; border-left: 2px solid var(--line-2);
  }
  /* La narrazione dentro il gruppo. Stesso testo di sempre, tono minore: è la
     didascalia delle righe che le stanno sotto, e messa allo stesso peso della
     risposta finale tornerebbe a competere con lei, che è la ragione per cui il
     gruppo esiste. Nessun bordo suo: a delimitare il gruppo è già la barretta
     complessiva del blocco espanso, e una seconda sotto ogni nota la raddoppia
     senza aggiungere niente. */
  .opgroup .prose.note {
    font-size: .92em; color: var(--muted);
    margin: 2px 0 4px;
  }
  .opgroup .prose.note :global(p) { margin: .3em 0; }
  .opgroup .prose.note :global(h1),
  .opgroup .prose.note :global(h2),
  .opgroup .prose.note :global(h3) { font-size: 1em; margin: .4em 0 .2em; }
  .row.clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .chev { display: inline-flex; transition: transform .15s; }
  .chev.open { transform: rotate(90deg); }
  .blockbody {
    white-space: pre-wrap; word-break: break-word; font-family: var(--mono);
    font-size: 10.5px; color: var(--code); background: var(--code-bg);
    border: 1px solid var(--line-2); border-radius: 7px; padding: 7px 9px;
    margin: 2px 0 6px; max-height: 360px; overflow: auto;
  }
  .bblabel {
    font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: var(--muted); margin: 6px 0 2px;
  }
  .bblabel:first-child { margin-top: 0; }
  .bblabel.err { color: var(--stop); }

  /* La risposta che finisce con un punto di domanda: è quella che si perde più
     facilmente in un muro di testo, e per questo prende lo stesso ambra di ogni
     altro «tocca a te». Sul **paragrafo finale**, non su tutto il blocco (bug B1) —
     `markAsked` in `markdown.ts` marca l'ultimo elemento reso, qualunque tag sia; i
     margini di quel tag sono già `0` in alto (vedi le regole sopra), quindi non
     serve toglierne uno che non c'è. */
  .prose :global(.asked) {
    background: var(--wait-bg); color: var(--ink);
    border: 1px solid var(--wait); border-radius: 8px; padding: 8px 10px; font-weight: 600;
  }

  /* La riga della compattazione: un taglio, non un blocco. */
  .compact { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
  .compact .l { flex: 1; height: 1px; background: var(--line-2); }
  .compact .t { font-size: 9.5px; color: var(--muted); white-space: nowrap; }

  /* Il capitolo chiuso da un `/clear`. Stessa grammatica della compattazione — due
     stanghette e il fatto in mezzo — ma è un bottone: quello che tiene chiuso non è
     una nota, sono turni interi, e vanno poter riaperti. Più marcato della riga di
     compattazione (stanghette continue, testo non spento) perché il taglio è più
     netto: lì resta un riassunto, qui non resta niente. */
  .cleared {
    display: flex; align-items: center; gap: 8px; width: 100%;
    margin: 10px 0; padding: 0; background: none; border: 0; cursor: pointer;
    font: inherit; color: inherit;
  }
  /* Due tagli di fila non sono due fatti da separare: sono la stessa cosa ripetuta, e
     l'aria in mezzo la stava trattando come se in mezzo ci fosse qualcosa. Fra due
     righe consecutive resta il solo `gap` di `.conv` (8px); il margine serve a
     staccarle dai turni, non fra loro. In un flex i margini **non** collassano —
     quindi vanno azzerati da tutte e due le parti, e non basta il `+`. */
  .cleared + .cleared { margin-top: 0; }
  .cleared:has(+ .cleared) { margin-bottom: 0; }
  .cleared .l { flex: 1; height: 1px; background: var(--line-2); }
  .cleared .t {
    font-size: 10.5px; color: var(--muted); white-space: nowrap;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .cleared .cx { font-size: 9px; opacity: .7; }
  .cleared:hover .t { color: var(--ink); }
  .cleared:hover .l { background: var(--muted); }
  /* Aperto, il capitolo è un contenitore: la riga diventa la sua intestazione e i
     turni che seguono sono suoi, quindi il margine sotto si stringe. */
  .cleared.open { margin-bottom: 6px; }

  /* Il lampo su un turno raggiunto dalla ricerca. Dura e sparisce: dice «è questo» a
     chi è appena arrivato, e da lì in poi sarebbe un colore senza significato su una
     riga come le altre. `outline` e non `border`: un bordo cambierebbe la geometria
     del turno, e col prompt appiccicato in cima lo si vedrebbe saltare. */
  /* Il resoconto di un lavoro finito da sé. Su più righe di proposito — è prosa, non
     un'etichetta — ma con un tetto: un sub-agent può scrivere venti righe, e venti
     righe dentro una riga di elenco non sono più una riga di elenco. */
  .tsum {
    margin: 3px 0 0 21px; font-size: 11px; line-height: 1.4; color: var(--muted);
    border-left: 2px solid var(--line); padding-left: 8px;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical;
    overflow: hidden; text-align: left; white-space: normal;
  }
  .tsum.bad { border-left-color: var(--stop); }

  /* Il piano riaperto dal flusso. Rientrato come il corpo di un blocco aperto, e
     senza tetto d'altezza: qui non c'è niente sotto da spingere fuori — a differenza
     del blocco in basso, dove sotto ci sono i bottoni con cui si approva. */
  .planread {
    margin: 2px 0 4px 22px; padding: 4px 4px 4px 10px;
    border-left: 2px solid var(--line);
    font-size: 12px; line-height: 1.5; color: var(--ink);
  }
  .planread :global(h1), .planread :global(h2), .planread :global(h3) {
    font-size: 12.5px; margin: 8px 0 3px;
  }
  .planread :global(p), .planread :global(ul), .planread :global(ol) { margin: 3px 0; }

  .turn.found { outline: 2px solid var(--accent); outline-offset: -1px; }
  .turn { transition: outline-color .4s; }

  /* Il filo fra penultimo e ultimo turno: una riga spenta, più corta del capitolo —
     un riferimento da leggere in un colpo d'occhio, non una regola che attraversa
     tutto. Spazio uguale sopra e sotto: sta a metà fra i due messaggi, non attaccata
     a nessuno dei due. */
  .turnsep { height: 1px; background: var(--line); margin: 6px 8px; flex: none; }

  /* Il bannerino di giornata, come WhatsApp: al centro, sopra il primo messaggio del
     giorno. Sostituisce la data ripetuta su ogni riga (`.tm` mostra solo l'orario). */
  .daysep { display: flex; justify-content: center; margin: 10px 0 6px; }
  .daysep span {
    font-size: 10px; font-weight: 600; color: var(--muted);
    background: var(--surface-2); border-radius: 999px; padding: 3px 10px;
  }

  /* `.conv` è una colonna flex con `gap: 8px`: il capitolo la interrompe, quindi se la
     rifà uguale dentro di sé — senza, i turni si incollerebbero fra loro. */
  /* Alto zero e `flex:none`: in una colonna flex non occupa una riga propria, quindi
     non sposta di un pixel né la conversazione né il blocco di scrittura. È solo il
     riferimento da cui il bottone si stacca verso l'alto. */
  .tofoot { position: relative; height: 0; flex: none; z-index: 4; }
  .downb {
    position: absolute; right: 16px; bottom: 10px;
    width: 30px; height: 30px; border-radius: 50%;
    display: grid; place-items: center; cursor: pointer;
    background: var(--surface); color: var(--ink-2);
    border: 1px solid var(--line-2);
    /* L'ombra non è decorazione: il bottone sta **sopra** del testo, e senza uno stacco
       si leggerebbe come parte della conversazione invece che come un comando. */
    box-shadow: 0 4px 14px rgba(16, 20, 32, .18);
  }
  .downb:hover { color: var(--ink); background: var(--surface-2); }
  .downb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .chapter { display: flex; flex-direction: column; gap: 8px; flex: none; }
  /* Il capitolo vivo è alto **almeno quanto lo scroller**, ed è tutto il meccanismo del
     «nascosti sopra»: la conversazione parte già in fondo (vedi l'auto-scroll), quindi
     con il capitolo corrente che riempie da solo la vista, tutto ciò che lo precede —
     i tagli e i capitoli richiusi — sta sopra il bordo superiore. Non è nascosto: è
     **più in alto**, e si risale a prenderlo come su WhatsApp o Telegram.
     Perché `min-height: 100%` e non `flex-grow`: crescere distribuisce lo spazio
     *avanzato*, quindi si fermerebbe a riempire la vista senza mai sfondarla — niente
     spazio da scorrere, e le righe resterebbero in vista. Il 100% invece è alto quanto
     il **content box** dello scroller a prescindere da ciò che c'è sopra, che quindi
     eccede e diventa scorrimento. Il content box esclude i 12px di padding in basso di
     `.conv`, ed è quello che fa cadere l'inizio del capitolo esattamente sul bordo
     invece che dodici pixel sopra. */
  .chapter.live { min-height: 100%; }
  .chapter.past {
    padding-left: 12px; border-left: 2px solid var(--line);
    margin-left: 2px; opacity: .72;
  }
  .chapter.past:hover { opacity: 1; }

  /* Le immagini mandate col prompt: piccole, perché sono un promemoria di cosa hai
     mandato, non la cosa da guardare. Un clic le apre a grandezza vera. */
  .pimgs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .pimgs img {
    max-height: 96px; max-width: 220px; border-radius: 7px;
    border: 1px solid var(--line-2); display: block;
  }
  .pimgs a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pfiles { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .pfile {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px;
    border: 1px solid var(--line-2); border-radius: 7px; background: var(--surface-2);
    font-size: 10.5px; color: var(--ink-2); text-decoration: none; max-width: 260px;
  }
  .pfile:hover { border-color: var(--accent); color: var(--ink); }
  .pfile :global(svg) { width: 13px; height: 13px; flex: none; }
  .pfile .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pfile .b { color: var(--muted); flex: none; }
  .persa {
    display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px;
    border: 1px dashed var(--line-2); border-radius: 7px;
    font-size: 10px; color: var(--muted);
  }

  /* `.thmain` è quello che era `.th`: il bottone che apre e chiude. `.th` adesso è il
     contenitore che li tiene insieme e che si appiccica in cima. */
  .thmain, .thmore, .iconb, .effbtn { background: none; font: inherit; color: inherit; }
  .thmain {
    flex: 1; border: 0; text-align: left; padding: 0;
    display: flex; align-items: center; gap: 8px; min-width: 0; background: none; cursor: pointer;
  }
  .thacc {
    flex: none; border: 0; background: none; padding: 0 2px; cursor: pointer;
    color: var(--muted); font-size: 10px; display: flex; align-items: center;
  }
  .thacc:hover { color: var(--ink); }
  /* Il bottone del prompt intero. Piccolo e spento: è una seconda via, non l'azione
     principale della riga — quella resta aprire il turno. `flex:none` perché non ceda
     spazio quando il prompt è lungo, che è esattamente il caso in cui serve. */
  .thmore {
    flex: none; border: 0; padding: 0 4px; cursor: pointer;
    color: var(--muted); font-size: 13px; line-height: 1;
    align-self: stretch; display: flex; align-items: center;
  }
  .thmore:hover { color: var(--ink); }
  /* Togli dalla fila. Stessa forma della lente (`.thmore`): un secondo gesto sulla
     riga, non l'azione principale — quella resta aprire il turno. Compare solo sulle
     intestazioni dei turni in coda, e al passivo prende il `--stop` dello Stop: è
     quello stesso significato, ritirare un lavoro che non si vuole più far partire. */
  .thdel {
    flex: none; border: 0; background: none; padding: 0 4px; cursor: pointer;
    color: var(--muted); line-height: 1;
    align-self: stretch; display: flex; align-items: center;
  }
  .thdel:hover { color: var(--stop); }
  .thmain:focus-visible, .thmore:focus-visible, .thacc:focus-visible,
  .thdel:focus-visible,
  .iconb:focus-visible, .effbtn:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }
  /* Il prompt intero nel pannello: `pre` perché un prompt ha a capo e rientri, e
     riflowarlo cambierebbe la cosa che si è aperto il pannello per rileggere. */
  .fullp {
    margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
    font: inherit; font-size: 11.5px; line-height: 1.5; color: var(--ink);
  }
  .iconb[disabled] { opacity: .4; cursor: default; }
  /* Il testo ora è HTML vero (Markdown reso), non più righe grezze da preservare a
     mano: `pre-wrap` avrebbe reintrodotto righe vuote fra i blocchi che il browser
     ignorerebbe altrimenti da solo. Gli elementi che Markdown può produrre prendono
     uno stile minimo, coerente col resto di STARK — non è un foglio di stile a sé,
     è `.prose` che impara qualche tag in più. */
  .prose :global(p) { margin: 0 0 8px; white-space: pre-wrap; }
  .prose :global(p:last-child) { margin-bottom: 0; }
  .prose :global(ul), .prose :global(ol) { margin: 0 0 8px; padding-left: 20px; }
  .prose :global(li) { margin: 2px 0; }
  .prose :global(li > p) { margin: 0; }
  .prose :global(h1), .prose :global(h2), .prose :global(h3),
  .prose :global(h4), .prose :global(h5), .prose :global(h6) {
    color: var(--ink); font-weight: 700; margin: 12px 0 6px; line-height: 1.3;
  }
  .prose :global(h1) { font-size: 15px; } .prose :global(h2) { font-size: 13.5px; }
  .prose :global(h3), .prose :global(h4), .prose :global(h5), .prose :global(h6) { font-size: 12px; }
  .prose :global(:first-child) { margin-top: 0; }
  .prose :global(a) { color: var(--accent); text-decoration: underline; }
  .prose :global(code) { font-family: var(--mono); font-size: .92em; }
  /* Il blocco di codice — contenitore, barra, bottone «Copy» e `pre` — sta in
     `app.css` e non qui: `renderMarkdown` lo produce anche fuori da `.prose` (il
     pannello del piano, il piano riletto, l'helper), e uno stile scoped su un
     contenitore che non c'è sempre lasciava il bottone al default del browser. */

  /* Il bottone «Open in …» accanto a un link riconosciuto sta in `app.css` per la
     stessa ragione del blocco di codice: lo inietta `markdown.ts`, che gira anche
     fuori da `.prose`. */
  .prose :global(blockquote) {
    margin: 0 0 8px; padding: 2px 10px; border-left: 3px solid var(--line-2);
    color: var(--muted);
  }
  .prose :global(hr) { border: 0; border-top: 1px solid var(--line-2); margin: 10px 0; }
  .prose :global(table) {
    border-collapse: collapse; margin: 0 0 8px; font-size: 10.5px;
    display: block; max-width: 100%; overflow-x: auto;
  }
  .prose :global(th), .prose :global(td) {
    border: 1px solid var(--line-2); padding: 4px 8px; text-align: left;
  }
  .prose :global(th) { background: var(--surface-2); color: var(--ink); font-weight: 700; }
  .prose :global(strong) { color: var(--ink); }

  /* La barra è la maniglia con cui si sposta il pannello, ma solo quando i pannelli
     sono più d'uno (`draggable="true"`): con uno solo il cursore direbbe che si può
     fare una cosa che non porta da nessuna parte. I figli tengono il proprio cursore
     — il titolo resta `text` perché lì si rinomina, i bottoni restano `pointer`. */
  .bar[draggable='true'] { cursor: grab; }
  .bar[draggable='true']:active { cursor: grabbing; }
  .bar .t { border: 0; padding: 0; text-align: left; cursor: text; }
  .rn {
    font: inherit; font-size: 12.5px; font-weight: 600; flex: 1;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 6px;
    background: var(--surface); color: var(--ink); outline: none;
  }

  /* La risposta data non è né un successo né un errore: è una decisione, e si legge
     come tale. Il rosso resta per quelle negate. */
  /* Stesso blu-azzurro del blocco del prompt e di `.answers` in app.css: una
     domanda sola è la stessa categoria di cosa — l'utente che risponde —
     solo con un'unica riga invece del blocco a elenco. */
  .row.answer { background: var(--user-bg); }
  .row.answer .k { color: var(--user); }
  .row.answer .end { color: var(--ink-2); font-weight: 600; }
  .row.answer .end.no { color: var(--wait); }
</style>
