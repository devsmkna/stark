// Chi lancia `git` quando un turno finisce? Le domande di STARK, o il CLI da sé?
// Costa **un turno cortissimo**: serve come controllo positivo, se no un log vuoto
// non distingue «non lancia niente» da «strace non si è agganciato».
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'
import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const opts = buildOptions({ cwd: '/root/DevsMachna/stark', mode: 'auto' }) as Record<string, unknown>
let manda: (t: string) => void = () => {}
async function* filo(): AsyncGenerator<Record<string, unknown>> {
  const coda: Record<string, unknown>[] = []
  let sveglia: (() => void) | null = null
  manda = (text: string) => {
    coda.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null, session_id: '' })
    sveglia?.()
  }
  for (;;) {
    while (coda.length) yield coda.shift()!
    await new Promise<void>(r => { sveglia = r })
  }
}
const q = query({ prompt: filo(), options: opts as never })
await q.supportedModels?.()
// Il figlio di QUESTO processo, non «un claude qualunque»: `pgrep -f` pescava anche
// le sessioni vive dell'utente e i transienti già morti — da cui l'«attach: No such
// process» che rendeva vuoto il log senza che si vedesse il perché.
const figli = (padre: number): number[] => {
  try { return execSync(`pgrep -P ${padre}`).toString().trim().split('\n').filter(Boolean).map(Number) }
  catch { return [] }
}
const discendenti = (radice: number): number[] => {
  const out: number[] = []; const coda = [radice]
  while (coda.length) { const c = coda.shift()!; for (const f of figli(c)) { out.push(f); coda.push(f) } }
  return out
}
const cand = discendenti(process.pid)
  .filter(x => { try { return execSync(`readlink /proc/${x}/exe || true`).toString().includes('claude') } catch { return false } })
const pid = cand[0] ?? 0
if (!pid) { console.error('nessun processo claude figlio trovato:', discendenti(process.pid)); process.exit(1) }

const log = '/tmp/execve.log'; writeFileSync(log, '')
const err = '/tmp/strace-err.log'; writeFileSync(err, '')
const fd = (await import('node:fs')).openSync(err, 'w')
const tracer = spawn('strace', ['-f', '-e', 'trace=execve', '-p', String(pid), '-o', log],
  { stdio: ['ignore', 'ignore', fd] })
await new Promise(r => setTimeout(r, 2000))
console.log('claude pid', pid, '· strace dice:', readFileSync(err, 'utf8').trim().split('\n')[0] ?? '(niente)')

const visti = (): string[] => readFileSync(log, 'utf8').split('\n')
  .filter(l => l.includes('execve('))
  .map(l => (/execve\("([^"]+)"/.exec(l)?.[1] ?? '').split('/').pop() ?? '').filter(Boolean)

let t0 = 0
manda('Reply with exactly: OK')
for await (const m of q) {
  const k = (m as { type?: string }).type
  if (k === 'result') { t0 = Date.now(); console.log('turno finito. Durante il turno:', JSON.stringify(visti())); break }
}
await new Promise(r => setTimeout(r, 6000))
console.log(`+6s dopo la fine del turno:`, JSON.stringify(visti()))
tracer.kill('SIGTERM')
process.exit(0)
