<script lang="ts">
  /**
   * I modelli della macchina: prima gli agent, poi i modelli di quello scelto.
   *
   * Due livelli e non una lista sola, e la ragione è una misura: il catalogo di questa
   * macchina ha **156 modelli**, 151 dei quali di un agent solo. Appiattirli produceva
   * una colonna che non finiva più, in cui i cinque modelli che si usano davvero
   * stavano in cima e tutto il resto era scorrimento — e in cui l'intestazione del
   * gruppo, l'unica cosa che diceva *di chi* fosse un modello, spariva appena si
   * scorreva di un dito.
   *
   * Lo stile è quello delle altre tendine della barra (modalità, MCP): `.mi` con
   * l'etichetta e la sua `.sub`, `.tag` a destra. Non è uniformità per il gusto: quelle
   * righe sono già la grammatica con cui si legge quella barra, e una tendina con una
   * grammatica sua costringe a impararne una seconda per fare la stessa cosa.
   *
   * Qui c'è **solo il contenuto**. Il contenitore e la posizione restano di chi lo
   * ospita: l'helper ha la sua `.hpop` ancorata al pannello, la barra di stato ha le
   * tendine che sotto gli 860px si ancorano al blocco in basso invece che al chip.
   */
  import Icon from './Icon.svelte'
  import type { AgentModels } from '../lib/api'

  type Props = {
    catalogo: AgentModels[] | null
    /** Il modello in uso. Può essere l'id di una voce (`default`) o il risolto
     *  (`claude-opus-5[1m]`): si confrontano entrambi, vedi `idScelto`. */
    corrente: string
    /** L'agent di questa conversazione, per marcarlo. */
    agenteCorrente?: string
    /** Cosa scrivere accanto a una voce di un altro agent. `null` per niente. */
    nota?: (agentId: string) => string | null
    onScegli: (agent: string, model: string) => void
  }
  const { catalogo, corrente, agenteCorrente, nota, onScegli }: Props = $props()

  /** Quale agent si sta guardando dentro. `null` = si è al primo livello. */
  let dentro = $state<string | null>(null)
  let cerca = $state('')

  /**
   * Quale **voce** è quella in uso.
   *
   * Il confronto diretto non basta e nemmeno il ripiego su `resolved`: più voci possono
   * risolvere allo stesso modello — `Default (recommended)` e `Opus (1M context)` sono
   * lo stesso modello con due nomi — e segnarle entrambe non dice più quale hai scelto.
   * Visto guardando il menu: due spunte.
   *
   * L'ordine giusto è quindi: **prima** un id esatto (l'utente ha scelto quella voce), e
   * solo se nessuna corrisponde si ripiega sul risolto, prendendo la prima — che è
   * `default`, ed è la voce vera quando nessuno ha scelto niente.
   */
  const idScelto = $derived.by(() => {
    const tutti = (catalogo ?? []).flatMap(a => a.models)
    if (tutti.some(m => m.id === corrente)) return corrente
    return tutti.find(m => m.resolved === corrente)?.id ?? corrente
  })
  const scelto = (m: { id: string }): boolean => m.id === idScelto

  /**
   * La ricerca attraversa **tutti** gli agent, anche quando si sta dentro a uno.
   *
   * Sembrava più coerente filtrare solo il gruppo aperto, e non lo è: chi scrive
   * «sonnet» non sta restringendo un elenco, sta cercando un modello — e sapere in
   * quale gruppo si trovi è esattamente ciò che non sa. Per questo ogni risultato porta
   * scritto l'agent a cui appartiene: senza, due modelli omonimi di due agent diversi
   * sarebbero due righe identiche.
   */
  const risultati = $derived.by(() => {
    const t = cerca.trim().toLowerCase()
    if (!t) return null
    const out: { a: AgentModels; m: AgentModels['models'][number] }[] = []
    for (const a of catalogo ?? []) {
      for (const m of a.models) {
        const testo = `${m.label ?? ''} ${m.id} ${m.resolved ?? ''}`.toLowerCase()
        if (testo.includes(t)) out.push({ a, m })
      }
    }
    return out
  })

  const gruppo = $derived((catalogo ?? []).find(a => a.id === dentro) ?? null)

  /** L'id sotto il nome, ma solo quando aggiunge qualcosa: per `Fable` l'etichetta e
   *  l'id coincidono, e ripeterlo sarebbe rumore su ogni riga. */
  const sotto = (m: { id: string; label?: string }): string =>
    (m.label && m.label !== m.id) ? m.id : ''
</script>

<div class="mpick">
{#if catalogo === null}
  <div class="mi dis"><Icon name="i-loader" /><span>Loading models…</span></div>
{:else if risultati}
  {#if risultati.length === 0}
    <div class="mi dis"><span>No model matches “{cerca}”</span></div>
  {/if}
  {#each risultati.slice(0, 60) as r (`${r.a.id}/${r.m.id}`)}
    <button class="mi" class:on={scelto(r.m)}
      title={r.m.note ?? r.m.id}
      onclick={() => onScegli(r.a.id, r.m.id)}>
      <span class="tx"><span class="lb">{r.m.label ?? r.m.id}</span><span class="sub">{r.a.label}</span></span>
      {#if r.m.note}<Icon name="i-warn" style="color:var(--wait)" />{/if}
      {#if nota?.(r.a.id)}<span class="tag">{nota(r.a.id)}</span>{/if}
      {#if scelto(r.m)}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
    </button>
  {/each}
  <!-- Un tetto, e detto: una ricerca che ne mostra 60 su 151 senza dirlo fa credere
       che gli altri non esistano — lo stesso difetto del limite silenzioso a cinque
       risultati corretto nella ricerca fra le chat. -->
  {#if risultati.length > 60}
    <div class="mi dis"><span>{risultati.length - 60} more — keep typing to narrow</span></div>
  {/if}
{:else if gruppo}
  <button class="mi" onclick={() => { dentro = null }}>
    <Icon name="i-back" /><span class="tx"><span class="lb">{gruppo.label}</span><span class="sub">{gruppo.models.length} models</span></span>
  </button>
  <!-- L'avviso dell'agent, una volta sola sul gruppo. Su ognuno dei 151 modelli
       sarebbe lo sfondo invece di un avviso — difetto già corretto una volta. -->
  {#if gruppo.note}
    <div class="mi dis"><Icon name="i-warn" style="color:var(--wait)" /><span>{gruppo.note}</span></div>
  {/if}
  {#each gruppo.models as m (m.id)}
    <button class="mi" class:on={scelto(m)}
      title={m.note ?? m.id}
      onclick={() => onScegli(gruppo.id, m.id)}>
      <span class="tx"><span class="lb">{m.label ?? m.id}</span><span class="sub">{sotto(m)}</span></span>
      {#if m.note}<Icon name="i-warn" style="color:var(--wait)" />{/if}
      {#if nota?.(gruppo.id)}<span class="tag">{nota(gruppo.id)}</span>{/if}
      {#if scelto(m)}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
    </button>
  {/each}
{:else}
  {#each catalogo as a (a.id)}
    <button class="mi" class:dis={!a.available} disabled={!a.available}
      title={a.reason ?? a.note ?? ''}
      onclick={() => { dentro = a.id }}>
      {#if !a.available}<Icon name="i-block" />{/if}
      <span class="tx"><span class="lb">{a.label}</span><span class="sub"
        >{a.available ? `${a.models.length} models` : (a.reason ?? 'not available')}</span></span>
      {#if a.id === agenteCorrente}<span class="tag">this chat</span>
      {:else if a.available && nota?.(a.id)}<span class="tag">{nota(a.id)}</span>{/if}
      {#if a.available}<Icon name="i-fwd" style="margin-left:auto" />{/if}
    </button>
  {/each}
{/if}

<!-- In fondo, non in cima: la tendina si apre verso l'alto dal chip, quindi il bordo
     basso è il punto fermo — l'unico che non si sposta quando l'elenco cambia lunghezza.
     Una casella in cima ballerebbe sotto il pollice a ogni lettera digitata. -->
<div class="msearch">
  <Icon name="i-search" />
  <input type="search" bind:value={cerca} placeholder="Search models…"
    autocomplete="off" spellcheck="false" />
</div>
</div>
