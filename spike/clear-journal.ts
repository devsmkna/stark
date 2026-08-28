// Un journal finto con un `/clear` in mezzo, per GUARDARE la conversazione a capitoli
// senza spendere quota. Non e' una prova: e' il modello da dare in pasto al daemon.
//
//   node spike/clear-journal.ts /tmp/finto/sessioni/<uuid>.jsonl

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Journal } from '../src/core/journal.ts'
import type { Payload } from '../src/core/events.ts'

const out = resolve(process.argv[2] ?? '/tmp/finto/sessioni/clear.jsonl')
mkdirSync(dirname(out), { recursive: true })
const j = new Journal(out, 'sess-clear')

let t = Date.parse('2026-08-26T14:02:00Z')
const at = (min: number): number => t + min * 60_000

const w = (p: Payload, ts: number): void => { j.append(p, ts) }

w({
  k: 'session.created', agent: 'claude-code', cwd: '/root/DevsMachna/stark',
  model: 'claude-sonnet-5', capabilities: { autoMode: true }, tools: ['Bash', 'Read', 'Edit'],
  commands: [{ name: 'clear', description: 'svuota il contesto' }],
}, at(0))
w({ k: 'session.mode', mode: 'auto' }, at(0))
w({ k: 'session.renamed', title: 'Capitoli e /clear' }, at(0))

let n = 0
function turno(prompt: string, testo: string | null, min: number, clear = false): void {
  const turnId = `t${++n}`
  w({ k: 'turn.started', turnId, prompt: [{ type: 'text', text: prompt }] }, at(min))
  if (testo !== null) {
    const partId = `${turnId}#0`
    w({ k: 'step.started', stepId: `s${n}` }, at(min))
    w({ k: 'text.started', partId }, at(min))
    w({ k: 'text.delta', partId, delta: testo }, at(min))
    w({ k: 'text.ended', partId, text: testo }, at(min))
    w({ k: 'step.ended', stepId: `s${n}` }, at(min))
  }
  if (clear) w({ k: 'context.cleared', ref: '31830557-adf7-41eb-b5e4-5eee4faf6d2a' }, at(min))
  w({ k: 'turn.ended', turnId, reason: 'completed' }, at(min + 1))
}

turno('spiegami come funziona il journal', 'Il journal è **append-only**: ogni evento canonico\nviene scritto prima di arrivare alla UI, quindi rileggerlo ricostruisce lo stesso stato.', 2)
turno('e il replay a cosa serve, in pratica?', 'A rendere lo Sleep possibile: la sessione si può chiudere e riaprire, e quello che vedi è ricostruito, non ricordato.', 6)
turno('ok, e se il contesto si riempie?', 'Si compatta: da lì in su il modello ha un riassunto, non i messaggi per intero. Se invece vuoi ripartire pulito, `/clear`.', 11)
turno('/clear', null, 16, true)
turno('elenca i file di src/core', 'Sono sei: `activity.ts`, `diff.ts`, `events.ts`, `journal.ts`, `reduce.ts`, `services.ts`.', 18)

w({ k: 'session.slept' }, at(20))
j.close()
console.log(`journal in ${out} — ${n} turni, il quarto azzera il contesto`)
