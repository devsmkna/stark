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
  import { getLobeIconUrl, getProviderForModel, getFamilyIconUrl } from '../lib/lobe.ts'
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
  /** Provider selezionato dentro Opencode (es. baseten, openai). Livello 2. */
  let provider = $state<string | null>(null)
  /** Famiglia selezionata dentro un provider (es. claude, openai). Livello 3. */
  let famiglia = $state<string | null>(null)
  // Cambiando agent, azzera provider e famiglia; cambiando provider, azzera famiglia
  $effect(() => { void dentro; if (dentro !== 'opencode') { provider = null; famiglia = null } })
  $effect(() => { void provider; famiglia = null })
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

  /** Un numero di token leggibile: 200000 → "200k", 1000000 → "1M". Stessa scala
   *  della barra di stato, cosi' la scheda e il pannellino si leggono allo stesso modo. */
  const fmtTok = (n: number | undefined): string => {
    if (!n) return '—'
    if (n >= 1_000_000) {
      const m = n / 1_000_000
      return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
    }
    if (n >= 1000) return `${Math.round(n / 1000)}k`
    return String(n)
  }

  /** Un costo per milione di token: 15 → "15", 1.2 → "1.20", un prezzo minuscolo
   *  non si arrotonda a zero e si lascia coi decimali che servono. Il segno `$` lo
   *  disegna la stat della scheda, non il valore: l'icona e il numero stanno l'una
   *  accanto all'altro, e il simbolo ripetuto sarebbe rumore. */
  const fmtCosto = (n: number): string =>
    `${n < 0.01 ? n.toFixed(4).replace(/0+$/, '') : Number.isInteger(n) ? String(n) : n.toFixed(2)}`

  /** Il costo del modello in essere come bandiera: vero quando i due canali sono a
   *  zero (la firma free riconosciuta dappertutto nel picker), falso quando costa o
   *  quando il modello non lo dichiara. La stat distingue i tre casi: `class:free`,
   *  il valore, o un trattino. */
  const costoFree = $derived.by(() => {
    const c = livello0?.model?.cost
    return !!c && c.input === 0 && c.output === 0
  })

  /** Il provider da dire: il nome vero ("OpenCode Zen") se c'e', altrimenti quello
   *  dedotto dall'id del modello ("baseten"), altrimenti niente. Manca sul modello
   *  che non lo dichiara (Claude Code ha un solo venditore, e non lo ripete). */
  const providerMostrato = $derived.by(() => {
    const m = livello0?.model
    if (!m) return ''
    if (m.providerName) return m.providerName
    const prov = getProviderForModel((m as any).resolved ?? m.id)
    return prov ? familyLabel(prov) : ''
  })

  /** Quali tipologie di input il modello accetta — text / image / video / audio / documents.
   *  Sostituisce il vecchio yes/no: `boxes` fa da titolo della riga, le cinque icone
   *  dicono quali. `accepts` è l'elenco MIME del modello (vuoto = niente, assente = ripiego
   *  immagini come in `core/allegati.ts`). */
  const inputTypes = $derived.by(() => {
    const m = livello0?.model as { accepts?: string[] } | undefined
    if (!m) return null
    // `text` è l'input standard del prompt: se puoi scrivere al modello vuol dire che lo
    // accetta, quindi quasi tutti i modelli sono almeno `text`. Non dipende da `accepts`
    // che invece elenca i file allegabili (image/pdf/video/audio).
    if (m.accepts !== undefined && m.accepts.length === 0) {
      return { text: true, image: false, video: false, audio: false, docs: false, none: false }
    }
    const tipi = m.accepts ?? ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    const has = (pref: string): boolean => tipi.some(t => t.startsWith(pref))
    return {
      text: true,
      image: has('image/'),
      video: has('video/'),
      audio: has('audio/'),
      docs: tipi.includes('application/pdf'),
      none: false,
    }
  })

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
    const out: { a: AgentModels; m: AgentModels['models'][number]; free?: boolean }[] = []
    for (const a of catalogo ?? []) {
      for (const m of a.models) {
        const testo = `${m.label ?? ''} ${m.id} ${m.resolved ?? ''}`.toLowerCase()
        if (testo.includes(t)) {
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

  function familyLabel(id: string): string {
    const map: Record<string, string> = {
      openai: 'OpenAI', anthropic: 'Anthropic', claude: 'Claude', gemini: 'Gemini', google: 'Google',
      deepseek: 'DeepSeek', meta: 'Meta', mistral: 'Mistral', qwen: 'Qwen', cohere: 'Cohere',
      perplexity: 'Perplexity', xai: 'xAI', groq: 'Groq', ollama: 'Ollama', deepmind: 'DeepMind',
      openrouter: 'OpenRouter', zhipu: 'Zhipu', glm: 'GLM', minimax: 'MiniMax', moonshot: 'Moonshot',
      kimi: 'Kimi', bytedance: 'ByteDance', tencentcloud: 'Tencent', baidu: 'Baidu', huawei: 'Huawei',
      spark: 'Spark', nvidia: 'Nvidia', nemotron: 'Nemotron', gpt: 'GPT', llama: 'Llama',
      grok: 'Grok', doubao: 'Doubao', huggingface: 'Hugging Face', stability: 'Stability',
      other: 'Other'
    }
    return map[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
  }

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
    if (!gruppo || gruppo.id !== 'opencode') return [] as { id: string; label: string; icon: string | null; models: AgentModels['models'] }[]
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
      models
    }))
    entries.sort((a, b) => a.label.localeCompare(b.label))
    return entries
  })

  const providerSelezionato = $derived(providers.find(p => p.id === provider) ?? null)

  // Famiglie di modelli dentro il provider selezionato (es. claude, gpt, glm).
  // Stessa logica che prima era al livello 2, ora al livello 3.
  const famiglie = $derived.by(() => {
    if (!providerSelezionato) return [] as { id: string; label: string; icon: string | null; models: AgentModels['models'] }[]
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
      models: [...models].sort((a, b) => (a.label ?? a.id).toLowerCase().localeCompare((b.label ?? b.id).toLowerCase()))
    }))
    entries.sort((a, b) => a.label.localeCompare(b.label))
    return entries
  })

  const famigliaSelezionata = $derived(famiglie.find(f => f.id === famiglia) ?? null)

  /** La riga «indietro» in testa alla tendina, che porta al livello sopra: l'elenco
   *  degli agent, quello dei provider o quello delle famiglie, a seconda di dove si è.
   *  Resta nulla al primo livello e durante la ricerca — lì si esce svuotando la
   *  casella. Sta nel contenitore sticky `.mhd` insieme alla scheda del modello, così
   *  non sparisce con lo scorrimento dell'elenco. */
  const back = $derived.by(() => {
    if (dentro === null || !gruppo || risultati) return null
    if (gruppo.id === 'opencode' && provider && famigliaSelezionata) {
      return {
        onClick: () => { famiglia = null },
        lb: famigliaSelezionata.label,
        sub: `${famigliaSelezionata.models.length} models`,
      }
    }
    if (gruppo.id === 'opencode' && provider) {
      return {
        onClick: () => { provider = null },
        lb: providerSelezionato?.label ?? provider,
        sub: `${providerSelezionato?.models.length ?? 0} models`,
      }
    }
    return {
      onClick: () => { dentro = null },
      lb: gruppo.label,
      sub: `${gruppo.models.length} models`,
    }
  })

  /** L'id sotto il nome, ma solo quando aggiunge qualcosa: per `Fable` l'etichetta e
   *  l'id coincidono, e ripeterlo sarebbe rumore su ogni riga. */
  const sotto = (m: { id: string; label?: string }): string =>
    (m.label && m.label !== m.id) ? m.id : ''
</script>

<div class="mpick">
{#if livello0 || back}
  <div class="mhd">
    {#if livello0}
      {@const ic0 = getLobeIconUrl((livello0.model as any).resolved ?? livello0.model.id)}
      <div class="card">
        <div class="avatar">
          {#if ic0}<img class="micon" src={ic0} alt="" width="15" height="15" loading="lazy"
            onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
          {:else}<Icon name="i-brain" />{/if}
        </div>
        <div class="info">
          <div class="title">{livello0.model.label ?? livello0.model.id}</div>
          <div class="provider">{livello0.agent.label}{#if providerMostrato}<span class="sep">·</span>{providerMostrato}{/if}</div>
          <div class="stats">
            <span class="stat" class:free={costoFree}><span class="k">COST</span>
              {#if costoFree}
                <b>free</b>
              {:else if livello0.model.cost}
                <span class="per-m">/M</span><b>{fmtCosto(livello0.model.cost.input)} / {fmtCosto(livello0.model.cost.output)}</b>
              {:else}
                <b>—</b>
              {/if}
            </span>
            <span class="stat" title="context window"><span class="k">CNTX</span><b>{fmtTok(livello0.model.contextWindow)}</b></span>
            {#if inputTypes}
              <span class="stat" title={`accepts: ${[inputTypes.text ? 'text' : null, inputTypes.image ? 'image' : null, inputTypes.video ? 'video' : null, inputTypes.audio ? 'audio' : null, inputTypes.docs ? 'documents' : null].filter(Boolean).join(', ')}`}>
                <span class="k">INPT</span>
                <span class="input-types">
                  {#if inputTypes.text}<Icon name="i-type" class="on" />{/if}
                  {#if inputTypes.image}<Icon name="i-image" class="on" />{/if}
                  {#if inputTypes.video}<Icon name="i-video" class="on" />{/if}
                  {#if inputTypes.audio}<Icon name="i-audio" class="on" />{/if}
                  {#if inputTypes.docs}<Icon name="i-doc" class="on" />{/if}
                </span>
              </span>
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if back}
      <button class="mi back" onclick={() => back.onClick()}>
        <Icon name="i-back" />
        <span class="tx"><span class="lb">{back.lb}</span><span class="sub">{back.sub}</span></span>
      </button>
    {/if}
  </div>
{/if}
{#if catalogo === null}
  <div class="mi dis"><Icon name="i-loader" /><span>Loading models…</span></div>
{:else if risultati}
  {#if risultati.length === 0}
    <div class="mi dis"><span>No model matches “{cerca}”</span></div>
  {/if}
  {#each risultati.slice(0, 60) as r (`${r.a.id}/${r.m.id}`)}
    {@const rIcon = getLobeIconUrl((r.m as any).resolved ?? r.m.id)}
    <button class="mi" class:on={scelto(r.m)}
      title={r.m.note ?? r.m.id}
      onclick={() => onScegli(r.a.id, r.m.id)}>
      {#if rIcon}<img src={rIcon} alt="" width="12" height="12" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />{/if}
      <span class="tx"><span class="lb">{r.m.label ?? r.m.id}</span>
        <span class="sub">{r.a.id === 'opencode' ? (r.m.providerName ?? r.a.label) : r.a.label}</span></span>
      {#if r.free}<span class="free-pill">FREE</span>{/if}
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
  {#if gruppo.id === 'opencode' && !provider}
    {#if gruppo.note}
      <div class="mi dis"><Icon name="i-warn" style="color:var(--wait)" /><span>{gruppo.note}</span></div>
    {/if}
    {#each providers as p (p.id)}
      <button class="mi" onclick={() => { provider = p.id }}>
        {#if p.icon}<img src={p.icon} alt="" width="12" height="12" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />{/if}
        <span class="tx"><span class="lb">{p.label}</span><span class="sub">{p.models.length} models</span></span>
        {#if hasFree(p.models)}<span class="free-pill">FREE</span>{/if}
        <Icon name="i-fwd" style="margin-left:auto" />
      </button>
    {/each}
  {:else if gruppo.id === 'opencode' && provider && !famigliaSelezionata}
    {#each famiglie as f (f.id)}
      <button class="mi" onclick={() => { famiglia = f.id }}>
        {#if f.icon}<img src={f.icon} alt="" width="12" height="12" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />{/if}
        <span class="tx"><span class="lb">{f.label}</span><span class="sub">{f.models.length} models</span></span>
        {#if hasFree(f.models)}<span class="free-pill">FREE</span>{/if}
        <Icon name="i-fwd" style="margin-left:auto" />
      </button>
    {/each}
  {:else if gruppo.id === 'opencode' && provider && famigliaSelezionata}
    {#each famigliaSelezionata.models as m (m.id)}
      {@const gIcon = getLobeIconUrl((m as any).resolved ?? m.id)}
      <button class="mi" class:on={scelto(m)}
        title={m.note ?? m.id}
        onclick={() => onScegli(gruppo.id, m.id)}>
        {#if gIcon}<img src={gIcon} alt="" width="12" height="12" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />{/if}
        <span class="tx"><span class="lb">{m.label ?? m.id}</span>
          <span class="sub">{sotto(m)}</span></span>
        {#if isFreeModelFor(gruppo, m)}<span class="free-pill">FREE</span>{/if}
        {#if m.note}<Icon name="i-warn" style="color:var(--wait)" />{/if}
        {#if nota?.(gruppo.id)}<span class="tag">{nota(gruppo.id)}</span>{/if}
        {#if scelto(m)}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
      </button>
    {/each}
  {:else}
    {#if gruppo.note}
      <div class="mi dis"><Icon name="i-warn" style="color:var(--wait)" /><span>{gruppo.note}</span></div>
    {/if}
    {#each modelliOrdinati as m (m.id)}
      {@const gIcon = getLobeIconUrl((m as any).resolved ?? m.id)}
      <button class="mi" class:on={scelto(m)}
        title={m.note ?? m.id}
        onclick={() => onScegli(gruppo.id, m.id)}>
        {#if gIcon}<img src={gIcon} alt="" width="12" height="12" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />{/if}
        <span class="tx"><span class="lb">{m.label ?? m.id}</span>
          <span class="sub">{sotto(m)}</span></span>
        {#if isFreeModelFor(gruppo, m)}<span class="free-pill">FREE</span>{/if}
        {#if m.note}<Icon name="i-warn" style="color:var(--wait)" />{/if}
        {#if nota?.(gruppo.id)}<span class="tag">{nota(gruppo.id)}</span>{/if}
        {#if scelto(m)}<Icon name="i-check" style="margin-left:auto;color:var(--accent)" />{/if}
      </button>
    {/each}
  {/if}
{:else}
  {#each catalogo as a (a.id)}
    {@const aIcon = getLobeIconUrl(a.id)}
    <button class="mi" class:dis={!a.available} disabled={!a.available}
      title={a.reason ?? a.note ?? ''}
      onclick={() => { dentro = a.id }}>
      {#if aIcon}
        <img src={aIcon} alt="" width="14" height="14" style="flex:none;border-radius:3px;filter:var(--icon-f)" loading="lazy" onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
      {:else if !a.available}<Icon name="i-block" />{/if}
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

<style>
  /* Il contenitore sticky in testa: la scheda del modello e la riga «indietro» insieme,
     così da non servire una misura fissa da tenere sincronizzata — l'elenco dei 151
     modelli scorre sotto di loro, e una riga che se ne va col primo giro di scroll
     sarebbe utile solo nei due secondi in cui apri. Il bordo sotto le separa dall'elenco. */
  .mhd{position:sticky;top:0;z-index:1;background:var(--surface);
    margin:-4px -4px 2px;padding:4px;border-bottom:1px solid var(--line)}
  .mhd .mi.back{padding:5px 8px}
  /* La scheda del modello in uso: un riquadro col bordo e il raggio suoi, sospeso
     nella fascia dello header (il padding di `mhd` gli dà il respiro). L'icona sta
     in un quadrato, così ha un fondo e un bordo coerenti con ciò che la circonda,
     e le statistiche portano un'icona al posto dell'etichetta: l'icona dice *cosa*,
     il `title` dice le parole per intero. */
  .card{display:flex;align-items:flex-start;gap:10px;padding:12px;cursor:pointer}
  .avatar{width:30px;height:30px;border-radius:8px;border:1px solid var(--line-2);
    display:flex;align-items:center;justify-content:center;flex:none}
  .card img.micon{flex:none;filter:var(--icon-f)}
  .avatar svg.ic{flex:none;width:15px;height:15px}
  .info{flex:1;min-width:0}
  .title{font-size:10px;font-weight:700;color:var(--ink);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .provider{font-size:10px;color:var(--muted);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .provider .sep{color:var(--line-2);margin:0 5px}
  .stats{display:flex;gap:12px;margin-top:9px;flex-wrap:wrap}
  .stat{display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--muted)}
  .stat .k{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);opacity:.75;font-stretch:condensed;flex-shrink:0}
  .stat .per-m{font-size:9px;color:var(--muted);flex-shrink:0}
  .stat b{color:var(--ink);font-weight:600;margin-left:1px}
  .stat.free b{color:var(--accent)}
  .input-types{display:inline-flex;align-items:center;gap:3px;margin-left:1px}
  :global(.input-types svg.ic){width:11px;height:11px}
  :global(.input-types svg.ic.on){color:var(--ink);opacity:1}

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
    margin-left: auto;
  }

  /* La casella attaccata al bordo del contenitore: i tre popup che ospitano il picker
     (`hpop`, `menu`, `ap-pop`) hanno tutti padding:4px, quindi il margine negativo lo
     azzera a destra, a sinistra e in basso — resta solo il bordo della tendina a fare
     da cornice, senza fascia di colore fra la casella e il container. Gli angoli bassi
     seguono il raggio del contenitore che la ospita. */
  .msearch{margin:2px -4px -4px;border-radius:0 0 8px 8px}
</style>
</div>
