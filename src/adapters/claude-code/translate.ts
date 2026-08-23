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

import type { Cost, Hunk, Payload, Usage } from '../../core/events.ts'
import type { NativeEvent } from './native.ts'

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

  handle(e: NativeEvent): Payload[] {
    switch (e['type']) {
      case 'system': return this.system(e)
      case 'stream_event': return this.stream(e['event'] ?? {})
      case 'user': return this.toolResults(e)
      case 'result': return this.result(e)
      case 'rate_limit_event': return this.quota(e)
      case 'assistant': return []   // ridondante con stream_event quando c'è lo streaming
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
        const tools = Array.isArray(e['tools']) ? e['tools'].map(String) : []
        return tools.length > 0 ? [{ k: 'session.tools', tools }] : []
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
      case 'compact_boundary':
        return [{
          k: 'context.compacted',
          before: num(e['compact_metadata']?.['pre_tokens']) ?? 0,
          after: 0,
        }]
      default:
        return []
    }
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
        return [{ k: 'tool.input.ended', callId: block.callId, input }]
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

      const effect = this.effect(call.name, call.input, rich, callId)
      if (effect) out.push(effect)
    }
    return out
  }

  private effect(name: string, input: unknown, rich: NativeEvent, callId: string): Payload | null {
    const inp = (input ?? {}) as Record<string, unknown>
    if (name === 'Bash') {
      return {
        k: 'command.executed',
        command: String(inp['command'] ?? ''),
        stdout: String(rich['stdout'] ?? ''),
        stderr: String(rich['stderr'] ?? ''),
        interrupted: rich['interrupted'] === true,
        ...(num(rich['exitCode']) !== undefined ? { exitCode: num(rich['exitCode'])! } : {}),
        callId,
      }
    }
    if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
      const path = String(rich['filePath'] ?? inp['file_path'] ?? '')
      if (!path) return null
      const patch = Array.isArray(rich['structuredPatch']) ? rich['structuredPatch'] as Hunk[] : []
      // Trappola verificata (§9): su una Write di un file NUOVO `structuredPatch` è
      // vuoto, perché non c'è un originale da cui fare il diff. Inoltrarlo così
      // mostrerebbe "file modificato" con un diff vuoto nel caso più comune di tutti.
      const created = patch.length === 0
      const hunks = created ? [additionHunk(String(rich['content'] ?? inp['content'] ?? ''))] : patch
      const original = rich['originalFile']
      return {
        k: 'file.edited', path, hunks, created, callId,
        ...(typeof original === 'string' ? { originalFile: original } : {}),
      }
    }
    return null
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

function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(x => typeof x?.['text'] === 'string' ? x['text'] : '').join('')
  return ''
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

/** §9: hunk di sola aggiunta, sintetizzato quando il file non esisteva. */
function additionHunk(content: string): Hunk {
  const lines = content.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return {
    oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length,
    lines: lines.map(l => '+' + l),
  }
}

/**
 * Finché l'hook `PermissionDenied` non è verificato (§16.4), il blocco si riconosce
 * dal testo dell'errore. È fragile e sta scritto qui in chiaro proprio per questo:
 * quando l'hook sarà verificato, questa funzione sparisce.
 */
function classifyBlock(text: string): 'classifier' | 'denyRule' | null {
  if (/auto mode classifier/i.test(text)) return 'classifier'
  if (/haven't granted it yet|permission to use .* has been denied/i.test(text)) return 'denyRule'
  return null
}
