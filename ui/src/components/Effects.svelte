<script lang="ts">
  // Il riepilogo di ciò che è stato fatto — e prende il posto della conversazione,
  // non si apre sopra: sono due letture della stessa chat, non due schermate.
  //
  // Perché esiste: l'agent scrive «ho aggiornato il file e i test passano», e quella è
  // una *affermazione*. Le operazioni che ha eseguito sono i *fatti*. Nel flusso stanno
  // mescolati; qui i fatti hanno un posto loro, dove si va a controllare.
  //
  // Due letture, e la differenza è tutta qui: «per file» risponde a *cosa è cambiato*
  // e nomina un file una volta sola; «in ordine di tempo» risponde a *cosa ha fatto* e
  // lo nomina tre volte se l'ha toccato tre volte.
  import Icon from './Icon.svelte'
  import FileBlock from './FileBlock.svelte'
  import type { CommandRunView, FileEditView, SessionSnapshot } from '$core/reduce.ts'
  import { stats } from '$core/diff.ts'
  import { hhmm } from '../lib/view.ts'
  import type { Store, View } from '../lib/store.svelte.ts'

    // `id` non serve qui dentro — gli effetti si leggono tutti da `snap` — ma la firma
  // è la stessa di `Conversation` di proposito: chi monta un pannello passa le stesse
  // due prop a entrambe le letture, senza doversi ricordare quale delle due le vuole.
  let { store, snap, id: _id, setView }:
    {
      store: Store; snap: SessionSnapshot
      id: string
      setView: (v: View) => void
    } = $props()

  let mode = $state<'file' | 'time'>('file')

  /** Un file una volta sola, nell'ordine in cui è comparso la prima volta. */
  const byFile = $derived.by(() => {
    const map = new Map<string, FileEditView[]>()
    for (const f of snap.files) {
      const list = map.get(f.path)
      if (list) list.push(f); else map.set(f.path, [f])
    }
    return [...map.values()]
  })

  type Moment =
    | { kind: 'file'; ts: number; edit: FileEditView }
    | { kind: 'shell'; ts: number; run: CommandRunView }
    | { kind: 'blocked'; ts: number; reason: string }

  const byTime = $derived.by((): Moment[] => {
    const out: Moment[] = [
      ...snap.files.map(edit => ({ kind: 'file' as const, ts: edit.ts, edit })),
      ...snap.shell.map(run => ({ kind: 'shell' as const, ts: run.ts, run })),
      // Un'azione fermata dal classificatore compare qui e non fra i comandi: nel
      // flusso scorre via mentre l'agent si corregge da solo, ma è successa, e il
      // posto dove si va a controllare deve dirlo.
      ...snap.blocked.map(b => ({ kind: 'blocked' as const, ts: b.ts, reason: b.reason })),
    ]
    return out.sort((a, b) => a.ts - b.ts)
  })

  const nf = $derived(byFile.length)
  const nc = $derived(snap.shell.length)

  /** L'esito di un comando in due parole. Interrotto non è fallito. */
  function outcome(r: CommandRunView): { text: string; bad: boolean } {
    if (r.interrupted) return { text: 'interrupted', bad: false }
    if (r.exitCode === undefined) return { text: '', bad: false }
    return r.exitCode === 0
      ? { text: '✓', bad: false }
      : { text: `✗ exit ${r.exitCode}`, bad: true }
  }

  const short = (s: string): string =>
    s.replace(/\s+/g, ' ').trim().slice(0, 200)
</script>

<div class="col">
  <div class="bar">
    <button class="iconb" title="Back to the conversation"
      onclick={() => setView('chat')}><Icon name="i-back" /></button>
    <div class="t">
      {nf} {nf === 1 ? 'file' : 'files'} · {nc} {nc === 1 ? 'command' : 'commands'}
    </div>
    <div class="switch">
      <button class:on={mode === 'file'} onclick={() => { mode = 'file' }}>By file</button>
      <button class:on={mode === 'time'} onclick={() => { mode = 'time' }}>By time</button>
    </div>
  </div>

  <div class="scroller" style="padding:12px;flex:1">
    {#if mode === 'file'}
      {#each byFile as edits (edits[0]!.path)}
        <FileBlock {edits} narrow={store.narrow} {store} />
      {/each}
      {#if byFile.length === 0}
        <div class="mid">No file has been touched in this chat.</div>
      {/if}

    {:else}
      {#each byTime as m, i (i)}
        <div class="tl">
          <div class="when">{hhmm(m.ts)}</div>
          <div class="body">
            {#if m.kind === 'file'}
              <FileBlock edits={[m.edit]} narrow={store.narrow} {store} />
            {:else if m.kind === 'shell'}
              {@const o = outcome(m.run)}
              <div class="row" class:bad={o.bad}>
                <Icon name="i-term" />
                <span class="v">{short(m.run.command)}</span>
                <span class="end" style={o.bad ? 'color:var(--stop)' : ''}>{o.text}</span>
              </div>
            {:else}
              <!-- Bloccato non è un fallimento: è «fermato, e puoi consentirlo tu». -->
              <div class="row block">
                <Icon name="i-block" />
                <span class="v">{short(m.reason)}</span>
                <span class="end" style="color:var(--wait)">blocked</span>
              </div>
            {/if}
          </div>
        </div>
      {/each}
      {#if byTime.length === 0}
        <div class="mid">Nothing has happened in this chat yet.</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .iconb:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .switch button {
    border: 0; background: none; font: inherit; font-size: 10px;
    padding: 3px 9px; color: var(--muted); cursor: pointer;
  }
  .switch button.on { background: var(--surface-3); color: var(--ink); font-weight: 600; }
  .switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  /* Nel flusso «in ordine di tempo» un file è una riga come le altre: il blocco non
     deve staccarsi dalla sua ora con un margine che le altre righe non hanno. */
  .tl :global(.fileblk) { margin-bottom: 0; }
</style>
