// Il menu del tasto destro non esiste su un touchscreen: il dito non ha un secondo
// pulsante. Lo sostituisce la pressione lunga — la convenzione di iOS e Android per
// le righe di un elenco: tieni premuto, si apre il menu di quella riga.
//
// Dopo il fuoco il browser sintetizza da sé due eventi che vanno ingoiati, altrimenti
// il gesto si mangia il proprio risultato: il `click` del touchend (finirebbe sul velo
// che circonda il menu, chiudendolo nell'istante in cui si è aperto) e — solo su
// Android — il `contextmenu` nativo del long-press, che aprirebbe lo stesso menu una
// seconda volta. Il primo si ferma qui; il secondo si riconosce con
// `longPressAppenaFatto()`, che chi usa `contextmenu` deve interrogare.

import type { Action } from 'svelte/action'

let ultimoFuoco = 0

/** Vero nei primi istanti dopo una pressione lunga andata a fuoco. */
export const longPressAppenaFatto = (): boolean => Date.now() - ultimoFuoco < 800

export const longpress: Action<HTMLElement, (x: number, y: number) => void> = (el, apri) => {
  const MS = 500
  const SCARTO = 10 // px: un dito che si sposta di più è uno scroll, non una pressione
  let richiama = apri
  let timer: ReturnType<typeof setTimeout> | null = null
  let touchId: number | null = null
  let x0 = 0
  let y0 = 0
  let stop: ((e: MouseEvent) => void) | null = null

  const annulla = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    touchId = null
  }

  const fuoco = (x: number, y: number): void => {
    annulla()
    ultimoFuoco = Date.now()
    stop = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
    document.addEventListener('click', stop, { capture: true, once: true })
    // Un riscontro fisico dove esiste (Android; iOS non ha vibrazione da pagina):
    // dice «il menu sta arrivando» nell'attesa che il menu ci sia davvero.
    navigator.vibrate?.(10)
    richiama(x, y)
  }

  const inizio = (e: TouchEvent): void => {
    if (touchId !== null) return
    const t = e.changedTouches[0]!
    touchId = t.identifier
    x0 = t.clientX
    y0 = t.clientY
    timer = setTimeout(() => fuoco(x0, y0), MS)
  }
  const mosso = (e: TouchEvent): void => {
    if (touchId === null) return
    const t = [...e.changedTouches].find(t => t.identifier === touchId)
    if (t && Math.hypot(t.clientX - x0, t.clientY - y0) > SCARTO) annulla()
  }
  const fine = (e: TouchEvent): void => {
    if (touchId === null) return
    if ([...e.changedTouches].some(t => t.identifier === touchId)) annulla()
  }

  el.addEventListener('touchstart', inizio, { passive: true })
  el.addEventListener('touchmove', mosso, { passive: true })
  el.addEventListener('touchend', fine)
  el.addEventListener('touchcancel', fine)

  return {
    update(next: (x: number, y: number) => void) { richiama = next },
    destroy() {
      annulla()
      // Il `once: true` lo toglie da solo quando ha fermato il suo click; se il click
      // non è mai arrivato (tocco annullato), resta appeso a ingoiare il prossimo tocco
      // vero: lo si ripulisce qui.
      if (stop) document.removeEventListener('click', stop, { capture: true })
      el.removeEventListener('touchstart', inizio)
      el.removeEventListener('touchmove', mosso)
      el.removeEventListener('touchend', fine)
      el.removeEventListener('touchcancel', fine)
    },
  }
}
