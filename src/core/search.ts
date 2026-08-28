// Cercare dentro le conversazioni.
//
// Perché sta qui e non nel daemon: cercare è una domanda sullo **stato**, non sul
// disco. Lo stato di una conversazione è lo `SessionSnapshot` del §4, e chi lo tiene
// già in memoria — il registro, per l'elenco — non deve rileggere niente per
// rispondere. Il corollario è che la ricerca vede esattamente ciò che la UI mostra:
// se cercassimo dentro le righe del journal, un testo arrivato in tre `text.delta`
// non si troverebbe mai, perché su disco non è mai scritto intero da nessuna parte.
//
// Non c'è nessuna espressione regolare, di proposito. Una casella di ricerca in cui
// scrivere `(` fa esplodere tutto è peggio di una che trova meno: si cerca del testo,
// e chi cerca `array.map(` intende quei caratteri lì.

import type { SessionSnapshot, TurnView } from './reduce.ts'
import { promptText } from './events.ts'

/** Dove è stata trovata una cosa. `kind` è ciò che permette di dirlo senza aprirla. */
export type Match = {
  turnId: string
  /** L'indice del turno: serve alla UI per dire «turno 4 di 37» senza contarli. */
  turn: number
  ts: number
  /**
   * Chi ha scritto il testo in cui si è trovato. Sono tre cose diverse per chi cerca:
   * «l'avevo chiesto io» (`prompt`), «me l'aveva risposto» (`answer`), «l'ha fatto»
   * (`tool` — un comando, un percorso).
   */
  kind: 'prompt' | 'answer' | 'tool'
  /** Il testo attorno, già ritagliato. */
  snippet: string
  /** Dove sta la corrispondenza **dentro `snippet`**, per evidenziarla senza ricercarla.
   *  Rifare la ricerca nella UI vorrebbe dire scriverla due volte, e sbagliarla in un
   *  posto solo: il maiuscolo/minuscolo è già stato deciso qui. */
  at: number
  len: number
}

export type SessionMatches = {
  sessionId: string
  title: string
  cwd?: string
  /** Quante volte in tutta la conversazione, anche oltre quelle riportate. */
  total: number
  matches: Match[]
}

/** Quanto testo attorno alla corrispondenza. Abbastanza per capire di cosa si parlava. */
const CONTORNO = 60

/**
 * Sotto questo non si cerca. Con un carattere solo la risposta è «tutte», che non è
 * una risposta — e costerebbe un ritaglio per ogni turno di ogni conversazione per
 * dirlo. Sta qui e non nel daemon perché è una regola **della ricerca**: se la
 * tenesse solo la rotta, chiunque altro chiamasse `searchSnapshot` avrebbe una soglia
 * diversa, e due parti di STARK risponderebbero cose diverse alla stessa domanda.
 */
export const MINIMO = 2

/**
 * Il ritaglio attorno alla prima corrispondenza in `text`, con la posizione relativa.
 *
 * Il taglio va sui **caratteri**, non sulle parole: tagliare a parola intera sposta il
 * ritaglio di una quantità che dipende dal testo, e su un termine trovato dentro un
 * percorso (`src/adapters/claude-code/`) non esistono parole da rispettare.
 */
function ritaglia(text: string, at: number, len: number): { snippet: string; at: number } {
  const da = Math.max(0, at - CONTORNO)
  const a = Math.min(text.length, at + len + CONTORNO)
  const prefisso = da > 0 ? '…' : ''
  const suffisso = a < text.length ? '…' : ''
  // Gli a capo diventano spazi: il risultato è una riga in un elenco, e un ritaglio
  // che ne occupa sei sposterebbe tutti gli altri fuori vista.
  const corpo = text.slice(da, a).replace(/\s+/g, ' ')
  // La corrispondenza si è spostata di quanto ha collassato lo spazio a sinistra.
  const sinistra = text.slice(da, at)
  return {
    snippet: prefisso + corpo + suffisso,
    at: prefisso.length + sinistra.replace(/\s+/g, ' ').length,
  }
}

/** Ogni testo di una conversazione, etichettato con chi l'ha scritto. */
function* testi(t: TurnView): Generator<{ kind: Match['kind']; text: string }> {
  const p = promptText(t.prompt)
  if (p) yield { kind: 'prompt', text: p }
  for (const part of t.parts) {
    // La guardia non è pignoleria: la ricerca gira su journal scritti in qualunque
    // momento della vita di STARK, anche da una versione che scriveva una parte in
    // modo leggermente diverso. Una riga malformata deve far trovare meno, non far
    // fallire la ricerca di tutte le altre conversazioni.
    if (part.kind === 'text') { if (part.text) yield { kind: 'answer', text: part.text } }
    // Il ragionamento **non** si cerca: è materiale di lavorazione, e trovarci dentro
    // una parola porterebbe a un blocco chiuso che non dice niente a chi cerca.
    else if (part.kind === 'tool') {
      // Ciò che il tool ha fatto, non il suo input grezzo: `inputRaw` è JSON, e
      // cercare `path` ci troverebbe la chiave, non il percorso.
      if (part.summary) yield { kind: 'tool', text: part.summary }
      if (part.intent && part.intent !== part.summary) yield { kind: 'tool', text: part.intent }
    }
  }
}

/**
 * Le corrispondenze dentro una conversazione, dalla più recente alla più vecchia.
 *
 * Dalla più recente perché una conversazione lunga si cerca quasi sempre per
 * ritrovare qualcosa di poco fa; e perché con un tetto sui risultati, tenere i primi
 * significherebbe mostrare l'inizio di una chat di quaranta turni e nascondere la
 * fine, che è il contrario di quello che serve.
 */
export function searchSnapshot(s: SessionSnapshot, query: string, limit = 5): Match[] {
  const q = query.trim().toLowerCase()
  if (q.length < MINIMO) return []
  const out: Match[] = []
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const t = s.turns[i]!
    for (const { kind, text } of testi(t)) {
      // Il tetto si controlla **qui dentro**, non solo a fine turno: un turno solo può
      // contenerne decine — trenta righe di tool che nominano tutte la stessa parola —
      // e controllarlo fuori lasciava passare tutto quel turno. Visto nel browser
      // vero: 48 risultati con il tetto a 5, cioè un muro al posto di un elenco.
      if (out.length >= limit) break
      const at = text.toLowerCase().indexOf(q)
      if (at === -1) continue
      const r = ritaglia(text, at, q.length)
      out.push({
        turnId: t.turnId, turn: i, ts: t.startedAt, kind,
        snippet: r.snippet, at: r.at, len: q.length,
      })
      // Una corrispondenza per testo e non per occorrenza: dieci volte la stessa
      // parola in una risposta sono una risposta sola, e riportarle tutte
      // spingerebbe fuori vista le altre conversazioni. Ma prompt e risposta restano
      // due risultati distinti: «l'avevo chiesto io» e «me l'aveva risposto» sono le
      // due cose diverse che si stanno cercando.
    }
    if (out.length >= limit) break
  }
  return out
}

/** Quante volte in tutta la conversazione, per dire «3 matches» senza tenerle tutte. */
export function countSnapshot(s: SessionSnapshot, query: string): number {
  const q = query.trim().toLowerCase()
  if (q.length < MINIMO) return 0
  let n = 0
  for (const t of s.turns) for (const { text } of testi(t)) {
    let a = text.toLowerCase().indexOf(q)
    while (a !== -1) { n++; a = text.toLowerCase().indexOf(q, a + q.length) }
  }
  return n
}
