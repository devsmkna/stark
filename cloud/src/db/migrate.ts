// Applica le migrazioni progressive e cumulative al database.
//
// Drizzle tiene traccia di cosa è già stato applicato in `__drizzle_migrations` e
// applica solo quelle mancanti, in ordine. È idempotente: si può lanciare a ogni
// avvio del server senza paura.
//
//   npm run db:migrate

import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from './client.ts'

async function main(): Promise<void> {
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './src/db/migrations' })
  console.log('migrazioni applicate')
  await sql.end()
}

main().catch((e) => {
  console.error('migrazione fallita:', e)
  process.exit(1)
})
