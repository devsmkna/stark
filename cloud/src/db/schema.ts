// Schema del database cloud di STARK, in Drizzle.
//
// Tabelle: `users` e `sessions` (l'autenticazione), più la board cloud: `projects`,
// `tasks`, `board_config` e `activity`. Lo schema è la fonte di verità per
// `drizzle-kit generate`: ogni modifica qui produce una nuova migrazione progressiva.

import {
  integer, jsonb, pgTable, text, timestamp, uuid,
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
