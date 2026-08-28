// Tre cose che STARK non nomina da nessuna parte, misurate su sessioni vere.
//
// 1. PIANO. `plan` è una delle modalità che la barra di stato offre, ma
//    `ExitPlanMode` non compare in `src/` né in `ui/src/`. Domanda: quando l'agent
//    ha finito di pianificare, cosa arriva? Passa da `canUseTool` come un permesso
//    qualunque (e allora il piano — markdown lungo — finisce in una card disegnata
//    per «posso eseguire questo comando?»), o non arriva affatto?
// 2. TODO. `TodoWrite` è il pezzo più visibile della TUI e in STARK è una riga di
//    tool come le altre. Domanda: che forma ha l'input, e arriva a ogni
//    aggiornamento o una volta sola?
// 3. SUB-AGENT. `translate.ts` smista sul solo `type` e non guarda mai
//    `parent_tool_use_id`. Domanda: il lavoro di un subagent `Task` arriva? E se
//    arriva, è distinguibile da quello dell'agent principale o si mescola nel turno?
//
// Costa quota: sono due turni veri. Va rifatta a ogni salto di versione del CLI.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../src/adapters/claude-code/adapter.ts'
import type { PermissionMode, Payload } from '../src/core/events.ts'

const MODEL = process.env['STARK_MODEL'] ?? 'claude-sonnet-5'
const SANDBOX = resolve(import.meta.dirname, 'sandbox/piano')

rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })
// Qualcosa di vero da leggere: un piano su una cartella vuota non è un piano.
writeFileSync(resolve(SANDBOX, 'note.txt'), 'alfa\nbeta\ngamma\n')
writeFileSync(resolve(SANDBOX, 'altre.txt'), 'delta\n')
writeFileSync(resolve(SANDBOX, 'conti.ts'), `
export function somma(a: number, b: number): number { return a + b }
export function meno(a: number, b: number): number { return a - b }
`.trimStart())

type Osservazione = {
  /** I `type` dei messaggi nativi, con quante volte ciascuno. */
  tipi: Record<string, number>
  /** Quanti messaggi nativi portavano `parent_tool_use_id` valorizzato. */
  conParent: number
  /** I `parent_tool_use_id` distinti visti. */
  parents: Set<string>
  /** I nomi dei tool che l'agent ha chiesto, in ordine di prima comparsa. */
  tool: string[]
  /** Le chiamate a `canUseTool`, cioè cosa sarebbe diventato una card in STARK. */
  permessi: { toolName: string; chiavi: string[] }[]
  /** Gli input completi di TodoWrite e ExitPlanMode: sono la forma da disegnare. */
  campioni: { tool: string; input: unknown }[]
  /** I payload canonici prodotti, per `k`. */
  canonici: Record<string, number>
}

function vuota(): Osservazione {
  return {
    tipi: {}, conParent: 0, parents: new Set(), tool: [],
    permessi: [], campioni: [], canonici: {},
  }
}

/** Guarda dentro un messaggio nativo senza pretendere di conoscerne la forma. */
function osserva(o: Osservazione, m: unknown): void {
  const msg = m as Record<string, unknown>
  const t = String(msg['type'] ?? '?')
  o.tipi[t] = (o.tipi[t] ?? 0) + 1
  const parent = msg['parent_tool_use_id']
  if (typeof parent === 'string' && parent) { o.conParent += 1; o.parents.add(parent) }

  // I tool_use stanno dentro `message.content` (messaggio intero) oppure dentro
  // `event.content_block` (streaming). Si guardano entrambi: non sapere quale delle
  // due forme arrivi è metà della domanda.
  const blocchi: unknown[] = []
  const inner = msg['message'] as Record<string, unknown> | undefined
  if (Array.isArray(inner?.['content'])) blocchi.push(...(inner['content'] as unknown[]))
  const ev = msg['event'] as Record<string, unknown> | undefined
  if (ev?.['content_block']) blocchi.push(ev['content_block'])

  for (const b of blocchi) {
    const blk = b as Record<string, unknown>
    if (blk['type'] !== 'tool_use') continue
    const nome = String(blk['name'] ?? '?')
    if (!o.tool.includes(nome)) o.tool.push(nome)
    if ((nome === 'TodoWrite' || nome === 'ExitPlanMode') && blk['input']
      && Object.keys(blk['input'] as object).length > 0) {
      o.campioni.push({ tool: nome, input: blk['input'] })
    }
  }
}

async function giro(
  etichetta: string, mode: PermissionMode, prompt: string,
): Promise<Osservazione> {
  const o = vuota()
  const sessionId = randomUUID()
  let fine: (() => void) | null = null
  const finito = new Promise<void>(res => { fine = res })

  const adapter = new ClaudeCodeAdapter({
    cwd: SANDBOX,
    model: MODEL,
    mode,
    // Vuoto = zero card in `auto` (ADR-008). Quello che arriva comunque a
    // `onPermission` è la risposta alla domanda 1: è ciò che il classificatore NON
    // risolve da sé, cioè ciò che in STARK diventa per forza una card.
    askTools: [],
    onRaw: m => osserva(o, m),
    onPermission: async ({ toolName, input }) => {
      o.permessi.push({ toolName, chiavi: Object.keys(input) })
      if (toolName === 'ExitPlanMode' || toolName === 'TodoWrite') {
        o.campioni.push({ tool: `${toolName} (via canUseTool)`, input })
      }
      // Si consente: la domanda è *cosa arriva*, non cosa succede dopo un rifiuto.
      return { allow: true }
    },
    onQuestion: async ({ questions }) => {
      const answers: Record<string, string> = {}
      for (const q of questions) answers[q.question] = q.options[0]?.label ?? ''
      return { answers }
    },
    onPayload: (p: Payload) => {
      o.canonici[p.k] = (o.canonici[p.k] ?? 0) + 1
      if (p.k === 'turn.ended') fine?.()
    },
  })

  console.log(`\n─── ${etichetta} (mode: ${mode}) ───`)
  console.log(`prompt: ${prompt.slice(0, 100)}…`)
  // Ogni attesa ha il suo tetto, separatamente. Il primo giro di questa sonda è
  // rimasto appeso dieci minuti in **chiusura**, dopo che il turno era finito: senza
  // tetti separati non si sarebbe saputo quale delle tre attese fosse quella bloccata,
  // e l'unica cosa raccolta sarebbe stata «Terminated».
  const entro = <T>(p: Promise<T>, ms: number, che: string): Promise<T | null> =>
    Promise.race([
      p.catch(e => { console.log(`  (${che}: ${String((e as Error).message ?? e).slice(0, 60)})`); return null }),
      new Promise<null>(r => setTimeout(() => { console.log(`  (${che}: scaduto dopo ${ms / 1000}s)`); r(null) }, ms)),
    ])
  await entro(adapter.start(), 60_000, 'avvio')
  adapter.prompt(prompt)
  await entro(finito, 240_000, 'turno')
  console.log('  turno chiuso, chiudo la sessione')
  await entro(adapter.close(), 15_000, 'chiusura')
  void sessionId
  return o
}

function stampa(o: Osservazione): void {
  console.log(`  tipi nativi   : ${Object.entries(o.tipi).map(([k, n]) => `${k}×${n}`).join(' ')}`)
  console.log(`  con parent_tool_use_id: ${o.conParent} messaggi, ${o.parents.size} genitori distinti`)
  console.log(`  tool chiesti  : ${o.tool.join(', ') || '(nessuno)'}`)
  console.log(`  canUseTool    : ${o.permessi.length === 0 ? '(mai chiamata)'
    : o.permessi.map(p => `${p.toolName}{${p.chiavi.join(',')}}`).join(' ')}`)
  const interessanti = ['tool.started', 'tool.ended', 'text.started', 'permission.requested',
    'action.blocked', 'turn.ended', 'notice']
  console.log(`  canonici      : ${interessanti
    .filter(k => o.canonici[k]).map(k => `${k}×${o.canonici[k]}`).join(' ')}`)
  for (const c of o.campioni.slice(0, 4)) {
    console.log(`\n  ── input di ${c.tool}:`)
    console.log(JSON.stringify(c.input, null, 2).split('\n').slice(0, 24)
      .map(l => `     ${l}`).join('\n'))
  }
}

// ─── 1 e 2: il piano, e i todo lungo la strada ──────────────────────────────

const piano = await giro(
  'PIANO + TODO', 'plan',
  'Leggi conti.ts e proponi un piano in tre passi per aggiungerci una funzione '
  + 'moltiplica, con i suoi test. Non scrivere codice adesso: fai solo il piano.',
)
stampa(piano)

// ─── 3: il subagent ─────────────────────────────────────────────────────────

const sub = await giro(
  'SUB-AGENT', 'auto',
  'Usa il tool Task per lanciare un subagent che conti quante righe totali '
  + 'contengono i file .txt di questa cartella. Riporta solo il numero finale.',
)
stampa(sub)

// ─── verdetto ───────────────────────────────────────────────────────────────

console.log('\n═══ verdetto ═══')
const exitPlan = piano.tool.includes('ExitPlanMode')
  || piano.permessi.some(p => p.toolName === 'ExitPlanMode')
console.log(`1. ExitPlanMode arriva?        ${exitPlan ? 'SÌ' : 'NO'}`
  + `${piano.permessi.some(p => p.toolName === 'ExitPlanMode')
    ? ' — e passa da canUseTool, cioè in STARK diventa una card di permesso' : ''}`)
console.log(`2. TodoWrite arriva?           ${
  piano.tool.includes('TodoWrite') || sub.tool.includes('TodoWrite') ? 'SÌ' : 'NO'}`)
console.log(`3. Il subagent è distinguibile? ${sub.conParent > 0
  ? `SÌ — ${sub.conParent} messaggi con parent_tool_use_id (${sub.parents.size} genitori)`
  : 'NO — nessun messaggio porta parent_tool_use_id'}`)
console.log(`   (tool visti nel giro subagent: ${sub.tool.join(', ') || 'nessuno'})`)

process.exit(0)
