// Il classificatore di `auto` mode consuma quota del piano? (§16.6, mai misurato)
//
// Nell'usage della sessione non si vede: misurato prima, differenza di 30 token su
// 83.000 fra `auto` e `default`, cioe' rumore. Quindi si guarda dall'altra parte — le
// finestre del **piano** prima e dopo lo stesso identico lavoro, nelle due modalita'.
// La sessione va tenuta viva (prompt in streaming) perche' a turno chiuso il trasporto
// e' gia' andato e la domanda sulla quota non parte piu'.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'

const METODO = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
const PROMPT = 'Esegui questi comandi con Bash, uno per volta, e non scrivere altro: '
  + '`echo a`, `echo b`, `echo c`, `echo d`, `echo e`, `echo f`, `echo g`, `echo h`.'

type Piatto = Record<string, number>

async function finestre(q: unknown): Promise<Piatto> {
  const m = (q as Record<string, unknown>)[METODO]
  if (typeof m !== 'function') return {}
  const u = await (m as () => Promise<Record<string, unknown>>).call(q)
  const rl = (u?.['rate_limits'] ?? {}) as Record<string, unknown>
  const out: Piatto = {}
  for (const [k, v] of Object.entries(rl)) {
    const o = v as Record<string, unknown> | null
    if (o && typeof o['utilization'] === 'number') out[k] = o['utilization']
  }
  for (const s of (rl['model_scoped'] as unknown[]) ?? []) {
    const o = s as Record<string, unknown>
    if (typeof o['utilization'] === 'number') out[`scoped:${String(o['display_name'])}`] = o['utilization']
  }
  return out
}

async function giro(mode: string): Promise<{ prima: Piatto; dopo: Piatto; tool: number; tok: number }> {
  let manda: (t: string) => void = () => {}
  let chiudi: () => void = () => {}
  const input = (async function* () {
    const coda: unknown[] = []
    let sveglia: (() => void) | null = null
    let fine = false
    manda = (t: string) => {
      coda.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: t }] },
        parent_tool_use_id: null, session_id: '' })
      sveglia?.()
    }
    chiudi = () => { fine = true; sveglia?.() }
    for (;;) {
      while (coda.length) yield coda.shift() as never
      if (fine) return
      await new Promise<void>(r => { sveglia = r })
    }
  })()
  const q = query({ prompt: input, options: { cwd: '/tmp', permissionMode: mode,
    canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }) } as unknown as Options })
  await q.initializationResult()
  const prima = await finestre(q)
  manda(PROMPT)
  let tool = 0, tok = 0
  // La quota si chiede **dentro** il ciclo, appena arriva il risultato: uscire da un
  // `for await` con `break` chiama `return()` sull'iteratore, e l'SDK lo interpreta
  // come «chiudi tutto» — dopo, il trasporto non accetta piu' domande.
  let dopo: Piatto = {}
  for await (const m of q) {
    const msg = m as Record<string, unknown>
    if (msg['type'] === 'assistant') {
      const c = ((msg['message'] as Record<string, unknown>)?.['content'] ?? []) as { type?: string }[]
      tool += c.filter(x => x.type === 'tool_use').length
    }
    if (msg['type'] === 'result') {
      const u = (msg['usage'] ?? {}) as Record<string, number>
      tok = (u['input_tokens'] ?? 0) + (u['output_tokens'] ?? 0)
        + (u['cache_read_input_tokens'] ?? 0) + (u['cache_creation_input_tokens'] ?? 0)
      dopo = await finestre(q)
      break
    }
  }
  chiudi()
  try { await q.interrupt?.() } catch { /* sta chiudendo */ }
  return { prima, dopo, tool, tok }
}

const esiti: Record<string, { prima: Piatto; dopo: Piatto; tool: number; tok: number }> = {}
for (const mode of ['auto', 'default']) esiti[mode] = await giro(mode)

console.log('\nOK  finestre del piano, prima -> dopo (utilization grezza)\n')
for (const [mode, e] of Object.entries(esiti)) {
  console.log(`OK  ── ${mode} ──  ${e.tool} tool, ${e.tok} token di sessione`)
  for (const k of [...new Set([...Object.keys(e.prima), ...Object.keys(e.dopo)])].sort()) {
    const a = e.prima[k], b = e.dopo[k]
    const d = (b ?? 0) - (a ?? 0)
    console.log(`OK    ${k.padEnd(22)} ${String(a ?? '-').padStart(9)} -> ${String(b ?? '-').padStart(9)}`
      + (Math.abs(d) > 1e-9 ? `   delta ${d > 0 ? '+' : ''}${d}` : '   (fermo)'))
  }
}
process.exit(0)
