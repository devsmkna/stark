<script lang="ts">
  // I due stati bloccanti del blocco in basso: un permesso e una domanda.
  //
  // Non compaiono in mezzo alla conversazione, e non è un dettaglio di disposizione:
  // una richiesta che scorre via col flusso va cercata, e la si cerca proprio nel
  // momento in cui tutto è fermo ad aspettarla. Qui si guarda sempre nello stesso
  // posto. Nel flusso resta *cosa hai risposto*, dopo — ci pensa `applyTo`.
  //
  // Il pulsante per fermare resta visibile anche mentre il blocco è espanso: una
  // domanda arriva mentre l'agent sta ancora lavorando, e se lo Stop sparisse proprio
  // lì si perderebbe il controllo nel momento in cui serve di più.
  import Icon from './Icon.svelte'
  import type { SessionSnapshot } from '$core/reduce.ts'
  import type { AgentQuestion } from '$core/events.ts'
  import { label, permissionHeadline, tilde } from '../lib/view.ts'
  import { renderMarkdown, renderInline } from '../lib/markdown.ts'
  import { osservaPercorsi } from '../lib/percorsi.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap, canStop, id }:
    { store: Store; snap: SessionSnapshot; canStop: boolean; id: string } = $props()

  const permission = $derived(snap.pendingPermissions[0])
  const question = $derived(snap.pendingQuestions[0])
  /**
   * Il terzo stato bloccante: l'agent ha finito di pianificare e chiede di partire.
   *
   * Sta qui e non nel flusso per la stessa ragione degli altri due — è la cosa che
   * ferma tutto, e si guarda sempre nello stesso posto. Ma è **l'unico dei tre che
   * si legge** invece di riconoscersi a colpo d'occhio: un permesso è una riga, una
   * domanda è un titolo e delle opzioni, un piano è un documento. Per questo ha un
   * corpo che scorre e non un sommario.
   */
  const plan = $derived(snap.pendingPlans[0])
  /** Cosa cambiare, quando si rimanda a pianificare. Vuoto è legittimo: «no» da solo
   *  è una risposta, e obbligare a motivarla renderebbe più scomodo dire di no che
   *  dire di sì — che è esattamente il contrario di quello che serve. */
  let feedback = $state('')

  /**
   * I due bottoni dentro un percorso citato nel piano. Delegazione e non `onclick` per
   * bottone, perche' quei bottoni non sono elementi Svelte: li scrive `decoraPercorsi`
   * come DOM grezzo dentro l'HTML gia' reso. E' lo stesso gesto che la conversazione
   * gia' fa in `onProseClick`; qui e' ripetuto invece di condiviso perche' i due
   * componenti non hanno un contenitore in comune, ed estrarne uno per due chiamanti
   * costerebbe piu' di quanto risparmi.
   */
  async function onPathClick(e: MouseEvent): Promise<void> {
    const t = e.target as HTMLElement
    const cp = t.closest<HTMLElement>('[data-copy-path]')
    if (cp) {
      const p = cp.getAttribute('data-copy-path') ?? ''
      try { await navigator.clipboard.writeText(p) }
      catch { store.refused = 'the browser did not allow copying'; return }
      cp.classList.add('done')
      setTimeout(() => cp.classList.remove('done'), 3000)
      return
    }
    const rv = t.closest<HTMLElement>('[data-reveal-path]')
    if (rv) await store.reveal(rv.getAttribute('data-reveal-path') ?? '', snap.sessionId)
  }
  /** Le modalità in cui si può ripartire, prese dalla sessione e non da un elenco
   *  scritto qui: quali esistano e quali siano rifiutate lo sa l'adapter (§1), e da
   *  root `bypassPermissions` non c'è. */
  // L'ordine è imposto qui e non ereditato da `snap.modes`: quello è l'ordine in cui
  // l'agent elenca le sue modalità, che per questa domanda non vuol dire niente. Qui
  // la prima è quella che si preme quasi sempre — si è appena letto un piano e lo si
  // approva — e la seconda è la via più prudente accanto.
  const modiDopoIlPiano = $derived(
    (['acceptEdits', 'default'] as const)
      .map(m => snap.modes.find(x => x.mode === m))
      .filter(m => m !== undefined),
  )
  /**
   * Ogni risposta qui sotto va alla chat **di questo pannello** (`id`), non a quella
   * a fuoco: col multi-pannello due Ask sono montati insieme, e chi preme un bottone
   * da tastiera (Tab, poi Invio) non sposta prima il fuoco — col clic lo fa già il
   * pannello (`focusPane` al pointerdown), ma un comando non può dipendere da un
   * effetto laterale del gesto che lo innesca.
   */
  async function rispondiAlPiano(
    decision: 'approved' | 'rejected', mode?: string,
  ): Promise<void> {
    if (!plan) return
    const testo = feedback.trim()
    feedback = ''
    await store.send({
      c: 'plan.reply', requestId: plan.requestId, decision,
      ...(mode ? { mode: mode as never } : {}),
      ...(decision === 'rejected' && testo ? { feedback: testo } : {}),
    }, id)
  }
  const head = $derived(permission ? permissionHeadline(permission.action) : null)

  /**
   * Una richiesta porta da 1 a 4 domande, e sono domande DIVERSE: mostrarle tutte
   * insieme le fa leggere come un modulo da compilare, dove si risponde alla prima
   * guardando già la terza. Una alla volta, con i passi in cima, è come le fa il CLI
   * — e qui c'è in più che i passi si possono ripercorrere per rivedere.
   *
   * Per ogni domanda si sceglie **una** di tre strade, mai due insieme:
   * - `pick`    una o più opzioni fra quelle proposte (più d'una solo se `multiSelect`)
   * - `typed`   la propria risposta scritta a mano
   * - `discuss` non rispondo: parliamone. La domanda torna all'agent come richiesta di
   *             approfondimento, e vale **solo per quella** — le altre restano risposte.
   */
  type Choice =
    | { mode: 'pick'; labels: string[] }
    | { mode: 'typed'; text: string }
    | { mode: 'discuss' }

  /**
   * Cosa riceve l'agent quando una domanda è marcata «parliamone». Non è un codice da
   * interpretare: è la frase vera che gli arriva come risposta a quella domanda, ed è
   * il canale garantito dal contratto del tool (`answers`, una voce per domanda).
   */
  const DISCUSS = 'Let\'s talk this one through before I answer — walk me through the '
    + 'options and what each one costs, then ask me again.'

  // Le risposte in corso di composizione, azzerate a ogni richiesta nuova: `requestId`
  // nella chiave è ciò che impedisce a una scelta fatta per la domanda di prima di
  // ricomparire già spuntata in quella dopo.
  let draft = $state<Record<string, Choice>>({})
  let step = $state(0)
  let currentId = $state<string>('')

  $effect(() => {
    const id = question?.requestId ?? ''
    if (id !== currentId) { currentId = id; draft = {}; step = 0 }
  })

  const qs = $derived(question?.questions ?? [])
  // Il passo può restare indietro rispetto alla richiesta per un istante, mentre
  // `$effect` non ha ancora azzerato: `cur` può quindi essere `undefined`, e tutto
  // ciò che lo usa deve reggerlo invece di dare per scontato che ci sia.
  const cur = $derived(qs[step])

  const choice = (q: AgentQuestion): Choice | undefined => draft[q.question]
  const set = (q: AgentQuestion, c: Choice): void => { draft = { ...draft, [q.question]: c } }

  const answered = (q: AgentQuestion | undefined): boolean => {
    const c = q ? draft[q.question] : undefined
    if (!c) return false
    return c.mode === 'pick' ? c.labels.length > 0
      : c.mode === 'typed' ? c.text.trim().length > 0
        : true
  }

  const complete = $derived(qs.length > 0 && qs.every(q => answered(q)))

  /**
   * «Send answer» c'è sempre, anche su una domanda sola — scelta dell'utente, 28 agosto
   * 2026, insieme al ridisegno.
   *
   * Prima, su una domanda sola a scelta singola, cliccare un'opzione inviava di colpo:
   * la scelta *era* la conferma, e il bottone non compariva nemmeno. Risparmiava un
   * clic, e con le opzioni disegnate come pillole in fila era coerente — si premeva un
   * bottone, e premere un bottone fa succedere qualcosa. Con le opzioni a pallini no:
   * un pallino dice «questa è selezionata», non «è partita», e chi lo preme si aspetta
   * ancora un momento per rileggere prima di mandare.
   */
  function advance(): void {
    if (step < qs.length - 1) step += 1
  }

  /**
   * La raccomandazione non è un campo del protocollo: sta **dentro l'etichetta**. Il CLI
   * lo dice al modello alla lettera — «make that the first option in the list and add
   * "(Recommended)" at the end of the label», letto nel binario 2.1.241 bundled — quindi
   * si riconosce lì e non si aspetta un `recommended: true` che non arriverà.
   *
   * Mostrata si toglie dal testo, perché il badge la dice meglio e lasciarla anche
   * nell'etichetta la direbbe due volte. **Rimandata indietro no**: `answers` è indicizzato
   * per etichetta esatta, e ripulirla vorrebbe dire rispondere una cosa che non era fra
   * le opzioni. Per questo `clean` vive solo nel disegno e mai in `reply()`.
   *
   * Le due forme italiane sono una cortesia, non il contratto: il contratto è la parola
   * inglese, e l'agent che risponde in italiano a volte traduce anche quella.
   */
  const RECO = /\s*[(\[](?:recommended|consigliat[ao]|raccomandat[ao])[)\]]\s*$/i
  const isReco = (label: string): boolean => RECO.test(label)
  const clean = (label: string): string => label.replace(RECO, '')

  function pick(q: AgentQuestion, label: string): void {
    const c = choice(q)
    const labels = c?.mode === 'pick' ? c.labels : []
    if (q.multiSelect) {
      // A scelta multipla non si avanza da soli: non si può sapere quando ha finito.
      set(q, {
        mode: 'pick',
        labels: labels.includes(label) ? labels.filter(x => x !== label) : [...labels, label],
      })
      return
    }
    set(q, { mode: 'pick', labels: [label] })
    advance()
  }

  /**
   * La casella di testo c'è **sempre** e parte vuota. Non è una preferenza di
   * disposizione: il contratto del tool la promette al modello — «AskUserQuestion always
   * includes a Skip button and a free-text input box for custom answers, so do not
   * include `None` or `Other` as options» — quindi l'agent *omette apposta* l'opzione
   * «nessuna di queste», contando su di lei. Tenerla dietro un bottone la rendeva una
   * via da scoprire proprio mentre l'agent dava per scontato che fosse aperta.
   *
   * Svuotarla torna a «non ho ancora risposto» invece di lasciare una risposta vuota:
   * una scelta che non si può disfare è una trappola, e vale anche per questa.
   */
  function onType(q: AgentQuestion, text: string): void {
    if (text.length === 0) {
      const rest = { ...draft }
      delete rest[q.question]
      draft = rest
      return
    }
    set(q, { mode: 'typed', text })
  }

  /** Il testo scritto per QUESTA domanda, e vuoto in ogni altro caso: scegliere
   *  un'opzione o «parliamone» svuota la casella, perché sono tre strade e non tre
   *  campi da riempire insieme. */
  const typedNow = $derived.by(() => {
    const c = cur ? choice(cur) : undefined
    return c?.mode === 'typed' ? c.text : ''
  })

  function discuss(q: AgentQuestion): void {
    // Premuto due volte torna indietro: è una scelta come le altre, e una scelta
    // che non si può disfare è una trappola.
    if (choice(q)?.mode === 'discuss') { set(q, { mode: 'pick', labels: [] }); return }
    set(q, { mode: 'discuss' })
    if (step < qs.length - 1) step += 1
  }

  const picked = (q: AgentQuestion, label: string): boolean => {
    const c = choice(q)
    return c?.mode === 'pick' && c.labels.includes(label)
  }

  async function reply(): Promise<void> {
    if (!question) return
    // La chiave è il testo della domanda: è la forma documentata di `AskUserQuestion`,
    // e il vocabolario canonico la ripete tale e quale in `question.replied.answers`.
    const answers: Record<string, string | string[]> = {}
    const scritte: string[] = []
    for (const q of question.questions) {
      const c = draft[q.question]
      if (!c) { answers[q.question] = q.multiSelect ? [] : ''; continue }
      if (c.mode === 'pick') {
        answers[q.question] = q.multiSelect ? c.labels : (c.labels[0] ?? '')
      } else if (c.mode === 'typed') {
        const t = c.text.trim()
        answers[q.question] = q.multiSelect ? [t] : t
        scritte.push(t)
      } else {
        answers[q.question] = DISCUSS
      }
    }
    await store.send({
      c: 'question.reply', requestId: question.requestId, answers,
      // `response` continua a portare ciò che è stato scritto a mano: è il campo che
      // lo faceva arrivare finora, e toglierlo perché *dovrebbe* bastare `answers`
      // sarebbe dedurre un comportamento invece di verificarlo.
      ...(scritte.length > 0 ? { response: scritte.join('\n') } : {}),
    }, id)
  }

  /** L'anteprima dell'opzione scelta in QUESTO passo, quando ne porta una. */
  const preview = $derived.by(() => {
    const c = cur ? choice(cur) : undefined
    if (!cur || c?.mode !== 'pick') return null
    return cur.options.find(o => o.label === c.labels[0])?.preview ?? null
  })
</script>

{#if permission && head}
  <div class="askbox">
    <div class="h">
      <Icon name={head.icon} style="color:var(--accent)" />
      {head.text}
      {#if canStop}
        <button class="stopb" title="Stop" onclick={() => void store.stop(id)}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>
    <div class="s">
      {#each permission.resources as r (r)}<code>{r}</code>{/each}
      {#if permission.resources.length === 0}<code>{permission.action}</code>{/if}
      in <code>{tilde(snap.cwd)}</code>
    </div>
    <div class="opts">
      <button class="opt pri" onclick={() => void store.send({
        c: 'permission.reply', requestId: permission.requestId, decision: 'once' }, id)}>Allow</button>

      <!-- `scope` non si inventa: è ciò che la richiesta dichiara di poter salvare.
           Senza `savable` non c'è niente da ricordare, e il pulsante non compare. -->
      {#if permission.savable.length > 0}
        <button class="opt" onclick={() => void store.send({
          c: 'permission.reply', requestId: permission.requestId,
          decision: 'always', scope: permission.savable[0]! }, id)}
          title="Writes a rule so this is allowed from now on">Always allow</button>
      {/if}

      <button class="opt" onclick={() => void store.send({
        c: 'permission.reply', requestId: permission.requestId, decision: 'reject' }, id)}>Deny</button>
    </div>
  </div>

{:else if plan}
  <div class="askbox plan">
    <div class="h">
      <Icon name="i-doc" style="color:var(--wait)" />
      The agent has a plan
      {#if canStop}
        <button class="stopb" title="Stop" onclick={() => void store.stop(id)}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>

    <!-- Il piano per intero, come markdown. Non un riassunto e non le prime righe:
         è la cosa su cui si sta decidendo, e approvare senza poterla leggere è ciò
         che succedeva prima che questo blocco esistesse. Scorre, perché un piano di
         tre passi sta in mezzo schermo e uno di dieci no. -->
    <!-- Stessa delegazione della conversazione, e per la stessa ragione: i bottoni di
         un percorso nascono come DOM grezzo dentro `decoraPercorsi`. Il piano cita
         file quanto e più di una risposta — è il posto dove si decide *su quali file*. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="planbody" onclick={onPathClick}
      {@attach el => osservaPercorsi(el, snap.sessionId, store.api)}
    >{@html renderMarkdown(plan.plan)}</div>

    {#if plan.path}
      <!-- Il CLI il piano se lo scrive anche su un file. Dirlo permette di aprirlo
           dove si aprono gli altri file; leggerlo da lì per mostrarlo qui vorrebbe
           dire preferire il disco a ciò che il protocollo ha già mandato. -->
      <button class="pathrow" title="Reveal in file manager"
        onclick={() => void store.reveal(plan.path!, snap.sessionId)}>
        <Icon name="i-reveal" /> {tilde(plan.path)}
      </button>
    {/if}

    <div class="opts" style="margin-top:8px">
      <!-- Le due approvazioni sono due, e non una con una spunta accanto, perché nel
           terminale sono due voci: «sì, e accetta le modifiche» e «sì, e chiedimele».
           Sono la stessa decisione presa in due modi diversi, e chi approva la sta
           già prendendo — farla scegliere dopo, da un menu, la nasconderebbe. -->
      {#each modiDopoIlPiano as m (m.mode)}
        <button class="opt" class:pri={m.mode === 'acceptEdits'}
          disabled={!m.available} title={m.reason ?? ''}
          onclick={() => void rispondiAlPiano('approved', m.mode)}>
          {m.mode === 'acceptEdits' ? 'Go ahead, accept edits' : 'Go ahead, ask me first'}
        </button>
      {/each}
      {#if modiDopoIlPiano.length === 0}
        <!-- Su un journal vecchio la sessione non porta l'elenco delle modalità: si
             approva lo stesso, lasciando decidere al CLI come proseguire. Meglio un
             bottone in meno che un piano che non si può approvare. -->
        <button class="opt pri" onclick={() => void rispondiAlPiano('approved')}>Go ahead</button>
      {/if}
      <button class="opt alt" onclick={() => void rispondiAlPiano('rejected')}>
        <Icon name="i-pencil" /> Keep planning
      </button>
    </div>
    <input class="typed" placeholder="What to change — optional, goes with «Keep planning»"
      bind:value={feedback}
      onkeydown={e => { if (e.key === 'Enter') void rispondiAlPiano('rejected') }} />
  </div>

{:else if question && cur}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- Stessa delegazione del piano: i bottoni di un percorso citato nascono come DOM
       grezzo dentro `decoraPercorsi`, quindi non c'è nessun elemento Svelte a cui
       attaccare un `onclick`. Qui serve quanto nel piano — una domanda su quale file
       toccare cita dei file, ed è la ragione per cui il testo è diventato Markdown. -->
  <div class="askbox q" onclick={onPathClick}
    {@attach el => osservaPercorsi(el, snap.sessionId, store.api)}>
    <div class="qhead">
      <Icon name="i-ask" style="color:var(--wait)" />
      <span class="qtitle">
        {qs.length > 1 ? `Question ${step + 1} of ${qs.length}` : (cur.header || 'A question')}
      </span>
      <!-- I passi, sulla stessa riga del titolo. Portano due cose insieme: **dove sei**
           (quello acceso) e **quanto è lunga la richiesta** — tre pastiglie sono tre
           domande. È per questo che il contatore «3 answers total», che stava qui, non
           c'è più: diceva un numero che adesso si conta guardando, e in fondo il bottone
           dice comunque «Send 3 answers». -->
      {#if qs.length > 1}
        <div class="qsteps">
          {#each qs as q, i (q.question)}
            <button class="stp" class:on={i === step} class:ok={answered(q)}
              title={q.question} aria-current={i === step ? 'step' : undefined}
              onclick={() => { step = i }}>
              <span class="d"></span><span class="t">{q.header || `Question ${i + 1}`}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if canStop}
        <button class="stopb" title="Stop" onclick={() => void store.stop(id)}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>

    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div class="qtext">{@html renderMarkdown(cur.question)}</div>

    <!-- Righe piene con un pallino, non pillole in fila. La forma dice da sé «una di
         queste» — o «quante vuoi», col quadrato, quando la domanda è a scelta multipla —
         e in una riga piena ci sta anche la `description`, che prima l'agent scriveva e
         STARK nascondeva in un tooltip: cioè la sola cosa che spiega *cosa costa* una
         scelta era raggiungibile solo fermandoci sopra il mouse, e da telefono per niente. -->
    <div class="qopts">
      {#each cur.options as o (o.label)}
        <button class="qopt" class:on={picked(cur, o.label)}
          onclick={() => pick(cur, o.label)}>
          <span class="mk" class:sq={cur.multiSelect}></span>
          <span class="bd">
            <!-- `renderInline` e non `renderMarkdown`: qui un `<p>` porterebbe i suoi
                 margini dentro una riga il cui layout è già deciso. -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <span class="lb">{#if isReco(o.label)}<span class="reco">Recommended</span>{/if}{@html renderInline(clean(o.label))}</span>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {#if o.description}<span class="ds">{@html renderInline(o.description)}</span>{/if}
          </span>
        </button>
      {/each}

      <!-- Le due strade in più ci sono SEMPRE, anche quando le opzioni sembrano coprire
           tutto: che le coprano lo ha deciso l'agent, e chi risponde deve poter dire sia
           «nessuna di queste» sia «non ho abbastanza per scegliere». Stanno nella stessa
           lista e non in un angolo a parte, perché sono risposte quanto le altre. -->
      <button class="qopt" class:on={choice(cur)?.mode === 'discuss'}
        onclick={() => discuss(cur)}>
        <span class="mk"></span>
        <span class="bd">
          <span class="lb"><Icon name="i-chat" /> Chat about this</span>
          <span class="ds">
            The other answers go through as they are. This one comes back as a question
            to talk about, and the agent asks you again after.
          </span>
        </span>
      </button>

      <div class="qwrite" class:on={choice(cur)?.mode === 'typed'}>
        <span class="mk"></span>
        <Icon name="i-pencil" />
        <input class="qin" placeholder="Type in your answer"
          value={typedNow}
          oninput={e => onType(cur, e.currentTarget.value)}
          onkeydown={e => {
            if (e.key !== 'Enter' || !answered(cur)) return
            e.preventDefault()
            if (step < qs.length - 1) step += 1
            else if (complete) void reply()
          }} />
      </div>
    </div>

    {#if preview}
      <pre class="prev">{preview}</pre>
    {/if}

    <div class="qfoot">
      {#if qs.length > 1}
        <button class="opt" disabled={step === 0} onclick={() => { step -= 1 }}>
          <Icon name="i-back" /> Back
        </button>
        {#if step < qs.length - 1}
          <button class="opt" disabled={!answered(cur)} onclick={() => advance()}>
            Next <Icon name="i-fwd" />
          </button>
        {/if}
      {/if}
      <button class="opt pri" disabled={!complete} onclick={() => void reply()}>
        {qs.length > 1 ? `Send ${qs.length} answers` : 'Send answer'}
      </button>
      <!-- Chiudere non è «nessuna risposta»: è una risposta vera, e l'agent la riceve
           come rifiuto e può cambiare strada. -->
      <button class="opt" onclick={() => void store.send({
        c: 'question.reject', requestId: question.requestId }, id)}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .opt { cursor: pointer; }
  .opt[disabled] { opacity: .45; cursor: default; }
  .opt:focus-visible, .stopb:focus-visible, .stp:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .askbox .s code + code { margin-left: 4px; }
  .prev {
    margin: 8px 0 0; padding: 7px 9px; border-radius: 7px;
    background: var(--surface); border: 1px solid var(--line-2);
    font-family: var(--mono); font-size: 10px; color: var(--ink-2);
    max-height: 150px; overflow: auto; white-space: pre-wrap;
  }
  /* Il corpo del piano. Scorre e ha un tetto: un piano di dieci passi non deve
     spingere i bottoni sotto il bordo della finestra — sarebbero irraggiungibili
     proprio nel momento in cui tutto è fermo ad aspettarli. Il tetto è in `vh` e non
     in pixel perché la cosa da non superare è **lo schermo**, e da telefono è un
     altro numero. */
  .planbody {
    max-height: 46vh; overflow: auto; margin: 6px 0 2px;
    font-size: 12px; line-height: 1.5; color: var(--ink);
    border-left: 2px solid var(--line); padding: 2px 4px 2px 10px;
  }
  .planbody :global(h1), .planbody :global(h2), .planbody :global(h3) {
    font-size: 12.5px; margin: 8px 0 3px;
  }
  .planbody :global(p), .planbody :global(ul), .planbody :global(ol) { margin: 3px 0; }
  .planbody :global(pre) { font-size: 11px; overflow: auto; }
  .pathrow {
    display: flex; align-items: center; gap: 5px; width: 100%;
    border: 0; background: none; padding: 2px 0; margin-top: 2px;
    font: inherit; font-size: 10.5px; color: var(--muted); cursor: pointer;
    text-align: left;
  }
  .pathrow:hover { color: var(--ink); }

  .typed {
    margin-top: 8px; width: 100%; border: 1px solid var(--line-2); border-radius: 7px;
    padding: 5px 9px; font: inherit; font-size: 11px;
    background: var(--surface); color: var(--ink);
  }
  .typed:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

  /* ── il box delle domande ─────────────────────────────────────────────────
     Ridisegnato il 28 agosto 2026 su un riferimento portato dall'utente.
     Il fondo resta giallo — è l'identità del blocco «tocca a te», e la si
     riconosce prima di leggere — e ambra restano titolo e icona. Il blu è
     riservato a ciò che si tocca: l'opzione scelta, il badge, «Send answer».
     Due colori con due mestieri, invece di uno solo che li fa entrambi. */
  .qhead {
    display: flex; align-items: center; gap: 7px;
    font-weight: 700; font-size: 11.5px; color: var(--wait);
  }
  .qhead { flex-wrap: wrap; }
  .qtitle { flex: none; }
  /* I passi al centro, lo Stop a destra: `margin-left:auto` su entrambi i lati del
     gruppo, che è il modo di centrarlo senza sapere quanto è largo il titolo. */
  .qsteps { display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    margin-left: auto; margin-right: auto; min-width: 0; }
  .qhead .stopb { margin-left: auto; flex: none; }
  /* I passi sono pastiglie con un bordo. Senza, su fondo giallo restavano un pallino e
     una parola — cioè la stessa forma delle opzioni qui sotto, a mezzo centimetro di
     distanza: due cose che si premono, disegnate uguali, che vogliono dire l'una «di
     cosa stiamo parlando» e l'altra «cosa rispondo». */
  .qsteps .stp { border: 1px solid var(--line-2); background: var(--surface); }
  .qsteps .stp.on { border-color: var(--wait); }

  /* La domanda è la cosa da leggere, quindi è la più grande del riquadro: 12.5px
     contro gli 11 delle etichette. Prima era 11.5, cioè mezzo punto sopra le opzioni —
     una differenza che non si vede, su una gerarchia che invece esiste. */
  /* Il tetto alla misura vale anche qui, e qui si vede prima che altrove: il riquadro
     è largo quanto la conversazione, quindi su schermo largo una domanda di due righe
     diventa una riga sola da 150 caratteri. È in `ch` e non in pixel, così segue il
     corpo del testo invece di essere un numero da ritarare quando cambia. */
  .qtext { font-size: 12.5px; line-height: 1.5; color: var(--ink); margin-top: 8px;
    max-width: 78ch; }
  /* Markdown dentro una riga già disegnata: i margini del primo e dell'ultimo blocco
     li decide questo riquadro, non `marked`. */
  .qtext :global(> :first-child) { margin-top: 0; }
  .qtext :global(> :last-child) { margin-bottom: 0; }
  .qtext :global(p) { margin: 6px 0; }
  .qtext :global(ul), .qtext :global(ol) { margin: 6px 0; padding-left: 18px; }
  .qtext :global(code) { font-size: .86em; }

  /* Il tetto è in `vh` e non in pixel per la stessa ragione del corpo di un piano: la
     cosa da non superare è **lo schermo**, e da telefono è un altro numero. I 7px sopra
     non sono aria: è lo spazio in cui sporge il badge della prima opzione. */
  /* Le opzioni sono **una scheda sola** con dei filetti, non otto riquadri staccati.
     Il cambiamento non è di gusto: otto bordi più sette spazi da 6px sono quindici
     linee orizzontali per una lista di otto voci, e il riquadro cresceva di 50px senza
     dire niente di più. Con i filetti restano sette linee, tutte più leggere, e su
     telefono la differenza è quella fra vedere quattro opzioni e vederne sei.
     Il tetto è in `vh` e non in pixel per la stessa ragione del corpo di un piano: la
     cosa da non superare è **lo schermo**, e da telefono è un altro numero. */
  .qopts {
    display: flex; flex-direction: column;
    margin-top: 9px; max-height: 42vh; overflow: auto;
    border: 1px solid var(--line-2); border-radius: 10px;
    background: var(--surface);
  }
  .qopt, .qwrite {
    position: relative; display: flex; align-items: flex-start; gap: 9px;
    width: 100%; text-align: left; font: inherit; color: var(--ink);
    border: 0; border-top: 1px solid var(--line); border-radius: 0;
    background: none; padding: 9px 11px;
  }
  /* La prima non porta il filetto: sarebbe una linea appoggiata sul bordo della scheda,
     cioè due linee a un pixel di distanza. */
  .qopts > :first-child { border-top: 0; }
  .qopt { cursor: pointer; }
  .qopt:hover { background: var(--surface-2); }
  /* La scelta si vede dal fondo e da una barretta a sinistra, non da un bordo attorno:
     dentro una scheda un bordo colorato dovrebbe combattere coi filetti dei vicini, e
     alla prima e all'ultima riga cadrebbe sopra il bordo della scheda stessa. */
  .qopt.on, .qwrite.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
  .qopt:focus-visible, .qwrite:focus-within { outline: 2px solid var(--accent); outline-offset: -2px; }

  /* Il segno di scelta. Tondo quando se ne prende una, quadrato quando se ne possono
     prendere quante si vuole: `multiSelect` è un fatto della domanda che prima non si
     vedeva da nessuna parte — lo si scopriva premendo due opzioni e vedendole restare
     accese entrambe. La forma lo dice prima di provare. */
  .mk {
    width: 13px; height: 13px; flex: none; margin-top: 1.5px;
    border: 1.5px solid var(--line-2); border-radius: 50%; background: var(--surface);
  }
  .mk.sq { border-radius: 4px; }
  .qopt.on .mk, .qwrite.on .mk {
    border-color: var(--accent); background: var(--accent);
    box-shadow: inset 0 0 0 2.5px var(--surface);
  }

  .bd { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .lb { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
    flex-wrap: wrap; }
  .lb :global(svg.ic) { width: 12px; height: 12px; flex: none; }
  .ds { font-size: 10px; line-height: 1.4; color: var(--muted); }

  /* Il badge sta **nella riga dell'etichetta**, in fondo a destra. Prima sporgeva sul
     bordo dell'opzione, e la ragione scritta allora era buona — «si vede scorrendo con
     l'occhio senza entrare nel testo» — ma dentro una scheda con i filetti quel bordo
     non c'è più, e su schermo stretto il badge finiva **sopra** l'etichetta: misurato,
     430px di larghezza. Un'etichetta coperta è un difetto più grosso di un badge meno
     sporgente, e `margin-left:auto` lo tiene comunque all'estremo destro della riga,
     dove l'occhio lo trova scorrendo la colonna. */
  .reco {
    order: 2; margin-left: auto; flex: none;
    padding: 1.5px 7px; border-radius: 20px;
    background: var(--accent); color: var(--on-accent);
    font-size: 8.5px; font-weight: 700; letter-spacing: .03em; line-height: 1.55;
  }

  .qwrite { align-items: center; }
  .qwrite :global(svg.ic) { width: 12px; height: 12px; flex: none; color: var(--muted); }
  .qin {
    flex: 1; min-width: 0; border: 0; background: none; padding: 0;
    font: inherit; font-size: 11px; color: var(--ink);
  }
  .qin:focus { outline: none; }

  .qfoot { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
</style>
