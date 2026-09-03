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
   * Il vestito è quello del design system del composer (v10): la scheda del modello
   * in testa, una riga di meta con prezzo e finestra, e righe **una sola ciascuna** —
   * agente o provider con il conteggio a destra, modello con finestra e costo
   * allineati in colonna a destra fra livelli diversi.
   *
   * Qui c'è **solo il contenuto**. Il contenitore e la posizione restano di chi lo
   * ospita: il dock del composer lo ospita nel suo box `.picker`, Helper e AgentPanel
   * nelle loro tendine. `onIndietro` serve alla riga «indietro» del primo livello:
   * chi ospita dice a cosa tornare — la Dock al suo menu radice.
   */
  import Icon from './Icon.svelte'
  import {
    getLobeIconUrl, getProviderForModel, getFamilyIconUrl, familyLabel,
    providerLabelFor, inputTypesOf,
  } from '../lib/lobe.ts'
  import { fmtTok, fmtCosto } from '../lib/view.ts'
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
    /** «Indietro» dal primo livello: il menu che ha aperto il picker. La Dock ci
     *  torna al menu radice invece di chiudere tutto (chiesto dall'utente,
     *  1º settembre 2026). Senza, la riga di navigazione al primo livello tace:
     *  non c'è un livello sopra a cui tornare e niente da chiudere. */
    onIndietro?: () => void
    /** Una scelta che non punta a un modello preciso — «lascia decidere l'agent».
     *  Solo Settings la usa (la preferenza globale delle chat nuove può restare
     *  senza valore); una chat viva ha sempre un modello in corso, quindi Dock,
     *  Helper e AgentPanel non passano questa prop e la riga non compare. */
    onClear?: () => void
    clearLabel?: string
  }
  const { catalogo, corrente, agenteCorrente, nota, onScegli, onIndietro, onClear, clearLabel }: Props = $props()

  /** Quale agent si sta guardando dentro. `null` = si è al primo livello. */
  let dentro = $state<string | null>(null)
  /** Provider selezionato dentro Opencode (es. baseten, openai). Livello 2. */
  let provider = $state<string | null>(null)
  /** Famiglia selezionata dentro un provider (es. claude, openai). Livello 3. */
  let famiglia = $state<string | null>(null)
  // Cambiando agent, azzera provider e famiglia; cambiando provider, azzera famiglia
  $effect(() => { void dentro; if (dentro !== 'opencode') { provider = null; famiglia = null } })
  $effect(() => { void provider; famiglia = null })
  let cerca = $state('')

  /** Toglie tutto ciò che non è lettera o cifra, minuscolo: la ricerca confronta
   *  solo quello, quindi "-" e "/" digitati o no non fanno differenza. */
  const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

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
   * L'agent e il modello in uso, per la scheda in testa alla tendina.
   *
   * La ricerca e' la stessa di `idScelto` ma restituisce le due cose invece dell'id
   * solo, perche' la scheda deve dire anche *chi* offre il modello. Prima si guarda
   * nell'agent di questa chat: due agent possono esporre lo stesso modello con lo
   * stesso id, e quello della chat corrente ha la ragione sul gemello.
   */
  const livello0 = $derived.by(() => {
    if (!catalogo) return null
    const nel = (a: AgentModels) => a.models.find(x => x.id === corrente || x.resolved === corrente)
    const mio = catalogo.find(a => a.id === agenteCorrente)
    const ordine = mio ? [mio, ...catalogo.filter(a => a !== mio)] : catalogo
    for (const a of ordine) {
      const m = nel(a)
      if (m) return { agent: a, model: m }
    }
    return null
  })

  /** Il nome e il suffisso fra parentesi, separati: «Default (recommended)» diventa
   *  nome «Default» e suffisso «recommended», che nel DS sta in mono spento accanto.
   *  Un'etichetta senza parentesi è solo nome. */
  const nomeESuffisso = (m: { id: string; label?: string }): { nome: string; suffix?: string } => {
    const label = m.label ?? m.id
    const mm = /^(.*?)\s*\((.+)\)\s*$/.exec(label)
    return mm ? { nome: mm[1]!, suffix: mm[2]! } : { nome: label }
  }

  /** Il costo del modello in essere come bandiera, per la riga meta di testa. */
  const costoFree = $derived.by(() => {
    const c = livello0?.model?.cost
    return !!c && c.input === 0 && c.output === 0
  })

  /** Helper per template: determine if a given model for an agent is free. */
  const isFreeModelFor = (agent: AgentModels, model: AgentModels['models'][number]) => {
    if (agent.id !== 'opencode') return false
    const anyM = model as any
    if (anyM.free === true || anyM.price === 0) return true
    // Da quando l'adapter porta il costo, un modello con input e output a zero è free.
    if (model.cost && model.cost.input === 0 && model.cost.output === 0) return true
    return false
  }

  /** Se un gruppo di modelli (provider o famiglia) contiene almeno un modello free. */
  const hasFree = (models: AgentModels['models']): boolean =>
    models.some(m => {
      const anyM = m as any
      return anyM.free === true || anyM.price === 0
        || (m.cost && m.cost.input === 0 && m.cost.output === 0)
    })

  const gruppo = $derived((catalogo ?? []).find(a => a.id === dentro) ?? null)

  // Dentro Opencode i modelli vanno in ordine alfabetico per nome (richiesta utente)
  const modelliOrdinati = $derived.by(() => {
    if (!gruppo) return [] as NonNullable<typeof gruppo>['models']
    if (gruppo.id !== 'opencode') return gruppo.models
    return [...gruppo.models].sort((a, b) => {
      const al = (a.label ?? a.id).toLowerCase()
      const bl = (b.label ?? b.id).toLowerCase()
      return al.localeCompare(bl)
    })
  })

  /** Normalizza una famiglia granulare (es. "kimi-k2", "deepseek-flash") alla sua
   *  radice ("kimi", "deepseek") così che modelli imparentati finiscano nello stesso
   *  gruppo. OpenCode dichiara famiglie per versione, e senza questo accorpamento
   *  Kimi K2 e Kimi K3 apparirebbero come due famiglie separate. */
  const rootFamily = (fam: string): string => {
    const f = fam.toLowerCase()
    // Sinonimi: stessa famiglia con nomi diversi a seconda della fonte.
    if (f.startsWith('zhipu') || f.startsWith('glm')) return 'glm'
    if (f.startsWith('kimi') || f.startsWith('moonshot')) return 'kimi'
    // Generico: la parte alfabetica iniziale, prima di numeri e trattini.
    const m = f.match(/^[a-z]+/)
    return m ? m[0] : fam
  }

  // Il provider di un modello OpenCode è il primo segmento del suo id
  // (es. "baseten/zai-org/GLM-5.2-Fast" → "baseten"). L'adapter lo costruisce
  // così: `${p.id}/${mid}` in `elencoModelli`.
  const providerOf = (modelId: string): string => {
    const i = modelId.indexOf('/')
    return i > 0 ? modelId.slice(0, i) : 'other'
  }

  // Provider attivi per Opencode: quali sono collegati su questa macchina.
  // Derivati dai modelli stessi — se un provider ha modelli nel catalogo, è attivo.
  const providers = $derived.by(() => {
    if (!gruppo || gruppo.id !== 'opencode') return [] as { id: string; label: string; icon: string | null; models: AgentModels['models']; corrente: boolean }[]
    const map = new Map<string, typeof gruppo.models>()
    for (const m of gruppo.models) {
      const prov = providerOf(m.id)
      const list = map.get(prov)
      if (list) list.push(m)
      else map.set(prov, [m])
    }
    const entries = [...map.entries()].map(([id, models]) => ({
      id,
      // Il nome vero del provider ("OpenCode Zen") se l'adapter lo ha passato,
      // altrimenti si ripiega sull'id capitalizzato.
      label: models[0]?.providerName ?? familyLabel(id),
      icon: getLobeIconUrl(id) ?? getFamilyIconUrl('other'),
      models,
      // Il provider che contiene il modello in uso porta il puntino verde: è il
      // «ti trovi qui» del secondo livello, dove la voce selezionata non c'è.
      corrente: models.some(m => scelto(m)),
    }))
    entries.sort((a, b) => a.label.localeCompare(b.label))
    return entries
  })

  const providerSelezionato = $derived(providers.find(p => p.id === provider) ?? null)

  // Famiglie di modelli dentro il provider selezionato (es. claude, gpt, glm).
  // Stessa logica che prima era al livello 2, ora al livello 3.
  const famiglie = $derived.by(() => {
    if (!providerSelezionato) return [] as { id: string; label: string; icon: string | null; models: AgentModels['models']; corrente: boolean }[]
    const map = new Map<string, typeof providerSelezionato.models>()
    for (const m of providerSelezionato.models) {
      // La famiglia dichiarata dal modello se c'è, normalizzata alla radice
      // (kimi-k2 + kimi-k3 → kimi), altrimenti dedotta dal nome.
      const fam = rootFamily(m.family ?? getProviderForModel((m as any).resolved ?? m.id) ?? 'other')
      const list = map.get(fam)
      if (list) list.push(m)
      else map.set(fam, [m])
    }
    const entries = [...map.entries()].map(([id, models]) => ({
      id,
      label: familyLabel(id),
      icon: getFamilyIconUrl(id),
      models: [...models].sort((a, b) => (a.label ?? a.id).toLowerCase().localeCompare((b.label ?? b.id).toLowerCase())),
      corrente: models.some(m => scelto(m)),
    }))
    entries.sort((a, b) => a.label.localeCompare(b.label))
    return entries
  })

  const famigliaSelezionata = $derived(famiglie.find(f => f.id === famiglia) ?? null)

  /**
   * La ricerca attraversa **tutti** gli agent, anche quando si sta dentro a uno.
   *
   * Sembrava più coerente filtrare solo il gruppo aperto, e non lo è: chi scrive
   * «sonnet» non sta restringendo un elenco, sta cercando un modello — e sapere in
   * quale gruppo si trovi è esattamente ciò che non sa. Per questo ogni risultato porta
   * scritto il percorso (agent › provider) allineato a destra: senza, due modelli
   * omonimi di due gruppi diversi sarebbero due righe identiche.
   */
  const risultati = $derived.by(() => {
    const t = cerca.trim().toLowerCase()
    if (!t) return null
    // Senza lettere/cifre: "-", "/", spazi non contano. Chi cerca "gpt5" trova
    // "gpt-5" e chi cerca "gpt-5" trova "gpt 5" — il trattino non è un carattere
    // che uno ricorda di dover digitare uguale a come compare nel nome.
    const nt = norm(t)
    const out: { a: AgentModels; m: AgentModels['models'][number]; free?: boolean }[] = []
    for (const a of catalogo ?? []) {
      for (const m of a.models) {
        const testo = norm(`${m.label ?? ''} ${m.id} ${m.resolved ?? ''}`)
        if (testo.includes(nt)) {
          const anyM = m as any
          // Detect "free" OpenCode models via a best-effort heuristic:
          // - explicit free flag on the model (if provided by the backend)
          // - or price == 0 (common convention for free tiers)
          const isFree = a.id === 'opencode' && (anyM.free === true || anyM.price === 0
            || (m.cost && m.cost.input === 0 && m.cost.output === 0))
          out.push({ a, m, free: isFree })
        }
      }
    }
    // Prefer free models at the top of the list
    out.sort((x, y) => {
      if ((x.free ? 1 : 0) !== (y.free ? 1 : 0)) return (y.free ? 1 : 0) - (x.free ? 1 : 0)
      return 0
    })
    return out
  })

  /** Il totale dei modelli del catalogo: il conteggio che il primo livello mette a
   *  destra della riga di navigazione, accanto al titolo «Models». */
  const totaleModelli = $derived((catalogo ?? []).reduce((n, a) => n + a.models.length, 0))

  /**
   * La riga «indietro» in testa all'elenco, che porta al livello sopra: l'elenco
   * degli agent, quello dei provider o quello delle famiglie, a seconda di dove si è.
   * Al primo livello «indietro» porta al menu che ha aperto il picker, se l'host lo
   * dichiara (`onIndietro` — la Dock: il menu radice); senza, la riga tace. Durante
   * la ricerca il titolo diventa «Results» col conto dei trovati sul totale. Sta nel
   * flusso sopra la lista, così non sparisce con lo scorrimento dell'elenco.
   */
  const back = $derived.by(() => {
    if (risultati) {
      return {
        onClick: () => { cerca = '' },
        title: 'Results',
        count: `${Math.min(risultati.length, 60)} / ${totaleModelli}`,
        indietro: true,
      }
    }
    if (gruppo && gruppo.id === 'opencode' && provider && famigliaSelezionata) {
      return {
        onClick: () => { famiglia = null },
        title: famigliaSelezionata.label,
        count: `${famigliaSelezionata.models.length} models`,
        indietro: true,
      }
    }
    if (gruppo && gruppo.id === 'opencode' && provider) {
      return {
        onClick: () => { provider = null },
        title: providerSelezionato?.label ?? provider,
        count: `${providerSelezionato?.models.length ?? 0} models`,
        indietro: true,
      }
    }
    if (gruppo) {
      return {
        onClick: () => { dentro = null },
        title: gruppo.label,
        count: `${gruppo.models.length} models${gruppo.id !== agenteCorrente && nota?.(gruppo.id) ? ` · ${nota(gruppo.id)}` : ''}`,
        indietro: true,
      }
    }
    // Primo livello: il bottone a sinistra torna al menu precedente — quello che ha
    // aperto il picker — quando l'host lo dichiara; altrimenti la riga non c'è.
    return onIndietro
      ? {
          onClick: () => onIndietro(),
          title: 'Models',
          count: `${totaleModelli}`,
          indietro: true,
        }
      : null
  })

  /** Le tre icone di capacità del modello in testa (testo, immagini, documenti):
   *  quelle che il DS mostra accanto al nome. Spente quando il modello non le accetta. */
  const caps = $derived(inputTypesOf(livello0?.model as { accepts?: string[] } | undefined))
</script>

<div class="mpick">
  {#if livello0}
    {@const head = nomeESuffisso(livello0.model)}
    {@const ic0 = getLobeIconUrl((livello0.model as any).resolved ?? livello0.model.id)}
    <div class="pk-head">
      <div class="pk-avatar">
        {#if ic0}<img class="micon" src={ic0} alt="" width="19" height="19" loading="lazy"
          onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
        {:else}<Icon name="i-brain" />{/if}
      </div>
      <div class="pk-id">
        <div class="pk-name">{head.nome}{#if head.suffix} <span class="mult">({head.suffix})</span>{/if}</div>
        <div class="pk-path">{livello0.agent.label}{#if providerLabelFor(livello0.model as any)} <span class="arw">›</span> {providerLabelFor(livello0.model as any)}{/if}</div>
      </div>
      {#if caps}
        <div class="pk-caps" title={`accepts: ${[caps.text ? 'text' : null, caps.image ? 'image' : null, caps.docs ? 'documents' : null].filter(Boolean).join(', ')}`}>
          <Icon name="i-type" class={caps.text ? '' : 'off'} />
          <Icon name="i-image" class={caps.image ? '' : 'off'} />
          <Icon name="i-doc" class={caps.docs ? '' : 'off'} />
        </div>
      {/if}
    </div>
    <div class="pk-meta">
      <span class="cash"><Icon name="i-dollar" /></span>
      {#if costoFree}
        <span class="price free">free</span>
      {:else if livello0.model.cost}
        <span class="unit">/M</span>
        <span class="price">{fmtCosto(livello0.model.cost.input)} / {fmtCosto(livello0.model.cost.output)}</span>
      {:else}
        <span class="price">—</span>
      {/if}
      <span class="ctx-lbl">CONTEXT</span>
      <span class="ctx-val">{fmtTok(livello0.model.contextWindow)}</span>
    </div>
    <div class="pk-rule"></div>
  {/if}

  <!-- La riga di navigazione compare solo dove c'è un gesto da fare: ai livelli
       interni porta indietro, al primo livello torna al menu che ha aperto il
       picker (se l'host lo dichiara — Helper e AgentPanel non passano
       `onIndietro`, e lì la riga tace). -->
  {#if back}
    <button class="pk-nav" onclick={back.onClick}>
      {#if back.indietro}<span class="back"><Icon name="i-back" /></span>{/if}
      <span class="nv-title">{back.title}</span>
      <span class="nv-count">{back.count}</span>
    </button>
  {/if}

  <div class="pk-list">
    {#if catalogo === null}
      <div class="pk-empty"><Icon name="i-loader" /><span>Loading models…</span></div>
    {:else if risultati}
      {#if risultati.length === 0}
        <div class="pk-empty"><span>No model matches “{cerca}”</span></div>
      {/if}
      {#each risultati.slice(0, 60) as r (`${r.a.id}/${r.m.id}`)}
        {@const rIcon = getLobeIconUrl((r.m as any).resolved ?? r.m.id)}
        {@const hs = nomeESuffisso(r.m)}
        <button class="pk-mrow" class:on={scelto(r.m)}
          title={r.m.note ?? r.m.id}
          onclick={() => onScegli(r.a.id, r.m.id)}>
          <span class="pk-ico">
            {#if rIcon}<img src={rIcon} alt="" width="16" height="16" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
            {:else}<Icon name="i-brain" />{/if}
          </span>
          <span class="mhead">
            <span class="mname">{hs.nome}</span>
            {#if hs.suffix}<span class="msuffix">{hs.suffix}</span>{/if}
            {#if r.free}<span class="free-pill">FREE</span>{/if}
          </span>
          <span class="mright">
            <span class="mpath">{r.a.label}{#if r.a.id === 'opencode' && providerOf(r.m.id) !== 'other'} › {r.m.providerName ?? familyLabel(providerOf(r.m.id))}{/if}</span>
            <span class="mstate">
              {#if scelto(r.m)}<span class="pk-check"><Icon name="i-check" /></span>
              {:else if r.m.note}<span class="warn-ico" title={r.m.note}><Icon name="i-warn" /></span>{/if}
            </span>
          </span>
        </button>
      {/each}
      <!-- Un tetto, e detto: una ricerca che ne mostra 60 su 151 senza dirlo fa credere
           che gli altri non esistano — lo stesso difetto del limite silenzioso a cinque
           risultati corretto nella ricerca fra le chat. -->
      {#if risultati.length > 60}
        <div class="pk-empty"><span>{risultati.length - 60} more — keep typing to narrow</span></div>
      {/if}
    {:else if gruppo}
      {#if gruppo.id === 'opencode' && !provider}
        {#if gruppo.note}
          <div class="pk-empty warn"><Icon name="i-warn" /><span>{gruppo.note}</span></div>
        {/if}
        {#each providers as p (p.id)}
          <button class="pk-row" onclick={() => { provider = p.id }}>
            <span class="pk-ico">
              {#if p.icon}<img src={p.icon} alt="" width="17" height="17" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<Icon name="i-brain" />{/if}
            </span>
            <span class="pk-name-1">{p.label}</span>
            <span class="pk-right">
              {#if p.corrente}<span class="dot"></span>{/if}
              {#if hasFree(p.models)}<span class="free-pill">FREE</span>{/if}
              <span class="pk-count">{p.models.length} models</span>
              <span class="chev"><Icon name="i-fwd" /></span>
            </span>
          </button>
        {/each}
      {:else if gruppo.id === 'opencode' && provider && !famigliaSelezionata}
        {#each famiglie as f (f.id)}
          <button class="pk-row" onclick={() => { famiglia = f.id }}>
            <span class="pk-ico">
              {#if f.icon}<img src={f.icon} alt="" width="17" height="17" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<Icon name="i-brain" />{/if}
            </span>
            <span class="pk-name-1">{f.label}</span>
            <span class="pk-right">
              {#if f.corrente}<span class="dot"></span>{/if}
              {#if hasFree(f.models)}<span class="free-pill">FREE</span>{/if}
              <span class="pk-count">{f.models.length} models</span>
              <span class="chev"><Icon name="i-fwd" /></span>
            </span>
          </button>
        {/each}
      {:else if gruppo.id === 'opencode' && provider && famigliaSelezionata}
        {#each famigliaSelezionata.models as m (m.id)}
          {@const gIcon = getLobeIconUrl((m as any).resolved ?? m.id)}
          {@const hs = nomeESuffisso(m)}
          {@const capsM = inputTypesOf(m as { accepts?: string[] } | undefined)}
          <button class="pk-mrow" class:on={scelto(m)}
            title={m.note ?? m.id}
            onclick={() => onScegli(gruppo.id, m.id)}>
            <span class="pk-ico">
              {#if gIcon}<img src={gIcon} alt="" width="16" height="16" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<Icon name="i-brain" />{/if}
            </span>
            <span class="mhead">
              <span class="mname">{hs.nome}</span>
              {#if hs.suffix}<span class="msuffix">{hs.suffix}</span>{/if}
              {#if isFreeModelFor(gruppo, m)}<span class="free-pill">FREE</span>{/if}
              {#if capsM}
                <span class="mcaps">
                  <Icon name="i-type" class={capsM.text ? '' : 'off'} />
                  <Icon name="i-image" class={capsM.image ? '' : 'off'} />
                </span>
              {/if}
            </span>
            <span class="mright">
              <span class="mctx">{fmtTok(m.contextWindow)}</span>
              <span class="mprice">{m.cost ? `${fmtCosto(m.cost.input)}/${fmtCosto(m.cost.output)}` : '—'}</span>
              <span class="mstate">
                {#if m.note}<span class="warn-ico" title={m.note}><Icon name="i-warn" /></span>
                {:else if scelto(m)}<span class="pk-check"><Icon name="i-check" /></span>{/if}
              </span>
            </span>
          </button>
        {/each}
      {:else}
        {#if gruppo.note}
          <div class="pk-empty warn"><Icon name="i-warn" /><span>{gruppo.note}</span></div>
        {/if}
        {#each modelliOrdinati as m (m.id)}
          {@const gIcon = getLobeIconUrl((m as any).resolved ?? m.id)}
          {@const hs = nomeESuffisso(m)}
          {@const capsM = inputTypesOf(m as { accepts?: string[] } | undefined)}
          <button class="pk-mrow" class:on={scelto(m)}
            title={m.note ?? m.id}
            onclick={() => onScegli(gruppo.id, m.id)}>
            <span class="pk-ico">
              {#if gIcon}<img src={gIcon} alt="" width="16" height="16" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
              {:else}<Icon name="i-brain" />{/if}
            </span>
            <span class="mhead">
              <span class="mname">{hs.nome}</span>
              {#if hs.suffix}<span class="msuffix">{hs.suffix}</span>{/if}
              {#if isFreeModelFor(gruppo, m)}<span class="free-pill">FREE</span>{/if}
              {#if capsM}
                <span class="mcaps">
                  <Icon name="i-type" class={capsM.text ? '' : 'off'} />
                  <Icon name="i-image" class={capsM.image ? '' : 'off'} />
                </span>
              {/if}
            </span>
            <span class="mright">
              <span class="mctx">{fmtTok(m.contextWindow)}</span>
              <span class="mprice">{m.cost ? `${fmtCosto(m.cost.input)}/${fmtCosto(m.cost.output)}` : '—'}</span>
              <span class="mstate">
                {#if m.note}<span class="warn-ico" title={m.note}><Icon name="i-warn" /></span>
                {:else if scelto(m)}<span class="pk-check"><Icon name="i-check" /></span>{/if}
              </span>
            </span>
          </button>
        {/each}
      {/if}
    {:else}
      {#if onClear}
        <button class="pk-row" class:on={!livello0} onclick={() => onClear()}>
          <span class="pk-ico"><Icon name="i-brain" /></span>
          <span class="pk-name-1">{clearLabel ?? 'Default'}</span>
          <span class="pk-right">
            {#if !livello0}<span class="pk-check"><Icon name="i-check" /></span>{/if}
          </span>
        </button>
      {/if}
      {#each catalogo as a (a.id)}
        {@const aIcon = getLobeIconUrl(a.id)}
        <button class="pk-row" class:dis={!a.available} disabled={!a.available}
          title={a.reason ?? a.note ?? ''}
          onclick={() => { dentro = a.id }}>
          <span class="pk-ico">
            {#if aIcon}<img src={aIcon} alt="" width="17" height="17" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
            {:else if !a.available}<Icon name="i-block" />
            {:else}<Icon name="i-brain" />{/if}
          </span>
          <span class="pk-name-1">{a.label}</span>
          <span class="pk-right">
            {#if a.id === agenteCorrente}<span class="tag">this chat</span>
            {:else if a.available && nota?.(a.id)}<span class="tag mute">{nota(a.id)}</span>{/if}
            <span class="pk-count">{a.available ? `${a.models.length} models` : ''}</span>
            {#if a.available}<span class="chev"><Icon name="i-fwd" /></span>{/if}
          </span>
        </button>
      {/each}
    {/if}
  </div>

  <!-- In fondo, non in cima: la tendina si apre verso l'alto dal chip, quindi il bordo
       basso è il punto fermo — l'unico che non si sposta quando l'elenco cambia lunghezza.
       Una casella in cima ballerebbe sotto il pollice a ogni lettera digitata. -->
  <div class="pk-search">
    <Icon name="i-search" />
    <input type="search" bind:value={cerca} placeholder="Search models…"
      autocomplete="off" spellcheck="false" />
  </div>
</div>

<style>
  /* Il font d'ambiente non decide: il picker si ospita in contesti con misure diverse
     (la barra di stato era 10px, il body 12px) e il DS lo disegna a 13px. Fissarlo qui
     vale per tutti gli ospiti. */
  /* La scala è quella del resto dell'app (voci `.mi` a 10.5px, menu a 250px): il DS
     disegnava 13px e il dock l'ha fatto ridurre due volte — la stessa riduzione vale
     qui, o l'apertura del picker sarebbe un salto di scala rispetto alla riga che
     l'ha aperta. La larghezza 440 resta: è ciò che tiene i nomi interi e le colonne
     allineate. */
  .mpick{font-size:12px;display:flex;flex-direction:column;min-height:0}

  /* La testa: il modello in uso, con avatar quadrato, percorso (agent › provider) e le
     tre icone di capacità a destra. Stessa grammatica della scheda (`ModelCard`) nel
     vestito del DS: più grande, su due righe, con i dati in colonne sotto. */
  .pk-head{display:flex;align-items:flex-start;gap:9px;padding:10px 11px 0}
  .pk-avatar{width:32px;height:32px;flex:none;border-radius:9px;background:var(--surface-2);
    border:1px solid var(--line-2);display:flex;align-items:center;justify-content:center;color:var(--ink)}
  .pk-avatar img{filter:var(--icon-f)}
  .pk-id{min-width:0;flex:1}
  .pk-name{font-size:12.5px;font-weight:600;color:var(--ink);line-height:1.3;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-name .mult{font-weight:500;color:var(--muted)}
  .pk-path{display:flex;align-items:center;gap:5px;margin-top:2px;
    font-family:var(--mono);font-size:10px;color:var(--muted);
    white-space:nowrap;overflow:hidden}
  .pk-path .arw{opacity:.6;flex:none}
  .pk-caps{display:flex;gap:6px;color:var(--muted);flex:none;padding-top:2px}
  .pk-caps :global(svg.ic){width:13px;height:13px}
  .pk-caps :global(svg.ic.off){opacity:.32}

  /* Seconda riga: font classico, dollaro neutro, CONTEXT condensed */
  .pk-meta{display:flex;align-items:center;gap:7px;padding:8px 11px 9px;font-family:var(--sans)}
  .pk-meta :global(svg.ic){width:10px;height:10px}
  .pk-meta .cash{color:var(--muted);display:flex}
  .pk-meta .unit{font-family:var(--sans);font-size:9px;color:var(--muted)}
  .pk-meta .price{font-family:var(--sans);font-size:10px;color:var(--ink)}
  .pk-meta .price.free{color:var(--accent)}
  .pk-meta .ctx-lbl{margin-left:10px;font-size:8px;font-weight:600;letter-spacing:-0.02em;color:var(--muted);font-stretch:condensed}
  .pk-meta .ctx-val{font-family:var(--sans);font-size:10px;color:var(--ink)}
  .pk-rule{height:1px;background:var(--line);flex:none}

  /* La riga di navigazione: indietro + titolo + conteggio, una riga sola. */
  .pk-nav{display:flex;align-items:center;gap:9px;padding:7px 11px;cursor:pointer;
    border:0;background:none;font:inherit;width:100%;text-align:left;color:inherit}
  .pk-nav:hover{background:var(--surface-2)}
  .pk-nav .back{width:20px;height:20px;flex:none;color:var(--muted);
    display:flex;align-items:center;justify-content:center}
  .pk-nav .back :global(svg.ic){width:14px;height:14px}
  .pk-nav .nv-title{font-size:12px;font-weight:600;color:var(--ink)}
  .pk-nav .nv-count{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted)}

  /* 270px e non di più: con testa, meta, nav e ricerca il picker arrivava a ~440px
     di altezza — più di metà schermo solo per scegliere un modello (chiesto
     dall'utente: «troppo lungo»). 220 tiene otto-dieci righe a vista, che è ciò che
     serve a orientarsi; il resto si scorre. */
  .pk-list{max-height:220px;overflow-y:auto;padding:2px 0;min-height:0}
  .pk-empty{display:flex;align-items:center;gap:7px;padding:9px 11px;color:var(--muted);font-size:11.5px}
  .pk-empty.warn :global(svg.ic){color:var(--wait)}

  /* Riga di navigazione: agente o provider — una sola riga, conteggio a destra. */
  .pk-row{display:flex;align-items:center;gap:9px;padding:8px 11px;cursor:pointer;
    border:0;background:none;font:inherit;width:100%;text-align:left;color:inherit}
  .pk-row:hover{background:var(--surface-2)}
  .pk-row.on{background:var(--surface-2)}
  .pk-row.dis{opacity:.5;cursor:default}
  .pk-row.dis:hover{background:none}
  .pk-ico{width:18px;height:18px;flex:none;display:flex;align-items:center;justify-content:center;color:var(--muted)}
  .pk-ico img{border-radius:3px;filter:var(--icon-f)}
  .pk-ico :global(svg.ic){width:14px;height:14px}
  .pk-name-1{font-size:12px;color:var(--ink);flex:1;min-width:0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-count{font-family:var(--mono);font-size:10px;color:var(--muted);flex:none}
  .pk-right{display:flex;align-items:center;gap:7px;flex:none}
  .tag{font-size:10.5px;color:var(--accent)}
  .tag.mute{color:var(--muted)}
  .warn-ico{color:var(--wait);display:flex}
  .warn-ico :global(svg.ic){width:13px;height:13px}
  .pk-right .chev{color:var(--muted);display:flex}
  .pk-right .chev :global(svg.ic){width:13px;height:13px}
  .pk-check{color:var(--accent);display:flex}
  .pk-check :global(svg.ic){width:13px;height:13px}
  .dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--done)}

  /* Riga di modello: una riga — nome + capacità a sinistra, finestra e costo a destra.
     Le colonne numeriche hanno larghezza fissa: sono ciò che resta allineato quando si
     passa da un livello all'altro, e senza quel fermo il confronto fra modelli è
     una lettura riga per riga. */
  .pk-mrow{display:flex;align-items:center;gap:8px;padding:8px 11px;cursor:pointer;
    border:0;background:none;font:inherit;width:100%;text-align:left;color:inherit}
  .pk-mrow:hover{background:var(--surface-2)}
  .pk-mrow.on{background:var(--surface-2)}
  .mhead{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
  .mname{font-size:12px;color:var(--ink);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .msuffix{font-family:var(--mono);font-size:9.5px;color:var(--muted);flex:none}
  .mcaps{display:flex;gap:4px;flex:none;color:var(--muted)}
  .mcaps :global(svg.ic){width:10px;height:10px}
  .mcaps :global(svg.ic.off){opacity:.26}
  .mright{display:flex;align-items:center;gap:10px;flex:none;
    font-family:var(--mono);font-size:10.5px;font-variant-numeric:tabular-nums}
  .mctx{width:32px;text-align:right;color:var(--muted)}
  .mprice{width:58px;text-align:right;color:var(--muted)}
  .mpath{max-width:170px;text-align:right;color:var(--muted);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mstate{width:13px;height:13px;flex:none;display:flex;align-items:center;justify-content:center}

  .free-pill {
    background: var(--accent);
    color: var(--on-accent);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 999px;
    flex: none;
  }

  /* La casella attaccata al bordo del contenitore: i tre popup che ospitano il picker
     (`hpop`, menu del dock, `ap-pop`) hanno tutti padding:4px, quindi il margine
     negativo lo azzera a destra, a sinistra e in basso — resta solo il bordo della
     tendina a fare da cornice, senza fascia di colore fra la casella e il container.
     Gli angoli bassi seguono il raggio del contenitore che la ospita. */
  .pk-search{display:flex;align-items:center;gap:8px;padding:9px 11px;border-top:1px solid var(--line);
    color:var(--muted);margin:2px -4px -4px;border-radius:0 0 8px 8px}
  .pk-search :global(svg.ic){width:13px;height:13px;flex:none}
  .pk-search input{flex:1;background:transparent;border:none;outline:none;color:var(--ink);
    font-family:inherit;font-size:12px;min-width:0}
  .pk-search input::placeholder{color:var(--muted)}
</style>
