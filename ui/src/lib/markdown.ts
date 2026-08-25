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

marked.setOptions({ gfm: true, breaks: false })

// I link si aprono in una scheda nuova: STARK non ha una barra degli indirizzi in cui
// tornare indietro senza perdere la conversazione.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(html)
}
