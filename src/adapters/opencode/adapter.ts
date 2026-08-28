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
import { tmpdir } from 'node:os'
import {
  optionsFrom,
  type AdapterHooks, type AgentSession, type PromptImage, type SessionSpec,
} from '../../core/adapter.ts'
import type {
  Capabilities, ModelChoice, ModeChoice, Payload, PermissionMode, PromptPart, SlashCommand,
} from '../../core/events.ts'
import { clientLegacyPer, clientPer, lascia } from './host.ts'
import { modelloDa, OpenCodeTranslator, type OpenCodeEvent } from './translate.ts'

type Client = Awaited<ReturnType<typeof clientPer>>
type Legacy = Awaited<ReturnType<typeof clientLegacyPer>>

/** Quante volte STARK riprova da se'. Tre come il terminale, misurato nel suo log. */
const RITENTATIVI = 3

/**
 * Quanto si aspetta il **primo segno di vita** di un turno prima di dichiararlo perso.
 *
 * ─── Perche' esiste, misurato il 27 agosto 2026 ───────────────────────────────
 *
 * Segnalazione dell'utente: «i modelli di OpenCode non sembrano funzionare». Non era
 * l'elenco: sceglierne uno che il runner v2 non sa risolvere apriva un turno che non
 * finiva **mai**. Il server lo sa e lo scrive nel proprio log —
 * `SessionRunnerModel.ModelUnavailableError` — ma sul flusso eventi **non dice niente**:
 * arrivano `prompt.admitted` e `prompted`, e poi il silenzio. Misurato: tre tentativi
 * sulla stessa sessione in 75 secondi, zero eventi.
 *
 * Un turno appeso in silenzio e' la cosa peggiore che una GUI possa fare, perche' non
 * si distingue da un modello che sta pensando. Quindi si guarda una cosa sola e
 * precisa: **fra l'ammissione del prompt e il primo passo** non deve esserci un vuoto
 * assurdo. Non e' un timeout sul turno — un tool puo' girare per minuti, e interromperlo
 * sarebbe un danno; e' un timeout sull'**avvio**.
 *
 * 90 secondi perche' devono essere abbondantemente oltre il caso lento e chiaramente
 * dentro l'assurdo. Misurato su questa macchina: `big-pickle` parte in 1,0-2,5s,
 * `gpt-5-nano` in 5,8s, e un turno con tre tool ci mette 36s **totali** ma il primo
 * passo arriva subito. Il caso rotto invece non parte mai.
 */
const ATTESA_PRIMO_SEGNO = 90_000

/**
 * L'errore puo' passare da solo?
 *
 * Si guarda il **testo**, e va detto perche' e' brutto: `step.failed` porta
 * `error.message` e non un codice, quindi non c'e' un campo pulito da confrontare.
 * L'alternativa — ritentare su tutto — farebbe aspettare l'utente tre volte per una
 * chiave sbagliata, che e' l'unica cosa che dovrebbe invece leggere subito.
 */
export function passeggero(motivo: string): boolean {
  const m = motivo.toLowerCase()
  // `not supported` e `401` NON entrano: una chiave che non abilita un modello non
  // cambia idea riprovando.
  if (m.includes('not supported') || m.includes('401') || m.includes('unauthor')) return false
  // **Un budget esaurito non e' un intoppo passeggero.** `FreeUsageLimitError` di
  // OpenCode Zen dice «hai finito l'allowance», e il suo messaggio contiene le parole
  // «Rate limit exceeded» — che sembrano un 429 e non lo sono. Riprovare tre volte in
  // nove secondi brucerebbe tre richieste dello stesso budget e ritarderebbe l'unica
  // cosa che l'utente deve leggere. Misurato il 27 agosto: dopo una giornata di sonde
  // la chiave rispondeva cosi' a ogni chiamata, streaming o no.
  if (m.includes('freeusagelimit') || m.includes('usage limit')) return false
  return /\b(429|500|502|503|504)\b/.test(m)
    || m.includes('unavailable') || m.includes('overload')
    || m.includes('rate limit') || m.includes('timeout')
    || m.includes('temporarily')
}

/** Il modello nella forma che OpenCode vuole: `providerID/id`, o solo `id`. */
function refModello(model: string): { providerID: string; id: string } | undefined {
  if (!model || model === 'default') return undefined
  const i = model.indexOf('/')
  return i > 0
    ? { providerID: model.slice(0, i), id: model.slice(i + 1) }
    : { providerID: 'opencode', id: model }
}

/**
 * Lo stesso modello nella forma che vuole la superficie **legacy**: `modelID`, non `id`.
 *
 * Sembra un capriccio di nomi e non lo e': e' l'unico posto in cui le due superfici
 * dello stesso server chiedono la stessa cosa con due parole diverse, e sbagliarla non
 * da' errore — il campo semplicemente non viene letto, e il turno parte sul modello di
 * default. Scoperto leggendo cosa manda il CLI, non i tipi.
 */
function refLegacy(model: string): { providerID: string; modelID: string } | undefined {
  const r = refModello(model)
  return r ? { providerID: r.providerID, modelID: r.id } : undefined
}

/**
 * Su OpenCode **la modalita' E' l'agent**.
 *
 * Fino a ieri qui c'era una mappatura provvisoria (`plan` → `plan`, tutto il resto
 * arrotondato) perche' il modello canonico conosceva solo le sei parole di Claude Code.
 * Con ADR-014 quella traduzione **non serve piu**': l'agent dichiara come si chiamano
 * le proprie modalita', e `build` e `plan` compaiono nella barra con il loro nome.
 *
 * I due integrati restano scritti qui come rete: `v2.agent.list()` puo' tornare vuoto
 * (visto dal vivo, P22), e una barra senza nessuna scelta sarebbe peggio di una con le
 * due che ogni installazione ha di sicuro.
 */
export const AGENTI_NOTI: Array<{ nome: string; descrizione: string }> = [
  { nome: 'build', descrizione: 'Tutti i tool, senza restrizioni' },
  { nome: 'plan', descrizione: 'Modifiche e comandi chiedono conferma' },
]
const AGENT_DI_DEFAULT = 'build'

export class OpenCodeAdapter implements AgentSession {
  private readonly spec: SessionSpec
  private readonly hooks: AdapterHooks
  private readonly tr = new OpenCodeTranslator()
  private client: Client | null = null
  /** La superficie che **esegue** il turno. Vedi `clientLegacyPer`. */
  private legacy: Legacy | null = null
  private sessionId = ''
  private modello: string
  private modelli: ModelChoice[] = []
  private modo: PermissionMode
  private ac = new AbortController()
  private flusso: Promise<void> | null = null
  private preso = false
  /** Chi aspetta che il turno finisca (`settled`). */
  private attese: Array<() => void> = []
  /** L'ultimo prompt mandato, per poterlo rimandare se lo step fallisce di striscio. */
  private ultimoPrompt: { parts: unknown[] } | null = null
  private tentativi = 0
  /** Lo Stop dell'utente: da li' in poi non si ritenta piu' niente. */
  private fermato = false
  /** Il guardiano del turno muto. Vedi `ATTESA_PRIMO_SEGNO`. */
  private guardia: ReturnType<typeof setTimeout> | null = null

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
    this.legacy = await clientLegacyPer(this.spec.cwd)
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
    const modi = await elencoModi(c)
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
          ...(this.modo ? { agent: this.modo } : {}),
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
      modes: modi,
      // Senza questo elenco la barra di stato non offre niente da scegliere, e una
      // chat che nasce su un modello rotto resta rotta senza via d'uscita. Misurato:
      // il default dichiarato da OpenCode Zen su questa macchina e' `big-pickle`, che
      // e' giu' a monte da giorni.
      models: this.modelli,
      options: optionsFrom({ mode: this.modo, modes: modi, model: this.modello, models: this.modelli }),
    })
    // Non si dichiara la modalita' **chiesta** ma quella in cui si e' davvero.
    // `elencoModi` qui sopra dichiara `auto`, `acceptEdits`, `dontAsk` e
    // `bypassPermissions` NON disponibili, e il default del daemon e' `auto`: senza
    // questo declassamento la barra mostrerebbe una modalita' che lo stesso adapter ha
    // appena detto di non avere. E' lo stesso comportamento che Claude Code ha con un
    // modello che non regge auto mode — riparte in Manual e lo dice.
    if (!modi.some(m => m.mode === this.modo && m.available)) {
      this.emit({
        k: 'notice', level: 'info',
        text: `OpenCode non ha la modalità «${this.modo}»: questa chat parte con l'agent «${AGENT_DI_DEFAULT}»`,
      })
      this.modo = AGENT_DI_DEFAULT
    }
    this.emit({ k: 'session.option', id: 'mode', value: this.modo })
    this.emit({ k: 'session.state', state: 'idle' })
  }

  /** Il flusso **per sessione**, non quello globale: un server serve piu' cartelle. */
  private ascolta(): void {
    const l = this.legacy
    if (!l) return
    this.flusso = (async () => {
      // Il flusso legacy e' **globale**, non per sessione: un server serve N
      // conversazioni e le racconta tutte sullo stesso filo. Filtrare qui non e' una
      // pigrizia — e' il posto giusto, perche' il `sessionID` sta dentro il carico
      // utile di ogni evento e nessuno sopra questo file sa che esiste un filo solo.
      const s = await l.event.subscribe({ signal: this.ac.signal }) as {
        stream: AsyncIterable<OpenCodeEvent>
      }
      for await (const grezzo of s.stream) {
        if (!this.miaSessione(grezzo)) continue
        try { await this.unEvento(grezzo) } catch (e) {
          this.emit({ k: 'notice', level: 'error', text: `evento non gestito: ${String(e)}` })
        }
      }
    })().catch(() => { /* chiuso da noi, o il server e' andato */ })
  }

  /**
   * L'evento parla di questa conversazione?
   *
   * Gli eventi che **non** portano un `sessionID` passano lo stesso: sono quelli del
   * server e del catalogo, il traduttore li ignora comunque, e scartarli qui vorrebbe
   * dire dover ricordare l'elenco in due posti.
   */
  private miaSessione(e: OpenCodeEvent): boolean {
    const d = (e.data ?? e.properties ?? {}) as Record<string, unknown>
    const dentro = (v: unknown): string =>
      typeof v === 'string' ? v : String((((v ?? {}) as Record<string, unknown>)['sessionID']) ?? '')
    const id = dentro(d['sessionID'])
      || dentro(d['part'])
      || dentro(d['info'])
    return !id || id === this.sessionId
  }

  /**
   * Il turno e' partito davvero: si smonta il guardiano.
   *
   * `prompt.admitted` e `prompted` **non contano**, ed e' tutto il punto: sono
   * esattamente i due eventi che arrivano anche quando il turno non partira' mai.
   * Dicono «ho ricevuto», non «sto lavorando».
   */
  private vivo(tipo: string): boolean {
    if (tipo === 'session.next.prompt.admitted' || tipo === 'session.next.prompted') return false
    return tipo.startsWith('session.next.') || tipo.startsWith('message.part.')
  }

  private smontaGuardia(): void {
    if (this.guardia) { clearTimeout(this.guardia); this.guardia = null }
  }

  /** Il turno e' stato ammesso: da adesso ha `ATTESA_PRIMO_SEGNO` per dare un segno. */
  private montaGuardia(): void {
    this.smontaGuardia()
    this.guardia = setTimeout(() => {
      this.guardia = null
      // Non si ritenta: se il runner ha abbandonato la sessione, rimandare lo stesso
      // prompt trova lo stesso muro — e l'utente aspetterebbe il triplo per leggere
      // la stessa cosa. Vale la ragione gia' scritta in `passeggero()`.
      this.ultimoPrompt = null
      const motivo = `Il turno è stato accettato ma non è mai partito (nessun evento per `
        + `${Math.round(ATTESA_PRIMO_SEGNO / 1000)}s). Di solito vuol dire che l'agent non `
        + `riesce a usare il modello scelto: provane un altro dalla barra qui sotto.`
      this.emit({ k: 'notice', level: 'error', text: motivo })
      this.emit({ k: 'session.error', message: motivo, fatal: false })
      for (const p of this.tr.chiudiTurno('error')) this.emit(p)
      this.emit({ k: 'session.state', state: 'idle' })
      this.sveglia()
    }, ATTESA_PRIMO_SEGNO)
    // Un guardiano non deve tenere in vita il processo: se STARK non ha altro da fare,
    // che si spenga senza aspettare novanta secondi per niente.
    this.guardia.unref?.()
  }

  private async unEvento(e: OpenCodeEvent): Promise<void> {
    this.hooks.onRaw?.(e)
    if (this.vivo(String(e.type))) this.smontaGuardia()
    const d = (e.data ?? e.properties ?? {}) as Record<string, unknown>

    // I due bloccanti non passano dal traduttore: hanno bisogno di **aspettare una
    // risposta**, e il traduttore e' una funzione pura di proposito.
    // I nomi senza `v2`: sul filo legacy i due bloccanti si chiamano cosi', e la
    // forma del carico utile e' diversa (vedi `unPermesso`). Misurato su una
    // cattura vera: e' `permission.asked` ad arrivare, non `permission.v2.asked`.
    if (e.type === 'permission.asked') { await this.unPermesso(d); return }
    if (e.type === 'question.asked') { await this.unaDomanda(d); return }
    if (e.type === 'session.next.step.failed' && await this.forseRitenta(d)) return

    for (const p of this.tr.translate(e)) {
      this.emit(p)
      if (p.k === 'turn.ended') this.sveglia()
    }
  }

  /**
   * Uno step fallito per una ragione **passeggera**: si riprova.
   *
   * ─── Perche' questo esiste, misurato il 27 agosto 2026 ────────────────────
   *
   * Segnalazione dell'utente: «big-pickle risponde dal terminale, non capisco perche'
   * qui no». Aveva ragione, e la causa non e' il modello — sono due strade diverse
   * dentro OpenCode, viste nel suo log:
   *
   *   dal terminale   `stream error ... Endpoint is unavailable` x3, poi la risposta
   *   dalla rotta v2  `LLM.Error: RequestExecutor.execute: ... HTTP 503`, una volta
   *
   * La prima ritenta, la seconda no — e la storia della sessione non contiene un solo
   * `session.next.retried`. Su un modello instabile il terminale insiste e STARK
   * mollava al primo colpo: cioe' STARK poteva **meno** del CLI, che e' la cosa che non
   * deve mai succedere (Principio 5).
   *
   * Quindi ritenta STARK, e **lo dice**: `session.retried` e' l'evento modellato lo
   * stesso giorno, e la riga nel flusso spiega la pausa invece di lasciarla misteriosa.
   *
   * Non si ritenta su tutto. Un 401 «modello non supportato» o una chiave sbagliata non
   * migliorano riprovando: insistere li' vorrebbe dire far aspettare l'utente per
   * niente e nascondergli l'unica cosa che deve leggere.
   */
  private async forseRitenta(d: Record<string, unknown>): Promise<boolean> {
    const err = (d['error'] ?? {}) as Record<string, unknown>
    const motivo = String(err['message'] ?? '')
    if (!this.ultimoPrompt || this.fermato) return false
    if (this.tentativi >= RITENTATIVI) return false
    if (!passeggero(motivo)) return false

    this.tentativi++
    this.emit({ k: 'session.retried', attempt: this.tentativi, reason: motivo })
    // Un po' di attesa crescente: riprovare nello stesso istante ha buone probabilita'
    // di trovare l'altro capo ancora giu'.
    await new Promise(r => setTimeout(r, 1500 * this.tentativi))
    if (this.fermato) return false
    this.montaGuardia()
    await this.mandaAlRunner(this.ultimoPrompt)
      .catch(() => { /* il prossimo errore chiudera' il turno */ })
    return true
  }

  private async unPermesso(d: Record<string, unknown>): Promise<void> {
    // I nomi dei campi sul filo legacy, misurati su una cattura vera e non dedotti
    // dai tipi: `permission` e' il **tipo** di richiesta (`external_directory`, …),
    // `patterns` sono le risorse toccate, `always` cio' che si puo' ricordare.
    // Erano `action`/`resources`/`save` sulla superficie v2: stesso significato, tre
    // parole diverse, e leggere quelle vecchie non da' errore — da' una card che dice
    // «azione» su risorse vuote, cioe' un permesso che non si puo' giudicare.
    const requestId = String(d['id'] ?? randomUUID())
    const azione = String(d['permission'] ?? d['action'] ?? 'azione')
    const risorse = Array.isArray(d['patterns']) ? d['patterns'].map(String)
      : Array.isArray(d['resources']) ? d['resources'].map(String) : []
    const salvabili = Array.isArray(d['always']) ? d['always'].map(String)
      : Array.isArray(d['save']) ? d['save'].map(String) : [azione]

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
      await this.rispondiPermesso(requestId, 'reject')
      return
    }
    // «Consenti sempre» qui e' **nativo**: `reply: 'always'`. Su Claude Code STARK deve
    // farsi scrivere una regola in un file; qui e' una parola del protocollo. Il
    // contratto passa una stringa (il soggetto) e non sa ne' l'una ne' l'altra cosa.
    const sempre = verdetto.remember !== undefined
    this.emit({ k: 'permission.replied', requestId, decision: sempre ? 'always' : 'once' })
    await this.rispondiPermesso(requestId, sempre ? 'always' : 'once')
  }

  /**
   * La risposta a un permesso, sulla rotta del runner che l'ha chiesto.
   *
   * Le tre parole sono le stesse di `/v2` (`once` / `always` / `reject`) — quello non
   * cambia. A cambiare e' il nome del campo, `response` invece di `reply`, e il fatto
   * che il permesso vada risposto **a chi l'ha chiesto**: rispondere su `/v2` lascerebbe
   * il tool appeso a `running` per sempre, che e' esattamente il sintomo visto in
   * cattura quando nessuno rispondeva.
   */
  private async rispondiPermesso(id: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    // Il nome brutto e' dell'SDK, non nostro: quella rotta nell'OpenAPI non ha un
    // `operationId`, quindi il generatore se lo costruisce dal metodo e dal percorso.
    // Lasciarlo com'e' e' meglio che avvolgerlo: un giorno lo correggeranno, e un alias
    // nostro nasconderebbe il fatto che il nome e' cambiato.
    await this.legacy?.postSessionIdPermissionsPermissionId({
      path: { id: this.sessionId, permissionID: id },
      query: { directory: this.spec.cwd },
      body: { response },
    } as never).catch((e: unknown) => {
      this.emit({ k: 'notice', level: 'error', text: `permesso non consegnato: ${String(e)}` })
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

    // Si tiene da parte per poterlo **rimandare**: la rotta v2 non ritenta da se' su un
    // errore passeggero del provider, e senza questo STARK mollerebbe dove il terminale
    // insiste (vedi `forseRitenta`). I contatori ripartono a ogni prompt nuovo.
    const invio = {
      parts: [
        { type: 'text' as const, text },
        ...images.map(i => ({
          type: 'file' as const,
          mime: i.mediaType,
          url: `data:${i.mediaType};base64,${i.data}`,
          ...(i.name ? { filename: i.name } : {}),
        })),
      ],
    }
    this.ultimoPrompt = invio
    this.tentativi = 0
    this.fermato = false
    this.montaGuardia()

    // La fila FIFO **e' del protocollo**, non da costruire. Su Claude Code STARK ha
    // dovuto scriversela sopra (consegna uno alla volta, a sessione ferma) perche' il
    // CLI fondeva in un turno solo i prompt consegnati insieme. Qui si manda e basta:
    // misurato sulla rotta legacy, due prompt a 14ms di distanza hanno prodotto quattro
    // messaggi — utente, agent, utente, agent — nell'ordine giusto e non fusi.
    // E' il posto in cui il secondo adapter fa **meno** lavoro del primo, non di piu'.
    void this.mandaAlRunner(invio).catch((err: unknown) => {
      this.emit({ k: 'session.error', message: String(err), fatal: false })
      for (const p of this.tr.chiudiTurno('error')) this.emit(p)
      this.sveglia()
    })
    return turnId
  }

  /**
   * Il prompt al runner che esegue davvero.
   *
   * Un metodo solo perche' lo chiamano in due — l'invio e il ritentativo — e due copie
   * della stessa chiamata sono due posti dove sbagliare il nome del campo del modello.
   */
  private async mandaAlRunner(invio: { parts: unknown[] }): Promise<void> {
    await this.legacy?.session.promptAsync({
      path: { id: this.sessionId },
      query: { directory: this.spec.cwd },
      body: {
        ...(refLegacy(this.modello) ? { model: refLegacy(this.modello) } : {}),
        ...(this.modo ? { agent: this.modo } : {}),
        parts: invio.parts,
      },
    } as never)
  }

  async interrupt(): Promise<void> {
    // Chi preme il quadrato rosso non vuole che STARK riprovi mezzo secondo dopo.
    this.fermato = true
    this.ultimoPrompt = null
    this.smontaGuardia()
    // «Idle interruption is a no-op», dice la rotta: fermare una sessione ferma non e'
    // un errore. Quindi non serve guardare prima se sta lavorando.
    //
    // Si ferma il runner che sta **davvero** girando, cioe' quello legacy: chiedere a
    // `/v2` di interrompere un turno che non ha avviato lui non fa niente, e chi ha
    // premuto il quadrato rosso lo vedrebbe continuare.
    await this.legacy?.session.abort({
      path: { id: this.sessionId }, query: { directory: this.spec.cwd },
    } as never).catch(() => { /* gia' ferma, o il server e' andato */ })
    for (const p of this.tr.chiudiTurno('aborted')) this.emit(p)
    this.sveglia()
  }

  async setOption(id: string, value: string): Promise<void> {
    if (id === 'mode') return this.setMode(value)
    if (id === 'model') return this.setModel(value)
    this.emit({ k: 'notice', level: 'warn', text: `opzione sconosciuta: ${id}` })
  }

  async setModel(model: string): Promise<void> {
    // Chi comanda e' `this.modello`: il modello viaggia **con ogni prompt**
    // (`mandaAlRunner`), quindi la scelta e' gia' efficace appena assegnata qui.
    this.modello = model
    const ref = refModello(model)
    // Lo si dice anche a `/v2`, cosi' la sessione ricorda la scelta per chi la
    // riaprisse da li' — ma **senza farne dipendere l'esito**: quel registro conosce
    // solo i modelli che il suo runner sa eseguire (29 su 61 su questa macchina), e
    // farlo fallire toglierebbe all'utente proprio i 32 che la via legacy esegue
    // benissimo. Cioe' rimetterebbe il bug che questo giro e' servito a togliere.
    if (ref) {
      await this.client?.v2.session.switchModel({ sessionID: this.sessionId, model: ref })
        .catch(() => { /* non lo conosce: il prompt lo porta comunque */ })
    }
    this.emit({ k: 'session.option', id: 'model', value: model })
  }

  /** La modalita' **e'** l'agent: si cambia agent e basta. */
  async setMode(mode: PermissionMode): Promise<void> {
    this.modo = mode
    await this.client?.v2.session.switchAgent({ sessionID: this.sessionId, agent: mode })
    this.emit({ k: 'session.option', id: 'mode', value: mode })
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
    this.smontaGuardia()
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
    retries: true,         // `session.next.retried`, con `attempt` ed `error`
    todos: true,           // `todo.updated`, piu' la rotta `GET /session/{id}/todo`
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
 * Le modalita' offerte dalla barra di stato — che su OpenCode sono **i suoi agenti**.
 *
 * Prima di ADR-014 questa funzione traduceva un elenco di agenti in un elenco di
 * modalita' di Claude Code, cioe' due cose diverse, e di sei ne restavano due vere con
 * quattro spente. Adesso non traduce piu' niente: dichiara `build` e `plan` con il loro
 * nome, ed e' la barra a disegnarli senza saperli.
 */
async function elencoModi(c: Client): Promise<ModeChoice[]> {
  let agenti: Array<{ nome: string; descrizione?: string }> = []
  try {
    const v = dato(await c.v2.agent.list())
    if (Array.isArray(v)) {
      agenti = v
        .map(x => x as Record<string, unknown>)
        // Solo i **primari**: i subagent (`general`, `explore`, `scout`) non si
        // scelgono dalla barra, li invoca l'agent quando gli servono.
        .filter(x => x['mode'] !== 'subagent' && x['hidden'] !== true)
        .map(x => ({
          nome: String(x['name'] ?? ''),
          ...(x['description'] ? { descrizione: String(x['description']) } : {}),
        }))
        .filter(x => x.nome)
    }
  } catch { /* un elenco vuoto e' comunque una risposta */ }
  // La descrizione la scrive **l'adapter**, non la UI. Senza, il browser ripiegava
  // sulle frasi che conosce per le modalita' di Claude Code e su «plan» ne mostrava
  // una che parla di un altro agent — vera per omonimia, falsa nei fatti.
  if (agenti.length === 0) agenti = [...AGENTI_NOTI]
  return agenti.map(a => ({
    mode: a.nome,
    label: a.nome,
    available: true,
    // `note`, non `reason`: queste modalita' si possono usare tutte. `reason` spiega
    // un rifiuto, e usarla per una descrizione avrebbe fatto sembrare spenta ogni voce.
    ...(a.descrizione ? { note: a.descrizione } : {}),
  }))
}

/**
 * Le modalita' di OpenCode senza avviare niente.
 *
 * Sono i due agenti primari che ogni installazione ha. Chiederlo al server vorrebbe
 * dire avviare un processo per riempire una tendina nelle impostazioni, e la risposta
 * sarebbe la stessa nel 99% dei casi: una conversazione aperta, che il server ce l'ha
 * davvero, chiede invece l'elenco vero (`elencoModi`).
 */
export const modiNoti = async (): Promise<ModeChoice[]> =>
  AGENTI_NOTI.map(a => ({ mode: a.nome, label: a.nome, available: true, note: a.descrizione }))

export { modelloDa }

/**
 * I modelli di OpenCode senza aprire una conversazione.
 *
 * Costa meno che su Claude Code, ed e' una differenza strutturale dei due backend, non
 * un caso: qui il server e' **condiviso**, quindi se una chat OpenCode e' gia' aperta
 * la domanda non fa partire proprio niente. Su Claude Code, che spawna un processo per
 * conversazione, elencare i modelli vuol dire per forza accenderne uno in piu'.
 *
 * `tmpdir()` come cartella perche' il client ne vuole una e i modelli non dipendono da
 * quale sia: sono i **provider autenticati** della macchina.
 */
export async function catalogoModelli(): Promise<ModelChoice[]> {
  const c = await clientPer(tmpdir())
  try {
    return await elencoModelli(c)
  } catch {
    // Server che non parte, chiave assente: chi sta sopra mostrera' l'agent senza
    // modelli e lo dira'. Non e' un guasto di chi ha aperto il menu.
    return []
  } finally {
    // Sempre, anche in errore: `lascia()` e' un contatore, e un giro non restituito
    // terrebbe in vita il server per sempre.
    lascia()
  }
}
