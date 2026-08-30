<script lang="ts">
  // Il selettore del pannello destro: la divisione esiste già, manca solo da decidere
  // chi ci sta. È un invito, non una conversazione — per questo vive in una foglia
  // propria (`SPLIT_PICK`) senza `Pane`, senza fuoco e senza indirizzo.
  import type { Store } from '../lib/store.svelte.ts'
  import { label, project } from '../lib/view.ts'
  import { getLobeIconUrl } from '../lib/lobe.ts'
  import Icon from './Icon.svelte'

  let { store }: { store: Store } = $props()

  /**
   * Le chat fra cui scegliere: tutte quelle di STARK, la più recente in cima,
   * tranne quella che sta già a sinistra del selettore — è visibile lì accanto,
   * e «posizionarla a destra» non vorrebbe dire nulla.
   */
  const scelte = $derived(
    [...store.rows]
      .filter(r => r.id !== store.splitPickTarget)
      .sort((a, b) => b.lastTs - a.lastTs),
  )
</script>

<div class="pick">
  <div class="bar">
    <span class="t">Choose a chat for this panel</span>
    <button class="x" aria-label="Close" title="Close"
      onclick={() => store.chiudiSplitPick()}><Icon name="i-x" /></button>
  </div>
  <div class="list">
    {#each scelte as r (r.id)}
      <button class="row" title={r.title}
        onclick={() => void store.scegliSplit(r.id)}>
        {#if r.model && getLobeIconUrl(r.model)}
          <img src={getLobeIconUrl(r.model) ?? ''} alt="" width="14" height="14"
            style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy"
            onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
        {/if}
        <span class="tx">
          <span class="ttl">{r.title}</span>
          <span class="sub">{project(r.cwd)} · {label(r.state)}</span>
        </span>
        {#if store.panes.has(r.id)}<span class="open">open</span>{/if}
      </button>
    {:else}
      <div class="empty">No other chat</div>
    {/each}
  </div>
</div>

<style>
  /* Centrato su entrambi gli assi: è una domanda che si fa una volta, non un
     elenco di lavoro — non deve sembrare la sidebar replicata nel pannello. */
  .pick {
    flex: 1; min-width: 0; min-height: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--surface);
  }
  .bar {
    width: min(360px, 92%);
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  }
  .t { font-size: 11px; font-weight: 600; color: var(--ink-2); }
  .x {
    margin-left: auto; flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border: 0; border-radius: 6px; background: none;
    color: var(--muted); cursor: pointer; padding: 0;
  }
  .x:hover { background: var(--surface-2); color: var(--ink); }
  .list {
    width: min(360px, 92%); max-height: min(60%, 420px);
    overflow: auto; display: flex; flex-direction: column; gap: 1px;
    border: 1px solid var(--line-2); border-radius: 10px; padding: 4px;
    background: var(--surface);
  }
  .row {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    border: 0; border-radius: 7px; background: none; font: inherit; text-align: left;
    cursor: pointer; min-width: 0;
  }
  .row:hover { background: var(--surface-2); }
  .tx { flex: 1; min-width: 0; }
  .ttl {
    display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-size: 11px; color: var(--ink);
  }
  .sub {
    display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-size: 9.5px; color: var(--muted);
  }
  /* Una chat già aperta altrove si può scegliere lo stesso — la si sposta qui —
     ma il fatto che sia aperta va detto, se no lo spostamento sembra un doppione. */
  .open {
    flex: none; font-size: 8.5px; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--muted);
    border: 1px solid var(--line-2); border-radius: 999px; padding: 1px 6px;
  }
  .empty { padding: 10px; text-align: center; font-size: 11px; color: var(--muted); }
</style>
