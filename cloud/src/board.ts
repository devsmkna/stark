// La board cloud di STARK: un kanban per progetto, su Postgres.
//
// Sostituisce il motore file-based `kanban-md` che girava sul daemon locale: qui la
// board vive nel DB, la fonte ufficiale è il server cloud, e il daemon locale è solo
// un proxy. La UI continua a parlare col daemon, che inoltra.
//
// La superficie (`Board`, `BoardTask`) replica quella che il daemon esponeva, così il
// proxy non deve tradurre il formato: cambia solo la provenienza dei dati.
//
// Il claim è **per utente cloud** (l'email di chi è loggato) e non scade: resta finché
// non si rilascia. L'ordine delle card è un `position` esplicito per colonna.

import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from './db/client.ts'
import { activity, boardConfig, projects, tasks } from './db/schema.ts'

const db = drizzle(sql)

/** Un task della board, come lo vede la UI. */
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
  origin: string
  name?: string
  columns: BoardColumn[]
  /** La board non c'è ancora (nessun progetto con questo origin). */
  assente: boolean
  motivo?: string
}

/** Gli status di default, nell'ordine delle colonne. */
const STATUS_DEFAULT = ['backlog', 'todo', 'in-progress', 'review', 'done', 'archived']
const PRIORITY_DEFAULT = ['low', 'medium', 'high', 'critical']

/** Trova il progetto dall'origin, o `null`. */
async function trovaProgetto(origin: string): Promise<typeof projects.$inferSelect | null> {
  const [p] = await db.select().from(projects).where(eq(projects.origin, origin))
  return p ?? null
}

/** Crea il progetto se non c'è, con la sua config di default. */
async function assicuraProgetto(origin: string, nome?: string): Promise<typeof projects.$inferSelect> {
  const esistente = await trovaProgetto(origin)
  if (esistente) return esistente
  const [p] = await db.insert(projects).values({ origin, name: nome }).returning()
  if (!p) throw new Error('progetto non creato')
  await db.insert(boardConfig).values({
    projectId: p.id,
    statuses: STATUS_DEFAULT,
    priorities: PRIORITY_DEFAULT,
    wipLimits: {},
    classes: [],
  })
  return p
}

/** Converte una riga `tasks` nel formato `BoardTask` che la UI si aspetta. */
function aBoardTask(t: typeof tasks.$inferSelect): BoardTask {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? undefined,
    assignee: t.assignee ?? undefined,
    class: t.class ?? undefined,
    claimed_by: t.claimedBy ?? undefined,
    blocked: t.blocked ?? undefined,
    due: t.due ? new Date(t.due).toISOString() : undefined,
    estimate: t.estimate ?? undefined,
    created: new Date(t.createdAt).toISOString(),
    updated: new Date(t.updatedAt).toISOString(),
    body: t.body ?? undefined,
  }
}

/** Registra un'azione nel log attività. */
async function logga(projectId: string, actor: string, action: string, taskId?: number): Promise<void> {
  await db.insert(activity).values({ projectId, actor, action, taskId })
}

/** Legge la board di un progetto, ordinata per colonna e per `position`. */
export async function leggiBoard(origin: string): Promise<Board> {
  const p = await trovaProgetto(origin)
  if (!p) return { origin, columns: [], assente: true }

  const [conf, lista] = await Promise.all([
    db.select().from(boardConfig).where(eq(boardConfig.projectId, p.id)),
    db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.position), asc(tasks.createdAt)),
  ])

  const ordine = (conf[0]?.statuses as string[] | undefined) ?? STATUS_DEFAULT
  const perStato = new Map<string, BoardTask[]>()
  for (const t of lista) {
    const l = perStato.get(t.status) ?? []
    l.push(aBoardTask(t))
    perStato.set(t.status, l)
  }
  const columns = ordine.map(status => ({ status, tasks: perStato.get(status) ?? [] }))

  return { origin, name: p.name ?? undefined, columns, assente: false }
}

/** Crea la board di un progetto se non c'è. */
export async function initBoard(origin: string, nome?: string): Promise<{ ok: boolean; motivo?: string }> {
  await assicuraProgetto(origin, nome)
  return { ok: true }
}

/** Crea una card, in fondo alla colonna `backlog`. */
export async function creaTask(
  origin: string,
  actor: string,
  input: { title: string; priority?: string; body?: string },
): Promise<{ ok: boolean; motivo?: string; id?: number }> {
  const p = await assicuraProgetto(origin)
  const ultima = await db
    .select({ position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.status, 'backlog')))
    .orderBy(asc(tasks.position))
  const position = ultima.length > 0 ? (ultima[ultima.length - 1]!.position + 1) : 0

  const [t] = await db.insert(tasks).values({
    projectId: p.id,
    title: input.title.slice(0, 500),
    status: 'backlog',
    priority: input.priority,
    body: input.body,
    position,
  }).returning()
  if (!t) return { ok: false, motivo: 'task non creato' }

  await logga(p.id, actor, 'creato', t.id)
  return { ok: true, id: t.id }
}

/** Modifica una card: stato, titolo, priorità, claim, posizione. */
export async function modificaTask(
  origin: string,
  actor: string,
  id: number,
  input: {
    status?: string
    title?: string
    priority?: string
    claimed_by?: string
    position?: number
  },
): Promise<{ ok: boolean; motivo?: string }> {
  const p = await trovaProgetto(origin)
  if (!p) return { ok: false, motivo: 'progetto non trovato' }

  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.id, id)))
  if (!t) return { ok: false, motivo: 'task non trovato' }

  const patch: Partial<typeof tasks.$inferInsert> = {}
  if (input.status !== undefined) patch.status = input.status
  if (input.title !== undefined) patch.title = input.title
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.position !== undefined) patch.position = input.position
  if (input.claimed_by !== undefined) {
    // Claim per utente cloud: si assegna (email) o si rilascia (null).
    patch.claimedBy = input.claimed_by || null
    patch.claimedAt = input.claimed_by ? new Date() : null
  }
  patch.updatedAt = new Date()
  await db.update(tasks).set(patch).where(eq(tasks.id, id))

  await logga(p.id, actor, 'modificato', id)
  return { ok: true }
}
