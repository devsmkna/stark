// Il trigger della board che viaggia DENTRO STARK, non solo nei file di progetto.
//
// Il blocco in CLAUDE.md/AGENTS.md (src/daemon/board.ts) vale dove è scritto e finché
// nessuno lo toglie; questa istruzione invece la inietta l'adapter a ogni sessione che
// nasce o si risveglia su un progetto con una board (card #31). I due canali si
// sommano, non si escludono: il blocco resta perché copre anche il CLI nel terminale.
//
// Sta in core e non in daemon/board.ts perché la importano gli adapter, e un adapter
// che importa dal daemon rovescerebbe la direzione delle dipendenze.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Il progetto ha una board? Stesso segnale di `allineaContestoBoard`: la cartella
 *  `.stark/kanban/` — che con la board cloud resta come marcatore locale. */
export const haBoard = (cwd: string): boolean =>
  existsSync(resolve(cwd, '.stark', 'kanban'))

/**
 * L'istruzione iniettata. Dice tre cose sole: la board è la superficie di
 * coordinamento, la corrispondenza si verifica PRIMA di lavorare, e la citazione ha
 * una forma esatta — `#NNN` — perché la UI la riconosce e la rende cliccabile.
 */
export const ISTRUZIONE_BOARD = `Questo progetto ha una board kanban: è la superficie di coordinamento di default (comandi nella skill \`stark-kanban\`). Quando la richiesta dell'utente è un task, un fix o comunque un lavoro, PRIMA verifica se corrisponde a una card della board. Se corrisponde, cita la card nella risposta nella forma \`#NNN\` (es. \`#12\` — solo l'id così, la UI lo rende cliccabile) e falle claim subito. Se non corrisponde, crea la card e cita allo stesso modo l'id nuovo. Aggiorna lo stato della card nel momento in cui cambia, mai a fine lavoro.`
