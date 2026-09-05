<script lang="ts">
  // Il dettaglio di una card della board — le righe che erano il `.det` di
  // `Board.svelte`, estratte perché ora vivono in DUE posti: il pannello a lato della
  // Board (desktop) e il foglio a sé di `TaskSheet.svelte` (schermo stretto, card #35).
  // Un componente solo, così una riga aggiunta al dettaglio compare in entrambi senza
  // che nessuno debba ricordarsi dell'altro.
  //
  // L'aggiornamento ottimistico dello stato resta al genitore (`onstatus` riceve la
  // card com'era PRIMA): è lui che possiede la copia della card e sa come sostituirla.
  import Icon from './Icon.svelte'
  import type { BoardTask } from '../lib/api.ts'

  const { task, statuses, onstatus, onclose }: {
    task: BoardTask
    statuses: string[]
    onstatus: (originale: BoardTask, nuovo: string) => void
    onclose: () => void
  } = $props()
</script>

<div class="dh">
  <span class="dt">{task.title}</span>
  <button class="x" aria-label="Close details" onclick={onclose}>
    <Icon name="i-x" />
  </button>
</div>
<div class="db">
  <div class="drow">
    <span class="dl">Status</span>
    <select value={task.status}
      onchange={(e) => onstatus(task, (e.currentTarget as HTMLSelectElement).value)}>
      {#each statuses as s (s)}
        <option value={s}>{s}</option>
      {/each}
    </select>
  </div>
  {#if task.priority}
    <div class="drow"><span class="dl">Priority</span><span>{task.priority}</span></div>
  {/if}
  {#if task.assignee}
    <div class="drow"><span class="dl">Assignee</span><span>{task.assignee}</span></div>
  {/if}
  {#if task.claimed_by}
    <div class="drow"><span class="dl">Claimed by</span><span>@{task.claimed_by}</span></div>
  {/if}
  {#if task.tags && task.tags.length > 0}
    <div class="drow"><span class="dl">Tags</span><span>{task.tags.join(', ')}</span></div>
  {/if}
  {#if task.due}
    <div class="drow"><span class="dl">Due</span><span>{task.due}</span></div>
  {/if}
  {#if task.blocked}
    <div class="drow"><span class="dl">Blocked</span><span>{task.blocked}</span></div>
  {/if}
  {#if task.body}
    <div class="dbody">{task.body}</div>
  {/if}
</div>

<style>
  .dh { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .dt { font-size: 12px; font-weight: 600; color: var(--ink); flex: 1; }
  .x { background: none; border: 0; padding: 4px; cursor: pointer; color: var(--muted); display: flex; }
  .x:hover { color: var(--ink); }
  .db { flex: 1; overflow: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .drow { display: flex; align-items: baseline; gap: 8px; font-size: 11px; }
  .drow select { font: inherit; font-size: 11px; color: var(--ink); background: var(--surface);
                 border: 1px solid var(--line-2); border-radius: 6px; padding: 2px 5px; }
  .dl { color: var(--muted); width: 90px; flex: none; }
  .dbody { margin-top: 6px; font-size: 11px; line-height: 1.5; color: var(--ink-2);
           white-space: pre-wrap; }
</style>
