// La board del progetto: un kanban in stile Jira/Trello, file-based e agents-first,
// costruito sopra lo strumento esistente **kanban-md** (MIT, binario Go) invece di
// reimplementarlo.
//
// **Perché non sta nello `SessionSnapshot`.** Come `.stark/todo.json`, lo scrivono gli
// agent sul disco, fuori dal flusso di eventi: metterlo nello snapshot vorrebbe dire
// che al risveglio da journal la board tornerebbe vuota, e nessuno capirebbe perché.
// È una risorsa a parte, come lo spazio su disco.
//
// **Perché è del progetto e non della chat.** Il file sta accanto al codice, quindi due
// conversazioni sulla stessa cartella vedono la stessa board. E il `cwd` lo risolve il
// daemon dall'id della sessione, mai un percorso dal browser — la stessa regola di
// `/todo` e dei suggerimenti `@`.
//
// **Perché STARK non scrive mai i file da solo.** La board è la superficie di
// coordinamento degli agent: la modificano loro (claim, stati, nuovi task) e la
// modifica la UI. Se STARK riscrivesse i file direttamente diventerebbe un secondo
// scrittore in gara con l'agent — la classe di bug «due scrittori». Per questo ogni
// operazione passa dal CLI di kanban-md, che gestisce atomicità, claims e `next_id`.

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conBlocco, senzaBlocco } from '../core/blocco.ts'
import { esegui, SO } from '../core/platform.ts'

// `esegui` invece di un `promisify(execFile)` locale: nasconde la finestra su Windows.
// Vedi `core/platform.ts` — era la stessa opzione dimenticata in quindici punti.
const run = esegui

/** Un task della board, come lo espone `kanban-md list --json`. */
export type BoardTask = {
  id: number
  title: string
  status: string
  priority?: string
  assignee?: string
  tags?: string[]
  due?: string
  estimate?: string
  class?: string
  claimed_by?: string
  blocked?: string
  created?: string
  updated?: string
  body?: string
}

/** Una colonna della board: uno status con le sue card, nell'ordine del config. */
export type BoardColumn = {
  status: string
  tasks: BoardTask[]
}

export type Board = {
  cwd: string
  name?: string
  columns: BoardColumn[]
  /** Il file non c'è: diverso da «c'è ed è vuoto», e la UI lo dice diversamente. */
  assente: boolean
  /** Il binario di kanban-md non si trova: la UI spiega come si installa. */
  binarioMancante: boolean
  motivo?: string
}

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

/**
 * Dove sta il binario di kanban-md.
 *
 * Prima la copia **bundlata** dall'installer, con percorso assoluto — è la lezione di
 * Tailscale su macOS: il `PATH` non è affidabile, e un percorso assoluto non dipende da
 * com'è messa la shell di chi ha lanciato il daemon. Il daemon gira da `RADICE` (la
 * cartella dell'app), quindi `..` è la cartella di installazione di STARK, accanto a
 * `node/`. In coda il nome nudo, che è la via normale quando il binario sta già nel
 * `PATH` dell'utente.
 *
 * I percorsi assoluti si tengono solo se esistono — il filesystem risponde gratis,
 * mentre un `execFile` andato a vuoto costa un processo e un timeout. I nomi nudi
 * restano sempre: il `PATH` è comunque la via normale.
 */
export function binarioKanban(): string {
  const esteso = SO === 'windows' ? '.exe' : ''
  const candidati = [
    resolve(process.cwd(), '..', 'bin', `kanban-md${esteso}`),
    `kanban-md${esteso}`,
  ]
  const assoluto = (c: string): boolean => c.includes('/') || c.includes('\\')
  // Prima la copia bundlata se esiste; altrimenti il nome nudo, che il `PATH` risolve.
  return candidati.find(c => !assoluto(c) || existsSync(c)) ?? `kanban-md${esteso}`
}

/** Il binario scelto è un percorso assoluto che non esiste: manca davvero. */
function binarioMancante(): boolean {
  const bin = binarioKanban()
  return (bin.includes('/') || bin.includes('\\')) && !existsSync(bin)
}

/** Gli argomenti comuni a ogni comando: la cartella della board. */
const dir = (cwd: string): string[] => ['--dir', boardDir(cwd)]

/** Esegue kanban-md e restituisce stdout, o `null` se il binario non c'è o fallisce. */
async function kanban(cwd: string, args: readonly string[]): Promise<string | null> {
  if (binarioMancante()) return null
  try {
    const { stdout } = await run(binarioKanban(), [...dir(cwd), ...args], { timeout: 15_000 })
    return stdout
  } catch {
    return null
  }
}

/**
 * Legge la board e ne tiene solo ciò che ha una forma sensata.
 *
 * Le colonne vengono dall'ordine dichiarato nel `config.yml` (via `board --json`): è
 * l'unica fonte che dice l'ordine vero e che include anche le colonne vuote. Le card
 * vengono da `list --json`. Due processi per lettura: la board non si legge a ogni
 * token, quindi il costo non conta.
 *
 * Se `board --json` fallisce ma `list --json` no, le colonne si ricostruiscono dagli
 * status presenti nelle card: meglio una board senza l'ordine giusto che una vuota.
 */
export async function leggiBoard(cwd: string): Promise<Board> {
  const vuota: Board = { cwd, columns: [], assente: false, binarioMancante: false }
  if (!cwd) return { ...vuota, assente: true }
  const dirBoard = boardDir(cwd)
  if (!existsSync(dirBoard)) return { ...vuota, assente: true }

  if (binarioMancante()) {
    return { ...vuota, binarioMancante: true }
  }

  // C'è una board: assicura che la skill ci sia, così gli agent la usano di default.
  installaSkillKanban(cwd)

  const [boardJson, listJson] = await Promise.all([
    kanban(cwd, ['board', '--json']),
    kanban(cwd, ['list', '--json']),
  ])

  let ordine: string[] = []
  let nome: string | undefined
  if (boardJson) {
    try {
      const b = JSON.parse(boardJson) as { board_name?: string; statuses?: { status: string }[] }
      nome = b.board_name
      ordine = (b.statuses ?? []).map(s => s.status)
    } catch { /* la board resta senza ordine: si ricostruisce dalle card */ }
  }

  let tasks: BoardTask[] = []
  if (listJson) {
    try {
      const arr = JSON.parse(listJson) as unknown
      if (Array.isArray(arr)) tasks = arr as BoardTask[]
    } catch { /* sotto */ }
  }

  if (ordine.length === 0) {
    ordine = [...new Set(tasks.map(t => t.status))]
  }
  const perStato = new Map<string, BoardTask[]>()
  for (const t of tasks) {
    const l = perStato.get(t.status) ?? []
    l.push(t)
    perStato.set(t.status, l)
  }
  const columns = ordine.map(status => ({ status, tasks: perStato.get(status) ?? [] }))

  return { cwd, name: nome, columns, assente: false, binarioMancante: false }
}

/**
 * Avvisa quando la board cambia.
 *
 * Si guarda la **cartella** `.stark/kanban`, non un file: chi scrive lo fa in modo
 * atomico — temporaneo più `rename` — e un watch appeso a un file seguirebbe l'inode
 * vecchio e si romperebbe in silenzio (stessa ragione di `guardaTodo`).
 *
 * Se la cartella non esiste ancora — il caso normale prima della prima board — si
 * guarda `.stark/`, aspettando che compaia. Il timer resta come rete di sicurezza,
 * perché `fs.watch` su una cartella non è ugualmente affidabile su tutti i filesystem.
 */
export function guardaBoard(cwd: string, quando: () => void): () => void {
  const dirBoard = boardDir(cwd)
  let w: FSWatcher | null = null
  let attesa: FSWatcher | null = null
  let riprova: ReturnType<typeof setInterval> | null = null
  let chiuso = false

  const attacca = (): boolean => {
    if (!existsSync(dirBoard)) return false
    try {
      w = watch(dirBoard, (_evento, nome) => { quando() })
      w.on('error', () => { w?.close(); w = null })
      return true
    } catch { return false }
  }

  const arrivata = (): void => {
    if (chiuso || w) return
    if (!attacca()) return
    if (riprova) { clearInterval(riprova); riprova = null }
    attesa?.close(); attesa = null
    quando()
  }

  if (!attacca()) {
    try {
      const padre = resolve(cwd, '.stark')
      attesa = watch(padre, (_e, nome) => { if (nome === null || nome === 'kanban') arrivata() })
      attesa.on('error', () => { attesa?.close(); attesa = null })
    } catch { /* la cartella può essere sparita: ci pensa il timer */ }
    riprova = setInterval(() => { if (!chiuso) arrivata() }, 3000)
    riprova.unref?.()
  }

  return () => {
    chiuso = true
    if (riprova) clearInterval(riprova)
    attesa?.close()
    w?.close()
  }
}

/** Inizializza la board di un progetto (`kanban-md init`). Non interattivo: `n` al prompt. */
export async function initBoard(cwd: string, nome?: string): Promise<{ ok: boolean; motivo?: string }> {
  if (binarioMancante()) return { ok: false, motivo: 'binario mancante' }
  const bin = binarioKanban()
  const args = [...dir(cwd), 'init', '--statuses', 'backlog,todo,in-progress,review,done,archived']
  if (nome) args.push('--name', nome)
  try {
    const figlio = execFile(bin, args, { timeout: 15_000, windowsHide: true }, () => {})
    // Il prompt «Add kanban/ to .gitignore?» aspetta una risposta: la diamo noi, «no».
    figlio.stdin?.end()
    await new Promise<void>(r => figlio.on('close', () => r()))
    installaSkillKanban(cwd)
    return { ok: true }
  } catch (e) {
    return { ok: false, motivo: String((e as Error).message ?? e) }
  }
}

/** Crea una card (`kanban-md create`). Il titolo va come argomento, mai nella shell. */
export async function creaTask(
  cwd: string,
  input: { title: string; priority?: string; body?: string },
): Promise<{ ok: boolean; motivo?: string }> {
  if (binarioMancante()) return { ok: false, motivo: 'binario mancante' }
  const bin = binarioKanban()
  const args = [...dir(cwd), 'create', input.title]
  if (input.priority) args.push('--priority', input.priority)
  if (input.body) args.push('--body', input.body)
  try {
    await run(bin, args, { timeout: 15_000 })
    return { ok: true }
  } catch (e) {
    return { ok: false, motivo: String((e as Error).message ?? e) }
  }
}

/** Modifica una card (`kanban-md edit`). L'id si valida prima di passarlo al CLI. */
export async function modificaTask(
  cwd: string,
  id: number,
  input: { status?: string; title?: string; priority?: string },
): Promise<{ ok: boolean; motivo?: string }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, motivo: 'id non valido' }
  if (binarioMancante()) return { ok: false, motivo: 'binario mancante' }
  const bin = binarioKanban()
  const args = [...dir(cwd), 'edit', String(id)]
  if (input.status) args.push('--status', input.status)
  if (input.title) args.push('--title', input.title)
  if (input.priority) args.push('--priority', input.priority)
  try {
    await run(bin, args, { timeout: 15_000 })
    return { ok: true }
  } catch (e) {
    return { ok: false, motivo: String((e as Error).message ?? e) }
  }
}
