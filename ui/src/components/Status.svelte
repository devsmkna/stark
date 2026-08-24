<script lang="ts">
  // La barra sotto la casella di scrittura.
  //
  // Le tre cose che si cambiano *mentre* si lavora stanno qui e non in una schermata
  // di opzioni, perché è l'unico posto che si ha sotto gli occhi mentre si scrive il
  // primo messaggio — che è esattamente il momento in cui ci si accorge di volerle
  // diverse. Modello e modalità cambiano a caldo: nessun «riavvia per applicare».
  //
  // Le voci che non si possono usare restano in elenco, spente, **con scritto chi le
  // rifiuta** (Principio 5). Nasconderle farebbe sembrare STARK meno capace del CLI.
  import Icon from './Icon.svelte'
  import type { SessionSnapshot } from '$core/reduce.ts'
  import type { ModeChoice, PermissionMode } from '$core/events.ts'
  import { MODE_BLURB, MODE_ICON, tilde } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap }: { store: Store; snap: SessionSnapshot } = $props()

  let open = $state<'mode' | 'model' | 'mcp' | null>(null)
  let bar = $state<HTMLElement | null>(null)

  const canSwitchMode = $derived(snap.capabilities?.switchMode !== false && store.live)
  const canSwitchModel = $derived(snap.capabilities?.switchModel !== false && store.live)

  // Su un journal scritto prima che il modello canonico portasse gli elenchi, `modes`
  // è vuoto. Le sei modalità sono canoniche, quindi si mostrano lo stesso: quello che
  // manca è **quale non si può usare**, e in dubbio non si spegne niente.
  const MODES: PermissionMode[] =
    ['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']
  const modes = $derived<ModeChoice[]>(
    snap.modes.length > 0 ? snap.modes : MODES.map(mode => ({ mode, available: true })),
  )

  // `usage.updated` arriva a fine turno dal vivo, ma un trascritto importato non ce
  // l'ha: là i token stanno solo nei singoli turni. Sommarli è l'unica misura onesta
  // di quanto è costata la conversazione, e senza questo ripiego una chat importata
  // direbbe «0 tokens» su quattrocento blocchi.
  const usage = $derived.by(() => {
    const u = snap.usage
    if (u.input + u.output + u.cacheRead + u.cacheWrite > 0) return u
    const somma = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const t of snap.turns) {
      if (!t.usage) continue
      somma.input += t.usage.input; somma.output += t.usage.output
      somma.cacheRead += t.usage.cacheRead; somma.cacheWrite += t.usage.cacheWrite
    }
    return somma
  })
  const total = $derived(usage.input + usage.output + usage.cacheRead + usage.cacheWrite)

  const fmt = (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

  /** `resetsAt` arriva in secondi su Claude Code e in millisecondi altrove: si guarda
   *  l'ordine di grandezza invece di fidarsi di una delle due convenzioni. */
  function at(ts: number): string {
    if (!ts) return ''
    const d = new Date(ts < 1e12 ? ts * 1000 : ts)
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  }

  function choose(what: 'mode' | 'model' | 'mcp'): void {
    open = open === what ? null : what
  }
</script>

<svelte:window onpointerdown={e => {
  if (open && bar && !bar.contains(e.target as Node)) open = null
}} />
<svelte:document onkeydown={e => { if (e.key === 'Escape') open = null }} />

<div class="status" bind:this={bar}>
  <div class="l">
    <span class="pop">
      <button class="tune" disabled={!canSwitchMode} onclick={() => choose('mode')}
        title={canSwitchMode ? 'Permission mode' : 'This chat has no process behind it right now'}>
        <Icon name={MODE_ICON[snap.mode ?? 'auto'] ?? 'i-bolt'} style="color:var(--accent)" />
        {snap.mode ?? 'auto'}
        <Icon name="i-down" />
      </button>
      {#if open === 'mode'}
        <div class="menu">
          {#each modes as m (m.mode)}
            <button class="mi" class:on={m.mode === snap.mode} class:dis={!m.available}
              disabled={!m.available}
              onclick={() => { open = null; void store.setMode(m.mode) }}>
              <Icon name={MODE_ICON[m.mode] ?? 'i-shield'}
                style={m.mode === snap.mode ? 'color:var(--accent)' : ''} />
              <span>{m.mode}<span class="sub">{m.reason ?? MODE_BLURB[m.mode] ?? ''}</span></span>
              {#if !m.available}<span class="tag">unavailable</span>
              {:else if m.mode === snap.mode}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </span>

    <span class="pop">
      <!-- Nessun server MCP, e non per prudenza: una chat che ereditasse quelli della
           macchina costerebbe circa 5× di contesto per turno, cioè quota. Sceglierli
           per chat è la prossima manopola da collegare, non una che manca per svista. -->
      <button class="tune" onclick={() => choose('mcp')} title="External tool servers">
        <span style="color:var(--muted)">MCP</span>none<Icon name="i-down" />
      </button>
      {#if open === 'mcp'}
        <div class="menu" style="width:230px">
          <div class="mi on">
            <span>none<span class="sub">Fastest, cheapest, nothing leaves the folder</span></span>
            <Icon name="i-check" style="margin-left:auto;color:var(--accent)" />
          </div>
          <div class="mi dis">
            <Icon name="i-plug" />
            <span>pick servers<span class="sub">Not wired yet — the daemon does not list them.
              Every chat starts with none.</span></span>
          </div>
        </div>
      {/if}
    </span>

    <span class="sep">·</span>
    <Icon name="i-folder" /><span title={snap.cwd ?? ''}>{tilde(snap.cwd)}</span>
  </div>

  <div class="r">
    <span class="pop">
      <button class="tune" disabled={!canSwitchModel || snap.models.length === 0}
        onclick={() => choose('model')}
        title={snap.models.length === 0
          ? 'This chat was recorded before STARK carried the model list'
          : 'Model'}>
        {snap.model ?? '—'}
        {#if snap.models.length > 0}<Icon name="i-down" />{/if}
      </button>
      {#if open === 'model'}
        <div class="menu">
          {#each snap.models as m (m.id)}
            {@const current = m.id === snap.model || m.resolved === snap.model}
            <button class="mi" class:on={current}
              onclick={() => { open = null; void store.setModel(m.id) }}>
              {#if !m.autoMode}<Icon name="i-warn" style="color:var(--wait)" />{/if}
              <span>{m.label ?? m.id}<span class="sub">
                {m.autoMode
                  ? 'Supports auto mode'
                  : 'No auto mode — this chat would fall back and ask for everything'}
              </span></span>
              {#if current}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </span>

    <span class="sep">·</span>

    <!-- Nessuna cifra in denaro, mai: l'abbonamento è a quota fissa, quindi i soldi
         non sono la risorsa che scarseggia. Si dice quanto lavoro è passato di qui e
         quando la finestra si riapre. -->
    <button class="ctx" type="button">
      {fmt(total)} tokens
      <span class="tip">
        <div class="tr"><span>This chat</span><b>{fmt(total)}</b></div>
        <div class="tr"><small>{fmt(usage.input)} in · {fmt(usage.output)} out
          · {fmt(usage.cacheRead + usage.cacheWrite)} cache</small></div>
        <hr />
        {#if snap.quota}
          <div class="tr"><span>{snap.quota.kind.replace(/_/g, ' ')}</span><b>{snap.quota.status}</b></div>
          {#if snap.quota.resetsAt}
            <div class="tr"><small>resets {at(snap.quota.resetsAt)}</small></div>
          {/if}
          {#if snap.quota.usingOverage}
            <div class="tr"><small>counting against overage</small></div>
          {/if}
        {:else}
          <div class="tr"><small>The agent has not reported a rate limit for this chat yet.</small></div>
        {/if}
        <hr />
        <div class="tr"><small>{snap.lastSeq} events · {snap.turns.length} turns</small></div>
      </span>
    </button>
  </div>
</div>

<style>
  /* Il chip si preme, quindi è un <button>: qui c'è solo ciò che serve a togliergli
     l'aspetto di pulsante senza togliergli il mestiere. */
  .tune { font: inherit; font-size: 10px; cursor: pointer; }
  .tune[disabled] { cursor: default; opacity: .6; }
  .tune:focus-visible, .ctx:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* Il pannellino si apre al passaggio del mouse e col fuoco da tastiera: è un
     <button> perché quella seconda strada esista, non perché ci sia da premerlo. */
  button.ctx { border: 0; border-bottom: 1px dotted var(--muted); background: none;
    font: inherit; font-size: 10px; color: inherit; padding: 0; cursor: default; }

  .pop { position: relative; display: inline-flex; }
  /* Le tendine si aprono verso l'alto: sotto non c'è niente, la barra è l'ultima riga. */
  .pop .menu { position: absolute; bottom: calc(100% + 7px); left: 0; z-index: 7; }
  .r .pop .menu { left: auto; right: 0; }

  .mi { width: 100%; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; }
  .mi[disabled] { cursor: default; }
  .mi:not([disabled]):hover { background: var(--surface-2); }
  .mi.on:hover { background: var(--accent-soft); }
  .mi:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
