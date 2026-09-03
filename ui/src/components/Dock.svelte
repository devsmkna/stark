<script lang="ts">
  // Il blocco in basso: tutto ciò che si comanda sta qui, attorno alla casella.
  //
  // È sempre lo stesso pezzo di schermo in tre stati — mentre lavora dice cosa sta
  // facendo, quando ha bisogno di te si espande, e sotto c'è la riga che si preme.
  // Non è una disposizione comoda: è la conseguenza di non far comparire le richieste
  // in mezzo alla conversazione (vedi Ask.svelte).
  //
  // Dal design system del composer (v10) la riga è una sola: lead (+), campo, stop e
  // invio. La barra di stato che stava sotto non c'è più — modalità, MCP, modello,
  // percorso, ramo e consumo vivono nel menu del lead, e il consumo di contesto è
  // l'anello attorno al bottone stesso. Le decisioni su cui il DS taceva — costo solo
  // sulla riga Context (il piano non espone il costo delle finestre), MCP senza
  // sezioni né conteggi di tool (il dato non esiste nello snapshot), sweep al posto
  // della riga «cosa sta facendo» — stanno nei commenti, dove potranno essere
  // rimesse in discussione con le loro premesse.
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import Ask from './Ask.svelte'
  import ModelPicker from './ModelPicker.svelte'
  import type { SessionSnapshot } from '$core/reduce.ts'
  import type { SessionOption, Attachment, SlashCommand } from '$core/events.ts'
  import { optionsFrom } from '$core/adapter.ts'
  import {
    filtroFile, modelloInUso, nomiBrevi, parteDi, tipiAccettati, tipoDi,
  } from '$core/allegati.ts'
import { getLobeIconUrl, getProviderForModel, providerLabelFor, inputTypesOf } from '../lib/lobe.ts'
import { MODE_BLURB, MODE_ICON, project, stamp, until, fmtTok, fmtCosto } from '../lib/view.ts'
  import type { GitInfo } from '../lib/api.ts'
  import type { Store } from '../lib/store.svelte.ts'

  // `live` arriva da fuori e non da `live`: con più pannelli aperti «la chat a
  // fuoco» non è la chat di *questo* dock, e la nota «no process behind it» compariva
  // in tutti i pannelli appena una qualsiasi chat a fuoco era ferma.
  // `id` per la stessa ragione di `live`: con piu' pannelli aperti, «la chat a fuoco»
  // non e' quella di questo dock, e il ritorno del fuoco alla finestra deve riempire
  // una casella sola — quella del pannello a fuoco.
  let { store, snap, live, id }:
    { store: Store; snap: SessionSnapshot; live: boolean; id: string } = $props()

  let text = $state('')
  let box = $state<HTMLTextAreaElement | null>(null)
  let fileInput = $state<HTMLInputElement | null>(null)

  // Tutto ciò che è «in corso» è vero solo se dietro c'è un processo. Il journal di
  // una sessione fermata dal riavvio del daemon finisce a metà di un turno, e ripeterlo
  // alla lettera mostrerebbe una rotellina che gira su niente e una domanda a cui non
  // c'è più nessuno a rispondere — la bugia peggiore, perché è quella su cui si aspetta.
  const busy = $derived(live && (snap.state === 'busy' || snap.state === 'starting'))
  // Il terzo stato bloccante: un piano da approvare. Senza contarlo qui il blocco non
  // si espande, e `Ask.svelte` disegnerebbe in un contenitore alto zero.
  const pending = $derived(
    snap.pendingPermissions.length + snap.pendingQuestions.length + snap.pendingPlans.length > 0)
  const asking = $derived(live && pending)
  // La riga dell'elenco **di questo pannello**, non della chat a fuoco: è la riga
  // che il risveglio («Reopen») tocca. Col multi-pannello `store.row` sarebbe la
  // riga sbagliata — e risvegliare l'altra chat costa quota e non è mai stato chiesto.
  const rigaPannello = $derived(store.rows.find(r => r.id === id))

  /**
   * Tornando sulla finestra si riprende a scrivere da dove si era: il fuoco torna
   * nella casella del pannello a fuoco.
   *
   * Le due guardie non sono zelo. `store.selected === id` perche' con N pannelli
   * aperti ci sono N dock montati, e senza quella si contenderebbero il fuoco a
   * ogni ritorno sulla finestra. E si agisce solo se **nessuno** stava gia' a
   * fuoco (`body` o niente): chi torna con le impostazioni aperte, o dopo aver
   * lasciato il cursore nella ricerca, non vuole vederselo portare via.
   */
  $effect(() => {
    const onFocus = (): void => {
      if (store.selected !== id) return
      const a = document.activeElement
      if (a && a !== document.body) return
      box?.focus()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  })

  async function send(): Promise<void> {
    const draft = text
    const addosso = allegati
    if (!draft.trim() && addosso.length === 0) return
    // Si svuota subito: se il comando fosse rifiutato, il testo torna. Aspettare la
    // risposta per svuotare farebbe sembrare lenta una casella che non lo è.
    text = ''
    allegati = []
    await regrow()
    // Il prompt va alla chat **di questo pannello**, non a quella a fuoco: col
    // multi-pannello due dock sono montati insieme, e chi entra dalla tastiera
    // (Tab, poi Invio) non sposta il fuoco prima — il clic sì, e senza l'id
    // esplicito il prompt sarebbe partito per l'altra chat.
    const ok = await store.prompt(draft, addosso, id)
    if (!ok) { text = draft; allegati = addosso; await regrow() }
  }

  // ─── allegati ─────────────────────────────────────────────────────────────

  /** Quello che parte insieme al testo. Vuoto quasi sempre; non vuoto quando serve. */
  let allegati = $state<Attachment[]>([])

  /**
   * Cosa accetta il modello in uso — non cosa accetta STARK.
   *
   * Qui c'era una costante di quattro tipi immagine, uguale per ogni modello: la
   * graffetta si offriva anche dove non c'era niente da allegare e rifiutava un PDF
   * che sarebbe passato. Adesso la domanda la fa il modello (`ModelChoice.accepts`,
   * dichiarato dall'agent) e questo file non conosce nessun tipo per nome.
   */
  const modello = $derived(modelloInUso(snap.models, snap.model))
  const tipi = $derived(tipiAccettati(modello))
  const puoAllegare = $derived(tipi.length > 0)
  /**
   * Come si chiama il modello quando glielo si rinfaccia.
   *
   * Il nome risolto e non l'etichetta della voce: `snap.model` è esattamente ciò che
   * il selettore mostra. L'etichetta sarebbe «Default (recommended)», che in mezzo a
   * un rifiuto è una frase invece di un nome.
   */
  const nomeModello = $derived(snap.model ?? modello?.label ?? 'this model')
  /** Oltre questo, l'allegato non parte. Il numero è nostro, e il messaggio lo dice. */
  const MASSIMO = 10 * 1024 * 1024

  async function aggiungi(file: File | null): Promise<void> {
    if (!file) return
    if (!puoAllegare) {
      store.refused = `${nomeModello} doesn't read attachments — switch model to send files`
      return
    }
    // Non `file.type`: su `.md` e `.csv` il browser lo lascia spesso vuoto. Vedi `tipoDi`.
    const mediaType = tipoDi(file)
    if (!tipi.includes(mediaType)) {
      const che = mediaType ? ` (${mediaType})` : ''
      store.refused = `${file.name || 'That file'}${che} — ${nomeModello} takes ${nomiBrevi(tipi)}`
      return
    }
    if (file.size > MASSIMO) {
      store.refused = `${file.name || 'that file'} is ${Math.round(file.size / 1e6)} MB — the limit is 10 MB`
      return
    }
    // `readAsDataURL` e non `btoa` su un ArrayBuffer: quest'ultimo, su un'immagine
    // vera, si fa passare un array di milioni di elementi come argomenti e sfonda lo
    // stack. Qui la conversione la fa il browser.
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(r.error)
      r.readAsDataURL(file)
    })
    allegati = [...allegati, {
      type: parteDi(mediaType),
      mediaType,
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      ...(file.name ? { name: file.name } : {}),
    }]
  }

  function incolla(e: ClipboardEvent): void {
    const items = [...(e.clipboardData?.items ?? [])].filter(i => i.kind === 'file')
    if (items.length === 0) return
    // Solo se ci sono davvero dei file: uno screenshot incollato arriva così, ma il
    // testo normale no, e intercettarlo romperebbe il copia-incolla di tutti i giorni.
    e.preventDefault()
    for (const i of items) void aggiungi(i.getAsFile())
  }

  function lascia(e: DragEvent): void {
    e.preventDefault()
    sopra = false
    for (const f of e.dataTransfer?.files ?? []) void aggiungi(f)
  }

  /** Qualcosa sta passando sopra il blocco: si dice che qui si può lasciare. */
  let sopra = $state(false)

  // Incollare e trascinare bastavano su desktop, ma da telefono non esiste nessuno
  // dei due: non c'è una scorciatoia di incolla per un'immagine, e non c'è niente da
  // trascinare col dito. Senza un bottone, allegare un'immagine da telefono era
  // semplicemente impossibile — non scomodo, proprio irraggiungibile.
  async function scegli(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    for (const f of input.files ?? []) void aggiungi(f)
    // Altrimenti scegliere di nuovo lo stesso file non fa scattare un secondo `change`.
    input.value = ''
  }

  function key(e: KeyboardEvent): void {
    // Col menu delle citazioni aperto vale la stessa regola dei comandi: i tasti
    // guidano l'elenco, non la casella. Sta prima perché i due menu non possono
    // essere aperti insieme (uno vuole `/` in cima, l'altro `@` prima del cursore),
    // ma se un domani lo fossero, mandare mezzo percorso è l'errore peggiore.
    if (files.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sceltoAt = (sceltoAt + 1) % files.length; return }
      if (e.key === 'ArrowUp') { e.preventDefault(); sceltoAt = (sceltoAt - 1 + files.length) % files.length; return }
      if (e.key === 'Escape') { e.preventDefault(); chiusoAt = true; return }
      if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        void citaFile(files[sceltoAt]!)
        return
      }
    }
    // Col menu dei comandi aperto i tasti vogliono dire un'altra cosa: Invio completa
    // invece di mandare. Mandare "/comp" a metà è l'errore che il menu esiste per
    // evitare, quindi qui viene prima di tutto il resto.
    if (comandi.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); scelto = (scelto + 1) % comandi.length; return }
      if (e.key === 'ArrowUp') { e.preventDefault(); scelto = (scelto - 1 + comandi.length) % comandi.length; return }
      if (e.key === 'Escape') { e.preventDefault(); chiuso = true; return }
      if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        completa(comandi[scelto]!)
        return
      }
    }
    // Invio manda, Maiusc+Invio va a capo. È la convenzione di ogni casella di
    // messaggio, e qui vale a maggior ragione: si scrivono richieste di una riga.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  // ─── i comandi slash ──────────────────────────────────────────────────────

  /** Chiuso a mano con Esc: si riapre scrivendo, non appena si torna sulla casella. */
  let chiuso = $state(false)
  let scelto = $state(0)

  /**
   * Il menu vive finché si sta scrivendo **il nome**: dal `/` iniziale al primo spazio.
   * Dopo lo spazio si stanno scrivendo gli argomenti, e un elenco che resta aperto lì
   * coprirebbe quello che si scrive per proporre cose che non servono più.
   */
  const parola = $derived(
    !chiuso && live && /^\/[^\s]*$/.test(text) ? text.slice(1).toLowerCase() : null,
  )

  const comandi = $derived.by(() => {
    if (parola === null) return []
    const tutti = snap.slashCommands
    // Prima quelli che *cominciano* per quello che hai scritto, poi quelli che lo
    // contengono: cercando "review" si vuole `/code-review`, ma digitando "c" si
    // vuole `/clear` prima di `/code-review`.
    const nome = (c: SlashCommand): string[] => [c.name, ...(c.aliases ?? [])]
    const inizia = tutti.filter(c => nome(c).some(n => n.toLowerCase().startsWith(parola)))
    const dentro = tutti.filter(c => !inizia.includes(c)
      && nome(c).some(n => n.toLowerCase().includes(parola)))
    return [...inizia, ...dentro].slice(0, 40)
  })

  // La riga scelta torna in cima a ogni cambio di filtro: lasciarla dov'era la
  // farebbe puntare a un comando diverso da quello che si stava guardando.
  $effect(() => { void parola; scelto = 0 })
  $effect(() => { if (text === '') chiuso = false })

  function completa(c: SlashCommand): void {
    // Chiudere dopo aver scelto non è cosmesi: senza, `/doctor` — che non prende
    // argomenti — resta a filtrare se stesso, e il secondo Invio ricompleta invece di
    // mandare. Si riapre appena si scrive un altro carattere.
    chiuso = true
    // Lo spazio finale solo se il comando prende qualcosa: senza, Invio manda subito,
    // che è quello che si vuole dopo aver scelto `/clear`.
    text = `/${c.name}${c.argumentHint ? ' ' : ''}`
    box?.focus()
    void regrow()
  }

  // ─── le citazioni con `@` ─────────────────────────────────────────────────
  //
  // Stessa forma dei comandi slash — si preme `@`, compare un elenco, si filtra
  // scrivendo — ma con una differenza che decide tutta l'implementazione: i comandi
  // STARK ce li ha già in mano (`snap.slashCommands`, arrivati con l'handshake),
  // mentre i file no. Il filtro quindi **non lo fa il browser**: si chiede al CLI,
  // che risponde con la stessa ricerca del terminale.
  //
  // E `@` non sta in cima al testo come `/`: si cita un file **in mezzo** a una
  // frase. Quindi il pezzo da guardare non è tutta la casella ma quello che sta
  // subito prima del cursore, e serve saperlo — da qui `caret`.

  /** Dov'è il cursore. Il DOM lo sa, Svelte no: va letto quando può essere cambiato. */
  let caret = $state(0)
  function segnaCaret(e: Event): void {
    caret = (e.currentTarget as HTMLTextAreaElement).selectionStart ?? 0
  }
  /** Chiuso con Esc: si riapre scrivendo, non appena si torna sulla casella. */
  let chiusoAt = $state(false)
  let sceltoAt = $state(0)
  let files = $state<string[]>([])

  /**
   * La citazione che si sta scrivendo: dalla `@` al cursore, se in mezzo non ci sono
   * spazi. La `@` deve stare a inizio riga o dopo uno spazio — senza quella
   * condizione ogni indirizzo email scritto in un prompt aprirebbe il menu.
   */
  const cita = $derived.by(() => {
    if (chiusoAt || !live) return null
    const m = /(?:^|\s)@([^\s]*)$/.exec(text.slice(0, caret))
    return m ? { start: caret - m[1]!.length - 1, q: m[1]! } : null
  })

  // Si chiede al daemon a ogni tasto, e non c'è debounce: misurato, il CLI risponde
  // in 2-3ms a regime perché l'indice ce l'ha già in memoria (l'unica lenta è la
  // prima, ~1,4s, ed è per questo che l'adapter la scalda all'avvio della chat).
  // Un'attesa artificiale qui si vedrebbe eccome: si sta scrivendo.
  //
  // `giro` è la guardia contro il sorpasso: due risposte possono tornare in ordine
  // diverso da come sono partite, e senza questo controllo l'elenco potrebbe finire
  // per mostrare i risultati di due lettere fa.
  let giro = 0
  $effect(() => {
    const c = cita
    // `++giro` anche quando non c'è più niente da cercare, e non è una riga di troppo:
    // senza, una risposta partita un istante prima resta valida e **riapre** il menu
    // subito dopo che l'hai chiuso scegliendo un file. Visto succedere, non temuto:
    // scelto `view.ts`, la citazione era completa e l'elenco tornava su da solo.
    if (!c) { giro++; files = []; return }
    const mio = ++giro
    void store.files(c.q, id).then(async r => {
      if (mio !== giro) return
      // Un solo ritentativo, e solo su una risposta vuota a una ricerca vera: nei
      // primi ~1,8s di una chat il CLI sta ancora costruendo l'indice dei file e
      // risponde «niente» a qualunque cosa (misurato — è suo, non nostro). Senza
      // questo, chi apre una chat e scrive subito `@src` resta a mani vuote finché
      // non tocca un altro tasto. Con la query vuota no: lì «niente» è una risposta.
      if (r.length === 0 && c.q !== '') {
        await new Promise(res => setTimeout(res, 400))
        if (mio !== giro) return
        r = await store.files(c.q, id)
        if (mio !== giro) return
      }
      files = r
    })
  })

  // La riga scelta torna in cima a ogni cambio di filtro, come per gli slash.
  $effect(() => { void cita?.q; sceltoAt = 0 })

  /**
   * La riga scelta con le frecce deve restare visibile.
   *
   * I due menu scorrono (`max-height:210px`), e il tasto giù cambia la selezione senza
   * che il riquadro segua: misurato prima di scriverlo — nove frecce in giù, riga a
   * 783px con il riquadro che finisce a 742, cioè scelta fuori schermo mentre le
   * frecce continuavano a funzionare. Vale per **entrambi** i menu, e quello dei
   * comandi ce l'aveva da sempre: ne mostra fino a 40 e ne fa vedere sette.
   *
   * `block:'nearest'` e non `'center'`: scorrere di quel tanto che serve non sposta
   * niente quando la riga è già visibile, mentre centrarla farebbe saltare l'elenco
   * a ogni freccia.
   */
  function seguiScelta(el: HTMLElement | null): void {
    el?.querySelector('.mi.on')?.scrollIntoView({ block: 'nearest' })
  }
  let menuFile = $state<HTMLElement | null>(null)
  let menuCmd = $state<HTMLElement | null>(null)
  $effect(() => { void sceltoAt; void files; seguiScelta(menuFile) })
  $effect(() => { void scelto; void comandi; seguiScelta(menuCmd) })

  /** Il nome del file, che è quello che si sta cercando; il resto è dove sta. */
  function pezzi(p: string): { dir: string; nome: string; cartella: boolean } {
    const cartella = p.endsWith('/')
    const netto = cartella ? p.slice(0, -1) : p
    const i = netto.lastIndexOf('/')
    return { dir: i < 0 ? '' : netto.slice(0, i + 1), nome: netto.slice(i + 1), cartella }
  }

  async function citaFile(p: string): Promise<void> {
    const c = cita
    if (!c) return
    // Una cartella non è una destinazione: si è appena scesi di un livello e si
    // continua a scrivere lì dentro, quindi niente spazio dopo e il menu resta
    // aperto. Un file invece è la risposta, e lo spazio serve a scrivere il seguito.
    const coda = p.endsWith('/') ? '' : ' '
    const prima = `@${p}${coda}`
    text = text.slice(0, c.start) + prima + text.slice(caret)
    const pos = c.start + prima.length
    await tick()
    // Il cursore va rimesso a mano: dopo un'assegnazione a `text` il browser lo
    // sposta in fondo, e se lo si lasciasse lì citare un file in mezzo a una frase
    // ributterebbe a scrivere alla fine.
    box?.focus()
    box?.setSelectionRange(pos, pos)
    caret = pos
    grow()
  }

  /**
   * La casella cresce col testo fino a un tetto, poi scorre.
   *
   * Misura il **DOM**, non `text`: `scrollHeight` è l'altezza che la textarea ha
   * davvero adesso. Va quindi chiamata quando il DOM è già aggiornato — da `oninput`
   * lo è per definizione (l'utente ha appena digitato), ma dopo un'assegnazione a
   * `text` **no**: vedi `regrow()`.
   */
  function grow(): void {
    const el = box
    if (!el) return
    // Da vuota si toglie l'altezza imposta invece di ricalcolarla: `scrollHeight` su
    // una textarea vuota dà 32px, due in meno dei 34 che il CSS le darebbe da sola, e
    // il salto si vedeva a ogni invio. Senza valore inline decide il foglio di stile,
    // che è la risposta giusta quando non c'è niente da misurare.
    if (el.value === '') { el.style.height = ''; return }
    el.style.height = 'auto'
    // L'altezza si arrotonda a **righe intere**: un'altezza a metà riga fa vedere il
    // glifo tagliato sul bordo (è il «troncato» che l'utente ha visto). Round e non
    // ceil: `scrollHeight` arriva arrotondato per eccesso dal browser (3 righe
    // misurate 53 su 52,5, e il ceil le promuoveva a quattro — visto nella sonda);
    // col line-height esatto le righe di contenuto sono comunque intere.
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
    const voluta = Math.min(el.scrollHeight, 140)
    el.style.height = `${Math.round(voluta / lh) * lh}px`
  }

  /**
   * Come `grow()`, ma dopo che Svelte ha scritto nel DOM.
   *
   * Il bug che risolve (segnalato dall'utente con uno screenshot, 26 agosto 2026: «perché
   * è gigante?»): mandato un prompt lungo, la casella **restava alta quanto il prompt**
   * pur essendo vuota — fino al tetto di 160px, cioè cinque volte i ~34px di una riga —
   * e ci restava finché non si ridigitava qualcosa.
   *
   * La causa non è il classico auto-resize senza reset: il reset a `'auto'` c'è (riga
   * sopra) ed è corretto. È il **momento**. `text` è `$state` legato con `bind:value`, e
   * Svelte 5 non scrive nel DOM in modo sincrono: al ritorno da `text = ''` la textarea
   * contiene ancora il testo di prima. `grow()` misurava quindi il prompt appena
   * inviato e ne fissava l'altezza in `style.height`; subito dopo Svelte svuotava il
   * valore, ma l'altezza inline restava lì, senza più nessuno a rimisurarla.
   *
   * `tick()` è l'attesa che Svelte offre apposta per questo. Il difetto era simmetrico
   * in tutti e tre i punti che assegnano `text` — svuotare, ripristinare dopo un
   * rifiuto, completare uno slash — e si vedeva solo nel primo perché è l'unico in cui
   * l'altezza sbagliata è *più grande* di quella giusta.
   */
  async function regrow(): Promise<void> {
    await tick()
    grow()
  }

  // ─── il menu del lead (+) ─────────────────────────────────────────────────
  //
  // Dal DS v10 la barra di stato non c'è più: quello che si comandava da lì sta qui.
  // Il bottone apre il menu radice; Mode, MCP e Model navigano **dentro lo stesso
  // contenitore** (la riga «indietro» è la stessa del picker), perché un menu che si
  // sposta di posto a ogni clic sembra tre menu diversi.

  type Nav = 'root' | 'mode' | 'mcp' | 'model' | 'reasoning' | 'effort'
  let menu = $state<Nav>('root')
  let aperto = $state(false)
  let leadEl = $state<HTMLElement | null>(null)
  let menuEl = $state<HTMLElement | null>(null)

  /** Il passaggio del mouse sul lead, prima ancora di un clic: mostra un'anteprima
   *  di sola lettura — modello e quanto ne resta — con lo stesso `pop-item` e lo
   *  stesso `.usage` del menu vero (§anteprimaConsumo qui sotto), non una copia.
   *  Non conta da tocco: senza un mouse `pointerenter` o non parte o precede un tap
   *  che aprirebbe comunque il menu vero un istante dopo — un lampo in più, non
   *  un'informazione. */
  let hoverPreview = $state(false)

  function chiudiMenu(): void {
    aperto = false
    menu = 'root'
    // Le conferme appartengono al menu che le ha aperte: chiuse con lui, non lasciate
    // lì a riapparire al prossimo giro (stessa regola della barra di stato di prima).
    conferma = null
    store.handoff = null
  }

  function chooseMenu(): void {
    if (aperto) { chiudiMenu(); return }
    aperto = true
    menu = 'root'
    // Il catalogo si chiede aprendo, non prima: costa comunque zero dopo la prima
    // volta — il daemon lo tiene, e lo scalda da solo all'accensione.
    void store.caricaCatalogo()
    // Quota e contesto si rinfrescano all'apertura: è l'unico momento in cui quei
    // numeri devono essere freschi (stesso patto del pannellino di prima).
    peek()
  }

  // Clic fuori dal bottone e dal menu aperto chiude: la stessa regola di ogni tendina.
  function fuori(e: PointerEvent): void {
    if (!aperto) return
    const t = e.target as Node
    if (leadEl?.contains(t)) return
    if (menuEl?.contains(t)) return
    chiudiMenu()
  }

  // ⌘O / Ctrl+O apre la scelta del file **mentre il menu è aperto**: intercettarlo
  // fuori intercetterebbe anche l'«apri file» del browser, che non è nostro.
  // L'etichetta sulla voce «Choose file» non c'è più (chiesta via dall'utente,
  // 1º settembre 2026) — la scorciatoia invece resta, e continua a valere qui.
  function tastoGlobale(e: KeyboardEvent): void {
    if (!aperto) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      fileInput?.click()
    }
  }

  /** Si può cambiare adesso? La capability è dell'agent, `live` è dello stato. */
  function modificabile(kind: 'mode' | 'model'): boolean {
    if (!live) return false
    if (kind === 'mode') return snap.capabilities?.switchMode !== false
    return snap.capabilities?.switchModel !== false
  }

  // ─── quello che stava nella barra di stato ────────────────────────────────

  /**
   * Su quale ramo sta la cartella. Non è nel journal e non ha un evento canonico: è un
   * fatto del **filesystem**, e chi fa `git checkout` in un terminale accanto non manda
   * niente a STARK. Quindi si chiede, invece di ricordarlo.
   *
   * Si richiede quando cambia la cartella e a ogni **confine di turno** — gli stessi due
   * momenti in cui STARK chiede già quota e contesto. Non è un orologio: leggere lo
   * stato qui dentro fa ripartire l'effetto solo quando la sessione entra o esce dal
   * lavoro, e su una chat ferma non parte più niente.
   */
  let git = $state<GitInfo | null>(null)
  /** Per quale cartella si è già chiesto. Non è `$state`: serve a **ricordare**, non a
   *  ridisegnare — e leggere `git` qui dentro creerebbe un anello, perché è l'effetto
   *  stesso a scriverlo. */
  let chiesto = ''
  $effect(() => {
    const cwd = snap.cwd
    // Letto **prima** di qualunque `await`, se no la dipendenza non verrebbe registrata
    // e l'effetto non ripartirebbe al confine del turno.
    const lavora = busy
    if (!cwd) { git = null; chiesto = ''; return }
    // Un turno ne muove **due**, di confini: quando comincia e quando finisce. Chiedere
    // su entrambi raddoppierebbe le richieste per sapere due volte la stessa cosa — se
    // il ramo è cambiato, a cambiarlo è stato il turno, quindi la risposta che conta è
    // quella dopo. Su una cartella di cui non si sa ancora niente si chiede lo stesso:
    // una chat aperta **mentre** lavora resterebbe senza ramo fino a fine turno.
    if (lavora && chiesto === cwd) return
    chiesto = cwd
    let vivo = true
    void store.api.git(cwd).then(g => { if (vivo) git = g })
    return () => { vivo = false }
  })

  /**
   * I selettori che l'agent dichiara (ADR-014). Su un journal scritto prima, `options`
   * è vuoto e ci sono ancora `mode`/`modes` e `model`/`models`: si ricostruiscono con
   * **la stessa funzione** che usano gli adapter, invece di tenere qui un secondo modo
   * di comporli.
   */
  const opts = $derived<SessionOption[]>(
    snap.options.length > 0
      ? snap.options
      : optionsFrom({ mode: snap.mode, modes: snap.modes, model: snap.model, models: snap.models }),
  )
  const modeOpt = $derived(opts.find(o => o.kind === 'mode'))
  const modelOpt = $derived(opts.find(o => o.kind === 'model'))
  // Le due scelte nuove (chieste dall'utente, 1º settembre 2026): si cercano per
  // `id`, non per `kind` — sono opzioni 'other' e il vocabolario lo dichiara
  // l'agent (ADR-014). 'effort' compare anche su OpenCode dal 3 settembre 2026
  // (`opzioniOpenCode` in adapters/opencode/adapter.ts, solo sui modelli che
  // dichiarano `variants`); 'reasoning' resta solo di Claude Code, perche' OpenCode
  // non ha un interruttore indipendente dal livello di effort (misurato — vedi il
  // commento su `ModelChoice.reasoning` in core/events.ts). Dove una voce non c'e'
  // (journal vecchi, un modello senza quella capacita') non compare: stessa regola
  // delle finestre di quota.
  const reasoningOpt = $derived(opts.find(o => o.id === 'reasoning'))
  const effortOpt = $derived(opts.find(o => o.id === 'effort'))

  /** Come si chiama il modello, in forma breve: il pezzo dopo l'ultimo slash, che è ciò
   *  che lo distingue — «GLM-5.3-Flash» e non «opencode/glm-5.3-flash». Resta il
   *  ripiego quando l'elenco dei modelli non dichiara un'etichetta. */
  const nomeBreve = $derived(snap.model?.split('/').pop() ?? 'the agent')
  /** Come si chiama invece dove si parla all'utente (riga «Model» del menu, placeholder
   *  della casella): l'etichetta leggibile che l'agent dichiara («Opus (1M context)»),
   *  non il codice risolto (`claude-opus-5[1m]`). */
  const nomeLeggibile = $derived(modello?.label || nomeBreve)
  const modelloIcona = $derived(modelOpt ? getLobeIconUrl(modelOpt.value) : null)

  /** Scheda del modello in uso per l'hover: stessa ricerca di ModelPicker `livello0`
   *  — prima l'agent della chat, poi gli altri — ma qui solo per mostrare, non per
   *  scegliere. Se il catalogo non è ancora arrivato, resta null e si ripiega sul
   *  nome già risolto sopra. */
  const currentCard = $derived.by(() => {
    const cat = store.catalogo
    const corrente = modelOpt?.value ?? snap.model ?? ''
    if (!cat || !corrente) return null
    const nel = (a: typeof cat[number]) => a.models.find(x => x.id === corrente || (x as any).resolved === corrente)
    const mio = cat.find(a => a.id === snap.agent)
    const ordine = mio ? [mio, ...cat.filter(a => a !== mio)] : cat
    for (const a of ordine) {
      const m = nel(a)
      if (m) return { agent: a, model: m }
    }
    return null
  })
  const nomeESuffisso = (m: { id: string; label?: string }): { nome: string; suffix?: string } => {
    const label = (m as any).label ?? m.id
    const mm = /^(.*?)\s*\((.+)\)\s*$/.exec(label)
    return mm ? { nome: mm[1]!, suffix: mm[2]! } : { nome: label }
  }
  const costoFree = $derived.by(() => {
    const c = (currentCard?.model as any)?.cost
    return !!c && c.input === 0 && c.output === 0
  })
  const capsCard = $derived(inputTypesOf(currentCard?.model as { accepts?: string[] } | undefined))

  /** Cosa dice la riga di un server MCP. Gli stati sono quelli del protocollo e si
   *  mostrano come sono: `needs-auth` non è un errore di STARK e non si nasconde — si
   *  dice cosa fare, che è una cosa che si fa dal terminale e non da qui. */
  function mcpBlurb(s: SessionSnapshot['mcpServers'][number]): string {
    if (!s.enabled) return 'off for this chat'
    switch (s.status) {
      case 'connected': return 'connected'
      case 'pending': return 'connects the first time it is used'
      case 'needs-auth': return `needs a login: run \`claude mcp login ${s.name}\` in a terminal`
      case 'failed': return s.error ? `failed: ${s.error}` : 'failed'
      default: return s.status
    }
  }
  const mcpLabel = $derived.by(() => {
    const on = snap.mcpServers.filter(s => s.enabled).length
    return on === 0 ? 'none' : String(on)
  })

  // ─── quanto è pieno il contesto ───────────────────────────────────────────
  //
  // L'anello attorno al lead e la riga «Context» del pannello d'uso sono la stessa
  // domanda: quanto è piena la finestra **adesso**. Quando c'è, vince la lettura vera
  // di Claude Code (`getContextUsage()` — vedi reduce.ts per il perché non si ricalcola);
  // finché non è arrivata si ripiega sul conto approssimato dall'ultima lettura.

  const now = $derived.by(() => {
    const u = snap.usage
    if (u.input + u.output + u.cacheRead + u.cacheWrite > 0) return u
    for (let i = snap.turns.length - 1; i >= 0; i--) {
      const tu = snap.turns[i]?.usage
      if (tu) return tu
    }
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  })
  const nowTotal = $derived(now.input + now.output + now.cacheRead + now.cacheWrite)

  const ctx = $derived(snap.contextUsage)
  const contextWindow = $derived(
    ctx?.maxTokens
    ?? snap.models.find(m => m.id === snap.model || m.resolved === snap.model)?.contextWindow,
  )
  const pct = $derived(
    ctx ? Math.min(100, Math.round(ctx.percentage))
      : contextWindow ? Math.min(100, Math.round((nowTotal / contextWindow) * 100))
      : null,
  )
  /** Quando manca `ctx` si mostra il totale grezzo di sempre; quando c'è, il totale
   *  vero che Claude Code riporta — non necessariamente uguale, e quello vero vince. */
  const totalNow = $derived(ctx?.totalTokens ?? nowTotal)

  /** Verde finché c'è margine, ambra quando ne resta poco, rosso quando è quasi finita.
   *  Le soglie sono di lettura, non del piano: il piano dice solo la percentuale. */
  const meterColour = (used: number): string =>
    used >= 90 ? 'var(--stop)' : used >= 75 ? 'var(--wait)' : 'var(--accent)'

  // ─── quanto ne resta del piano ────────────────────────────────────────────
  //
  // Tre righe nel pannello d'uso, e sono domande diverse: quanto contesto ha in mano
  // *questa* chat, quanto hai consumato della finestra corta (5 ore), quanto della
  // settimana. Le ultime due non sono della conversazione ma del piano — le consumano
  // anche le altre chat e l'altra macchina — ed è per questo che si rileggono invece
  // di sommarle qui. Il DS mette un costo su ogni riga: l'unico che esiste è quello
  // della chat (listino, `spentUsd`) — il piano non espone il costo delle finestre,
  // e quelle celle restano vuote invece di fingere.

  const sessionWin = $derived(snap.quotaWindows.find(w => w.kind === 'session'))
  const weeklyWin = $derived(snap.quotaWindows.find(w => w.kind === 'weekly' && !w.scope))
  const weeklyScoped = $derived(snap.quotaWindows.filter(w => w.kind === 'weekly' && w.scope))
  const haFinestre = $derived(Boolean(sessionWin) || Boolean(weeklyWin) || weeklyScoped.length > 0)

  // Il conto alla rovescia si muove da solo, al mezzo minuto: mostrarlo fermo mentre
  // la finestra si avvicina sarebbe peggio che non mostrarlo. Si chiama `clock` e non
  // `now` perché `now` qui sopra è già preso, e vuol dire un'altra cosa.
  let clock = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => { clock = Date.now() }, 30_000)
    return () => clearInterval(t)
  })

  // Si rilegge quando l'utente apre il menu (o ci passa sopra). Il **contesto** si
  // chiede a ogni apertura, senza cadenza: è una domanda sul canale di controllo
  // (2-3 ms misurati) ed è il numero che chi apre il menu viene a guardare — la
  // vecchia cadenza di quindici secondi lo lasciava al turno scorso, uno «shot»
  // dell'ultimo messaggio invece che la situazione attuale (segnalato dall'utente,
  // 1º settembre 2026). La quota resta a cadenza: le finestre non si muovono di
  // secondo in secondo e quella lettura costa di più.
  let ultimaQuota = 0
  function peek(): void {
    void store.refreshContext(id)
    const t = Date.now()
    if (t - ultimaQuota < 15_000) return
    ultimaQuota = t
    void store.refreshQuota(id)
  }

  /** Un numero di token leggibile per il piè del pannello d'uso: come `fmtTok`, ma
   *  senza il trattino — lo zero qui è vero, è una chat che non ha ancora consumato. */
  const fmt = (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

  /** La spesa della chat in listino: qui e solo qui c'è un costo vero da mostrare. */
  const fmtUsd = (n: number): string =>
    n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`

  // ─── passare a un altro agent ─────────────────────────────────────────────
  //
  // Dentro lo stesso agent cambiare modello e' un parametro. Fra due agent non lo e':
  // la conversazione vive dentro il CLI (ADR-009), quindi si scrive un passaggio di
  // consegne e se ne apre un'altra. La tendina e' la stessa, l'esito no — e per questo
  // la seconda strada passa da una conferma che dice il costo prima di pagarlo.
  let conferma = $state<{ agent: string; model: string; label: string } | null>(null)

  function scegliModello(agent: string, model: string): void {
    if (agent === snap.agent) {
      void store.setOption(modelOpt?.id ?? 'model', model, id)
      chiudiMenu()
      return
    }
    conferma = { agent, model, label: model.split('/').pop() ?? model }
  }

  async function passa(via: 'agent' | 'journal'): Promise<void> {
    const scelta = conferma ?? (store.handoff?.fase === 'chiede' ? store.handoff : null)
    if (!scelta) return
    // Il passaggio tocca la chat **di questo pannello**: è lei che cambia agent, e
    // `replacePane` mette la nuova al posto della vecchia nel riquadro che la mostra.
    await store.passaAdAltroAgent(scelta.agent, scelta.model, via, id)
    // Andata: il pannello mostra gia' la chat nuova, e questo menu appartiene alla
    // vecchia. Se invece e' rimasto uno stato (`chiede`, `fallito`), il menu resta
    // aperto apposta, perche' e' li' che c'e' la domanda o il motivo.
    if (store.handoff === null) chiudiMenu()
  }
</script>

<svelte:window onpointerdown={fuori} onkeydown={tastoGlobale} />
<svelte:document onkeydown={e => { if (e.key === 'Escape' && aperto) chiudiMenu() }} />

<!-- Trascinare funziona su tutto il blocco, non solo sulla casella: chi arriva con
     un'immagine in mano punta «in basso», non un rettangolo di 24 pixel. -->
<div class="dock" class:sopra
  ondragover={e => { if (live) { e.preventDefault(); sopra = true } }}
  ondragleave={() => { sopra = false }}
  ondrop={lascia}
  role="presentation">
  {#if store.refused}
    <div class="refused">
      <Icon name="i-warn" />
      <span>{store.refused}</span>
      <button class="x" onclick={() => { store.refused = null }} aria-label="Dismiss">✕</button>
    </div>
  {/if}

  {#if asking}
    <!-- Lo Stop resta anche col blocco espanso, e non è un dettaglio: una richiesta
         arriva mentre l'agent sta ancora lavorando, e lo stato canonico in quel momento
         è `awaiting`, non `busy`. Legarlo a `busy` lo farebbe sparire proprio nel
         momento in cui serve di più. -->
    <!-- `id` arriva a Ask perché le sue risposte — permessi, domande, piani — vadano
         alla chat di questo pannello e non a quella a fuoco: la stessa regola del
         composer qui sotto, per la stessa ragione. -->
    <Ask {store} {snap} {id} canStop={live} />
  {/if}

  {#if files.length > 0}
    <!-- Stesso vestito del menu dei comandi (`.slash`): sono due risposte alla stessa
         domanda — «cosa posso scrivere qui» — e farle sembrare due cose diverse
         costringerebbe a impararle due volte. -->
    <div class="slash" bind:this={menuFile} role="listbox" tabindex="-1" aria-label="Project files">
      {#each files as p, i (p)}
        {@const f = pezzi(p)}
        <button class="mi at" class:on={i === sceltoAt} role="option" aria-selected={i === sceltoAt}
          onmousedown={e => { e.preventDefault(); void citaFile(p) }}>
          <Icon name={f.cartella ? 'i-folder' : 'i-doc'} />
          <span class="txt">
            <span class="line">
              <b>{f.nome}{f.cartella ? '/' : ''}</b>
              {#if f.dir}<span class="hint2">{f.dir}</span>{/if}
            </span>
          </span>
        </button>
      {/each}
    </div>
  {/if}

  {#if comandi.length > 0}
    <!-- Sopra la casella e non sotto: sotto finirebbe fuori dalla finestra, e
         soprattutto il posto dove si guarda mentre si scrive è appena sopra ciò che
         si scrive. -->
    <div class="slash" bind:this={menuCmd} role="listbox" tabindex="-1" aria-label="Slash commands">
      {#each comandi as c, i (c.name)}
        <button class="mi" class:on={i === scelto} role="option" aria-selected={i === scelto}
          onmousedown={e => { e.preventDefault(); completa(c) }}>
          <!-- Due righe, e **una riga ciascuna**: la descrizione di una skill è un
               paragrafo intero, e lasciata libera fa una riga alta mezzo schermo.
               Qui serve riconoscere il comando, non leggerne il manuale. -->
          <span class="txt">
            <span class="line">
              <b>/{c.name}</b>
              {#if c.argumentHint}<span class="hint2">{c.argumentHint}</span>{/if}
              {#if c.aliases?.length}<span class="hint2">— {c.aliases.map(a => `/${a}`).join(', ')}</span>{/if}
            </span>
            {#if c.description}<span class="sub" title={c.description}>{c.description}</span>{/if}
          </span>
          <!-- Non si nasconde: il CLI ce l'ha. Si dice che lì non funziona, e se lo
               mandi lo stesso è l'agent a spiegarlo — noi non lo blocchiamo. -->
          {#if c.terminalOnly}<span class="tag">terminal only</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if live}
    <div class="composer-zone">
      <!-- Le due righe che il menu vero e l'anteprima al passaggio del mouse
           mostrano tali e quali: uno snippet ciascuna, non due copie della stessa
           riga da tenere allineate a mano. -->
      {#snippet modelRow()}
        {#if modelOpt}
          <button class="pop-item" class:dis={!modificabile('model')} disabled={!modificabile('model')}
            title={modificabile('model') ? 'Model' : "This agent can't change its model from here"}
            onclick={() => { aperto = true; menu = 'model' }}>
            <span class="ico">
              {#if modelloIcona}<img src={modelloIcona} alt="" width="15" height="15" loading="lazy"
                onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<span class="mdot"></span>{/if}
            </span>
            Model
            <span class="cur">{nomeLeggibile} <span class="chev"><Icon name="i-fwd" /></span></span>
          </button>
        {/if}
      {/snippet}
      {#snippet modelBlock()}
        {#if currentCard}
          {@const head = nomeESuffisso(currentCard.model)}
          {@const ic0 = getLobeIconUrl((currentCard.model as any).resolved ?? currentCard.model.id)}
          <div class="preview-head">
            <div class="pk-avatar">
              {#if ic0}<img src={ic0} alt="" width="19" height="19" loading="lazy"
                onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<Icon name="i-brain" />{/if}
            </div>
            <div class="pk-id">
              <div class="pk-name">{head.nome}{#if head.suffix} <span class="mult">({head.suffix})</span>{/if}</div>
              <div class="pk-path">{currentCard.agent.label}{#if providerLabelFor(currentCard.model as any)} <span class="arw">›</span> {providerLabelFor(currentCard.model as any)}{/if}</div>
            </div>
            {#if capsCard}
              <div class="pk-caps" title={`accepts: ${[capsCard.text ? 'text' : null, capsCard.image ? 'image' : null, capsCard.docs ? 'documents' : null].filter(Boolean).join(', ')}`}>
                <Icon name="i-type" class={capsCard.text ? '' : 'off'} />
                <Icon name="i-image" class={capsCard.image ? '' : 'off'} />
                <Icon name="i-doc" class={capsCard.docs ? '' : 'off'} />
              </div>
            {/if}
          </div>
          <div class="pk-meta">
            <span class="cash"><Icon name="i-dollar" /></span>
            {#if costoFree}
              <span class="price free">free</span>
            {:else if (currentCard.model as any).cost}
              <span class="unit">/M</span>
              <span class="price">{fmtCosto((currentCard.model as any).cost.input)} / {fmtCosto((currentCard.model as any).cost.output)}</span>
            {:else}
              <span class="price">—</span>
            {/if}
            <span class="ctx-lbl">CONTEXT</span>
            <span class="ctx-val">{fmtTok((currentCard.model as any).contextWindow)}</span>
          </div>
          <div class="pk-rule"></div>
        {:else if modelOpt}
          <div class="preview-head fallback">
            <div class="pk-avatar">
              {#if modelloIcona}<img src={modelloIcona} alt="" width="19" height="19" loading="lazy"
                onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<span class="mdot"></span>{/if}
            </div>
            <div class="pk-id"><div class="pk-name">{nomeLeggibile}</div></div>
          </div>
          <div class="pk-meta">
            <span class="cash"><Icon name="i-dollar" /></span>
            <span class="price">—</span>
            {#if contextWindow}
              <span class="ctx-lbl">CONTEXT</span>
              <span class="ctx-val">{fmtTok(contextWindow)}</span>
            {/if}
          </div>
          <div class="pk-rule"></div>
        {/if}
      {/snippet}
      {#snippet modelTop()}
        <button class="model-top" class:dis={!modificabile('model')} disabled={!modificabile('model')}
          title={modificabile('model') ? 'Change model' : "This agent can't change its model from here"}
          onclick={() => { if (modificabile('model')) menu = 'model' }}>
          <div class="model-top-main">
            {#if currentCard}
              {@const head = nomeESuffisso(currentCard.model)}
              {@const ic0 = getLobeIconUrl((currentCard.model as any).resolved ?? currentCard.model.id)}
              <div class="preview-head" style="padding:0">
                <div class="pk-avatar">
                  {#if ic0}<img src={ic0} alt="" width="19" height="19" loading="lazy"
                    onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
                  {:else}<Icon name="i-brain" />{/if}
                </div>
                <div class="pk-id">
                  <div class="pk-name">{head.nome}{#if head.suffix} <span class="mult">({head.suffix})</span>{/if}</div>
                  <div class="pk-path">{currentCard.agent.label}{#if providerLabelFor(currentCard.model as any)} <span class="arw">›</span> {providerLabelFor(currentCard.model as any)}{/if}</div>
                </div>
                {#if capsCard}
                  <div class="pk-caps" style="padding-top:2px">
                    <Icon name="i-type" class={capsCard.text ? '' : 'off'} />
                    <Icon name="i-image" class={capsCard.image ? '' : 'off'} />
                    <Icon name="i-doc" class={capsCard.docs ? '' : 'off'} />
                  </div>
                {/if}
              </div>
              <div class="pk-meta" style="padding:6px 0 0">
                <span class="cash"><Icon name="i-dollar" /></span>
                {#if costoFree}
                  <span class="price free">free</span>
                {:else if (currentCard.model as any).cost}
                  <span class="unit">/M</span>
                  <span class="price">{fmtCosto((currentCard.model as any).cost.input)} / {fmtCosto((currentCard.model as any).cost.output)}</span>
                {:else}
                  <span class="price">—</span>
                {/if}
                <span class="ctx-lbl">CONTEXT</span>
                <span class="ctx-val">{fmtTok((currentCard.model as any).contextWindow)}</span>
              </div>
            {:else if modelOpt}
              <div class="preview-head fallback" style="padding:0">
                <div class="pk-avatar">
                  {#if modelloIcona}<img src={modelloIcona} alt="" width="19" height="19" loading="lazy"
                    onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
                  {:else}<span class="mdot"></span>{/if}
                </div>
                <div class="pk-id"><div class="pk-name">{nomeLeggibile}</div></div>
              </div>
              <div class="pk-meta" style="padding:6px 0 0">
                <span class="cash"><Icon name="i-dollar" /></span>
                <span class="price">—</span>
                {#if contextWindow}
                  <span class="ctx-lbl">CONTEXT</span>
                  <span class="ctx-val">{fmtTok(contextWindow)}</span>
                {/if}
              </div>
            {/if}
          </div>
          <span class="chev"><Icon name="i-fwd" /></span>
        </button>
      {/snippet}
      {#snippet usagePanel(hover = false)}
        {#if contextWindow || haFinestre}
          {#if !hover}<div class="divider"></div>{/if}

          <div class="usage">
            {#if contextWindow}
              <div class="u-row" title={`${fmt(totalNow)} / ${fmt(contextWindow)} tokens`}>
                <span class="u-lbl">Context</span>
                <span class="u-bar"><span style="width:{Math.min(100, pct ?? 0)}%;background:{meterColour(pct ?? 0)}"></span></span>
                <span class="u-pct" class:near={(pct ?? 0) >= 75} class:crit={(pct ?? 0) >= 90}>{pct !== null ? `${pct}%` : '—'}</span>
                <!-- Il costo della chat: l'unico della colonna che esiste davvero
                     (listino — vedi `spentUsd` in reduce.ts). Vuota non è «zero».
                     Dove il costo non c'è lo span non si mette proprio: la barra
                     (`flex:1`) si allunga fino in fondo a riempire lo spazio,
                     invece di lasciare un buco bianco (chiesto dall'utente,
                     1º settembre 2026). -->
                {#if snap.spentUsd > 0}<span class="u-cost">{fmtUsd(snap.spentUsd)}</span>{/if}
              </div>
            {/if}
            {#if sessionWin?.used !== undefined}
              <div class="u-row" title="Session · 5 hours">
                <span class="u-lbl">Session</span>
                <span class="u-bar"><span style="width:{Math.min(100, sessionWin.used)}%;background:{meterColour(sessionWin.used)}"></span></span>
                <span class="u-pct" class:near={sessionWin.used >= 75} class:crit={sessionWin.used >= 90}>{sessionWin.used}%</span>
              </div>
            {/if}
            {#if weeklyWin?.used !== undefined}
              <div class="u-row" title="Weekly">
                <span class="u-lbl">Week</span>
                <span class="u-bar"><span style="width:{Math.min(100, weeklyWin.used)}%;background:{meterColour(weeklyWin.used)}"></span></span>
                <span class="u-pct" class:near={weeklyWin.used >= 75} class:crit={weeklyWin.used >= 90}>{weeklyWin.used}%</span>
              </div>
            {/if}
            {#each weeklyScoped as w (w.scope)}
              {#if w.used !== undefined}
                <div class="u-row" title="Weekly · {w.scope}">
                  <span class="u-lbl">{w.scope}</span>
                  <span class="u-bar"><span style="width:{Math.min(100, w.used)}%;background:{meterColour(w.used)}"></span></span>
                  <span class="u-pct" class:near={w.used >= 75} class:crit={w.used >= 90}>{w.used}%</span>
                </div>
              {/if}
            {/each}
            {#if hover}
              <!-- Hover: sotto l'utilizzo solo repo e branch, niente numeri flat -->
              <div class="u-foot hover-foot">
                <span class="g"><Icon name="i-folder" />{project(snap.cwd)}</span>
                {#if git?.branch}
                  <span class="sep"></span>
                  <span class="g" title={git.detached ? `Detached HEAD at ${git.branch}` : `On branch ${git.branch}`}>
                    <Icon name="i-branch" />{git.branch}
                  </span>
                {/if}
              </div>
            {:else if sessionWin?.resetsAt || weeklyWin?.resetsAt || contextWindow}
              <div class="u-foot">
                <span class="g-foot">
                  <span class="g"><Icon name="i-folder" />{project(snap.cwd)}</span>
                  {#if git?.branch}
                    <span class="sep"></span>
                    <span class="g" title={git.detached ? `Detached HEAD at ${git.branch}` : `On branch ${git.branch}`}>
                      <Icon name="i-branch" />{git.branch}
                    </span>
                  {/if}
                </span>
                {#if contextWindow}<span>{fmt(totalNow)} / {fmt(contextWindow)}</span>{/if}
              </div>
            {/if}
          </div>
        {/if}
        {#if hover && !contextWindow && !haFinestre}
          <!-- Hover senza barre: mostra comunque repo/branch in fondo -->
          <div class="u-foot hover-foot" style="padding:4px 9px 8px">
            <span class="g"><Icon name="i-folder" />{project(snap.cwd)}</span>
            {#if git?.branch}
              <span class="sep"></span>
              <span class="g" title={git.detached ? `Detached HEAD at ${git.branch}` : `On branch ${git.branch}`}>
                <Icon name="i-branch" />{git.branch}
              </span>
            {/if}
          </div>
        {/if}
      {/snippet}

      {#if aperto}
        {#if menu === 'model'}
          <!-- Il selettore dei modelli: box `.picker` del DS (440px), con la conferma
               del passaggio a un altro agent al posto della lista quando serve — il
               costo del passaggio si dice **prima**, non dopo. -->
          <div class="leadbox picker" bind:this={menuEl}>
            {#if conferma}
              <div class="pg">Switch to {conferma.label}?</div>
              <div class="pnote">
                <Icon name="i-warn" />
                {conferma.agent} can't continue this conversation: it lives inside
                {snap.agent}. STARK will ask the current model to write a handoff file in
                <code>.stark/</code> — that costs one turn — then open a new chat here, in
                this same panel. This one stays in the list.
              </div>
              <div class="hrow">
                <button class="mi" onclick={() => { conferma = null }}>Cancel</button>
                <button class="mi on" onclick={() => void passa('agent')}>Write handoff</button>
              </div>
            {:else if store.handoff?.fase === 'chiede'}
              <div class="pg">This chat is {store.handoff.state}</div>
              <div class="pnote">
                <Icon name="i-warn" />
                Only a live session can write its own handoff. Waking it costs a wake plus
                one turn; the journal version is free but says less — what happened, not
                what's left to do.
              </div>
              <div class="hrow">
                <button class="mi" onclick={() => void passa('journal')}>From journal (free)</button>
                <button class="mi on" onclick={() => void passa('agent')}>Wake and write</button>
              </div>
            {:else if store.handoff?.fase === 'corso'}
              <div class="pg">Handing off to {store.handoff.model}…</div>
              <div class="pnote">The current model is writing the handoff file. This is a
                real turn: it can take a while.</div>
            {:else if store.handoff?.fase === 'fallito'}
              <div class="pnote"><Icon name="i-warn" />{store.handoff.error}</div>
              <div class="hrow">
                <button class="mi" onclick={() => { store.handoff = null }}>Back</button>
              </div>
            {:else}
              <ModelPicker catalogo={store.catalogo} corrente={modelOpt?.value ?? snap.model ?? ''}
                agenteCorrente={snap.agent}
                nota={a => (a === snap.agent ? null : 'handoff')}
                onScegli={scegliModello} onIndietro={() => { menu = 'root' }} />
            {/if}
          </div>
        {:else if menu === 'mcp'}
          <!-- I server MCP di questa chat: spenti di default, accesi qui. Il DS li
               divide in Local e Cloud col conteggio dei tool; lo snapshot non porta
               né l'origine né il numero di tool, quindi un elenco solo — la divisione
               arriverà col dato, non prima (Principio 3: niente finte colonne). -->
          <div class="leadbox popup" bind:this={menuEl}>
            <button class="pk-nav" onclick={() => { menu = 'root' }}>
              <span class="back"><Icon name="i-back" /></span>
              <span class="nv-title">MCP</span>
              <span class="nv-count">{mcpLabel === 'none' ? '0' : mcpLabel} active · {snap.mcpServers.length} servers</span>
            </button>
            <div class="pk-rule"></div>
            <div class="mcp-list">
              {#each snap.mcpServers as s (s.name)}
                <button class="mcp-row" class:on={s.enabled} class:off={!s.enabled}
                  onclick={() => void store.setMcp(s.name, !s.enabled, id)}>
                  <span class="mcp-ico" class:live={s.status === 'connected'}
                    class:err={s.status === 'failed' || s.status === 'needs-auth'}>
                    <Icon name="i-plug" />
                  </span>
                  <span class="mcp-name">{s.name}<span class="sub-line">{mcpBlurb(s)}</span></span>
                  <span class="pk-right">
                    {#if s.status === 'failed' || s.status === 'needs-auth'}
                      <span class="warn-ico" title={mcpBlurb(s)}><Icon name="i-warn" /></span>
                    {/if}
                    {#if s.enabled}
                      <span class="pk-check"><Icon name="i-check" /></span>
                    {:else}
                      <span class="mcp-slot"></span>
                    {/if}
                  </span>
                </button>
              {/each}
              {#if snap.mcpServers.length === 0}
                <!-- Non è un guasto: questa cartella non ne ha, o la chat è nata prima
                     che STARK sapesse chiederglielo. Dirlo è meglio di un elenco vuoto. -->
                <div class="pk-empty"><Icon name="i-plug" /><span>no servers here<span
                  class="sub-line">Nothing configured for this folder. `claude mcp add` in a
                  terminal, then wake this chat.</span></span></div>
              {/if}
            </div>
          </div>
        {:else if menu === 'mode'}
          <div class="leadbox popup" bind:this={menuEl}>
            <button class="pk-nav" onclick={() => { menu = 'root' }}>
              <span class="back"><Icon name="i-back" /></span>
              <span class="nv-title">Mode</span>
            </button>
            <div class="pk-rule"></div>
            {#each modeOpt?.choices ?? [] as c (c.value)}
              <button class="pop-item" class:dis={!c.available} disabled={!c.available}
                onclick={() => { void store.setOption(modeOpt!.id, c.value, id); chiudiMenu() }}>
                <span class="ico"><Icon name={MODE_ICON[c.value] ?? 'i-shield'}
                  style={c.value === modeOpt!.value ? 'color:var(--accent)' : ''} /></span>
                <span class="lbl">{c.label ?? c.value}<span class="sub"
                  >{c.reason ?? c.note ?? MODE_BLURB[c.value] ?? ''}</span></span>
                {#if !c.available}<span class="tagx">unavailable</span>
                {:else if c.value === modeOpt!.value}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
              </button>
            {/each}
          </div>
        {:else if menu === 'reasoning'}
          <div class="leadbox popup" bind:this={menuEl}>
            <button class="pk-nav" onclick={() => { menu = 'root' }}>
              <span class="back"><Icon name="i-back" /></span>
              <span class="nv-title">Reasoning</span>
            </button>
            <div class="pk-rule"></div>
            {#each reasoningOpt?.choices ?? [] as c (c.value)}
              <button class="pop-item" class:dis={!c.available} disabled={!c.available}
                onclick={() => { void store.setOption('reasoning', c.value, id); chiudiMenu() }}>
                <span class="ico"><Icon name="i-brain"
                  style={c.value === reasoningOpt!.value ? 'color:var(--accent)' : ''} /></span>
                <span class="lbl">{c.label ?? c.value}<span class="sub"
                  >{c.reason ?? c.note ?? ''}</span></span>
                {#if !c.available}<span class="tagx">unavailable</span>
                {:else if c.value === reasoningOpt!.value}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
              </button>
            {/each}
          </div>
        {:else if menu === 'effort'}
          <div class="leadbox popup" bind:this={menuEl}>
            <button class="pk-nav" onclick={() => { menu = 'root' }}>
              <span class="back"><Icon name="i-back" /></span>
              <span class="nv-title">Effort</span>
            </button>
            <div class="pk-rule"></div>
            {#each effortOpt?.choices ?? [] as c (c.value)}
              <button class="pop-item" class:dis={!c.available} disabled={!c.available}
                onclick={() => { void store.setOption('effort', c.value, id); chiudiMenu() }}>
                <span class="ico"><Icon name="i-bolt"
                  style={c.value === effortOpt!.value ? 'color:var(--accent)' : ''} /></span>
                <span class="lbl">{c.label ?? c.value}<span class="sub"
                  >{c.reason ?? c.note ?? ''}</span></span>
                {#if !c.available}<span class="tagx">unavailable</span>
                {:else if c.value === effortOpt!.value}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
              </button>
            {/each}
          </div>
        {:else}
           <!-- Il menu radice: prima il modello corrente (blocco cliccabile → picker),
                poi dove si sta (cartella e ramo), cosa si può dare al modello e quanto
                ne resta. La riga «Model» vecchia sopra al Context è rimossa: questo
                blocco è la nuova via. -->
           <div class="leadbox popup" bind:this={menuEl}>
             {@render modelTop()}
             <div class="divider"></div>

             <button class="pop-item" class:dis={!puoAllegare} disabled={!puoAllegare}
              title={puoAllegare ? `Attach a file — ${nomiBrevi(tipi)}` : `${nomeModello} doesn't read attachments`}
              onclick={() => fileInput?.click()}>
              <span class="ico"><Icon name="i-file" /></span>
              Choose file
            </button>

            <div class="divider"></div>

            {#if modeOpt}
              <button class="pop-item" class:dis={!modificabile('mode')} disabled={!modificabile('mode')}
                title={modificabile('mode') ? 'Permissions mode' : "This agent can't change its mode from here"}
                onclick={() => { menu = 'mode' }}>
                <span class="ico"><Icon name={MODE_ICON[modeOpt.value] ?? 'i-shield'} /></span>
                Mode
                <span class="cur">{modeOpt.value} <span class="chev"><Icon name="i-fwd" /></span></span>
              </button>
            {/if}
            <button class="pop-item" onclick={() => { menu = 'mcp' }}>
              <span class="ico"><Icon name="i-plug" /></span>
              MCP
              <span class="cur">{mcpLabel === 'none' ? '0' : mcpLabel} active <span class="chev"><Icon name="i-fwd" /></span></span>
            </button>
            {#if reasoningOpt}
              <button class="pop-item" disabled={!live}
                onclick={() => { menu = 'reasoning' }}>
                <span class="ico"><Icon name="i-brain" /></span>
                Reasoning
                <span class="cur">{reasoningOpt.value} <span class="chev"><Icon name="i-fwd" /></span></span>
              </button>
            {/if}
            {#if effortOpt}
              <button class="pop-item" disabled={!live}
                onclick={() => { menu = 'effort' }}>
                <span class="ico"><Icon name="i-bolt" /></span>
                Effort
                <span class="cur">{effortOpt.value} <span class="chev"><Icon name="i-fwd" /></span></span>
              </button>
            {/if}

            {@render usagePanel()}
          </div>
        {/if}
      {/if}

      <!-- L'anteprima al passaggio del mouse: solo prima di un clic — appena il
           menu vero si apre queste stesse righe sono già lì dentro, mostrarle due
           volte sarebbe un doppione — e solo con un mouse davvero (`hoverPreview`
           non parte da tocco, vedi la sua definizione). Qui il modello si mostra
           come **blocco** (scheda in testa al picker), non come riga cliccabile
           «Model › Opus». -->
      {#if hoverPreview && !aperto && !store.narrow && (currentCard || modelOpt || contextWindow || haFinestre)}
        <div class="leadbox popup preview">
          {@render modelBlock()}
          {@render usagePanel(true)}
        </div>
      {/if}

      {#if allegati.length > 0}
        <!-- Gli allegati in attesa di partire: chip sopra la riga, allineati al campo
             (il lead occupa 40px più i due gap). Un'immagine si guarda, un file si
             legge per nome. -->
        <div class="chips">
          {#each allegati as a, i (a.data.slice(0, 32) + i)}
            <span class="chip">
              {#if a.type === 'image'}
                <img class="thumb" src={`data:${a.mediaType};base64,${a.data}`} alt={a.name ?? 'attachment'} />
              {:else}
                <Icon name="i-file" />
              {/if}
              <span class="n">{a.name ?? (a.type === 'image' ? 'pasted image' : 'pasted file')}</span>
              <button class="x" aria-label="Remove"
                onclick={() => { allegati = allegati.filter((_, j) => j !== i) }}>
                <Icon name="i-x" />
              </button>
            </span>
          {/each}
        </div>
      {/if}

      {#if busy}
        <!-- Da telefono lo stop non sta nella riga: la lascerebbe con due bottoni e il
             pollice già occupato a scrivere. Sta in una striscia sopra, allineato
             all'invio — dove l'occhio va comunque a guardare se c'è risposta. -->
        <div class="run-strip">
          <button class="btn-round stop" title="Stop" onclick={() => void store.stop(id)}>
            <Icon name="i-stop" />
          </button>
        </div>
      {/if}

      <div class="composer">
        <!-- Nascosto apposto: è la voce «Choose file» del menu a fare da etichetta,
             non i controlli grigi di sistema che un <input type=file> porta di suo. -->
        <input class="filepick" type="file" accept={filtroFile(tipi)} multiple
          bind:this={fileInput} onchange={scegli} tabindex="-1" aria-hidden="true" />

        <!-- Il lead (+): allegati, modalità, strumenti, modello, consumo. L'anello è
             il contesto: la stessa percentuale della riga «Context» del menu, disegnata
             attorno al bottone che la apre. Ambra e rosso alle soglie di sempre. -->
        <div class="lead-wrap" class:open={aperto}
          style="--ctx:{pct ?? 0};--ring:{pct !== null ? meterColour(pct) : 'var(--accent)'}">
          <button class="lead" title="Attachments and usage"
            onpointerenter={e => {
              peek()
              void store.caricaCatalogo()
              // Solo il mouse: da tocco `pointerenter` precede il tap che apre il
              // menu vero comunque, e l'anteprima farebbe solo da lampo in mezzo.
              if (e.pointerType === 'mouse') hoverPreview = true
            }}
            onpointerleave={() => { hoverPreview = false }}
            onclick={chooseMenu} aria-label="Attachments and usage">
            <Icon name="i-plus" class={aperto ? 'rot' : ''} />
          </button>
        </div>

        <div class="field">
          <textarea
            class="input"
            onpaste={incolla}
            bind:this={box}
            bind:value={text}
            oninput={e => { chiuso = false; chiusoAt = false; segnaCaret(e); grow() }}
            onkeydown={key}
            onkeyup={segnaCaret}
            onclick={segnaCaret}
            onselect={segnaCaret}
            onblur={() => { files = [] }}
            rows="1"
            placeholder={`Message ${nomeLeggibile}…`}
          ></textarea>
          <!-- Mentre lavora: lo sweep corre sul bordo basso del campo. È il posto del
               vecchio riquadro «cosa sta facendo»: il racconto di ciò che fa sta nel
               flusso della conversazione, qui serve solo dire «sta lavorando». -->
          {#if busy}<div class="beam"></div>{/if}
        </div>

        <div class="actions">
          {#if busy}
            <!-- Su schermo largo lo stop sta qui, accanto all'invio come da DS; su
                 stretto la regola lo sposta nella striscia sopra. -->
            <button class="btn-round stop wide" title="Stop" onclick={() => void store.stop(id)}>
              <Icon name="i-stop" />
            </button>
          {/if}
          <!-- Invio manda già da tastiera (vedi `key`): il bottone non sostituisce
               quello, è per chi preme piuttosto che scrivere — da telefono soprattutto,
               dove «premi Invio» non è mai stato scontato quanto su una tastiera vera.
               Mentre lavora resta premibile se c'è testo: accoda. -->
          <button class="btn-round send" class:off={!text.trim() && allegati.length === 0}
            title="Send" type="button"
            onclick={() => void send()}>
            <Icon name="i-send" />
          </button>
        </div>
      </div>
    </div>
  {:else}
    <!-- Senza un processo dietro, una casella che accetta un messaggio lo perde. Al
         suo posto la via per riaprire — e il prezzo, detto adesso e non scoperto
         dopo dal contatore: risvegliare rilegge tutto il contesto, quindi costa quota.
         Lo Sleep libera memoria, non quota. -->
    <div class="asleep">
      <div class="t">
        {snap.state === 'sleeping' ? 'This chat is asleep.' : 'This chat has no process behind it.'}
      </div>
      <div class="d">
        {#if pending}It stopped while it was waiting for an answer from you.{/if}
        Reopening it re-reads the whole conversation, which costs quota.
      </div>
      <button class="btn pri" disabled={store.working || !rigaPannello}
        onclick={() => { if (rigaPannello) void store.wake(rigaPannello) }}>
        {store.working ? 'Reopening…' : 'Reopen'}
      </button>
    </div>
  {/if}
</div>

<style>
  /* La zona del composer è l'ancora dei menu: i popup del lead salgono da qui, e
     `position:relative` qui li tiene vicini al bottone che li apre. */
  .composer-zone { position: relative; }
  /* La scala è quella del resto dell'app, non quella del mockup: voci di menu 10.5px,
     vecchia casella 12.5px, bottoni 30px. Il DS v10 era disegnato a 14px/44px e al
     primo giro l'avevo seguito tal quale — l'utente l'ha fatto ridurre due volte
     (31 agosto 2026): «il font è enorme, i bottoni sono enormi, stona col resto».
     La struttura del DS resta (lead con anello, campo pillola, stop accanto
     all'invio, sweep); le misure ora sono quelle condivise con tutto il resto. */
  .composer { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }

  /* Il lead (+) con l'anello di contesto: un cono che si riempie della percentuale.
     Il colore parte dall'accento e segue le soglie delle barre — è la stessa misura
     in due posti, non due misure. */
  .lead-wrap {
    position: relative; flex: none; width: 32px; height: 32px; border-radius: 50%;
    background: conic-gradient(var(--ring, var(--accent)) calc(var(--ctx, 0) * 1%), var(--line-2) 0);
    padding: 2px; flex-shrink: 0;
  }
  .lead {
    width: 100%; height: 100%; border-radius: 50%; background: var(--surface); border: none;
    display: flex; align-items: center; justify-content: center; color: var(--muted);
    cursor: pointer; transition: .15s; font: inherit; padding: 0;
  }
  .lead:hover, .lead-wrap.open .lead { background: var(--surface-2); color: var(--ink); }
  .lead :global(svg.ic) { width: 15px; height: 15px; transition: transform .15s; }
  .lead :global(svg.ic.rot) { transform: rotate(45deg); }

  /* Il campo è una pillola da 34px: la textarea sta dentro nuda, senza bordi, e la
     cornice la disegna il contenitore — il focus ring pure. `font-family` va detto
     esplicitamente: in app.css esiste un'ALTRA classe `.field` (di un dialogo) che
     mette `var(--mono)`, e senza la dichiarazione qui quella globale entra — misurato:
     la casella scriveva in JetBrains Mono, e l'utente l'ha vista subito. */
  .field {
    flex: 1; position: relative; min-height: 34px; display: flex; align-items: center;
    padding: 4px 18px; border: 1px solid var(--line-2); border-radius: 20px;
    background: var(--surface-2); overflow: hidden; font-family: var(--sans);
  }
  .field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  textarea.input {
    display: block; resize: none; overflow-y: auto; width: 100%;
    /* `margin: 0` non è cosmesi: la regola globale `.input` di app.css (nata per la
       casella vecchia, fuori dalla pillola) mette 8px di margine verticale, e dentro
       il campo quegli 8+8 alzano la pillola oltre il suo min-height — misurato:
       46,3 invece di 40. */
    margin: 0;
    /* 12px, quello della conversazione e del body: era 12.5, e l'utente lo ha visto
       ancora grande rispetto al resto. La famiglia è detta due volte — qui e su
       `.field` — perché la globale `.field` di app.css porta il mono (vedi sopra). */
    /* Line-height e tetto sono **multipli di riga intera** (17.5 × 8 = 140): con un
       tetto non allineato (160 su 17,4 = 9,2 righe) l'ultima riga visibile restava
       tagliata a metà glifo sul bordo — «il testo viene troncato» visto e segnalato
       dall'utente. La misura in grow() arrotonda alla riga intera successiva. */
    font: inherit; font-family: var(--sans); font-size: 12px; line-height: 17.5px;
    background: transparent; color: var(--ink); max-height: 140px;
    border: none; outline: none; padding: 0;
  }
  textarea.input::placeholder { color: var(--muted); }

  /* Lo sweep mentre lavora: un fascio che corre **attorno a tutto il bordo** della
     pillola, non solo sul fondo (chiesto dall'utente, 31 agosto 2026). La scia è un
     conic-gradient che ruota (`@property` anima l'angolo di partenza) e la maschera
     taglia via l'interno, lasciando visibile solo l'anello del bordo: si vedrà un
     puntino di luce che gira lungo il perimetro arrotondato. Il nome della variabile
     è `--stark-beam`, non `--beam`: un `@property` è globale al documento, e un nome
     generico litigherebbe con chiunque altro lo definisca. Se il motore non conosce
     `@property` il fascio resta fermo in una posizione: degradazione visibile, non
     rotta — dice ancora «sta lavorando». */
  @property --stark-beam {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }
  .field .beam {
    position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    padding: 1.5px;
    background: conic-gradient(from var(--stark-beam),
      transparent 0deg, var(--accent) 55deg, transparent 120deg);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#fff 0 0) content-box exclude, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: beam-giro 2.2s linear infinite;
  }
  @keyframes beam-giro { to { --stark-beam: 360deg } }

  /* I due bottoni tondi a destra: invio pieno, stop corniciato di rosso. Spento non è
     nascosto: un invio grigio dice «non hai niente da mandare». */
  .actions { display: flex; align-items: center; gap: 7px; flex: none; }
  .btn-round {
    width: 30px; height: 30px; border-radius: 50%; border: 1px solid transparent;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    transition: .15s; background: transparent; font: inherit; padding: 0; flex-shrink: 0;
  }
  .btn-round :global(svg.ic) { width: 14px; height: 14px; }
  .stop { border-color: var(--line-2); color: var(--stop); background: var(--surface); }
  .stop:hover { border-color: var(--stop); background: var(--stop-bg); }
  .send { background: var(--accent); color: var(--on-accent); border: none; }
  .send:hover { filter: brightness(.93); }
  .send.off { background: var(--surface-2); color: var(--muted); cursor: default; filter: none; }

  /* La striscia dello stop da telefono: sopra la riga, allineata a destra. */
  .run-strip { display: none; align-items: center; justify-content: flex-end; margin: 0 12px 5px 0; }

  /* I chip degli allegati: allineati al campo, non al lead. */
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 12px 5px 52px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 7px 0 8px;
    background: var(--surface-2); border: 1px solid var(--line); border-radius: 7px;
    font-family: var(--mono); font-size: 10px; max-width: 220px;
  }
  .chip :global(svg.ic) { width: 11px; height: 11px; flex: none; color: var(--muted); }
  .chip .thumb { width: 14px; height: 14px; object-fit: cover; border-radius: 4px; flex: none; }
  .chip .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
  .chip .x { border: 0; background: none; color: var(--muted); cursor: pointer; display: flex; padding: 0; }
  .chip .x:hover { color: var(--ink); }
  .chip .x :global(svg.ic) { width: 11px; height: 11px; }

  /* ── i menu del lead ──────────────────────────────────────────────────────
     Un contenitore solo, ancorato sopra la riga: il radice (328px), le navigazioni
     Mode/MCP (stessa larghezza) e il picker (440px). Il padding è di 4px perché la
     casella di ricerca del picker vi si incolla con i suoi margini negativi. */
  .leadbox {
    position: absolute; left: 16px; bottom: calc(100% + 8px); z-index: 8;
    background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px;
    box-shadow: 0 18px 44px rgba(16, 20, 32, .16); padding: 4px;
  }
  .leadbox.popup { width: 300px; }
  /* 380 e non 440: i 440 erano del mockup a 13px; a 12px i nomi entrano con meno
     spazio e il pannello non deve mangiare mezza conversazione (chiesto
     dall'utente). Le colonne a destra restano fisse: a stringere è il nome. */
  .leadbox.picker { width: 380px; }

  .pop-head {
    display: flex; align-items: center; gap: 7px; padding: 7px 9px 8px;
    font-family: var(--mono); font-size: 10.5px; color: var(--muted);
  }
  .pop-head .g {
    display: flex; align-items: center; gap: 6px; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pop-head :global(svg.ic) { width: 12px; height: 12px; color: var(--muted); flex: none; }
  .pop-head .sep { width: 1px; height: 11px; background: var(--line-2); flex: none; }
  .divider { height: 1px; background: var(--line); margin: 5px 8px; }

  .pop-item {
    display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 9px;
    border-radius: 7px; font: inherit; font-size: 12px; color: var(--ink);
    background: none; border: 0; width: 100%; text-align: left; cursor: pointer;
  }
  .pop-item:hover:not(:disabled) { background: var(--surface-2); }
  .pop-item:disabled { opacity: .5; cursor: default; }
  .pop-item .ico { color: var(--muted); display: flex; flex: none; width: 14px; justify-content: center; }
  .pop-item .ico :global(svg.ic) { width: 13px; height: 13px; }
  .pop-item .ico img { border-radius: 3px; filter: var(--icon-f); display: block; }
  .pop-item .lbl { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; min-height: 0; }
  .pop-item .lbl .sub { font-size: 9.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pop-item .cur {
    margin-left: auto; display: flex; align-items: center; gap: 6px;
    font-family: var(--mono); font-size: 10.5px; color: var(--muted);
  }
  .pop-item .tagx { font-size: 10.5px; color: var(--muted); }
  .chev { color: var(--muted); display: flex; }
  .chev :global(svg.ic) { width: 12px; height: 12px; }
  .mdot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); display: inline-block; }

  /* Le righe di navigazione (indietro + titolo + conteggio) dei sottomenu Mode/MCP:
     le stesse del picker, ripetute qui perché gli stili del picker sono suoi. */
  .leadbox .pk-nav {
    display: flex; align-items: center; gap: 9px; padding: 7px 9px; cursor: pointer;
    border: 0; background: none; font: inherit; width: 100%; text-align: left; color: inherit;
  }
  .leadbox .pk-nav:hover { background: var(--surface-2); border-radius: 7px; }
  .leadbox .pk-nav .back { width: 20px; height: 20px; flex: none; color: var(--muted);
    display: flex; align-items: center; justify-content: center; }
  .leadbox .pk-nav :global(svg.ic) { width: 14px; height: 14px; }
  .leadbox .pk-nav .nv-title { font-size: 12px; font-weight: 600; color: var(--ink); }
  .leadbox .pk-nav .nv-count { margin-left: auto; font-family: var(--mono); font-size: 10px; color: var(--muted); }
  .leadbox .pk-rule { height: 1px; background: var(--line); margin: 2px 5px 3px; }

  /* ── il pannello MCP ────────────────────────────────────────────────────── */
  .mcp-list { max-height: 322px; overflow-y: auto; padding: 0 0 3px; }
  .mcp-list::-webkit-scrollbar { width: 8px; }
  .mcp-list::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 8px; border: 2px solid var(--surface); }
  .mcp-row {
    display: flex; align-items: center; gap: 9px; padding: 6px 9px; cursor: pointer;
    border: 0; background: none; font: inherit; width: 100%; text-align: left; color: inherit;
    border-radius: 8px;
  }
  .mcp-row:hover { background: var(--surface-2); }
  .mcp-row.on { background: var(--surface-2); }
  .mcp-ico { width: 18px; flex: none; display: flex; justify-content: center; color: var(--muted); }
  .mcp-ico :global(svg.ic) { width: 14px; height: 14px; }
  .mcp-ico.live { color: var(--done); }
  .mcp-ico.err { color: var(--wait); }
  .mcp-name { flex: 1; min-width: 0; font-size: 12px; color: var(--ink);
    display: flex; flex-direction: column; line-height: 1.3; }
  .mcp-row.off .mcp-name { color: var(--muted); }
  .mcp-name .sub-line { font-size: 9.5px; color: var(--muted); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .mcp-slot { width: 13px; height: 13px; flex: none; }
  .pk-right { display: flex; align-items: center; gap: 8px; flex: none; }
  .warn-ico { color: var(--wait); display: flex; }
  .warn-ico :global(svg.ic) { width: 13px; height: 13px; }
  .pk-check { color: var(--accent); display: flex; }
  .pk-check :global(svg.ic) { width: 13px; height: 13px; }
  .pk-empty { display: flex; align-items: center; gap: 7px; padding: 9px; color: var(--muted); font-size: 11.5px; }
  .pk-empty :global(svg.ic) { width: 13px; height: 13px; flex: none; }
  .pk-empty .sub-line { display: block; font-size: 10.5px; }

  /* ── anteprima hover: blocco modello come in testa al picker (ModelPicker .pk-head/.pk-meta) ── */
  .preview-head { display:flex; align-items:flex-start; gap:9px; padding:10px 11px 0; }
  .preview-head.fallback { padding-bottom:8px; }
  .preview-head .pk-avatar { width:32px; height:32px; flex:none; border-radius:9px; background:var(--surface-2);
    border:1px solid var(--line-2); display:flex; align-items:center; justify-content:center; color:var(--ink); }
  .preview-head .pk-avatar img { filter:var(--icon-f); }
  .preview-head .pk-id { min-width:0; flex:1; }
  .preview-head .pk-name { font-size:12.5px; font-weight:600; color:var(--ink); line-height:1.3;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .preview-head .pk-name .mult { font-weight:500; color:var(--muted); }
  .preview-head .pk-path { display:flex; align-items:center; gap:5px; margin-top:2px;
    font-family:var(--mono); font-size:10px; color:var(--muted); white-space:nowrap; overflow:hidden; }
  .preview-head .pk-path .arw { opacity:.6; flex:none; }
  .preview-head .pk-caps { display:flex; gap:6px; color:var(--muted); flex:none; padding-top:2px; }
  .preview-head .pk-caps :global(svg.ic) { width:13px; height:13px; }
  .preview-head .pk-caps :global(svg.ic.off) { opacity:.32; }
  .preview .pk-meta { display:flex; align-items:center; gap:7px; padding:8px 11px 9px; font-family:var(--sans); }
  .preview .pk-meta :global(svg.ic) { width:10px; height:10px; }
  .preview .pk-meta .cash { color:var(--muted); display:flex; }
  .preview .pk-meta .unit { font-family:var(--sans); font-size:9px; color:var(--muted); }
  .preview .pk-meta .price { font-family:var(--sans); font-size:10px; color:var(--ink); }
  .preview .pk-meta .price.free { color:var(--accent); }
  .preview .pk-meta .ctx-lbl { margin-left:10px; font-size:8px; font-weight:600; letter-spacing:-0.02em; color:var(--muted); font-stretch:condensed; }
  .preview .pk-meta .ctx-val { font-family:var(--sans); font-size:10px; color:var(--ink); }
  /* Hover: un solo separatore, da bordo a bordo (il popup ha padding 4px) */
  .preview .pk-rule { margin:8px -4px 0; }
  /* Footer hover con repo/branch, e footer espanso con repo/branch + flat a destra */
  .u-foot.hover-foot { justify-content:flex-start; }
  .u-foot .g-foot, .u-foot.hover-foot { display:flex; align-items:center; gap:7px; }
  .u-foot .g { display:flex; align-items:center; gap:6px; font-family:var(--mono); font-size:8.5px; color:var(--muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .u-foot .g :global(svg.ic) { width:12px; height:12px; color:var(--muted); flex:none; }
  .u-foot .sep { width:1px; height:11px; background:var(--line-2); flex:none; }
  /* Seconda riga del blocco modello nell'espanso: stesso stile dell'hover ma senza .preview */
  .model-top .pk-meta { display:flex; align-items:center; gap:7px; padding:6px 0 0; font-family:var(--sans); }
  .model-top .pk-meta :global(svg.ic) { width:10px; height:10px; }
  .model-top .pk-meta .cash { color:var(--muted); display:flex; }
  .model-top .pk-meta .unit { font-family:var(--sans); font-size:9px; color:var(--muted); }
  .model-top .pk-meta .price { font-family:var(--sans); font-size:10px; color:var(--ink); }
  .model-top .pk-meta .price.free { color:var(--accent); }
  .model-top .pk-meta .ctx-lbl { margin-left:10px; font-size:8px; font-weight:600; letter-spacing:-0.02em; color:var(--muted); font-stretch:condensed; }
  .model-top .pk-meta .ctx-val { font-family:var(--sans); font-size:10px; color:var(--ink); }

  /* Bottone modello in cima al menu espanso: lo stesso blocco dell'hover ma cliccabile */
  .model-top { display:flex; align-items:center; gap:8px; width:100%; padding:8px 9px; border-radius:8px;
    background:none; border:0; cursor:pointer; text-align:left; font:inherit; color:inherit; }
  .model-top:hover:not(:disabled) { background:var(--surface-2); }
  .model-top:disabled { opacity:.5; cursor:default; }
  .model-top .model-top-main { flex:1; min-width:0; }
  .model-top .chev { color:var(--muted); display:flex; flex:none; align-self:center; }
  .model-top .chev :global(svg.ic) { width:12px; height:12px; }

  /* ── il pannello d'uso ────────────────────────────────────────────────────
     Tre righe invece di tre blocchi: etichetta, barra, percentuale, costo. La colonna
     del costo è larga fissa anche dove è vuota: l'allineamento delle barre vale più
     di quattro pixel risparmiati. */
  .usage { padding: 4px 9px 8px; }
  .u-row { display: flex; align-items: center; gap: 8px; height: 22px; }
  .u-lbl { width: 58px; flex: none; font-size: 11px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .u-bar { flex: 1; height: 3px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .u-bar span { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
  .u-pct { width: 30px; flex: none; text-align: right; font-family: var(--mono);
    font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
  /* `near`, non `warn`: il nome collide con la `.warn` globale di `app.css` (il
     riquadro d'avviso, con fondo `--wait-bg`, padding e display:flex) — applicata
     a questi span faceva una pillola gialla attorno alla percentuale, chiesta
     via dall'utente il 1º settembre 2026. Qui il colore basta. */
  .u-pct.near { color: var(--wait); }
  .u-pct.crit { color: var(--stop); }
  .u-cost { width: 48px; flex: none; text-align: right; font-family: var(--mono);
    font-size: 10.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .u-foot {
    display: flex; justify-content: space-between; margin-top: 8px; padding-top: 7px;
    border-top: 1px solid var(--line); font-family: var(--mono); font-size: 8.5px; color: var(--muted);
  }

  /* La conferma del passaggio a un altro agent: le stesse regole che avevano le
     tendine della barra (`.pg`/`.pnote` stanno in app.css per `.hpop` e `.menu`,
     che non sono i contenitori di qui). */
  .pg {
    font-size: 9px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase;
    color: var(--muted); padding: 9px 10px 2px;
  }
  .pnote {
    display: flex; align-items: flex-start; gap: 5px; margin: 0 4px 4px; padding: 5px 7px;
    font-size: 10.5px; color: var(--muted); white-space: normal; line-height: 1.45;
  }
  .pnote :global(svg.ic) { width: 11px; height: 11px; flex: none; color: var(--wait); margin-top: 1px; }

  /* Le righe sono <button> perché si premono; il vestito viene da app.css. */
  .slash .mi {
    width: 100%; background: none; border: 0; font: inherit; color: inherit;
    text-align: left; cursor: pointer;
  }
  /* Il `background: none` qui sopra è più specifico di `.mi.on` in app.css e se lo
     mangiava: la riga scelta con le frecce restava invisibile, cioè il menu non si
     poteva usare da tastiera — che è il modo in cui lo si usa. */
  .slash .mi.on { background: var(--accent-soft); }
  .slash .mi:hover:not(.on) { background: var(--surface-2); }
  .slash .mi:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  /* La riga di un file: l'icona dice subito se è una cartella o un file, che è la
     differenza che cambia cosa succede premendo Invio (si scende dentro, oppure si
     ha finito). Il nome in grassetto e il percorso spento perché a cercare si cerca
     il nome — la cartella serve a distinguere due file che si chiamano uguale. */
  .slash .mi.at { display: flex; align-items: center; gap: 7px; }
  .slash .mi.at :global(svg) { width: 12px; height: 12px; flex: none; color: var(--muted); }
  .slash .mi.at .txt { min-width: 0; }
  .slash .mi.at .line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  /* Il percorso cede per primo: di un file lungo si vuole vedere il nome, e la
     cartella tagliata resta comunque leggibile da sinistra. */
  .slash .mi.at .hint2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Mentre qualcosa passa sopra: un bordo, non un velo — il velo coprirebbe la
     conversazione, che è quello che si sta guardando per decidere cosa allegare. */
  .dock.sopra { outline: 2px dashed var(--accent); outline-offset: -4px; }

  .refused {
    display: flex; align-items: center; gap: 7px; padding: 6px 12px;
    background: var(--stop-bg); color: var(--stop); font-size: 10.5px; font-weight: 600;
  }
  .refused .x {
    margin-left: auto; background: none; border: 0; color: inherit; font: inherit; padding: 0 2px;
  }

  .asleep {
    margin: 0 12px 8px; padding: 9px 11px; border-radius: 9px;
    border: 1px dashed var(--line-2); background: var(--surface-2);
    display: flex; align-items: center; gap: 10px;
  }
  .asleep .t { font-size: 11.5px; font-weight: 600; color: var(--ink); }
  .asleep .d { font-size: 10px; color: var(--muted); flex: 1; }
  .asleep .btn { flex: none; }
  .asleep .btn[disabled] { opacity: .6; cursor: default; }

  /* L'`<input type=file>` reale resta invisibile ma raggiungibile da tastiera: un
     `display:none` lo toglierebbe anche da lì. */
  .filepick {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }

  /* Più aria ai lati da telefono: in un'app della schermata Home non c'è la cornice
     del browser attorno, e i chip finivano incollati al vetro. `env(safe-area-inset-*)`
     è quanto iOS chiede di stare lontani da notch e angoli arrotondati; `max()` fa sì
     che in una scheda normale, dove quegli inset sono zero, resti comunque il margine
     nostro. Sta qui e non in app.css perché la riga è scoped: il padding della pillola
     lo decide questo blocco. Da stretto lo stop lascia la riga e sale nella striscia,
     e i menu del lead diventano fogli: stessi due bordi, angoli più morbidi, e per il
     menu radice la maniglia che dice «si può tirare giù». */
  @media (max-width: 860px) {
    .composer {
      padding-left: max(16px, env(safe-area-inset-left));
      padding-right: max(16px, env(safe-area-inset-right));
    }
    .chips { margin-left: max(52px, calc(env(safe-area-inset-left) + 52px)); }
    .run-strip { display: flex; }
    .actions .stop.wide { display: none; }
    /* Il foglio: stessa specificità delle larghezze fissate qui sopra, altrimenti
       `width:auto` perde contro `.leadbox.popup{width:328}` e il foglio esce dallo
       schermo — visto dalla sonda, non dedotto. */
    .leadbox,
    .leadbox.popup,
    .leadbox.picker { left: 12px; right: 12px; width: auto; border-radius: 16px; }
    .leadbox.popup::before {
      content: ""; display: block; width: 34px; height: 3px; border-radius: 3px;
      background: var(--line-2); margin: 5px auto 6px;
    }
    .leadbox :global(.pk-list) { max-height: 200px; }
  }
</style>
