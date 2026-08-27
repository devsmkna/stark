// Un turno, come si legge su Telegram.
//
// Funzione pura da `SessionSnapshot` a stringa: è la parte che si prova senza un bot,
// senza rete e senza quota — e siccome quello che produce finisce dentro un
// `editMessageText` ripetuto molte volte in un turno, deve anche essere **stabile**:
// se il testo non cambia, non si manda niente, e quello è ciò che tiene il bot dentro i
// limiti di Telegram.
//
// Non ricostruisce niente per conto suo: legge lo snapshot che il registro tiene con lo
// stesso `applyTo` del daemon (§4). Il riassunto e la motivazione di un tool arrivano
// **già pronti** da `adapters/claude-code/summary.ts` — qui non si guarda mai dentro
// `input`, che sarebbe far uscire dall'adapter il vocabolario di Claude Code.

import type { TurnView } from '../../core/reduce.ts'
import { escapa } from './testo.ts'

/** Quante righe di operazioni si mostrano. Sopra, si conta e basta. */
const RIGHE = 8

export function turno(t: TurnView): string {
  const testa = intestazione(t)
  const righe = operazioni(t)
  const detto = risposta(t)
  return [testa, righe, detto].filter(s => s !== '').join('\n')
}

function intestazione(t: TurnView): string {
  const chiesto = t.prompt.map(p => (p.type === 'text' ? p.text : '🖼')).join(' ').trim()
  const capo = t.ended ? esito(t) : '▶'
  const durata = t.ended && t.endedAt ? ` · ${Math.round((t.endedAt - t.startedAt) / 1000)}s` : ''
  return `${capo} <b>${escapa(taglia(chiesto, 120))}</b>${durata}`
}

function esito(t: TurnView): string {
  if (t.reason === 'aborted') return '⏹'
  if (t.reason === 'interrupted') return '⚠'
  if (t.reason === 'error') return '✗'
  return '✓'
}

/**
 * Una riga per operazione, le ultime `RIGHE`. Quando l'agent ha scritto una motivazione
 * è **quella** a fare da riga («cerco chi lo usa») e il riassunto va a destra in
 * monospace: è la stessa scelta della UI, e per la stessa ragione — il comando esatto
 * resta raggiungibile, ma non è quello che si legge scorrendo.
 */
function operazioni(t: TurnView): string {
  const tool = t.parts.filter((p): p is Extract<typeof p, { kind: 'tool' }> => p.kind === 'tool')
  if (tool.length === 0) return ''
  const mostrati = tool.slice(-RIGHE)
  const prima = tool.length - mostrati.length
  const righe = mostrati.map(p => {
    const segno = p.blocked ? '⊘' : !p.done ? '⏳' : p.ok === false ? '✗' : '·'
    const testa = p.intent ?? p.summary ?? p.name
    const coda = p.intent && p.summary ? ` <code>${escapa(taglia(p.summary, 60))}</code>` : ''
    return `${segno} ${escapa(taglia(testa, 70))}${coda}`
  })
  if (prima > 0) righe.unshift(`<i>+${prima} prima</i>`)
  return righe.join('\n')
}

/**
 * La coda della risposta a parole, non tutta: un messaggio di Telegram sta in 4096
 * caratteri e il senso di seguire dal vivo è vedere **dove è arrivato**, non rileggere
 * dall'inizio. Chi vuole tutto apre STARK.
 */
function risposta(t: TurnView): string {
  const testi = t.parts.filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text')
  const ultimo = testi[testi.length - 1]
  if (!ultimo || ultimo.text.trim() === '') return ''
  const s = ultimo.text.trim()
  const coda = s.length > 1200 ? `…${s.slice(-1200)}` : s
  return `\n${escapa(coda)}`
}

function taglia(s: string, n: number): string {
  const pulita = s.replace(/\s+/g, ' ').trim()
  return pulita.length <= n ? pulita : `${pulita.slice(0, n - 1)}…`
}
