// Le scorciatoie da tastiera: parsing, confronto e resa a schermo.
//
// Puro di proposito — niente Svelte, niente DOM oltre al tipo dell'evento — perché è
// qui che stanno i bug veri di questa roba: `mod` che vuol dire due tasti diversi su
// due macchine, una combinazione scritta male in un file, due azioni che si prendono
// la stessa. Si prova con `node` come `layout.ts` e `gruppi.ts`.

export type Combo = {
  /** Il tasto «di comando» della macchina: ⌘ su Mac, Ctrl altrove. Vedi `isMac`. */
  mod: boolean
  shift: boolean
  alt: boolean
  /** Il tasto vero, minuscolo e senza modificatori: `k`, `enter`, `f1`. */
  key: string
}

/**
 * Su questa macchina, `mod` è ⌘ o Ctrl?
 *
 * È la ragione per cui su disco si scrive `mod+k` e non `cmd+k`: le impostazioni
 * stanno nel daemon (una macchina), ma la tastiera è del **dispositivo** che guarda —
 * e un Mac e un PC che aprono lo stesso STARK devono premere tasti diversi per la
 * stessa cosa. Salvare `cmd+k` letterale vorrebbe dire una scorciatoia morta sul PC.
 */
export function isMac(platform = globalThis.navigator?.platform ?? ''): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** I tasti che non si lasciano assegnare, e il perché sta tutto in una riga. */
const VIETATI = new Set([
  // Chiude i menu, le modali e la cattura stessa: assegnarlo vorrebbe dire togliere
  // l'unica via d'uscita che vale ovunque.
  'escape',
  // Da soli non sono una scorciatoia: sono metà di una.
  'shift', 'control', 'alt', 'meta', 'os', 'dead', 'unidentified',
])

/**
 * Da stringa a combinazione. `null` vuol dire «illeggibile», e non è un errore da
 * mostrare: un file scritto a mano male deve valere «nessuna scorciatoia», non far
 * esplodere la UI (stessa disciplina di `readSettings`).
 */
export function parse(s: string | undefined | null): Combo | null {
  if (typeof s !== 'string') return null
  const pezzi = s.toLowerCase().split('+').map(p => p.trim()).filter(Boolean)
  if (pezzi.length === 0) return null
  const combo: Combo = { mod: false, shift: false, alt: false, key: '' }
  for (const p of pezzi) {
    if (p === 'mod' || p === 'cmd' || p === 'ctrl' || p === 'control' || p === 'meta') combo.mod = true
    else if (p === 'shift') combo.shift = true
    else if (p === 'alt' || p === 'option') combo.alt = true
    else if (combo.key) return null   // due tasti veri non sono una combinazione
    else combo.key = p
  }
  if (!combo.key || VIETATI.has(combo.key)) return null
  return combo
}

/** Da combinazione a stringa canonica: è ciò che finisce in `settings.json`. */
export function stringify(c: Combo): string {
  return [c.mod && 'mod', c.alt && 'alt', c.shift && 'shift', c.key]
    .filter(Boolean).join('+')
}

const NOMI_MAC: Record<string, string> = { mod: '⌘', alt: '⌥', shift: '⇧' }
const NOMI_PC: Record<string, string> = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' }
const TASTI: Record<string, string> = {
  ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  enter: 'Enter', tab: 'Tab', backspace: '⌫',
}

/**
 * Come si scrive a schermo: `⌘K` su Mac, `Ctrl+K` altrove. Il Mac non mette il `+`
 * fra i simboli, e scriverlo lo farebbe sembrare un'altra cosa.
 */
export function format(c: Combo | null, mac = isMac()): string {
  if (!c) return '—'
  const nomi = mac ? NOMI_MAC : NOMI_PC
  const tasto = TASTI[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key.replace(/^f(\d+)$/, 'F$1'))
  const parti = [c.mod && nomi['mod'], c.alt && nomi['alt'], c.shift && nomi['shift'], tasto]
    .filter(Boolean) as string[]
  return mac ? parti.join('') : parti.join('+')
}

/** L'evento che arriva dal browser, ridotto ai soli campi che contano. */
export type Tasto = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Questo evento è quella combinazione?
 *
 * `mod` guarda **solo** il tasto giusto della macchina: su Mac Ctrl+K non deve aprire
 * la palette, perché Ctrl+K su Mac è già «cancella fino a fine riga» e prendersela
 * vorrebbe dire rompere una cosa che l'utente usa senza averla chiesta a noi.
 */
export function matches(e: Tasto, c: Combo | null, mac = isMac()): boolean {
  if (!c) return false
  const mod = mac ? e.metaKey : e.ctrlKey
  const altro = mac ? e.ctrlKey : e.metaKey
  return mod === c.mod && altro === false
    && e.shiftKey === c.shift && e.altKey === c.alt
    && e.key.toLowerCase() === c.key
}

/** L'evento, letto come combinazione da salvare. `null` se non è assegnabile. */
export function fromEvent(e: Tasto, mac = isMac()): Combo | null {
  const key = e.key.toLowerCase()
  if (VIETATI.has(key)) return null
  return {
    mod: mac ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key,
  }
}

/**
 * Le azioni che condividono una combinazione, per combinazione.
 *
 * Serve a **dirlo**, non a rifiutare: chi ne assegna una già presa deve vedere con
 * cosa ha sbattuto, che è un'informazione che un rifiuto muto non dà.
 */
export function conflicts(map: Record<string, string>): Record<string, string[]> {
  const per: Record<string, string[]> = {}
  for (const [id, s] of Object.entries(map)) {
    const c = parse(s)
    if (!c) continue
    const k = stringify(c)
    ;(per[k] ??= []).push(id)
  }
  return Object.fromEntries(Object.entries(per).filter(([, ids]) => ids.length > 1))
}
