// Quanto costa risvegliare una conversazione? (P16, mai misurato per davvero)
//
// La paura scritta in ADR-005: «risvegliare rilegge tutto il contesto, quindi costa
// quota». Vero, ma **come** lo rilegge? Se la storia arriva come `input_tokens` nuovi si
// paga piena; se arriva come `cache_read_input_tokens` costa una frazione. E' la
// differenza fra «lo Sleep e' caro» e «lo Sleep e' quasi gratis», e non era mai stata
// guardata.
//
// STARK risveglia con `--resume`, che e' esattamente cio' che fa `claude --resume` dal
// terminale: qualunque sia il numero, e' lo stesso numero del CLI.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'

type U = { input: number; out: number; cacheR: number; cacheW: number }
const zero = (): U => ({ input: 0, out: 0, cacheR: 0, cacheW: 0 })
const tot = (u: U): number => u.input + u.out + u.cacheR + u.cacheW

async function turno(opts: Record<string, unknown>, testo: string): Promise<U> {
  const q = query({ prompt: testo, options: { cwd: '/tmp', permissionMode: 'default',
    canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }), ...opts } as unknown as Options })
  const u = zero()
  for await (const m of q) {
    const msg = m as Record<string, unknown>
    if (msg['type'] === 'result') {
      const r = (msg['usage'] ?? {}) as Record<string, number>
      u.input = r['input_tokens'] ?? 0; u.out = r['output_tokens'] ?? 0
      u.cacheR = r['cache_read_input_tokens'] ?? 0; u.cacheW = r['cache_creation_input_tokens'] ?? 0
    }
  }
  return u
}

const id = randomUUID()
console.log(`OK sessione ${id.slice(0, 8)}`)

// Due turni per costruire un po' di storia. Il secondo continua il primo.
const t1 = await turno({ sessionId: id }, 'Ricorda questo numero: 4271. Rispondi solo «ok».')
console.log(`OK turno 1 (nuova)      input ${t1.input}  cache-r ${t1.cacheR}  cache-w ${t1.cacheW}  out ${t1.out}  tot ${tot(t1)}`)
const t2 = await turno({ resume: id }, 'Scrivi una frase qualunque di venti parole.')
console.log(`OK turno 2 (subito)     input ${t2.input}  cache-r ${t2.cacheR}  cache-w ${t2.cacheW}  out ${t2.out}  tot ${tot(t2)}`)

// Il risveglio: stessa sessione, ripresa da zero come farebbe STARK dopo uno Sleep.
const t3 = await turno({ resume: id }, 'Che numero ti avevo chiesto di ricordare? Rispondi col solo numero.')
console.log(`OK turno 3 (RISVEGLIO)  input ${t3.input}  cache-r ${t3.cacheR}  cache-w ${t3.cacheW}  out ${t3.out}  tot ${tot(t3)}`)
console.log(`OK`)
console.log(`OK La storia al risveglio arriva come: ${t3.cacheR > t3.input ? 'CACHE (a sconto)' : 'INPUT NUOVO (prezzo pieno)'}`)
console.log(`OK   input nuovo ${t3.input} contro cache letta ${t3.cacheR}`)
process.exit(0)
