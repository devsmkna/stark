// Il registro delle azioni con una scorciatoia.
//
// Oggi ce n'è una sola, e il registro esiste lo stesso: Settings itera su questo
// elenco invece di avere una riga scritta a mano, quindi la seconda scorciatoia è una
// voce qui e nient'altro. Un elenco di uno non è sovraingegneria — è il posto dove
// mettere la seconda senza toccare la schermata.

export type Azione = {
  id: string
  label: string
  /** Cosa fa, detto a chi guarda le impostazioni e non il codice. */
  hint: string
  /** La combinazione di partenza, nella forma canonica (`mod` = ⌘ o Ctrl). */
  default: string
}

export const AZIONI: Azione[] = [
  {
    id: 'palette',
    label: 'Open the palette',
    hint: 'Jump to a chat by typing its name or its project.',
    default: 'mod+k',
  },
  {
    id: 'board',
    label: 'Open the board',
    hint: 'Open or close the project board.',
    default: 'mod+l',
  },
  {
    id: 'sidebar',
    label: 'Toggle the sidebar',
    hint: 'Collapse or expand the sidebar.',
    default: 'mod+b',
  },
]

/** La combinazione in vigore per ogni azione: quella scelta, o quella di partenza. */
export function combos(salvate: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of AZIONI) out[a.id] = salvate?.[a.id] ?? a.default
  return out
}
