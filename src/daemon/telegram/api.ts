// Il client dell'API Bot di Telegram. `fetch` nudo, nessun wrapper.
//
// La regola del progetto dice di preferire ciò che è **ufficiale**. Qui l'ufficiale è
// l'HTTP Bot API: Telegram non pubblica un SDK per Node, e `grammy`/`telegraf`/
// `node-telegram-bot-api` sono wrapper di terze parti — adottarli non sarebbe usare
// l'ufficiale, sarebbe mettere un intermediario non ufficiale davanti a un'API ufficiale
// che è sei endpoint JSON su HTTPS. Il confronto giusto è con `web-push`, che invece è
// giustificata: lì c'è crittografia vera (JWT ES256, `aes128gcm`), e riscriverla a mano
// vorrebbe dire reimplementare uno standard.
//
// In cambio si controllano da sé le due cose che qui contano davvero, e che un framework
// nasconde: **quando** si modifica un messaggio invece di mandarne uno nuovo, e il
// rispetto di `retry_after` quando Telegram dice basta.

/** Quello che Telegram risponde: o `ok` col risultato, o `ok:false` col motivo. */
type Risposta<T> = {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}

export class ErroreTelegram extends Error {
  // Campi normali e non proprietà da parametro: i `.ts` del daemon girano **diretti**,
  // coi tipi cancellati e non compilati (ADR-007), e quella forma non è cancellabile.
  codice: number
  descrizione: string
  riprovaFra: number | undefined
  constructor(codice: number, descrizione: string, riprovaFra?: number) {
    super(`${codice}: ${descrizione}`)
    this.codice = codice
    this.descrizione = descrizione
    this.riprovaFra = riprovaFra
  }
}

export type Update = {
  update_id: number
  message?: {
    message_id: number
    text?: string
    chat: { id: number; type: string }
    from?: { id: number; first_name?: string; username?: string }
    photo?: { file_id: string; file_size?: number }[]
  }
  callback_query?: {
    id: string
    data?: string
    from: { id: number }
    message?: { message_id: number; chat: { id: number } }
  }
}

export type Bottone = { text: string; callback_data: string }

const BASE = (): string => process.env['TELEGRAM_API_BASE'] ?? 'https://api.telegram.org'

export class BotApi {
  #token: string
  /** Un invio in volo alla volta: vedi `invia`. */
  #coda: Promise<unknown> = Promise.resolve()

  constructor(token: string) { this.#token = token }

  /**
   * Una chiamata, senza coda. Serve a `getUpdates`, che resta appesa fino a 50 secondi
   * e attraverso la coda bloccherebbe ogni invio per tutto quel tempo.
   */
  async chiama<T>(metodo: string, corpo?: Record<string, unknown>, segnale?: AbortSignal): Promise<T> {
    const r = await fetch(`${BASE()}/bot${this.#token}/${metodo}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo ?? {}),
      ...(segnale ? { signal: segnale } : {}),
    })
    const j = await r.json() as Risposta<T>
    if (!j.ok) {
      throw new ErroreTelegram(j.error_code ?? r.status, j.description ?? 'senza motivo',
        j.parameters?.retry_after)
    }
    return j.result as T
  }

  /**
   * Una chiamata che *scrive* nella chat, in fila e con `retry_after` rispettato.
   *
   * Telegram tollera circa un messaggio al secondo per chat e una ventina al minuto, e
   * **modificare** un messaggio costa come mandarlo. Una coda con un invio in volo alla
   * volta è ciò che tiene questi numeri veri anche quando un turno produce decine di
   * eventi al secondo: senza, si manderebbero venti richieste insieme e si prenderebbe
   * un 429 per tutte.
   */
  invia<T>(metodo: string, corpo: Record<string, unknown>): Promise<T> {
    const mio = this.#coda.then(async () => {
      for (let tentativo = 0; ; tentativo++) {
        try {
          return await this.chiama<T>(metodo, corpo)
        } catch (e) {
          // `retry_after` è l'unico caso in cui riprovare è la cosa giusta: Telegram sta
          // dicendo *quando*, non *se*. Al secondo rifiuto si molla: continuare
          // vorrebbe dire fare la fila davanti a una porta che resta chiusa.
          const fra = e instanceof ErroreTelegram ? e.riprovaFra : undefined
          if (fra === undefined || tentativo >= 1) throw e
          await new Promise(r => setTimeout(r, (fra + 1) * 1000))
        }
      }
    })
    // La coda non si deve fermare su un errore: `catch` qui tiene viva la catena, e
    // l'errore vero resta quello che riceve chi ha chiamato.
    this.#coda = mio.catch(() => {})
    return mio
  }

  /** Chi è questo bot. È anche la prova che il token è vero. */
  chiSono(): Promise<{ id: number; username?: string; first_name?: string }> {
    return this.chiama('getMe')
  }

  /**
   * Il ciclo di ascolto. Long polling, **non** webhook, e non è una comodità: un webhook
   * obbliga Telegram ad aprire una connessione *entrante* verso questa macchina — un
   * indirizzo pubblico, TLS su 443/80/88/8443 — cioè esattamente ciò che il perimetro
   * in `security.ts` esiste per non dover fare. `getUpdates` è una connessione uscente:
   * passa da NAT, CGNAT, hotel, roaming, e non apre niente.
   */
  aggiornamenti(offset: number, segnale: AbortSignal): Promise<Update[]> {
    return this.chiama<Update[]>('getUpdates', {
      offset,
      timeout: 50,
      allowed_updates: ['message', 'callback_query'],
    }, segnale)
  }
}
