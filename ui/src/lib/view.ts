// Le traduzioni fra lo stato canonico e ciò che si vede: i tre gruppi della barra
// laterale, l'etichetta di stato, il progetto e il suo colore.
//
// Sta qui e non dentro i componenti perché sono decisioni di prodotto scritte in
// docs/ui-schermate.md, non dettagli di disegno: se cambiano, cambiano in un posto.

import type { Activity } from '$core/activity.ts'
import type { SessionState } from '$core/events.ts'
import type { TurnView } from '$core/reduce.ts'
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
export function colours(
  rows: SessionRow[],
  scelti: Record<string, { colour?: number }> = {},
): Map<string, number> {
  const names = [...new Set(rows.map(r => project(r.cwd)))].sort()
  // Il colore scelto a mano vince: dal momento in cui lo scegli, l'ordine alfabetico
  // smette di decidere per te. Vale per cartella, che è l'identità vera di un progetto.
  const perCartella = new Map<string, number>()
  for (const r of rows) {
    const c = r.cwd ? scelti[r.cwd]?.colour : undefined
    if (c !== undefined) perCartella.set(project(r.cwd), c)
  }
  return new Map(names.map((n, i) => [n, perCartella.get(n) ?? i % 7]))
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
 * Un turno non finito non vuol dire «in corso»: se ne mandi uno mentre l'agent sta
 * ancora lavorando a un altro, `turn.started` arriva subito (§4 — è un fatto, non
 * un'attesa) ma il lavoro vero resta uno alla volta. Il primo turno non finito nella
 * lista è quello che l'agent sta davvero facendo; quelli non finiti dopo di lui sono
 * solo in coda, e non hanno ancora un solo blocco perché nessuno li ha ancora toccati.
 * Senza questa distinzione, aprire di default «l'ultimo turno» richiuderebbe quello
 * vero proprio mentre lavora — la bugia peggiore, perché è quella su cui si aspetta.
 */
export function turnStatus(turns: TurnView[], i: number): 'active' | 'queued' | undefined {
  const t = turns[i]
  if (!t || t.ended) return undefined
  const primoAperto = turns.findIndex(x => !x.ended)
  return i === primoAperto ? 'active' : 'queued'
}

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
 * Quanto manca. È `since` guardato dall'altro verso, con una differenza che non è un
 * dettaglio: qui si arriva ai **giorni**, perché una finestra settimanale si riapre fra
 * sei giorni e «148h 12m» non è un tempo che qualcuno legge. Sotto il minuto non si
 * contano i secondi: su un'attesa di ore i secondi sono rumore.
 */
export function until(from: number, to: number): string {
  const m = Math.max(0, Math.round((to - from) / 60000))
  if (m < 1) return 'any moment'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * `Aug 26 14:30`. Il doppio formato serve perché le due domande sono diverse: «quanto
 * manca» dice se conviene aspettare, «quando esattamente» dice se conviene rimandare a
 * domani mattina — e su un'attesa di giorni la prima da sola non basta a decidere.
 */
const MESI = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function stamp(ts: number): string {
  if (!ts) return ''
  // Al minuto **più vicino**, non troncato. Il piano ricalcola l'istante del reset a
  // ogni domanda e lo manda con i decimi: fra due letture ballava di un secondo, e
  // troncando si vedeva l'orario cambiare da 23:00 a 22:59 senza che fosse successo
  // niente. Arrotondare toglie quel tremolio; mezzo minuto su una finestra di giorni
  // non cambia nessuna decisione.
  const d = new Date(Math.round(ts / 60000) * 60000)
  const due = (n: number): string => String(n).padStart(2, '0')
  return `${MESI[d.getMonth()]} ${due(d.getDate())} ${due(d.getHours())}:${due(d.getMinutes())}`
}

/**
 * Come si legge «cosa sta facendo adesso». Il fatto lo calcola `core/activity.ts`,
 * perché serve identico al blocco in basso e alla riga dell'elenco — che il daemon
 * riempie per tutte le sessioni, comprese quelle che non stai guardando. Qui restano
 * solo le parole e il segno, che sono presentazione.
 */
export function activityText(a: Activity): string {
  switch (a.kind) {
    // La motivazione, quando l'agent l'ha scritta, dice più del nome del tool: «Look
    // for context hover component» dice dove sta andando, «Bash · grep -rn "summary"
    // src/adapters/» no. Senza, si torna al nome/soggetto di sempre (F2).
    case 'tool': return a.intent ?? (a.summary ? `${a.name} · ${a.summary}` : a.name)
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
/**
 * Cosa fa una modalita', **come ripiego**.
 *
 * Dopo ADR-014 queste frasi le dichiara l'agent (`ModeChoice.note`): sono descrizioni
 * del suo comportamento, non del modello. Restano qui per i journal scritti prima, che
 * non ne portano nessuna — e per nient'altro. Se compaiono accanto a una modalita' di
 * un agent che non e' Claude Code, quello e' un difetto: vuol dire che l'adapter non ha
 * descritto le proprie.
 */
export const MODE_BLURB: Record<string, string> = {  auto: 'A classifier checks every action. No cards.',
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

/** Un numero di token leggibile: 200000 → "200k", 1000000 → "1M". Stessa scala
 *  ovunque la si mostri — scheda del modello, righe del picker, pannello d'uso —
 *  così due numeri formati in due posti si leggono allo stesso modo. */
export const fmtTok = (n: number | undefined): string => {
  if (!n) return '—'
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** Un costo per milione di token: 15 → "15", 1.2 → "1.20", un prezzo minuscolo
 *  non si arrotonda a zero e si lascia coi decimali che servono. Il segno `$` lo
 *  disegna chi ospita, non il valore: l'icona e il numero stanno l'una accanto
 *  all'altro, e il simbolo ripetuto sarebbe rumore. */
export const fmtCosto = (n: number): string =>
  `${n < 0.01 ? n.toFixed(4).replace(/0+$/, '') : Number.isInteger(n) ? String(n) : n.toFixed(2)}`
