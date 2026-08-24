// Le traduzioni fra lo stato canonico e ciò che si vede: i tre gruppi della barra
// laterale, l'etichetta di stato, il progetto e il suo colore.
//
// Sta qui e non dentro i componenti perché sono decisioni di prodotto scritte in
// docs/ui-schermate.md, non dettagli di disegno: se cambiano, cambiano in un posto.

import type { SessionState } from '$core/events.ts'
import type { SessionRow } from './api.ts'

export type Group = 'Waiting' | 'Working' | 'Sleeping'
export type Label = 'asking' | 'done' | 'stopped' | 'working' | 'sleeping'

/**
 * Tre gruppi, non quattro: **finito non vuol dire chiuso**. Una sessione che ha
 * risposto e non ha più niente da fare sta aspettando un prompt nuovo, quindi sta
 * in Waiting insieme a chi aspetta un permesso. È l'utente a decidere quando un
 * lavoro è concluso, non l'agent smettendo di parlare.
 */
export function group(state: SessionState | string): Group {
  switch (state) {
    case 'sleeping': return 'Sleeping'
    case 'busy':
    case 'starting': return 'Working'
    default: return 'Waiting'
  }
}

export function label(state: SessionState | string, lastTurnAborted = false): Label {
  switch (state) {
    case 'sleeping': return 'sleeping'
    case 'busy':
    case 'starting': return 'working'
    case 'awaiting': return 'asking'
    case 'error':
    case 'closed': return 'stopped'
    default: return lastTurnAborted ? 'stopped' : 'done'
  }
}

/**
 * Il pallino dice **tocca a te**, non «non letto»: non sparisce aprendo la chat,
 * sparisce quando la chat riprende a lavorare. Sotto questa regola coincide con
 * l'essere in Waiting, ed è voluto — la sezione è un'intestazione che scorre via,
 * il pallino viaggia con la riga.
 */
export const needsYou = (state: SessionState | string): boolean => group(state) === 'Waiting'

export const ORDER: Group[] = ['Waiting', 'Working', 'Sleeping']

/** Il progetto è l'ultimo pezzo della cartella. Niente di più: è ciò che si legge. */
export function project(cwd: string | undefined): string {
  if (!cwd) return 'senza cartella'
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

/**
 * Un progetto ha **un colore solo**, in qualunque gruppo compaia. Assegnati in ordine
 * alfabetico e non di apparizione: l'ordine di apparizione cambia a ogni avvio, e un
 * colore che cambia da solo non identifica più niente.
 * Oltre il settimo si ripetono — è una domanda ancora aperta, vedi ui-schermate.md.
 */
export function colours(rows: SessionRow[]): Map<string, number> {
  const names = [...new Set(rows.map(r => project(r.cwd)))].sort()
  return new Map(names.map((n, i) => [n, i % 7]))
}

export function hhmm(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return time
  const yesterday = new Date(today.getTime() - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return `ieri ${time}`
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${time}`
}

