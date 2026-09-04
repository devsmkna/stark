// Schema del database cloud di STARK, in Drizzle.
//
// Tabelle: `users` e `sessions` (l'autenticazione), la board cloud (`projects`,
// `tasks`, `board_config`, `activity`) e l'uso unito fra i dispositivi (`machines`,
// `usage_daily`, `usage_session_days`). Lo schema è la fonte di verità per
// `drizzle-kit generate`: ogni modifica qui produce una nuova migrazione progressiva.

import {
  bigint, date, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'

/** Un account: email e hash della password. Mai la password in chiaro. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Una sessione: il token opaco e a chi appartiene. */
export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Un progetto cloud: la board appartiene a un progetto, identificato dall'`origin`
 * della repo git — l'unico ID stabile che due macchine (o due colleghi) condividono.
 * Il path locale non va bene: cambia da macchina a macchina.
 */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  origin: text('origin').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Una card della board: un task del progetto. */
export const tasks = pgTable('tasks', {
  // `serial` e non uuid: la UI usa l'id come **numero** (lo passa a `/board/task/<n>/edit`),
  // e il proxy non deve mappare uuid↔numero. Stessa scelta di kanban-md.
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull(),
  priority: text('priority'),
  class: text('class'),
  assignee: text('assignee'),
  /** Chi ha il claim: l'email cloud. Non scade: resta finché non si rilascia. */
  claimedBy: text('claimed_by'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  blocked: text('blocked'),
  due: timestamp('due', { withTimezone: true }),
  estimate: text('estimate'),
  body: text('body'),
  /** L'ordine dentro la colonna (drag & drop). */
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** La config della board di un progetto: colonne, priorità, limiti, classi. */
export const boardConfig = pgTable('board_config', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  statuses: jsonb('statuses').notNull(),
  priorities: jsonb('priorities').notNull(),
  wipLimits: jsonb('wip_limits').notNull(),
  classes: jsonb('classes').notNull(),
})

/** Il log attività della board: chi ha fatto cosa, e quando. */
export const activity = pgTable('activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  taskId: integer('task_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── l'uso di STARK, unito fra i dispositivi ────────────────────────────────
//
// Le statistiche di `Settings → Usage` nascono in locale (`src/core/stats.ts`) e
// vedono solo la macchina su cui girano: i journal non si sincronizzano. Qui si
// uniscono, **per utente e solo per lui** — non c'è nessuna classifica e nessun
// confronto fra account, ed è una scelta presa il 4 settembre 2026, non una cosa
// rimasta indietro. Chi guarda queste tabelle vedrà che il pezzo mancante sarebbe
// piccolo: sappia che manca apposta.

/**
 * Un dispositivo dell'utente.
 *
 * `machineKey` è un uuid opaco che nasce in `~/.stark/machine-id`; `label` è
 * l'hostname, cioè una cosa da mostrare — rinominare il portatile non deve spezzare
 * lo storico in due macchine.
 */
export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineKey: text('machine_key').notNull(),
  label: text('label').notNull(),
  platform: text('platform'),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('machines_user_key').on(t.userId, t.machineKey)])

/**
 * Una riga di uso: un giorno, un dispositivo, un progetto, un agent, un modello.
 *
 * **La macchina sta nella chiave**, e senza di lei il resto non funziona: tre
 * macchine che scrivessero lo stesso `(giorno, progetto, agent, modello)` si
 * sovrascriverebbero a vicenda, e il totale diventerebbe quello dell'ultima che ha
 * parlato invece della somma. L'alternativa erano i delta sommanti, che però
 * chiedono un registro locale di «cosa ho già mandato» più una deduplicazione qui:
 * uno stato in più da tenere allineato alla realtà, che al primo ritentativo dopo
 * una risposta persa sbaglia in silenzio.
 *
 * Così invece la riga si riscrive **intera** a ogni invio: è sempre lo stato
 * completo che `statsFrom()` ricalcola da zero, mai un incremento. Ripeterlo mille
 * volte dà lo stesso risultato, quindi non servono code né ritentativi.
 *
 * `project_key` è l'**origin git**, non il percorso: lo stesso progetto sta in
 * `/mnt/m/...` sul fisso e in `/Users/...` sul MacBook, e sommato per percorso
 * comparirebbe due volte in «By project». `project_label` è solo il nome da
 * mostrare, e l'ultimo invio vince.
 */
export const usageDaily = pgTable('usage_daily', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  /** `YYYY-MM-DD` nel fuso della macchina che ha lavorato. Non si converte in UTC:
   *  un turno delle 23:30 appartiene a quella giornata lì, ed è la stessa regola di
   *  `giorno()` in `src/core/stats.ts`. */
  day: date('day', { mode: 'string' }).notNull(),
  projectKey: text('project_key').notNull(),
  projectLabel: text('project_label'),
  agent: text('agent').notNull(),
  model: text('model').notNull(),

  conversations: integer('conversations').notNull().default(0),
  prompts: integer('prompts').notNull().default(0),
  // `bigint` e non `integer` su caratteri, millisecondi e token: `integer` si ferma a
  // 2,1 miliardi, e i token di cache read li superano in qualche mese. In modalità
  // `number` il limite vero diventa 2^53, che nessun uso umano raggiunge.
  chars: bigint('chars', { mode: 'number' }).notNull().default(0),
  agentMs: bigint('agent_ms', { mode: 'number' }).notNull().default(0),
  tools: integer('tools').notNull().default(0),
  files: integer('files').notNull().default(0),
  commands: integer('commands').notNull().default(0),
  aborted: integer('aborted').notNull().default(0),
  errored: integer('errored').notNull().default(0),
  interrupted: integer('interrupted').notNull().default(0),
  tokIn: bigint('tok_in', { mode: 'number' }).notNull().default(0),
  tokOut: bigint('tok_out', { mode: 'number' }).notNull().default(0),
  tokCacheRead: bigint('tok_cache_read', { mode: 'number' }).notNull().default(0),
  tokCacheWrite: bigint('tok_cache_write', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({
  columns: [t.userId, t.machineId, t.day, t.projectKey, t.agent, t.model],
})])

/**
 * Quale conversazione era viva in quale giorno.
 *
 * Esiste per un numero solo, ma è uno dei quattro grandi in `Settings → Usage`:
 * tutte le colonne di `usage_daily` si sommano senza pensarci **tranne**
 * `conversations`. Una chat aperta lunedì e ripresa mercoledì è una conversazione,
 * ma sono due righe: sommandole il totale direbbe due. Con queste coppie il
 * conteggio diventa un `COUNT(DISTINCT session_id)`.
 *
 * Progetto, agent e modello sono ridondanti rispetto al `session_id` — una sessione
 * ne ha uno solo di ciascuno — e ci sono lo stesso: senza, il conteggio distinto si
 * potrebbe fare solo sul totale, e «quante conversazioni su questo progetto»
 * tornerebbe a essere gonfiabile.
 *
 * Costo dichiarato: sale un uuid di sessione, cioè un identificatore. Non contenuto.
 */
export const usageSessionDays = pgTable('usage_session_days', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  sessionId: text('session_id').notNull(),
  projectKey: text('project_key').notNull(),
  agent: text('agent').notNull(),
  model: text('model').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.machineId, t.day, t.sessionId] })])

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type BoardConfig = typeof boardConfig.$inferSelect
export type Activity = typeof activity.$inferSelect
export type Machine = typeof machines.$inferSelect
export type NewMachine = typeof machines.$inferInsert
export type UsageDaily = typeof usageDaily.$inferSelect
export type NewUsageDaily = typeof usageDaily.$inferInsert
export type UsageSessionDay = typeof usageSessionDays.$inferSelect
export type NewUsageSessionDay = typeof usageSessionDays.$inferInsert
