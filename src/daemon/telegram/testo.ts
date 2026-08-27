// Dal Markdown che scrive l'agent al poco HTML che Telegram accetta.
//
// **HTML e non MarkdownV2.** MarkdownV2 pretende l'escape di `_*[]()~`>#+-=|{}.!`
// *ovunque*, comprese le parentesi dentro una frase normale. Le risposte di un agent
// sono piene di backtick sbilanciati, asterischi e percorsi con underscore: sarebbe una
// fabbrica di `400 Bad Request` su un canale dove perdere un messaggio significa perdere
// una risposta. `parse_mode: 'HTML'` ha **tre** caratteri da escapare e un elenco chiuso
// di tag (`b i u s a code pre blockquote tg-spoiler`).
//
// La conversione è di proposito **minima**: blocchi di codice e code inline, tutto il
// resto resta testo. Grassetti e titoli si perdono, ed è la scelta giusta — su Telegram
// si legge, non si impagina. E `marked`, che è già nel repo, produce HTML vero: tag che
// Telegram rifiuta, cioè un messaggio perso invece di uno brutto.

/** Il tetto di un messaggio, per specifica. Si conta **dopo** l'escape. */
export const TETTO = 4096

export function escapa(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Markdown dell'agent → HTML di Telegram.
 *
 * I fence si estraggono **per primi**, perché dentro un blocco di codice non c'è niente
 * da interpretare: un `` ` `` o un `*` lì sono caratteri, non sintassi. Un fence lasciato
 * aperto (l'agent li tronca a metà quando finisce lo spazio) si chiude da sé alla fine
 * del testo, invece di produrre HTML rotto — che Telegram rifiuterebbe in blocco.
 */
export function aHtml(md: string): string {
  const pezzi: string[] = []
  let resto = md
  const fence = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)(?:```|$)/

  for (;;) {
    const m = fence.exec(resto)
    if (!m) break
    pezzi.push(inline(resto.slice(0, m.index)))
    const lingua = m[1] ? ` class="language-${escapa(m[1])}"` : ''
    pezzi.push(`<pre><code${lingua}>${escapa(m[2] ?? '')}</code></pre>`)
    resto = resto.slice(m.index + m[0].length)
  }
  pezzi.push(inline(resto))
  return pezzi.join('')
}

function inline(s: string): string {
  // L'escape prima, il code dopo: al contrario, i tag che stiamo per scrivere verrebbero
  // escapati insieme al testo.
  return escapa(s).replace(/`([^`\n]+)`/g, '<code>$1</code>')
}

/**
 * Spezza un testo già in HTML in messaggi che Telegram accetta.
 *
 * Si taglia su un confine di riga, e **mai dentro un `<pre>`**: un tag lasciato aperto
 * fa rifiutare il messaggio intero. Se il blocco di codice è più lungo del tetto da
 * solo, si chiude e si riapre nel pezzo dopo — perdere l'evidenziazione è meglio che
 * perdere il testo.
 */
export function spezza(html: string, tetto = TETTO): string[] {
  if (html.length <= tetto) return [html]
  const fuori: string[] = []
  let resto = html
  while (resto.length > tetto) {
    const dentroPre = aperto(resto.slice(0, tetto))
    // Margine per i tag che dovremo chiudere e riaprire noi.
    const limite = tetto - (dentroPre ? '</code></pre>'.length : 0)
    let taglio = resto.lastIndexOf('\n', limite)
    if (taglio <= 0) taglio = limite
    let pezzo = resto.slice(0, taglio)
    let prossimo = resto.slice(taglio)
    if (aperto(pezzo)) {
      pezzo += '</code></pre>'
      prossimo = `<pre><code>${prossimo.replace(/^\n/, '')}`
    }
    fuori.push(pezzo)
    resto = prossimo
  }
  if (resto.trim() !== '') fuori.push(resto)
  return fuori
}

/** C'è un `<pre>` ancora aperto alla fine di questo pezzo? */
function aperto(s: string): boolean {
  const apre = (s.match(/<pre>/g) ?? []).length
  const chiude = (s.match(/<\/pre>/g) ?? []).length
  return apre > chiude
}
