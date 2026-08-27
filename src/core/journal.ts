// §13 — il journal. Un file JSONL per sessione, append-only, un CanonicalEvent per riga.
//
// Le quattro invarianti della specifica sono qui, e sono vincoli di codice, non buone
// intenzioni: non si riscrive mai una riga; rileggere il file deve produrre lo stesso
// stato che la UI mostrava; nel journal non entra nulla di nativo; ed è il punto unico
// da cui passa tutto, cioè dove si aggancerà l'anonimizzazione.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { MODEL_VERSION, type CanonicalEvent, type Payload } from './events.ts'

export class Journal {
  readonly path: string
  readonly sessionId: string
  private seq = 0
  private fd: number | null = null

  constructor(path: string, sessionId: string) {
    this.path = path
    this.sessionId = sessionId
    mkdirSync(dirname(path), { recursive: true })
    // Riaprire un journal esistente deve CONTINUARE i seq, non ripartire da 1.
    // Ripartire produrrebbe due eventi con lo stesso seq nello stesso file, e a quel
    // punto "ho gia visto fino a N" smette di voler dire qualcosa: la UI che si
    // riaggancia dopo un risveglio salterebbe meta della conversazione.
    this.seq = lastSeq(path)
    this.fd = openSync(path, 'a')
  }

  /** Da dove riparte la numerazione. Serve a `session.woke`. */
  get lastSeq(): number { return this.seq }

  /**
   * Assegna `seq`, scrive la riga e restituisce l'evento completo.
   *
   * `ts` si puo imporre: importando un trascritto, l'ora vera e quella in cui i fatti
   * sono accaduti, non quella in cui li abbiamo letti. Una conversazione di due giorni
   * fa che si mostra tutta con l'orario di adesso e sbagliata in modo silenzioso.
   *
   * La scrittura è sincrona di proposito: `seq` deve essere senza buchi e nell'ordine
   * in cui i fatti sono accaduti. Con una scrittura asincrona due append ravvicinati
   * possono invertirsi sul disco, e a quel punto il replay ricostruisce uno stato che
   * non è mai esistito. Se un giorno diventerà un problema di prestazioni, la risposta
   * è una coda ordinata, non l'asincrono nudo.
   */
  append(payload: Payload, ts = Date.now()): CanonicalEvent {
    if (this.fd === null) throw new Error('journal chiuso')
    const event: CanonicalEvent = {
      v: MODEL_VERSION,
      seq: ++this.seq,
      ts,
      sessionId: this.sessionId,
      payload,
    }
    writeSync(this.fd, JSON.stringify(event) + '\n')
    return event
  }

  close(): void {
    if (this.fd !== null) { closeSync(this.fd); this.fd = null }
  }

  /** Rilettura dall'inizio: è esattamente ciò che fa il risveglio da Sleep. */
  static read(path: string): CanonicalEvent[] {
    if (!existsSync(path)) return []
    const out: CanonicalEvent[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      out.push(JSON.parse(line) as CanonicalEvent)
    }
    return out
  }

  /**
   * Solo ciò che è stato aggiunto dopo `offset`, con il byte da cui ripartire.
   *
   * Esiste perché il journal è **append-only**, e chi lo rilegge intero a ogni giro
   * sta pagando tutta la storia per sapere l'ultima riga. L'elenco delle
   * conversazioni faceva esattamente questo: `reduce(Journal.read(...))` su ogni
   * file a ogni colpetto, fino a quattro volte al secondo mentre una chat streama.
   * Misurato su un journal vero da 12 MB (25.143 eventi): 82 ms per **una** chat.
   *
   * L'offset avanza solo oltre le righe **complete**: una `writeSync` in corso può
   * lasciare l'ultima riga a metà, e ripartire da dentro quella riga produrrebbe due
   * frammenti che non sono JSON né l'uno né l'altro. Il resto monco si rilegge al
   * giro dopo, quando sarà finito — costa una riga, non tutto il file.
   *
   * Chi la usa deve gestire il caso `offset > dimensione`: vuol dire che il file non
   * è più quello di prima (cancellato e ricreato), e allora si rilegge da capo. Qui
   * non si decide, si riporta: `from` dice da dove si è letto davvero.
   */
  static readFrom(path: string, offset: number): { events: CanonicalEvent[]; offset: number; from: number } {
    if (!existsSync(path)) return { events: [], offset: 0, from: 0 }
    const size = statSync(path).size
    // Il file si è accorciato: non è una coda dello stesso file, è un altro file.
    const from = offset > size ? 0 : offset
    if (from === size) return { events: [], offset: size, from }

    const fd = openSync(path, 'r')
    let text: string
    try {
      const buf = Buffer.allocUnsafe(size - from)
      const letti = readSync(fd, buf, 0, buf.length, from)
      text = buf.subarray(0, letti).toString('utf8')
    } finally { closeSync(fd) }

    const events: CanonicalEvent[] = []
    let consumati = 0
    let a = 0
    for (;;) {
      const nl = text.indexOf('\n', a)
      if (nl === -1) break            // resto senza newline: riga non ancora finita
      const line = text.slice(a, nl)
      a = nl + 1
      consumati = a
      if (!line.trim()) continue
      events.push(JSON.parse(line) as CanonicalEvent)
    }
    return { events, offset: from + Buffer.byteLength(text.slice(0, consumati), 'utf8'), from }
  }
}

/** Ultimo `seq` presente nel file, 0 se il file non esiste o e vuoto. */
function lastSeq(path: string): number {
  if (!existsSync(path)) return 0
  let max = 0
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { max = Math.max(max, (JSON.parse(line) as CanonicalEvent).seq) } catch { /* riga monca */ }
  }
  return max
}

/**
 * Il raw nativo va in un file separato e non versionato, mai mescolato al journal (§13).
 * Serve solo a poter dire "l'adapter ha tradotto male questo" senza rieseguire la sessione.
 */
export class RawLog {
  private readonly path: string

  constructor(path: string) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true })
  }
  write(line: string): void { appendFileSync(this.path, line + '\n') }
}
