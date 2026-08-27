// Il risveglio a cache FREDDA: e' il caso vero dello Sleep, che non dura trenta secondi.
// Stessa sessione, ripresa dopo un'attesa piu' lunga della TTL della cache dei prompt.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'

const ATTESA_S = Number(process.argv[2] ?? 420)

async function turno(opts: Record<string, unknown>, testo: string): Promise<Record<string, number>> {
  const q = query({ prompt: testo, options: { cwd: '/tmp', permissionMode: 'default',
    canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }), ...opts } as unknown as Options })
  let u: Record<string, number> = {}
  for await (const m of q) {
    const msg = m as Record<string, unknown>
    if (msg['type'] === 'result') u = (msg['usage'] ?? {}) as Record<string, number>
  }
  return u
}
const r = (u: Record<string, number>): string =>
  `input ${u['input_tokens'] ?? 0}  cache-r ${u['cache_read_input_tokens'] ?? 0}  `
  + `cache-w ${u['cache_creation_input_tokens'] ?? 0}  out ${u['output_tokens'] ?? 0}`

const id = randomUUID()
console.log(`OK sessione ${id.slice(0, 8)}, attesa ${ATTESA_S}s`)
console.log(`OK turno 1           ${r(await turno({ sessionId: id }, 'Ricorda il numero 4271. Rispondi solo «ok».'))}`)
console.log(`OK turno 2 (caldo)   ${r(await turno({ resume: id }, 'Scrivi una frase di venti parole.'))}`)
console.log(`OK attendo ${ATTESA_S}s perche la cache scada...`)
await new Promise(res => setTimeout(res, ATTESA_S * 1000))
console.log(`OK turno 3 (FREDDO)  ${r(await turno({ resume: id }, 'Che numero ti avevo chiesto? Rispondi col solo numero.'))}`)
process.exit(0)
