// Da eventi OpenCode a vocabolario canonico.
//
// Gemello di `claude-code/translate.ts`, e scritto apposta con la stessa forma: una
// classe con un po' di stato, un metodo che prende un evento nativo e restituisce zero
// o piu' `Payload`. Nessuna I/O qui dentro — cosi' si puo' provare su eventi finti a
// costo zero, che e' come si prova il traduttore dell'altro agent.
//
// ─── Le tre cose che qui non sono come su Claude Code ────────────────────────
//
// 1. **La fine del turno non e' annunciata.** `session.idle` non si e' mai visto in
//    otto giri di sonda, e `session.wait` e' dichiarato nei tipi ma il server risponde
//    «not available yet» (P22). Quindi `turn.ended` si **deduce**: uno step che finisce
//    con qualcosa di diverso da `tool-calls` e' la fine del giro. Se un giorno
//    `session.idle` comparisse davvero, il ramo c'e' gia' e vince lui.
// 2. **L'esito di un tool sono due eventi**, `tool.success` e `tool.failed`, non un
//    campo `ok`. E l'input **parsato** non sta in `tool.input.ended` (che porta il
//    grezzo) ma in `tool.called`.
// 3. **Il carico utile sta in `data`**, non in `properties` come dichiara l'OpenAPI.
//    Verificato, non dedotto: la prima sonda leggeva `properties` e i permessi, che
//    arrivavano, non venivano mai riconosciuti.

import { EMPTY_USAGE, type Payload, type Usage } from '../../core/events.ts'

// NOTA sui totali del turno: `turn.ended` vuole `usage` e `cost` del giro intero, ma
// OpenCode li da' **per step** (`step.ended.cost`, `.tokens`). Sommarli qui vorrebbe
// dire tenere un accumulatore nel traduttore, che e' stato che non gli appartiene: chi
// somma e' `reduce.ts`, che vede passare tutti gli `usage.updated`. Qui si manda zero,
// e lo zero e' onesto — non e' «non ha speso niente», e' «il totale non lo dico io».

/** Un evento come arriva dal filo. `data` e non `properties`: vedi sopra. */
export type OpenCodeEvent = {
  id?: string
  type?: string
  durable?: { aggregateID?: string; seq?: number; version?: number }
  data?: Record<string, unknown>
  properties?: Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/**
 * I token di uno step nel nostro vocabolario.
 *
 * OpenCode conta anche i token di ragionamento a parte; STARK non ha quel campo, e
 * sommarli all'output sarebbe una scelta silenziosa. Restano fuori, e sta scritto qui
 * perche' un giorno la somma potrebbe sembrare un bug.
 */
function usoDa(t: unknown): Usage {
  const o = (t ?? {}) as Record<string, unknown>
  const cache = (o['cache'] ?? {}) as Record<string, unknown>
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
  const o = (input ?? {}) as Record<string, unknown>
  const primo = ['command', 'filePath', 'path', 'pattern', 'query', 'url', 'description']
    .map(k => o[k]).find(v => typeof v === 'string' && v.length > 0)
  return typeof primo === 'string' ? primo : undefined
}

export class OpenCodeTranslator {
  /** Il turno aperto, se c'e'. Lo apre l'adapter mandando il prompt, non il traduttore:
   *  chi scrive nella casella deve vedere il proprio turno **adesso**, non a fine giro. */
  private turno: string | null = null
  private step: string | null = null

  apriTurno(turnId: string): void { this.turno = turnId }
  turnoAperto(): string | null { return this.turno }

  /** Un evento nativo → zero o piu' eventi canonici. */
  translate(e: OpenCodeEvent): Payload[] {
    const d = (e.data ?? e.properties ?? {}) as Record<string, unknown>
    const out: Payload[] = []
    const t = e.type ?? ''

    switch (t) {
      // ─── il giro ────────────────────────────────────────────────────────
      case 'session.next.step.started':
        this.step = str(d['assistantMessageID']) || 'step'
        out.push({ k: 'session.state', state: 'busy' })
        out.push({ k: 'step.started', stepId: this.step })
        break

      case 'session.next.step.ended': {
        const uso = usoDa(d['tokens'])
        out.push({
          k: 'step.ended',
          stepId: this.step ?? (str(d['assistantMessageID']) || 'step'),
          finish: str(d['finish']) || 'unknown',
          usage: uso,
        })
        out.push({ k: 'usage.updated', usage: uso, cost: { nominalUsd: num(d['cost']) } })
        this.step = null
        // La deduzione del §14-bis: `tool-calls` vuol dire «il modello ha chiesto un
        // tool, il giro continua». Qualunque altra cosa e' la fine — ma **quale** fine
        // lo dice `finish`, e appiattire tutto su «completed» sarebbe la bugia comoda
        // che il §4 vieta: un turno troncato per lunghezza non e' un turno riuscito.
        const finish = str(d['finish'])
        if (finish !== 'tool-calls') out.push(...this.chiudiTurno(motivoDa(finish)))
        break
      }

      case 'session.next.step.failed': {
        const err = (d['error'] ?? {}) as Record<string, unknown>
        const msg = str(err['message']) || 'lo step e\' fallito'
        out.push({ k: 'session.error', message: msg, fatal: false })
        out.push(...this.chiudiTurno('error'))
        break
      }

      // Non si e' mai visto in otto giri di sonda, ma se arriva ha ragione lui: e'
      // l'unico che dice «finito» invece di lasciarlo dedurre.
      case 'session.idle':
        out.push(...this.chiudiTurno('completed'))
        break

      // ─── le parti ───────────────────────────────────────────────────────
      case 'session.next.text.started':
        out.push({ k: 'text.started', partId: str(d['textID']) })
        break
      case 'session.next.text.delta':
        out.push({ k: 'text.delta', partId: str(d['textID']), delta: str(d['delta']) })
        break
      case 'session.next.text.ended':
        out.push({ k: 'text.ended', partId: str(d['textID']), text: str(d['text']) })
        break

      case 'session.next.reasoning.started':
        out.push({ k: 'reasoning.started', partId: str(d['reasoningID']) || str(d['textID']) })
        break
      case 'session.next.reasoning.delta':
        out.push({
          k: 'reasoning.delta',
          partId: str(d['reasoningID']) || str(d['textID']),
          delta: str(d['delta']),
        })
        break
      case 'session.next.reasoning.ended':
        out.push({ k: 'reasoning.ended', partId: str(d['reasoningID']) || str(d['textID']) })
        break

      // ─── i tool ─────────────────────────────────────────────────────────
      case 'session.next.tool.input.started':
        out.push({ k: 'tool.started', callId: str(d['callID']), name: str(d['name']) })
        break
      case 'session.next.tool.input.delta':
        out.push({ k: 'tool.input.delta', callId: str(d['callID']), delta: str(d['delta']) })
        break
      // NON `tool.input.ended`: quello porta il testo grezzo. L'input parsato sta qui.
      case 'session.next.tool.called': {
        const nome = str(d['tool'])
        const sommario = sommarioDi(nome, d['input'])
        out.push({
          k: 'tool.input.ended',
          callId: str(d['callID']),
          input: d['input'] ?? {},
          ...(sommario ? { summary: sommario } : {}),
        })
        break
      }
      case 'session.next.tool.success':
        out.push({
          k: 'tool.ended', callId: str(d['callID']), ok: true,
          output: d['content'] ?? d['structured'] ?? {},
        })
        break
      case 'session.next.tool.failed': {
        const err = (d['error'] ?? {}) as Record<string, unknown>
        out.push({
          k: 'tool.ended', callId: str(d['callID']), ok: false,
          error: str(err['message']) || str(d['result']) || 'il tool e\' fallito',
        })
        break
      }

      // ─── quello che cambia sotto i piedi ────────────────────────────────
      case 'session.next.model.switched':
        out.push({ k: 'session.model', model: modelloDa(d['model']) })
        break

      case 'session.next.compaction.ended':
        out.push({
          k: 'context.compacted',
          before: num(d['before']),
          ...(d['after'] !== undefined ? { after: num(d['after']) } : {}),
          trigger: str(d['reason']) === 'manual' ? 'manual' : 'auto',
        })
        break

      // ─── i due fatti che la prova di carico ha fatto entrare nel modello ────
      //
      // Fino a ieri erano `notice`, cioe' registrati invece che modellati: un fatto che
      // l'utente non vede e' peggio di un fatto detto male. Ora hanno un evento proprio
      // e una capacita' che dice se quell'agent li ha (§10-bis).
      case 'session.next.retried':
        out.push({
          k: 'session.retried',
          attempt: num(d['attempt']),
          reason: str(((d['error'] ?? {}) as Record<string, unknown>)['message']) || 'il modello non ha risposto',
        })
        break
      case 'todo.updated': {
        const grezzi = Array.isArray(d['todos']) ? d['todos'] : []
        out.push({
          k: 'todo.updated',
          todos: grezzi.map(x => {
            const o = (x ?? {}) as Record<string, unknown>
            return {
              content: str(o['content']),
              status: str(o['status']) || 'pending',
              ...(o['priority'] ? { priority: str(o['priority']) } : {}),
            }
          }).filter(t => t.content),
        })
        break
      }

      default:
        // Tutto il resto e' rumore per la UI: `prompt.admitted`, `prompted`,
        // `context.updated`, gli eventi di server e di catalogo. Non e' un buco:
        // il turno lo apre l'adapter, e il resto non descrive la conversazione.
        break
    }
    return out
  }

  /** Chiudi il turno aperto, se c'e'. Chiamarlo due volte non fa niente. */
  chiudiTurno(reason: 'completed' | 'aborted' | 'error' | 'interrupted'): Payload[] {
    if (!this.turno) return []
    const turnId = this.turno
    this.turno = null
    return [
      { k: 'turn.ended', turnId, reason, usage: EMPTY_USAGE, cost: { nominalUsd: 0 } },
      { k: 'session.state', state: 'idle' },
    ]
  }
}

/**
 * Da `finish` di OpenCode al motivo canonico di chiusura.
 *
 * `stop` e' l'unico che vuol dire «ha finito di dire quello che aveva da dire».
 * `length` e' un troncamento, `aborted`/`cancelled` sono lo Stop dell'utente, e
 * qualunque cosa non riconosciuta e' un errore — perche' fra i quattro valori
 * canonici e' l'unico che non promette niente di falso.
 */
export function motivoDa(finish: string): 'completed' | 'aborted' | 'error' | 'interrupted' {
  if (finish === 'stop') return 'completed'
  if (finish === 'aborted' || finish === 'cancelled') return 'aborted'
  return 'error'
}

/** `ModelRef` → la stringa che STARK mostra. */
export function modelloDa(m: unknown): string {
  const o = (m ?? {}) as Record<string, unknown>
  const id = str(o['id']) || str(o['modelID'])
  const prov = str(o['providerID'])
  return prov && id ? `${prov}/${id}` : id
}
