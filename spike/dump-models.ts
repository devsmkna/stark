import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'
const q = query({
  prompt: (async function* () { await new Promise(() => {}) })() as never,
  options: buildOptions({ cwd: tmpdir(), model: 'default', mode: 'default' }) as never,
})
try {
  const info = await q.initializationResult() as Record<string, unknown>
  console.log('CHIAVI init:', Object.keys(info).join(' '))
  console.log(JSON.stringify(info['models'], null, 2))
  console.log('capabilities:', JSON.stringify(info['capabilities']))
} finally { await q.return(undefined as never).catch(() => {}) }
