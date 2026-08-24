<script lang="ts">
  // L'elenco compatto: è la navigazione, non una barra di navigazione.
  //
  // Raggruppa per stato e, dentro ogni stato, per progetto — sempre, anche quando il
  // progetto è uno solo: la struttura non deve cambiare forma sotto gli occhi.
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import type { SessionRow } from '../lib/api.ts'
  import {
    ORDER, activityIcon, activityText, colours, group, hhmm, label, needsYou, project, since,
  } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  // L'orologio che fa avanzare «da quanto». Batte sempre, e l'effetto non legge NIENTE
  // di reattivo di proposito: legarlo alle righe — per battere piano quando non c'è
  // niente di vivo — rifà l'intervallo a ogni aggiornamento dell'elenco, e durante un
  // turno chiacchierone gli aggiornamenti arrivano più spesso di un secondo. Il tempo
  // si fermerebbe proprio mentre qualcosa succede. Un `setInterval` al secondo su una
  // decina di righe non costa niente; le stringhe che non cambiano non toccano il DOM.
  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => { now = Date.now() }, 1000)
    return () => clearInterval(t)
  })

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
    <!-- La campanella sta qui e non nella barra di stato perché le notifiche non sono
         di una chat ma di tutte. Premerla la prima volta è anche il momento in cui si
         chiede il permesso al browser: fuori da un gesto non si può nemmeno chiedere. -->
    <button class="bell" class:off={!store.calls.on}
      title={store.calls.explain} aria-label="Notifications"
      onclick={() => void store.calls.toggle()}>
      <Icon name={store.calls.on ? 'i-bell' : 'i-bell-off'} />
      {#if store.calls.on && store.calls.permission === 'default'}<i class="ask"></i>{/if}
    </button>
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
                  <!-- Da quanto sta così, che non è l'ora dell'ultima riga scritta:
                       è quello che distingue un lavoro che procede da uno piantato. -->
                  {#if row.since}<span class="el">· {since(row.since, now)}</span>{/if}
                </div>
                <!-- Cosa sta facendo adesso. Solo sulle righe vive: chi ha finito, chi
                     dorme e chi è stato fermato non sta facendo niente, e una riga in
                     più su ognuna costerebbe l'altezza dell'elenco per dire nulla. -->
                {#if row.doing}
                  <div class="act">
                    <Icon name={activityIcon(row.doing)} />
                    <span>{activityText(row.doing)}</span>
                  </div>
                {/if}
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
  .sit, .sidefoot, .plus, .bell {
    background: none;
    border: 0;
    width: 100%;
    font: inherit;
    color: inherit;
  }
  .plus, .bell { width: auto; padding: 0; display: flex; cursor: pointer; }
  /* Il puntino dice che il browser non ha ancora dato il permesso, e che premendo lo
     si chiede. Non è un errore: il suono intanto funziona già. */
  .bell { position: relative; }
  .bell .ask {
    position: absolute; top: -1px; right: -1px; width: 5px; height: 5px;
    border-radius: 50%; background: var(--accent);
  }
  .sit { width: calc(100% - 10px); }
  .sit:focus-visible, .sidefoot:focus-visible, .plus:focus-visible, .bell:focus-visible {
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
