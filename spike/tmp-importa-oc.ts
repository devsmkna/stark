// L'import di OpenCode, verificato sul database vero dell'utente: elenco,
// traduzione e riduzione in snapshot — cioe' quello che vedrebbe la UI.
//   node spike/tmp-importa-oc.ts
import {
  elencoConversazioni, importaConversazione, isRecent, trovaConversazione,
} from '../src/adapters/opencode/import.ts'
import { reduce } from '../src/core/reduce.ts'

const elenco = elencoConversazioni(15)
console.log(`elenco: ${elenco.length} conversazioni, le prime 5:`)
for (const r of elenco.slice(0, 5)) {
  const min = Math.round((Date.now() - r.lastModified) / 60000)
  console.log(`  ${r.sessionId.slice(0, 14)} «${String(r.title).slice(0, 44)}»`
    + ` · ${r.cwd} · ${min}min fa · recent=${isRecent(r)}`
    + `\n    prima frase: «${String(r.firstPrompt ?? '—').slice(0, 60)}»`)
}
console.log(`di Claude Code nell'elenco: ${elenco.filter(r => r.sessionId.length === 36).length} (uuid) · di OpenCode: ${elenco.filter(r => r.sessionId.startsWith('ses_')).length}`)

// Una conversazione TUI vera, quella lunga: 151 messaggi.
const tui = elenco.find(r => String(r.title).includes('Uniformare stile model picker'))
if (!tui) { console.log('non trovo la conversazione TUI di prova'); process.exit(1) }
console.log(`\nimporto «${tui.title}» (${tui.sessionId})`)

const { events, stats } = importaConversazione(trovaConversazione(tui.sessionId)!.ref)
console.log('statistiche:', JSON.stringify(stats))

const canonici = events.map(({ payload, ts }, i) => ({
  v: 1 as const, seq: i + 1, ts, sessionId: tui.sessionId, payload,
}))
const snap = reduce(canonici, tui.sessionId)
const perTurno = snap.turns.map(t => ({
  prompt: String((t.prompt ?? []).map(p => ('text' in p ? p.text : '')).join('')).slice(0, 50),
  parti: (t.parts ?? []).length,
  testo: (t.parts ?? []).map(p => (p.kind === 'text' ? p.text : '')).join('').trim().slice(0, 60),
  ended: t.ended ?? false,
}))
console.log(`snapshot: ${snap.turns.length} turni · ${snap.files.length} file · ${snap.shell.length} comandi · stato=${snap.state} · modello=${snap.model} · cwd=${snap.cwd}`)
console.log('i primi 3 turni:', JSON.stringify(perTurno.slice(0, 3), null, 1))
console.log('gli ultimi 2:', JSON.stringify(perTurno.slice(-2), null, 1))
console.log('turni aperti:', perTurno.filter(t => !t.ended).length)
console.log('file toccati:', [...new Set(snap.files.map(f => f.path))].slice(0, 6))
console.log('comandi (primi 4):', snap.shell.slice(0, 4).map(c => c.command.slice(0, 50)))
