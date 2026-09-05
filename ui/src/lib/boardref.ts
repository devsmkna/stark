// I `#NNN` in chat diventano card della board (card #31, spec 2026-09-05).
//
// La verità viene dalla board, non dal testo: l'agent scrive solo `#12`, e titolo,
// stato e priorità li mette la UI leggendo la board vera. Un id che la board non
// conosce resta testo — un `#123` che parla di una issue GitHub non deve travestirsi
// da task. Il confronto è numerico: `#012` e `#12` sono lo stesso task.
import type { Board, BoardTask } from './api.ts'

export type TaskRef = {
  id: number; title: string; status: string; priority?: string; claimedBy?: string
}

/** La board in forma da lookup. `null` = il progetto non ha una board. */
export function mappaTask(b: Board): Map<number, TaskRef> | null {
  if (b.assente) return null
  const m = new Map<number, TaskRef>()
  for (const col of b.columns) for (const t of col.tasks as BoardTask[]) {
    m.set(t.id, {
      id: t.id, title: t.title, status: t.status,
      priority: t.priority, claimedBy: t.claimed_by,
    })
  }
  return m
}

/** Lo stato in una delle quattro famiglie di colore già esistenti nel tema. */
export function classeStato(status: string): 'work' | 'wait' | 'done' | 'todo' {
  if (status === 'in-progress') return 'work'
  if (status === 'review') return 'wait'
  if (status === 'done' || status === 'archived') return 'done'
  return 'todo'
}

const RIF = /#(\d{1,4})(?!\d)/g

/** C'è almeno un `#NNN` risolvibile FUORI dal codice? Serve a Conversation per
 *  decidere quale parte del turno porta la card blocco (la prima che cita). */
export function citaTask(testo: string, tasks: Map<number, TaskRef>): boolean {
  const senzaCodice = testo.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  for (const m of senzaCodice.matchAll(RIF)) if (tasks.has(Number(m[1]))) return true
  return false
}

/**
 * Cammina i nodi testo e sostituisce ogni `#NNN` risolvibile con un chip; con
 * `carta: true` la PRIMA citazione porta anche la card blocco, inserita dopo il
 * blocco che la contiene. Dentro `code`, `pre`, link e chip già fatti non si entra:
 * lì `#NNN` è contenuto, non citazione.
 */
export function decoraTaskDom(
  doc: Document, tasks: Map<number, TaskRef>, opts: { carta?: boolean } = {},
): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const testi: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = (n as Text).parentElement
    if (el?.closest('code, pre, a, button')) continue
    testi.push(n as Text)
  }
  let carta = opts.carta === true
  for (const nodo of testi) {
    const testo = nodo.textContent ?? ''
    RIF.lastIndex = 0
    if (!RIF.test(testo)) continue
    const frag = doc.createDocumentFragment()
    let cursore = 0
    RIF.lastIndex = 0
    for (const m of testo.matchAll(RIF)) {
      const t = tasks.get(Number(m[1]))
      if (!t) continue
      frag.append(testo.slice(cursore, m.index))
      frag.append(chip(doc, t))
      cursore = (m.index ?? 0) + m[0].length
      if (carta) {
        carta = false
        // La card va DOPO il blocco che contiene la citazione, non dentro la frase.
        const blocco = nodo.parentElement?.closest('p, li, h1, h2, h3, h4, blockquote')
        blocco?.after(cardBlocco(doc, t))
      }
    }
    if (cursore === 0) continue
    frag.append(testo.slice(cursore))
    nodo.replaceWith(frag)
  }
}

function chip(doc: Document, t: TaskRef): HTMLElement {
  const b = doc.createElement('button')
  b.className = 'taskchip'
  b.dataset['task'] = String(t.id)
  b.title = `${t.title} — ${t.status}`
  b.innerHTML = `<i class="tdot ${classeStato(t.status)}"></i>`
    + `<span class="tid">#${t.id}</span><span class="ttl"></span>`
  b.querySelector('.ttl')!.textContent = t.title
  return b
}

function cardBlocco(doc: Document, t: TaskRef): HTMLElement {
  const b = doc.createElement('button')
  b.className = 'taskcard'
  b.dataset['task'] = String(t.id)
  const prioAlta = t.priority === 'high' || t.priority === 'critical'
  b.innerHTML = `<span class="th"><span class="tid">#${t.id}</span><span class="ttl"></span></span>`
    + `<span class="tm"><span class="tbadge ${classeStato(t.status)}"></span>`
    + (prioAlta ? `<span class="tbadge prio"></span>` : '')
    + (t.claimedBy ? `<span class="tclm"></span>` : '') + `</span>`
  b.querySelector('.th .ttl')!.textContent = t.title
  b.querySelector('.tbadge')!.textContent = t.status
  if (prioAlta) b.querySelector('.tbadge.prio')!.textContent = t.priority ?? ''
  if (t.claimedBy) b.querySelector('.tclm')!.textContent = `@${t.claimedBy}`
  return b
}
