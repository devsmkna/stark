// Un percorso citato in chat si copia e si apre, invece di doverlo cercare a mano.
//
// ─── Perché nasce, e perché nasce rovesciando una decisione ──────────────────
//
// Il 26 agosto era stato deciso il contrario, e la ragione scritta in
// `docs/ui-schermate.md` resta giusta: «non scandaglia il testo libero della risposta
// in cerca di qualcosa che somiglia a un percorso — riconoscere un percorso in Markdown
// non fidato è un problema diverso, e più fragile». Vero. Una regola tipografica non
// distingue `and/or` da una cartella, e sbaglia anche nell'altro verso: `core/reduce.ts`
// *sembra* un percorso e non esiste (è `src/core/reduce.ts`). Un bottone «apri» che non
// apre niente è peggio di nessun bottone, perché insegna a non fidarsi degli altri.
//
// La cura non è una regola più furba: è **non indovinare**. Qui si fa solo la rosa; a
// decidere è il disco, che il daemon interroga (`POST /api/sessions/:id/paths`). Un
// percorso o c'è o non c'è: smette di essere un giudizio e diventa un fatto. È la stessa
// mossa già fatta per le citazioni con `@`, dove a cercare i file è il CLI e noi
// mostriamo — vedi ADR-009, l'SDK sostituisce il trasporto, non la traduzione.
//
// ─── Cosa costa ─────────────────────────────────────────────────────────────
//
// Una richiesta HTTP per messaggio reso, non una per percorso, e una `existsSync` per
// candidato dal lato daemon. Le risposte si tengono per sessione: un messaggio già
// deciso non si richiede: la conversazione si ridisegna a ogni token che arriva, e senza
// memoria questa sarebbe una richiesta ogni frazione di secondo.

import type { Api } from './api.ts'

/**
 * Somiglia a un percorso?
 *
 * Volutamente **grossolana**: qui si allarga la rosa, si stringe dopo. Il costo di un
 * falso positivo è una `existsSync` in più; il costo di un falso negativo è un percorso
 * vero che resta testo morto, e non c'è niente che glielo rimedi dopo.
 *
 * Le due esclusioni non sono estetiche. Uno spazio dentro: un percorso può averlo, ma in
 * una risposta un `code` con spazi è quasi sempre un comando (`npm run check`), e trattarlo
 * da percorso metterebbe due bottoni su ogni comando citato. Le opzioni (`--qualcosa`):
 * non sono percorsi e non lo diventano, e sono frequentissime in questo progetto.
 */
export function candidato(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 512) return false
  if (/\s/.test(s)) return false
  if (s.startsWith('-')) return false
  // Un URL non è un percorso di questa macchina, e ha già il suo trattamento (i link,
  // e il bottone «Open in…» accanto a quelli che STARK riconosce).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false
  // O ha una barra (`docs/x.md`, `/tmp`, `./src`), oppure è un nome di file con
  // un'estensione plausibile (`CLAUDE.md`, `package.json`) — che nel testo di questo
  // progetto si cita di continuo senza la cartella davanti.
  return s.includes('/') || /^[\w.-]+\.[a-z0-9]{1,12}$/i.test(s)
}

/**
 * Quello che il daemon ha già risposto, per sessione.
 *
 * Chiave: `<id>\n<percorso>`. Il valore è la risposta, `true` o `false` — **si tiene
 * anche il no**, perché è la metà che si richiederebbe più spesso: in una risposta piena
 * di `code` i candidati che non sono file sono la maggioranza, e non ricordarli
 * vorrebbe dire richiederli tutti a ogni ridisegno.
 */
const noto = new Map<string, boolean>()

/** Chi sta già chiedendo, per non far partire due domande sulla stessa cosa. */
let inVolo: Promise<void> | null = null
const inCoda = new Set<string>()

/**
 * Decora i candidati dentro `root`: chiede al daemon quali esistono e attacca i bottoni.
 *
 * Il ridisegno è **asincrono di proposito**. Il testo compare subito com'è sempre
 * comparso, e i bottoni arrivano quando la risposta arriva: legare il rendering a una
 * richiesta HTTP vorrebbe dire che una risposta lenta ritarda la lettura, che è
 * esattamente il contrario dello scopo.
 */
export async function decoraPercorsi(root: HTMLElement, id: string, api: Api): Promise<void> {
  const nodi = [...root.querySelectorAll<HTMLElement>('[data-path-cand]')]
    .filter(n => !n.dataset['pathDone'])
  if (nodi.length === 0) return

  const daChiedere = new Set<string>()
  for (const n of nodi) {
    const p = n.dataset['pathCand'] ?? ''
    if (!noto.has(`${id}\n${p}`)) daChiedere.add(p)
  }

  if (daChiedere.size > 0) {
    for (const p of daChiedere) inCoda.add(p)
    // Le domande di più messaggi resi nello stesso istante si fondono in una sola: la
    // conversazione ne rende molti insieme quando si apre, e senza questo sarebbero
    // venti richieste identiche nello stesso millisecondo.
    inVolo ??= (async () => {
      await Promise.resolve()
      const lotto = [...inCoda]
      inCoda.clear()
      inVolo = null
      const esistono = new Set(await api.pathsExist(id, lotto))
      for (const p of lotto) noto.set(`${id}\n${p}`, esistono.has(p))
    })()
    await inVolo
  }

  for (const n of nodi) {
    const p = n.dataset['pathCand'] ?? ''
    n.dataset['pathDone'] = '1'
    if (!noto.get(`${id}\n${p}`)) continue
    vesti(n, p)
  }
}

/**
 * Tiene decorato `root` **finché esiste**, invece di decorarlo una volta.
 *
 * Nasce da un difetto segnalato dall'utente il 28 agosto 2026: richiudendo e riaprendo
 * un turno, i percorsi tornavano senza bottoni. Misurato prima di correggere —
 * all'apertura 5 candidati / 6 bottoni, alla riapertura **5 candidati / 0 bottoni**.
 * La causa non era la decorazione ma **quando** la si chiamava: un `$effect` che
 * dipendeva da «quanti turni» e «quante parti», cioè da due numeri che richiudere un
 * turno non cambia. Il `{@html}` però rifà il DOM da zero, e i nodi nuovi non hanno mai
 * visto nessuno.
 *
 * Aggiungere `open` alle dipendenze avrebbe chiuso *questo* caso e lasciato aperti tutti
 * gli altri — un salto da una ricerca, un pannello che cambia chat, un ridisegno che
 * oggi non c'è. Il difetto vero è che le dipendenze erano **indovinate**: qui invece si
 * guarda il DOM, che è la cosa che deve essere vera, e non la lista dei motivi per cui
 * potrebbe essere cambiata.
 *
 * Non va in ricorsione, e vale la pena dire perché: `decoraPercorsi` mutando il DOM
 * risveglia l'osservatore, ma i nodi che ha appena vestito portano `data-path-done`,
 * quindi la passata successiva non trova niente da fare ed esce **senza mutare**. Il giro
 * si chiude da sé dopo una passata a vuoto.
 */
export function osservaPercorsi(root: HTMLElement, id: string, api: Api): () => void {
  let inCorso = false
  const passa = (): void => {
    // Durante uno streaming il DOM cambia molte volte al secondo: le mutazioni di una
    // stessa raffica si fondono in una passata sola.
    if (inCorso) return
    inCorso = true
    queueMicrotask(() => { inCorso = false; void decoraPercorsi(root, id, api) })
  }
  passa()
  const mo = new MutationObserver(passa)
  mo.observe(root, { childList: true, subtree: true })
  return () => { mo.disconnect() }
}

/** I due bottoni, attaccati dentro il `code` — non accanto, per non spezzare la riga. */
function vesti(n: HTMLElement, p: string): void {
  n.classList.add('pth')
  const b = (azione: string, titolo: string, icona: string, okIcona?: string) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'pthb'
    el.setAttribute(azione, p)
    el.title = titolo
    el.setAttribute('aria-label', `${titolo}: ${p}`)
    // Sul bottone di copia sta già una spunta nascosta: `decoraPercorsi` non la
    // ridisegna, e chi preme si aspetta che il segno cambi senza aspettare un delta.
    el.innerHTML = `<svg class="ic"><use href="#${icona}"></use>${
      okIcona ? `<use class="ok" href="#${okIcona}"></use>` : ''
    }</svg>`
    return el
  }
  n.append(
    b('data-copy-path', 'Copy path', 'i-copy', 'i-check'),
    b('data-reveal-path', 'Reveal in file manager', 'i-reveal'),
  )
}

/**
 * I pezzi di un prompt utente, spezzato sulle citazioni con `@`.
 *
 * Qui **non si indovina niente**: la `@` è una citazione esplicita, scritta scegliendo
 * da un menu che il CLI ha riempito. È l'unico posto dove un percorso in un testo
 * dell'utente è un fatto dichiarato invece che una somiglianza — e la ragione per cui
 * nei prompt vale solo questa forma.
 */
export function pezziConCitazioni(testo: string): { t: string; cita?: boolean }[] {
  const out: { t: string; cita?: boolean }[] = []
  // `@` seguita da qualcosa che non è spazio: il CLI espande esattamente questa forma.
  const re = /@([^\s@]+)/g
  let ultimo = 0
  for (const m of testo.matchAll(re)) {
    const i = m.index
    if (i > ultimo) out.push({ t: testo.slice(ultimo, i) })
    out.push({ t: m[1] ?? '', cita: true })
    ultimo = i + m[0].length
  }
  if (ultimo < testo.length) out.push({ t: testo.slice(ultimo) })
  return out
}
