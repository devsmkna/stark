<script lang="ts">
  // Il blocco in basso: tutto ciò che si comanda sta qui, attorno alla casella.
  //
  // È sempre lo stesso pezzo di schermo in tre stati — mentre lavora dice cosa sta
  // facendo, quando ha bisogno di te si espande, e sotto c'è la barra che si preme.
  // Non è una disposizione comoda: è la conseguenza di non far comparire le richieste
  // in mezzo alla conversazione (vedi Ask.svelte).
  import Icon from './Icon.svelte'
  import Ask from './Ask.svelte'
  import Status from './Status.svelte'
  import type { SessionSnapshot } from '$core/reduce.ts'
  import type { SlashCommand } from '$core/events.ts'
  import { activity } from '$core/activity.ts'
  import { activityText, since } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store, snap }: { store: Store; snap: SessionSnapshot } = $props()

  let text = $state('')
  let box = $state<HTMLTextAreaElement | null>(null)
  // L'orologio che fa avanzare «3s». Batte solo mentre serve: un intervallo che gira
  // su una chat ferma ridisegnerebbe la pagina una volta al secondo per niente.
  let now = $state(Date.now())

  // Tutto ciò che è «in corso» è vero solo se dietro c'è un processo. Il journal di
  // una sessione fermata dal riavvio del daemon finisce a metà di un turno, e ripeterlo
  // alla lettera mostrerebbe una rotellina che gira su niente e una domanda a cui non
  // c'è più nessuno a rispondere — la bugia peggiore, perché è quella su cui si aspetta.
  const busy = $derived(store.live && (snap.state === 'busy' || snap.state === 'starting'))
  const pending = $derived(snap.pendingPermissions.length + snap.pendingQuestions.length > 0)
  const asking = $derived(store.live && pending)
  const op = $derived(busy ? activity(snap) : null)

  $effect(() => {
    if (!busy) return
    const t = setInterval(() => { now = Date.now() }, 1000)
    return () => clearInterval(t)
  })

  async function send(): Promise<void> {
    const draft = text
    if (!draft.trim()) return
    // Si svuota subito: se il comando fosse rifiutato, il testo torna. Aspettare la
    // risposta per svuotare farebbe sembrare lenta una casella che non lo è.
    text = ''
    grow()
    const ok = await store.prompt(draft)
    if (!ok) { text = draft; grow() }
  }

  function key(e: KeyboardEvent): void {
    // Col menu dei comandi aperto i tasti vogliono dire un'altra cosa: Invio completa
    // invece di mandare. Mandare "/comp" a metà è l'errore che il menu esiste per
    // evitare, quindi qui viene prima di tutto il resto.
    if (comandi.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); scelto = (scelto + 1) % comandi.length; return }
      if (e.key === 'ArrowUp') { e.preventDefault(); scelto = (scelto - 1 + comandi.length) % comandi.length; return }
      if (e.key === 'Escape') { e.preventDefault(); chiuso = true; return }
      if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        completa(comandi[scelto]!)
        return
      }
    }
    // Invio manda, Maiusc+Invio va a capo. È la convenzione di ogni casella di
    // messaggio, e qui vale a maggior ragione: si scrivono richieste di una riga.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  // ─── i comandi slash ──────────────────────────────────────────────────────

  /** Chiuso a mano con Esc: si riapre scrivendo, non appena si torna sulla casella. */
  let chiuso = $state(false)
  let scelto = $state(0)

  /**
   * Il menu vive finché si sta scrivendo **il nome**: dal `/` iniziale al primo spazio.
   * Dopo lo spazio si stanno scrivendo gli argomenti, e un elenco che resta aperto lì
   * coprirebbe quello che si scrive per proporre cose che non servono più.
   */
  const parola = $derived(
    !chiuso && store.live && /^\/[^\s]*$/.test(text) ? text.slice(1).toLowerCase() : null,
  )

  const comandi = $derived.by(() => {
    if (parola === null) return []
    const tutti = snap.slashCommands
    // Prima quelli che *cominciano* per quello che hai scritto, poi quelli che lo
    // contengono: cercando "review" si vuole `/code-review`, ma digitando "c" si
    // vuole `/clear` prima di `/code-review`.
    const nome = (c: SlashCommand): string[] => [c.name, ...(c.aliases ?? [])]
    const inizia = tutti.filter(c => nome(c).some(n => n.toLowerCase().startsWith(parola)))
    const dentro = tutti.filter(c => !inizia.includes(c)
      && nome(c).some(n => n.toLowerCase().includes(parola)))
    return [...inizia, ...dentro].slice(0, 40)
  })

  // La riga scelta torna in cima a ogni cambio di filtro: lasciarla dov'era la
  // farebbe puntare a un comando diverso da quello che si stava guardando.
  $effect(() => { void parola; scelto = 0 })
  $effect(() => { if (text === '') chiuso = false })

  function completa(c: SlashCommand): void {
    // Chiudere dopo aver scelto non è cosmesi: senza, `/doctor` — che non prende
    // argomenti — resta a filtrare se stesso, e il secondo Invio ricompleta invece di
    // mandare. Si riapre appena si scrive un altro carattere.
    chiuso = true
    // Lo spazio finale solo se il comando prende qualcosa: senza, Invio manda subito,
    // che è quello che si vuole dopo aver scelto `/clear`.
    text = `/${c.name}${c.argumentHint ? ' ' : ''}`
    box?.focus()
    grow()
  }

  /** La casella cresce col testo fino a un tetto, poi scorre. */
  function grow(): void {
    const el = box
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }
</script>

<div class="dock">
  {#if store.refused}
    <div class="refused">
      <Icon name="i-warn" />
      <span>{store.refused}</span>
      <button class="x" onclick={() => { store.refused = null }} aria-label="Dismiss">✕</button>
    </div>
  {/if}

  {#if asking}
    <!-- Lo Stop resta anche col blocco espanso, e non è un dettaglio: una richiesta
         arriva mentre l'agent sta ancora lavorando, e lo stato canonico in quel momento
         è `awaiting`, non `busy`. Legarlo a `busy` lo farebbe sparire proprio nel
         momento in cui serve di più. -->
    <Ask {store} {snap} canStop={store.live} />
  {:else if op}
    <div class="doing">
      <span class="spin"></span>
      <div class="txt">{activityText(op)}</div>
      <div class="el">{since(op.from, now)}</div>
      {#if store.live}
        <button class="stopb" title="Stop" onclick={() => void store.stop()}>
          <svg viewBox="0 0 24 24"><use href="#i-stop" /></svg>
        </button>
      {/if}
    </div>
  {/if}

  {#if comandi.length > 0}
    <!-- Sopra la casella e non sotto: sotto finirebbe fuori dalla finestra, e
         soprattutto il posto dove si guarda mentre si scrive è appena sopra ciò che
         si scrive. -->
    <div class="slash" role="listbox" tabindex="-1" aria-label="Slash commands">
      {#each comandi as c, i (c.name)}
        <button class="mi" class:on={i === scelto} role="option" aria-selected={i === scelto}
          onmousedown={e => { e.preventDefault(); completa(c) }}>
          <!-- Due righe, e **una riga ciascuna**: la descrizione di una skill è un
               paragrafo intero, e lasciata libera fa una riga alta mezzo schermo.
               Qui serve riconoscere il comando, non leggerne il manuale. -->
          <span class="txt">
            <span class="line">
              <b>/{c.name}</b>
              {#if c.argumentHint}<span class="hint2">{c.argumentHint}</span>{/if}
              {#if c.aliases?.length}<span class="hint2">— {c.aliases.map(a => `/${a}`).join(', ')}</span>{/if}
            </span>
            {#if c.description}<span class="sub" title={c.description}>{c.description}</span>{/if}
          </span>
          <!-- Non si nasconde: il CLI ce l'ha. Si dice che lì non funziona, e se lo
               mandi lo stesso è l'agent a spiegarlo — noi non lo blocchiamo. -->
          {#if c.terminalOnly}<span class="tag">terminal only</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if store.live}
    <textarea
      class="input"
      bind:this={box}
      bind:value={text}
      oninput={() => { chiuso = false; grow() }}
      onkeydown={key}
      rows="1"
      placeholder="Message the agent…"
    ></textarea>
  {:else}
    <!-- Senza un processo dietro, una casella che accetta un messaggio lo perde. Al
         suo posto la via per riaprire — e il prezzo, detto adesso e non scoperto
         dopo dal contatore: risvegliare rilegge tutto il contesto, quindi costa quota.
         Lo Sleep libera memoria, non quota. -->
    <div class="asleep">
      <div class="t">
        {snap.state === 'sleeping' ? 'This chat is asleep.' : 'This chat has no process behind it.'}
      </div>
      <div class="d">
        {#if pending}It stopped while it was waiting for an answer from you.{/if}
        Reopening it re-reads the whole conversation, which costs quota.
      </div>
      <button class="btn pri" disabled={store.working || !store.row}
        onclick={() => { const r = store.row; if (r) void store.wake(r) }}>
        {store.working ? 'Reopening…' : 'Reopen'}
      </button>
    </div>
  {/if}

  <Status {store} {snap} />
</div>

<style>
  /* La casella è un <textarea> vestito come il riquadro del disegno: stessa cornice,
     stesso passo, senza il bordo e la barra di scorrimento che il browser ci mette. */
  textarea.input {
    display: block; width: calc(100% - 24px); resize: none; overflow-y: auto;
    font: inherit; font-size: 11px; line-height: 1.45;
    background: var(--surface); color: var(--ink); max-height: 160px;
  }
  textarea.input::placeholder { color: var(--muted); }

  /* Le righe sono <button> perché si premono; il vestito viene da app.css. */
  .slash .mi {
    width: 100%; background: none; border: 0; font: inherit; color: inherit;
    text-align: left; cursor: pointer;
  }
  /* Il `background: none` qui sopra è più specifico di `.mi.on` in app.css e se lo
     mangiava: la riga scelta con le frecce restava invisibile, cioè il menu non si
     poteva usare da tastiera — che è il modo in cui lo si usa. */
  .slash .mi.on { background: var(--accent-soft); }
  .slash .mi:hover:not(.on) { background: var(--surface-2); }
  .slash .mi:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  textarea.input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

  .stopb:focus-visible { outline: 2px solid var(--stop); outline-offset: 1px; }

  .refused {
    display: flex; align-items: center; gap: 7px; padding: 6px 12px;
    background: var(--stop-bg); color: var(--stop); font-size: 10.5px; font-weight: 600;
  }
  .refused .x {
    margin-left: auto; background: none; border: 0; color: inherit; font: inherit; padding: 0 2px;
  }

  .asleep {
    margin: 0 12px 8px; padding: 9px 11px; border-radius: 9px;
    border: 1px dashed var(--line-2); background: var(--surface-2);
    display: flex; align-items: center; gap: 10px;
  }
  .asleep .t { font-size: 11.5px; font-weight: 600; color: var(--ink); }
  .asleep .d { font-size: 10px; color: var(--muted); flex: 1; }
  .asleep .btn { flex: none; }
  .asleep .btn[disabled] { opacity: .6; cursor: default; }
</style>
