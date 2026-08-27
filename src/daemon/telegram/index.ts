// Guidare STARK da Telegram.
//
// ── Il costo, prima di tutto il resto ──────────────────────────────────────────────
//
// Quello che scrivi al bot e quello che l'agent risponde passano **per intero dai server
// di Telegram**. Sono cifrati in transito, ma **non** da capo a fondo: le chat di un bot
// non sono Secret Chat, e Telegram può leggerle. È più di quanto esce col Web Push, dove
// viaggia un titolo cifrato che nemmeno Apple può aprire — quello è cifrato per davvero,
// questo no. È il prezzo di poter *guidare* da fuori invece di essere solo avvisato, ed
// è spento finché non lo accendi: senza un bot token qui non parte nemmeno il ciclo.
//
// ── Perché dentro il daemon ────────────────────────────────────────────────────────
//
// Un processo separato dovrebbe leggere `~/.stark/token`, tenerlo in memoria e parlare
// HTTP con un daemon che esegue comandi come root: sarebbe un **secondo detentore** del
// segreto e un secondo client da fidarsi. Da qui dentro si chiama `registry.command()`
// come fa `route()`, e lo `SessionSnapshot` si prende dal registro invece di
// ricostruirlo — l'invariante §4 vuole che chi mostra qualcosa lo ricavi dagli eventi
// con lo **stesso** `applyTo`, e da fuori si dovrebbe rifare il parser SSE, la
// riconnessione con `?from=` e il caso «il daemon si è riavviato».
//
// Il rischio dello stare dentro è uno solo, e va trattato: un errore non catturato nel
// ciclo di ascolto porterebbe giù **tutte** le sessioni. Quindi ogni await sta sotto
// `try`, il ciclo si autoricicla con backoff, e davanti a un errore che non si ricupera
// il modulo **si spegne dichiarando il motivo** invece di ritentare in silenzio. Un
// Telegram spento è un daemon sano.

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { BotApi, ErroreTelegram, type Bottone, type Update } from './api.ts'
import { Stato } from './stato.ts'
import { aHtml, escapa, spezza } from './testo.ts'
import type { PushPayload } from '../push.ts'
import type { Activity } from '../../core/activity.ts'

type Riga = {
  id: string; title: string; state: string; cwd?: string
  model?: string; doing?: Activity; live: boolean
}

type Registro = {
  list(): Riga[]
}

/** Cosa dire all'utente nelle impostazioni. Mai «non funziona» senza il perché. */
export type StatoBot =
  | { fase: 'spento' }
  | { fase: 'in-ascolto' }
  | { fase: 'errore'; motivo: string }

/** L'alfabeto del codice di accoppiamento: niente 0/O, 1/I/L, che si sbagliano a leggere. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const PAIRING_DURA = 5 * 60_000
const PAIRING_TENTATIVI = 3

export class Telegram {
  #stato: Stato
  #registro: Registro
  #api: BotApi | null = null
  #fermo: AbortController | null = null
  #situazione: StatoBot = { fase: 'spento' }
  /** L'ultima volta che si è ignorato uno sconosciuto, per chat: si logga di rado. */
  #ignorati = new Map<number, number>()

  constructor(home: string, registro: Registro) {
    this.#stato = new Stato(home)
    this.#registro = registro
  }

  get disponibile(): boolean { return this.#situazione.fase === 'in-ascolto' }
  get situazione(): StatoBot { return this.#situazione }
  get username(): string | undefined { return this.#stato.dati.username }
  get accoppiate(): { chatId: number; nome: string; da: number }[] { return this.#stato.dati.allow }
  get haToken(): boolean { return Boolean(this.#stato.dati.token) }

  // ── accensione ────────────────────────────────────────────────────────────

  /** Parte solo se c'è un token. Spento vuol dire **assente**: nessuna connessione. */
  async avvia(): Promise<void> {
    const token = this.#stato.dati.token
    if (!token) { this.#situazione = { fase: 'spento' }; return }
    this.#api = new BotApi(token)
    try {
      const io = await this.#api.chiSono()
      this.#stato.cambia(d => { d.username = io.username ?? '' })
      this.#situazione = { fase: 'in-ascolto' }
      void this.#ciclo()
      console.log(`[telegram] in ascolto come @${io.username ?? io.id}`)
    } catch (e) {
      this.#situazione = { fase: 'errore', motivo: motivo(e) }
      this.#api = null
      console.error(`[telegram] non parte: ${motivo(e)}`)
    }
  }

  async ferma(): Promise<void> {
    this.#fermo?.abort()
    this.#fermo = null
    this.#api = null
    this.#situazione = { fase: 'spento' }
  }

  /** Il token nuovo: si salva, si riparte, e si dice subito se è vero (`getMe`). */
  async imposta(token: string): Promise<StatoBot> {
    await this.ferma()
    this.#stato.cambia(d => {
      d.token = token
      // L'offset appartiene al bot precedente: tenerlo vorrebbe dire chiedere a un bot
      // nuovo aggiornamenti a partire da un numero che per lui non significa niente.
      d.offset = 0
      delete d.username
    })
    await this.avvia()
    return this.#situazione
  }

  /** Dimentica tutto: token, accoppiamenti, sessione corrente di ogni chat. */
  async dimentica(): Promise<void> {
    await this.ferma()
    this.#stato.cambia(d => {
      delete d.token; delete d.username; delete d.pairing
      d.allow = []; d.chats = {}; d.offset = 0
    })
  }

  // ── accoppiamento ─────────────────────────────────────────────────────────

  /**
   * Un codice a 8 caratteri, buono 5 minuti, per un uso solo e tre tentativi.
   *
   * Serve perché il `chat_id` non è una cosa che l'utente conosce, e chiederglielo
   * obbligherebbe il bot a rispondere a uno sconosciuto («il tuo id è…»), cioè a
   * rinunciare all'unica difesa che ha. Chi chiede il codice ha già il token di STARK:
   * questa rotta sta dietro il guard come tutte le altre.
   */
  creaCodice(): { code: string; scade: number } {
    let code = ''
    const b = randomBytes(8)
    for (let i = 0; i < 8; i++) code += ALFABETO[(b[i] ?? 0) % ALFABETO.length]
    const scade = Date.now() + PAIRING_DURA
    // Del codice si conserva l'**hash**: se qualcuno legge `telegram.json` non trova un
    // accoppiamento pronto all'uso, trova qualcosa che è già scaduto.
    this.#stato.cambia(d => { d.pairing = { hash: impronta(code), scade, tentativi: 0 } })
    return { code, scade }
  }

  revoca(chatId: number): void {
    this.#stato.cambia(d => {
      d.allow = d.allow.filter(a => a.chatId !== chatId)
      delete d.chats[String(chatId)]
    })
  }

  // ── il canale delle chiamate (vedi `chiamate.ts`) ──────────────────────────

  async manda(p: PushPayload): Promise<void> {
    const testo = `<b>${escapa(p.title)}</b>\n${escapa(p.body)}`
    for (const a of this.#stato.dati.allow) await this.#scrivi(a.chatId, testo)
  }

  // ── il ciclo ──────────────────────────────────────────────────────────────

  async #ciclo(): Promise<void> {
    const mio = new AbortController()
    this.#fermo = mio
    let attesa = 1_000
    while (!mio.signal.aborted && this.#api) {
      try {
        const ups = await this.#api.aggiornamenti(this.#stato.dati.offset + 1, mio.signal)
        attesa = 1_000
        for (const u of ups) {
          this.#stato.cambia(d => { d.offset = Math.max(d.offset, u.update_id) })
          try { await this.#gestisci(u) } catch (e) {
            // Un aggiornamento che esplode non deve fermare il ciclo, o basterebbe un
            // messaggio malformato per zittire il bot fino al prossimo riavvio.
            console.error('[telegram] aggiornamento non gestito:', motivo(e))
          }
        }
      } catch (e) {
        if (mio.signal.aborted) return
        // 409: due STARK stanno chiedendo aggiornamenti allo stesso bot, e Telegram ne
        // serve uno solo. 401: il token non vale. Nessuno dei due migliora ritentando,
        // e ritentare in silenzio darebbe un bot «acceso» che non risponde mai.
        const codice = e instanceof ErroreTelegram ? e.codice : 0
        if (codice === 409 || codice === 401) {
          this.#situazione = { fase: 'errore', motivo: codice === 409
            ? 'un altro STARK sta usando questo bot (un bot per macchina)'
            : 'il bot token non è valido' }
          console.error(`[telegram] spento: ${this.#situazione.fase === 'errore' ? this.#situazione.motivo : ''}`)
          this.#api = null
          return
        }
        await new Promise(r => setTimeout(r, attesa))
        attesa = Math.min(attesa * 2, 30_000)
      }
    }
  }

  // ── chi può parlare ───────────────────────────────────────────────────────

  /**
   * Il cancello, e passa da qui **tutto**.
   *
   * Pretende tre cose insieme: che sia una chat privata (mai un gruppo — lì leggono e
   * scrivono anche altri), che il `chat_id` sia nell'elenco, e che chi scrive sia la
   * chat stessa. In privato le ultime due coincidono sempre: controllarle entrambe
   * chiude il caso di un canale o di un gruppo con un mittente diverso.
   */
  #ammesso(u: Update): number | null {
    const chat = u.message?.chat ?? u.callback_query?.message?.chat
    const da = u.message?.from?.id ?? u.callback_query?.from.id
    if (!chat || da === undefined) return null
    if (u.message && u.message.chat.type !== 'private') return null
    if (chat.id !== da) return null
    return this.#stato.dati.allow.some(a => a.chatId === chat.id) ? chat.id : null
  }

  async #gestisci(u: Update): Promise<void> {
    const testo = u.message?.text?.trim() ?? ''
    const chat = u.message?.chat.id

    // L'unica cosa che si accetta da chi non è ancora nell'elenco.
    if (chat !== undefined && /^\/start\s+\S/.test(testo) && this.#ammesso(u) === null) {
      await this.#accoppia(chat, testo.split(/\s+/)[1] ?? '', u.message?.from?.first_name ?? 'telefono')
      return
    }

    const chatId = this.#ammesso(u)
    if (chatId === null) {
      // **A uno sconosciuto non si risponde.** Un «non sei autorizzato» confermerebbe
      // che dietro questo bot c'è uno STARK vivo, e regalerebbe un modo per sapere
      // quando la macchina è accesa. Si scrive una riga nel log, di rado, e si scarta.
      const q = u.message?.chat.id ?? u.callback_query?.from.id
      if (q !== undefined) {
        const ultimo = this.#ignorati.get(q) ?? 0
        if (Date.now() - ultimo > 60_000) {
          this.#ignorati.set(q, Date.now())
          console.error(`[telegram] ignorato: chat ${q}`)
        }
      }
      return
    }

    if (u.callback_query) {
      // I callback veri arrivano con le fasi B3-B4; per ora si chiude la rotella, che è
      // l'unica cosa che Telegram non perdona: senza, gira per sempre.
      await this.#api?.invia('answerCallbackQuery', { callback_query_id: u.callback_query.id })
      const dato = u.callback_query.data ?? ''
      if (dato.startsWith('u:')) await this.#usa(chatId, dato.slice(2))
      return
    }

    if (testo === '/chats' || testo === '/start') return this.#elenco(chatId)
    if (testo === '/status') return this.#situazioneChat(chatId)
    if (testo === '/unlink') {
      this.revoca(chatId)
      await this.#scrivi(chatId, 'Questo telefono non è più collegato a STARK.')
      return
    }
    if (testo === '/help' || testo === '') return this.#aiuto(chatId)

    await this.#scrivi(chatId, 'Per ora so fare <code>/chats</code>, <code>/status</code> e '
      + '<code>/unlink</code>. Scrivere prompt arriva subito dopo.')
  }

  async #accoppia(chatId: number, dato: string, nome: string): Promise<void> {
    const p = this.#stato.dati.pairing
    if (!p || p.scade < Date.now()) return           // silenzio: vedi `#gestisci`
    const giusto = pari(impronta(dato.toUpperCase()), p.hash)
    if (!giusto) {
      this.#stato.cambia(d => {
        if (!d.pairing) return
        d.pairing.tentativi++
        if (d.pairing.tentativi >= PAIRING_TENTATIVI) delete d.pairing
      })
      return
    }
    this.#stato.cambia(d => {
      d.allow.push({ chatId, nome, da: Date.now() })
      delete d.pairing                                // uso singolo
    })
    await this.#scrivi(chatId, 'Collegato a STARK. <code>/chats</code> per vedere le conversazioni.')
  }

  // ── cosa sa fare, per ora ─────────────────────────────────────────────────

  async #elenco(chatId: number): Promise<void> {
    const righe = this.#registro.list()
    if (righe.length === 0) return void this.#scrivi(chatId, 'Nessuna conversazione.')
    const tastiera = righe.slice(0, 20).map(r => [{
      text: `${segno(r)} ${cartella(r.cwd)} · ${taglia(r.title, 40)}`,
      callback_data: `u:${r.id}`,
    }])
    await this.#scrivi(chatId, 'Su quale conversazione vuoi scrivere?', tastiera)
  }

  async #usa(chatId: number, id: string): Promise<void> {
    const r = this.#registro.list().find(x => x.id === id)
    if (!r) return void this.#scrivi(chatId, 'Quella conversazione non c\'è più.')
    this.#stato.cambia(d => {
      d.chats[String(chatId)] = { ...d.chats[String(chatId)], current: id }
    })
    await this.#scrivi(chatId, `📌 <b>${escapa(cartella(r.cwd))}</b> · ${escapa(taglia(r.title, 60))}`)
  }

  async #situazioneChat(chatId: number): Promise<void> {
    const id = this.#stato.dati.chats[String(chatId)]?.current
    const r = id ? this.#registro.list().find(x => x.id === id) : undefined
    if (!r) return void this.#scrivi(chatId, 'Nessuna conversazione scelta. <code>/chats</code>')
    const doing = r.doing ? `\n${escapa(faQualcosa(r.doing))}` : ''
    await this.#scrivi(chatId, `${segno(r)} <b>${escapa(cartella(r.cwd))}</b> · `
      + `${escapa(taglia(r.title, 60))}\n<code>${escapa(r.state)}</code>`
      + `${r.model ? ` · <code>${escapa(r.model)}</code>` : ''}${doing}`)
  }

  #aiuto(chatId: number): Promise<void> {
    return this.#scrivi(chatId, [
      '<b>STARK</b>',
      '<code>/chats</code> — scegli la conversazione',
      '<code>/status</code> — cosa sta facendo',
      '<code>/unlink</code> — scollega questo telefono',
    ].join('\n'))
  }

  // ── scrivere ──────────────────────────────────────────────────────────────

  /**
   * Se Telegram rifiuta l'HTML (400), si rimanda **lo stesso testo senza `parse_mode`**.
   * Meglio un messaggio brutto che un messaggio perso: senza questa rete, il primo
   * blocco di codice strano fa sparire una risposta e nessuno capisce perché.
   */
  async #scrivi(chatId: number, html: string, tastiera?: Bottone[][]): Promise<void> {
    if (!this.#api) return
    const pezzi = spezza(html)
    for (let i = 0; i < pezzi.length; i++) {
      const corpo: Record<string, unknown> = {
        chat_id: chatId,
        text: pezzi[i],
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(tastiera && i === pezzi.length - 1 ? { reply_markup: { inline_keyboard: tastiera } } : {}),
      }
      try {
        await this.#api.invia('sendMessage', corpo)
      } catch (e) {
        if (!(e instanceof ErroreTelegram) || e.codice !== 400) throw e
        delete corpo['parse_mode']
        corpo['text'] = senzaTag(pezzi[i] ?? '')
        await this.#api.invia('sendMessage', corpo)
      }
    }
  }
}

/** Il testo di `aHtml` riportato a testo semplice, per il ripiego senza `parse_mode`. */
function senzaTag(html: string): string {
  return html.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function impronta(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** A tempo costante, come il token in `security.ts`: un `===` perde un carattere alla volta. */
function pari(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function motivo(e: unknown): string {
  if (e instanceof ErroreTelegram) return e.message
  return e instanceof Error ? e.message : String(e)
}

function cartella(cwd?: string): string {
  if (!cwd) return 'no folder'
  return cwd.replace(/\/+$/, '').split('/').pop() || cwd
}

function taglia(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

/**
 * «Cosa sta facendo adesso», in una riga. La stessa `Activity` che l'elenco della UI
 * mostra — presa dal registro, non ricalcolata: se un giorno cambia, cambia in un posto.
 */
function faQualcosa(a: Activity): string {
  if (a.kind === 'tool') return a.intent ?? a.summary ?? a.name
  if (a.kind === 'writing') return 'sta scrivendo'
  if (a.kind === 'thinking') return 'sta ragionando'
  return 'al lavoro'
}

function segno(r: { state: string; live: boolean }): string {
  if (r.state === 'awaiting') return '🟡'
  if (r.state === 'busy' || r.state === 'starting') return '🟠'
  if (r.state === 'error') return '🔴'
  return r.live ? '🟢' : '⚪'
}
