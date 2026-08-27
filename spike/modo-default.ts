// Qual e' la modalita' permessi della CLI quando NON gliela si dice?
//
// La domanda che conta: STARK apre in `auto` (ADR-008), e `auto` usa un classificatore,
// che e' un modello, che costa quota. Se la CLI nuda aprisse in un'altra modalita',
// STARK costerebbe di piu' del CLI a parita' di lavoro — che e' esattamente cio' che
// non deve succedere. Costo di questa prova: zero. E' solo l'handshake.
import { query } from '@anthropic-ai/claude-agent-sdk'

async function chiedi(etichetta: string, opts: Record<string, unknown>): Promise<void> {
  const q = query({ prompt: (async function* () {})(), options: { cwd: '/tmp', ...opts } as never })
  try {
    const info = await q.initializationResult() as Record<string, unknown>
    console.log(`  ${etichetta.padEnd(26)} -> ${String(info['current_permission_mode'] ?? '(non dichiarata)')}`)
  } catch (e) {
    console.log(`  ${etichetta.padEnd(26)} -> errore: ${String((e as Error).message ?? e).slice(0, 60)}`)
  } finally {
    try { await q.interrupt?.() } catch { /* sta gia' morendo */ }
  }
}

console.log('modalita\' che il CLI riporta nell\'handshake:\n')
await chiedi('senza dirgli niente', {})
await chiedi('chiedendo auto (STARK)', { permissionMode: 'auto' })
await chiedi('chiedendo default', { permissionMode: 'default' })
process.exit(0)
