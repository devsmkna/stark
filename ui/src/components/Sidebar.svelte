<script lang="ts">
  // L'elenco compatto: è la navigazione, non una barra di navigazione.
  //
  // Raggruppa per stato e, dentro ogni stato, per progetto — sempre, anche quando il
  // progetto è uno solo: la struttura non deve cambiare forma sotto gli occhi.
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import type { SessionRow } from '../lib/api.ts'
  import { ORDER, colours, group, hhmm, label, needsYou, project } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  const palette = $derived(colours(store.rows))

  const tree = $derived(
    ORDER.map(g => {
      const byProject = new Map<string, SessionRow[]>()
      for (const r of store.rows.filter(r => group(r.state) === g)
        .sort((a, b) => b.lastTs - a.lastTs)) {
        const p = project(r.cwd)
        const list = byProject.get(p)
        if (list) list.push(r); else byProject.set(p, [r])
      }
      return { g, projects: [...byProject].sort((a, b) => a[0].localeCompare(b[0])) }
    }).filter(x => x.projects.length > 0),
  )

  let draft = $state('')

  function openMenu(e: MouseEvent, row: SessionRow): void {
    e.preventDefault()
    store.menu = { id: row.id, x: e.clientX, y: e.clientY }
  }

  async function commit(row: SessionRow): Promise<void> {
    const text = draft
    store.renaming = null
    if (text.trim() && text !== row.title) await store.rename(row.id, text)
  }

  $effect(() => {
    const id = store.renaming
    if (id) draft = store.rows.find(r => r.id === id)?.title ?? ''
  })
</script>

<div class="side">
  <div class="sidetop">
    <Logo height={13} />
    <button class="plus" title="New chat" aria-label="New chat"
      onclick={() => { store.refused = null; store.dialog = { kind: 'new' } }}>
      <Icon name="i-plus" />
    </button>
  </div>

  <div class="scroller" style="flex:1;padding-bottom:6px">
    {#each tree as section (section.g)}
      <div class="gstate">{section.g}</div>
      {#each section.projects as [name, list] (name)}
        <div class="gproj"><i class="dotk p{palette.get(name) ?? 0}"></i> {name}</div>
        {#each list as row (row.id)}
          {#if store.renaming === row.id}
            <!-- Rinominare non apre una schermata: il titolo diventa scrivibile dov'è.
                 svelte-ignore a11y_autofocus -->
            <div class="sit">
              <!-- svelte-ignore a11y_autofocus -->
              <input class="rn" autofocus bind:value={draft}
                onblur={() => void commit(row)}
                onkeydown={e => {
                  if (e.key === 'Enter') void commit(row)
                  if (e.key === 'Escape') store.renaming = null
                }} />
            </div>
          {:else}
            <button
              class="sit"
              class:on={row.id === store.selected}
              class:zz={section.g === 'Sleeping'}
              onclick={() => void store.select(row.id)}
              oncontextmenu={e => openMenu(e, row)}
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
          {/if}
        {/each}
      {/each}
    {/each}

    {#if tree.length === 0}
      <div class="mid" style="padding:20px 14px">No chats yet.</div>
    {/if}
  </div>

  <button class="sidefoot" title="Settings — not wired yet" disabled>
    <Icon name="i-gear" /> Settings
  </button>
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
  .sidefoot[disabled] { opacity: .55; cursor: default; }
  .rn {
    width: 100%; font: inherit; font-size: 11.5px; font-weight: 600;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 5px;
    background: var(--surface); color: var(--ink); outline: none;
  }
</style>
