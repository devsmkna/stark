// Importare un trascritto gia scritto da Claude Code nel vocabolario canonico.
//
// Serve alla desiderata dell'MVP: aprire in STARK una conversazione nata nella CLI.
// Senza questo, riprendere una sessione darebbe un modello che ricorda tutto davanti
// a una UI che non mostra niente — la peggiore combinazione possibile, perche l'utente
// non ha modo di sapere su che cosa sta continuando a lavorare.
//
// NON e lo stesso formato dello stream dal vivo: il trascritto e fatto di messaggi
// interi con `uuid`, `timestamp` e `toolUseResult`, senza delta. Gli effetti pero
// passano dalla stessa funzione della traduzione dal vivo, cosi lo stesso fatto
// produce lo stesso evento da qualunque strada arrivi.

import { readFileSync } from 'node:fs'
import type { Payload, Usage } from '../../core/events.ts'
import { classifyBlock, flattenContent, toolEffect } from './effects.ts'
import type { NativeEvent } from './raw.ts'

export type ImportedEvent = { payload: Payload; ts: number }

export type ImportStats = {
  righe: number
  saltate: Record<string, number>
  turni: number
  parti: number
}

/** Righe che sono contabilita dell'interfaccia, non conversazione. */
const IGNORATI = new Set([
  'attachment', 'last-prompt', 'mode', 'permission-mode', 'bridge-session',
  'ai-title', 'atis-latch', 'file-history-snapshot', 'queue-operation',
])

/**
 * Il promemoria di contesto che l'interfaccia inietta dentro i messaggi dell'utente.
 * Non l'ha scritto lui: mostrarlo come suo sarebbe attribuirgli parole che non ha
 * detto, ed e la stessa ragione per cui `isMeta` viene scartato.
 */
const INIETTATO = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/**
 * L'interfaccia registra i comandi slash come se fossero messaggi dell'utente, con
 * l'invocazione e il suo output in due righe separate. L'utente ha davvero scritto
 * `/mcp`, quindi quello si mostra — ma ripulito, non con l'involucro attorno. Il suo
 * output invece non l'ha scritto lui: passa per un avviso, non per un suo messaggio.
 */
const COMANDO = /^<command-name>([^<]*)<\/command-name>/
const ARGOMENTI = /<command-args>([^<]*)<\/command-args>/
const USCITA = /^<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/

export function importTranscript(path: string): { events: ImportedEvent[]; stats: ImportStats } {
  const events: ImportedEvent[] = []
  const saltate: Record<string, number> = {}
  let righe = 0, turni = 0, parti = 0
  let turnAperto = false
  let uso = vuoto()
  const nomiTool = new Map<string, { name: string; input: unknown }>()

  const salta = (motivo: string): void => { saltate[motivo] = (saltate[motivo] ?? 0) + 1 }
  const push = (payload: Payload, ts: number): void => { events.push({ payload, ts }) }

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    righe++
    let e: NativeEvent
    try { e = JSON.parse(line) } catch { salta('riga illeggibile'); continue }

    const tipo = String(e['type'] ?? '?')
    if (IGNORATI.has(tipo)) { salta(tipo); continue }
    // Le sidechain sono conversazioni dei subagent: hanno una loro storia e mostrarle
    // mescolate a questa sarebbe falso. Restano fuori dall'MVP, ma si contano.
    if (e['isSidechain']) { salta('sidechain'); continue }
    if (e['isMeta']) { salta('meta'); continue }

    const ts = Date.parse(String(e['timestamp'] ?? '')) || 0
    const uuid = String(e['uuid'] ?? '')

    if (tipo === 'system') {
      if (e['subtype'] === 'compact_boundary') {
        const pre = e['compactMetadata']?.['preTokens'] ?? e['compact_metadata']?.['pre_tokens']
        push({ k: 'context.compacted', before: typeof pre === 'number' ? pre : 0, after: 0 }, ts)
      } else salta('system:' + String(e['subtype'] ?? '?'))
      continue
    }

    const contenuto = e['message']?.['content']

    if (tipo === 'user') {
      const blocchi = Array.isArray(contenuto) ? contenuto : []
      const risultati = blocchi.filter(b => b?.['type'] === 'tool_result')
      if (risultati.length > 0) {
        const rich = e['toolUseResult'] ?? e['tool_use_result'] ?? {}
        for (const r of risultati) {
          const callId = String(r['tool_use_id'] ?? '')
          const testo = flattenContent(r['content'])
          const errore = r['is_error'] === true
          const bloccato = classifyBlock(testo)
          push(bloccato
            ? { k: 'tool.ended', callId, ok: false, error: testo }
            : { k: 'tool.ended', callId, ok: !errore, ...(errore ? { error: testo } : { output: testo }) }, ts)
          if (bloccato) { push({ k: 'action.blocked', by: bloccato, callId, reason: testo }, ts); continue }
          if (errore) continue
          const call = nomiTool.get(callId)
          if (!call) continue
          const eff = toolEffect(call.name, call.input, rich, callId)
          if (eff) push(eff, ts)
        }
        continue
      }
      // Un vero prompt dell'utente: e qui che comincia un turno.
      let testo = (typeof contenuto === 'string' ? contenuto : flattenContent(contenuto))
        .replace(INIETTATO, '').trim()
      if (!testo) { salta('utente vuoto'); continue }

      const uscita = USCITA.exec(testo)
      if (uscita) {
        const corpo = (uscita[2] ?? '').trim()
        if (corpo) push({ k: 'notice', level: 'info', text: corpo }, ts)
        salta('uscita di comando')
        continue
      }
      const comando = COMANDO.exec(testo)
      if (comando) {
        const args = ARGOMENTI.exec(testo)?.[1]?.trim()
        testo = (comando[1] ?? '').trim() + (args ? ' ' + args : '')
        if (!testo) { salta('comando vuoto'); continue }
      }
      if (turnAperto) { push(chiusura(turni, uso), ts); uso = vuoto() }
      turni++
      push({ k: 'turn.started', turnId: `t${turni}`, prompt: [{ type: 'text', text: testo }] }, ts)
      turnAperto = true
      continue
    }

    if (tipo === 'assistant') {
      const blocchi = Array.isArray(contenuto) ? contenuto : []
      // Il costo in dollari non c'e nel trascritto e non serve: la risorsa scarsa e la
      // quota. I token invece ci sono, e sono l'unica misura onesta di quanto e costato
      // riaprire questa conversazione.
      somma(uso, e['message']?.['usage'])
      push({ k: 'step.started', stepId: uuid }, ts)
      blocchi.forEach((b, i) => {
        // §16.2 risolto meglio che dal vivo: il trascritto ha un uuid per messaggio,
        // quindi il partId e stabile anche riaprendo il file fra un anno.
        const partId = `${uuid}#${i}`
        const t = b?.['type']
        if (t === 'text' && typeof b['text'] === 'string') {
          push({ k: 'text.started', partId }, ts)
          push({ k: 'text.ended', partId, text: b['text'] }, ts)
          parti++
        } else if (t === 'thinking' && typeof b['thinking'] === 'string') {
          push({ k: 'reasoning.started', partId }, ts)
          push({ k: 'reasoning.delta', partId, delta: b['thinking'] }, ts)
          push({ k: 'reasoning.ended', partId }, ts)
          parti++
        } else if (t === 'tool_use') {
          const callId = String(b['id'] ?? partId)
          const name = String(b['name'] ?? '?')
          nomiTool.set(callId, { name, input: b['input'] ?? {} })
          push({ k: 'tool.started', callId, name }, ts)
          push({ k: 'tool.input.ended', callId, input: b['input'] ?? {} }, ts)
          parti++
        }
      })
      push({ k: 'step.ended', stepId: uuid, finish: 'stop', usage: vuoto() }, ts)
      continue
    }

    salta(tipo)
  }

  if (turnAperto) push(chiusura(turni, uso), events[events.length - 1]?.ts ?? 0)

  return { events, stats: { righe, saltate, turni, parti } }
}

function vuoto(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }

function somma(acc: Usage, u: unknown): void {
  const o = (u ?? {}) as Record<string, unknown>
  const n = (v: unknown): number => typeof v === 'number' ? v : 0
  acc.input += n(o['input_tokens'])
  acc.output += n(o['output_tokens'])
  acc.cacheRead += n(o['cache_read_input_tokens'])
  acc.cacheWrite += n(o['cache_creation_input_tokens'])
}

function chiusura(turno: number, uso: Usage): Payload {
  return { k: 'turn.ended', turnId: `t${turno}`, reason: 'completed',
    usage: { ...uso }, cost: { nominalUsd: 0 } }
}
