// STARK esegue comandi arbitrari come root. Questo file è il perimetro.
//
// Un server in ascolto su localhost NON è protetto dal fatto di essere su localhost:
// qualunque pagina web aperta nel browser può mandargli richieste. Le tre difese qui
// sotto servono a tre attacchi diversi, e nessuna copre il buco delle altre.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export type Guard = {
  token: string
  /** Il motivo del rifiuto, oppure null se la richiesta può passare. */
  reject(req: IncomingMessage): string | null
}

export function createGuard(port: () => number): Guard {
  const token = randomBytes(32).toString('hex')

  return {
    token,
    reject(req) {
      // 1. Solo dalla macchina. Difesa di fondo: se l'ascolto finisse per sbaglio su
      //    0.0.0.0, questo resta in piedi.
      const addr = req.socket.remoteAddress ?? ''
      if (!isLocal(addr)) return `indirizzo non locale: ${addr}`

      // 2. Host. Difende dal DNS rebinding: un attaccante può far puntare il proprio
      //    dominio a 127.0.0.1, e a quel punto la sua pagina parla con noi come se
      //    fosse same-origin. L'unica cosa che non può falsificare è l'Host che il
      //    browser scrive, che resterebbe il suo dominio.
      const host = (req.headers.host ?? '').split(':')[0] ?? ''
      if (!isLocalHostname(host)) return `Host non locale: ${host}`

      // 3. Origin. Difende dalle richieste cross-site: una pagina su un altro sito che
      //    prova a parlare con noi porta il proprio Origin, e viene fermata qui.
      //    Assente va bene: le richieste non-browser non lo mandano.
      const origin = req.headers.origin
      if (origin !== undefined && !isOurOrigin(origin, port())) return `Origin rifiutato: ${origin}`

      // 4. Token. È ciò che distingue STARK da qualunque altro processo sulla macchina.
      if (!hasToken(req, token)) return 'token mancante o errato'

      return null
    },
  }
}

function cookieToken(req: IncomingMessage): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === 'stark') return rest.join('=')
  }
  return null
}

function isLocal(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.')
}

function isLocalHostname(h: string): boolean {
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}

function isOurOrigin(origin: string, port: number): boolean {
  for (const h of ['127.0.0.1', 'localhost', '[::1]']) {
    if (origin === `http://${h}:${port}`) return true
  }
  return false
}

function hasToken(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization
  const given = typeof auth === 'string' && auth.startsWith('Bearer ')
    ? auth.slice(7)
    // Il cookie serve alle sottorisorse della pagina: il browser scarica script e
    // fogli di stile senza poter aggiungere intestazioni, e senza questo la prima
    // pagina passerebbe per poi restare bianca. È messo `SameSite=Strict`, quindi
    // non parte nemmeno per richieste che nascono da un altro sito.
    : cookieToken(req)
    // Ultima spiaggia per i client che non possono fare nessuna delle due cose, e
    // per il primo caricamento della pagina, che non ha ancora il cookie.
    // Sconsigliato in generale: le query string finiscono nei log e nella cronologia.
    ?? new URL(req.url ?? '/', 'http://x').searchParams.get('token') ?? ''
  if (given.length !== token.length) return false
  // Confronto a tempo costante: un `===` perde la partita un carattere alla volta.
  return timingSafeEqual(Buffer.from(given), Buffer.from(token))
}
