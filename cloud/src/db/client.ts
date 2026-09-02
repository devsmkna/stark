// Il client del database cloud: un'unica connessione postgres, condivisa da tutto
// il server. L'indirizzo viene da DATABASE_URL (default per lo sviluppo locale).

import postgres from 'postgres'

export const url = (): string =>
  process.env['DATABASE_URL'] ?? 'postgres://stark:stark@localhost:5432/stark'

export const sql = postgres(url(), { max: 10 })
