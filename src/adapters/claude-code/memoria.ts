// La regola che STARK scrive nella memoria globale dell'agent, e che sa togliere.
//
// È l'unica cosa in STARK che **modifica un file dell'utente fuori da `~/.stark`**, e
// per questo l'unica regola che conta qui è: non riscrivere mai quel file, toccare solo
// il proprio pezzo. Il `CLAUDE.md` globale è di chi lo ha scritto — ci sono dentro
// preferenze che non ci riguardano, e un'impostazione spenta per sbaglio non deve poter
// cancellare niente che non abbiamo messo noi.
//
// Da cui i due delimitatori: sono commenti Markdown (invisibili a chi legge il file
// renderizzato, ben visibili a chi lo apre) e sono l'unico modo che abbiamo di
// riconoscere ciò che è nostro. Tutto quello che sta fuori non si tocca mai.
//
// Perché una regola nella memoria dell'agent invece di un'opzione dell'SDK: perché
// un'opzione dell'SDK non c'è. Il campo `description` di un tool lo scrive il modello,
// e l'unico modo di chiederglielo è dirglielo — cioè metterlo dove lo rilegge sempre.
// Verificato che serva davvero (26 agosto 2026): in una sessione lunga la percentuale
// di comandi con motivazione è passata da ~100% a **0 su 27** subito dopo un `/clear`,
// perché l'abitudine viveva negli esempi in contesto. Il file di memoria invece viene
// riletto a ogni avvio e dopo ogni azzeramento: è il solo posto che sopravvive.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { configDirOf } from './profiles.ts'

/** Esportato perché le prove non devono ricopiare la stringa a mano: se cambia
 *  qui, deve cambiare anche lì — e un delimitatore diverso non riconosce più il
 *  blocco vecchio, che resterebbe orfano nel file di qualcuno. */
export const INIZIO_REGOLA = '<!-- stark:descrizione-comandi -->'
const INIZIO = INIZIO_REGOLA
const FINE = '<!-- /stark:descrizione-comandi -->'

/** Il testo della regola. Fuori dalla funzione perché è contenuto, non logica. */
const REGOLA = `${INIZIO}
## Scrivi sempre la \`description\` quando lanci un comando

Il campo \`description\` del tool Bash è opzionale, e quando manca resta solo il comando.
Va scritto **sempre**: dice *perché* stai lanciando quella cosa, non *cosa* stai
lanciando — chi guarda legge «Cerco dove si decide il modello di default» invece di
\`grep -rn "claude-sonnet" src/\`.

Vale per qualunque tool che accetti una \`description\`, non solo Bash.

*Questo blocco lo gestisce STARK (impostazioni → Agent → «Command descriptions»). Il
resto del file non lo tocca: se togli la spunta sparisce solo quello che sta fra i due
commenti.*
${FINE}`

export type EsitoMemoria = {
  /** Il file su cui si è agito, sempre — anche quando non c'era niente da fare. */
  path: string
  /** La regola c'è adesso? */
  presente: boolean
  /** Qualcosa è cambiato su disco in questa chiamata. */
  cambiato: boolean
  /** Perché non si è potuto fare (permessi, disco pieno): detto, non ingoiato. */
  error?: string
}

/**
 * Allinea il `CLAUDE.md` globale all'impostazione: se accesa la regola c'è, se spenta
 * non c'è. Idempotente di proposito — gira all'avvio del daemon e a ogni salvataggio,
 * e in entrambi i casi la risposta giusta a «è già come deve essere» è non fare niente.
 */
export function allineaMemoria(configDir: string | undefined, accesa: boolean): EsitoMemoria {
  const dir = configDirOf(configDir)
  const path = resolve(dir, 'CLAUDE.md')
  try {
    const prima = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const dopo = accesa ? conRegola(prima) : senzaRegola(prima)
    if (dopo === prima) return { path, presente: accesa, cambiato: false }
    // Rimasto vuoto: il file c'era solo per la nostra regola. Si toglie invece di
    // lasciare un `CLAUDE.md` di zero byte in giro — ed è sicuro proprio perché è
    // vuoto: non c'è niente da perdere, quindi non serve sapere chi l'aveva creato.
    if (dopo.trim() === '') {
      if (existsSync(path)) rmSync(path)
      return { path, presente: false, cambiato: true }
    }
    // La cartella può non esistere: un profilo Claude appena creato, o una macchina
    // dove il CLI non è ancora partito nemmeno una volta.
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, dopo)
    return { path, presente: accesa, cambiato: true }
  } catch (e) {
    // Un file di memoria che non si lascia scrivere non deve impedire al daemon di
    // partire né a un salvataggio di impostazioni di andare a buon fine: si dice cosa
    // è successo e si va avanti. È una preferenza, non un pezzo del motore.
    return { path, presente: false, cambiato: false, error: String((e as Error).message ?? e) }
  }
}

/** C'è già? La si lascia dov'è: riordinarla sposterebbe testo che non è nostro. */
function conRegola(testo: string): string {
  if (testo.includes(INIZIO)) return sostituisci(testo)
  if (testo.trim() === '') return `${REGOLA}\n`
  // In fondo, non in cima: quello che l'utente ha scritto viene prima del nostro.
  return `${testo.replace(/\s*$/, '')}\n\n${REGOLA}\n`
}

/**
 * Il blocco c'è ma il testo dentro è vecchio (STARK aggiornato, regola riscritta): si
 * rimpiazza fra i delimitatori. È il motivo per cui i delimitatori esistono anche nel
 * caso «accesa»: senza, l'unico modo di aggiornare la regola sarebbe aggiungerne una
 * seconda copia.
 */
function sostituisci(testo: string): string {
  const a = testo.indexOf(INIZIO)
  const b = testo.indexOf(FINE)
  if (a < 0 || b < 0 || b < a) return testo
  return testo.slice(0, a) + REGOLA + testo.slice(b + FINE.length)
}

function senzaRegola(testo: string): string {
  const a = testo.indexOf(INIZIO)
  const b = testo.indexOf(FINE)
  if (a < 0 || b < 0 || b < a) return testo
  // Si portano via anche le righe vuote che il blocco si era portato dietro, se no
  // accendere e spegnere l'impostazione dieci volte lascerebbe dieci buchi nel file.
  const testa = testo.slice(0, a).replace(/\s*$/, '')
  const coda = testo.slice(b + FINE.length).replace(/^\s*/, '')
  if (testa === '' && coda === '') return ''
  if (testa === '') return `${coda}\n`.replace(/\n+$/, '\n')
  if (coda === '') return `${testa}\n`
  return `${testa}\n\n${coda}\n`.replace(/\n+$/, '\n')
}
