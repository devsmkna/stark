// La presenza di una board di progetto: rileva `.stark/kanban/` (file-based, via
// kanban-md) e tiene allineati i file di contesto degli agent — CLAUDE.md, AGENTS.md,
// la skill `stark-kanban`. La board vera e propria (dati, lettura, scrittura) è cloud:
// vedi `cloud/src/board.ts` e il proxy in `./cloud.ts`. Questo file resta perché
// rilevare che un progetto *ha* una board — per scrivergli la regola nel contesto —
// non dipende da dove i dati vivono.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conBlocco, senzaBlocco } from '../core/blocco.ts'

export const boardDir = (cwd: string): string => resolve(cwd, '.stark', 'kanban')

/** La radice del repo di STARK: da qui si copia la skill della board nei progetti. */
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Il blocco che segnala all'agent l'esistenza di una board, e la regola con cui usarla.
 *
 * Finisce nei file di contesto di progetto **sempre caricati** — `CLAUDE.md` per Claude
 * Code, `AGENTS.md` per OpenCode — fra due delimitatori che ci appartengono, ed è lì
 * che abita il vero motivo per cui un agent non parteva dalla board: la skill serve ma
 * la si doveva invocare da soli. Un blocco in cima al contesto non si può dimenticare.
 *
 * Sta **in fondo** al file (chi ha scritto il file viene prima di noi), e non va
 * confuso con la skill: quella è su richiesta, questa è la scelta di farne la
 * superficie di coordinamento di default per ogni sessione che si apre sul progetto.
 */
const INIZIO_BOARD = '<!-- stark:board -->'
const FINE_BOARD = '<!-- /stark:board -->'

const REGOLA_BOARD = `${INIZIO_BOARD}
## C'è una board in questo progetto

Questo progetto ha una board (kanban, in \`.stark/kanban/\`), la superficie di
coordinamento di default. Prima di lavorare **leggila** e parti da un task che c'è già
— se un lavoro non c'è, è una card da creare. Segna il task come preso in carico
(claim) **subito**, e aggiorna lo stato **nel momento** in cui cambia, mai in coda a
fine lavoro.

Per i comandi esatti usa la skill \`stark-kanban\`.

*Questo blocco lo gestisce STARK: vive finché c'è \`.stark/kanban/\`. Se lo togli a
mano, lo riscrive alla prossima sessione.*
${FINE_BOARD}`

/**
 * Tiene allineata la presenza della board ai file di contesto di progetto.
 *
 * Con board presente aggiunge il blocco a `CLAUDE.md` e `AGENTS.md` del progetto (e
 * installa la skill): con board assente lo toglie, e se il file resta vuoto lo elimina.
 * Idempotente e non bloccante — un progetto senza permessi di scrittura non deve
 * impedire a una sessione di partire, e una scrittura andata a vuoto si lascia dietro
 * solo un avviso nel log del daemon, come per la memoria globale.
 *
 * Si chiama all'apertura di ogni sessione (`registry.open`): è il punto che esiste una
 * volta per qualunque modo si arrivi a una conversazione (nuova, ripresa, risveglio),
 * ed è anche l'unico posto in cui il `cwd` del progetto è già risolto.
 */
export function allineaContestoBoard(cwd: string): void {
  const accesa = existsSync(boardDir(cwd))
  for (const rel of ['CLAUDE.md', 'AGENTS.md']) {
    const path = resolve(cwd, rel)
    try {
      const prima = existsSync(path) ? readFileSync(path, 'utf8') : ''
      const dopo = accesa ? conBlocco(prima, INIZIO_BOARD, FINE_BOARD, REGOLA_BOARD)
        : senzaBlocco(prima, INIZIO_BOARD, FINE_BOARD)
      if (dopo === prima) continue
      if (dopo.trim() === '') {
        if (existsSync(path)) rmSync(path)
        continue
      }
      writeFileSync(path, dopo)
    } catch (e) {
      console.error(`[board] impossibile allineare ${path}:`, (e as Error).message ?? e)
    }
  }
  if (accesa) installaSkillKanban(cwd)
}
/**
 * Installa la skill `stark-kanban` nel progetto, così gli agent che ci lavorano sanno
 * usare la board (è la superficie di coordinamento di default). Copia la skill dal repo
 * di STARK nelle cartelle skill degli agent che STARK guida — per progetto, non globale
 * (ADR: la board è del progetto). Idempotente: se la skill c'è già, non fa niente.
 * Non bloccante: se la copia fallisce, la board resta leggibile.
 */
export function installaSkillKanban(cwd: string): void {
  const sorgente = resolve(RADICE, 'skills', 'stark-kanban')
  if (!existsSync(resolve(sorgente, 'SKILL.md'))) return
  // Le cartelle skill degli agent che STARK guida: Claude Code e OpenCode. Ognuna ha il
  // suo posto, e una sola non basta — un agent senza la skill non sa che la board esiste.
  for (const cartella of ['.claude', '.opencode']) {
    const dest = resolve(cwd, cartella, 'skills', 'stark-kanban')
    if (existsSync(resolve(dest, 'SKILL.md'))) continue
    try {
      mkdirSync(dest, { recursive: true })
      copyFileSync(resolve(sorgente, 'SKILL.md'), resolve(dest, 'SKILL.md'))
    } catch { /* non bloccante */ }
  }
}

