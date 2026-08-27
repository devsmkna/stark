// Il server di OpenCode: uno per macchina, N conversazioni dentro.
//
// ─── La differenza strutturale col primo adapter ────────────────────────────
//
// Claude Code: **un processo per conversazione**, avviato dall'Agent SDK. Una chat che
// dorme e' un processo che non c'e' piu'.
// OpenCode: **un server per macchina**, e le conversazioni sono righe in un SQLite suo.
// Una chat che dorme e' semplicemente una a cui STARK ha smesso di guardare.
//
// Questo file esiste per tenere quella differenza **dentro l'adapter**. Sopra il
// confine del §1 nessuno deve sapere che qui c'e' un server condiviso: `open()` torna
// una `AgentSession` come per Claude Code, e chi la chiude non sa se ha fermato un
// processo o solo smesso di ascoltare. E' la prima verifica vera del contratto scritto
// stamattina, ed e' la domanda per cui ADR-012 esiste.
//
// Il server lo avvia l'SDK ufficiale (`createOpencodeServer`), non uno `spawn` nostro:
// stessa ragione di ADR-009/ADR-013.

import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'

type Server = { url: string; close(): void }

let acceso: Promise<Server> | null = null
let quante = 0

/**
 * L'indirizzo del server, avviandolo se non c'e'.
 *
 * La promessa si memorizza **prima** di essere risolta: due sessioni aperte nello
 * stesso istante devono trovare lo stesso server, non avviarne due. E' lo stesso
 * motivo per cui non basta un `if (!acceso)` attorno a un `await`.
 */
async function server(): Promise<Server> {
  if (!acceso) {
    acceso = createOpencodeServer({ hostname: '127.0.0.1', port: 0 }).catch(e => {
      // Un avvio fallito non deve restare memorizzato: la prossima apertura
      // ritenterebbe leggendo una promessa gia' rotta e fallirebbe per sempre.
      acceso = null
      throw e
    })
  }
  return acceso
}

/** Un client legato a una cartella. Il server e' condiviso, la cartella no. */
export async function clientPer(cwd: string) {
  const s = await server()
  quante++
  return createOpencodeClient({ baseUrl: s.url, directory: cwd })
}

/**
 * Una conversazione in meno. L'ultima spegne il server.
 *
 * Spegnerlo non perde niente — lo stato delle conversazioni sta nel database di
 * OpenCode, non nel processo — ed e' la ragione per cui qui si puo' fare quello che
 * su Claude Code sarebbe distruttivo.
 */
export function lascia(): void {
  if (--quante > 0) return
  quante = 0
  const s = acceso
  acceso = null
  void s?.then(x => { try { x.close() } catch { /* stava gia' morendo */ } })
    .catch(() => { /* non era mai partito */ })
}

/** Solo per le prove: quante conversazioni tengono in vita il server. */
export const quanteVive = (): number => quante
