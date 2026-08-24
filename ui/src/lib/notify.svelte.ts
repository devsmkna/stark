// Come STARK ti chiama quando stai guardando altrove.
//
// Il pallino nell'elenco funziona solo se sei **già** dentro STARK, e il punto era poter
// guardare altrove (`ui-schermate.md` §1). Sono due mestieri diversi: la notifica ti
// chiama, il pallino ti dice dove guardare quando sei già qui.
//
// Due vincoli del browser danno la forma a tutto il file, e nessuno dei due è una scelta
// nostra:
//   1. il permesso per le notifiche si può chiedere **solo dentro un gesto dell'utente**.
//      Chiederlo all'apertura della pagina è il modo migliore per farsi rispondere di no
//      una volta per sempre — perciò lo chiede la campanella, quando la premi.
//   2. l'audio parte sospeso finché l'utente non tocca la pagina. Si sblocca al primo
//      gesto qualunque, e da lì in poi suona.
//
// Il suono **non** ha bisogno di nessun permesso: se il browser nega le notifiche, resta
// e funziona. È il motivo per cui la campanella non sparisce mai — spegnerla è una tua
// scelta, negare il riquadro è una scelta del browser, e sono due cose diverse.

/** Le tre cose che meritano di chiamarti, e che le impostazioni sapranno separare. */
export type Call = 'needsYou' | 'done' | 'stopped'

export type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

/**
 * Preferenza del **dispositivo**, non della conversazione: non nasce dal journal e non
 * deve, perché «voglio sentire i suoni su questo computer» non è un fatto della
 * sessione. Con le impostazioni arriverà il silenziamento per progetto, e quello sì
 * dovrà stare dal lato del daemon: vale su qualunque browser lo apra.
 */
const KEY = 'stark.calls'
/** Le tre chiamate accese o spente, una per una. */
const KEY_EVENTI = 'stark.calls.events'
/** Se tacere sulla chat che stai guardando. Acceso: l'hai già davanti. */
const KEY_QUI = 'stark.calls.quiet'

/** Due note che salgono per «ti aspetto», due che scendono per «ho finito»: per chi
 *  ascolta dall'altra stanza sono situazioni opposte, e un suono solo le pareggerebbe. */
const SCORE: Record<Call, Array<{ f: number; at: number; d: number }>> = {
  needsYou: [
    { f: 659, at: 0, d: 0.13 }, { f: 880, at: 0.14, d: 0.16 },
    { f: 659, at: 0.42, d: 0.13 }, { f: 880, at: 0.56, d: 0.18 },
  ],
  done: [{ f: 880, at: 0, d: 0.13 }, { f: 587, at: 0.14, d: 0.26 }],
  stopped: [{ f: 233, at: 0, d: 0.18 }, { f: 233, at: 0.24, d: 0.3 }],
}

export type CallSpec = {
  title: string
  body: string
  /** L'id della chat: due notifiche della stessa chat si sostituiscono invece di
   *  impilarsi. Con quattro lavori in parallelo è la differenza fra essere avvisati
   *  e essere sommersi. */
  tag: string
  onClick: () => void
}

export class Notifier {
  /** Se STARK ti chiama. Acceso di partenza: il suono non chiede niente a nessuno. */
  on = $state(true)
  /**
   * Quali delle tre chiamate. Separate perché sono tre situazioni diverse: c'è chi
   * vuole sapere quando una chat lo aspetta e non gliene importa niente di quando ha
   * finito, e viceversa.
   */
  eventi = $state<Record<Call, boolean>>({ needsYou: true, done: true, stopped: true })
  /** Tacere sulla chat aperta e in primo piano: lì l'hai già visto succedere. */
  zittoQui = $state(true)
  /** Cosa dice il browser sulle notifiche di sistema. Il suono non ne dipende. */
  permission = $state<Permission>('default')

  #audio: AudioContext | null = null

  constructor() {
    try {
      this.on = localStorage.getItem(KEY) !== 'off'
      const e = localStorage.getItem(KEY_EVENTI)
      if (e) {
        const letto = JSON.parse(e) as Partial<Record<Call, boolean>>
        for (const k of ['needsYou', 'done', 'stopped'] as Call[]) {
          if (typeof letto[k] === 'boolean') this.eventi[k] = letto[k]
        }
      }
      this.zittoQui = localStorage.getItem(KEY_QUI) !== 'off'
    } catch { /* modalità privata, o storage negato: si resta accesi */ }
    this.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  }

  /** Il riquadro di sistema è possibile solo se il browser lo consente **e** lo vuoi tu. */
  get canPopup(): boolean { return this.on && this.permission === 'granted' }

  /**
   * Il primo gesto dell'utente, qualunque sia. Non chiede permessi e non suona: sblocca
   * soltanto l'audio, che senza un gesto resta muto per regola del browser.
   */
  unlock(): void {
    const ctx = this.#ctx()
    if (ctx?.state === 'suspended') void ctx.resume()
  }

  /**
   * La campanella. Accendere è anche il momento in cui si chiede il permesso: siamo
   * dentro un click, che è l'unico posto in cui il browser accetta la domanda.
   */
  async toggle(): Promise<void> {
    const next = !this.on
    this.on = next
    try { localStorage.setItem(KEY, next ? 'on' : 'off') } catch { /* vedi sopra */ }
    if (!next) return
    this.unlock()
    if (this.permission === 'default') {
      this.permission = await Notification.requestPermission() as Permission
    }
  }

  /** Perché la campanella è com'è. Mai nascosta, mai accesa e non funzionante. */
  get explain(): string {
    if (!this.on) return 'Notifications and sounds are off — click to turn them on'
    if (this.permission === 'granted') return 'You get a sound and a system notification — click to mute'
    if (this.permission === 'denied') {
      return 'The browser blocked system notifications for this page, so only the sound plays. '
        + 'Allow them in the browser\'s site settings to get the notification back.'
    }
    if (this.permission === 'unsupported') {
      return 'This browser has no system notifications, so only the sound plays'
    }
    return 'Sound only. Click to let the browser show system notifications too'
  }

  /** Accende o spegne una delle tre. */
  setEvento(kind: Call, acceso: boolean): void {
    this.eventi = { ...this.eventi, [kind]: acceso }
    try { localStorage.setItem(KEY_EVENTI, JSON.stringify(this.eventi)) } catch { /* vedi sopra */ }
  }

  setZittoQui(v: boolean): void {
    this.zittoQui = v
    try { localStorage.setItem(KEY_QUI, v ? 'on' : 'off') } catch { /* vedi sopra */ }
  }

  call(kind: Call, spec: CallSpec): void {
    if (!this.on || !this.eventi[kind]) return
    this.#play(kind)
    if (this.permission !== 'granted') return
    try {
      const n = new Notification(spec.title, { body: spec.body, tag: spec.tag })
      n.onclick = () => {
        // Premerla porta dove serve: la finestra davanti, e quella chat aperta.
        window.focus()
        n.close()
        spec.onClick()
      }
    } catch { /* il browser può rifiutarla lo stesso: resta il suono */ }
  }

  #ctx(): AudioContext | null {
    if (this.#audio) return this.#audio
    try {
      this.#audio = new AudioContext()
    } catch { this.#audio = null }
    return this.#audio
  }

  /**
   * I suoni si sintetizzano invece di caricare dei file: sono tre note, e un file
   * sarebbe una risorsa in più da servire, da mettere in cache e da sbagliare. Con le
   * impostazioni si potranno scegliere, e allora avrà senso averne di veri.
   */
  #play(kind: Call): void {
    const ctx = this.#ctx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    for (const n of SCORE[kind]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = n.f
      // Attacco corto e coda che scende: una nota che si spegne di netto fa «clic».
      gain.gain.setValueAtTime(0.0001, t0 + n.at)
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + n.at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.d)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + n.at)
      osc.stop(t0 + n.at + n.d + 0.02)
    }
  }
}
