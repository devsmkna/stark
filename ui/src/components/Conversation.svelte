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
  import { promptText } from '$core/events.ts'
  import { colours, hhmm, project, since, toolIcon } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap, link }:
    { store: Store; snap: SessionSnapshot; link: LinkStatus } = $props()

  // Aperto solo l'ultimo turno, che è quello a cui si sta lavorando. `!id` marca un
  // turno chiuso a mano: senza, richiudere l'ultimo non avrebbe effetto, perché la
  // regola «l'ultimo è aperto» lo riaprirebbe subito.
  let opened = $state<Set<string>>(new Set())
  const isOpen = (t: TurnView, i: number): boolean =>
    opened.has(t.turnId) ? true : (i === snap.turns.length - 1 && !opened.has(`!${t.turnId}`))

  function toggle(t: TurnView, i: number): void {
    const next = new Set(opened)
    if (isOpen(t, i)) { next.delete(t.turnId); next.add(`!${t.turnId}`) }
    else { next.add(t.turnId); next.delete(`!${t.turnId}`) }
    opened = next
  }

  const promptOf = (t: TurnView): string => promptText(t.prompt)
  /** Le immagini che hai mandato con quel turno: stanno prima del testo, come le ha
   *  viste il modello. I byte non sono nel journal, quindi si chiedono al daemon. */
  const immaginiOf = (t: TurnView): Extract<TurnView['prompt'][number], { type: 'image' }>[] =>
    t.prompt.filter(p => p.type === 'image')
  // Sulla lista intera, non su questa sola riga: la tavolozza si assegna in ordine
  // alfabetico fra TUTTI i progetti, quindi calcolarla su un elenco di uno darebbe
  // sempre il primo colore — e lo stesso progetto avrebbe due colori diversi nelle
  // due metà dello schermo, che è esattamente ciò che il colore serve a evitare.
  const colour = $derived(colours(store.rows).get(project(snap.cwd)) ?? 0)
  const title = $derived(store.row?.title ?? project(snap.cwd))

  /**
   * Su cosa ha lavorato un tool. Arriva **già pronto** dal modello canonico: fino a
   * ieri era questa funzione a frugare dentro `input` cercando `command`/`file_path`,
   * cioè a conoscere la forma di Claude Code fuori dall'adapter. Adesso quel mestiere
   * sta in `adapters/claude-code/summary.ts`, che è dove ha diritto di stare.
   * Il ripiego serve solo ai journal scritti prima, e mostra ciò che c'è senza
   * interpretarlo.
   */
  const subject = (part: Extract<PartView, { kind: 'tool' }>): string =>
    part.summary ?? part.inputRaw.slice(0, 120)

  /** Le modifiche prodotte da questa chiamata, per mostrarle dove sono accadute. */
  const editsOf = (callId: string) => snap.files.filter(f => f.callId === callId)

  let renaming = $state(false)
  let draft = $state('')

  function startRename(): void {
    draft = title
    renaming = true
  }
  async function commitRename(): Promise<void> {
    renaming = false
    if (store.selected && draft.trim() && draft !== title) {
      await store.rename(store.selected, draft)
    }
  }
</script>

<div class="col">
  <div class="bar">
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
      <!-- Rinominare non apre niente: il titolo diventa scrivibile dov'è. -->
      <button class="t" ondblclick={startRename} title="Double-click to rename">{title}</button>
    {/if}

    <button class="iconb" title="Put to sleep — frees memory, not quota"
      style="margin-left:auto" disabled={!store.live}
      onclick={() => void store.sleep()}><Icon name="i-moon" /></button>

    <button class="effbtn" style="margin-left:0" onclick={() => { store.view = 'effects' }}>
      <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
        {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      <Icon name="i-bars" />
    </button>
  </div>

  {#if link !== 'live' && store.live}
    <div class="offline">
      <Icon name={link === 'connecting' ? 'i-loader' : 'i-wifi-off'}
        style="animation:{link === 'connecting' ? 'sp 1.1s linear infinite' : 'none'}" />
      {link === 'connecting' ? 'Connecting…' : 'Connection lost — retrying, nothing is missed'}
    </div>
  {/if}

  <div class="scroller conv">
    {#each snap.turns as turn, i (turn.turnId)}
      {@const open = isOpen(turn, i)}
      <div class="turn" class:open>
        <button class="th" onclick={() => toggle(turn, i)}>
          <span class="cx">{open ? '▾' : '▸'}</span>
          <span class="tm">{hhmm(turn.startedAt)}</span>
          <span class="q">{promptOf(turn)}</span>
          <span class="n">
            {turn.parts.length} {turn.parts.length === 1 ? 'block' : 'blocks'}{#if turn.endedAt}{' · '}{since(turn.startedAt, turn.endedAt)}{/if}
          </span>
        </button>

        {#if open}
          <div class="tb">
            {#if immaginiOf(turn).length > 0}
              <!-- Quello che gli hai fatto vedere, sopra a tutto: è la prima cosa che
                   il modello ha avuto davanti, e riaprendo due giorni dopo è la prima
                   che serve per capire di cosa si stava parlando. -->
              <div class="pimgs">
                {#each immaginiOf(turn) as img (img.ref)}
                  <a href={`/api/sessions/${snap.sessionId}/blob/${img.ref}`}
                    target="_blank" rel="noreferrer" title={img.name ?? 'image'}>
                    <img src={`/api/sessions/${snap.sessionId}/blob/${img.ref}`}
                      alt={img.name ?? 'attachment'} />
                  </a>
                {/each}
              </div>
            {/if}
            {#each turn.parts as part (part.kind === 'tool' ? part.callId : part.partId)}
              {#if part.kind === 'text'}
                <!-- Sempre per intero: è l'unica cosa scritta per l'utente. -->
                <div class="prose">{part.text}</div>

              {:else if part.kind === 'reasoning'}
                <div class="row think">
                  <Icon name="i-brain" />
                  <span class="k">Reasoning</span>
                  <span class="v">{part.estimatedTokens ? `${part.estimatedTokens} tokens` : ''}</span>
                  <span class="end">▸</span>
                </div>

              {:else if part.kind === 'answer'}
                <!-- La richiesta non è passata di qui: si era espanso il blocco in
                     basso. Ciò che resta nel flusso è cosa hai risposto, dove è
                     successo, così che due giorni dopo si capisca cosa si era deciso. -->
                <div class="row answer">
                  <Icon name={part.of === 'question' ? 'i-ask' : 'i-shield'} />
                  <span class="k">You</span>
                  <span class="v">{part.asked}</span>
                  <!-- Nessun rosso: aver detto di no non è un fallimento, è una
                       decisione. Il rosso qui la farebbe leggere come qualcosa
                       andato storto, e la prossima volta si esiterebbe a dirlo. -->
                  <span class="end" class:no={part.refused}>{part.answer}</span>
                </div>

              {:else}
                <!-- `bad` solo se NON è bloccata: un'azione fermata dal classificatore
                     torna comunque come tool fallito, e senza questa esclusione le due
                     classi si sovrappongono e vince il rosso. Ma bloccato non è un
                     fallimento — è «fermato, e puoi consentirlo tu». -->
                <div class="row" class:bad={part.done && part.ok === false && !part.blocked}
                     class:block={!!part.blocked}>
                  <Icon name={part.blocked ? 'i-block' : toolIcon(part.name)} />
                  <span class="k">{part.blocked ? 'Blocked' : part.name}</span>
                  <span class="v">{subject(part)}</span>
                  <span class="end">
                    {#if part.blocked}stopped for safety
                    {:else if !part.done}…
                    {:else if part.ok}✓{:else}✗{/if}
                  </span>
                </div>

                <!-- I file toccati da questa chiamata, dove sono stati toccati. Lo
                     stesso file può comparire più volte nel turno: sono modifiche
                     avvenute in momenti diversi, e in mezzo l'agent ha fatto altro. -->
                {#each editsOf(part.callId) as edit (edit.ts)}
                  <FileBlock edits={[edit]} narrow={store.narrow} />
                {/each}
              {/if}
            {/each}

            {#if turn.ended && turn.reason !== 'completed'}
              <div class="row bad"><Icon name="i-warn" /><span class="k">Turn {turn.reason}</span></div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    {#if snap.turns.length === 0}
      <div class="mid">Nothing has happened in this chat yet. Write the first message below.</div>
    {/if}
  </div>

  <Dock {store} {snap} />
</div>

<style>
  /* Le immagini mandate col prompt: piccole, perché sono un promemoria di cosa hai
     mandato, non la cosa da guardare. Un clic le apre a grandezza vera. */
  .pimgs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .pimgs img {
    max-height: 96px; max-width: 220px; border-radius: 7px;
    border: 1px solid var(--line-2); display: block;
  }
  .pimgs a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .th, .iconb, .effbtn { background: none; font: inherit; color: inherit; }
  .th { width: 100%; border: 0; text-align: left; }
  .th:focus-visible, .iconb:focus-visible, .effbtn:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }
  .iconb[disabled] { opacity: .4; cursor: default; }
  .prose { white-space: pre-wrap; }

  .bar .t { border: 0; padding: 0; text-align: left; cursor: text; }
  .rn {
    font: inherit; font-size: 12.5px; font-weight: 600; flex: 1;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 6px;
    background: var(--surface); color: var(--ink); outline: none;
  }

  /* La risposta data non è né un successo né un errore: è una decisione, e si legge
     come tale. Il rosso resta per quelle negate. */
  .row.answer { background: var(--accent-soft); }
  .row.answer .end { color: var(--ink-2); font-weight: 600; }
  .row.answer .end.no { color: var(--wait); }
</style>
