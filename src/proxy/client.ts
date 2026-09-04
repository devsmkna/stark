// Il client che gli adapter usano per registrarsi presso il proxy dell'anonimizzazione
// e per deregistrarsi alla chiusura. Vive fuori dal daemon e dagli adapter perché è la
// stessa chiamata per chiunque voglia instradare una sessione — oggi Claude Code e
// OpenCode, domani un terzo adapter la userebbe identica (D37: il motore è condiviso,
// l'aggancio è dell'adapter, ma la CHIAMATA al proxy è comune).
//
// Sempre best-effort, e va detto perché non è ovvio: la modalità ombra osserva, non
// protegge ancora nessuno (D38 resta per la protezione vera, dietro la semina). Se il
// proxy non risponde entro pochi millisecondi la sessione parte lo stesso, senza
// osservazione questa volta — non è il fail-closed di §4bis, che arriva col filtro vero
// sui progetti protetti. Un OpenCode che aspettasse il proxy prima di aprire il server
// condiviso lo farebbe per OGNI conversazione sulla macchina, non per una sola: qui il
// costo di un proxy lento o giù dev'essere quasi zero, non un'attesa.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { PORTA_PROXY } from './server.ts'

/** Il tetto oltre il quale si rinuncia: una chiamata locale a 127.0.0.1 che non torna
 *  in questo tempo è un proxy giù o piantato, non uno lento — si procede senza. */
const ATTESA_MS = 800

const portaProxy = (): number => Number(process.env['STARK_PROXY_PORT'] ?? PORTA_PROXY)
const home = (): string => process.env['STARK_HOME'] ?? resolve(homedir(), '.stark')

/** Lo stesso token del daemon: registrare una sessione è un potere (chi può farlo può
 *  far instradare traffico verso l'upstream che vuole), quindi vale la stessa guardia
 *  con cui si parla al daemon. Nessun token, nessuna registrazione — non un errore. */
function token(): string | null {
  try {
    const t = readFileSync(resolve(home(), 'token'), 'utf8').trim()
    return t || null
  } catch {
    return null
  }
}

/**
 * Registra una sessione presso il proxy e torna la base URL da passare all'agent
 * (`http://127.0.0.1:<porta>/s/<id>`), o `null` se il proxy non ha risposto in tempo o
 * ha rifiutato. `null` non è un errore da propagare: chi chiama fa partire la sessione
 * senza osservazione, non la blocca — vedi la nota in testa al file.
 */
export async function registraSessione(id: string, upstream: string): Promise<string | null> {
  const tok = token()
  if (!tok) return null
  try {
    const r = await fetch(`http://127.0.0.1:${portaProxy()}/control/sessioni`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, upstream }),
      signal: AbortSignal.timeout(ATTESA_MS),
    })
    if (!r.ok) return null
    const corpo = await r.json() as { prefisso?: unknown }
    return typeof corpo.prefisso === 'string' ? `http://127.0.0.1:${portaProxy()}${corpo.prefisso}` : null
  } catch {
    return null
  }
}

/**
 * Toglie la sessione. Silenziosa di proposito: alla chiusura non c'è nessuno a cui
 * riferire un errore di rete, e un fallimento qui vuol dire solo che una riga resta
 * nella mappa del proxy finché non riparte — nessun dato in più esce, nessuna sessione
 * viva si rompe.
 */
export async function deregistraSessione(id: string): Promise<void> {
  const tok = token()
  if (!tok) return
  try {
    await fetch(`http://127.0.0.1:${portaProxy()}/control/sessioni/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(ATTESA_MS),
    })
  } catch { /* silenzioso, vedi sopra */ }
}
