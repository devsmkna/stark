// Importare una conversazione nata nella TUI di OpenCode nel vocabolario canonico.
//
// ─── Perche' dal database e non dall'SDK, misurato il 30 agosto ──────────────
//
// Le rotte v2 della storia (`session.messages`, `session.history`) leggono
// l'archivio `session_message`, che su questa macchina e' vuoto anche per
// conversazioni con 151 messaggi: la via legacy con cui STARK fa girare i turni
// (ADR-015) e la TUI stessa non lo popolano. Chiedere all'SDK vorrebbe dire
// rispondere «zero conversazioni» a una domanda che ha 251 risposte.
//
// Le tabelle `session`, `message` e `part` hanno tutto, e `part.data` e' **la
// stessa forma** delle parti che arrivano sul filo dal vivo — `state` incluso.
// Leggerle in sola lettura e' cio' che l'adapter di Claude Code fa con i
// trascritti JSONL: l'archivio dell'agent, non un'interfaccia promessa. Se un
// giorno OpenCode esponesse la storia per rotta ufficiale, questo file e' il
// posto che si ritira (si misura prima, come sempre).
//
// ─── La forma, misurata ──────────────────────────────────────────────────────
//
//   session  {id, directory, title, time_created, time_updated, parent_id, ...}
//   message  {id, session_id, time_created, data: {role, model?, tokens?, cost?}}
//   part     {message_id, session_id, time_created, data: {type, ...}}
//
// La parte `data` dell'utente e' `{type:'text', text}`; quella dell'agent puo'
// essere `step-start`, `text`, `reasoning`, `tool` (con `state` concluso) e
// `step-finish`. Le capacita' del tool si riusano da `effects.ts`, le summary da
// `sommarioDi`: la stessa funzione del vivo, cosi' lo stesso fatto produce la
// stessa riga da qualunque strada arrivi.

import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import type {
  ConversationInfo, ImportedEvent, ImportStats,
} from '../../core/adapter.ts'
import type { Payload, Usage } from '../../core/events.ts'
import { AGENTI_NOTI, capacita, modelloDa } from './adapter.ts'
import { sommarioDi } from './translate.ts'
import { effettoTool } from './effects.ts'

/** Il database delle sessioni di OpenCode, dove lo mette lui. */
export function percorsoDb(): string {
  const base = process.env['XDG_DATA_HOME'] ?? resolve(homedir(), '.local/share')
  return resolve(base, 'opencode', 'opencode.db')
}

/**
 * Da quanto una conversazione dev'essere ferma perche' si possa dire che *non* e'
 * in corso in un terminale adesso. Stima, con la stessa soglia e la stessa ragione
 * del gemello Claude Code (`catalogue.ts`): sbagliare per eccesso costa una frase,
 * sbagliare per difetto non dice a qualcuno che sta per guidare la stessa
 * conversazione da due posti.
 */
export const RECENTE_MS = 5 * 60 * 1000

export function isRecent(info: ConversationInfo, now = Date.now()): boolean {
  return now - info.lastModified < RECENTE_MS
}

type RigaSessione = {
  id: string; directory: string; title: string | null
  time_created: number; time_updated: number
}

/** Il database c'e' e si apre? Senza, l'elenco e' vuoto: e' un fatto, non un errore. */
function apri(): DatabaseSync | null {
  const path = percorsoDb()
  if (!existsSync(path)) return null
  try { return new DatabaseSync(path, { readOnly: true }) } catch { return null }
}

/**
 * Le conversazioni nate fuori da STARK, dalla piu' recente.
 *
 * Ogni riga porta il `path` del database: per l'import quella e' la fonte vera,
 * e la UI usa proprio `path` per dire se una riga si puo' importare.
 */
export function elencoConversazioni(limit = 60): ConversationInfo[] {
  const db = apri()
  if (!db) return []
  try {
    const righe = db.prepare(
      'SELECT id, directory, title, time_created, time_updated FROM session '
      + 'ORDER BY time_updated DESC LIMIT ?',
    ).all(limit) as unknown as RigaSessione[]
    return righe.map(r => ({
      sessionId: r.id,
      title: r.title ?? r.id,
      cwd: r.directory || undefined,
      lastModified: r.time_updated,
      path: percorsoDb(),
      firstPrompt: primoPrompt(db, r.id),
    }))
  } finally { db.close() }
}

/** La prima frase scritta dall'utente: e' quella che fa dire «ah, e' quella». */
function primoPrompt(db: DatabaseSync, sessionId: string): string | undefined {
  const r = db.prepare(
    'SELECT p.data AS data FROM part p JOIN message m ON p.message_id = m.id '
    + "WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'user' "
    + "AND json_extract(p.data, '$.type') = 'text' "
    + 'ORDER BY m.time_created, p.time_created LIMIT 1',
  ).get(sessionId) as { data?: string } | undefined
  if (!r?.data) return undefined
  try { return String((JSON.parse(r.data) as { text?: unknown }).text ?? '') || undefined }
  catch { return undefined }
}

/** La conversazione con questo id, se il database la ha. Il `ref` e' l'id stesso. */
export function trovaConversazione(sessionId: string): { ref: string } | undefined {
  const db = apri()
  if (!db) return undefined
  try {
    const r = db.prepare('SELECT id FROM session WHERE id = ?').get(sessionId)
    return r ? { ref: sessionId } : undefined
  } finally { db.close() }
}

/**
 * Una conversazione della TUI, tradotta per intero.
 *
 * Come il gemello Claude Code NON e' lo stesso formato dello stream dal vivo: nel
 * database le parti sono gia' concluse, senza delta, e i turni non ci sono — si
 * aprono sul messaggio dell'utente e si chiudono sul prossimo, che e' come li
 * aprirebbe chiunque leggesse la conversazione da capo.
 */
export function importaConversazione(ref: string): { events: ImportedEvent[]; stats: ImportStats } {
  const events: ImportedEvent[] = []
  const saltate: Record<string, number> = {}
  const salta = (motivo: string): void => { saltate[motivo] = (saltate[motivo] ?? 0) + 1 }
  const push = (payload: Payload, ts: number): void => { events.push({ payload, ts }) }

  const db = apri()
  if (!db) return { events: [], stats: { righe: 0, saltate: { 'database assente': 1 }, turni: 0, parti: 0 } }
  try {
    const ses = db.prepare(
      'SELECT id, directory, title, time_created FROM session WHERE id = ?',
    ).get(ref) as unknown as RigaSessione | undefined
    if (!ses) {
      return { events: [], stats: { righe: 0, saltate: { 'sessione assente': 1 }, turni: 0, parti: 0 } }
    }

    const messaggi = db.prepare(
      'SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, rowid',
    ).all(ref) as unknown as Array<{ id: string; data: string; time_created: number }>
    const parti = db.prepare(
      'SELECT message_id, data, time_created FROM part WHERE session_id = ? ORDER BY time_created, rowid',
    ).all(ref) as unknown as Array<{ message_id: string; data: string; time_created: number }>

    let righe = messaggi.length + parti.length
    let turni = 0
    let contatoriParti = 0
    let model: string | undefined
    let cwd = ses.directory || undefined
    let turnoAperto: { id: string; uso: Usage; costo: number } | null = null

    /** Il payload di chiusura di un turno: pura, perche' le closure che assegnano
     *  rendono il flusso illeggibile a TypeScript (e a chi legge). */
    const chiusuraDi = (t: { id: string; uso: Usage; costo: number }): Payload => ({
      k: 'turn.ended', turnId: t.id, reason: 'completed',
      usage: { ...t.uso }, cost: { nominalUsd: t.costo },
    })

    for (const m of messaggi) {
      let data: Record<string, unknown>
      try { data = JSON.parse(m.data) as Record<string, unknown> } catch { salta('messaggio illeggibile'); continue }
      const ruolo = String(data['role'] ?? '')
      const sue = parti.filter(p => p.message_id === m.id)

      if (ruolo === 'user') {
        const testo = sue.map(p => testoDi(p.data)).filter(Boolean).join('\n').trim()
        if (!testo) { salta('utente vuoto'); continue }
        // Il turno nuovo apre chiudendo quello prima, se c'e': nella conversazione
        // e' cio' che l'occhio fa gia' leggendo — un cambio di parlante.
        if (turnoAperto) { push(chiusuraDi(turnoAperto), m.time_created); turnoAperto = null }
        turni++
        push({ k: 'turn.started', turnId: m.id, prompt: [{ type: 'text', text: testo }] }, m.time_created)
        turnoAperto = { id: m.id, uso: vuoto(), costo: 0 }
        continue
      }

      if (ruolo !== 'assistant') { salta(`ruolo ${ruolo || '?'}`); continue }
      if (!turnoAperto) { salta('assistant senza turno'); continue }

      // Il modello lo dichiara il messaggio in **due forme**, misurate: annidato
      // (`model: {providerID, modelID}`, dalle sessioni nate via STARK) o piatto
      // (`modelID` e `providerID` accanto alle altre chiavi, dalla TUI). Una forma
      // sola lascerebbe il modello vuoto su meta' delle conversazioni.
      if (!model) {
        model = modelloDa(data['model']) || undefined
        if (!model && typeof data['modelID'] === 'string' && data['modelID']) {
          const prov = String(data['providerID'] ?? '')
          model = prov ? `${prov}/${data['modelID']}` : String(data['modelID'])
        }
      }
      const uso = usoDa(data['tokens'])
      turnoAperto.uso.input += uso.input
      turnoAperto.uso.output += uso.output
      turnoAperto.uso.cacheRead += uso.cacheRead
      turnoAperto.uso.cacheWrite += uso.cacheWrite
      turnoAperto.costo += typeof data['cost'] === 'number' ? data['cost'] : 0

      push({ k: 'step.started', stepId: m.id }, m.time_created)
      for (const p of sue) {
        let parte: Record<string, unknown>
        try { parte = JSON.parse(p.data) as Record<string, unknown> } catch { salta('parte illeggibile'); continue }
        const tipo = String(parte['type'] ?? '')
        const ts = p.time_created || m.time_created

        if (tipo === 'text' && typeof parte['text'] === 'string') {
          push({ k: 'text.started', partId: p.message_id + '#t' }, ts)
          push({ k: 'text.ended', partId: p.message_id + '#t', text: parte['text'] }, ts)
          contatoriParti++
        } else if (tipo === 'reasoning' && typeof parte['text'] === 'string') {
          push({ k: 'reasoning.started', partId: p.message_id + '#r' }, ts)
          push({ k: 'reasoning.delta', partId: p.message_id + '#r', delta: parte['text'] }, ts)
          push({ k: 'reasoning.ended', partId: p.message_id + '#r' }, ts)
          contatoriParti++
        } else if (tipo === 'tool') {
          const nome = String(parte['tool'] ?? '?')
          const callId = String(parte['callID'] ?? p.message_id)
          const stato = (parte['state'] ?? {}) as Record<string, unknown>
          const input = (stato['input'] ?? {}) as Record<string, unknown>
          const sommario = sommarioDi(nome, input)
          push({ k: 'tool.started', callId, name: nome }, ts)
          push({
            k: 'tool.input.ended', callId, input,
            ...(sommario !== undefined ? { summary: sommario } : {}),
          }, ts)
          const fallito = String((stato as { status?: unknown })['status'] ?? '') === 'error'
          push(fallito
            ? { k: 'tool.ended', callId, ok: false, error: String(stato['error'] ?? 'il tool e\' fallito') }
            : { k: 'tool.ended', callId, ok: true, output: stato['output'] ?? (stato['metadata'] ?? {}) }, ts)
          const eff = fallito ? null : effettoTool(nome, stato)
          if (eff) push(eff, ts)
          contatoriParti++
        } else if (tipo === 'step-start' || tipo === 'step-finish') {
          // Il passo lo apre e lo chiude il messaggio stesso: le due parti non
          // aggiungono niente che qui non si sia gia' detto.
          salta(tipo)
        } else {
          salta(`parte ${tipo || '?'}`)
        }
      }
      push({ k: 'step.ended', stepId: m.id, finish: 'stop', usage: vuoto() }, m.time_created)
    }
    if (turnoAperto) push(chiusuraDi(turnoAperto), messaggi.at(-1)?.time_created ?? ses.time_created)

    // La nascita va in testa, e si scrive **dopo** aver letto tutto: cartella e
    // modello si scoprono strada facendo. Senza, lo snapshot ricostruito non
    // saprebbe ne dove gira la conversazione ne con che modello — e la UI
    // mostrerebbe una chat senza progetto, che e' il modo piu' veloce di
    // perderla di vista.
    const primo = events[0]?.ts ?? ses.time_created
    events.unshift({
      payload: {
        k: 'session.created', agent: 'opencode', cwd: cwd ?? '',
        model: model ?? '', capabilities: capacita(),
        tools: [], commands: [], models: [],
        modes: AGENTI_NOTI.map(a => ({ mode: a.nome, label: a.nome, available: true, note: a.descrizione })),
      },
      ts: primo,
    })
    if (ses.title) push({ k: 'session.renamed', title: ses.title }, primo + 1)
    // Nessun processo dietro questa copia: la conversazione e' completa e
    // aspetta un prompt nuovo. Risvegliarla esiste gia' — `session.resumeRef`
    // lo scrive il registro, e l'adapter riaggancia la sessione per id.
    push({ k: 'session.state', state: 'idle' }, events.at(-1)?.ts ?? primo)

    return {
      events,
      stats: { righe, saltate, turni, parti: contatoriParti, ...(cwd ? { cwd } : {}), ...(model ? { model } : {}) },
    }
  } finally { db.close() }
}

/** Il testo di una parte, se e' testo. */
function testoDi(data: string): string {
  try {
    const p = JSON.parse(data) as { type?: string; text?: unknown }
    return p['type'] === 'text' && typeof p['text'] === 'string' ? p['text'] : ''
  } catch { return '' }
}

function vuoto(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }

/** I token di un messaggio nel nostro vocabolario. Stessa conversione del vivo
 *  (`usoDa` in translate.ts): anche qui i token di ragionamento restano fuori,
 *  perche' sommarli all'output sarebbe una scelta silenziosa. */
function usoDa(t: unknown): Usage {
  const o = (t ?? {}) as Record<string, unknown>
  const cache = (o['cache'] ?? {}) as Record<string, unknown>
  const n = (v: unknown): number => typeof v === 'number' ? v : 0
  return { input: n(o['input']), output: n(o['output']), cacheRead: n(cache['read']), cacheWrite: n(cache['write']) }
}
