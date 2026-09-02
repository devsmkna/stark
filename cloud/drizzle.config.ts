// Configurazione di drizzle-kit: dove sta lo schema, dove finiscono le migrazioni.
//
// Le migrazioni sono **progressive e cumulative**: ogni file in `src/db/migrations`
// si applica in ordine sopra il precedente, e lo stato applicato sta in una tabella
// `__drizzle_migrations` nel DB. Per crearne una nuova:
//
//   npm run db:generate   # confronta lo schema con l'ultima migrazione e ne genera una
//   npm run db:migrate    # la applica al DB (cumulativa)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://stark:stark@localhost:5432/stark',
  },
  verbose: true,
  strict: true,
})
