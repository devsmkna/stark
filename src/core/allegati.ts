// Cosa si puo' attaccare a un prompt — e chi lo decide.
//
// Prima di questo file la risposta era una costante scritta in due posti: quattro tipi
// di immagine in `Dock.svelte` e gli stessi quattro in `registry.ts`, con accanto il
// commento «i quattro tipi che il modello accetta». Non erano *del modello*: erano di
// STARK, e valevano identici per un modello che legge i PDF e per uno che non guarda
// niente. Il bottone graffetta si offriva sempre, anche dove non c'era niente da
// allegare, e si rifiutava sempre tutto il resto, anche dove sarebbe passato.
//
// La regola nuova, e l'unica: **lo dichiara l'agent, modello per modello**
// (`ModelChoice.accepts`). Chi disegna la casella non conosce nessun tipo — chiede al
// modello in uso cosa accetta e filtra con quello. E' la stessa forma di ADR-014 per le
// modalita': non un elenco di parole da sapere, ma un elenco che arriva.
//
// Cosa ci mette dentro ciascun agent, e come lo sa (misurato il 28 agosto 2026):
//
//   - **Claude Code** non lo dichiara affatto. `list_models` dell'handshake vero porta
//     cinque modelli e **nessun campo** sulla multimodalita' (`supportsEffort`,
//     `supportsAutoMode`, ... e basta): l'elenco lo scrive l'adapter, ed e' quello che
//     il CLI stesso lascia passare — le quattro immagini che gia' viaggiavano, piu' i
//     `document`, provati dal vivo con `spike/allegato-pdf.ts`.
//   - **OpenCode** lo dichiara eccome: `capabilities.input.{text,image,audio,video,pdf}`
//     per modello. Su questa macchina, 151 modelli: 61 con `image`, 4 con `pdf`, 10 con
//     `audio`, 28 con `video`. E `attachment: true` con `image: false` **esiste** (i
//     modelli voce/video di nvidia), quindi il flag da solo non e' «accetta immagini».

import type { ModelChoice } from './events.ts'

/**
 * Le quattro immagini che l'API accetta, e il ripiego per tutto cio' che non dichiara.
 *
 * Vale come ripiego perche' e' cio' che STARK faceva prima che gli allegati fossero una
 * scelta del modello: un journal scritto ieri non ha `accepts` su nessun modello, e
 * spegnergli il bottone sarebbe togliere una cosa che li' funzionava.
 */
export const IMMAGINI = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/**
 * Con quale estensione un allegato si scrive su disco.
 *
 * E' anche la lista di cio' che STARK sa **trasportare**: il registro rifiuta quello
 * che non e' qui dentro (il nome del file lo scegliamo noi, mai chi carica), e nessun
 * adapter puo' dichiarare piu' di questo senza aggiungercelo. Un tipo dichiarato da un
 * agent ma assente qui verrebbe offerto e poi buttato in silenzio: e' il modo in cui
 * questa tabella e `accepts` restano una cosa sola.
 */
export const ESTENSIONE: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv',
  'video/mp4': 'mp4', 'audio/mpeg': 'mp3',
}

/** Il contrario, per rispondere con l'intestazione giusta quando li si rilegge. */
export const DA_ESTENSIONE: Record<string, string> = Object.fromEntries(
  Object.entries(ESTENSIONE).map(([mime, ext]) => [ext, mime]),
)

/** Come si chiama un tipo quando lo si dice a un umano. */
const ETICHETTA: Record<string, string> = {
  'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP',
  'application/pdf': 'PDF',
  'text/plain': 'TXT', 'text/markdown': 'Markdown', 'text/csv': 'CSV',
  'video/mp4': 'MP4', 'audio/mpeg': 'MP3',
}

/**
 * Cosa accetta il modello in uso.
 *
 * I tre casi sono diversi apposta: un elenco **vuoto** e' una risposta («questo modello
 * non legge allegati»), un elenco **assente** e' un'assenza di risposta — un journal di
 * prima, o un agent che non dichiara — e li' si torna a com'era, cioe' le immagini.
 * Fonderli vorrebbe dire o spegnere il bottone su mezza storia gia' scritta, o
 * offrirlo su un modello che ha appena detto di no.
 */
export function tipiAccettati(model?: Pick<ModelChoice, 'accepts'> | undefined): string[] {
  return model?.accepts ?? IMMAGINI
}

/** Il modello in uso, fra quelli dichiarati. `model` puo' essere l'id di una voce
 *  (`default`) o il risolto (`claude-opus-5[1m]`): si guardano tutti e due. */
export function modelloInUso(models: ModelChoice[], model?: string): ModelChoice | undefined {
  if (!model) return undefined
  return models.find(m => m.id === model) ?? models.find(m => m.resolved === model)
}

/**
 * Che tipo ha davvero questo file.
 *
 * Il browser non e' una fonte affidabile: su `.md` e su `.csv` `File.type` e' spesso la
 * stringa vuota, perche' dipende dal database MIME del sistema e non dal contenuto.
 * Fidarsi solo di quello rifiuterebbe un file che il modello legge benissimo, con un
 * messaggio che dice «e' un » — cioe' che non dice niente. L'estensione e' il secondo
 * parere, e su un file scelto a mano e' quasi sempre quello giusto.
 */
export function tipoDi(file: { type?: string; name?: string }): string {
  const dichiarato = (file.type ?? '').toLowerCase()
  if (dichiarato && ESTENSIONE[dichiarato]) return dichiarato
  const ext = (file.name ?? '').toLowerCase().split('.').pop() ?? ''
  return DA_ESTENSIONE[ext] ?? dichiarato
}

/** Un'immagine si mostra, tutto il resto si nomina: e' l'unica differenza che serve
 *  a chi disegna, e la sola ragione per cui `PromptPart` ha due forme e non una. */
export const parteDi = (mediaType: string): 'image' | 'file' =>
  mediaType.startsWith('image/') ? 'image' : 'file'

/** «PNG, JPEG, GIF, WebP, PDF» — quello che si scrive quando si rifiuta qualcosa. */
export const nomiBrevi = (tipi: string[]): string =>
  tipi.map(t => ETICHETTA[t] ?? t).join(', ')

/**
 * Il filtro del selettore file di sistema.
 *
 * Ai tipi si sommano le **estensioni**, e non e' ridondanza: `accept="text/markdown"`
 * non fa comparire i `.md` sui sistemi che non conoscono quel tipo, mentre
 * `accept=".md"` si', e chi li conosce entrambi non ci perde niente.
 */
export const filtroFile = (tipi: string[]): string =>
  [...tipi, ...tipi.map(t => ESTENSIONE[t]).filter(Boolean).map(e => `.${e}`)].join(',')
