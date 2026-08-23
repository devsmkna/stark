// Apre in STARK una conversazione nata nella CLI.
//
// Il journal NON finisce nel repo: contiene la conversazione intera, quindi vive in
// ~/.stark/sessioni, che sta fuori da git per costruzione e non per una riga di
// .gitignore che qualcuno puo cancellare.

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { statSync } from 'node:fs'
import { importTranscript } from '../adapters/claude-code/import.ts'
import { Journal } from '../core/journal.ts'
import { reduce } from '../core/reduce.ts'

const trascritto = process.argv[2]
if (!trascritto) {
  console.error('uso: node src/cli/import-check.ts <percorso-trascritto.jsonl>')
  process.exit(2)
}
const sessionId = trascritto.split('/').pop()!.replace(/\.jsonl$/, '')
const HOME = process.env['STARK_HOME'] ?? resolve(homedir(), '.stark')
const dest = resolve(HOME, 'sessioni', `${sessionId}.jsonl`)

const t0 = Date.now()
const { events, stats } = importTranscript(trascritto)
const letto = Date.now() - t0

const journal = new Journal(dest, sessionId)
if (journal.lastSeq > 0) {
  console.error(`journal gia presente con ${journal.lastSeq} eventi: non lo tocco.`)
  console.error(`cancellalo a mano se vuoi reimportare: ${dest}`)
  process.exit(1)
}
journal.append({ k: 'session.resumeRef', ref: sessionId }, events[0]?.ts ?? Date.now())
for (const { payload, ts } of events) journal.append(payload, ts)
journal.close()

const s = reduce(Journal.read(dest), sessionId)
const parti = s.turns.reduce((n, t) => n + t.parts.length, 0)
const tokens = s.turns.reduce((n, t) => n + (t.usage?.output ?? 0), 0)

console.log(`importato in ${letto} ms`)
console.log(`origine   ${trascritto} (${(statSync(trascritto).size / 1048576).toFixed(2)} MB, ${stats.righe} righe)`)
console.log(`journal   ${dest} (${(statSync(dest).size / 1048576).toFixed(2)} MB, ${s.lastSeq} eventi)`)
console.log(`\nturni ${s.turns.length} · parti ${parti} · file toccati ${s.files.length} · comandi ${s.shell.length}`)
console.log(`token in uscita nella conversazione: ${tokens.toLocaleString('it-IT')}`)
console.log(`\nrighe scartate: ${Object.entries(stats.saltate).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log('\nprimi turni:')
for (const t of s.turns.slice(0, 3)) {
  const p = t.prompt[0]?.text.replace(/\s+/g, ' ').slice(0, 70) ?? ''
  console.log(`  "${p}…" -> ${t.parts.length} parti`)
}
console.log('\nultimo turno:')
const ultimo = s.turns[s.turns.length - 1]
console.log(`  "${ultimo?.prompt[0]?.text.replace(/\s+/g, ' ').slice(0, 70) ?? ''}…" -> ${ultimo?.parts.length} parti`)
