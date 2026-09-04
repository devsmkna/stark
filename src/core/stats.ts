// Quanto è stato usato STARK.
//
// Perché sta qui e non nel daemon, come per `search.ts`: è una domanda sullo
// **stato**, non sul disco. Lo stato di una conversazione è lo `SessionSnapshot`
// del §4, e chi lo tiene già in memoria — il registro, per l'elenco — non deve
// rileggere niente per rispondere. Il corollario è che le statistiche contano
// esattamente ciò che la UI mostra.
//
// Ed è una funzione **pura** su snapshot, non una rotta: il giorno in cui esisterà
// un server che aggrega più utilizzatori, si manderà il suo risultato — venti
// numeri — invece dei journal. Quel server oggi non c'è, e non si costruisce niente
// per lui (YAGNI): la purezza è una conseguenza di dove sta la regola, non un
// investimento su un futuro.
//
// **Quel giorno è arrivato** (4 settembre 2026), e la premessa ha retto: `righeUso()`
// qui in fondo manda al cloud venti numeri per riga invece dei journal, ed è pura
// come questa. Quello che non era stato previsto è che a cambiare non fosse il
// *quanto* si manda ma la *forma*: il server vuole righe sulla tupla piena
// (giorno × progetto × agent × modello), non quattro ripartizioni separate, perché
// con quelle un `GROUP BY` non può più ritagliare niente.
//
// Cosa NON c'è, di proposito: il costo in dollari. `Cost.nominalUsd` è un prezzo di
// listino API, non una spesa — l'utente è su abbonamento a quota fissa. In una
// schermata di statistiche un numero in dollari si legge come denaro uscito, e
// sarebbe una bugia. I token invece sono reali, e ci sono.

import type { SessionSnapshot, TurnView } from './reduce.ts'
import { promptText } from './events.ts'

/** Estremi in ms. Assenti = da sempre. `to` è escluso, `from` incluso. */
export type Periodo = { from?: number; to?: number }

export type Conteggi = {
  /** Conversazioni con **almeno un turno** nel periodo. Non «quante ne esistono»:
   *  quella è un'altra domanda, e la risponde già l'elenco. */
  conversations: number
  prompts: number
  /** Il solo testo dei prompt. Un allegato non è un carattere digitato. */
  chars: number
  /** Somma di `endedAt - startedAt` sui turni **finiti**. Uno in corso non ha una
   *  durata: sommarne una parziale farebbe salire il totale mentre lo guardi. */
  agentMs: number
  tools: number
  files: number
  commands: number
  aborted: number
  errored: number
  interrupted: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export type Ripartizione = { key: string; label: string; c: Conteggi }

export type Stats = {
  totale: Conteggi
  /** `day` è `YYYY-MM-DD` nel fuso della macchina che calcola: è il daemon a sapere
   *  in che giornata è caduto un turno, e mandare in giro dei ms lascerebbe al
   *  browser di rifare il taglio con un fuso che può essere un altro. */
  perGiorno: { day: string; c: Conteggi }[]
  perProgetto: Ripartizione[]
  perAgent: Ripartizione[]
  perModello: Ripartizione[]
}

/** Quando una chiave manca è **`unknown`**, non una riga scartata: un journal vecchio
 *  senza `agent` è comunque uso di STARK, e farlo sparire farebbe non tornare i totali
 *  con la somma delle righe. */
export const IGNOTO = 'unknown'

const vuoti = (): Conteggi => ({
  conversations: 0, prompts: 0, chars: 0, agentMs: 0,
  tools: 0, files: 0, commands: 0,
  aborted: 0, errored: 0, interrupted: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/** Il periodo si applica al **turno**, non alla conversazione: una chat aperta a marzo
 *  e usata oggi conta oggi. */
const dentro = (ts: number, p: Periodo): boolean =>
  (p.from === undefined || ts >= p.from) && (p.to === undefined || ts < p.to)

/** `YYYY-MM-DD` locale. Non `toISOString()`, che è UTC: alle 23:30 direbbe domani. */
export function giorno(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function turno(c: Conteggi, t: TurnView): void {
  c.prompts += 1
  c.chars += promptText(t.prompt).length
  if (t.ended && t.endedAt !== undefined) c.agentMs += Math.max(0, t.endedAt - t.startedAt)
  for (const part of t.parts) if (part.kind === 'tool') c.tools += 1
  if (t.reason === 'aborted') c.aborted += 1
  else if (t.reason === 'error') c.errored += 1
  else if (t.reason === 'interrupted') c.interrupted += 1
  // I token del **turno**, non quelli della sessione: solo così un periodo può
  // tagliarli. `snapshot.usage` è il totale di sempre, e su «oggi» direbbe tutto.
  if (t.usage) {
    c.tokens.input += t.usage.input
    c.tokens.output += t.usage.output
    c.tokens.cacheRead += t.usage.cacheRead
    c.tokens.cacheWrite += t.usage.cacheWrite
  }
}

/** Un secchiello per chiave, creato alla prima volta che serve. */
class Gruppi {
  private readonly m = new Map<string, Conteggi>()
  per(key: string): Conteggi {
    let c = this.m.get(key)
    if (!c) { c = vuoti(); this.m.set(key, c) }
    return c
  }
  /** Ordinate per tempo di lavoro: la domanda è «cosa mi ha mangiato il tempo», e
   *  il numero di prompt risponderebbe «dove ho scritto di più», che è un'altra. */
  righe(label: (k: string) => string): Ripartizione[] {
    return [...this.m].map(([key, c]) => ({ key, label: label(key), c }))
      .sort((a, b) => b.c.agentMs - a.c.agentMs || b.c.prompts - a.c.prompts)
  }
}

export function statsFrom(iter: Iterable<SessionSnapshot>, p: Periodo = {}): Stats {
  // Materializzato subito: `snaps` arriva spesso come `Map.values()`, che è un
  // iteratore **a perdere** — scorrerlo due volte (i totali, poi i giorni) darebbe
  // zero al secondo giro, in silenzio.
  const snaps = [...iter]
  const totale = vuoti()
  const giorni = new Gruppi()
  const progetti = new Gruppi()
  const agenti = new Gruppi()
  const modelli = new Gruppi()

  for (const s of snaps) {
    const turni = s.turns.filter(t => dentro(t.startedAt, p))
    // Gli effetti hanno un'ora loro (`FileEditView.ts`) e si filtrano da soli: un file
    // toccato oggi in una chat di marzo va contato oggi, e viceversa.
    const files = s.files.filter(f => dentro(f.ts, p)).length
    const commands = s.shell.filter(c => dentro(c.ts, p)).length
    if (turni.length === 0 && files === 0 && commands === 0) continue

    const cwd = s.cwd ?? IGNOTO
    const agent = s.agent ?? IGNOTO
    // Il modello **attuale** della chat, non quello del singolo turno, che nel journal
    // per turno non c'è. Costo dichiarato: una chat spostata da Sonnet a Opus a metà
    // strada finisce tutta su Opus. È il dato che esiste; l'alternativa è inventarlo.
    const model = s.model ?? IGNOTO

    const secchielli = [totale, progetti.per(cwd), agenti.per(agent), modelli.per(model)]
    for (const c of secchielli) {
      c.conversations += 1
      c.files += files
      c.commands += commands
    }
    for (const t of turni) {
      for (const c of [...secchielli, giorni.per(giorno(t.startedAt))]) turno(c, t)
    }
    // Gli effetti nel secchiello del **loro** giorno, non di quello del turno: un
    // comando lanciato dopo mezzanotte appartiene alla notte in cui è girato. Sta in
    // un ciclo suo e non insieme ai turni perché i due giorni possono non coincidere.
    for (const f of s.files) if (dentro(f.ts, p)) giorni.per(giorno(f.ts)).files += 1
    for (const c of s.shell) if (dentro(c.ts, p)) giorni.per(giorno(c.ts)).commands += 1
  }

  // Le conversazioni per giorno si contano a parte, perché una chat usata in tre
  // giorni diversi è **una** nel totale e **tre** nei rispettivi giorni: sommare la
  // colonna del grafico non deve dare il totale, e va contata dove si guarda.
  const perGiorno = ricontaGiorni(snaps, p, giorni)

  return {
    totale,
    perGiorno,
    perProgetto: progetti.righe(k => k),
    perAgent: agenti.righe(k => k),
    perModello: modelli.righe(k => k),
  }
}

// ─── le righe da mandare in cloud ────────────────────────────────────────────
//
// `statsFrom()` produce ripartizioni **separate** — per progetto, per agent, per
// modello — non la loro combinazione. Per una tabella servono invece righe sulla
// tupla piena, così che il server possa ritagliare qualunque di quelle viste con un
// `GROUP BY` invece di riceverne quattro già fatte.
//
// È facile perché uno snapshot ha **un** cwd, **un** agent, **un** modello: a
// spezzarsi sono solo i giorni dei turni. E resta pura come tutto il resto del file:
// la chiave di progetto (l'origin git, che vale fra macchine diverse mentre un
// percorso no) entra come funzione passata da chi chiama, così `stats.ts` non impara
// a lanciare `git`.

export type RigaUso = {
  day: string
  projectKey: string
  projectLabel: string
  agent: string
  model: string
  c: Conteggi
}

/**
 * Quale conversazione era viva in quale giorno.
 *
 * Serve a contare le conversazioni **distinte** su un periodo senza gonfiarle: una
 * chat aperta lunedì e ripresa mercoledì è una riga per lunedì e una per mercoledì
 * in `RigaUso`, e sommare quelle direbbe «due conversazioni» di una sola. Con questi
 * la somma diventa un `COUNT(DISTINCT session_id)`, che è la stessa cosa che fa
 * `ricontaGiorni()` qui sopra con un `Set`.
 *
 * Progetto, agent e modello viaggiano con la riga anche se sembrano ridondanti: una
 * sessione ne ha uno solo di ciascuno, quindi dipendono dal `sessionId` — ma senza
 * di loro il conteggio distinto si potrebbe fare **solo** sul totale, e «quante
 * conversazioni su questo progetto» tornerebbe a essere gonfiabile.
 */
export type SessionDay = {
  day: string
  sessionId: string
  projectKey: string
  agent: string
  model: string
}

export type RigheUso = { righe: RigaUso[]; sessionDays: SessionDay[] }

/** Come si chiama un progetto fra macchine diverse. Il chiamante risolve l'origin git. */
export type ChiaveProgetto = (s: SessionSnapshot) => { key: string; label: string }

export function righeUso(
  iter: Iterable<SessionSnapshot>, p: Periodo, chiave: ChiaveProgetto,
): RigheUso {
  // Materializzato per la stessa ragione di `statsFrom`: spesso arriva un iteratore
  // a perdere, e qui lo si scorre una volta sola ma non è una garanzia da lasciare
  // implicita in un file dove l'altra funzione lo scorre due.
  const snaps = [...iter]
  const righe = new Map<string, RigaUso>()
  // Le conversazioni distinte per riga: un `Set` per chiave, come in `ricontaGiorni`.
  const vistiPerRiga = new Map<string, Set<string>>()
  // Le coppie (giorno, sessione) senza doppioni. La chiave porta anche il giorno
  // perché la stessa sessione in due giorni sono due righe, ed è tutto il punto.
  const sessionDays = new Map<string, SessionDay>()

  for (const s of snaps) {
    const { key: projectKey, label: projectLabel } = chiave(s)
    const agent = s.agent ?? IGNOTO
    const model = s.model ?? IGNOTO
    const kRiga = (day: string): string => `${day} ${projectKey} ${agent} ${model}`

    const riga = (day: string): RigaUso => {
      const k = kRiga(day)
      let r = righe.get(k)
      if (!r) {
        r = { day, projectKey, projectLabel, agent, model, c: vuoti() }
        righe.set(k, r)
      } else {
        // L'ultima etichetta vince: due macchine possono chiamare lo stesso origin
        // in due modi, e il nome è una cosa da mostrare, non una chiave.
        r.projectLabel = projectLabel
      }
      return r
    }
    /** Quel giorno questa conversazione era viva. Idempotente: è un insieme. */
    const viva = (day: string): void => {
      sessionDays.set(`${day} ${s.sessionId}`,
        { day, sessionId: s.sessionId, projectKey, agent, model })
      let set = vistiPerRiga.get(kRiga(day))
      if (!set) { set = new Set(); vistiPerRiga.set(kRiga(day), set) }
      set.add(s.sessionId)
    }

    for (const t of s.turns) {
      if (!dentro(t.startedAt, p)) continue
      const d = giorno(t.startedAt)
      turno(riga(d).c, t)
      viva(d)
    }
    // Gli effetti nel giorno **loro**, non in quello del turno: stessa regola di
    // `statsFrom`, e per la stessa ragione — un comando lanciato dopo mezzanotte
    // appartiene alla notte in cui è girato.
    for (const f of s.files) {
      if (!dentro(f.ts, p)) continue
      const d = giorno(f.ts)
      riga(d).c.files += 1
      viva(d)
    }
    for (const c of s.shell) {
      if (!dentro(c.ts, p)) continue
      const d = giorno(c.ts)
      riga(d).c.commands += 1
      viva(d)
    }
  }

  for (const [k, r] of righe) r.c.conversations = vistiPerRiga.get(k)?.size ?? 0

  return {
    righe: [...righe.values()].sort((a, b) => a.day.localeCompare(b.day)),
    sessionDays: [...sessionDays.values()],
  }
}

function ricontaGiorni(
  snaps: Iterable<SessionSnapshot>, p: Periodo, giorni: Gruppi,
): { day: string; c: Conteggi }[] {
  const viste = new Map<string, Set<string>>()
  for (const s of snaps) {
    for (const t of s.turns) {
      if (!dentro(t.startedAt, p)) continue
      const d = giorno(t.startedAt)
      let set = viste.get(d)
      if (!set) { set = new Set(); viste.set(d, set) }
      set.add(s.sessionId)
    }
  }
  return giorni.righe(k => k)
    .map(r => {
      r.c.conversations = viste.get(r.key)?.size ?? 0
      return { day: r.key, c: r.c }
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}
