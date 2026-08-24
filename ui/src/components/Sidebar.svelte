<script lang="ts">
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import type { SessionRow } from '../lib/api.ts'
  import { ORDER, colours, group, hhmm, label, needsYou, project } from '../lib/view.ts'

  let { rows, selected, onpick }:
    { rows: SessionRow[]; selected: string | null; onpick: (id: string) => void } = $props()

  const palette = $derived(colours(rows))

  // Stato, e dentro ogni stato il progetto — sempre, anche quando il progetto è uno
  // solo: la struttura non deve cambiare forma sotto gli occhi.
  const tree = $derived(
    ORDER.map(g => {
      const byProject = new Map<string, SessionRow[]>()
      for (const r of rows.filter(r => group(r.state) === g).sort((a, b) => b.lastTs - a.lastTs)) {
        const p = project(r.cwd)
        const list = byProject.get(p)
        if (list) list.push(r); else byProject.set(p, [r])
      }
      return { g, projects: [...byProject].sort((a, b) => a[0].localeCompare(b[0])) }
    }).filter(x => x.projects.length > 0),
  )
</script>

<div class="side">
  <div class="sidetop">
    <Logo height={13} />
    <button class="plus" title="New chat" aria-label="New chat"><Icon name="i-plus" /></button>
  </div>

  <div class="scroller" style="flex:1;padding-bottom:6px">
    {#each tree as section (section.g)}
      <div class="gstate">{section.g}</div>
      {#each section.projects as [name, list] (name)}
        <div class="gproj"><i class="dotk p{palette.get(name) ?? 0}"></i> {name}</div>
        {#each list as row (row.id)}
          <button
            class="sit"
            class:on={row.id === selected}
            class:zz={section.g === 'Sleeping'}
            onclick={() => onpick(row.id)}
          >
            <div style="flex:1;text-align:left">
              <div class="ttl">{row.title}</div>
              <div class="meta">
                {hhmm(row.lastTs)}
                <span class="sst {label(row.state)}">{label(row.state)}</span>
              </div>
            </div>
            {#if needsYou(row.state)}<span class="unread"></span>{/if}
          </button>
        {/each}
      {/each}
    {/each}

    {#if tree.length === 0}
      <div class="mid" style="padding:20px 14px">No chats yet.</div>
    {/if}
  </div>

  <button class="sidefoot" title="Settings"><Icon name="i-gear" /> Settings</button>
</div>

<style>
  /* Le righe sono <button> perché si premono: il vestito viene da app.css, qui c'è
     solo ciò che serve a togliere l'aspetto di pulsante senza perderne il mestiere. */
  .sit, .sidefoot, .plus {
    background: none;
    border: 0;
    width: 100%;
    font: inherit;
    color: inherit;
  }
  .plus { width: auto; padding: 0; display: flex; }
  .sit { width: calc(100% - 10px); }
  .sit:focus-visible, .sidefoot:focus-visible, .plus:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
