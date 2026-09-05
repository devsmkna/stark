// STARK esegue comandi arbitrari come root. Questo file è il perimetro.
//
// Un server in ascolto su localhost NON è protetto dal fatto di essere su localhost:
// qualunque pagina web aperta nel browser può mandargli richieste. Le tre difese qui
// sotto servono a tre attacchi diversi, e nessuna copre il buco delle altre.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { eseguiSync } from '../core/platform.ts'
import { vieTailscale } from './tailscale.ts'
import { tunnelHost } from './tunnel.ts'
import type { IncomingMessage } from 'node:http'

export type Guard = {
  token: string
  /** Chi è ammesso oltre a localhost. Serve a *dirlo*: `/api/system`, log, `stark status`. */
  perimetro: Perimetro
  /** Il motivo del rifiuto, oppure null se la richiesta può passare. */
  reject(req: IncomingMessage): string | null
  /**
   * Con quale credenziale è passata questa richiesta.
   *
   * Esiste per una trappola concreta: `serveUi` pianta un cookie a ogni caricamento
   * della pagina, e finché la credenziale era una sola poteva piantare quella. Da
   * quando un telefono ne ha una **sua** (`telefono.ts`), piantare sempre quella
   * globale vorrebbe dire consegnare la chiave maestra al primo dispositivo che carica
   * la pagina — cioè annullare la revoca prima ancora di scriverla. Si ripianta quella
   * con cui si è entrati, non un'altra.
   */
  credenziale(req: IncomingMessage): string | null
}

/**
 * Cosa il perimetro deve sapere dei telefoni collegati. È un'interfaccia e non la
 * classe: qui dentro non entra la gestione dell'accoppiamento, entra solo la domanda
 * «questa credenziale vale?» — vedi `telefono.ts` per la risposta.
 */
export type Telefoni = {
  riconosce(token: string): boolean
  codiceVivo(): { scade: number } | null
}

/**
 * Le due sole rotte che si possono attraversare **senza credenziale**, e soltanto nei
 * cinque minuti in cui un codice è vivo: la pagina in cui si scrive il codice, e la
 * richiesta che lo consegna. Fuori da quella finestra rispondono 403 come tutto il
 * resto, quindi la superficie non autenticata non è accesa in permanenza — esiste solo
 * quando l'hai chiesta tu premendo il bottone. Decisione dell'utente, 28 agosto 2026.
 *
 * Le difese 1, 2 e 3 valgono lo stesso: anche per accoppiare bisogna arrivare dal
 * loopback, con un `Host` che è questa macchina e un `Origin` nostro. A cadere è solo
 * la quarta, che è l'unica che il telefono non può ancora soddisfare.
 */
const ROTTE_ACCOPPIAMENTO = new Set(['/pair', '/api/phone/claim'])

/** Un nome che questa macchina accetta oltre a localhost. */
export type Ammesso = {
  /** L'hostname nudo, come arriva nell'intestazione `Host` (senza porta). */
  host: string
  /** L'Origin che un browser scriverebbe partendo da quel nome. Sempre `https://`. */
  origin: string
  /** Da dove viene: si mostra all'utente, non decide niente. */
  fonte: 'tailscale' | 'env' | 'tunnel'
}

export type Perimetro = {
  /** Vuoto = solo-localhost, cioè il default. */
  ammessi: Ammesso[]
  /** Voci di configurazione buttate via, col perché. Si stampano all'avvio. */
  scartate: { voce: string; perche: string }[]
}

/**
 * `token` arriva da fuori perché ora **sopravvive al processo** (vedi `identity.ts`):
 * generarlo qui dentro vorrebbe dire che il perimetro decide una cosa che riguarda
 * l'avvio. Senza, se ne fa uno usa e getta: è quello che serve a un daemon di prova.
 *
 * `extraHosts` è la stessa cosa che direbbe `STARK_PUBLIC_HOST`, passata a mano: serve
 * alle prove, che non devono dipendere dall'ordine in cui i moduli leggono l'ambiente.
 * Assente (non `[]`) vuol dire «leggi l'ambiente»; `[]` vuol dire «nessuno».
 */
export function createGuard(
  port: () => number, dato?: string, extraHosts?: string[], telefoni?: Telefoni,
): Guard {
  const token = dato ?? randomBytes(32).toString('hex')
  // Misurato dal vivo il 26 agosto (pagina Notion "Continua da telefono" §3 e §5.1):
  // con un mesh Tailscale privato, `tailscale serve` termina il TLS e fa da proxy
  // verso `127.0.0.1:<porta>` — la connessione che arriva qui alla difesa 1 resta
  // quindi da questa macchina anche quando il telefono è fuori casa, e SSE/WebSocket
  // passano intatti (misurato: niente bufferizzato, a differenza di un tunnel
  // Cloudflare gratuito). Cambiano solo Host e Origin, che devono imparare il nome
  // di questa macchina sulla tailnet: la scelta di *quale* nome fidarsi resta scelta
  // all'avvio, una volta sola, non ricalcolata a ogni richiesta.
  //
  // Da qui in poi vale per **qualunque** proxy che termini il TLS altrove e si
  // ricolleghi al loopback — Traefik su un VPS proprio, `cloudflared`, `frp`. Quello
  // che cambia è solo *chi dice* il nome: Tailscale lo sa da sé, gli altri no e va
  // scritto in `STARK_PUBLIC_HOST`. Il perimetro si allarga dichiarandolo: l'unica
  // alternativa sarebbe far mentire il proxy su `Host` e `Origin`, cioè spostare il
  // perimetro in un file di configurazione dove nessuno lo cerca e dove si rompe in
  // silenzio.
  const perim = perimetro(extraHosts)

  return {
    token,
    perimetro: perim,
    reject(req) {
      // 1. Solo dalla macchina. Difesa di fondo: se l'ascolto finisse per sbaglio su
      //    0.0.0.0, questo resta in piedi. Non si allarga insieme agli host, e non ne
      //    ha bisogno: ogni tunnel serio (`ssh -R 127.0.0.1:…`, `cloudflared`, `frpc`,
      //    `tailscale serve`) si ricollega dal loopback. L'unica alternativa sarebbe
      //    fidarsi di `X-Forwarded-For`, che lo scrive chi si collega.
      const addr = req.socket.remoteAddress ?? ''
      if (!isLocal(addr)) return `indirizzo non locale: ${addr}`

      // 2. Host. Difende dal DNS rebinding: un attaccante può far puntare il proprio
      //    dominio a 127.0.0.1, e a quel punto la sua pagina parla con noi come se
      //    fosse same-origin. L'unica cosa che non può falsificare è l'Host che il
      //    browser scrive, che resterebbe il suo dominio.
      const host = hostname(req.headers.host)
      if (!isLocalHostname(host, perim.ammessi)) return `Host non locale: ${host}`

      // 3. Origin. Difende dalle richieste cross-site: una pagina su un altro sito che
      //    prova a parlare con noi porta il proprio Origin, e viene fermata qui.
      //    Assente va bene: le richieste non-browser non lo mandano.
      const origin = req.headers.origin
      if (origin !== undefined && !isOurOrigin(origin, port(), perim.ammessi)) {
        return `Origin rifiutato: ${origin}`
      }

      // 4. Token. È ciò che distingue STARK da qualunque altro processo sulla macchina.
      //    Ce n'è più d'uno: quello della macchina, e uno per ogni telefono collegato.
      //    Sono equivalenti qui e diversi altrove — quello di un telefono si revoca da
      //    Impostazioni, quello della macchina no.
      const dato = presentato(req)
      if (dato && (pari(dato, token) || telefoni?.riconosce(dato))) return null

      // L'accoppiamento: senza credenziale si passa solo qui, e solo mentre un codice è
      // vivo. Sta **dopo** il controllo del token e non prima, perché non è una
      // scorciatoia — è l'ultima porta, e se ne apre una sola.
      if (ROTTE_ACCOPPIAMENTO.has(percorso(req)) && telefoni?.codiceVivo()) return null

      return 'token mancante o errato'
    },

    credenziale(req) {
      const dato = presentato(req)
      if (!dato) return null
      if (pari(dato, token)) return token
      return telefoni?.riconosce(dato) ? dato : null
    },
  }
}

/**
 * Chi è ammesso oltre a localhost, da tutte le fonti che ce l'hanno.
 *
 * Le fonti si **sommano**: chi ha Tailscale *e* un dominio proprio li ha entrambi, e
 * accendere l'uno non spegne l'altro. Elenco vuoto = solo-localhost, che è il default
 * e resta il comportamento di chi non configura niente.
 *
 * Non legge `X-Forwarded-Proto` né `Forwarded` — vedi `isOurOrigin`.
 */
export function perimetro(extra?: string[]): Perimetro {
  const ammessi: Ammesso[] = []
  const scartate: { voce: string; perche: string }[] = []
  const visti = new Set<string>()

  const aggiungi = (voce: string, fonte: Ammesso['fonte']): void => {
    const esito = normalizza(voce)
    if ('perche' in esito) {
      scartate.push({ voce, perche: esito.perche })
      return
    }
    if (visti.has(esito.host)) return
    visti.add(esito.host)
    ammessi.push({ ...esito, fonte })
  }

  const tailnet = detectTailnetHost()
  if (tailnet) aggiungi(tailnet, 'tailscale')

  // L'hostname del tunnel entra **sempre**, acceso o spento che sia l'interruttore:
  // è una costante di prodotto (come CLOUD_PREDEFINITO), e ammetterlo qui non apre
  // niente — quel nome risolve sul VPS, non su questa macchina, quindi una pagina
  // ostile non può presentarlo come `Host` arrivando dal loopback. Se restasse
  // fuori, accendere il tunnel a caldo servirebbe un perimetro già chiuso: il guard
  // si costruisce una volta, e questa è la voce che gli serve da subito.
  aggiungi(tunnelHost(), 'tunnel')

  const dichiarati = extra ?? (process.env['STARK_PUBLIC_HOST'] ?? '').split(',')
  for (const voce of dichiarati) {
    if (voce.trim() === '') continue
    aggiungi(voce, 'env')
  }

  return { ammessi, scartate }
}

/**
 * Da quello che un umano scrive a mano al nome che confronteremo. Tollerante sulla
 * forma (`https://`, la barra finale, le maiuscole, il punto finale: tutte cose che si
 * scrivono per abitudine) e **intollerante** sul resto.
 *
 * Niente wildcard, mai: `*.dominio.it` trasformerebbe un sottodominio compromesso — o
 * semplicemente uno preso da qualcun altro — in un ingresso verso un processo root.
 *
 * Quello che si scarta si **stampa**: una configurazione che non ha effetto e non lo
 * dice è peggio di nessuna configurazione (stessa regola di `saneMode` in `settings.ts`).
 */
function normalizza(voce: string): Omit<Ammesso, 'fonte'> | { perche: string } {
  const pulita = voce.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
    .replace(/\.(?=:)/, '')
  if (pulita === '') return { perche: 'vuota' }
  if (pulita.includes('*')) return { perche: 'le wildcard non sono ammesse: scrivi il nome per intero' }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(pulita)) {
    return { perche: 'non è un hostname' }
  }
  // La porta esiste solo nell'Origin: la difesa 2 confronta l'`Host` senza porta,
  // perché è così che il browser lo scrive quando la porta è quella di default.
  const host = pulita.split(':')[0] ?? pulita
  // Solo https, e — se non è stata scritta — senza porta: è così che lo pubblica un
  // proxy che termina il TLS sulla 443, e i browser omettono la porta di default
  // dall'Origin. Un `http://` su questo stesso nome non è mai stato STARK: è un'altra
  // cosa che punta lì.
  return { host, origin: `https://${pulita}` }
}

let tailnetCache: { host: string | null } | null = null

/**
 * Il nome di questa macchina sulla tailnet, se Tailscale c'è ed è connesso — `null`
 * altrimenti, e allora l'apertura la deve dichiarare `STARK_PUBLIC_HOST`: la tailnet è
 * un'aggiunta, mai un requisito nascosto per far ripartire STARK.
 *
 * Il risultato si tiene: prima lo chiedevano sia il perimetro sia il `sub` della VAPID
 * in `push.ts`, cioè due `execFileSync` all'avvio e due verità che potevano differire.
 * Resta vero che se cambia la tailnet (rete riconfigurata, dispositivo rinominato)
 * serve un riavvio, esattamente come per la porta o per il token.
 */
export function detectTailnetHost(): string | null {
  if (tailnetCache) return tailnetCache.host
  let host: string | null = null
  try {
    // Le **stesse vie** del pannello, non un `tailscale` dal `PATH` scritto qui: due
    // elenchi vorrebbero dire un perimetro chiuso mentre la schermata dice «tutto
    // verde», ed è la classe di bug già corretta quando `soggetto()` in `push.ts`
    // faceva il rilevamento per conto suo.
    for (const via of vieTailscale()) {
      try {
        const j = JSON.parse(eseguiSync(via.cmd, [...via.pre, 'status', '--json'], { timeout: 2000 }).toString())
        const dns = (j.Self?.DNSName as string | undefined)?.replace(/\.$/, '')
        if (dns) { host = dns; break }
      } catch { /* questa via non risponde: si prova la prossima */ }
    }
  } catch { host = null }
  tailnetCache = { host }
  return host
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

/**
 * L'`Host` che confronteremo. Gli hostname sono case-insensitive per RFC, e la forma
 * assoluta col punto finale (`stark.dominio.it.`) è legale: chi la scrive non merita un
 * 403 che sembra un problema di token.
 */
function hostname(raw: string | undefined): string {
  return (raw ?? '').split(':')[0]?.toLowerCase().replace(/\.$/, '') ?? ''
}

function isLocalHostname(h: string, ammessi: Ammesso[]): boolean {
  if (h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1') return true
  // Uguaglianza, mai `endsWith`: con un confronto per suffisso
  // `stark.dominio.it.attaccante.com` sarebbe dentro.
  return ammessi.some(a => a.host === h)
}

function isOurOrigin(origin: string, port: number, ammessi: Ammesso[]): boolean {
  for (const h of ['127.0.0.1', 'localhost', '[::1]']) {
    if (origin === `http://${h}:${port}`) return true
  }
  // Lo schema di un host esterno non si deduce da `X-Forwarded-Proto`: quell'header lo
  // scrive il client, e dedurne `https` trasformerebbe questa difesa in teatro. Un host
  // del perimetro è per definizione servito via TLS dal proxy, quindi `https` e basta.
  return ammessi.some(a => a.origin === origin.toLowerCase())
}

const percorso = (req: IncomingMessage): string =>
  new URL(req.url ?? '/', 'http://x').pathname

/** La credenziale che la richiesta porta, da qualunque delle tre vie. Non dice se è
 *  valida: dice cosa è stato presentato. */
function presentato(req: IncomingMessage): string {
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
  return given
}

/** Confronto a tempo costante: un `===` perde la partita un carattere alla volta. */
function pari(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
