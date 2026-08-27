// L'adapter OpenCode: l'unico punto del sistema che parla con OpenCode.
// Sopra di lui esistono solo eventi canonici — §1, e ADR-012 paletto n.1.
//
// Parla all'SDK **ufficiale** (`@opencode-ai/sdk/v2`), non a `fetch` a mano: ADR-013.
//
// ─── Cosa prova, questo file ────────────────────────────────────────────────
//
// Il contratto `AgentSession` e' stato scritto stamattina guardando **un solo** agent.
// Questa e' la prima volta che qualcun altro lo implementa, ed e' li' che si scopre se
// era un'astrazione o una descrizione di Claude Code con altri nomi. Le tre cose che
// tirano di piu' stanno scritte dove tirano, non qui in cima.

import { randomUUID } from 'node:crypto'
import type {
  AdapterHooks, AgentSession, PromptImage, SessionSpec,
} from '../../core/adapter.ts'
import type {
  Capabilities, ModelChoice, ModeChoice, Payload, PermissionMode, PromptPart, SlashCommand,
} from '../../core/events.ts'
import { clientPer, lascia } from './host.ts'
import { modelloDa, OpenCodeTranslator, type OpenCodeEvent } from './translate.ts'

type Client = Awaited<ReturnType<typeof clientPer>>

/** Il modello nella forma che OpenCode vuole: `providerID/id`, o solo `id`. */
function refModello(model: string): { providerID: string; id: string } | undefined {
  if (!model || model === 'default') return undefined
  const i = model.indexOf('/')
  return i > 0
    ? { providerID: model.slice(0, i), id: model.slice(i + 1) }
    : { providerID: 'opencode', id: model }
}

/**
 * `PermissionMode` → l'agent di OpenCode, e ritorno.
 *
 * **Questo e' il pezzo da buttare**, ed e' registrato invece che nascosto (ADR-012,
 * paletto n.2). OpenCode non ha modalita' dei permessi: ha **agenti**, ciascuno con
 * modello, prompt e ruleset propri. `plan` combacia per fortuna, tutto il resto e' una
 * bugia comoda — `auto` non e' `build`, e' solo la cosa piu' vicina.
 *
 * ADR-014 lo risolve per davvero facendo dichiarare all'agent i propri selettori. Fino
 * ad allora questa funzione esiste perche' senza di lei la barra di stato mostrerebbe
 * una modalita' che non c'e', che e' peggio di mostrarne una approssimata.
 */
const AGENT_DI: Partial<Record<PermissionMode, string>> = { plan: 'plan' }
const modoDaAgent = (agent: string): PermissionMode => (agent === 'plan' ? 'plan' : 'default')

export class OpenCodeAdapter implements AgentSession {
  private readonly spec: SessionSpec
  private readonly hooks: AdapterHooks
  private readonly tr = new OpenCodeTranslator()
  private client: Client | null = null
  private sessionId = ''
  private modello: string
  private modelli: ModelChoice[] = []
  private modo: PermissionMode
  private ac = new AbortController()
  private flusso: Promise<void> | null = null
  private preso = false
  /** Chi aspetta che il turno finisca (`settled`). */
  private attese: Array<() => void> = []

  constructor(spec: SessionSpec, hooks: AdapterHooks) {
    this.spec = spec
    this.hooks = hooks
    this.modello = spec.model
    this.modo = spec.mode
  }

  private emit(p: Payload): void { this.hooks.onPayload(p) }

  async start(): Promise<void> {
    this.emit({ k: 'session.state', state: 'starting' })
    this.client = await clientPer(this.spec.cwd)
    this.preso = true
    const c = this.client

    // `'default'` vuol dire «decidi tu», non «un modello scelto da STARK» — e' la
    // stessa correzione fatta il 26 agosto per Claude Code, dove un
    // `'claude-sonnet-5'` cablato apriva ogni chat sul modello sbagliato. Qui pero'
    // `'default'` e' una **parola di Claude Code**: l'SDK di Anthropic la riconosce
    // come alias, OpenCode no. Quindi si chiede a lui quale userebbe, e si dice quale
    // e': una barra di stato che scrive «default» non dice niente, e se quel modello e'
    // giu' a monte non c'e' nemmeno modo di capire perche'.
    this.modelli = await elencoModelli(c)
    if (!refModello(this.modello)) {
      const suo = await defaultSuo(c)
      if (suo) this.modello = suo
    }

    // Riprendere non ricostruisce niente: la conversazione e' una riga nel database di
    // OpenCode, e il server e' gia' in piedi. E' la differenza con `--resume` di Claude
    // Code, ed e' anche il motivo per cui la premessa di ADR-005 («risvegliare costa
    // quota») e' vera di quell'agent e non del dominio.
    if (this.spec.resume?.ref) {
      this.sessionId = this.spec.resume.ref
    } else {
      const r = await c.v2.session.create({
        ...(refModello(this.modello) ? { model: refModello(this.modello) } : {}),
        ...(AGENT_DI[this.modo] ? { agent: AGENT_DI[this.modo] } : {}),
        location: { directory: this.spec.cwd },
      })
      const ses = dato(r) as { id?: string } | undefined
      if (!ses?.id) throw new Error('OpenCode non ha aperto la sessione')
      this.sessionId = ses.id
    }

    // Il ref di ripresa e' **suo**, non nostro: l'id lo genera OpenCode. STARK ha gia'
    // il posto dove metterlo (`session.resumeRef`, nato per il `/clear` di Claude
    // Code), e qui si vede che non era un rattoppo per quell'agent: e' il caso normale
    // di un agent che possiede le proprie conversazioni.
    this.emit({ k: 'session.resumeRef', ref: this.sessionId })

    this.ascolta()

    this.emit({
      k: 'session.created',
      agent: 'opencode',
      cwd: this.spec.cwd,
      model: this.modello,
      capabilities: capacita(),
      tools: await elencoTool(c),
      commands: await elencoComandi(c),
      modes: await elencoModi(c),
      // Senza questo elenco la barra di stato non offre niente da scegliere, e una
      // chat che nasce su un modello rotto resta rotta senza via d'uscita. Misurato:
      // il default dichiarato da OpenCode Zen su questa macchina e' `big-pickle`, che
      // e' giu' a monte da giorni.
      models: this.modelli,
    })
    // Non si dichiara la modalita' **chiesta** ma quella in cui si e' davvero.
    // `elencoModi` qui sopra dichiara `auto`, `acceptEdits`, `dontAsk` e
    // `bypassPermissions` NON disponibili, e il default del daemon e' `auto`: senza
    // questo declassamento la barra mostrerebbe una modalita' che lo stesso adapter ha
    // appena detto di non avere. E' lo stesso comportamento che Claude Code ha con un
    // modello che non regge auto mode — riparte in Manual e lo dice.
    if (!AGENT_DI[this.modo] && this.modo !== 'default') {
      this.emit({
        k: 'notice', level: 'info',
        text: `OpenCode non ha la modalità «${this.modo}»: questa chat parte in «default» (ADR-014)`,
      })
      this.modo = 'default'
    }
    this.emit({ k: 'session.mode', mode: this.modo })
    this.emit({ k: 'session.state', state: 'idle' })
  }

  /** Il flusso **per sessione**, non quello globale: un server serve piu' cartelle. */
  private ascolta(): void {
    const c = this.client
    if (!c) return
    this.flusso = (async () => {
      const s = await c.v2.session.events({ sessionID: this.sessionId }, { signal: this.ac.signal })
      for await (const grezzo of s.stream as AsyncIterable<OpenCodeEvent>) {
        try { await this.unEvento(grezzo) } catch (e) {
          this.emit({ k: 'notice', level: 'error', text: `evento non gestito: ${String(e)}` })
        }
      }
    })().catch(() => { /* chiuso da noi, o il server e' andato */ })
  }

  private async unEvento(e: OpenCodeEvent): Promise<void> {
    this.hooks.onRaw?.(e)
    const d = (e.data ?? e.properties ?? {}) as Record<string, unknown>

    // I due bloccanti non passano dal traduttore: hanno bisogno di **aspettare una
    // risposta**, e il traduttore e' una funzione pura di proposito.
    if (e.type === 'permission.v2.asked') { await this.unPermesso(d); return }
    if (e.type === 'question.v2.asked') { await this.unaDomanda(d); return }

    for (const p of this.tr.translate(e)) {
      this.emit(p)
      if (p.k === 'turn.ended') this.sveglia()
    }
  }

  private async unPermesso(d: Record<string, unknown>): Promise<void> {
    const requestId = String(d['id'] ?? randomUUID())
    const azione = String(d['action'] ?? 'azione')
    const risorse = Array.isArray(d['resources']) ? d['resources'].map(String) : []
    // `save` e' cio' che OpenCode propone di ricordare: e' gia' il nostro `savable`,
    // che §14 aveva preso proprio da qui. Non c'e' niente da tradurre.
    const salvabili = Array.isArray(d['save']) ? d['save'].map(String) : [azione]

    this.emit({
      k: 'permission.asked', requestId, action: azione,
      resources: risorse, savable: salvabili, source: {},
    })
    this.emit({ k: 'session.state', state: 'awaiting', reason: azione })

    const verdetto = this.hooks.onPermission
      ? await this.hooks.onPermission({ requestId, toolName: azione, input: (d['metadata'] ?? {}) as Record<string, unknown> })
      : { allow: true as const }

    this.emit({ k: 'session.state', state: 'busy' })
    if (!verdetto.allow) {
      this.emit({ k: 'permission.replied', requestId, decision: 'reject', message: verdetto.reason })
      await this.client?.v2.session.permission.reply({
        sessionID: this.sessionId, requestID: requestId, reply: 'reject', message: verdetto.reason,
      })
      return
    }
    // «Consenti sempre» qui e' **nativo**: `reply: 'always'`. Su Claude Code STARK deve
    // farsi scrivere una regola in un file; qui e' una parola del protocollo. Il
    // contratto passa una stringa (il soggetto) e non sa ne' l'una ne' l'altra cosa.
    const sempre = verdetto.remember !== undefined
    this.emit({ k: 'permission.replied', requestId, decision: sempre ? 'always' : 'once' })
    await this.client?.v2.session.permission.reply({
      sessionID: this.sessionId, requestID: requestId, reply: sempre ? 'always' : 'once',
    })
  }

  private async unaDomanda(d: Record<string, unknown>): Promise<void> {
    const requestId = String(d['id'] ?? randomUUID())
    const grezze = Array.isArray(d['questions']) ? d['questions'] : []
    const domande = grezze.map((q) => {
      const o = (q ?? {}) as Record<string, unknown>
      const opzioni = Array.isArray(o['options']) ? o['options'] : []
      return {
        header: String(o['header'] ?? ''),
        question: String(o['question'] ?? ''),
        multiSelect: Boolean(o['multiple']),
        options: opzioni.map((x) => {
          const y = (x ?? {}) as Record<string, unknown>
          // `description` e' obbligatoria nel modello canonico perche' su Claude Code
          // c'e' sempre; su OpenCode e' facoltativa. Vuota, non inventata: una
          // spiegazione finta accanto a una scelta e' peggio di nessuna spiegazione.
          return {
            label: String(y['label'] ?? y['value'] ?? ''),
            description: String(y['description'] ?? ''),
          }
        }),
      }
    })

    this.emit({ k: 'question.asked', requestId, questions: domande })
    this.emit({ k: 'session.state', state: 'awaiting', reason: 'domanda' })
    const risposta = this.hooks.onQuestion
      ? await this.hooks.onQuestion({ requestId, questions: domande })
      : null
    this.emit({ k: 'session.state', state: 'busy' })

    if (!risposta) {
      this.emit({ k: 'question.rejected', requestId })
      await this.client?.v2.session.question.reject({ sessionID: this.sessionId, requestID: requestId })
      return
    }
    this.emit({
      k: 'question.replied', requestId, answers: risposta.answers,
      ...(risposta.response !== undefined ? { response: risposta.response } : {}),
    })
    // OpenCode vuole le risposte **in ordine di domanda**, ciascuna come lista di
    // etichette scelte. STARK le tiene per intestazione, che e' come le mostra la UI:
    // qui si rimettono in fila.
    const inOrdine = domande.map(q => {
      const v = risposta.answers[q.header]
      return Array.isArray(v) ? v : v ? [v] : []
    })
    await this.client?.v2.session.question.reply({
      sessionID: this.sessionId, requestID: requestId,
      questionV2Reply: { answers: inOrdine } as never,
    })
  }

  prompt(text: string, images: PromptImage[] = []): string {
    const turnId = randomUUID()
    const parti: PromptPart[] = [
      { type: 'text', text },
      ...images.map(i => ({
        type: 'image' as const, ref: i.ref, mediaType: i.mediaType, bytes: i.bytes,
        ...(i.name ? { name: i.name } : {}),
      })),
    ]
    this.tr.apriTurno(turnId)
    this.emit({ k: 'turn.started', turnId, prompt: parti })
    this.emit({ k: 'session.state', state: 'busy' })

    // `delivery: 'queue'` — la fila FIFO **e' del protocollo**, non da costruire. Su
    // Claude Code STARK ha dovuto scriversela sopra (consegna uno alla volta, a
    // sessione ferma) perche' il CLI fondeva in un turno solo i prompt consegnati
    // insieme. Qui si chiede e basta. E' il posto in cui il secondo adapter fa **meno**
    // lavoro del primo, non di piu'.
    void this.client?.v2.session.prompt({
      sessionID: this.sessionId,
      ...(refModello(this.modello) ? { model: refModello(this.modello) } : {}),
      prompt: {
        text,
        ...(images.length
          ? { files: images.map(i => ({ mime: i.mediaType, url: `data:${i.mediaType};base64,${i.data}`, ...(i.name ? { filename: i.name } : {}) })) }
          : {}),
      },
      delivery: 'queue',
    } as never).catch((err: unknown) => {
      this.emit({ k: 'session.error', message: String(err), fatal: false })
      for (const p of this.tr.chiudiTurno('error')) this.emit(p)
      this.sveglia()
    })
    return turnId
  }

  async interrupt(): Promise<void> {
    // «Idle interruption is a no-op», dice la rotta: fermare una sessione ferma non e'
    // un errore. Quindi non serve guardare prima se sta lavorando.
    await this.client?.v2.session.interrupt({ sessionID: this.sessionId })
    for (const p of this.tr.chiudiTurno('aborted')) this.emit(p)
    this.sveglia()
  }

  async setModel(model: string): Promise<void> {
    this.modello = model
    const ref = refModello(model)
    if (ref) await this.client?.v2.session.switchModel({ sessionID: this.sessionId, model: ref })
    this.emit({ k: 'session.model', model })
  }

  async setMode(mode: PermissionMode): Promise<void> {
    const agent = AGENT_DI[mode]
    if (!agent && mode !== 'default') {
      // Il CLI non lo consente, quindi STARK non finge di averlo fatto: dice perche'.
      // La voce nella tendina e' gia' marcata non disponibile con la ragione — questo
      // ramo copre chi ci arriva da un'altra strada (un comando, un risveglio).
      this.emit({
        k: 'notice', level: 'warn',
        text: `OpenCode non ha la modalità «${mode}»: resta «${this.modo}»`,
      })
      return
    }
    this.modo = mode
    if (agent) await this.client?.v2.session.switchAgent({ sessionID: this.sessionId, agent })
    this.emit({ k: 'session.mode', mode })
  }

  async setMcp(server: string, enabled: boolean): Promise<void> {
    // ⚠️ Misurato (P22): `mcp.connect/disconnect` prende `{ name, directory }`, **non**
    // un `sessionID`. Accendere un server qui lo accenderebbe per **tutte** le
    // conversazioni su quella cartella — cioe' farebbe una cosa diversa da quella
    // chiesta, in silenzio. Meglio non farla e dirlo: e' la stessa regola per cui una
    // voce che non si puo' fare sta in elenco **spenta con la spiegazione**.
    this.emit({
      k: 'notice', level: 'warn',
      text: `su OpenCode i server MCP si scelgono per cartella, non per chat: «${server}» resta com'e'`,
    })
    void enabled
  }

  async refreshQuota(): Promise<void> {
    // Non c'e' un piano da interrogare: OpenCode usa una chiave tua e il costo lo dice
    // per step (`step.ended.cost`, gia' tradotto in `usage.updated`). Non e' un buco da
    // riempire: e' una domanda che qui non si pone.
  }

  async refreshContext(): Promise<void> {
    // Qui il consumo del contesto **arriva** (`session.next.context.updated`) invece di
    // doverlo chiedere come su Claude Code (`getContextUsage()`). Chiedere non
    // servirebbe: `v2.session.context` torna i *messaggi*, non il livello (P22).
  }

  async fileSuggestions(query: string): Promise<string[]> {
    try {
      const r = await this.client?.v2.fs.find({ query })
      const v = dato(r)
      return Array.isArray(v) ? v.map(x => String((x as Record<string, unknown>)['path'] ?? '')) .filter(Boolean) : []
    } catch { return [] }
  }

  /** Aspetta che il turno aperto si chiuda. Senza turno, torna subito. */
  async settled(): Promise<void> {
    if (!this.tr.turnoAperto()) return
    await new Promise<void>(res => this.attese.push(res))
  }

  private sveglia(): void {
    const chi = this.attese
    this.attese = []
    for (const f of chi) f()
  }

  async sleep(): Promise<void> {
    // Dormire qui non uccide niente: non c'e' un processo per conversazione. Si smette
    // di ascoltare, e la conversazione resta dov'e' — nel database di OpenCode.
    await this.spegni()
    this.emit({ k: 'session.slept' })
    this.emit({ k: 'session.state', state: 'sleeping' })
  }

  async close(): Promise<void> {
    await this.spegni()
    this.emit({ k: 'session.state', state: 'closed' })
  }

  private async spegni(): Promise<void> {
    for (const p of this.tr.chiudiTurno('interrupted')) this.emit(p)
    this.sveglia()
    this.ac.abort()
    await this.flusso?.catch(() => {})
    this.flusso = null
    this.client = null
    if (this.preso) { this.preso = false; lascia() }
  }
}

// ─── quello che si sa della sessione appena nata ────────────────────────────

/** Scarta i due strati con cui il client SDK avvolge il corpo (misurato, P22). */
const dato = (r: unknown): unknown => {
  const a = (r ?? {}) as Record<string, unknown>
  const b = (a['data'] ?? a) as Record<string, unknown>
  return (b as Record<string, unknown>)['data'] ?? b
}

/**
 * Cosa questa sessione sa fare. Sono **misure**, non speranze: ogni `false` qui sotto
 * corrisponde a una cosa provata dal vivo e non trovata (P21/P22).
 */
function capacita(): Capabilities {
  return {
    interrupt: true,
    switchModel: true,
    switchMode: true,      // via agent, e con l'approssimazione detta sopra
    autoMode: false,       // non esiste un classificatore: qui si chiede o si consente
    permissionAlways: true, // nativo: `reply: 'always'`
    questions: true,
    revert: true,          // stage/commit/clear, con snapshot veri (un git interno)
    toolProgress: true,    // `session.next.tool.progress`
    fileBrowser: false,
    pty: true,             // il server espone i PTY, STARK non li usa ancora
  }
}

/**
 * I modelli fra cui questa sessione puo' scegliere.
 *
 * Si leggono dai **provider autenticati** (`config.providers`), non dal catalogo
 * generale: `v2.model.list` ne torna **7.326** — e' l'elenco di models.dev, cioe' tutti
 * i modelli esistenti al mondo, non quelli che questa macchina puo' davvero usare.
 * Offrirli tutti sarebbe una tendina inservibile piena di voci che danno 401.
 */
async function elencoModelli(c: Client): Promise<ModelChoice[]> {
  try {
    const v = dato(await c.config.providers()) as {
      providers?: Array<{ id?: string; models?: Record<string, Record<string, unknown>> }>
    } | undefined
    const out: ModelChoice[] = []
    for (const p of v?.providers ?? []) {
      for (const [mid, m] of Object.entries(p.models ?? {})) {
        const limit = (m['limit'] ?? {}) as Record<string, unknown>
        out.push({
          id: `${p.id}/${mid}`,
          ...(typeof m['name'] === 'string' ? { label: String(m['name']) } : {}),
          // Nessun classificatore su OpenCode: nessun modello «regge auto mode», e
          // dirlo per tutti e' piu' onesto che lasciare il campo a caso.
          autoMode: false,
          contextWindow: typeof limit['context'] === 'number' ? limit['context'] : 0,
        })
      }
    }
    return out
  } catch { return [] }
}

/** Quale modello userebbe OpenCode se non gliene si dice nessuno. */
async function defaultSuo(c: Client): Promise<string | null> {
  try {
    const v = dato(await c.config.providers()) as { default?: Record<string, string> } | undefined
    const [prov, mid] = Object.entries(v?.default ?? {})[0] ?? []
    return prov && mid ? `${prov}/${mid}` : null
  } catch { return null }
}

async function elencoTool(c: Client): Promise<string[]> {
  try {
    const v = dato(await c.tool.ids())
    return Array.isArray(v) ? v.map(String) : []
  } catch { return [] }
}

async function elencoComandi(c: Client): Promise<SlashCommand[]> {
  try {
    const v = dato(await c.v2.command.list())
    if (!Array.isArray(v)) return []
    return v.map(x => {
      const o = (x ?? {}) as Record<string, unknown>
      return {
        name: String(o['name'] ?? ''),
        ...(o['description'] ? { description: String(o['description']) } : {}),
      }
    }).filter(x => x.name)
  } catch { return [] }
}

/**
 * Le modalita' offerte dalla barra di stato.
 *
 * Qui si vede meglio che altrove perche' ADR-014 e' necessaria: si sta traducendo un
 * elenco di **agenti** in un elenco di **modalita'**, cioe' due cose diverse, e il
 * risultato e' che di sei modalita' ne restano due vere. Le altre quattro si dichiarano
 * **non disponibili con la ragione** invece di sparire — Principio 5.
 */
async function elencoModi(c: Client): Promise<ModeChoice[]> {
  let agenti: string[] = []
  try {
    const v = dato(await c.v2.agent.list())
    if (Array.isArray(v)) agenti = v.map(x => String((x as Record<string, unknown>)['name'] ?? '')).filter(Boolean)
  } catch { /* un elenco vuoto e' comunque una risposta */ }
  const haPlan = agenti.length === 0 || agenti.includes('plan')
  const perche = 'OpenCode non ha modalità dei permessi: ha agenti (ADR-014)'
  return [
    { mode: 'default', available: true },
    { mode: 'plan', available: haPlan, ...(haPlan ? {} : { reason: 'nessun agent «plan» su questa macchina' }) },
    { mode: 'acceptEdits', available: false, reason: perche },
    { mode: 'auto', available: false, reason: perche },
    { mode: 'dontAsk', available: false, reason: perche },
    { mode: 'bypassPermissions', available: false, reason: perche },
  ]
}

export { modoDaAgent }
export { modelloDa }
