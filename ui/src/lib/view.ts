// Le traduzioni fra lo stato canonico e ciò che si vede: i tre gruppi della barra
// laterale, l'etichetta di stato, il progetto e il suo colore.
//
// Sta qui e non dentro i componenti perché sono decisioni di prodotto scritte in
// docs/ui-schermate.md, non dettagli di disegno: se cambiano, cambiano in un posto.

import type { Activity } from '$core/activity.ts'
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
  if (!cwd) return 'no folder'
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


// ─── la conversazione e il blocco in basso ──────────────────────────────────

/**
 * Che segno disegnare per un tool. Il nome è vocabolario dell'agent e questa mappa è
 * presentazione: decide un'icona e nient'altro. Nessuna logica dipende da questi nomi
 * — se ne arriva uno sconosciuto si prende il documento, e non si rompe niente.
 */
export function toolIcon(name: string): string {
  if (name.startsWith('mcp__')) return 'i-plug'
  if (name === 'Bash' || name === 'BashOutput' || name === 'KillShell') return 'i-term'
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') return 'i-brick'
  if (name === 'WebFetch' || name === 'WebSearch') return 'i-globe'
  if (name === 'Task' || name === 'Agent') return 'i-brain'
  return 'i-doc'
}

/** `3s`, `1m 12s`, `2h 04m`. Mai decimi: nessuno decide niente sui decimi. */
export function since(from: number, to: number): string {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * Come si legge «cosa sta facendo adesso». Il fatto lo calcola `core/activity.ts`,
 * perché serve identico al blocco in basso e alla riga dell'elenco — che il daemon
 * riempie per tutte le sessioni, comprese quelle che non stai guardando. Qui restano
 * solo le parole e il segno, che sono presentazione.
 */
export function activityText(a: Activity): string {
  switch (a.kind) {
    case 'tool': return a.summary ? `${a.name} · ${a.summary}` : a.name
    case 'writing': return 'writing the answer…'
    case 'thinking': return 'thinking…'
    default: return 'working…'
  }
}

export function activityIcon(a: Activity): string {
  switch (a.kind) {
    case 'tool': return toolIcon(a.name)
    case 'writing': return 'i-pencil'
    case 'thinking': return 'i-brain'
    default: return 'i-loader'
  }
}

/**
 * Come si legge una richiesta di permesso. `action` è il nome di un tool, cioè
 * vocabolario dell'agent: qui diventa una frase, e quando il nome non si riconosce la
 * frase lo dice così com'è invece di tacere.
 */
export function permissionHeadline(action: string): { icon: string; text: string } {
  if (action === 'Bash') return { icon: 'i-term', text: 'Wants to run a command' }
  if (action === 'Write') return { icon: 'i-brick', text: 'Wants to create a file' }
  if (action === 'Edit' || action === 'NotebookEdit') return { icon: 'i-brick', text: 'Wants to edit a file' }
  if (action === 'Read') return { icon: 'i-doc', text: 'Wants to read a file' }
  if (action === 'WebFetch' || action === 'WebSearch') return { icon: 'i-globe', text: 'Wants to reach the network' }
  if (action.startsWith('mcp__')) return { icon: 'i-plug', text: 'Wants to use an external tool' }
  return { icon: 'i-shield', text: `Wants to use ${action}` }
}

/**
 * Cosa vuol dire ciascuna modalità, in una riga. Le modalità sono canoniche
 * (`PermissionMode` sta in `core/events.ts`), quindi descriverle qui non fa entrare
 * nella UI la conoscenza di nessun agent: quale sia utilizzabile lo dice `snap.modes`,
 * che arriva dall'adapter perché è l'unico a sapere chi rifiuta e perché.
 */
export const MODE_BLURB: Record<string, string> = {
  auto: 'A classifier checks every action. No cards.',
  default: 'Asks before everything',
  acceptEdits: 'File edits go through, the rest asks',
  plan: 'Plans first, touches nothing',
  dontAsk: 'Never asks. The classifier still checks.',
  bypassPermissions: 'No checks at all',
}

export const MODE_ICON: Record<string, string> = {
  auto: 'i-bolt',
  default: 'i-shield',
  acceptEdits: 'i-pencil',
  plan: 'i-doc',
  dontAsk: 'i-check',
  bypassPermissions: 'i-block',
}

/** Il percorso accorciato con `~`, che è come lo si legge e come lo si riscrive. */
export function tilde(path: string | undefined): string {
  if (!path) return '—'
  return path.replace(/^\/root(?=\/|$)/, '~').replace(/^\/home\/[^/]+(?=\/|$)/, '~')
}
