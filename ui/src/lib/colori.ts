// Mostra ogni colore hex come quadrato + testo monospace, ovunque nel testo.
// Esempio: "#c7bfff" → <span class="colore"><span class="csw" style="background:#c7bfff"></span><code>#c7bfff</code></span>
// Usato sia nelle risposte markdown del modello (DOM) sia nel prompt utente (stringa).

const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g
const HEX_TEST = /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function isHexColor(s: string): boolean {
  return HEX_TEST.test(s.trim())
}

// Per stringhe plain (prompt utente): escape + sostituzione
export function decoraColoriTesto(testo: string): string {
  const esc = escapeHtml(testo)
  return esc.replace(HEX_RE, m => coloreHtml(m))
}

export function coloreHtml(hex: string): string {
  const safe = escapeHtml(hex)
  return `<span class="colore"><span class="csw" style="background:${safe}"></span><code>${safe}</code></span>`
}

/** Il chip colore come elemento DOM — la stessa cosa di `coloreHtml` ma costruita a
 *  mano, per i casi in cui serve sostituire un nodo esistente invece di iniettare
 *  una stringa. */
function chipColore(doc: Document, hex: string): HTMLSpanElement {
  const wrap = doc.createElement('span')
  wrap.className = 'colore'
  const sw = doc.createElement('span')
  sw.className = 'csw'
  sw.setAttribute('style', `background:${hex}`)
  const code = doc.createElement('code')
  code.textContent = hex
  wrap.append(sw, code)
  return wrap
}

// Per DOM markdown (Document): cammina sui nodi testo e sostituisce
export function decoraColoriDom(doc: Document): void {
  // Un hex citato da solo in un `code` inline — `` `#c7bfff` `` — non deve restare
  // dentro il `code` che marked ha messo attorno: quello diventava
  // `<code><span class="colore">…</span></code>`, un `code` esterno inutile che
  // l'utente ha segnalato come aberrazione il 29 agosto 2026. Qui si sostituisce
  // l'intero `code` col chip colore: il quadrato c'è, e il `code` esterno no.
  for (const code of doc.querySelectorAll('code')) {
    if (code.closest('pre')) continue
    const t = (code.textContent ?? '').trim()
    if (isHexColor(t)) code.replaceWith(chipColore(doc, t))
  }

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    // Salta nodi vuoti o dentro <style>/<script>
    const parent = t.parentElement
    if (!parent) continue
    const tag = parent.tagName
    if (tag === 'STYLE' || tag === 'SCRIPT') continue
    // Dentro un tag `code` o `pre` un hex è parte del codice, non un colore da
    // mostrare col quadrato: i `code` inline con un solo hex sono già stati
    // sostituiti qui sopra, e negli altri (un blocco evidenziato, un frammento
    // con dell'altro testo) decorare l'hex ricreerebbe il `code` annidato.
    // `.taskchip`/`.taskcard` (card #31): `decoraTaskDom` gira PRIMA di questo
    // decoratore e mette l'id (`#12`) e il titolo dentro quei bottoni — un id a tre
    // cifre matcha anche `HEX_RE`, e senza questa esclusione il decoratore dei colori
    // rientrerebbe nel chip appena creato e ne mangerebbe l'etichetta.
    if (t.parentElement?.closest('code, pre, .taskchip, .taskcard')) continue
    if (HEX_RE.test(t.data)) nodes.push(t)
    // reset lastIndex per test globale
    HEX_RE.lastIndex = 0
  }
  for (const textNode of nodes) {
    const text = textNode.data
    const parts: (string | HTMLElement)[] = []
    let last = 0
    let m: RegExpExecArray | null
    HEX_RE.lastIndex = 0
    const frag = doc.createDocumentFragment()
    let hasMatch = false
    while ((m = HEX_RE.exec(text)) !== null) {
      hasMatch = true
      if (m.index > last) frag.append(doc.createTextNode(text.slice(last, m.index)))
      const hex = m[0]!
      frag.append(chipColore(doc, hex))
      last = m.index + hex.length
    }
    if (!hasMatch) continue
    if (last < text.length) frag.append(doc.createTextNode(text.slice(last)))
    textNode.replaceWith(frag)
  }
}
