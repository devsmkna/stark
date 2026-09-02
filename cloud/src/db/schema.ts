// Schema del database cloud di STARK, in Drizzle.
//
// Due tabelle per ora: `users` (gli account) e `sessions` (i token opachi).
// Lo schema è la fonte di verità per `drizzle-kit generate`: ogni modifica qui
// produce una nuova migrazione progressiva.

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
