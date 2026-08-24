// Il registro delle sessioni: ciclo di vita, journal, e chi sta guardando.
//
// Regola che governa tutto il file: **prima il disco, poi la UI**. Ogni evento passa
// dal journal e solo dopo raggiunge chi è collegato. Se si invertisse, un browser che
// si riaggancia dopo una caduta vedrebbe una storia diversa da quella su disco, e
// l'invariante del §4 smetterebbe di valere senza che nessuno se ne accorga.

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ClaudeCodeAdapter, type PermissionAnswer, type QuestionAnswer } from '../adapters/claude-code/adapter.ts'
import { Journal, RawLog } from '../core/journal.ts'
import { applyTo, reduce, type SessionSnapshot } from '../core/reduce.ts'
import type { AgentQuestion, CanonicalEvent, Command, PermissionMode } from '../core/events.ts'

export type OpenSpec = {
  cwd: string
  model?: string
  mode?: PermissionMode
  resume?: { ref: string; fork?: boolean }
  askTools?: string[]
}

export type SessionRow = {
  id: string
  /** Il primo prompt dell'utente, che è come si riconosce una conversazione. Il titolo
   *  scritto dal modello si somiglia sempre; la prima frase scritta da te no. */
  title: string
  state: string
  cwd?: string
  model?: string
  turns: number
  lastSeq: number
  lastTs: number
  live: boolean
}

type Pending =
  | { kind: 'permission'; resolve: (a: PermissionAnswer) => void }
  | { kind: 'question'; resolve: (a: QuestionAnswer) => void }

type Live = {
  id: string
  adapter: ClaudeCodeAdapter
  journal: Journal
  snapshot: SessionSnapshot
  watchers: Set<(e: CanonicalEvent) => void>
  pending: Map<string, Pending>
}

/** §16.3: nell'MVP il prompt è testo semplice, quindi basta concatenare le parti. */
function titleOf(s: SessionSnapshot): string {
  const parts = s.turns[0]?.prompt ?? []
  const text = parts.map(x => x.text).join(' ').trim().replace(/\s+/g, ' ')
  if (!text) return `sessione ${s.sessionId.slice(0, 8)}`
  return text.length > 64 ? `${text.slice(0, 63)}…` : text
}

export const STARK_HOME = process.env['STARK_HOME'] ?? resolve(homedir(), '.stark')
const SESSIONS = resolve(STARK_HOME, 'sessioni')

export class Registry {
  private readonly live = new Map<string, Live>()
  private readonly defaults: { model: string; mode: PermissionMode; configDir?: string }

  constructor(defaults: { model?: string; mode?: PermissionMode; configDir?: string } = {}) {
    this.defaults = {
      model: defaults.model ?? 'claude-sonnet-5',
      mode: defaults.mode ?? 'auto',
      ...(defaults.configDir ? { configDir: defaults.configDir } : {}),
    }
  }

  async open(spec: OpenSpec): Promise<string> {
    // Riprendere una conversazione riusa il suo id, così il journal continua invece di
    // biforcarsi. Un fork invece è una sessione nuova, e deve avere un journal nuovo.
    const id = spec.resume && !spec.resume.fork ? spec.resume.ref : randomUUID()
    if (this.live.has(id)) return id

    const journal = new Journal(resolve(SESSIONS, `${id}.jsonl`), id)
    const raw = new RawLog(resolve(SESSIONS, `${id}.raw.jsonl`))
    const snapshot = reduce(Journal.read(journal.path), id)
    const pending = new Map<string, Pending>()
    const watchers = new Set<(e: CanonicalEvent) => void>()
    const startFrom = journal.lastSeq

    const entry: Live = { id, adapter: null as never, journal, snapshot, watchers, pending }

    const adapter = new ClaudeCodeAdapter({
      cwd: spec.cwd,
      model: spec.model ?? this.defaults.model,
      mode: spec.mode ?? this.defaults.mode,
      ...(this.defaults.configDir ? { configDir: this.defaults.configDir } : {}),
      ...(spec.resume ? { resume: spec.resume } : { sessionId: id }),
      ...(spec.askTools?.length ? { askTools: spec.askTools } : {}),
      onRaw: m => raw.write(JSON.stringify(m)),
      onPayload: p => {
        const e = journal.append(p)      // prima il disco
        applyTo(snapshot, e)
        for (const w of watchers) w(e)   // poi chi guarda
      },
      // Una richiesta resta appesa finché l'utente non risponde, e va bene così: la
      // callback può restare pendente all'infinito. È il motivo per cui la UI deve
      // mostrare `awaiting` in modo inequivocabile — lì non succede più niente.
      onPermission: r => new Promise<PermissionAnswer>(res => {
        pending.set(r.requestId, { kind: 'permission', resolve: res })
      }),
      onQuestion: r => new Promise<QuestionAnswer>(res => {
        pending.set(r.requestId, { kind: 'question', resolve: res })
      }),
    })
    entry.adapter = adapter
    this.live.set(id, entry)

    try {
      await adapter.start()
      if (spec.resume) {
        const e = journal.append({ k: 'session.woke', resumedFromSeq: startFrom })
        applyTo(snapshot, e)
        for (const w of watchers) w(e)
      }
    } catch (err) {
      this.live.delete(id)
      journal.close()
      throw err
    }
    return id
  }

  list(): SessionRow[] {
    const rows = new Map<string, SessionRow>()
    if (existsSync(SESSIONS)) {
      for (const f of readdirSync(SESSIONS)) {
        if (!f.endsWith('.jsonl') || f.endsWith('.raw.jsonl')) continue
        const id = f.replace(/\.jsonl$/, '')
        const s = reduce(Journal.read(resolve(SESSIONS, f)), id)
        rows.set(id, {
          id, title: titleOf(s), state: s.state, turns: s.turns.length,
          lastSeq: s.lastSeq, lastTs: s.lastTs, live: false,
          ...(s.cwd ? { cwd: s.cwd } : {}), ...(s.model ? { model: s.model } : {}),
        })
      }
    }
    for (const [id, l] of this.live) {
      rows.set(id, {
        id, title: titleOf(l.snapshot), state: l.snapshot.state,
        turns: l.snapshot.turns.length,
        lastSeq: l.snapshot.lastSeq, lastTs: l.snapshot.lastTs, live: true,
        ...(l.snapshot.cwd ? { cwd: l.snapshot.cwd } : {}),
        ...(l.snapshot.model ? { model: l.snapshot.model } : {}),
      })
    }
    return [...rows.values()]
  }

  /** Rilettura dal journal: è la stessa cosa che fa un risveglio. */
  events(id: string, from = 0): CanonicalEvent[] {
    const path = resolve(SESSIONS, `${id}.jsonl`)
    return Journal.read(path).filter(e => e.seq > from)
  }

  snapshot(id: string): SessionSnapshot | null {
    const l = this.live.get(id)
    if (l) return l.snapshot
    const path = resolve(SESSIONS, `${id}.jsonl`)
    return existsSync(path) ? reduce(Journal.read(path), id) : null
  }

  /**
   * Chi si collega riceve prima ciò che si è perso, poi il flusso. Il travaso avviene
   * senza cedere il controllo: se si aspettasse qualcosa in mezzo, un evento nuovo
   * potrebbe infilarsi fra la storia e il flusso e arrivare due volte, o mai.
   */
  subscribe(id: string, from: number, send: (e: CanonicalEvent) => void): () => void {
    for (const e of this.events(id, from)) send(e)
    const l = this.live.get(id)
    if (!l) return () => {}
    l.watchers.add(send)
    return () => { l.watchers.delete(send) }
  }

  async command(id: string, cmd: Command): Promise<{ ok: true } | { ok: false; error: string }> {
    const l = this.live.get(id)
    if (!l) return { ok: false, error: 'sessione non attiva' }
    switch (cmd.c) {
      case 'session.prompt':
        l.adapter.prompt(cmd.text)
        return { ok: true }
      case 'session.interrupt':
        await l.adapter.interrupt()
        return { ok: true }
      case 'session.setModel':
        await l.adapter.setModel(cmd.model)
        return { ok: true }
      case 'session.setMode':
        await l.adapter.setMode(cmd.mode)
        return { ok: true }
      case 'session.sleep': {
        // Addormentarsi con un turno in corso perderebbe il lavoro in volo: si
        // interrompe prima, invece di rifiutare e lasciare l'utente senza una via.
        if (l.snapshot.state === 'busy') await l.adapter.interrupt()
        await l.adapter.sleep()
        this.retire(id)
        return { ok: true }
      }
      case 'session.close':
        await l.adapter.close()
        this.retire(id)
        return { ok: true }
      case 'permission.reply': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'permission') return { ok: false, error: 'richiesta sconosciuta' }
        l.pending.delete(cmd.requestId)
        p.resolve(cmd.decision === 'reject'
          ? { allow: false, reason: 'Negato dall\'utente' }
          : { allow: true })
        return { ok: true }
      }
      case 'question.reply': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'question') return { ok: false, error: 'domanda sconosciuta' }
        l.pending.delete(cmd.requestId)
        p.resolve({ answers: cmd.answers, ...(cmd.response !== undefined ? { response: cmd.response } : {}) })
        return { ok: true }
      }
      case 'question.reject': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'question') return { ok: false, error: 'domanda sconosciuta' }
        l.pending.delete(cmd.requestId)
        // `null` non è "nessuna risposta": è l'utente che ha chiuso la card, ed è una
        // risposta vera. L'agent la riceve come rifiuto e può cambiare strada.
        p.resolve(null)
        return { ok: true }
      }
      default:
        return { ok: false, error: `comando non gestito: ${cmd.c}` }
    }
  }

  pendingQuestions(id: string): { requestId: string; questions: AgentQuestion[] }[] {
    return this.live.get(id)?.snapshot.pendingQuestions ?? []
  }

  private retire(id: string): void {
    const l = this.live.get(id)
    if (!l) return
    l.journal.close()
    l.watchers.clear()
    this.live.delete(id)
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.live.keys()].map(async id => {
      const l = this.live.get(id)
      if (!l) return
      try { await l.adapter.close() } catch { /* il processo è già andato */ }
      this.retire(id)
    }))
  }
}
