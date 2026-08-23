// Dal formato a colonna unica al confronto affiancato.
//
// Claude Code consegna le modifiche già strutturate — nessuna differenza da calcolare,
// il §9 della specifica lo chiama "il diff viewer è quasi gratis". Ma le consegna in
// forma **unificata**: una sola colonna, con le righe tolte e quelle aggiunte una sotto
// l'altra. L'affiancato va costruito, ed è ciò che fa questo file.
//
// Nessuna I/O e nessuna conoscenza dell'agent: si entra con `Hunk[]` del vocabolario
// canonico e si esce con righe pronte da disegnare. Serve anche la forma unificata,
// perché su schermo stretto l'affiancato non ci sta: là non si rimpicciolisce, si cambia.

import type { Hunk } from './events.ts'

/** Una cella del confronto: numero di riga e contenuto. */
export type Side = {
  no: number
  text: string
  /** Il file finisce qui senza andare a capo. Va detto: cambia il contenuto del file. */
  noNewline?: boolean
}

/** La porzione cambiata dentro una riga, per evidenziare *cosa* è cambiato. */
export type Span = { start: number; end: number }

export type SideRow =
  | { kind: 'context'; left: Side; right: Side }
  | { kind: 'removed'; left: Side }
  | { kind: 'added'; right: Side }
  | { kind: 'changed'; left: Side; right: Side; leftSpan?: Span; rightSpan?: Span }
  | { kind: 'gap'; oldFrom: number; oldTo: number; newFrom: number; newTo: number }

export type UnifiedRow =
  | { kind: 'context'; oldNo: number; newNo: number; text: string; noNewline?: boolean }
  | { kind: 'removed'; oldNo: number; text: string; noNewline?: boolean }
  | { kind: 'added'; newNo: number; text: string; noNewline?: boolean }
  | { kind: 'gap'; oldFrom: number; oldTo: number; newFrom: number; newTo: number }

export type DiffStats = { added: number; removed: number }

/** Il `+47 −12` del blocco cliccabile. */
export function stats(hunks: Hunk[]): DiffStats {
  let added = 0, removed = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (isMarker(l)) continue
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

// ─── forma unificata ────────────────────────────────────────────────────────

export function unified(hunks: Hunk[]): UnifiedRow[] {
  const out: UnifiedRow[] = []
  let prevOldEnd = 0, prevNewEnd = 0

  for (const h of hunks) {
    pushGap(out, prevOldEnd, h.oldStart, prevNewEnd, h.newStart)
    let oldNo = h.oldStart, newNo = h.newStart
    h.lines.forEach((raw, i) => {
      if (isMarker(raw)) return
      const text = raw.slice(1)
      const senzaACapo = isMarker(h.lines[i + 1])
      const flag = senzaACapo ? { noNewline: true as const } : {}
      if (raw.startsWith('+')) out.push({ kind: 'added', newNo: newNo++, text, ...flag })
      else if (raw.startsWith('-')) out.push({ kind: 'removed', oldNo: oldNo++, text, ...flag })
      else out.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text, ...flag })
    })
    prevOldEnd = oldNo - 1
    prevNewEnd = newNo - 1
  }
  return out
}

// ─── forma affiancata ───────────────────────────────────────────────────────

export function sideBySide(hunks: Hunk[]): SideRow[] {
  const out: SideRow[] = []
  let prevOldEnd = 0, prevNewEnd = 0

  for (const h of hunks) {
    pushGap(out, prevOldEnd, h.oldStart, prevNewEnd, h.newStart)
    let oldNo = h.oldStart, newNo = h.newStart
    let i = 0

    while (i < h.lines.length) {
      const raw = h.lines[i]!
      if (isMarker(raw)) { i++; continue }

      if (raw.startsWith(' ') || (!raw.startsWith('+') && !raw.startsWith('-'))) {
        const text = raw.startsWith(' ') ? raw.slice(1) : raw
        const flag = isMarker(h.lines[i + 1]) ? { noNewline: true as const } : {}
        out.push({
          kind: 'context',
          left: { no: oldNo++, text, ...flag },
          right: { no: newNo++, text, ...flag },
        })
        i++
        continue
      }

      // Un blocco di modifiche: prima tutte le righe tolte, poi tutte le aggiunte.
      // Accoppiarle a due a due è ciò che rende leggibile l'affiancato: la riga
      // vecchia e la sua sostituta finiscono sulla stessa altezza.
      const tolte: Side[] = []
      const aggiunte: Side[] = []
      while (i < h.lines.length) {
        const l = h.lines[i]!
        if (isMarker(l)) { i++; continue }
        if (!l.startsWith('-')) break
        tolte.push({ no: oldNo++, text: l.slice(1), ...(isMarker(h.lines[i + 1]) ? { noNewline: true as const } : {}) })
        i++
      }
      while (i < h.lines.length) {
        const l = h.lines[i]!
        if (isMarker(l)) { i++; continue }
        if (!l.startsWith('+')) break
        aggiunte.push({ no: newNo++, text: l.slice(1), ...(isMarker(h.lines[i + 1]) ? { noNewline: true as const } : {}) })
        i++
      }

      const coppie = Math.min(tolte.length, aggiunte.length)
      for (let k = 0; k < coppie; k++) {
        const left = tolte[k]!, right = aggiunte[k]!
        const spans = intraLine(left.text, right.text)
        out.push({ kind: 'changed', left, right, ...spans })
      }
      for (let k = coppie; k < tolte.length; k++) out.push({ kind: 'removed', left: tolte[k]! })
      for (let k = coppie; k < aggiunte.length; k++) out.push({ kind: 'added', right: aggiunte[k]! })
    }

    prevOldEnd = oldNo - 1
    prevNewEnd = newNo - 1
  }
  return out
}

// ─── dentro la riga ─────────────────────────────────────────────────────────

/**
 * Quale porzione della riga è davvero cambiata, per non far rileggere all'occhio
 * una riga intera quando è cambiata una parola.
 *
 * Si tiene il prefisso e il suffisso in comune e si marca il mezzo. Se però la parte
 * comune è poca, la riga è stata riscritta: evidenziare quasi tutto non aiuta nessuno,
 * e allora si lascia la riga intera senza marcature.
 */
export function intraLine(a: string, b: string): { leftSpan?: Span; rightSpan?: Span } {
  if (a === b) return {}
  let pre = 0
  const max = Math.min(a.length, b.length)
  while (pre < max && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++

  const comune = pre + suf
  if (comune < Math.min(a.length, b.length) * 0.3) return {}

  return {
    leftSpan: { start: pre, end: a.length - suf },
    rightSpan: { start: pre, end: b.length - suf },
  }
}

// ─── utilità ────────────────────────────────────────────────────────────────

/** `\ No newline at end of file` non è una riga del file: annota quella prima. */
function isMarker(l: string | undefined): boolean {
  return l !== undefined && l.startsWith('\\')
}

function pushGap(
  out: { kind: 'gap'; oldFrom: number; oldTo: number; newFrom: number; newTo: number }[] | SideRow[] | UnifiedRow[],
  prevOldEnd: number, oldStart: number, prevNewEnd: number, newStart: number,
): void {
  const oldFrom = prevOldEnd + 1, oldTo = oldStart - 1
  const newFrom = prevNewEnd + 1, newTo = newStart - 1
  // Su un file creato `oldStart` è 0: non c'è nessun intervallo saltato da annunciare.
  if (oldTo < oldFrom && newTo < newFrom) return
  ;(out as UnifiedRow[]).push({ kind: 'gap', oldFrom, oldTo, newFrom, newTo })
}
