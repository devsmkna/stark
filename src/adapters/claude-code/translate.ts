// §14 — la mappatura da Claude Code al vocabolario canonico.
//
// È una macchina a stati e non una funzione pura per un motivo solo: lo streaming.
// I `content_block_delta` sono identificati da un indice dentro il messaggio corrente,
// quindi per sapere a che parte appartiene un delta bisogna ricordarsi cosa ha aperto
// l'indice. Tutto lo stato che tiene serve a questo, e nient'altro.
//
// Non fa I/O e non conosce il processo: si può alimentare con una cattura JSONL
// registrata e ottenere esattamente gli stessi eventi canonici. È ciò che rende
// verificabile la traduzione senza spendere quota.

import type { Cost, Payload, Usage } from '../../core/events.ts'
import type { NativeEvent } from './raw.ts'
import { classifyBlock, flattenContent, toolEffect } from './effects.ts'
import { intentOf, summarize } from './summary.ts'

type OpenBlock =
  | { kind: 'text'; partId: string; acc: string }
  | { kind: 'reasoning'; partId: string }
  | { kind: 'tool'; callId: string; name: string; acc: string }

export class Translator {
  private blocks = new Map<number, OpenBlock>()
  private messageId = 'm0'
  private pendingThinkingTokens: number | undefined
  private turnId: string | undefined
  /** callId -> nome del tool e input, per arricchire il tool_result che arriverà dopo. */
  private calls = new Map<string, { name: string; input: unknown }>()

  /** Il turno lo apre STARK, non l'agent: l'agent non sa cosa sia un prompt utente. */
  beginTurn(turnId: string): void { this.turnId = turnId }
  /** C'è un turno aperto in questo momento? Lo chiede l'adapter a ogni prompt: se la
   *  risposta è sì, il prossimo **apre un turno suo e si mette in fila**, e sarà
   *  l'adapter a consegnarlo quando questo sarà chiuso. Non si piega più dentro —
   *  vedi il commento su `turn.promptAdded` in events.ts. */
  get openTurnId(): string | undefined { return this.turnId }

  handle(e: NativeEvent): Payload[] {
    switch (e['type']) {
      case 'system': return this.system(e)
      case 'stream_event': return this.stream(e['event'] ?? {})
      case 'user': return this.toolResults(e)
      case 'result': return this.result(e)
      case 'rate_limit_event': return this.quota(e)
      case 'assistant': return this.assistant(e)
      default: return []
    }
  }

  // ─── system ───────────────────────────────────────────────────────────────

  private system(e: NativeEvent): Payload[] {
    switch (e['subtype']) {
      case 'init': {
        // `system:init` NON è la nascita della sessione: arriva col primo turno, non
        // all'handshake (verificato — aspettarlo prima di poter promptare è un
        // deadlock). La sessione nasce dalla risposta all'initialize, che l'adapter
        // riceve prima. Qui resta solo ciò che davvero si scopre adesso: i tool.
        const out: Payload[] = []
        const tools = Array.isArray(e['tools']) ? e['tools'].map(String) : []
        if (tools.length > 0) out.push({ k: 'session.tools', tools })
        const ref = e['session_id']
        // Su un fork l'id cambia: se non si riscrivesse il riferimento, il risveglio
        // successivo tornerebbe alla sessione madre invece che alla copia.
        if (typeof ref === 'string' && ref) out.push({ k: 'session.resumeRef', ref })
        return out
      }
      case 'status':
        return e['status'] === 'requesting'
          ? [{ k: 'session.state', state: 'busy' }]
          : []
      case 'thinking_tokens':
        // Non è un evento a sé: è un indicatore di avanzamento dello stesso fatto (§7).
        // Viene agganciato al prossimo reasoning.delta.
        this.pendingThinkingTokens = num(e['estimated_tokens'])
        return []
      case 'compact_boundary': {
        const meta = (e['compact_metadata'] ?? {}) as Record<string, unknown>
        const after = num(meta['post_tokens'])
        const trigger = meta['trigger']
        const ms = num(meta['duration_ms'])
        return [{
          k: 'context.compacted',
          before: num(meta['pre_tokens']) ?? 0,
          // `after` era fisso a zero, che voleva dire «non lo so» e si leggeva
          // «azzerato». Quando il protocollo non lo manda, non lo mandiamo nemmeno noi.
          ...(after !== undefined ? { after } : {}),
          ...(trigger === 'manual' || trigger === 'auto' ? { trigger } : {}),
          ...(ms !== undefined ? { ms } : {}),
        }]
      }
      default:
        return []
    }
  }

  // ─── assistant ────────────────────────────────────────────────────────────

  /**
   * Quasi sempre `[]`: una risposta vera arriva già per streaming
   * (`content_block_delta`), quindi il messaggio `assistant` consolidato che arriva
   * alla fine è ridondante — ripeterlo qui duplicherebbe il testo.
   *
   * **Bug trovato il 26 agosto 2026, segnalato dall'utente**: l'uscita di un comando
   * locale (`/usage`, `/model`, …) non passa da lì. Arriva come un **unico**
   * messaggio `assistant` completo, senza un solo `content_block_delta` prima —
   * riconoscibile da `model: "<synthetic>"`, che l'SDK stesso usa per dire «questo
   * non è passato dal modello». Trattarlo come "ridondante con lo streaming" e
   * buttarlo via, la regola giusta per ogni altro caso, qui voleva dire buttare via
   * l'unica copia che esiste: il turno si chiudeva regolarmente (`result` arriva lo
   * stesso, a costo zero — verificato: `usage` tutto a zero) ma restava senza un
   * solo blocco dentro. Non un'interruzione: una risposta vera, mai mostrata.
   */
  private assistant(e: NativeEvent): Payload[] {
    const msg = (e['message'] ?? {}) as Record<string, unknown>
    if (msg['model'] !== '<synthetic>') return []
    const blocchi = Array.isArray(msg['content']) ? msg['content'] : []
    const testo = blocchi
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && b['type'] === 'text')
      .map(b => String(b['text'] ?? ''))
      .join('')
    if (!testo) return []
    // Un `partId` suo, non quello dell'ultimo `messageId` di streaming: questo
    // messaggio non ha aperto nessun blocco con `content_block_start`, quindi non
    // c'è un indice da riusare — l'id del messaggio stesso basta a renderlo stabile.
    const partId = `${String(msg['id'] ?? e['uuid'] ?? this.messageId)}#0`
    return [
      { k: 'text.started', partId },
      { k: 'text.delta', partId, delta: testo },
      { k: 'text.ended', partId, text: testo },
    ]
  }

  // ─── stream_event ─────────────────────────────────────────────────────────

  private stream(ev: NativeEvent): Payload[] {
    switch (ev['type']) {
      case 'message_start': {
        this.messageId = String(ev['message']?.['id'] ?? this.messageId)
        this.blocks.clear()
        return [{ k: 'step.started', stepId: this.messageId }]
      }
      case 'content_block_start': {
        const i = num(ev['index']) ?? 0
        const b = ev['content_block'] ?? {}
        // §16.2: l'identità della parte non può essere l'indice, che si ricicla a ogni
        // messaggio. `messageId#index` è stabile e sopravvive alla rilettura del journal.
        const partId = `${this.messageId}#${i}`
        if (b['type'] === 'text') {
          this.blocks.set(i, { kind: 'text', partId, acc: '' })
          return [{ k: 'text.started', partId }]
        }
        if (b['type'] === 'thinking') {
          this.blocks.set(i, { kind: 'reasoning', partId })
          return [{ k: 'reasoning.started', partId }]
        }
        if (b['type'] === 'tool_use') {
          const callId = String(b['id'] ?? partId)
          const name = String(b['name'] ?? '?')
          this.blocks.set(i, { kind: 'tool', callId, name, acc: '' })
          this.calls.set(callId, { name, input: b['input'] ?? {} })
          return [{ k: 'tool.started', callId, name }]
        }
        return []
      }
      case 'content_block_delta': {
        const i = num(ev['index']) ?? 0
        const block = this.blocks.get(i)
        const d = ev['delta'] ?? {}
        if (!block) return []
        if (block.kind === 'text' && typeof d['text'] === 'string') {
          block.acc += d['text']
          return [{ k: 'text.delta', partId: block.partId, delta: d['text'] }]
        }
        if (block.kind === 'reasoning' && typeof d['thinking'] === 'string') {
          const tokens = this.pendingThinkingTokens
          this.pendingThinkingTokens = undefined
          return [{
            k: 'reasoning.delta', partId: block.partId, delta: d['thinking'],
            ...(tokens !== undefined ? { estimatedTokens: tokens } : {}),
          }]
        }
        if (block.kind === 'tool' && typeof d['partial_json'] === 'string') {
          block.acc += d['partial_json']
          return [{ k: 'tool.input.delta', callId: block.callId, delta: d['partial_json'] }]
        }
        return []
      }
      case 'content_block_stop': {
        const i = num(ev['index']) ?? 0
        const block = this.blocks.get(i)
        this.blocks.delete(i)
        if (!block) return []
        if (block.kind === 'text') return [{ k: 'text.ended', partId: block.partId, text: block.acc }]
        if (block.kind === 'reasoning') return [{ k: 'reasoning.ended', partId: block.partId }]
        const input = parseJson(block.acc)
        this.calls.set(block.callId, { name: block.name, input })
        const summary = summarize(block.name, input)
        const intent = intentOf(block.name, input)
        return [{
          k: 'tool.input.ended', callId: block.callId, input,
          ...(summary !== undefined ? { summary } : {}),
          ...(intent !== undefined ? { intent } : {}),
        }]
      }
      case 'message_stop':
        return [{ k: 'step.ended', stepId: this.messageId, finish: 'stop', usage: EMPTY }]
      default:
        return []
    }
  }

  // ─── tool_result ──────────────────────────────────────────────────────────

  private toolResults(e: NativeEvent): Payload[] {
    const content = e['message']?.['content']
    if (!Array.isArray(content)) return []
    // Il risultato ricco (structuredPatch, stdout, originalFile) viaggia in un campo
    // fratello del messaggio, non dentro il tool_result. Il nome è cambiato fra le
    // versioni del CLI: si accettano entrambe le forme invece di indovinarne una.
    const rich = e['tool_use_result'] ?? e['toolUseResult'] ?? {}
    const out: Payload[] = []
    for (const item of content) {
      if (item?.['type'] !== 'tool_result') continue
      const callId = String(item['tool_use_id'] ?? '')
      const isError = item['is_error'] === true
      const text = flattenContent(item['content'])
      const call = this.calls.get(callId)

      const blocked = classifyBlock(text)
      out.push(blocked
        ? { k: 'tool.ended', callId, ok: false, error: text }
        : { k: 'tool.ended', callId, ok: !isError, ...(isError ? { error: text } : { output: text }) })
      if (blocked) {
        // §10: un blocco NON arriva come richiesta di permesso, arriva come errore di
        // tool. Senza distinguerlo la UI direbbe "comando fallito" dove la verità è
        // "bloccato per sicurezza, puoi consentirlo tu".
        out.push({ k: 'action.blocked', by: blocked, callId, reason: text })
        continue
      }
      if (isError || !call) continue

      const effect = toolEffect(call.name, call.input, rich, callId)
      if (effect) out.push(effect)
    }
    return out
  }

  // ─── chiusura del turno ───────────────────────────────────────────────────

  private result(e: NativeEvent): Payload[] {
    const usage = readUsage(e['usage'])
    const cost: Cost = { nominalUsd: num(e['total_cost_usd']) ?? 0 }
    const out: Payload[] = [{ k: 'usage.updated', usage, cost }]
    if (this.turnId) {
      out.push({
        k: 'turn.ended', turnId: this.turnId,
        reason: e['subtype'] === 'success' ? 'completed'
          : e['is_error'] === true ? 'error' : 'aborted',
        usage, cost,
      })
      this.turnId = undefined
    }
    out.push({ k: 'session.state', state: 'idle' })
    return out
  }

  private quota(e: NativeEvent): Payload[] {
    const i = e['rate_limit_info'] ?? {}
    return [{
      k: 'quota.updated',
      status: String(i['status'] ?? 'unknown'),
      kind: String(i['rateLimitType'] ?? 'unknown'),
      resetsAt: num(i['resetsAt']) ?? 0,
      usingOverage: i['isUsingOverage'] === true,
    }]
  }
}

// ─── helper ─────────────────────────────────────────────────────────────────

const EMPTY: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function parseJson(s: string): unknown {
  if (!s.trim()) return {}
  try { return JSON.parse(s) } catch { return { __unparsed: s } }
}

function readUsage(u: unknown): Usage {
  const o = (u ?? {}) as Record<string, unknown>
  return {
    input: num(o['input_tokens']) ?? 0,
    output: num(o['output_tokens']) ?? 0,
    cacheRead: num(o['cache_read_input_tokens']) ?? 0,
    cacheWrite: num(o['cache_creation_input_tokens']) ?? 0,
  }
}
