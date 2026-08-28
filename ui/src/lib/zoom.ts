/**
 * Quanto vale un pixel dichiarato, in pixel veri della finestra.
 *
 * `Sizer` applica uno `zoom` al `documentElement` (vedi textsize.svelte.ts), e lo
 * zoom **non** è un ingrandimento dell'immagine: ridisegna il layout, quindi un
 * `left:100px` scritto su un figlio del root finisce a 100 × zoom pixel veri. Un
 * `position:fixed` non sfugge — il suo blocco contenitore è la finestra **misurata
 * nelle unità del root**, non in pixel veri.
 *
 * Le coordinate di un evento del puntatore (`clientX`/`clientY`) e i rettangoli di
 * `getBoundingClientRect()` sono invece già in pixel veri. Quindi chi prende una
 * misura da lì e la riscrive in uno `style` deve **dividere per questo fattore**, o
 * l'elemento finisce a `zoom` volte la distanza giusta dall'origine.
 *
 * Misurato in Chromium (zoom 80/100/135/150/202%): `getComputedStyle(root).zoom`
 * torna il valore esatto; `currentCSSZoom` esiste ma è recente, e il rapporto fra
 * rettangolo e `offsetWidth` arrotonda (1,3493 invece di 1,35) — quindi il primo è
 * la fonte, gli altri due la rete di sicurezza per un motore che non lo esponga.
 * Un motore che non conosce `zoom` non lo applica nemmeno: lì 1 è la risposta giusta.
 */
export function zoomRoot(): number {
  const root = document.documentElement
  const dichiarato = Number.parseFloat(getComputedStyle(root).zoom)
  if (Number.isFinite(dichiarato) && dichiarato > 0) return dichiarato
  const misurato = root.getBoundingClientRect().width / root.offsetWidth
  return Number.isFinite(misurato) && misurato > 0 ? misurato : 1
}
