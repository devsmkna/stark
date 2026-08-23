// Prova del risveglio (ADR-005, seconda meta).
//
// La fetta verticale dimostrava che lo stato si ricostruisce dal journal. Qui si
// dimostra la cosa diversa e piu difficile: che il MODELLO si ricorda. Sono due
// memorie separate — il journal di STARK serve alla UI, il trascritto dell'agent
// serve al modello — e un risveglio che ne ripristina una sola sembra funzionare
// finche l'utente non fa una domanda che dipende da cio che si era detto prima.
//
// I prompt sono minuscoli di proposito: la risorsa scarsa e la quota.

import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.ts'
import { Journal } from '../core/journal.ts'
import { applyTo, reduce, type SessionSnapshot } from '../core/reduce.ts'
import type { PermissionMode } from '../core/events.ts'

const MODEL = process.env['STARK_MODEL'] ?? 'claude-sonnet-5'
const MODE = (process.env['STARK_MODE'] ?? 'auto') as PermissionMode
const SECRET = '4271'

const ROOT = resolve(import.meta.dirname, '../..')
const SANDBOX = resolve(ROOT, 'spike/sandbox/resume')
rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })

const sessionId = randomUUID()
const JOURNAL = resolve(SANDBOX, `${sessionId}.jsonl`)

async function run(
  label: string,
  resume: { ref: string; fork?: boolean } | undefined,
  prompt: string,
): Promise<SessionSnapshot> {
  const journal = new Journal(JOURNAL, sessionId)
  const state = reduce(Journal.read(JOURNAL), sessionId)
  const startFrom = journal.lastSeq
  let done: (() => void) | null = null
  const finished = new Promise<void>(res => { done = res })

  const adapter = new ClaudeCodeAdapter({
    cwd: SANDBOX, model: MODEL, mode: MODE,
    ...(resume ? { resume } : { sessionId }),
    onPayload: p => {
      applyTo(state, journal.append(p))
      if (p.k === 'turn.ended') done?.()
    },
  })

  await adapter.start()
  if (resume) applyTo(state, journal.append({ k: 'session.woke', resumedFromSeq: startFrom }))
  adapter.prompt(prompt)
  await finished
  await adapter.sleep()
  journal.close()

  const text = state.turns[state.turns.length - 1]?.parts
    .filter(p => p.kind === 'text').map(p => (p as { text: string }).text).join(' ') ?? ''
  console.log(`\n[${label}] seq ${startFrom + 1}..${state.lastSeq} · risposta: ${text.trim().slice(0, 120)}`)
  return state
}

console.log(`risveglio — modello ${MODEL}, modalita ${MODE}\njournal ${JOURNAL}\n`)

const first = await run('sessione 1', undefined,
  `Ricorda questo numero e basta, rispondi solo "ok": ${SECRET}`)
const ref = first.resumeRef
console.log(`riferimento per il risveglio: ${ref ?? 'NESSUNO'}`)
if (!ref) { console.log('\nESITO: il journal non contiene di che risvegliare.'); process.exit(1) }

const second = await run('sessione 2 (risvegliata)', { ref },
  'Che numero ti ho chiesto di ricordare? Rispondi solo con il numero.')

// ─── verifiche ──────────────────────────────────────────────────────────────

const events = Journal.read(JOURNAL)
const seqs = events.map(e => e.seq)
const contiguous = seqs.every((n, i) => n === i + 1)
const lastText = second.turns[second.turns.length - 1]?.parts
  .filter(p => p.kind === 'text').map(p => (p as { text: string }).text).join(' ') ?? ''
const remembered = lastText.includes(SECRET)
const woke = events.some(e => e.payload.k === 'session.woke')
const singleFile = reduce(events, sessionId)

console.log('\n──── esito ────')
console.log(`${contiguous ? 'OK  ' : 'ROTT'} seq contigui su tutto il journal (${seqs.length} eventi, un solo file)`)
console.log(`${remembered ? 'OK  ' : 'ROTT'} il modello ricorda cio che era stato detto prima del risveglio`)
console.log(`${woke ? 'OK  ' : 'ROTT'} il risveglio e registrato come evento`)
console.log(`${singleFile.turns.length === 2 ? 'OK  ' : 'ROTT'} i due turni stanno nella stessa sessione ricostruita (${singleFile.turns.length})`)
console.log(`costo nominale totale $${singleFile.cost.nominalUsd.toFixed(4)}`)
process.exitCode = contiguous && remembered && woke ? 0 : 1
