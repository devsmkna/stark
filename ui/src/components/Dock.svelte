<script lang="ts">
  // Il blocco in basso: tutto ciò che si comanda sta qui, attorno alla casella.
  //
  // È sempre lo stesso pezzo di schermo in tre stati — mentre lavora dice cosa sta
  // facendo, quando ha bisogno di te si espande, e sotto c'è la barra che si preme.
  // Non è una disposizione comoda: è la conseguenza di non far comparire le richieste
  // in mezzo alla conversazione (vedi Ask.svelte).
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import Ask from './Ask.svelte'
  import Status from './Status.svelte'
  import type { SessionSnapshot } from '$core/reduce.ts'
  import type { Attachment, SlashCommand } from '$core/events.ts'
  import {
    filtroFile, modelloInUso, nomiBrevi, parteDi, tipiAccettati, tipoDi,
  } from '$core/allegati.ts'
  import { activity } from '$core/activity.ts'
  import { activityText, since } from '../lib/view.ts'
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
  // L'orologio che fa avanzare «3s». Batte solo mentre serve: un intervallo che gira
  // su una chat ferma ridisegnerebbe la pagina una volta al secondo per niente.
  let now = $state(Date.now())

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
  const op = $derived(busy ? activity(snap) : null)

  $effect(() => {
    if (!busy) return
    const t = setInterval(() => { now = Date.now() }, 1000)
    return () => clearInterval(t)
  })

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
    const ok = await store.prompt(draft, addosso)
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
   * la barra di stato mostra due centimetri più sotto. L'etichetta sarebbe «Default
   * (recommended)», che in mezzo a un rifiuto è una frase invece di un nome.
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
    void store.files(c.q).then(async r => {
      if (mio !== giro) return
      // Un solo ritentativo, e solo su una risposta vuota a una ricerca vera: nei
      // primi ~1,8s di una chat il CLI sta ancora costruendo l'indice dei file e
      // risponde «niente» a qualunque cosa (misurato — è suo, non nostro). Senza
      // questo, chi apre una chat e scrive subito `@src` resta a mani vuote finché
      // non tocca un altro tasto. Con la query vuota no: lì «niente» è una risposta.
      if (r.length === 0 && c.q !== '') {
        await new Promise(res => setTimeout(res, 400))
        if (mio !== giro) return
        r = await store.files(c.q)
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
  function seguiScelta(menu: HTMLElement | null): void {
    menu?.querySelector('.mi.on')?.scrollIntoView({ block: 'nearest' })
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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
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
</script>

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
    <Ask {store} {snap} canStop={live} />
  {:else if op}
    <div class="doing">
      <span class="spin"></span>
      <div class="txt">{activityText(op)}</div>
      <div class="el">{since(op.from, now)}</div>
      {#if live}
        <button class="stopb" title="Stop" onclick={() => void store.stop()}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>
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

  {#if allegati.length > 0}
    <div class="allegati">
      {#each allegati as a, i (a.data.slice(0, 32) + i)}
        <div class="all">
          <!-- Un'immagine si guarda, un file si legge per nome: mettere un `<img>` su
               un PDF darebbe l'icona di immagine rotta su un allegato arrivato bene. -->
          {#if a.type === 'image'}
            <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name ?? 'attachment'} />
          {:else}
            <span class="doc"><Icon name="i-file" /></span>
          {/if}
          <span class="n">{a.name ?? (a.type === 'image' ? 'pasted image' : 'pasted file')}</span>
          <button class="x" aria-label="Remove"
            onclick={() => { allegati = allegati.filter((_, j) => j !== i) }}>✕</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if live}
    <div class="row-input">
      <!-- Nascosto apposta: è il bottone vestito da graffetta a fare da etichetta,
           non i controlli grigi di sistema che un <input type=file> porta di suo. -->
      <input class="filepick" type="file" accept={filtroFile(tipi)} multiple
        bind:this={fileInput} onchange={scegli} tabindex="-1" aria-hidden="true" />
      <!-- Spento, non nascosto: un modello che non legge allegati è un fatto da dire,
           e la graffetta che sparisce sembrerebbe un pezzo di STARK che manca. -->
      <button class="iconb attach" type="button" disabled={!puoAllegare}
        title={puoAllegare
          ? `Attach a file — ${nomiBrevi(tipi)}`
          : `${nomeModello} doesn't read attachments`}
        onclick={() => fileInput?.click()}>
        <Icon name="i-clip" />
      </button>
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
        placeholder="Message the agent…"
      ></textarea>
      <!-- Invio manda già da tastiera (vedi `key`): il bottone non sostituisce
           quello, è per chi preme piuttosto che scrivere — da telefono soprattutto,
           dove «premi Invio» non è mai stato scontato quanto su una tastiera vera. -->
      <button class="iconb send" title="Send" type="button"
        disabled={!text.trim() && allegati.length === 0}
        onclick={() => void send()}>
        <Icon name="i-send" />
      </button>
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
      <button class="btn pri" disabled={store.working || !store.row}
        onclick={() => { const r = store.row; if (r) void store.wake(r) }}>
        {store.working ? 'Reopening…' : 'Reopen'}
      </button>
    </div>
  {/if}

  <Status {store} {snap} {live} />
</div>

<style>
  /* La riga che porta graffetta, casella e invio — variante «pillola compatta»:
     bottoni quadrati/circolari ai lati, casella arrotondata che riempie lo spazio.
     Il padding sta sulla riga, non sulla casella: lei è tornata a riempire lo
     spazio che la riga le lascia, come qualunque figlio flessibile. */
  .row-input { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
  .row-input .input { flex: 1; margin: 0; width: auto; }
  /* La casella è un <textarea> vestito da pillola: stessa cornice, stesso passo,
     senza il bordo e la barra di scorrimento che il browser ci mette. */
  textarea.input {
    display: block; resize: none; overflow-y: auto;
    font: inherit; font-size: 12.5px; line-height: 1.45;
    background: var(--surface); color: var(--ink-2); max-height: 160px;
    border: 1px solid var(--line-2); border-radius: 20px; padding: 9px 14px;
  }
  textarea.input::placeholder { color: var(--muted); }

  /* La graffetta: un quadrato leggero, spento finché non ci si passa sopra. */
  .row-input .attach {
    width: 30px; height: 30px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: var(--muted); background: transparent; border: none;
    cursor: pointer; flex-shrink: 0;
  }
  .row-input .attach:hover { background: var(--surface-2); color: var(--ink-2); }
  .row-input .attach :global(svg) { width: 16px; height: 16px; }
  /* L'Invio: un cerchio pieno del colore di STARK. Spento finché non ha qualcosa
     da mandare: senza testo né allegati non c'è comando da dare, e un bottone
     acceso lo lascerebbe credere. */
  .row-input .send {
    width: 30px; height: 30px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent); color: #fff; border: none;
    cursor: pointer; flex-shrink: 0;
  }
  .row-input .send:hover { background: #8b7cf5; }
  .row-input .send[disabled] { opacity: .35; cursor: default; }
  .row-input .send :global(svg) { width: 15px; height: 15px; }
  .row-input .attach:disabled { opacity: .45; cursor: default; }
  .row-input .attach:disabled:hover { background: none; color: var(--muted); }
  /* L'`<input type=file>` reale resta invisibile ma raggiungibile da tastiera: un
     `display:none` lo toglierebbe anche da lì. */
  .filepick {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }

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

  /* Gli allegati in attesa di partire, sopra la casella. */
  .allegati { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .all {
    display: flex; align-items: center; gap: 6px; padding: 3px 6px 3px 3px;
    border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface-2);
    font-size: 10px; max-width: 240px;
  }
  .all img { width: 26px; height: 26px; object-fit: cover; border-radius: 5px; flex: none; }
  /* Il posto dell'anteprima quando non c'è niente da vedere: stessa misura, così una
     fila mista di immagini e documenti resta una fila e non una scala. */
  .all .doc {
    width: 26px; height: 26px; border-radius: 5px; flex: none;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface); color: var(--muted);
  }
  .all .doc :global(svg) { width: 13px; height: 13px; }
  .all .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
  .all .x {
    border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 11px;
    padding: 0 2px; line-height: 1;
  }
  .all .x:hover { color: var(--ink); }
  /* Mentre qualcosa passa sopra: un bordo, non un velo — il velo coprirebbe la
     conversazione, che è quello che si sta guardando per decidere cosa allegare. */
  .dock.sopra { outline: 2px dashed var(--accent); outline-offset: -4px; }
  textarea.input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

  .stopb:focus-visible { outline: 2px solid var(--stop); outline-offset: 1px; }

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
  /* Più aria ai lati da telefono: in un'app della schermata Home non c'è la cornice
     del browser attorno, e i chip finivano incollati al vetro. `env(safe-area-inset-*)`
     è quanto iOS chiede di stare lontani da notch e angoli arrotondati; `max()` fa sì
     che in una scheda normale, dove quegli inset sono zero, resti comunque il margine
     nostro. Sta qui e non in app.css perché la riga è scoped: il padding della pillola
     lo decide questo blocco. */
  @media (max-width: 860px) {
    .row-input {
      padding-left: max(16px, env(safe-area-inset-left));
      padding-right: max(16px, env(safe-area-inset-right));
    }
  }
</style>
