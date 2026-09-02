// L'indirizzo dice cosa stai guardando: una chat, o una vista.
//
// Serviva perché un ricaricamento perdeva il posto: la chat scelta viveva in memoria e
// basta, quindi F5 — o riaprire il browser sulla scheda di ieri — riportava all'elenco
// vuoto. In un'app che si tiene aperta per giorni è la differenza fra riprendere e
// ricominciare.
//
// Il daemon serve già la pagina su qualunque rotta (`static.ts`), quindi qui non serve
// niente lato server: `/chat/<id>` e `/view/<id>` ricadono su `index.html`, e il cookie
// col token viene messo lo stesso perché è la pagina a metterlo.
//
// `/chat/<id>` apre **sempre** la chat da sola, anche se quella chat sta dentro una
// vista salvata. È la regola che rende prevedibile una notifica: il link che arriva sul
// telefono porta alla conversazione che ha suonato, non a una disposizione che al
// momento della notifica poteva anche non essere aperta.

import type { View } from './store.svelte.ts'

export type Route =
  | { kind: 'chat'; id: string; view: View }
  /** Una vista salvata. Non ha sotto-letture: gli effetti sono di un pannello, e
   *  dentro una vista di pannelli ce n'è più d'uno. */
  | { kind: 'view'; id: string }
  | null

/** Gli id sono UUID: ci si fa passare solo quello, così un indirizzo scritto a mano
 *  non diventa un modo di far chiedere al daemon file con nomi strani. */
const ID = /^[0-9a-f-]{8,}$/i

export function fromPath(path: string = location.pathname): Route {
  const parti = path.split('/').filter(Boolean)
  if (!parti[1] || !ID.test(parti[1])) return null
  if (parti[0] === 'view') return { kind: 'view', id: parti[1] }
  if (parti[0] !== 'chat') return null
  return { kind: 'chat', id: parti[1], view: parti[2] === 'effects' ? 'effects' : 'chat' }
}

export function toPath(id: string | null, view: View): string {
  if (!id) return '/'
  return view === 'effects' ? `/chat/${id}/effects` : `/chat/${id}`
}

export function toViewPath(id: string): string { return `/view/${id}` }

/**
 * Scrive l'indirizzo senza ricaricare niente.
 *
 * `replace` serve per correggere un indirizzo che non deve restare nella storia — per
 * esempio uno che punta a una chat che non c'è più: rimetterlo fra i posti in cui si
 * può tornare vorrebbe dire poterci sbattere di nuovo col tasto «indietro».
 */
export function go(id: string | null, view: View, replace = false): void {
  vai(toPath(id, view), replace)
}

/** Come `go`, ma verso una vista. Separata invece di un parametro in più su `go`:
 *  chi la chiama non ha un `View` da passare, e inventarne uno finto sarebbe una
 *  bugia che poi qualcuno legge. */
export function goView(id: string, replace = false): void {
  vai(toViewPath(id), replace)
}

function vai(path: string, replace: boolean): void {
  if (path === location.pathname) return
  const url = path + location.search + location.hash
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}
