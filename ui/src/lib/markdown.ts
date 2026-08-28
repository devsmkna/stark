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
// `lib/core` e non il pacchetto intero: quello porta 190 linguaggi (~1 MB) di cui su
// dati veri se ne usano dieci. Vedi `LINGUE` qui sotto per la misura.
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { appUrlFor, serviceFor } from '$core/services.ts'

/**
 * I linguaggi che vale la pena caricare, scelti contando invece che immaginando.
 *
 * Misurato su 68 MB di trascritti veri di questa macchina (115 file, 1.252 risposte a
 * parole): **749 blocchi di codice, 674 col linguaggio dichiarato — il 90%**. E i
 * linguaggi distinti che compaiono davvero sono **dieci**:
 *
 *   bash 630 · hcl 14 · json 7 · sql 7 · yaml 6 · ts 6 · sh 1 · css 1 · svelte 1 · python 1
 *
 * `bash` da solo è l'84%. Caricare il pacchetto intero per coprire i restanti 189
 * linguaggi sarebbe pagare un megabyte per un caso che non si è mai presentato.
 *
 * Gli alias vengono col modulo (`sh` e `zsh` con `bash`, `ts` con `typescript`), quindi
 * non vanno registrati a mano. Le eccezioni sono due e sono scritte sotto.
 */
const LINGUE = {
  bash, css, diff, javascript, json, markdown, python, sql, typescript, xml, yaml,
}
for (const [nome, lingua] of Object.entries(LINGUE)) hljs.registerLanguage(nome, lingua)
// `svelte` non è un linguaggio di highlight.js, ma un file Svelte è per la maggior
// parte markup: `xml` lo colora in modo sensato invece di lasciarlo grigio.
hljs.registerAliases(['svelte'], { languageName: 'xml' })
// **`hcl` resta senza colore, di proposito.** highlight.js non lo porta (verificato: non
// c'è in `lib/languages/`), e l'alternativa era mapparlo su `ini` — che su un blocco
// `resource "aws_x" "y" { … }` colorerebbe le cose sbagliate. Un colore sbagliato è
// peggio di nessun colore: il primo lo credi, il secondo lo leggi e basta.

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
  highlightCode(doc)
  addCopyButtons(doc)
  addAppLinks(doc)
  if (opts.asked) markAsked(doc)
  return doc.body.innerHTML
}

/**
 * Colora il codice, quando il modello ha detto di che linguaggio si tratta.
 *
 * L'informazione **c'era già** e la si buttava via: `marked` scrive
 * `<code class="language-bash">` e `DOMPurify` conserva `class` — verificato nel
 * browser vero, non dedotto dalla configurazione. Quindi questo non è un pezzo nuovo
 * della pipeline, è la resa di un dato che arrivava fin qui inutilizzato.
 *
 * Gira **dopo** `sanitize`, per la stessa ragione di `addCopyButtons`: il markup che
 * produce è nostro, generato da testo già ripulito, e rimandarlo al sanitizzatore
 * vorrebbe dire fargli ricontrollare centinaia di `<span>` che abbiamo appena scritto
 * noi. Il testo da colorare si legge con `textContent`, cioè come **testo**, mai come
 * HTML: qualunque cosa l'agent avesse messo dentro il blocco è già stata neutralizzata,
 * e da qui in poi non torna più a essere markup.
 *
 * `ignoreIllegals` perché un blocco può contenere un frammento che non compila — un
 * pezzo di file, una riga di esempio con dei puntini — e in quel caso highlight.js
 * altrimenti solleva. Un frammento colorato a metà è comunque meglio di un'eccezione
 * che porta giù il rendering dell'intera risposta.
 */
function highlightCode(doc: Document): void {
  for (const code of doc.querySelectorAll('pre > code[class*="language-"]')) {
    const nome = /language-([\w+-]+)/.exec(code.className)?.[1]?.toLowerCase()
    // Un linguaggio che non conosciamo non è un errore: resta monospace, esattamente
    // come il 10% di blocchi che non dichiara niente.
    if (!nome || !hljs.getLanguage(nome)) continue
    try {
      code.innerHTML = hljs.highlight(code.textContent ?? '', {
        language: nome, ignoreIllegals: true,
      }).value
      code.classList.add('hljs')
    } catch { /* niente colore, il testo resta quello di prima */ }
  }
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
    // Il nome del linguaggio, quando c'è, **dopo** il bottone e spinto a destra: costa
    // zero (è lo stesso dato che colora il blocco) e toglie l'ambiguità che il colore da
    // solo non toglie — `json` e `yaml`, o `ts` e `js`, si somigliano abbastanza da
    // doverlo leggere. Dopo e non prima perché «Copy» in alto a sinistra è una scelta
    // presa (vedi sopra): metterci il nome davanti la sposterebbe di lato.
    const nome = /language-([\w+-]+)/.exec(pre.querySelector('code')?.className ?? '')?.[1]
    if (nome) {
      const tag = doc.createElement('span')
      tag.className = 'cblang'
      tag.textContent = nome
      bar.append(tag)
    }

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
