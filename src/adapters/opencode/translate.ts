// Da eventi OpenCode a vocabolario canonico.
//
// Gemello di `claude-code/translate.ts`, e scritto apposta con la stessa forma: una
// classe con un po' di stato, un metodo che prende un evento nativo e restituisce zero
// o piu' `Payload`. Nessuna I/O qui dentro — cosi' si puo' provare su eventi finti a
// costo zero, che e' come si prova il traduttore dell'altro agent.
//
// ─── Perche' questo file e' stato riscritto il 27 agosto 2026 ────────────────
//
// Prima leggeva il vocabolario `session.next.*` del runner **v2**. Quel runner risolve
// i modelli in `model.available()`, che su questa macchina contiene **29** voci — i soli
// modelli gratuiti — mentre il catalogo ne offre 61: scegliere uno degli altri 32 apriva
// un turno che non partiva mai, e il server lo scriveva solo nel proprio log
// (`ModelUnavailableError`). Il CLI, attaccato **allo stesso server**, li esegue tutti:
// STARK poteva quindi **meno** del CLI (Principio 5), e la differenza era la superficie.
//
// Il turno passa ora dal runner **legacy** (`/session/{id}/prompt_async`), che li esegue
// tutti — misurato: `gpt-5-nano` risponde in 5,8s con costo 0,00142585 e 27.355 token,
// dove la via v2 chiudeva con costo 0 e zero token. Vedi ADR-015.
//
// ─── Cosa cambia nella forma, e le due trappole misurate ─────────────────────
//
// Il runner v2 raccontava **il ciclo di vita** (`text.started`, `tool.called`, …); quello
// legacy racconta **lo stato** (`message.part.updated` con dentro la parte intera, e
// `message.part.delta` per i pezzi). Stessa informazione, ma qui il traduttore deve
// tenere memoria di cosa ha gia' visto, invece di limitarsi a rinominare.
//
// 1. **`delta.field` NON dice che tipo di parte e'.** Dice quale *campo della parte* sta
//    crescendo, ed e' `"text"` anche per il ragionamento. Misurato su una cattura vera:
//    410 delta di parti `reasoning` etichettati `field:"text"`, accanto a 27 di testo
//    vero. Fidarsi di quel campo vorrebbe dire mostrare tutto il ragionamento come se
//    fosse la risposta. Da qui la mappa `tipoDi`.
// 2. **Le parti non dicono il ruolo.** Il prompt dell'utente arriva come una parte
//    `text` identica a quelle dell'agent; a distinguerle e' solo il `role` del messaggio,
//    che sta in `message.updated`. Senza `ruoloDi`, la casella di scrittura rimanderebbe
//    indietro il proprio prompt come risposta.
//
// Entrambe le mappe reggono su un ordine che e' stato **verificato, non sperato**: su due
// catture vere, 0 delta su 437 sono arrivati prima della propria parte, e 0 parti su 38
// prima del proprio `message.updated`. Il codice non ci si appoggia comunque: una parte
// sconosciuta si ignora invece di indovinare.
//
// ─── Cosa NON e' cambiato, di proposito ──────────────────────────────────────
//
// Il carico utile si legge da `data ?? properties`: l'OpenAPI dichiara `properties`, il
// filo manda l'uno o l'altro a seconda della rotta. Verificato, non dedotto — la prima
// sonda leggeva solo `properties` e i permessi, che arrivavano, non si vedevano.

import { EMPTY_USAGE, type Payload, type Usage } from '../../core/events.ts'

// NOTA sui totali del turno: `turn.ended` vuole `usage` e `cost` del giro intero, ma
// OpenCode li da' **per step** (`step-finish.tokens`, `.cost`). Sommarli qui vorrebbe
// dire tenere un accumulatore nel traduttore, che e' stato che non gli appartiene: chi
// somma e' `reduce.ts`, che vede passare tutti gli `usage.updated`. Qui si manda zero,
// e lo zero e' onesto — non e' «non ha speso niente», e' «il totale non lo dico io».

/** Un evento come arriva dal filo. `data` o `properties`: vedi sopra. */
export type OpenCodeEvent = {
  id?: string
  type?: string
  durable?: { aggregateID?: string; seq?: number; version?: number }
  data?: Record<string, unknown>
  properties?: Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const ogg = (v: unknown): Record<string, unknown> =>
  (v ?? {}) as Record<string, unknown>

/**
 * I token di uno step nel nostro vocabolario.
 *
 * OpenCode conta anche i token di ragionamento a parte; STARK non ha quel campo, e
 * sommarli all'output sarebbe una scelta silenziosa. Restano fuori, e sta scritto qui
 * perche' un giorno la somma potrebbe sembrare un bug.
 */
function usoDa(t: unknown): Usage {
  const o = ogg(t)
  const cache = ogg(o['cache'])
  return {
    input: num(o['input']),
    output: num(o['output']),
    cacheRead: num(cache['read']),
    cacheWrite: num(cache['write']),
  }
}

/**
 * Il soggetto di un'azione, per la riga del tool.
 *
 * Molto piu' corto del `summary.ts` di Claude Code, e va bene: quello deve riconoscere
 * trenta tool con nomi propri, qui i campi sono gli stessi tre in tutti. Se domani
 * servisse di piu', il posto e' questo — non la UI.
 */
export function sommarioDi(tool: string, input: unknown): string | undefined {
  const o = ogg(input)
  const primo = ['command', 'filePath', 'path', 'pattern', 'query', 'url', 'description']
    .map(k => o[k]).find(v => typeof v === 'string' && v.length > 0)
  return typeof primo === 'string' ? primo : undefined
}

/** Una parte di testo o ragionamento in corso. */
type Corrente = { tipo: 'text' | 'reasoning'; messageID: string; testo: string }

export class OpenCodeTranslator {
  /** Il turno aperto, se c'e'. Lo apre l'adapter mandando il prompt, non il traduttore:
   *  chi scrive nella casella deve vedere il proprio turno **adesso**, non a fine giro. */
  private turno: string | null = null
  private step: string | null = null
  /** `messageID` → ruolo. Senza questo il prompt dell'utente tornerebbe come risposta. */
  private ruoloDi = new Map<string, string>()
  /** `partID` → la parte in corso. E' anche la mappa che instrada i delta (vedi §1). */
  private aperte = new Map<string, Corrente>()
  /** `partID` → ultimo stato visto del tool, per emettere solo le transizioni. */
  private statoTool = new Map<string, string>()
  /** L'ultimo `step-finish.reason`: dice **come** e' finito il turno che `session.idle`
   *  dice soltanto **che** e' finito. */
  private ultimoFinish = ''

  apriTurno(turnId: string): void { this.turno = turnId }
  turnoAperto(): string | null { return this.turno }

  /** Un evento nativo → zero o piu' eventi canonici. */
  translate(e: OpenCodeEvent): Payload[] {
    const d = ogg(e.data ?? e.properties)
    const t = e.type ?? ''

    switch (t) {
      // ─── chi sta parlando ───────────────────────────────────────────────
      case 'message.updated': {
        const info = ogg(d['info'])
        const id = str(info['id'])
        if (id) this.ruoloDi.set(id, str(info['role']))
        return []
      }

      // ─── lo stato di una parte ──────────────────────────────────────────
      case 'message.part.updated':
        return this.unaParte(ogg(d['part']))

      case 'message.part.delta': {
        const pid = str(d['partID'])
        const corr = this.aperte.get(pid)
        // Una parte mai annunciata si ignora: non sappiamo se e' risposta o
        // ragionamento, e indovinare vorrebbe dire mostrarla nel posto sbagliato.
        if (!corr) return []
        const delta = str(d['delta'])
        if (!delta) return []
        corr.testo += delta
        return [corr.tipo === 'text'
          ? { k: 'text.delta', partId: pid, delta }
          : { k: 'reasoning.delta', partId: pid, delta }]
      }

      // ─── il giro ────────────────────────────────────────────────────────
      //
      // `session.idle` **arriva davvero** su questa superficie. Sul runner v2 non si era
      // mai visto in otto giri, e §14-bis registrava la fine del turno come una
      // deduzione del client (`turnEnd`). Qui e' un fatto annunciato, quindi si smette
      // di dedurre: `step-finish` dice solo **come**, non piu' **se**.
      case 'session.idle':
        return this.chiudiTurno(motivoDa(this.ultimoFinish))

      case 'session.status': {
        const stato = str(ogg(d['status'])['type'])
        // Solo `busy` sale: `idle` lo dice gia' `chiudiTurno`, e lasciarlo passare qui
        // porterebbe la barra a «fermo» mentre il turno e' ancora aperto.
        return stato === 'busy' ? [{ k: 'session.state', state: 'busy' }] : []
      }

      case 'session.error': {
        const msg = str(ogg(d['error'])['message']) || str(d['message']) || 'errore'
        return [{ k: 'session.error', message: msg, fatal: false }, ...this.chiudiTurno('error')]
      }

      // ─── quello che cambia sotto i piedi ────────────────────────────────
      case 'session.compacted':
        return [{
          k: 'context.compacted',
          before: num(d['before']),
          ...(d['after'] !== undefined ? { after: num(d['after']) } : {}),
          trigger: str(d['reason']) === 'manual' ? 'manual' : 'auto',
        }]

      case 'session.next.retried':
        return [{
          k: 'session.retried',
          attempt: num(d['attempt']),
          reason: str(ogg(d['error'])['message']) || 'il modello non ha risposto',
        }]

      case 'todo.updated': {
        const grezzi = Array.isArray(d['todos']) ? d['todos'] : []
        return [{
          k: 'todo.updated',
          todos: grezzi.map(x => {
            const o = ogg(x)
            return {
              content: str(o['content']),
              status: str(o['status']) || 'pending',
              ...(o['priority'] ? { priority: str(o['priority']) } : {}),
            }
          }).filter(x => x.content),
        }]
      }

      default:
        // Tutto il resto e' rumore per la UI: heartbeat del server, plugin caricati,
        // catalogo aggiornato, il file watcher. Non e' un buco: il turno lo apre
        // l'adapter, e questi non descrivono la conversazione.
        return []
    }
  }

  /**
   * Una parte cambiata.
   *
   * Le parti dell'**utente** non producono niente: il suo prompt STARK ce l'ha gia',
   * l'ha appena mandato lui. Rimandarlo indietro lo farebbe comparire due volte, la
   * seconda come se l'avesse detto l'agent.
   */
  private unaParte(p: Record<string, unknown>): Payload[] {
    const pid = str(p['id'])
    const mid = str(p['messageID'])
    if (this.ruoloDi.get(mid) === 'user') return []

    switch (str(p['type'])) {
      case 'step-start': {
        this.step = mid || 'step'
        return [{ k: 'session.state', state: 'busy' }, { k: 'step.started', stepId: this.step }]
      }

      case 'step-finish': {
        const uso = usoDa(p['tokens'])
        this.ultimoFinish = str(p['reason'])
        const out: Payload[] = [
          // Un `step-finish` chiude tutto cio' che quello step stava scrivendo: dopo di
          // lui quelle parti non crescono piu', e lasciarle aperte vorrebbe dire non
          // mandare mai il loro `*.ended`.
          ...this.chiudiParti(mid),
          {
            k: 'step.ended',
            stepId: this.step ?? mid ?? 'step',
            finish: this.ultimoFinish || 'unknown',
            usage: uso,
          },
          { k: 'usage.updated', usage: uso, cost: { nominalUsd: num(p['cost']) } },
        ]
        this.step = null
        return out
      }

      case 'text':
      case 'reasoning':
        return this.testoOrRagionamento(pid, mid, str(p['type']) as 'text' | 'reasoning', str(p['text']))

      case 'tool':
        return this.unTool(pid, p)

      default:
        return []
    }
  }

  /**
   * Una parte di testo o di ragionamento, che arriva **intera** ogni volta.
   *
   * Si manda solo la coda nuova, non tutto da capo: `message.part.updated` ripete il
   * testo accumulato, e `message.part.delta` manda gli stessi caratteri un istante
   * prima. Senza il confronto sulla lunghezza ogni risposta comparirebbe raddoppiata.
   */
  private testoOrRagionamento(
    pid: string, mid: string, tipo: 'text' | 'reasoning', testo: string,
  ): Payload[] {
    const out: Payload[] = []
    let corr = this.aperte.get(pid)
    if (!corr) {
      corr = { tipo, messageID: mid, testo: '' }
      this.aperte.set(pid, corr)
      out.push(tipo === 'text'
        ? { k: 'text.started', partId: pid }
        : { k: 'reasoning.started', partId: pid })
    }
    if (testo.length > corr.testo.length && testo.startsWith(corr.testo)) {
      const delta = testo.slice(corr.testo.length)
      corr.testo = testo
      out.push(tipo === 'text'
        ? { k: 'text.delta', partId: pid, delta }
        : { k: 'reasoning.delta', partId: pid, delta })
    } else if (testo && testo !== corr.testo) {
      // Non e' un prolungamento: il testo e' stato **riscritto**. Non capita nei giri
      // misurati, ma se capitasse mandare la differenza sarebbe peggio che ricominciare.
      corr.testo = testo
    }
    return out
  }

  /**
   * Un tool, che qui e' una macchina a stati invece che quattro eventi distinti.
   *
   * Misurata su una cattura vera: `pending → running → completed`. Si emette **solo
   * sulla transizione**, perche' la stessa parte torna piu' volte nello stesso stato e
   * senza questo controllo una riga comparirebbe tre volte.
   *
   * L'input parsato compare in `running`, non in `pending` — che porta `input: {}`:
   * e' lo stesso motivo per cui la versione v2 leggeva `tool.called` e non
   * `tool.input.ended`.
   */
  private unTool(pid: string, p: Record<string, unknown>): Payload[] {
    const stato = ogg(p['state'])
    const status = str(stato['status'])
    const callId = str(p['callID']) || pid
    if (this.statoTool.get(pid) === status) return []
    this.statoTool.set(pid, status)

    switch (status) {
      case 'pending':
        return [{ k: 'tool.started', callId, name: str(p['tool']) }]

      case 'running': {
        const sommario = sommarioDi(str(p['tool']), stato['input'])
        return [{
          k: 'tool.input.ended',
          callId,
          input: stato['input'] ?? {},
          ...(sommario ? { summary: sommario } : {}),
        }]
      }

      case 'completed':
        return [{
          k: 'tool.ended', callId, ok: true,
          output: stato['output'] ?? ogg(stato['metadata']) ?? {},
        }]

      case 'error':
        return [{
          k: 'tool.ended', callId, ok: false,
          error: str(stato['error']) || str(ogg(stato['error'])['message']) || 'il tool e\' fallito',
        }]

      default:
        return []
    }
  }

  /** Chiudi le parti ancora aperte di un messaggio. */
  private chiudiParti(messageID: string): Payload[] {
    const out: Payload[] = []
    for (const [pid, c] of this.aperte) {
      if (messageID && c.messageID !== messageID) continue
      out.push(c.tipo === 'text'
        ? { k: 'text.ended', partId: pid, text: c.testo }
        : { k: 'reasoning.ended', partId: pid })
      this.aperte.delete(pid)
    }
    return out
  }

  /** Chiudi il turno aperto, se c'e'. Chiamarlo due volte non fa niente. */
  chiudiTurno(reason: 'completed' | 'aborted' | 'error' | 'interrupted'): Payload[] {
    if (!this.turno) return []
    const turnId = this.turno
    this.turno = null
    // Le parti rimaste aperte si chiudono **prima** del turno: una parte senza il suo
    // `*.ended` resta in eterno «sta scrivendo» nella conversazione ricostruita.
    const coda = this.chiudiParti('')
    this.statoTool.clear()
    this.ultimoFinish = ''
    return [
      ...coda,
      { k: 'turn.ended', turnId, reason, usage: EMPTY_USAGE, cost: { nominalUsd: 0 } },
      { k: 'session.state', state: 'idle' },
    ]
  }
}

/**
 * Da `reason` di uno step OpenCode al motivo canonico di chiusura.
 *
 * `stop` e `tool-calls` sono entrambi finali qui, e non e' una svista: con `session.idle`
 * che annuncia la fine, l'ultimo step di un turno riuscito puo' benissimo essere quello
 * che ha appena chiamato un tool. Sul runner v2 `tool-calls` voleva dire «il giro
 * continua» perche' li' la fine si **deduceva**; qui a dirla c'e' un evento.
 * `length` e' un troncamento, `aborted`/`cancelled` sono lo Stop dell'utente.
 */
export function motivoDa(finish: string): 'completed' | 'aborted' | 'error' | 'interrupted' {
  if (finish === 'stop' || finish === 'tool-calls' || finish === '') return 'completed'
  if (finish === 'aborted' || finish === 'cancelled') return 'aborted'
  return 'error'
}

/** `ModelRef` → la stringa che STARK mostra. Legacy dice `modelID`, v2 `id`. */
export function modelloDa(m: unknown): string {
  const o = ogg(m)
  const id = str(o['id']) || str(o['modelID'])
  const prov = str(o['providerID'])
  return prov && id ? `${prov}/${id}` : id
}
