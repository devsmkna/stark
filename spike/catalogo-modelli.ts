// Elencare i modelli senza aprire una conversazione: si puo', e cosa lascia dietro.
//
// Perche' questa sonda esiste. Il selettore dell'helper (§17) deve offrire i modelli di
// **tutti** gli agent della macchina, compresi quelli su cui non sta girando niente —
// se no si potrebbe cambiare modello ma non agent, che e' meta' della domanda. Per
// Claude Code i modelli arrivano dall'handshake (`list_models`), quindi elencarli vuol
// dire far partire il CLI e fermarlo subito.
//
// Il rischio non e' la quota (l'handshake non ne consuma) ma il **residuo**: STARK ha
// gia' pagato una volta il prezzo delle chat fantasma, e una sessione aperta e buttata
// potrebbe lasciare un trascritto in `<profilo>/projects/`, che e' esattamente cio' che
// la schermata di import elenca. Sarebbe un fantasma nuovo, dalla porta accanto.
//
// Quindi si contano i trascritti prima e dopo. Se ne compare uno, questa strada non va
// bene cosi' com'e' e va trovata un'altra.
//
// Uso:  node spike/catalogo-modelli.ts

import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions, modelChoices, resolveModel } from '../src/adapters/claude-code/sdk-options.ts'

const PROFILO = process.env['CLAUDE_CONFIG_DIR'] ?? resolve(process.env['HOME'] ?? '/root', '.claude')
const PROGETTI = resolve(PROFILO, 'projects')

/** Tutti i file di trascritto sotto `projects/`, per nome completo. */
function trascritti(): Set<string> {
  const out = new Set<string>()
  if (!existsSync(PROGETTI)) return out
  for (const dir of readdirSync(PROGETTI)) {
    const d = resolve(PROGETTI, dir)
    try { for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) out.add(`${dir}/${f}`) } catch { /* non e' una cartella */ }
  }
  return out
}

const prima = trascritti()
console.log(`# profilo: ${PROFILO}`)
console.log(`# trascritti prima: ${prima.size}`)

const t0 = performance.now()
// Un flusso che non manda mai niente: vogliamo la stretta di mano, non una conversazione.
const muto = (async function* () { await new Promise<void>(() => {}) })()
const q = query({ prompt: muto, options: buildOptions({ cwd: tmpdir(), model: 'default', mode: 'default' }) })

let modelli: ReturnType<typeof modelChoices> = []
try {
  const info = (await q.initializationResult()) as Record<string, unknown>
  modelli = modelChoices(info['models'], resolveModel(info['models'], 'default'))
} finally {
  // `Query` e' un AsyncGenerator: `return()` lo chiude e porta giu' il processo figlio.
  await q.return(undefined as never)
}
const ms = Math.round(performance.now() - t0)

// Il trascritto, se nasce, puo' comparire con un attimo di ritardo rispetto alla morte
// del processo: aspettare mezzo secondo evita di dichiarare pulito qualcosa che non lo e'.
await new Promise(r => setTimeout(r, 500))
const dopo = trascritti()
const nuovi = [...dopo].filter(f => !prima.has(f))

let n = 0, ko = 0
const check = (nome: string, ok: boolean, extra = '') => {
  n++; if (!ok) ko++
  console.log(`${ok ? 'OK  ' : 'NO  '} ${nome}${extra ? ' · ' + extra : ''}`)
}

console.log(`\n# ${modelli.length} modelli in ${ms}ms:`)
for (const m of modelli.slice(0, 12)) {
  console.log(`  ${m.id.padEnd(26)} ${m.label ?? ''}${m.available === false ? '  (spento: ' + m.reason + ')' : ''}`)
}
console.log()

check('l\'handshake da\' i modelli senza mandare un prompt', modelli.length > 0, `${modelli.length}`)
check('c\'e\' il default dell\'account fra le voci', modelli.some(m => m.id === 'default'))
check('ogni voce ha un\'etichetta da mostrare', modelli.every(m => (m.label ?? '').length > 0))
check('NON lascia un trascritto fantasma', nuovi.length === 0, nuovi.join(', ') || 'nessuno')
check('costa poco: sotto i 15 secondi', ms < 15000, `${ms}ms`)

console.log(`\n${n - ko}/${n}`)
process.exit(ko === 0 ? 0 : 1)
