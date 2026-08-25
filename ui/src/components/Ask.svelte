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
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap, canStop }:
    { store: Store; snap: SessionSnapshot; canStop: boolean } = $props()

  const permission = $derived(snap.pendingPermissions[0])
  const question = $derived(snap.pendingQuestions[0])
  const head = $derived(permission ? permissionHeadline(permission.action) : null)

  // Le risposte in corso di composizione, azzerate a ogni richiesta nuova: `requestId`
  // nella chiave è ciò che impedisce a una scelta fatta per la domanda di prima di
  // ricomparire già spuntata in quella dopo.
  let draft = $state<Record<string, string[]>>({})
  let typed = $state<string>('')
  let typing = $state(false)
  let currentId = $state<string>('')

  $effect(() => {
    const id = question?.requestId ?? ''
    if (id !== currentId) { currentId = id; draft = {}; typed = ''; typing = false }
  })

  function pick(q: AgentQuestion, label: string): void {
    const chosen = draft[q.question] ?? []
    if (q.multiSelect) {
      draft = {
        ...draft,
        [q.question]: chosen.includes(label)
          ? chosen.filter(x => x !== label)
          : [...chosen, label],
      }
      return
    }
    draft = { ...draft, [q.question]: [label] }
    // Una domanda sola a scelta singola non ha niente da confermare: la scelta È la
    // conferma. Con più domande, o a scelta multipla, serve un passaggio in più.
    if (question && question.questions.length === 1 && !typing) void reply()
  }

  const chosen = (q: AgentQuestion, label: string): boolean =>
    (draft[q.question] ?? []).includes(label)

  // «Scrivi tu» e i bottoni preimpostati sono due strade alternative, non due
  // caselle da spuntare entrambe: chi scrive la propria risposta non deve ANCHE
  // cliccare un'opzione per sbloccare Send, altrimenti la casella libera esiste
  // solo per finta — è esattamente il bug segnalato dal vivo.
  const complete = $derived(
    !!question && (typed.trim().length > 0
      || question.questions.every(q => (draft[q.question] ?? []).length > 0)),
  )

  async function reply(): Promise<void> {
    if (!question) return
    // La chiave è il testo della domanda: è la forma documentata di `AskUserQuestion`,
    // e il vocabolario canonico la ripete tale e quale in `question.replied.answers`.
    const answers: Record<string, string | string[]> = {}
    for (const q of question.questions) {
      const v = draft[q.question] ?? []
      answers[q.question] = q.multiSelect ? v : (v[0] ?? '')
    }
    await store.send({
      c: 'question.reply', requestId: question.requestId, answers,
      ...(typed.trim() ? { response: typed.trim() } : {}),
    })
  }

  /** L'anteprima dell'opzione scelta, quando ne porta una: serve a confrontare. */
  const preview = $derived.by(() => {
    if (!question) return null
    for (const q of question.questions) {
      const label = (draft[q.question] ?? [])[0]
      const o = q.options.find(x => x.label === label)
      if (o?.preview) return o.preview
    }
    return null
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

{:else if question}
  <div class="askbox q">
    <div class="h">
      <Icon name="i-ask" style="color:var(--wait)" />
      {question.questions[0]?.header || 'A question'}
      {#if canStop}
        <button class="stopb" title="Stop" onclick={() => void store.stop()}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>

    {#each question.questions as q (q.question)}
      <div class="s">{q.question}</div>
      <div class="opts">
        {#each q.options as o (o.label)}
          <button class="opt" class:pri={chosen(q, o.label)}
            title={o.description} onclick={() => pick(q, o.label)}>{o.label}</button>
        {/each}
      </div>
    {/each}

    {#if preview}
      <pre class="prev">{preview}</pre>
    {/if}

    {#if typing}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="typed" autofocus bind:value={typed} placeholder="Your own answer…"
        onkeydown={e => { if (e.key === 'Enter' && complete) void reply() }} />
    {/if}

    <div class="opts" style="margin-top:8px">
      {#if question.questions.length > 1 || question.questions[0]?.multiSelect || typing}
        <button class="opt pri" disabled={!complete} onclick={() => void reply()}>Send</button>
      {/if}
      {#if !typing}
        <button class="opt" onclick={() => { typing = true }}>Let me type it…</button>
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
  .opt:focus-visible, .stopb:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .askbox .s code + code { margin-left: 4px; }
  .prev {
    margin: 8px 0 0; padding: 7px 9px; border-radius: 7px;
    background: var(--surface); border: 1px solid var(--line-2);
    font-family: var(--mono); font-size: 10px; color: var(--ink-2);
    max-height: 150px; overflow: auto; white-space: pre-wrap;
  }
  .typed {
    margin-top: 8px; width: 100%; border: 1px solid var(--line-2); border-radius: 7px;
    padding: 5px 9px; font: inherit; font-size: 11px;
    background: var(--surface); color: var(--ink);
  }
  .typed:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
</style>
