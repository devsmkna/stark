import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'
const opts = buildOptions({ cwd: process.argv[2] ?? '/root/DevsMachna/stark', mode: 'auto' }) as Record<string, unknown>
async function* vuoto(): AsyncGenerator<never> { await new Promise(() => {}) }
const q = query({ prompt: vuoto(), options: opts as never })
const u = await q.getContextUsage?.() as { totalTokens?: number; categories?: {name:string;tokens:number}[] }
for (const c of (u?.categories ?? []).sort((a,b)=>b.tokens-a.tokens)) console.log(String(c.tokens).padStart(7), c.name)
console.log(String(u?.totalTokens).padStart(7), 'TOTALE')
process.exit(0)
