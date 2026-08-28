<script lang="ts">
  // La palette: si scrive un pezzo di nome, si preme Invio, si è dentro.
  //
  // Legge `store.rows` e nient'altro — cioè quello che il browser ha già in mano,
  // tenuto aggiornato dal flusso. Nessuna rotta, nessuna attesa: l'elenco si stringe
  // mentre si scrive. Cercare *dentro* le conversazioni resta un'altra cosa, e sta
  // nella casella dell'elenco, che è dove si va quando non si sa più come si chiama.
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import { project, colours } from '../lib/view.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  let q = $state('')
  let scelta = $state(0)
  let box = $state<HTMLInputElement | null>(null)
  let lista = $state<HTMLElement | null>(null)

  const palette = $derived(colours(store.rows))

  // Titolo e progetto, gli stessi due campi che la riga dell'elenco mostra. Niente
  // percorso per esteso: su cartelle profonde quasi tutto corrisponde a quasi tutto, e
  // una lista che non si stringe mentre scrivi non sta rispondendo alla domanda.
  const trovate = $derived.by(() => {
    const t = q.trim().toLowerCase()
    if (!t) return store.rows
    return store.rows.filter(r =>
      r.title.toLowerCase().includes(t) || project(r.cwd).toLowerCase().includes(t))
  })

  // La riga scelta non deve restare dov'era quando l'elenco cambia sotto: dopo aver
  // scritto una lettera in più, «la terza» può non esistere più.
  $effect(() => { void trovate.length; scelta = 0 })

  $effect(() => { box?.focus() })

  /** Portare in vista la riga scelta: è il difetto già trovato nel menu degli slash e
   *  in quello dei file — la nona freccia finiva sotto il bordo del riquadro. */
  async function invista(): Promise<void> {
    await tick()
    lista?.querySelector('.prow.on')?.scrollIntoView({ block: 'nearest' })
  }

  function tasto(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      scelta = Math.min(scelta + 1, trovate.length - 1)
      void invista()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      scelta = Math.max(scelta - 1, 0)
      void invista()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      apri(scelta)
    }
  }

  function apri(i: number): void {
    const r = trovate[i]
    if (!r) return
    store.dialog = null
    // Quello che fa un clic sulla riga: sostituisce la chat a fuoco. Ad affiancare è
    // il trascinamento, che è un gesto che si fa apposta — e una scorciatoia da
    // tastiera assomiglia molto più a un clic che a un trascinamento.
    void store.select(r.id)
  }
</script>

<div class="scrim" role="presentation" onclick={() => { store.dialog = null }}></div>
<div class="dlg pal">
  <div class="pq">
    <Icon name="i-search" />
    <!-- svelte-ignore a11y_autofocus -->
    <input class="field" autofocus bind:this={box} bind:value={q} onkeydown={tasto}
      placeholder="Go to a chat — type a name or a project" aria-label="Go to a chat" />
  </div>

  <div class="plist" bind:this={lista}>
    {#each trovate as r, i (r.id)}
      <button type="button" class="prow" class:on={i === scelta}
        onmousemove={() => { scelta = i }} onclick={() => apri(i)}>
        <i class="dotk p{palette.get(project(r.cwd)) ?? 0}"></i>
        <span class="pt">{r.title}</span>
        <span class="pp">{project(r.cwd)}</span>
        <span class="ps" class:livep={r.live}>{r.state}</span>
      </button>
    {/each}
    {#if trovate.length === 0}
      <div class="mid" style="padding:18px 12px">No chat matches that.</div>
    {/if}
  </div>

  <div class="pf">
    <span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span>
  </div>
</div>

<style>
  /* Al centro e in alto: l'occhio sta già sulla casella, e l'elenco cresce in giù
     senza che il riquadro salti mentre si scrive. */
  .pal {
    width: 560px; max-width: calc(100% - 26px);
    top: 12vh; bottom: auto; max-height: 70vh;
    display: flex; flex-direction: column;
  }
  .pq { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .pq .field { flex: 1; border: 0; background: none; outline: none; }
  .plist { overflow: auto; padding: 6px; min-height: 0; }
  .prow {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 8px; border: 0; border-radius: 7px; background: none;
    font: inherit; color: inherit; text-align: left; cursor: pointer;
  }
  .prow.on { background: var(--surface-2); }
  /* `min-width:0` è la metà che si dimentica: senza, un titolo lungo non lascia
     stringere il suo riquadro e l'ellissi non entra mai in gioco. */
  .pt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp, .ps { flex: none; color: var(--muted); font-size: .85em; }
  .ps.livep { color: var(--work); }
  .pf {
    display: flex; gap: 14px; padding: 8px 12px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: .8em;
  }
</style>
