// La presenza di una board di progetto: rileva `.stark/kanban/` e tiene allineati i
// file di contesto degli agent — CLAUDE.md, AGENTS.md, la skill `stark-kanban`. La
// board vera e propria (dati, lettura, scrittura) è cloud: vedi `cloud/src/board.ts`
// e il proxy in `./cloud.ts`. Questo file resta perché rilevare che un progetto *ha*
// una board — per scrivergli la regola nel contesto — non dipende da dove i dati
// vivono. Qui sta anche il lettore dei file di kanban-md (`leggiBoardLocale`), che
// ormai serve a una cosa sola: la **migrazione** di una board locale verso il cloud.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conBlocco, senzaBlocco } from '../core/blocco.ts'
import { boardCloud, originRepo } from './cloud.ts'

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

Questo progetto ha una board (kanban), la superficie di coordinamento di default.
La board vive **sul cloud di STARK**, condivisa fra le macchine e i colleghi del
progetto: ci si parla attraverso il daemon di STARK, non coi file. Prima di lavorare
**leggila** e parti da un task che c'è già — se un lavoro non c'è, è una card da
creare. Segna il task come preso in carico (claim) **subito**, e aggiorna lo stato
**nel momento** in cui cambia, mai in coda a fine lavoro.

Quando prendi in carico una card, **citala in chat nella forma \`#NNN\`** (es. \`#12\`):
STARK la rende cliccabile e mostra la card nel flusso. Vale anche per una card appena
creata: cita l'id nuovo. Per i comandi esatti usa la skill \`stark-kanban\`.

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
  const sorgente = resolve(RADICE, 'skills', 'stark-kanban', 'SKILL.md')
  if (!existsSync(sorgente)) return
  const contenuto = readFileSync(sorgente, 'utf8')
  // Le cartelle skill degli agent che STARK guida: Claude Code e OpenCode. Ognuna ha il
  // suo posto, e una sola non basta — un agent senza la skill non sa che la board esiste.
  for (const cartella of ['.claude', '.opencode']) {
    const dest = resolve(cwd, cartella, 'skills', 'stark-kanban')
    const file = resolve(dest, 'SKILL.md')
    try {
      // Si sovrascrive quando il contenuto è diverso, non solo quando manca: la skill
      // è cambiata almeno una volta (da kanban-md alla board cloud), e una copia
      // vecchia lasciata nei progetti insegnerebbe agli agent comandi che non
      // funzionano più. È un file nostro, non dell'utente: riscriverlo è lecito.
      if (existsSync(file) && readFileSync(file, 'utf8') === contenuto) continue
      mkdirSync(dest, { recursive: true })
      writeFileSync(file, contenuto)
    } catch { /* non bloccante */ }
  }
}

// ─── la board locale (kanban-md): si legge solo per migrarla ────────────────

/** Una card letta dai file di kanban-md, nel formato che l'import cloud si aspetta. */
export type TaskLocale = {
  id: number
  title: string
  status: string
  priority?: string
  class?: string
  assignee?: string
  claimed_by?: string
  claimed_at?: string
  blocked?: string
  due?: string
  estimate?: string
  body?: string
  created?: string
  updated?: string
}

/** Toglie le virgolette YAML a uno scalare su una riga (`'x''y'` e `"x"`). */
function dequota(v: string): string {
  const s = v.trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replaceAll("''", "'")
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s) as string } catch { return s.slice(1, -1) }
  }
  return s
}

/**
 * Legge una card dal suo file markdown: frontmatter YAML fra due `---`, poi il corpo.
 *
 * Non è un parser YAML: è un lettore dei campi che kanban-md scrive — scalari su una
 * riga, con le virgolette singole raddoppiate. Le liste (i `tags`, se mai ci fossero)
 * si saltano senza rompersi. Basta a ciò che serve, che è una cosa sola: portare la
 * board sul cloud una volta. `null` se il file non ha la forma attesa.
 */
function leggiTaskFile(path: string): TaskLocale | null {
  let testo: string
  try { testo = readFileSync(path, 'utf8') } catch { return null }
  if (!testo.startsWith('---\n')) return null
  const fine = testo.indexOf('\n---\n', 4)
  if (fine < 0) return null
  const campi = new Map<string, string>()
  for (const riga of testo.slice(4, fine).split('\n')) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(riga)
    if (!m) continue // righe indentate (liste) o vuote: si saltano
    campi.set(m[1]!, dequota(m[2] ?? ''))
  }
  const id = Number(campi.get('id'))
  const title = campi.get('title')
  const status = campi.get('status')
  if (!Number.isInteger(id) || id < 1 || !title || !status) return null
  const t: TaskLocale = { id, title, status }
  const opz: [keyof TaskLocale, string][] = [
    ['priority', 'priority'], ['class', 'class'], ['assignee', 'assignee'],
    ['claimed_by', 'claimed_by'], ['claimed_at', 'claimed_at'], ['blocked', 'blocked'],
    ['due', 'due'], ['estimate', 'estimate'], ['created', 'created'], ['updated', 'updated'],
  ]
  for (const [chiave, campo] of opz) {
    const v = campi.get(campo)
    if (v) (t as Record<string, unknown>)[chiave] = v
  }
  const body = testo.slice(fine + 5).trim()
  if (body) t.body = body
  return t
}

/** Il nome della board dal `config.yml` di kanban-md, se c'è. */
function nomeBoardLocale(dir: string): string | undefined {
  try {
    const righe = readFileSync(resolve(dir, 'config.yml'), 'utf8').split('\n')
    const inizio = righe.findIndex(r => r === 'board:')
    if (inizio < 0) return undefined
    for (let i = inizio + 1; i < righe.length; i++) {
      const r = righe[i]!
      if (!r.startsWith(' ') && !r.startsWith('\t')) break
      const m = /^\s+name:\s*(.+)$/.exec(r)
      if (m) return dequota(m[1]!)
    }
  } catch { /* config assente o illeggibile: nessun nome */ }
  return undefined
}

/**
 * La board locale (kanban-md) di un progetto, letta dai file: il materiale della
 * migrazione verso il cloud. `null` se non c'è una board locale o non ha card.
 */
export function leggiBoardLocale(cwd: string): { name?: string; tasks: TaskLocale[] } | null {
  const dir = boardDir(cwd)
  const tasksDir = resolve(dir, 'tasks')
  if (!existsSync(tasksDir)) return null
  let files: string[]
  try { files = readdirSync(tasksDir).filter(f => f.endsWith('.md')) } catch { return null }
  const tasks = files
    .map(f => leggiTaskFile(resolve(tasksDir, f)))
    .filter((t): t is TaskLocale => t !== null)
  if (tasks.length === 0) return null
  return { name: nomeBoardLocale(dir), tasks }
}

// ─── il rilevamento della board cloud sulle altre macchine ──────────────────

/**
 * Se il progetto ha una board **sul cloud** ma questa macchina non lo sa ancora,
 * lascia il segnaposto locale (`.stark/kanban/cloud`) e riallinea il contesto.
 *
 * Il caso è il collega, o la seconda macchina: la board è nata altrove, qui
 * `.stark/kanban/` non esiste, e senza questo giro né la regola nel CLAUDE.md né la
 * skill comparirebbero mai — la board ci sarebbe e nessun agent lo saprebbe. Si
 * chiama all'apertura di ogni sessione, **senza aspettarla**: è una richiesta di
 * rete verso il cloud, e una chat non deve nascere più lenta perché il cloud è
 * lento. Best-effort per costruzione: cloud spento, non loggato, niente origin,
 * board assente — in ogni caso non succede niente, e si riproverà alla prossima.
 */
export async function rilevaBoardCloud(home: string, cwd: string): Promise<void> {
  try {
    if (existsSync(boardDir(cwd))) return
    const origin = await originRepo(cwd)
    if (!origin) return
    const b = await boardCloud(home, origin) as { assente?: boolean } | null
    if (!b || b.assente !== false) return
    mkdirSync(boardDir(cwd), { recursive: true })
    writeFileSync(resolve(boardDir(cwd), 'cloud'),
      `La board di questo progetto vive sul cloud di STARK (origin: ${origin}).\n`
      + 'Questa cartella è il segnaposto che lo dice alle sessioni locali.\n')
    allineaContestoBoard(cwd)
  } catch { /* best-effort: si riproverà alla prossima apertura */ }
}

