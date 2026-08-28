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
import { createOpencodeClient as createLegacyClient } from '@opencode-ai/sdk'

type Server = { url: string; close(): void }

let acceso: Promise<Server> | null = null
let quante = 0
/**
 * Il server **fuori** dalla promessa, e non e' un doppione.
 *
 * `process.on('exit')` e' l'ultimo istante utile e dev'essere **sincrono**: li' una
 * `Promise` non si aspetta piu', quindi `acceso` non basta a spegnere niente. Questo
 * riferimento si popola quando la promessa si risolve, ed e' l'unica cosa che quel
 * gestore puo' usare.
 */
let vivo: Server | null = null
let ac: AbortController | null = null
let agganciato = false

/**
 * Un server che sopravvive a chi l'ha acceso e' un processo da centinaia di MB che
 * nessuno spegnera' piu'.
 *
 * `close()` lo chiamava **solo** `lascia()`, cioe' solo quando l'ultima conversazione
 * se ne andava per la via buona. Basta che il processo padre muoia di schianto — un
 * crash, un `process.exit` in una sonda — perche' il figlio resti orfano: su POSIX
 * nessuno lo uccide, viene riadottato da init. Misurato il 27 agosto 2026: **dodici**
 * `opencode serve` accumulati in una giornata di prove, 300-900 MB l'uno.
 *
 * Due difese, che coprono casi diversi: il `signal` (l'SDK lo onora ammazzando il
 * figlio) e il gestore di `exit`, che scatta anche quando nessuno ha abortito niente.
 *
 * Cosa **non** copre, detto invece che scoperto dopo: un `SIGKILL`, e un `SIGTERM` in
 * un processo che non lo gestisce — li' `exit` non viene emesso affatto. La cura
 * ovvia (aggiungere qui un gestore di `SIGTERM`) e' peggiore del male: in Node
 * registrare un ascoltatore su un segnale **sopprime la terminazione di default**,
 * quindi questo file finirebbe per impedire a `stark stop` di fermare il daemon. Chi
 * gestisce i segnali lo fa gia' dove e' giusto (`cli/stark.ts`), e chiude chiamando
 * `process.exit`, che di `exit` passa.
 */
function agganciaUscita(): void {
  if (agganciato) return
  agganciato = true
  process.on('exit', () => {
    const s = vivo
    vivo = null; acceso = null; quante = 0
    try { s?.close() } catch { /* stava gia' morendo */ }
  })
}

/**
 * L'indirizzo del server, avviandolo se non c'e'.
 *
 * La promessa si memorizza **prima** di essere risolta: due sessioni aperte nello
 * stesso istante devono trovare lo stesso server, non avviarne due. E' lo stesso
 * motivo per cui non basta un `if (!acceso)` attorno a un `await`.
 */
async function server(): Promise<Server> {
  if (!acceso) {
    agganciaUscita()
    ac = new AbortController()
    acceso = createOpencodeServer({ hostname: '127.0.0.1', port: 0, signal: ac.signal })
      .then(s => { vivo = s; return s })
      .catch(e => {
        // Un avvio fallito non deve restare memorizzato: la prossima apertura
        // ritenterebbe leggendo una promessa gia' rotta e fallirebbe per sempre.
        acceso = null
        vivo = null
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
 * Il client **legacy** sullo stesso server, per far girare il turno.
 *
 * Non e' un ripiego ne' un doppione: sono due superfici dello stesso processo, e
 * servono a due cose diverse.
 *
 * `/v2` resta la porta per **descrivere** la macchina — l'elenco dei modelli, degli
 * agent, dei comandi, dei tool — ed e' li' che ADR-013 aveva ragione. Ma il suo runner
 * risolve i modelli in `model.available()`, che contiene i soli **gratuiti** (29 su 61,
 * misurato): scegliere uno degli altri apriva un turno che non partiva mai. Il runner
 * legacy li esegue tutti, e non e' una deduzione — il CLI attaccato a questo stesso
 * server esegue `gpt-5-nano`, e per la via legacy lo esegue anche STARK, con costo e
 * token veri nel database. Vedi ADR-015 e il capoccia di `translate.ts`.
 *
 * Non incrementa `quante`: chi apre una conversazione ha gia' chiamato `clientPer`, e
 * contarla due volte terrebbe in vita il server per sempre.
 */
export async function clientLegacyPer(cwd: string) {
  const s = await server()
  return createLegacyClient({ baseUrl: s.url, directory: cwd })
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
  vivo = null
  // L'abort e' la seconda via, non un doppione di `close()`: se il server sta ancora
  // **nascendo** (`createOpencodeServer` non ha ancora risolto) non c'e' nessun
  // `close()` da chiamare, e senza questo il figlio resterebbe su.
  ac?.abort(); ac = null
  void s?.then(x => { try { x.close() } catch { /* stava gia' morendo */ } })
    .catch(() => { /* non era mai partito */ })
}

/** Solo per le prove: quante conversazioni tengono in vita il server. */
export const quanteVive = (): number => quante
