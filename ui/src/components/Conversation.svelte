<script lang="ts">
  import Icon from './Icon.svelte'
  import type { LinkStatus } from '../lib/api.ts'
  import type { PartView, SessionSnapshot, TurnView } from '$core/reduce.ts'
  import { colours, project } from '../lib/view.ts'

  let { snap, link }: { snap: SessionSnapshot; link: LinkStatus } = $props()

  // Quasi tutto è chiuso di partenza: è l'unico modo di reggere quattrocento blocchi.
  // Aperto solo l'ultimo turno, che è quello a cui si sta lavorando.
  let opened = $state<Set<string>>(new Set())
  const isOpen = (t: TurnView, i: number): boolean =>
    opened.has(t.turnId) ? true : (i === snap.turns.length - 1 && !opened.has(`!${t.turnId}`))

  function toggle(t: TurnView, i: number): void {
    const next = new Set(opened)
    if (isOpen(t, i)) { next.delete(t.turnId); next.add(`!${t.turnId}`) }
    else { next.add(t.turnId); next.delete(`!${t.turnId}`) }
    opened = next
  }

  const promptOf = (t: TurnView): string => t.prompt.map(p => p.text).join(' ')
  const colour = $derived((colours([{ cwd: snap.cwd } as never]).get(project(snap.cwd)) ?? 0))

  // Il nome del tool è vocabolario dell'agent, e questa mappa è presentazione: decide
  // solo che segno disegnare. Nessuna logica dipende da questi nomi.
  function icon(name: string): string {
    if (name.startsWith('mcp__')) return 'i-plug'
    if (name === 'Bash' || name === 'BashOutput' || name === 'KillShell') return 'i-term'
    if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') return 'i-brick'
    if (name === 'WebFetch' || name === 'WebSearch') return 'i-globe'
    if (name === 'Task' || name === 'Agent') return 'i-brain'
    return 'i-doc'
  }

  /**
   * DEBITO, e va detto: questo indovina. Il §7 consegna `input: unknown`, quindi per
   * scrivere «su cosa» il tool ha lavorato la UI deve guardare dentro una forma che è
   * di Claude Code — cioè fare proprio ciò che il §1 vieta fuori dall'adapter. Finché
   * il modello canonico non porta un riassunto già pronto, la bugia sta almeno tutta
   * in questa funzione e non sparsa nei componenti.
   */
  function subject(part: Extract<PartView, { kind: 'tool' }>): string {
    const raw = part.input
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt']) {
        const v = o[key]
        if (typeof v === 'string' && v) return v
      }
    }
    return part.inputRaw.slice(0, 120)
  }
</script>

<div class="col">
  <div class="bar">
    <i class="dotk p{colour}"></i>
    <div class="t">{project(snap.cwd)}</div>
    <button class="iconb" title="Put to sleep" style="margin-left:auto"><Icon name="i-moon" /></button>
    <button class="effbtn" style="margin-left:0">
      <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
        {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      <Icon name="i-bars" />
    </button>
  </div>

  {#if link !== 'live'}
    <div class="offline">
      <Icon name={link === 'connecting' ? 'i-loader' : 'i-wifi-off'} style="animation:{link === 'connecting' ? 'sp 1.1s linear infinite' : 'none'}" />
      {link === 'connecting' ? 'Connecting…' : 'Connection lost — retrying, nothing is missed'}
    </div>
  {/if}

  <div class="scroller conv">
    {#each snap.turns as turn, i (turn.turnId)}
      {@const open = isOpen(turn, i)}
      <div class="turn" class:open>
        <button class="th" onclick={() => toggle(turn, i)}>
          <span class="cx">{open ? '▾' : '▸'}</span>
          <span class="q">{promptOf(turn)}</span>
          <span class="n">{turn.parts.length} blocks</span>
        </button>

        {#if open}
          <div class="tb">
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
              {:else}
                <!-- `bad` solo se NON è bloccata: un'azione fermata dal classificatore
                     torna comunque come tool fallito, e senza questa esclusione le due
                     classi si sovrappongono e vince il rosso. Ma bloccato non è un
                     fallimento — è «fermato, e puoi consentirlo tu». -->
                <div class="row" class:bad={part.done && part.ok === false && !part.blocked}
                     class:block={!!part.blocked}>
                  <Icon name={part.blocked ? 'i-block' : icon(part.name)} />
                  <span class="k">{part.blocked ? 'Blocked' : part.name}</span>
                  <span class="v">{subject(part)}</span>
                  <span class="end">
                    {#if part.blocked}stopped for safety
                    {:else if !part.done}…
                    {:else if part.ok}✓{:else}✗{/if}
                  </span>
                </div>
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
      <div class="mid">Nothing has happened in this chat yet.</div>
    {/if}
  </div>

  <div class="dock">
    {#if snap.state === 'busy'}
      <div class="doing">
        <span class="spin"></span>
        <div class="txt">working…</div>
        <button class="stopb" title="Stop"><svg viewBox="0 0 24 24"><use href="#i-stop" /></svg></button>
      </div>
    {/if}
    <div class="input">Message the agent… — not wired yet, this slice only reads</div>
    <div class="status">
      <div class="l">
        <span class="tune"><Icon name="i-bolt" style="color:var(--accent)" />{snap.mode ?? 'auto'}</span>
        <span class="sep">·</span>
        <Icon name="i-folder" /><span>{snap.cwd ?? '—'}</span>
      </div>
      <div class="r">
        <span class="tune">{snap.model ?? '—'}</span>
        <span class="sep">·</span>
        <span>{snap.lastSeq} events</span>
      </div>
    </div>
  </div>
</div>

<style>
  .th, .iconb, .effbtn, .stopb { background: none; font: inherit; color: inherit; }
  .th { width: 100%; border: 0; text-align: left; }
  .th:focus-visible, .iconb:focus-visible, .effbtn:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }
  .prose { white-space: pre-wrap; }
</style>
