// L'occhio della modalità ombra: cosa il filtro AVREBBE trovato in una richiesta.
//
// Questo modulo è puro — testo dentro, esiti fuori — perché è la parte che domani
// diventa il filtro vero: la modalità ombra e il mascheramento devono guardare le
// stesse regioni con le stesse forme, o l'ombra misura una cosa e il filtro ne fa
// un'altra (docs/anonimizzazione.md §12bis.3: la regola del «dubbio» si scrive coi
// numeri dell'ombra davanti, quindi i numeri devono venire dallo stesso occhio).
//
// Le regioni sono le cinque di D25, misurate camminando il JSON vero e non elencate a
// memoria (docs/anonimizzazione-flusso.md §3.1). Si salta `tools[]` per intero (D27:
// è l'88-90% dei byte e non contiene dati dell'utente) e non si toccano `thinking` e
// `signature` (D26). Le forme sono quelle di §5.3b: prefissi noti più le forme larghe
// — deterministiche, mai entropia generica (D11).

export type Trovato = {
  /** Dove nel payload: una delle cinque regioni di D25. */
  regione: string
  /** Quale forma nota ha morso. */
  forma: string
  /** Abbastanza per riconoscere il tipo, mai abbastanza per usarlo (regola §6.1). */
  indizio: string
  occorrenze: number
}

export type Analisi = {
  trovati: Trovato[]
  /** Byte davvero scanditi contro byte saltati (tools[]): l'ombra verifica dal vivo
   *  il rapporto 88-90% misurato una volta sola dalla sonda del flusso. */
  byteGuardati: number
  byteSaltati: number
}

/**
 * Le forme note. L'ordine non conta; i nomi sì, perché finiscono nel registro e
 * l'utente li legge. Niente entropia generica: ogni riga è una forma che si può
 * nominare, non un sospetto statistico (D11, S6).
 */
const FORME: ReadonlyArray<{ forma: string; re: RegExp }> = [
  {
    forma: 'chiave con prefisso noto',
    re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|xox[bpoa]-[A-Za-z0-9-]{10,})\b/g,
  },
  { forma: 'blocco PEM', re: /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----/g },
  { forma: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    forma: 'stringa di connessione con credenziali',
    re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@"']{1,64}:[^\s@"']{1,128}@[^\s"']+/gi,
  },
  {
    forma: 'intestazione Authorization',
    re: /\bAuthorization\b['"]?\s*[:=]\s*['"]?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  },
  {
    // La più larga, e dichiaratamente: `password=...`, `secret: "..."`. In ombra serve
    // proprio a contare quanto griderebbe — se troppo, si stringe QUI, con un numero.
    forma: 'chiave=valore sospetta',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\b['"]?\s*[:=]\s*['"]?[^\s'",;]{6,}/gi,
  },
]

const indizio = (s: string): string => s.slice(0, 10) + `…(${s.length} car.)`

/** Scandisce un testo con tutte le forme, accumulando in `dentro`. */
function scandisci(testo: string, regione: string, dentro: Map<string, Trovato>): void {
  for (const { forma, re } of FORME) {
    re.lastIndex = 0
    for (const m of testo.matchAll(re)) {
      const chiave = `${regione}|${forma}|${m[0]}`
      const gia = dentro.get(chiave)
      if (gia) gia.occorrenze += 1
      else dentro.set(chiave, { regione, forma, indizio: indizio(m[0]), occorrenze: 1 })
    }
  }
}

/** Tutte le stringhe dentro l'`input` di un tool_use, ovunque annidate. */
function stringheDi(v: unknown, fuori: string[]): void {
  if (typeof v === 'string') fuori.push(v)
  else if (Array.isArray(v)) for (const x of v) stringheDi(x, fuori)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) stringheDi(x, fuori)
}

/** Il `content` di un tool_result: stringa, o array di blocchi con `text`. */
function testoDelRisultato(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.map(b => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string')
      ? String((b as { text: string }).text) : '').join('\n')
  }
  return ''
}

/**
 * L'analisi di un corpo di `POST /v1/messages`, nelle cinque regioni di D25.
 *
 * Un corpo che non è JSON valido non è un errore da lanciare: è un fatto da riferire
 * (`null`), perché in ombra non abbiamo il permesso di rompere niente.
 */
export function analizza(corpo: string): Analisi | null {
  let dati: Record<string, unknown>
  try { dati = JSON.parse(corpo) as Record<string, unknown> } catch { return null }

  const dentro = new Map<string, Trovato>()
  let byteGuardati = 0
  const guarda = (testo: string, regione: string): void => {
    byteGuardati += testo.length
    scandisci(testo, regione, dentro)
  }

  // 1. system[].text (o system stringa)
  const system = dati['system']
  if (typeof system === 'string') guarda(system, 'system')
  else if (Array.isArray(system)) {
    for (const b of system) {
      const testo = (b as { text?: unknown })?.text
      if (typeof testo === 'string') guarda(testo, 'system')
    }
  }

  // 2-5. messages[]
  const messages = Array.isArray(dati['messages']) ? dati['messages'] as unknown[] : []
  for (const m of messages) {
    const content = (m as { content?: unknown })?.content
    // 2. content stringa (il messaggio di servizio iniettato dal CLI — flusso §3.1:
    //    chi cammina il payload deve reggere entrambe le forme)
    if (typeof content === 'string') { guarda(content, 'messages.content'); continue }
    if (!Array.isArray(content)) continue
    for (const b of content) {
      const blocco = b as { type?: unknown; text?: unknown; content?: unknown; input?: unknown }
      // 3. la prosa
      if (blocco.type === 'text' && typeof blocco.text === 'string') guarda(blocco.text, 'text')
      // 4. l'output dei tool: il punto più importante di tutti (flusso §7.8)
      else if (blocco.type === 'tool_result') guarda(testoDelRisultato(blocco.content), 'tool_result')
      // 5. l'input dei tool: dove passa un Write
      else if (blocco.type === 'tool_use') {
        const stringhe: string[] = []
        stringheDi(blocco.input, stringhe)
        guarda(stringhe.join('\n'), 'tool_use.input')
      }
      // thinking e signature non si guardano e non si toccano (D26)
    }
  }

  // tools[] si salta per intero (D27), ma se ne misura il peso: è il numero che
  // giustifica il salto, e l'ombra lo tiene aggiornato dal vivo.
  const tools = dati['tools']
  const byteSaltati = tools === undefined ? 0 : JSON.stringify(tools).length

  return { trovati: [...dentro.values()], byteGuardati, byteSaltati }
}
