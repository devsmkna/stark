// Le liste di task che l'agent scrive in `.stark/todo.json`, dentro il progetto.
//
// **Perché non stanno nello `SessionSnapshot`.** L'invariante §4 dice che lo stato si
// ricostruisce interamente rileggendo il journal. Questo file no: lo scrive l'agent sul
// disco, fuori dal flusso di eventi. Metterlo nello snapshot vorrebbe dire che al
// risveglio da journal la lista tornerebbe vuota, e nessuno capirebbe perché. È una
// risorsa a parte, come lo spazio su disco o le cartelle da sfogliare.
//
// **Perché è del progetto e non della chat.** Il file sta accanto al codice, quindi due
// conversazioni sulla stessa cartella vedono la stessa lista — che è quello che ci si
// aspetta da una barra che sta sempre lì. È anche il motivo per cui il `cwd` lo risolve
// il daemon a partire dall'id della sessione: una rotta che accettasse un percorso dal
// browser sarebbe «leggi un file in qualunque cartella di questa macchina», un primitivo
// più grosso di quello che serve (stessa ragione dei suggerimenti `@` in `registry.ts`).

import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'

export type TodoTask = {
  id: string
  text: string
  state: 'todo' | 'doing' | 'done' | 'blocked'
  note?: string
}

export type TodoList = {
  id: string
  title: string
  created?: number
  status: 'active' | 'paused' | 'done' | 'abandoned'
  tasks: TodoTask[]
}

export type TodoFile = {
  /** Le liste, ordinate come vanno mostrate: prima quelle vive, poi le più recenti. */
  lists: TodoList[]
  /** Quante voci sono state scartate perché malformate, e il perché della prima. */
  scartate: number
  motivo?: string
  /** Il file non c'è: diverso da «c'è ed è vuoto», e la UI lo dice diversamente. */
  assente: boolean
}

const STATI_TASK = new Set(['todo', 'doing', 'done', 'blocked'])
const STATI_LISTA = new Set(['active', 'paused', 'done', 'abandoned'])
/** Vive in cima, chiusa in fondo. Dentro ogni gruppo decide `created`. */
const PESO: Record<string, number> = { active: 0, paused: 1, done: 2, abandoned: 3 }

export const todoPath = (cwd: string): string => resolve(cwd, '.stark', 'todo.json')

/**
 * Legge il file e ne tiene solo ciò che ha una forma sensata.
 *
 * Una lista malformata si **salta**, non fa fallire la lettura: il file lo scrive un
 * modello, e un campo sbagliato in fondo non deve far sparire dalla barra le nove liste
 * scritte bene. Quante ne sono state scartate però si dice, o l'errore diventa invisibile
 * proprio a chi potrebbe correggerlo.
 */
export function leggiTodo(cwd: string | undefined): TodoFile {
  const vuoto: TodoFile = { lists: [], scartate: 0, assente: true }
  if (!cwd) return vuoto
  const path = todoPath(cwd)
  if (!existsSync(path)) return vuoto

  let grezzo: unknown
  try {
    grezzo = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    // Un file scritto a metà si legge così per una frazione di secondo. Non è un guasto:
    // è il motivo per cui lo script scrive su un temporaneo e poi rinomina.
    return { lists: [], scartate: 0, assente: false, motivo: `todo.json non è JSON valido: ${(e as Error).message}` }
  }
  if (typeof grezzo !== 'object' || grezzo === null || Array.isArray(grezzo)) {
    return { lists: [], scartate: 0, assente: false, motivo: 'todo.json non è una mappa id → lista' }
  }

  const lists: TodoList[] = []
  let scartate = 0
  let motivo: string | undefined
  for (const [id, v] of Object.entries(grezzo as Record<string, unknown>)) {
    const l = v as Record<string, unknown> | null
    if (typeof l !== 'object' || l === null || !Array.isArray(l['tasks'])) {
      scartate++
      motivo ??= `la lista «${id}» non ha un elenco di task`
      continue
    }
    const status = String(l['__status'] ?? 'active')
    lists.push({
      id,
      title: typeof l['title'] === 'string' && l['title'] !== '' ? l['title'] : '(senza titolo)',
      ...(typeof l['created'] === 'number' ? { created: l['created'] } : {}),
      status: (STATI_LISTA.has(status) ? status : 'active') as TodoList['status'],
      tasks: (l['tasks'] as unknown[]).flatMap((t): TodoTask[] => {
        const x = t as Record<string, unknown> | null
        if (typeof x !== 'object' || x === null || typeof x['text'] !== 'string') return []
        const st = String(x['state'] ?? 'todo')
        return [{
          id: String(x['id'] ?? ''),
          text: x['text'],
          state: (STATI_TASK.has(st) ? st : 'todo') as TodoTask['state'],
          ...(typeof x['note'] === 'string' && x['note'] !== '' ? { note: x['note'] } : {}),
        }]
      }),
    })
  }

  lists.sort((a, b) =>
    (PESO[a.status] ?? 9) - (PESO[b.status] ?? 9) || (b.created ?? 0) - (a.created ?? 0))
  return { lists, scartate, assente: false, ...(motivo ? { motivo } : {}) }
}

/**
 * Avvisa quando il file cambia.
 *
 * Si guarda la **cartella** `.stark`, non il file. Non è un dettaglio: chi scrive quel
 * file lo fa in modo atomico — temporaneo più `rename` — così un lettore non vede mai
 * mezzo JSON. Ma un `rename` sostituisce l'inode, e un watch appeso al file seguirebbe
 * quello vecchio: continuerebbe a girare senza dire più niente, cioè si romperebbe
 * **in silenzio**, che è il modo peggiore.
 *
 * Se `.stark/` non esiste ancora — il caso normale prima della prima lista — si guarda
 * **la cartella del progetto**, aspettando che compaia: così la prima lista appare subito
 * invece che al prossimo giro di un timer. Il timer resta come rete di sicurezza, perché
 * `fs.watch` su una cartella non è ugualmente affidabile su tutti i filesystem (su una
 * cartella di rete, o su un mount DrvFs come quello del fisso, può non dire niente).
 */
export function guardaTodo(cwd: string, quando: () => void): () => void {
  const dir = resolve(cwd, '.stark')
  let w: FSWatcher | null = null
  /** Guarda la cartella del progetto finché `.stark` non nasce. */
  let attesa: FSWatcher | null = null
  let riprova: ReturnType<typeof setInterval> | null = null
  let chiuso = false

  const attacca = (): boolean => {
    if (!existsSync(dir)) return false
    try {
      w = watch(dir, (_evento, nome) => {
        if (nome === null || nome === 'todo.json') quando()
      })
      // Un watcher che muore (cartella cancellata) non deve portarsi dietro il processo.
      w.on('error', () => { w?.close(); w = null })
      return true
    } catch { return false }
  }

  const arrivata = (): void => {
    if (chiuso || w) return
    if (!attacca()) return
    if (riprova) { clearInterval(riprova); riprova = null }
    attesa?.close(); attesa = null
    // La cartella è appena comparsa: dentro potrebbe già esserci il file.
    quando()
  }

  if (!attacca()) {
    try {
      attesa = watch(cwd, (_e, nome) => { if (nome === null || nome === '.stark') arrivata() })
      attesa.on('error', () => { attesa?.close(); attesa = null })
    } catch { /* la cartella del progetto può essere sparita: ci pensa il timer */ }
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
