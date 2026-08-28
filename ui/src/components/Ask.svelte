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
  import { permissionHeadline, tilde } from '../lib/view.ts'
  import { renderMarkdown } from '../lib/markdown.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap, canStop }:
    { store: Store; snap: SessionSnapshot; canStop: boolean } = $props()

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
    })
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
   * Il caso in cui la scelta È la conferma: una domanda sola, a scelta singola,
   * risposta premendo un'opzione. Non c'è niente da rivedere e niente da confermare,
   * quindi non compare nemmeno un Send. Scrivere la propria risposta o chiedere di
   * parlarne no: lì un momento per ripensarci serve.
   */
  const autoSends = $derived(
    qs.length === 1 && !qs[0]?.multiSelect
    && (choice(qs[0]!)?.mode ?? 'pick') === 'pick',
  )

  /** Sull'ultimo passo, o appena c'è una risposta per tutte: si può aver girato indietro. */
  const showSend = $derived(!autoSends && (step === qs.length - 1 || complete))

  function advance(): void {
    if (step < qs.length - 1) { step += 1; return }
    if (autoSends) void reply()
  }

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

  function typeIn(q: AgentQuestion): void {
    if (choice(q)?.mode !== 'typed') set(q, { mode: 'typed', text: '' })
  }

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
    })
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
        <button class="stopb" title="Stop" onclick={() => void store.stop()}>
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
        c: 'permission.reply', requestId: permission.requestId, decision: 'once' })}>Allow</button>

      <!-- `scope` non si inventa: è ciò che la richiesta dichiara di poter salvare.
           Senza `savable` non c'è niente da ricordare, e il pulsante non compare. -->
      {#if permission.savable.length > 0}
        <button class="opt" onclick={() => void store.send({
          c: 'permission.reply', requestId: permission.requestId,
          decision: 'always', scope: permission.savable[0]! })}
          title="Writes a rule so this is allowed from now on">Always allow</button>
      {/if}

      <button class="opt" onclick={() => void store.send({
        c: 'permission.reply', requestId: permission.requestId, decision: 'reject' })}>Deny</button>
    </div>
  </div>

{:else if plan}
  <div class="askbox plan">
    <div class="h">
      <Icon name="i-doc" style="color:var(--wait)" />
      The agent has a plan
      {#if canStop}
        <button class="stopb" title="Stop" onclick={() => void store.stop()}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>

    <!-- Il piano per intero, come markdown. Non un riassunto e non le prime righe:
         è la cosa su cui si sta decidendo, e approvare senza poterla leggere è ciò
         che succedeva prima che questo blocco esistesse. Scorre, perché un piano di
         tre passi sta in mezzo schermo e uno di dieci no. -->
    <div class="planbody">{@html renderMarkdown(plan.plan)}</div>

    {#if plan.path}
      <!-- Il CLI il piano se lo scrive anche su un file. Dirlo permette di aprirlo
           dove si aprono gli altri file; leggerlo da lì per mostrarlo qui vorrebbe
           dire preferire il disco a ciò che il protocollo ha già mandato. -->
      <button class="pathrow" title="Reveal in file manager"
        onclick={() => void store.reveal(plan.path!)}>
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
  <div class="askbox q">
    <div class="h">
      <Icon name="i-ask" style="color:var(--wait)" />
      {cur.header || 'A question'}
      {#if qs.length > 1}<span class="stepn">{step + 1} of {qs.length}</span>{/if}
      {#if canStop}
        <button class="stopb" title="Stop" onclick={() => void store.stop()}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>

    <!-- I passi non sono una decorazione di avanzamento: sono la mappa della richiesta.
         Dicono quante domande sono in tutto — cosa che una domanda alla volta
         nasconderebbe — e si premono, perché rivedere la prima dopo aver letto la terza
         è esattamente ciò che si vuole fare. -->
    {#if qs.length > 1}
      <div class="steps">
        {#each qs as q, i (q.question)}
          <button class="stp" class:on={i === step} class:ok={answered(q)}
            title={q.question} aria-current={i === step ? 'step' : undefined}
            onclick={() => { step = i }}>
            <span class="d"></span><span class="t">{q.header || `Question ${i + 1}`}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="s">{cur.question}</div>

    <div class="opts">
      {#each cur.options as o (o.label)}
        <button class="opt" class:pri={picked(cur, o.label)}
          title={o.description} onclick={() => pick(cur, o.label)}>{o.label}</button>
      {/each}

      <!-- Le due strade in più ci sono SEMPRE, anche quando le opzioni sembrano
           coprire tutto: che le coprano lo ha deciso l'agent, e chi risponde deve
           poter dire sia «nessuna di queste» sia «non ho abbastanza per scegliere». -->
      <button class="opt alt" class:pri={choice(cur)?.mode === 'typed'}
        title="Answer this one in your own words" onclick={() => typeIn(cur)}>
        <Icon name="i-pencil" /> Type in your answer
      </button>
      <button class="opt alt" class:pri={choice(cur)?.mode === 'discuss'}
        title="Send the other answers, and have the agent walk you through this one"
        onclick={() => discuss(cur)}>
        <Icon name="i-chat" /> Chat about this
      </button>
    </div>

    {#if choice(cur)?.mode === 'typed'}
      {@const c = choice(cur)}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="typed" autofocus placeholder="Your answer to this question…"
        value={c?.mode === 'typed' ? c.text : ''}
        oninput={e => set(cur, { mode: 'typed', text: e.currentTarget.value })}
        onkeydown={e => {
          if (e.key !== 'Enter' || !answered(cur)) return
          e.preventDefault()
          if (step < qs.length - 1) step += 1
          else if (complete) void reply()
        }} />
    {/if}

    {#if choice(cur)?.mode === 'discuss'}
      <!-- Cosa succederà, detto adesso: «parliamone» non è un annulla, e non ferma le
           altre risposte. Senza dirlo si scoprirebbe dopo aver premuto Send. -->
      <div class="hintline">
        <Icon name="i-chat" />
        The other answers go through as they are. This one comes back as a question to
        talk about, and the agent asks you again after.
      </div>
    {/if}

    {#if preview}
      <pre class="prev">{preview}</pre>
    {/if}

    <div class="opts" style="margin-top:8px">
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
      {#if showSend}
        <button class="opt pri" disabled={!complete} onclick={() => void reply()}>
          {qs.length > 1 ? `Send ${qs.length} answers` : 'Send'}
        </button>
      {/if}
      <!-- Chiudere non è «nessuna risposta»: è una risposta vera, e l'agent la riceve
           come rifiuto e può cambiare strada. -->
      <button class="opt" onclick={() => void store.send({
        c: 'question.reject', requestId: question.requestId })}>Dismiss</button>
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
</style>
