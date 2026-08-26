// La risposta a parole è testo scritto *per l'utente* (vedi Conversation.svelte), e chi
// scrive sa che STARK legge Markdown — è quello che il CLI stesso rende nel terminale, e
// STARK non deve poter meno di lui (vedi CLAUDE.md). Senza, una tabella o un **grassetto**
// arrivano come asterischi e barre verticali crude, illeggibili proprio nel punto in cui
// dovrebbero essere più chiari.
//
// `marked` fa il parsing, `DOMPurify` pulisce l'HTML prima che finisca in `{@html}`: il
// testo può contenere qualunque cosa l'agent abbia letto (una pagina web, un file), quindi
// non è testo di cui fidarsi ciecamente solo perché è "nostro".
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { appUrlFor, serviceFor } from '$core/services.ts'

marked.setOptions({ gfm: true, breaks: false })

// I link si aprono in una scheda nuova: STARK non ha una barra degli indirizzi in cui
// tornare indietro senza perdere la conversazione.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * `asked` è vero quando questo testo è l'ultima cosa detta dall'agent e finisce con
 * un punto di domanda (`isOpenQuestion` in `Conversation.svelte` decide quando). Non
 * è una proprietà del Markdown: è dove sta la conversazione in questo momento, quindi
 * la decide chi chiama, non questo file — qui si sa solo **come** marcarlo una volta
 * deciso.
 */
export function renderMarkdown(text: string, opts: { asked?: boolean } = {}): string {
  const html = marked.parse(text, { async: false }) as string
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html), 'text/html')
  addCopyButtons(doc)
  addAppLinks(doc)
  if (opts.asked) markAsked(doc)
  return doc.body.innerHTML
}

/**
 * Un bottone «Copy» sopra ogni blocco di codice, in alto a sinistra: è lì che va
 * l'occhio (e il mouse) appena si legge la prima riga, ed è il pezzo di risposta che
 * si copia più spesso — un comando da incollare in un terminale, una porzione di
 * file. Prima STARK sapeva solo *mostrare* codice formattato; copiarlo voleva dire
 * selezionare a mano dentro un riquadro che scrolla, che è esattamente il genere di
 * attrito che una GUI dovrebbe togliere (vedi il principio fondante in CLAUDE.md).
 *
 * Gira **dopo** `DOMPurify.sanitize`, non prima: il markup che aggiunge è nostro e
 * fisso, mai derivato dal testo dell'agent, quindi non c'è niente da disinfettare — e
 * mandarlo comunque una seconda volta per la sanitizzazione rischierebbe solo di
 * perderlo, se un giorno cambiasse la lista dei tag ammessi.
 *
 * Il clic lo intercetta `Conversation.svelte` con un listener delegato sul
 * contenitore: il bottone nasce come stringa HTML dentro `{@html}`, quindi Svelte non
 * lo vede mai come un elemento a cui attaccare un handler suo.
 */
function addCopyButtons(doc: Document): void {
  for (const pre of doc.querySelectorAll('pre')) {
    const wrap = doc.createElement('div')
    wrap.className = 'codeblock'
    pre.replaceWith(wrap)

    const bar = doc.createElement('div')
    bar.className = 'cbbar'
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'copybtn'
    btn.setAttribute('data-copy', '')
    btn.setAttribute('aria-label', 'Copy code')
    btn.innerHTML = '<svg class="ic"><use href="#i-copy"></use></svg><span>Copy</span>'
    bar.append(btn)

    wrap.append(bar, pre)
  }
}

/**
 * Un bottone «Open in Notion» accanto ai link verso un servizio che STARK riconosce
 * (F1, Notion, 25 agosto 2026). Il link **resta quello che era** — clic normale,
 * scheda nuova, è già «aprilo nel browser» — questo aggiunge la seconda via, non la
 * sostituisce: è la differenza fra due bottoni e uno scambiato con l'altro.
 *
 * Non riscrive `href`: un `notion://` messo lì aprirebbe l'app anche a chi clicca il
 * link normalmente, e chi si aspettava il browser si ritroverebbe altrove senza
 * averlo chiesto. Il secondo URL vive solo in `data-url` del bottone nuovo.
 *
 * `serviceFor`/`appUrlFor` sono condivisi con `daemon/launch.ts` (`core/services.ts`
 * — vedi il perché lì): questo file decide *se* mostrare il bottone, il daemon
 * decide *se* onorare il clic, e i due non devono poter dire cose diverse.
 */
function addAppLinks(doc: Document): void {
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    let host: string
    try { host = new URL(href).hostname } catch { continue }
    const servizio = serviceFor(host)
    if (!servizio) continue

    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'applink'
    btn.setAttribute('data-open-app', '')
    btn.setAttribute('data-url', appUrlFor(href, servizio.scheme))
    btn.setAttribute('data-scheme', servizio.scheme)
    btn.setAttribute('aria-label', `Open in ${servizio.label}`)
    btn.innerHTML = `<svg class="ic"><use href="#i-open"></use></svg><span>Open in ${servizio.label}</span>`
    a.after(btn)
  }
}

/**
 * Evidenzia **solo il blocco finale** — il paragrafo, la lista, il blockquote,
 * qualunque cosa `renderMarkdown` abbia messo per ultima — non l'intera risposta.
 *
 * Bug B1 (segnalato il 25 agosto 2026): prima la classe finiva sul contenitore che
 * avvolge *tutto* il testo, quindi una risposta con due paragrafi di spiegazione e
 * la domanda in fondo si vedeva ambra da cima a fondo. Un'evidenza che copre tutto
 * non evidenzia più niente — torna a essere un muro di testo, solo colorato. Dato
 * che il testo che arriva qui finisce sempre con quel punto di domanda (lo garantisce
 * chi chiama, vedi `isOpenQuestion`), l'ultimo elemento di primo livello prodotto dal
 * rendering è, per costruzione, quello che contiene la domanda — qualunque tag sia.
 */
function markAsked(doc: Document): void {
  doc.body.lastElementChild?.classList.add('asked')
}
