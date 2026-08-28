// Come si raggruppa il lavoro dentro un turno.
//
// Sta qui e non dentro `Conversation.svelte` per la stessa ragione di `layout.ts`: è la
// parte che si sbaglia davvero — dove finisce il recap, cosa spezza il gruppo, cosa
// succede a un turno interrotto a metà — e qui si prova con `node` puro
// (`npm run gruppi:check`), senza browser e senza Svelte. Il componente resta il posto
// in cui si decide come *disegnarlo*.
//
// ─── la regola, e da dove viene ────────────────────────────────────────────────
//
// Fra il prompt e la risposta finale c'è **un solo blocco**, chiuso. Ci finiscono i
// tool, i ragionamenti e le narrazioni di servizio («ora guardo il CSS»); resta fuori
// ciò che l'agent scrive rivolto a te.
//
// Prima ci finivano solo tool e reasoning **consecutivi**, e un testo qualunque
// spezzava il gruppo: la premessa scritta allora era che «se in mezzo l'agent scrive
// del testo, quel testo è la prova che si è fermato a dire qualcosa». Misurata sui
// journal veri, non regge: un testo interstiziale ha **mediana 131 caratteri** (710
// casi, solo 2 sopra gli 800) ed è la didascalia di ciò che sta per fare. Siccome
// l'agent ne scrive uno ogni tre o quattro tool, spezzare lì voleva dire non
// raggruppare mai niente — un turno da 418 parti restava **103 blocchi** in colonna;
// con i testi dentro ne fa **2**.
//
// Le due specie di testo che restano fuori si riconoscono dalla **posizione**, non da
// una soglia di lunghezza indovinata:
//   · il recap finale — mediana 2487 caratteri;
//   · il testo che introduce una domanda o un permesso — mediana **2631**, cioè la
//     taglia di un recap, perché è quello che ti dice per farti scegliere.
// Con loro restano fuori la compattazione e i retry, che non sono lavoro: sono tagli
// del flusso, e nasconderli toglierebbe la spiegazione di ciò che si vede attorno.

import type { PartView } from '$core/reduce.ts'

export type OpPart = Extract<PartView, { kind: 'tool' | 'reasoning' }>

export type Grp =
  /** Una parte che vive da sola nel flusso: il recap, una risposta, un taglio. */
  | { kind: 'solo'; key: string; part: PartView }
  /** L'operazione ancora in corso: l'unica di cui ha senso chiedersi «a che punto è». */
  | { kind: 'live'; key: string; part: OpPart }
  /** Il lavoro accorpato, in ordine: tool, ragionamenti e narrazioni insieme. */
  | { kind: 'done'; key: string; parts: PartView[] }

export const isOp = (p: PartView): p is OpPart =>
  p.kind === 'tool' || p.kind === 'reasoning'

export const isLive = (p: OpPart): boolean =>
  p.kind === 'tool' ? !p.done : p.open

export const keyOf = (p: PartView): string =>
  p.kind === 'tool' ? p.callId : p.partId

/**
 * Un `thinking` chiuso senza un solo delta non è un pensiero corto: è vuoto. Aprirlo
 * mostrerebbe «…», cioè l'assenza travestita da riga cliccabile. Mentre è ancora
 * aperto resta invece in vista: lì «sta pensando» vale anche a zero caratteri, perché
 * dice che il turno è vivo.
 */
export const isEmptyReasoning = (p: PartView): boolean =>
  p.kind === 'reasoning' && !p.open && p.text.trim() === ''

/**
 * Il recap: l'ultimo testo del turno, e **solo** se è l'ultima parte in assoluto.
 *
 * Un turno che finisce su un tool — interrotto, o ancora in corso — non ce l'ha, e
 * prendere «il testo più in basso» direbbe che una risposta c'è quando non c'è. Sui
 * journal veri la coda è lunga esattamente 1 in 46 turni su 48, e negli altri 2 non
 * c'è: non serve un caso generale per una cosa che non capita.
 */
export const codaIndex = (parts: PartView[]): number =>
  parts.length > 0 && parts[parts.length - 1]!.kind === 'text' ? parts.length - 1 : -1

/**
 * Raggruppa le parti di un turno come vanno disegnate, in ordine.
 *
 * L'ultima operazione **viva** esce sempre dal gruppo: è ciò che sta succedendo
 * adesso, e chiuderla dentro un contatore vorrebbe dire non mostrare più a che punto
 * è. Tutto il resto del lavoro sta in un `done`, che il componente disegna chiuso.
 */
export function groupParts(parts: PartView[]): Grp[] {
  const out: Grp[] = []
  let buf: PartView[] = []
  const coda = codaIndex(parts)

  // «Entro due parti» e non «la prossima»: fra il testo e la risposta ci sta di mezzo
  // il tool della richiesta stessa (`AskUserQuestion`), che è ciò che l'ha fatta
  // comparire nel blocco in basso.
  const introduceUnaRisposta = (i: number): boolean =>
    parts.slice(i + 1, i + 3).some((q) => q.kind === 'answer')

  const rompe = (p: PartView, i: number): boolean =>
    i === coda || p.kind === 'answer' || p.kind === 'compact' || p.kind === 'retry'
    || (p.kind === 'text' && introduceUnaRisposta(i))

  const flush = (): void => {
    if (buf.length === 0) return
    const last = buf[buf.length - 1]!
    if (isOp(last) && isLive(last)) {
      const fatte = buf.slice(0, -1)
      if (fatte.length > 0) out.push({ kind: 'done', key: `d:${keyOf(fatte[0]!)}`, parts: fatte })
      out.push({ kind: 'live', key: `l:${keyOf(last)}`, part: last })
    } else {
      out.push({ kind: 'done', key: `d:${keyOf(buf[0]!)}`, parts: buf })
    }
    buf = []
  }

  parts.forEach((p, i) => {
    if (isEmptyReasoning(p)) return
    if (!rompe(p, i)) { buf.push(p); return }
    flush()
    out.push({ kind: 'solo', key: keyOf(p), part: p })
  })
  flush()
  return out
}

/** Cosa dice l'intestazione di un gruppo chiuso: quanti tool e quante narrazioni. */
export const conta = (parts: PartView[]): { ops: number; note: number } => ({
  ops: parts.filter((p) => p.kind === 'tool').length,
  note: parts.filter((p) => p.kind === 'text').length,
})
