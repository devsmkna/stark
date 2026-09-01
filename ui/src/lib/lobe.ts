// Helper per @lobehub/icons — usa CDN static SVG (Svelte, non React).
// Mappa un model id/provider -> icon id per lobe-icons e genera URL CDN.
// Evita di installare React in Svelte: usa direttamente lo static-svg via unpkg.

const KNOWN = new Set([
  'ai21','ai302','ai360','aihhubmix','aimass','aistudio','akashchat','alephalpha','alibaba','alibabacloud',
  'antgroup','anthropic','anyscale','apple','atlascloud','aws','azure','azureai','baichuan','baidu','baiducloud',
  'bailian','baseten','bedrock','bfl','bilibili','burncloud','bytedance','centml','cerebras','civitai','claude',
  'cloudflare','cohere','cometapi','comfyui','copilot','crusoe','deepinfra','deepmind','deepseek','doubao','exa',
  'fal','featherless','fireworks','fireworksai','friendli','gemini','giteeai','github','githubcopilot','google',
  'googlecloud','groq','higress','huawei','huaweicloud','huggingface','hunyuan','hyperbolic','ibm','iflytekcloud',
  'inference','infermatic','infiniai','infinigence','internlm','jina','kluster','lg','lambda','leptonai','lmstudio',
  'lobehub','longcat','menlo','meta','microsoft','minimax','mistral','modelscope','moonshot','nplcloud','nebius',
  'newapi','nousresearch','novita','nvidia','ollama','ollamacloud','opencode','openai','openrouter','ppio','parasail','perplexity',
  'player2','qiniu','qwen','replicate','sambanova','search1api','searchapi','sensenova','siliconcloud','snowflake',
  'sophnet','spark','stability','statecloud','stepfun','straico','streamlake','submodel','tii','taichu','targon',
  'tencent','tencentcloud','togetherai','upstage','v0','vllm','vercel','vercelaigateway','vertexai','volcengine',
  'wenxin','workersai','xai','xiaomimimo','xinference','yandex','zenmux','zeroone','zhipu'
])

function mapByKeywords(m: string): string | null {
  // bigpickle/big-pickle e' il modello di default di OpenCode Zen su questa macchina:
  // nato dalla famiglia "big" (che in FAMILY_SYNONYMS gia' mappa su opencode), va
  // con l'icona di opencode, non senza icona.
  if (m === 'bigpickle' || m.includes('big-pickle')) return 'opencode'
  if (m.includes('claude')) return 'claude'
  if (m.includes('anthropic')) return 'anthropic'
  if (m.includes('openai') || m.includes('chatgpt') || m.includes('gpt') || /\bo1\b|\bo3\b/.test(m)) return 'openai'
  if (m.includes('gemini')) return 'gemini'
  if (m.includes('google')) return 'google'
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('llama') || m.includes('meta-')) return 'meta'
  if (m.includes('mistral') || m.includes('mixtral')) return 'mistral'
  if (m.includes('qwen')) return 'qwen'
  if (m.includes('alibaba')) return 'alibabacloud'
  if (m.includes('perplexity')) return 'perplexity'
  if (m.includes('cohere')) return 'cohere'
  if (m.includes('grok')) return 'grok'
  if (m.includes('xai')) return 'xai'
  if (m.includes('deepmind')) return 'deepmind'
  if (m.includes('bedrock')) return 'bedrock'
  if (m.includes('aws')) return 'aws'
  if (m.includes('azure')) return 'azure'
  if (m.includes('vertex')) return 'vertexai'
  if (m.includes('together')) return 'togetherai'
  if (m.includes('fireworks')) return 'fireworks'
  if (m.includes('groq')) return 'groq'
  if (m.includes('ollama')) return 'ollama'
  if (m.includes('huggingface')) return 'huggingface'
  if (m.includes('stability') || m.includes('stable-diffusion')) return 'stability'
  if (m.includes('nvidia') || m.includes('nemotron')) return 'nvidia'
  if (m.includes('replicate')) return 'replicate'
  if (m.includes('openrouter')) return 'openrouter'
  if (m.includes('zhipu') || m.includes('glm-')) return 'zhipu'
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('stepfun') || m.includes('step-')) return 'stepfun'
  if (m.includes('moonshot') || m.includes('kimi')) return 'kimi'
  if (m.includes('doubao') || m.includes('bytedance')) return 'bytedance'
  if (m.includes('tencent')) return 'tencentcloud'
  if (m.includes('baidu') || m.includes('wenxin')) return 'baidu'
  if (m.includes('huawei')) return 'huawei'
  if (m.includes('spark') || m.includes('iflytek')) return 'spark'
  if (m.includes('yi-') || m.includes('01.ai')) return 'zeroone'
  if (m.includes('internlm')) return 'internlm'
  if (m.includes('yi')) return 'zeroone'
  return null
}

function providerForModel(raw: string): string | null {
  const m = raw.toLowerCase()
  if (m === 'opencode') return 'opencode'
  // Per modelli dentro l'aggregatore opencode (es. "opencode/gpt-4o") usa il provider del modello, non opencode
  if (m.startsWith('opencode/')) {
    const rest = m.slice('opencode/'.length)
    const restSlash = rest.split('/')[0]!
    if (KNOWN.has(restSlash) && restSlash !== 'opencode') return restSlash
    const viaRest = mapByKeywords(rest)
    if (viaRest) return viaRest
    return null
  }
  const slash = m.split('/')[0]!
  if (KNOWN.has(slash)) return slash
  return mapByKeywords(m)
}

// Genera URL CDN static-svg. Prova variante color, fallback mono gestito via onerror in UI.
export function getLobeIconUrl(model: string, variant: 'mono' | 'color' = 'mono'): string | null {
  const id = providerForModel(model)
  if (!id) return null
  // lobe-icons static-svg usa id lower-case con trattini
  const slug = id.toLowerCase()
  return lobeUrl(slug, variant)
}

function lobeUrl(slug: string, variant: 'mono' | 'color' = 'mono'): string {
  const suffix = variant === 'color' ? '-color' : ''
  return `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${slug}${suffix}.svg`
}

export function getProviderForModel(model: string): string | null {
  return providerForModel(model)
}

// ─── Famiglie di modelli → icone ─────────────────────────────────────────────
//
// `getLobeIconUrl` è fatta per gli id dei modelli (es. "opencode/glm-5"), non per
// le radici di famiglia che produce `rootFamily` (es. "glm", "nemotron", "mimo").
// La maggior parte delle radici ha uno slug omonimo sul CDN lobe-icons, ma alcune no
// perché il nome della famiglia e il nome dell'icona divergono (glm → zhipu, gpt →
// openai, llama → meta), o perché la famiglia è un sotto-prodotto di un'azienda
// con un altro nome (nemotron → nvidia, mimo → xiaomimimo, hy → tencent, muse →
// spark, big → opencode).
//
// Per non dover elencare ogni famiglia a mano — e romperci quando opencode ne
// aggiunge una — la strategia è in due tempi:
//   1. una tabella di **sinonimi** per i casi non ovvi (gpt→openai, glm→zhipu, …);
//   2. un **fuzzy match** sugli slug del CDN: se la famiglia non è in tabella,
//      cerca lo slug più simile per sovrapposizione di caratteri. "longcat" trova
//      "longcat", "nemotron" trova "nvidia" (via tabella), "ling" non trova nulla
//      di buono e resta senza icona — che è meglio di un'icona sbagliata.

/** Sinonimi famiglia → slug icona, per i casi in cui il nome della famiglia e il
 *  nome dell'icona divergono. Manuale ma piccola: il fuzzy match copre il resto. */
const FAMILY_SYNONYMS: Record<string, string> = {
  gpt: 'openai', glm: 'zhipu', zhipu: 'zhipu',
  llama: 'meta', nemotron: 'nvidia',
  mimo: 'xiaomimimo', hy: 'tencent',
  muse: 'spark', big: 'opencode',
  ling: 'inclusionai', longcat: 'longcat',
  other: 'opencode',
}

/** Tutti gli slug di icone disponibili sul CDN lobe-icons (v1.94.0, 321 icone).
 *  Usati dal fuzzy match per trovare l'icona più simile a una famiglia. Se
 *  lobe-icons aggiunge icone basta aggiornare questa lista — o meglio, generarla
 *  a runtime dal tarball npm, ma 321 stringhe a riposo costano meno di una fetch. */
const LOBE_SLUGS = [
  'ace','adobe','adobefirefly','agentvoice','agnesai','agui','ai2','ai21','ai302','ai360','aihubmix','aimass','aionlabs','airjelly','aistudio','akashchat','alephalpha','alibaba','alibabacloud','amp','anspire','antgroup','anthropic','antigravity','anyscale','apertis','apple','arcee','askverdict','assemblyai','atlascloud','automatic','aws','aya','azure','azureai','baai','baichuan','baidu','baiducloud','bailian','baseten','bedrock','bfl','bilibili','bilibiliindex','bing','bocha','brave','briaai','browserless','burncloud','bytedance','capcut','celestoai','centml','cerebras','chatglm','cherrystudio','civitai','claude','claudecode','cline','clipdrop','cloudflare','codebuddy','codeflicker','codegeex','codex','cogvideo','cogview','cohere','colab','cometapi','comfyui','commanda','copilot','copilotkit','coqui','coze','crewai','crusoe','cursor','cybercut','dalle','dbrx','deepai','deepcogito','deepinfra','deepl','deepmind','deepseek','devin','dify','doc2x','docsearch','dolphin','doubao','dreammachine','elevenlabs','elevenx','essentialai','exa','fal','fastgpt','featherless','figma','firecrawl','fireworks','fishaudio','flora','flowith','flux','friendli','gemini','geminicli','gemma','giteeai','github','githubcopilot','glama','glif','glmv','google','googlecloud','goose','gradio','greptile','grok','groq','hailuo','haiper','happyhorse','hedra','hermesagent','higress','huawei','huaweicloud','huggingface','hunyuan','hyperbolic','ibm','ideogram','iflytekcloud','inception','inference','infermatic','infinigence','inflection','internlm','jimeng','jina','junie','kagi','kilocode','kimi','kiro','kling','kluster','kolors','krea','kwaikat','kwaipilot','lambda','langchain','langfuse','langgraph','langsmith','leptonai','lg','lightricks','liquid','livekit','llamaindex','llava','llmapi','lmstudio','lobehub','longcat','lovable','lovart','luma','magic','make','manus','mastra','mcp','mcpso','menlo','meshy','meta','metaai','metagpt','microsoft','midjourney','minimax','mistral','modelscope','monica','moonshot','morph','moxt','myshell','n8n','nanobanana','nebius','newapi','notebooklm','notion','nousresearch','nova','novelai','novita','nplcloud','nvidia','obsidian','ollama','openai','openchat','openclaw','opencode','openhands','openhuman','openrouter','openwebui','palm','parasail','perplexity','phidata','phind','pi','pika','pixverse','player2','poe','pollinations','poolside','ppio','prunaai','pydanticai','qingyan','qiniu','qoder','qwen','railway','recraft','relace','replicate','replit','reve','roocode','rsshub','runway','rwkv','sambanova','search1api','searchapi','searxng','sensenova','siliconcloud','sillytavern','skywork','slock','smithery','snowflake','sophnet','sora','spark','speedai','stability','statecloud','stepfun','straico','streamlake','submodel','suno','sync','targon','tavily','tencent','tencentcloud','tiangong','tii','together','topazlabs','trae','tripo','turix','udio','unstructured','upstage','v0','vectorizerai','venice','vercel','vertexai','vidu','viggle','vllm','volcengine','voyage','wenxin','windsurf','workersai','worldrouter','xai','xiaomimimo','xinference','xpay','xuanyuan','yandex','yi','youmind','yuanbao','zai','zapier','zeabur','zencoder','zenmux','zeroone','zhipu',
]

/** Quanto la famiglia e lo slug si assomigliano, come frazione di caratteri condivisi
 *  nella stessa sequenza (LCS normalizzato). Sotto 0.5 non ci si fida: meglio niente
 *  che un'icona a caso. */
function similarity(a: string, b: string): number {
  const la = a.length, lb = b.length
  if (la === 0 || lb === 0) return 0
  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0))
  for (let i = 1; i <= la; i++) {
    const di = dp[i]!
    const dim1 = dp[i - 1]!
    const ai = a[i - 1]!
    for (let j = 1; j <= lb; j++) {
      di[j] = ai === b[j - 1]
        ? (dim1[j - 1] ?? 0) + 1
        : Math.max(dim1[j] ?? 0, di[j - 1] ?? 0)
    }
  }
  return (dp[la]![lb] ?? 0) / Math.max(la, lb)
}

/** L'icona per una radice di famiglia (es. "glm", "nemotron", "mimo"), non per un
 *  model id. Cerca prima nei sinonimi manuali, poi nel fuzzy match sugli slug del
 *  CDN, e se nessuno supera 0.5 di similarità resta senza icona — meglio niente
 *  che un'icona sbagliata. */
export function getFamilyIconUrl(family: string): string | null {
  const f = family.toLowerCase()
  // 1. Sinonimi espliciti
  const syn = FAMILY_SYNONYMS[f]
  if (syn) return lobeUrl(syn)
  // 2. Slug omonimo diretto
  if (LOBE_SLUGS.includes(f)) return lobeUrl(f)
  // 3. Fuzzy match: lo slug più simile, se supera la soglia
  let best = '', bestScore = 0
  for (const slug of LOBE_SLUGS) {
    // Containment: se la famiglia è una sottostringa dello slug (o viceversa),
    // è un segnale forte — "mimo" dentro "xiaomimimo".
    if (slug.includes(f) || f.includes(slug)) {
      const score = Math.min(f.length, slug.length) / Math.max(f.length, slug.length)
      if (score > bestScore) { best = slug; bestScore = score }
    }
    const s = similarity(f, slug)
    if (s > bestScore) { best = slug; bestScore = s }
  }
  if (bestScore >= 0.5) return lobeUrl(best)
  return null
}

/** L'etichetta leggibile di una famiglia/provider ("OpenAI", "Hugging Face"), con la
 *  mappa dei nomi che si scrivono in modo diverso dal loro id. Stavano nel picker dei
 *  modelli e servivano anche alla scheda del modello: due copie dello stesso elenco
 *  divergono alla prima correzione, quindi stanno qui, dove sta tutto il resto che
 *  traduce un id di provider in una cosa che si mostra. */
export function familyLabel(id: string): string {
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

/** Il provider da dire sotto il nome di un modello: il nome vero che l'agent dichiara
 *  ("OpenCode Zen") se c'è, altrimenti quello dedotto dall'id ("baseten") con la sua
 *  etichetta leggibile, altrimenti niente. Manca sul modello che non lo dichiara
 *  (Claude Code ha un solo venditore, e non lo ripete). */
export function providerLabelFor(model: { providerName?: string; id: string; resolved?: string }): string {
  if (model.providerName) return model.providerName
  const prov = getProviderForModel(model.resolved ?? model.id)
  return prov ? familyLabel(prov) : ''
}

/** Quali tipologie di input il modello accetta — text / image / video / audio /
 *  documents. `accepts` è l'elenco MIME del modello: vuoto = niente (solo testo),
 *  assente = il ripiego immagini di `core/allegati.ts`. `text` è quasi sempre vero:
 *  se puoi scrivere al modello, lo accetta. */
export function inputTypesOf(model: { accepts?: string[] } | undefined): {
  text: boolean; image: boolean; video: boolean; audio: boolean; docs: boolean
} | null {
  if (!model) return null
  if (model.accepts !== undefined && model.accepts.length === 0) {
    return { text: true, image: false, video: false, audio: false, docs: false }
  }
  const tipi = model.accepts ?? ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  const has = (pref: string): boolean => tipi.some(t => t.startsWith(pref))
  return {
    text: true,
    image: has('image/'),
    video: has('video/'),
    audio: has('audio/'),
    docs: tipi.includes('application/pdf'),
  }
}
