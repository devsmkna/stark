<script lang="ts">
  // Un file toccato, come blocco che si apre sul confronto.
  //
  // Prende una **lista** di modifiche e non una sola perché lo stesso file può essere
  // scritto più volte, e le due letture degli effetti lo raccontano diversamente: «per
  // file» lo nomina una volta con quante volte è stato toccato, «in ordine di tempo»
  // una volta per modifica. Lo stesso componente serve entrambe passandogli una lista
  // lunga o lunga uno.
  import Icon from './Icon.svelte'
  import Diff from './Diff.svelte'
  import { stats } from '$core/diff.ts'
  import type { FileEditView } from '$core/reduce.ts'
  import { hhmm } from '../lib/view.ts'

  let { edits, narrow = false, when = false, open = $bindable(false) }:
    { edits: FileEditView[]; narrow?: boolean; when?: boolean; open?: boolean } = $props()

  const totals = $derived(stats(edits.flatMap(e => e.hunks)))
  const created = $derived(edits.some(e => e.created))
  const path = $derived(edits[0]?.path ?? '')
</script>

<div class="fileblk">
  <button class="fh" onclick={() => { open = !open }} aria-expanded={open}>
    <Icon name="i-brick" />
    <span class="nm">{path}</span>
    <span class="st">
      {#if when}<span style="color:var(--muted)">{hhmm(edits[0]?.ts ?? 0)}</span>{/if}
      {#if created}<span style="color:var(--muted)">created</span>
      {:else if edits.length > 1}<span style="color:var(--muted)">{edits.length} changes</span>{/if}
      <span class="pl">+{totals.added}</span>
      <span class="mn">−{totals.removed}</span>
      <span style="color:var(--muted)">{open ? '▾' : '▸'}</span>
    </span>
  </button>

  {#if open}
    {#each edits as edit, i (edit.callId ?? i)}
      {#if edits.length > 1}
        <div class="editsep">change {i + 1} of {edits.length} · {hhmm(edit.ts)}</div>
      {/if}
      <Diff hunks={edit.hunks} {narrow} />
    {/each}
  {/if}
</div>

<style>
  .fh { width: 100%; border: 0; text-align: left; font: inherit; color: inherit; }
  .fh:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .editsep {
    padding: 3px 10px; font-size: 9.5px; color: var(--muted);
    background: var(--surface-2); border-top: 1px solid var(--line);
  }
</style>
