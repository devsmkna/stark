// L'indirizzo dice quale chat stai guardando.
//
// Serviva perché un ricaricamento perdeva il posto: la chat scelta viveva in memoria e
// basta, quindi F5 — o riaprire il browser sulla scheda di ieri — riportava all'elenco
// vuoto. In un'app che si tiene aperta per giorni è la differenza fra riprendere e
// ricominciare.
//
// Il daemon serve già la pagina su qualunque rotta (`static.ts`), quindi qui non serve
// niente lato server: `/chat/<id>` ricade su `index.html`, e il cookie col token viene
// messo lo stesso perché è la pagina a metterlo.

import type { View } from './store.svelte.ts'

export type Route = { id: string; view: View } | null

/** Gli id sono UUID: ci si fa passare solo quello, così un indirizzo scritto a mano
 *  non diventa un modo di far chiedere al daemon file con nomi strani. */
const ID = /^[0-9a-f-]{8,}$/i

export function fromPath(path: string = location.pathname): Route {
  const parti = path.split('/').filter(Boolean)
  if (parti[0] !== 'chat' || !parti[1] || !ID.test(parti[1])) return null
  return { id: parti[1], view: parti[2] === 'effects' ? 'effects' : 'chat' }
}

export function toPath(id: string | null, view: View): string {
  if (!id) return '/'
  return view === 'effects' ? `/chat/${id}/effects` : `/chat/${id}`
}

/**
 * Scrive l'indirizzo senza ricaricare niente.
 *
 * `replace` serve per correggere un indirizzo che non deve restare nella storia — per
 * esempio uno che punta a una chat che non c'è più: rimetterlo fra i posti in cui si
 * può tornare vorrebbe dire poterci sbattere di nuovo col tasto «indietro».
 */
export function go(id: string | null, view: View, replace = false): void {
  const path = toPath(id, view)
  if (path === location.pathname) return
  const url = path + location.search + location.hash
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}
