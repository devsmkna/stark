// Cosa sta facendo adesso, letto dallo snapshot.
//
// Sta in `core/` e non nella UI perché serve in **due** posti che devono dire la stessa
// cosa: il blocco sopra la casella di scrittura, e la riga dell'elenco — che il daemon
// calcola per conto di tutte le sessioni, anche quelle che non stai guardando. Due
// implementazioni della stessa frase divergerebbero al primo caso limite.
//
// Non decide parole né icone: torna il fatto canonico, e a vestirlo è la UI. Il nome del
// tool è vocabolario dell'agent e viaggia così com'è: chi lo riceve sceglie un segno da
// disegnare e nient'altro (`ui/src/lib/view.ts`).

import type { SessionSnapshot } from './reduce.ts'

export type Activity =
  /** Un tool aperto: è il caso normale, ed è quello che si vuole leggere. */
  | { kind: 'tool'; name: string; summary?: string; from: number }
  /** Sta scrivendo la risposta. */
  | { kind: 'writing'; from: number }
  /** Sta ragionando. */
  | { kind: 'thinking'; from: number }
  /** C'è un turno aperto ma niente di riconoscibile dentro: succede all'inizio. */
  | { kind: 'working'; from: number }

/**
 * Si legge **a ritroso** dall'ultima parte, perché l'operazione in corso è l'ultima
 * aperta: scorrere in avanti darebbe la prima, che è quasi sempre già finita.
 *
 * Quando non c'è un tool aperto l'agent sta scrivendo o pensando, e allora il tempo che
 * conta è quello del turno — l'unico che il journal sappia dire.
 */
export function activity(s: SessionSnapshot): Activity | null {
  const t = s.turns[s.turns.length - 1]
  if (!t || t.ended) return null
  for (let i = t.parts.length - 1; i >= 0; i--) {
    const p = t.parts[i]!
    if (p.kind === 'tool' && !p.done) {
      return {
        kind: 'tool', name: p.name, from: p.startedAt,
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
      }
    }
    if (p.kind === 'text' && p.open) return { kind: 'writing', from: t.startedAt }
    if (p.kind === 'reasoning' && p.open) return { kind: 'thinking', from: t.startedAt }
  }
  return { kind: 'working', from: t.startedAt }
}
