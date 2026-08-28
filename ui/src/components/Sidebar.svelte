<script lang="ts">
  // L'elenco compatto: è la navigazione, non una barra di navigazione.
  //
  // Raggruppa per stato e, dentro ogni stato, per progetto — sempre, anche quando il
  // progetto è uno solo: la struttura non deve cambiare forma sotto gli occhi.
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import type { SessionRow } from '../lib/api.ts'
  import {
    ORDER, activityIcon, activityText, colours, group, hhmm, label, needsYou, project, stamp,
  } from '../lib/view.ts'
  import { quandoRiparte, quotaFerma } from '$core/quota.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  const palette = $derived(colours(store.rows, store.settings?.projects ?? {}))

  // ─── quota finita ─────────────────────────────────────────────────────────
  //
  // La quota è del **piano**, non della conversazione: quando finisce non si ferma la
  // chat su cui stavi, si fermano tutte quelle di quel profilo insieme. È l'unico
  // guasto di STARK che non appartiene a nessuna riga in particolare, e per questo
  // l'unico che ha diritto a una banda sopra l'elenco invece che a un segno dentro una
  // chat: entrare in una per scoprire perché si è fermata l'altra non è una risposta.
  //
  // `rejected` e non `allowed_warning`: l'avviso «ci sei quasi» sta già nel pannellino
  // della barra di stato, dove c'è anche quanto ne resta. Qui si dice solo ciò che
  // toglie la possibilità di lavorare, se no la banda diventa arredamento.
  /**
   * L'orologio che serve qui non batte: si sveglia **una volta**, al momento del
   * reset. Un limite scaduto letto da un journal vecchio mostrerebbe un allarme
   * finito, e senza niente che lo rilegga resterebbe lì — su chat ferme non arrivano
   * eventi, quindi l'elenco non si aggiorna da solo proprio nel caso che conta.
   */
  let adesso = $state(Date.now())

  // La regola sta in `core/quota.ts`, dove si prova senza mettere in scena una quota
  // esaurita in un browser: il caso al bordo (un limite già ripartito, letto da un
  // journal vecchio) si sbaglia leggendo, non guardando.
  const ferme = $derived(store.rows.filter(r => quotaFerma(r.quota, adesso)))

  /**
   * Il reset più lontano fra quelli che ci fermano: se la finestra da 5 ore e quella
   * settimanale sono finite insieme, ripartire dalla prima non serve a niente. Dire
   * l'ora più vicina sarebbe una promessa che non si mantiene.
   */
  const riparte = $derived(quandoRiparte(ferme.map(r => r.quota), adesso))
  // Solo l'ora esatta, niente «fra 2h 14m»: il conto alla rovescia richiederebbe un
  // orologio al secondo, che è precisamente quello che è stato tolto dall'elenco il 26
  // agosto perché era calcolo per niente. E delle due formulazioni è questa a decidere
  // — «conviene rimandare a domani?» si risponde con un orario, non con una durata.
  // Il pannellino della barra di stato continua a darle entrambe, dove lo spazio c'è.

  /**
   * Su quale profilo. Si dice **solo se la macchina ne usa più d'uno**: con un profilo
   * solo è rumore — sarebbe l'unica risposta possibile — mentre con due è la differenza
   * fra «è finita tutta» e «è finita quella di lavoro, quella personale va».
   */
  // Una sveglia sola, all'istante del reset più vicino fra quelli che ci fermano.
  // Non è un intervallo: scatta una volta, e se nel frattempo arriva un'altra chat
  // ferma l'effetto si rifà e la riprogramma.
  $effect(() => {
    const prossimo = Math.min(...store.rows
      .filter(r => quotaFerma(r.quota, adesso) && r.quota!.resetsAt > 0)
      .map(r => r.quota!.resetsAt))
    if (!Number.isFinite(prossimo)) return
    // `+1000`: svegliarsi all'istante esatto rischia di rileggere un orologio che non
    // è ancora passato oltre, e di non far scattare niente.
    const t = setTimeout(() => { adesso = Date.now() }, prossimo - adesso + 1000)
    return () => clearTimeout(t)
  })

  const profili = $derived.by(() => {
    const p = store.settings?.projects ?? {}
    const tutti = new Set(Object.values(p).map(x => x.profile).filter(Boolean))
    if (tutti.size < 2) return []
    const nostri = new Set(ferme.map(r => (r.cwd ? p[r.cwd]?.profile : undefined)).filter(Boolean))
    return [...nostri] as string[]
  })

  const tree = $derived(
    ORDER.map(g => {
      const byProject = new Map<string, SessionRow[]>()
      // `since`, non `lastTs`: `lastTs` avanza a ogni evento, quindi due chat "in
      // progress" si scavalcherebbero di continuo — una scrive un token, sale sopra
      // l'altra, che ne scrive uno e risale sopra la prima. `since` cambia solo
      // quando lo stato cambia (§1, `stateSince`): resta fermo per tutta la durata
      // del turno, e la più recente a essere *iniziata* sta sopra. Quando una finisce
      // per prima, cambia gruppo con un `since` nuovo — è così che finisce in cima
      // al suo, senza bisogno di un caso speciale per «chi ha risposto per primo».
      for (const r of store.rows.filter(r => group(r.state) === g)
        .sort((a, b) => b.since - a.since)) {
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
    <!-- L'interruttore della colonna dei task. Sta qui e non nella barra della chat
         perché la colonna è **una sola** per tutta la finestra: coi pannelli affiancati
         un bottone per pannello lascerebbe credere che ognuno abbia la sua. -->
    <button class="iconb" class:on={store.todoOpen}
      title={store.todoOpen ? 'Hide the todo column' : 'Show the todo column'}
      aria-label="Todo column" aria-pressed={store.todoOpen}
      onclick={() => store.toggleTodo()}>
      <Icon name="i-check" />
    </button>
    <button class="plus" title="New chat" aria-label="New chat"
      onclick={() => { store.refused = null; store.dialog = { kind: 'new' } }}>
      <Icon name="i-plus" />
    </button>
  </div>

  {#if ferme.length > 0}
    <div class="quotaout" role="status">
      <Icon name="i-warn" />
      <div>
        <div class="qt">Quota reached</div>
        <div class="qs">
          {ferme.length === 1 ? 'One chat is' : `${ferme.length} chats are`} stopped until
          {#if riparte}<b>{stamp(riparte)}</b>{:else}the limit resets{/if}
          {#if profili.length > 0}<br />on {profili.map(p => p.replace(/^.*\//, '')).join(', ')}{/if}
        </div>
      </div>
    </div>
  {/if}

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
              draggable="true"
              ondragstart={e => {
                e.dataTransfer?.setData('text/stark-chat-id', row.id)
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                store.draggingChat = row.id
              }}
              ondragend={() => { store.draggingChat = null }}
              oncontextmenu={e => openMenu(e, row)}
            >
              <div style="flex:1;text-align:left">
                <div class="ttl">{row.title}</div>
                <div class="meta">
                  {hhmm(row.lastTs)}
                  <span class="sst {label(row.state)}">{label(row.state)}</span>
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

  <button class="sidefoot" title="Settings"
    onclick={() => { store.refused = null; store.dialog = { kind: 'settings' } }}>
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
  .sidefoot { cursor: pointer; }
  .rn {
    width: 100%; font: inherit; font-size: 11.5px; font-weight: 600;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 5px;
    background: var(--surface); color: var(--ink); outline: none;
  }
</style>
