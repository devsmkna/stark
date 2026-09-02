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
  type AdapterHooks, type AgentSession, type PromptFile, type SessionSpec,
} from '../../core/adapter.ts'
import type {
  Capabilities, ModelChoice, ModeChoice, Payload, PermissionMode, PromptPart, SlashCommand,
} from '../../core/events.ts'
import { IMMAGINI, parteDi } from '../../core/allegati.ts'
import { EMPTY_USAGE } from '../../core/events.ts'
import { clientLegacyPer, clientPer, lascia } from './host.ts'
import { messaggioErrore, modelloDa, OpenCodeTranslator, type OpenCodeEvent } from './translate.ts'

type Client = Awaited<ReturnType<typeof clientPer>>
type Legacy = Awaited<ReturnType<typeof clientLegacyPer>>

/** Quante volte STARK riprova da se'. Tre come il terminale, misurato nel suo log. */
const RITENTATIVI = 3

/**
 * Workaround «turn interrupted» (task #2 della board): quando un turno viene interrotto,
 * STARK lo riprende da solo, fino a tre volte, con attese crescenti — 5s, 15s, 30s — e
 * mandando un messaggio di ripresa invece di ripartire da capo. La conversazione ha gia'
 * il prompt originale in cronologia: basta dire all'agent di continuare da dove era.
 */
const ATTESE_RIPRESA = [5000, 15000, 30000]
const RIPRESA = "C'è stata un'interruzione dovuta a turn interrupted. Riprendi il lavoro da dove l'hai interrotto."

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
    // La rete locale: il server che sta riavviando, il socket caduto a metà. Sono
    // esattamente i casi in cui riprovare fra qualche secondo trova l'altro capo
    // tornato — e prima non c'erano: STARK mollava al primo colpo proprio dove il
    // retry serviva di più.
    || m.includes('econnrefused') || m.includes('econnreset') || m.includes('econnaborted')
    || m.includes('socket hang up') || m.includes('fetch failed') || m.includes('epipe')
    || m.includes('etimedout')
  // `network` nudo era in questa lista e ne e' uscito: e' una parola che compare anche
  // in guasti **permanenti** («network policy violation», certi errori di proxy
  // aziendale), e ritentarli tre volte e' esattamente cio' che il commento in cima a
  // questa funzione dice di voler evitare. I codici qui sopra sono specifici e bastano.
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
  /** Il permesso o la domanda attualmente in attesa di risposta, se ce n'e' uno — per
   *  poterlo chiudere d'ufficio se il turno finisce per un'altra strada (errore,
   *  interrupt) mentre e' ancora appeso, invece di lasciarlo in `pendingPermissions`
   *  o `pendingQuestions` per sempre. */
  private bloccantePendente: { tipo: 'permission' | 'question'; requestId: string } | null = null

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
    // Subito dopo `clientPer`, che è quello che incrementa il refcount del server: un
    // fallimento in QUALUNQUE punto fra qui e la fine di `start()` deve poter
    // restituire il giro con `lascia()` (via `spegni()`), se no il server resta vivo
    // per sempre — visto: dodici `opencode serve` orfani in un giorno di prove.
    this.preso = true
    this.legacy = await clientLegacyPer(this.spec.cwd)
    const c = this.client

    // `'default'` vuol dire «decidi tu», non «un modello scelto da STARK» — e' la
    // stessa correzione fatta il 26 agosto per Claude Code, dove un
    // `'claude-sonnet-5'` cablato apriva ogni chat sul modello sbagliato. Qui pero'
    // `'default'` e' una **parola di Claude Code**: l'SDK di Anthropic la riconosce
    // come alias, OpenCode no. Quindi si chiede a lui quale userebbe, e si dice quale
    // e': una barra di stato che scrive «default» non dice niente, e se quel modello e'
    // giu' a monte non c'e' nemmeno modo di capire perche'.
    //
    // Quattro domande indipendenti allo stesso server: in fila costavano quattro
    // round-trip prima di poter dire `session.created`, in parallelo uno.
    const [modelli, modi, tools, commands] = await Promise.all([
      elencoModelli(c), elencoModi(c), elencoTool(c), elencoComandi(c),
    ])
    this.modelli = modelli
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
      tools,
      commands,
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
    // Un catalogo vuoto non e' un dettaglio da tendina: vuol dire che nessun provider
    // e' autenticato (o che il server non ha risposto), e senza dirlo la chat sembra
    // sana fino al primo prompt che non parte. Il catch dentro `elencoModelli` e'
    // silenzioso di suo — qui e' il posto che sa che la lista serviva.
    if (this.modelli.length === 0) {
      this.emit({
        k: 'notice', level: 'warn',
        text: 'OpenCode non ha dichiarato nessun modello: controlla i provider autenticati (`opencode auth list`) o il server.',
      })
    }
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
      // Il for-await e' finito e non siamo stati noi ad abortire: il server ha chiuso
      // il filo. Prima qui c'era il silenzio — vedi `mortoIlServer`.
      this.mortoIlServer('il server ha chiuso il flusso eventi')
    })().catch((e: unknown) => {
      this.mortoIlServer(String((e as Error)?.message ?? e))
    })
  }

  /**
   * Il flusso degli eventi e' morto sotto i piedi (crash o riavvio del server).
   *
   * Prima questo caso finiva in un `.catch(() => {})`: l'adapter restava **sordo per
   * sempre** — nessun evento, nessun errore, un turno in corso appeso senza che
   * niente lo dicesse (la guardia copre solo l'avvio, e un permesso gia' arrivato
   * l'aveva smontata). Un turno appeso in silenzio e' la cosa che questa GUI ha
   * giurato di non fare mai: quindi si **dichiara** — turno chiuso, card abbandonate,
   * `session.error` fatale, `closed`. Da li' il registry ritira la sessione e
   * `close()` restituisce il giro al server condiviso (`lascia()`); il risveglio
   * riapre su un server nuovo e la conversazione e' nel database di OpenCode — non si
   * perde niente. La riconnessione automatica resta un possibile seguito: prima la
   * verita', poi l'eroismo.
   */
  private mortoIlServer(motivo: string): void {
    if (this.ac.signal.aborted) return   // chiusura nostra: non e' una morte
    this.smontaGuardia()
    this.ultimoPrompt = null
    this.svuota()
    this.abbandonaBloccantePendente()
    this.emit({
      k: 'session.error',
      message: `il flusso eventi di OpenCode si è interrotto: ${motivo}`,
      fatal: true,
    })
    this.scrivi(this.tr.chiudiTurno('error', motivo))
    this.sveglia()
    this.emit({ k: 'session.state', state: 'closed' })
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
    // Un permesso o una domanda chiesti sono un segno di vita a tutti gli effetti: il
    // runner sta aspettando l'utente, non e' morto. Senza questo il guardiano scadeva
    // *mentre* si aspettava la risposta, chiudeva il turno in errore e lasciava il
    // permesso appeso per sempre in `pendingPermissions` — la sessione sembrava bloccata.
    if (tipo === 'permission.asked' || tipo === 'question.asked') return true
    return tipo.startsWith('session.next.') || tipo.startsWith('message.part.')
  }

  /**
   * Chiude d'ufficio il permesso o la domanda rimasti appesi, se il turno finisce per
   * un'altra strada mentre uno dei due era ancora in attesa — altrimenti resterebbe
   * in `pendingPermissions`/`pendingQuestions` per sempre, e il blocco in basso
   * mostrerebbe una card senza nessuno a doverla piu' leggere (§Aug 30 2026).
   */
  private abbandonaBloccantePendente(): void {
    const b = this.bloccantePendente
    if (!b) return
    this.bloccantePendente = null
    if (b.tipo === 'permission') {
      this.emit({ k: 'permission.replied', requestId: b.requestId, decision: 'reject' })
      void this.rispondiPermesso(b.requestId, 'reject')
    } else {
      this.emit({ k: 'question.rejected', requestId: b.requestId })
      void this.rispondiDomanda(b.requestId, null)
    }
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
      this.abbandonaBloccantePendente()
      this.scrivi(this.tr.chiudiTurno('error'))
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
    if (e.type === 'session.error' && await this.forseRitentaErrore(d)) return

    this.scrivi(this.tr.translate(e))
    this.sveglia()
  }

  /**
   * Un `session.error` passeggero (rate limit) puo' passare da solo? Se si, si ritenta
   * **senza** tradurre l'evento — cioe' senza chiudere il turno.
   *
   * Il bug che questo risolve: prima si traduceva sempre, il che chiudeva il turno
   * (`chiudiTurno('error', ...)`) e **solo dopo** `unEvento` decideva di riprovare. Fra
   * la chiusura e il nuovo tentativo il turno canonico risultava finito — `activity()`
   * su uno snapshot senza turno aperto torna `null`, e con lei sparisce lo Stop dal
   * Dock: durante l'attesa 5s/15s/30s il lavoro andava avanti (verificabile: `interrupt()`
   * abortiva davvero il runner) ma **non c'era modo di premerlo**. Segnalato dall'utente
   * il 30 agosto 2026: «lo stop diventa non premibile... come se scompare».
   *
   * `session.next.step.failed` (→ `forseRitenta`) non aveva questo bug: intercetta
   * anche lui prima di tradurre, e questo lo allinea allo stesso schema.
   */
  private async forseRitentaErrore(d: Record<string, unknown>): Promise<boolean> {
    const motivo = messaggioErrore(d)
    // Senza un turno aperto non c'e' niente da riprendere: un `session.error`
    // **globale** (senza sessionID passa `miaSessione`) a chat ferma faceva partire
    // la ripresa su un turno che non esisteva — un turno vero sul runner, eventi
    // orfani nel journal, quota spesa.
    if (this.tr.turnoAperto() === null) return false
    if (!this.ultimoPrompt || this.fermato) return false
    if (this.tentativi >= RITENTATIVI) return false
    if (!passeggero(motivo)) return false
    this.tentativi++
    this.emit({ k: 'session.retried', attempt: this.tentativi, reason: motivo })
    await new Promise(r => setTimeout(r, ATTESE_RIPRESA[this.tentativi - 1]))
    // Si ricontrolla **dopo** l'attesa, non solo prima: fra i 5 e i 30 secondi di
    // backoff ci sta comodo uno Sleep o una chiusura, e quelli passano da `spegni()`,
    // che chiude il turno senza essere un «Stop». Senza questa riga il risveglio
    // mandava un prompt fantasma a una chat dormiente e riarmava una guardia che
    // novanta secondi dopo avrebbe scritto su un journal ormai chiuso.
    if (!this.vivoPerRitentare()) return false
    this.montaGuardia()
    await this.mandaAlRunner({ parts: [{ type: 'text' as const, text: RIPRESA }] })
      .catch(() => { /* il prossimo errore chiudera' il turno */ })
    return true
  }

  /** C'e' ancora qualcuno per cui valga la pena riprovare? Da chiedersi **dopo** ogni
   *  attesa, perche' durante l'attesa la sessione puo' essersi fermata in tre modi
   *  diversi: lo Stop dell'utente, lo Sleep, la chiusura. */
  private vivoPerRitentare(): boolean {
    return !this.fermato && this.tr.turnoAperto() !== null && this.ultimoPrompt !== null
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
    // Stessa guardia di `forseRitentaErrore`, stessa ragione.
    if (this.tr.turnoAperto() === null) return false
    if (!this.ultimoPrompt || this.fermato) return false
    if (this.tentativi >= RITENTATIVI) return false
    if (!passeggero(motivo)) return false

    this.tentativi++
    this.emit({ k: 'session.retried', attempt: this.tentativi, reason: motivo })
    // Un po' di attesa crescente: riprovare nello stesso istante ha buone probabilita'
    // di trovare l'altro capo ancora giu'.
    const prompt = this.ultimoPrompt
    await new Promise(r => setTimeout(r, 1500 * this.tentativi))
    // Stessa ragione di `forseRitentaErrore`: chi si e' addormentato durante l'attesa
    // non vuole vedersi ripartire il turno addosso.
    if (!this.vivoPerRitentare()) return false
    this.montaGuardia()
    await this.mandaAlRunner(prompt)
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
    this.bloccantePendente = { tipo: 'permission', requestId }

    const verdetto = this.hooks.onPermission
      ? await this.hooks.onPermission({ requestId, toolName: azione, input: (d['metadata'] ?? {}) as Record<string, unknown> })
      : { allow: true as const }

    // Nel frattempo il turno potrebbe essere gia' stato chiuso d'ufficio (vedi
    // `abbandonaBloccantePendente`): rispondere di nuovo qui manderebbe un
    // `permission.replied` doppio su un requestId gia' risolto.
    if (this.bloccantePendente?.requestId !== requestId) return
    this.bloccantePendente = null

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
    //
    // Due cose imparate a caro prezzo, una qui e una su `rispondiDomanda`:
    // 1. con `ThrowOnError` al default l'SDK **non lancia** su un errore HTTP — torna
    //    un risultato con `.error`, e guardare solo il throw lo faceva sparire (stessa
    //    lezione del 30 agosto, applicata a una rotta e dimenticata sull'altra);
    // 2. una risposta che non arriva lascia il tool `running` per sempre, e la guardia
    //    a quel punto era gia' smontata (il permesso e' un segno di vita): il turno
    //    muto durava in eterno. Quindi: un ritentativo dopo 1s, e se fallisce ancora
    //    lo si dice nel flusso E si rimonta la guardia, cosi' il turno perso viene
    //    dichiarato invece di durare per sempre.
    const tenta = async (): Promise<string | null> => {
      try {
        const r = await this.legacy?.postSessionIdPermissionsPermissionId({
          path: { id: this.sessionId, permissionID: id },
          query: { directory: this.spec.cwd },
          body: { response },
        } as never) as { error?: unknown } | undefined
        return r?.error ? String(r.error).slice(0, 160) : null
      } catch (e) {
        return String((e as Error)?.message ?? e).slice(0, 160)
      }
    }
    let motivo = await tenta()
    if (motivo === null) return
    // Si ritenta **solo su un guasto di rete**, non su un rifiuto del server. Un 404 o
    // un 409 vogliono dire «quel permesso e' gia' stato risolto»: rimandarlo non lo
    // consegnerebbe una seconda volta, lo farebbe **valere** una seconda volta, e su un
    // `always` questo significa autorizzare di nuovo qualcosa che nessuno ha
    // riautorizzato. Se la prima risposta e' arrivata e a perdersi e' stata la
    // conferma, tacere e' il verso sicuro.
    if (passeggero(motivo)) {
      await new Promise(x => setTimeout(x, 1000))
      motivo = await tenta()
      if (motivo === null) return
    }
    this.emit({ k: 'notice', level: 'error', text: `permesso non consegnato: ${motivo}` })
    // Solo se c'e' ancora un turno da dichiarare perso: questa rotta risponde anche
    // ai rifiuti d'ufficio (`abbandonaBloccantePendente`), a turno gia' chiuso.
    if (this.tr.turnoAperto() !== null) this.montaGuardia()
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
    this.bloccantePendente = { tipo: 'question', requestId }
    const risposta = this.hooks.onQuestion
      ? await this.hooks.onQuestion({ requestId, questions: domande })
      : null

    if (this.bloccantePendente?.requestId !== requestId) return
    this.bloccantePendente = null
    this.emit({ k: 'session.state', state: 'busy' })

    if (!risposta) {
      this.emit({ k: 'question.rejected', requestId })
      await this.rispondiDomanda(requestId, null)
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
    await this.rispondiDomanda(requestId, inOrdine)
  }

  /**
   * La risposta (o il rifiuto) a una domanda del tool `question`, sul registro dove
   * sta davvero.
   *
   * Misurato il 30 agosto 2026 contro il server vivo: il tool che gira nel runner
   * legacy registra la domanda nel registro **globale** — `GET /question?directory=…`
   * la contiene, `GET /api/session/{id}/question` è vuoto — e la rotta
   * session-scoped dell'SDK, `v2.session.question.reply`, risponde
   * **404 QuestionNotFoundError**. La radice è la divergenza che ADR-009 prevedeva:
   * `createOpencodeServer` avvia `opencode` dal PATH (qui 1.18.25), mentre l'SDK che
   * genera le rotte è 1.17.20. Nota che il difetto **non** era una rotta mancante:
   * l'SDK 1.17.20 dichiara **entrambe** le superfici — `client.question.*` è il
   * registro globale, `client.v2.session.question.*` quello per sessione — il codice
   * semplicemente chiamava quello sbagliato. Prima di dare la colpa all'SDK, guardare
   * i suoi `.d.ts`: ci stava il metodo tutto il tempo.
   *
   * E il difetto peggiore era che il 404 **spariva**: con `ThrowOnError` al default
   * l'SDK non lancia, il risultato con `.error` veniva buttato via senza essere
   * letto — STARK diceva `question.replied` e `busy`, il tool restava `running` per
   * sempre, e chi guarda legge «si è fermato». Quindi: primo colpo la rotta globale
   * (la verità misurata sul server che gira qui); se un giorno il registro torna
   * session-scoped, quella la trova come seconda via; se falliscono entrambe, la
   * notizia arriva in cima alla chat invece di morire in una variabile.
   */
  private async rispondiDomanda(requestId: string, inOrdine: string[][] | null): Promise<void> {
    const base = { requestID: requestId, directory: this.spec.cwd }
    const globale = inOrdine
      ? await this.client?.question.reply({ ...base, answers: inOrdine }).catch(() => null)
      : await this.client?.question.reject(base).catch(() => null)
    if (globale && !globale.error) return

    const sessione = { sessionID: this.sessionId, requestID: requestId }
    const scoped = inOrdine
      ? await this.client?.v2.session.question
        .reply({ ...sessione, questionV2Reply: { answers: inOrdine } as never }).catch(() => null)
      : await this.client?.v2.session.question.reject(sessione).catch(() => null)
    if (scoped && !scoped.error) return

    const dettaglio = String(globale?.error ?? scoped?.error ?? 'nessuna risposta dal server').slice(0, 160)
    this.emit({
      k: 'notice', level: 'error',
      text: `la risposta non è arrivata all'agent: ${dettaglio}`,
    })
  }

  prompt(text: string, allegati: PromptFile[] = []): string {
    const turnId = randomUUID()
    const parti: PromptPart[] = [
      { type: 'text', text },
      ...allegati.map(i => ({
        // Immagine o file: la distinzione serve a chi disegna, non a chi manda.
        type: parteDi(i.mediaType), ref: i.ref, mediaType: i.mediaType, bytes: i.bytes,
        ...(i.name ? { name: i.name } : {}),
      })),
    ]

    // Si tiene da parte per poterlo **rimandare**: la rotta v2 non ritenta da se' su un
    // errore passeggero del provider, e senza questo STARK mollerebbe dove il terminale
    // insiste (vedi `forseRitenta`). I contatori ripartono a ogni prompt nuovo.
    const invio = {
      parts: [
        { type: 'text' as const, text },
        ...allegati.map(i => ({
          type: 'file' as const,
          mime: i.mediaType,
          url: `data:${i.mediaType};base64,${i.data}`,
          ...(i.name ? { filename: i.name } : {}),
        })),
      ],
    }
    // C'e' gia' qualcosa in volo? Allora questo prompt **apre un turno suo e aspetta**:
    // non si piega dentro quello in corso e non parte adesso. E' la stessa fila FIFO
    // che l'adapter di Claude Code si e' costruita il 26 agosto, e per la stessa
    // ragione, misurata qui il 30 agosto (tools/prova-opencode-coda.ts): il server
    // OpenCode accoda davvero — il primo turno non viene interrotto — ma sul filo non
    // c'e' niente che dica **quale** turno stia finendo, e il traduttore nostro tiene
    // un turno alla volta. Consegnando subito, la risposta del secondo prompt finiva
    // dentro il primo, e l'`session.idle` chiudeva il turno sbagliato lasciando
    // l'altro aperto per sempre. Tenendo la fila qui, al server arriva un prompt alla
    // volta e a sessione ferma: il caso normale, quello che gia' funziona.
    //
    // «Apre un turno suo» perche' e' cio' che l'utente ha fatto: due richieste
    // separate sono due richieste, e la UI lo sa gia' disegnare — un turno aperto
    // che non e' il primo aperto si mostra come «queued, waiting its turn».
    // Si annuncia **qui e una volta sola**, in entrambe le strade: `consegna()`
    // non lo ripete, perche' quando la chiama `next()` il turno e' gia' stato
    // annunciato entrando in fila — raddoppiarlo fonderebbe due turni nel journal.
    this.emit({ k: 'turn.started', turnId, prompt: parti })
    if (this.inVolo()) {
      this.coda.push({ turnId, invio })
      return turnId
    }

    this.consegna(turnId, invio)
    return turnId
  }

  // ─── la fila ──────────────────────────────────────────────────────────────

  /** I prompt che hanno gia' un turno aperto e aspettano il loro giro. In ordine.
   *  Le parti non servono piu': il `turn.started` l'hanno avuto entrando. */
  private coda: Array<{ turnId: string; invio: { parts: unknown[] } }> = []

  /** C'e' un turno in corso, o altri gia' in fila? */
  private inVolo(): boolean {
    return this.tr.turnoAperto() !== null || this.coda.length > 0
  }

  /**
   * Gli eventi di chiusura di un turno passano **tutti** da qui, ovunque nascano:
   * stream, guardiano, invio fallito, interrupt. Perche' due regole valgono in tutti
   * i casi e un solo posto a farle valere e' il modo per non dimenticarne uno:
   * l'`idle` bugiardo si filtra se dietro c'e' ancora della fila, e un `turn.ended`
   * consegna il prossimo prompt. Il guardiano e l'errore di invio chiudono turni
   * anche loro — lasciare la fila in sospeso dopo sarebbe il «queued, waiting its
   * turn» per sempre che il §4 vieta.
   */
  private scrivi(parti: Payload[]): void {
    for (const p of parti) {
      if (p.k === 'session.state' && p.state === 'idle'
        && (this.coda.length > 0 || this.tr.turnoAperto() !== null)) continue
      this.emit(p)
      if (p.k === 'turn.ended') {
        // Il turno e' finito: il suo prompt non e' piu' «l'ultimo da ritentare».
        // Senza questo azzeramento un errore arrivato a chat ferma trovava ancora
        // materiale per una ripresa che non aveva piu' un turno (vedi la guardia in
        // `forseRitentaErrore`). `next()` lo rimpiazza subito se c'e' fila.
        this.ultimoPrompt = null
        this.next()
      }
    }
  }

  /** Il turno e' davvero suo: si apre nel traduttore e si spedisce. L'annuncio
   *  (`turn.started`) sta a chi lo chiama, perche' il turno in fila l'ha gia' avuto. */
  private consegna(turnId: string, invio: { parts: unknown[] }): void {
    this.tr.apriTurno(turnId)
    this.emit({ k: 'session.state', state: 'busy' })

    this.ultimoPrompt = invio
    this.tentativi = 0
    this.fermato = false
    this.montaGuardia()

    void this.mandaAlRunner(invio).catch(async (err: unknown) => {
      // Un invio fallito per un guaio passeggero (ECONNRESET, il server che sta
      // riavviando) si ritenta come uno step fallito: stessa regola, stesso annuncio
      // `session.retried` nel flusso. Prima si chiudeva subito in errore, cioe' STARK
      // mollava sull'unico caso in cui bastava riprovare fra un secondo.
      if (await this.forseRitenta({ error: { message: String(err) } })) return
      // La guardia era armata per questo invio: senza smontarla, novanta secondi dopo
      // sparerebbe un secondo errore su un turno gia' chiuso.
      this.smontaGuardia()
      this.emit({ k: 'session.error', message: String(err), fatal: false })
      this.abbandonaBloccantePendente()
      this.scrivi(this.tr.chiudiTurno('error'))
      this.sveglia()
    })
  }

  /**
   * Il turno in corso e' finito: parte il primo della fila.
   *
   * Il `turn.started` l'ha gia' avuto quando e' entrato in fila, quindi qui si
   * apre e si spedisce e basta — raddoppiarlo fonderebbe due turni nel journal.
   */
  private next(): void {
    const p = this.coda.shift()
    if (!p) return
    this.consegna(p.turnId, p.invio)
  }

  /**
   * Svuota la fila dichiarando finiti i turni che non gireranno.
   *
   * Serve perche' un turno aperto che non ricevera' mai eventi e' la cosa peggiore
   * che si possa lasciare in un journal: alla rilettura la conversazione
   * mostrerebbe per sempre un «queued, waiting its turn» che non aspetta piu'
   * niente (§4). Meglio dire che e' stato interrotto, che e' la verita'.
   */
  private svuota(): void {
    const persi = this.coda
    this.coda = []
    for (const p of persi) {
      this.emit({
        k: 'turn.ended', turnId: p.turnId, reason: 'aborted',
        usage: { ...EMPTY_USAGE }, cost: { nominalUsd: 0 },
      })
    }
  }

  /**
   * Togli **una** voce dalla fila, su richiesta (`session.dequeue`).
   *
   * Lo stesso fatto di `svuota()`, per una voce sola — e qui senza eccezioni: il
   * `turn.started` l'hanno avuto **tutti** entrando in fila, quindi la voce tolta
   * lascia sempre dietro un turno aperto che si dichiara finito senza che sia mai
   * partito. `false` se il turno non era in fila: già consegnato, o mai esistito —
   * chi chiama lo dice all'utente invece di fingere.
   */
  dequeue(turnId: string): boolean {
    const i = this.coda.findIndex(p => p.turnId === turnId)
    if (i < 0) return false
    const [p] = this.coda.splice(i, 1)
    if (!p) return false
    this.emit({
      k: 'turn.ended', turnId: p.turnId, reason: 'aborted',
      usage: { ...EMPTY_USAGE }, cost: { nominalUsd: 0 },
    })
    return true
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
    // Chi preme il quadrato rosso non vuole che STARK riprova mezzo secondo dopo.
    this.fermato = true
    this.ultimoPrompt = null
    this.smontaGuardia()
    // E non vuole nemmeno che la fila parta un istante dopo: tre prompt in coda
    // vorrebbero quattro Stop. Uno ferma tutto — stessa ragione dell'adapter di
    // Claude Code.
    this.svuota()
    // «Idle interruption is a no-op», dice la rotta: fermare una sessione ferma non e'
    // un errore. Quindi non serve guardare prima se sta lavorando.
    //
    // Si ferma il runner che sta **davvero** girando, cioe' quello legacy: chiedere a
    // `/v2` di interrompere un turno che non ha avviato lui non fa niente, e chi ha
    // premuto il quadrato rosso lo vedrebbe continuare.
    await this.legacy?.session.abort({
      path: { id: this.sessionId }, query: { directory: this.spec.cwd },
    } as never).catch(() => { /* gia' ferma, o il server e' andato */ })
    this.abbandonaBloccantePendente()
    this.scrivi(this.tr.chiudiTurno('aborted'))
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

  /** Aspetta che non ci sia piu' niente in volo: il turno aperto **e** la fila.
   *  Serve alle prove, non alla UI. */
  async settled(): Promise<void> {
    while (this.tr.turnoAperto() || this.coda.length > 0) {
      await new Promise<void>(res => this.attese.push(res))
    }
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
    // `fermato` non e' «l'utente ha premuto Stop»: e' «da qui in poi non si ritenta
    // piu' niente». Lo Sleep e la chiusura sono altrettanto definitivi di uno Stop, e
    // finche' lo alzava solo `interrupt()` un retry addormentato si risvegliava
    // credendo di avere ancora una sessione a cui parlare.
    this.fermato = true
    this.ultimoPrompt = null
    this.smontaGuardia()
    this.svuota()
    this.scrivi(this.tr.chiudiTurno('interrupted'))
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
 * corrisponde a una cosa provata dal vivo e non trovata (P21/P22). Serve anche
 * all'import (`import.ts`), perche' la conversazione importata dichiara le stesse
 * capacita' di una viva: sono un fatto dell'agent, non della sessione.
 */
export function capacita(): Capabilities {
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
 * Cosa questo modello accetta come allegato, **come lo dichiara OpenCode**.
 *
 * Qui la domanda ha una risposta vera, a differenza di Claude Code dove l'handshake
 * non dice niente: ogni modello porta `capabilities.input.{text,image,audio,video,pdf}`.
 * Misurato sui 151 modelli dei provider autenticati di questa macchina — 61 con
 * `image`, 4 con `pdf`, 10 con `audio`, 28 con `video` — e non letto nei tipi, che
 * dichiarano un'altra forma: `ProviderConfig` promette `attachment` e `modalities`
 * **piatti** sul modello, il filo manda `capabilities` annidato. E' la stessa trappola
 * della P21 (`properties` contro `data`), e la sonda che aveva guardato nel posto
 * sbagliato non era fallita: aveva risposto «zero modelli con allegati», che sembra un
 * fatto. Si leggono quindi tutte e tre le forme, e a decidere e' quella che arriva.
 *
 * `attachment` da solo **non** vuol dire «accetta immagini»: sulla stessa macchina ci
 * sono 67 modelli con `attachment: true` di cui **otto** non leggono ne' immagini ne'
 * PDF — sono i modelli voce e video di nvidia (`nemotron-voicechat`, `streampetr`, …). Dedurne le immagini avrebbe riacceso la graffetta proprio dove
 * il modello ha appena detto di no. Resta come ripiego solo quando `input` non c'e'
 * affatto, che e' il caso di un server piu' vecchio di questa forma.
 *
 * Cosa **non** si dichiara, e va detto invece che scoperto: `audio` e `video`. OpenCode
 * li sa, e la sua `FilePart` porterebbe qualunque MIME — ma STARK non sa ancora
 * trasportarli (`ESTENSIONE` in `core/allegati.ts` non li ha, quindi il registro li
 * butterebbe in silenzio) ne' mostrarli in conversazione. Offrirli sarebbe un bottone
 * che accetta un file e poi lo perde.
 */
export function allegabiliDi(m: Record<string, unknown>): string[] {
  const cap = (m['capabilities'] ?? {}) as Record<string, unknown>
  const input = cap['input'] as Record<string, boolean> | undefined
  const modalita = (m['modalities'] ?? cap['modalities']) as { input?: string[] } | undefined
  const ha = (k: string): boolean =>
    input ? Boolean(input[k]) : Boolean(modalita?.input?.includes(k))

  if (!input && !modalita) {
    return (m['attachment'] ?? cap['attachment']) === true ? [...IMMAGINI] : []
  }
  return [
    ...(ha('image') ? IMMAGINI : []),
    ...(ha('pdf') ? ['application/pdf'] : []),
  ]
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
      providers?: Array<{ id?: string; name?: string; models?: Record<string, Record<string, unknown>> }>
    } | undefined
    const out: ModelChoice[] = []
    for (const p of v?.providers ?? []) {
      for (const [mid, m] of Object.entries(p.models ?? {})) {
        const limit = (m['limit'] ?? {}) as Record<string, unknown>
        const cost = (m['cost'] ?? {}) as Record<string, unknown>
        // Il fatto che il modello ragiona: capabilities.reasoning dell'SDK
        // (misurato 1º settembre 2026: vero su tutti e 105 i modelli di questa
        // macchina). È un fatto da leggere, NON un interruttore — il prompt di
        // sessione OpenCode non accetta opzioni per giro, quindi qui non nasce
        // nessuna voce 'reasoning' nel menu: il dato viaggia, la scelta no.
        const caps = (m['capabilities'] ?? {}) as Record<string, unknown>
        out.push({
          id: `${p.id}/${mid}`,
          ...(typeof m['name'] === 'string' ? { label: String(m['name']) } : {}),
          ...(p.id ? { group: p.name && p.name !== p.id ? p.name : p.id } : {}),
          // Nessun classificatore su OpenCode: nessun modello «regge auto mode», e
          // dirlo per tutti e' piu' onesto che lasciare il campo a caso.
          autoMode: false,
          contextWindow: typeof limit['context'] === 'number' ? limit['context'] : 0,
          accepts: allegabiliDi(m),
          // Il nome del provider (es. "OpenCode Zen") e il costo per milione di
          // token: su OpenCode lo stesso modello può stare su più provider con
          // prezzi diversi, e senza questi due campi chi sceglie non sa da chi sta
          // pagando. La scala è quella di models.dev, che è lì che nasce il dato.
          ...(typeof p.name === 'string' ? { providerName: String(p.name) } : {}),
          ...(typeof m['family'] === 'string' ? { family: String(m['family']) } : {}),
          ...(caps['reasoning'] === true ? { reasoning: true } : {}),
          ...(typeof cost['input'] === 'number' && typeof cost['output'] === 'number'
            ? { cost: { input: cost['input'], output: cost['output'] } } : {}),
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
