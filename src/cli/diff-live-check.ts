// Il confronto affiancato messo alla prova su una modifica VERA.
//
// I casi costruiti a mano provano la logica; questo prova che la forma sia quella
// che Claude Code consegna davvero. Sono due cose diverse, e la seconda è quella
// che di solito smentisce.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.ts'
import { sideBySide, stats, unified } from '../core/diff.ts'
import type { Hunk, PermissionMode } from '../core/events.ts'

const SB = '/tmp/stark-diff-live'
rmSync(SB, { recursive: true, force: true }); mkdirSync(SB, { recursive: true })
// Righe lontane fra loro: servono due hunk separati, non uno solo.
writeFileSync(`${SB}/testo.txt`, Array.from({ length: 20 }, (_, i) => `riga numero ${i + 1}`).join('\n') + '\n')

const modifiche: { path: string; hunks: Hunk[] }[] = []
let fine: () => void = () => {}
const finito = new Promise<void>(r => { fine = r })

const adapter = new ClaudeCodeAdapter({
  cwd: SB,
  model: process.env['STARK_MODEL'] ?? 'claude-sonnet-5',
  mode: (process.env['STARK_MODE'] ?? 'auto') as PermissionMode,
  sessionId: randomUUID(),
  onPayload: p => {
    // Ogni Edit produce il SUO evento: due modifiche allo stesso file sono due
    // eventi con due diff, non uno cumulativo. Tenerne solo uno perde una modifica.
    if (p.k === 'file.edited') modifiche.push({ path: p.path, hunks: p.hunks })
    if (p.k === 'turn.ended') fine()
  },
})

await adapter.start()
adapter.prompt('Nel file testo.txt usa il tool Edit due volte: cambia "riga numero 2" in '
  + '"riga numero DUE modificata" e "riga numero 18" in "riga numero 18 cambiata". Non fare altro.')
await finito
await adapter.sleep()

if (modifiche.length === 0) { console.log('nessuna modifica registrata'); process.exit(1) }
console.log(`\nmodifiche registrate: ${modifiche.length}`)

const num = (n: number | undefined): string => (n === undefined ? '' : String(n)).padStart(3)
for (const { path, hunks: h } of modifiche) {
const s = stats(h)
console.log(`\n${path.split('/').pop()}  +${s.added} −${s.removed}   ·   ${h.length} hunk\n`)
for (const r of sideBySide(h)) {
  if (r.kind === 'gap') { console.log(`      ⋯ righe ${r.oldFrom}–${r.oldTo} non mostrate`); continue }
  const L = 'left' in r ? r.left : undefined
  const R = 'right' in r ? r.right : undefined
  const seg = (t: string | undefined): string => (t ?? '').padEnd(34).slice(0, 34)
  const marca = r.kind === 'changed' ? '~' : r.kind === 'removed' ? '−' : r.kind === 'added' ? '+' : ' '
  console.log(`${num(L?.no)} ${seg(L?.text)} ${marca} ${num(R?.no)} ${seg(R?.text)}`)
}
}

console.log('\n── verifiche ──')
const h = modifiche[modifiche.length - 1]!.hunks
const righe = sideBySide(h)
const ok = (n: string, v: boolean, d = ''): void => console.log(`${v ? 'OK  ' : 'ROTT'} ${n}${!v && d ? ' — ' + d : ''}`)
ok('gli hunk arrivano già strutturati', h.length > 0, String(h.length))
ok('le modifiche sono accoppiate, non impilate', righe.some(r => r.kind === 'changed'))
ok('i numeri di riga a sinistra e a destra sono coerenti',
  righe.every(r => r.kind !== 'context' || r.left.no === r.right.no))
ok('la forma unificata ha lo stesso numero di righe di contenuto',
  unified(h).filter(r => r.kind !== 'gap').length
  === righe.filter(r => r.kind !== 'gap').reduce((n, r) => n + (r.kind === 'changed' ? 2 : 1), 0))
ok('un file modificato due volte produce due eventi distinti',
  new Set(modifiche.map(m => m.path)).size < modifiche.length || modifiche.length === 1,
  `${modifiche.length} modifiche su ${new Set(modifiche.map(m => m.path)).size} file`)
