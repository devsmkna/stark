// §13 — il journal. Un file JSONL per sessione, append-only, un CanonicalEvent per riga.
//
// Le quattro invarianti della specifica sono qui, e sono vincoli di codice, non buone
// intenzioni: non si riscrive mai una riga; rileggere il file deve produrre lo stesso
// stato che la UI mostrava; nel journal non entra nulla di nativo; ed è il punto unico
// da cui passa tutto, cioè dove si aggancerà l'anonimizzazione.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
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
    this.fd = openSync(path, 'a')
  }

  /**
   * Assegna `seq` e `ts`, scrive la riga e restituisce l'evento completo.
   *
   * La scrittura è sincrona di proposito: `seq` deve essere senza buchi e nell'ordine
   * in cui i fatti sono accaduti. Con una scrittura asincrona due append ravvicinati
   * possono invertirsi sul disco, e a quel punto il replay ricostruisce uno stato che
   * non è mai esistito. Se un giorno diventerà un problema di prestazioni, la risposta
   * è una coda ordinata, non l'asincrono nudo.
   */
  append(payload: Payload): CanonicalEvent {
    if (this.fd === null) throw new Error('journal chiuso')
    const event: CanonicalEvent = {
      v: MODEL_VERSION,
      seq: ++this.seq,
      ts: Date.now(),
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
