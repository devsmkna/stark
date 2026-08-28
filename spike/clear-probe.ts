// Sonda: cosa fa davvero `/clear` mandato come prompt all'SDK?
//
// Non si deduce dal nome. Tre turni minuscoli:
//   1) "ripeti BANANA"  -> mette una parola nel contesto
//   2) "/clear"         -> il comando in esame; si guarda cosa torna, grezzo
//   3) "che parola?"    -> se risponde BANANA, il contesto NON e' stato azzerato
//
// Costo: tre turni da poche decine di token. Il grezzo di ogni messaggio SDK
// finisce in spike/sandbox/clear-probe.raw.jsonl.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../src/adapters/claude-code/adapter.ts'
import type { CanonicalEvent } from '../src/core/events.ts'

const ROOT = resolve(import.meta.dirname, '..')
const SANDBOX = resolve(ROOT, 'spike/sandbox/clear-probe')
rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })

const rawLines: string[] = []
let onTurnEnd: (() => void) | null = null
const events: CanonicalEvent[] = []

const adapter = new ClaudeCodeAdapter({
  cwd: SANDBOX,
  model: process.env['STARK_MODEL'] ?? 'claude-sonnet-5',
  mode: 'auto',
  askTools: [],
  onRaw: m => rawLines.push(JSON.stringify(m)),
  onPermission: async () => ({ allow: true }),
  onQuestion: async ({ questions }) => ({
    answers: Object.fromEntries(questions.map(q => [q.question, q.options[0]?.label ?? ''])),
  }),
  onPayload: p => {
    events.push(p as unknown as CanonicalEvent)
    if (p.k === 'turn.ended') onTurnEnd?.()
  },
})

async function turn(text: string, label: string): Promise<void> {
  console.log(`\n\n──── ${label}: ${JSON.stringify(text)} ────`)
  const from = events.length
  const done = new Promise<void>(res => { onTurnEnd = res })
  adapter.prompt(text)
  await done
  for (const e of events.slice(from)) {
    const p = e as unknown as Record<string, unknown>
    const k = String(p['k'])
    if (k.endsWith('.delta')) { process.stdout.write('.'); continue }
    const extra =
      k === 'text.ended' ? ` — ${String(p['text'] ?? '').slice(0, 200)}` :
      k === 'turn.ended' ? ` — ${String(p['reason'])}` :
      k === 'notice' ? ` — ${String(p['text']).slice(0, 200)}` :
      k === 'context.usage' ? ` — ${JSON.stringify(p).slice(0, 200)}` :
      ''
    console.log(`\n  ${k}${extra}`)
  }
}

await adapter.start()
await turn('Rispondi con una sola parola: BANANA', '1 · semina')
await turn('/clear', '2 · il comando in esame')
await turn('Quale parola ti ho chiesto di dire nel messaggio precedente? Rispondi con quella parola sola, oppure NONLOSO se non lo sai.', '3 · verifica')
await adapter.sleep()

const rawPath = resolve(SANDBOX, 'clear-probe.raw.jsonl')
writeFileSync(rawPath, rawLines.join('\n'))
console.log(`\n\ngrezzo in ${rawPath} (${rawLines.length} messaggi)`)
