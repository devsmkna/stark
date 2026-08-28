// Verifiche a costo zero per `ui/src/lib/shortcuts.ts` e `ui/src/lib/actions.ts`.
// Girano con `node` puro come `layout-check.ts` e `gruppi-check.ts`, e per la stessa
// ragione: la parte che si sbaglia non è il riquadro, è la regola — `mod` che vuol
// dire due tasti diversi su due macchine, un file scritto male, due azioni sulla
// stessa combinazione.

import { AZIONI, combos } from '../ui/src/lib/actions.ts'
import {
  conflicts, format, fromEvent, isMac, matches, parse, stringify, type Tasto,
} from '../ui/src/lib/shortcuts.ts'

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

const ev = (key: string, m: Partial<Tasto> = {}): Tasto =>
  ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m })

// ─── parse ────────────────────────────────────────────────────────────────────
check('`mod+k` si legge', JSON.stringify(parse('mod+k'))
  === JSON.stringify({ mod: true, shift: false, alt: false, key: 'k' }))
check('l\'ordine dei modificatori non conta',
  stringify(parse('shift+alt+mod+p')!) === 'mod+alt+shift+p')
check('`cmd` e `ctrl` scritti a mano diventano `mod`',
  stringify(parse('cmd+k')!) === 'mod+k' && stringify(parse('ctrl+k')!) === 'mod+k')
check('maiuscole e spazi non cambiano niente', stringify(parse(' Mod + K ')!) === 'mod+k')
// Un file scritto a mano male vale «nessuna scorciatoia», non un'eccezione: è la
// stessa disciplina di `readSettings` nel daemon.
check('una stringa vuota non è una combinazione', parse('') === null)
check('solo modificatori non è una combinazione', parse('mod+shift') === null)
check('due tasti veri non sono una combinazione', parse('mod+k+j') === null)
check('quello che non è una stringa non esplode',
  parse(undefined) === null && parse(null) === null && parse(42 as never) === null)
// Escape è l'unica via d'uscita che vale ovunque: assegnarlo la toglierebbe.
check('Escape non è assegnabile', parse('escape') === null && parse('mod+escape') === null)

// ─── format ───────────────────────────────────────────────────────────────────
check('su Mac si scrive ⌘K, senza il più', format(parse('mod+k'), true) === '⌘K')
check('altrove si scrive Ctrl+K', format(parse('mod+k'), false) === 'Ctrl+K')
check('l\'ordine a schermo è mod, alt, shift, tasto',
  format(parse('shift+alt+mod+p'), false) === 'Ctrl+Alt+Shift+P')
check('i tasti con un nome lo tengono', format(parse('mod+enter'), false) === 'Ctrl+Enter')
check('le funzione restano maiuscole', format(parse('f5'), false) === 'F5')
check('nessuna combinazione si scrive con un trattino', format(null) === '—')

// ─── matches ──────────────────────────────────────────────────────────────────
const modK = parse('mod+k')
check('su Mac ⌘K scatta', matches(ev('k', { metaKey: true }), modK, true))
// La ragione per cui `mod` guarda **solo** il tasto giusto: Ctrl+K su Mac è già
// «cancella fino a fine riga», e prendersela vorrebbe dire rompere una cosa che
// l'utente usa senza avercela chiesta.
check('su Mac Ctrl+K NON scatta', !matches(ev('k', { ctrlKey: true }), modK, true))
check('su PC Ctrl+K scatta', matches(ev('k', { ctrlKey: true }), modK, false))
check('su PC ⌘K (tasto Windows) non scatta', !matches(ev('k', { metaKey: true }), modK, false))
check('K nudo non scatta', !matches(ev('k'), modK, true))
check('⌘⇧K non scatta su ⌘K: uno shift in più è un\'altra combinazione',
  !matches(ev('k', { metaKey: true, shiftKey: true }), modK, true))
check('il tasto si confronta senza distinzione di maiuscole',
  matches(ev('K', { metaKey: true }), modK, true))
check('nessuna combinazione non scatta mai', !matches(ev('k', { metaKey: true }), null, true))

// ─── fromEvent ────────────────────────────────────────────────────────────────
check('premere ⌘K si salva come `mod+k`',
  stringify(fromEvent(ev('k', { metaKey: true }), true)!) === 'mod+k')
check('premere Ctrl+K sul PC si salva uguale',
  stringify(fromEvent(ev('k', { ctrlKey: true }), false)!) === 'mod+k')
check('un modificatore da solo non si salva',
  fromEvent(ev('Shift', { shiftKey: true }), true) === null
  && fromEvent(ev('Meta', { metaKey: true }), true) === null)
check('Escape non si salva', fromEvent(ev('Escape'), true) === null)

// ─── conflitti ────────────────────────────────────────────────────────────────
check('due azioni sulla stessa combinazione si vedono',
  JSON.stringify(conflicts({ a: 'mod+k', b: 'cmd+k', c: 'mod+j' })) === '{"mod+k":["a","b"]}')
check('scritte diverse della stessa cosa contano come uno scontro',
  Object.keys(conflicts({ a: 'shift+mod+p', b: 'mod+shift+p' })).length === 1)
check('senza scontri l\'elenco è vuoto',
  Object.keys(conflicts({ a: 'mod+k', b: 'mod+j' })).length === 0)
check('una voce illeggibile non inventa uno scontro',
  Object.keys(conflicts({ a: 'mod+k', b: 'boh', c: '' })).length === 0)

// ─── il registro delle azioni ─────────────────────────────────────────────────
check('ogni azione ha una combinazione valida di partenza',
  AZIONI.every(a => parse(a.default) !== null), AZIONI.map(a => a.default).join(' '))
check('i default non si scontrano fra loro',
  Object.keys(conflicts(Object.fromEntries(AZIONI.map(a => [a.id, a.default])))).length === 0)
check('senza niente salvato valgono i default', combos(undefined)['palette'] === 'mod+k')
check('quella salvata vince sul default', combos({ palette: 'mod+j' })['palette'] === 'mod+j')
// Tolta la voce si torna al default: è il motivo per cui «reset» **cancella** invece
// di riscrivere il valore di partenza — se un domani il default cambia, chi non l'ha
// mai toccata deve prendersi quello nuovo.
check('una voce di un\'azione che non esiste non entra',
  combos({ inesistente: 'mod+z' })['inesistente'] === undefined)

// ─── isMac ────────────────────────────────────────────────────────────────────
check('il Mac si riconosce', isMac('MacIntel') && isMac('iPhone'))
check('il resto no', !isMac('Win32') && !isMac('Linux x86_64') && !isMac(''))

// ─── esito ────────────────────────────────────────────────────────────────────
let ko = 0
for (const [name, ok, detail] of checks) {
  if (!ok) ko++
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`)
}
console.log(`\n${checks.length - ko}/${checks.length} verifiche`)
process.exit(ko === 0 ? 0 : 1)
