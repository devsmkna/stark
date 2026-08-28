// Passare il lavoro da un agent a un altro, senza cambiare schermata.
//
// Le parole e i nomi stanno in `core/handoff.ts`, che è puro e si prova offline. Qui c'è
// solo l'orchestrazione, che ha bisogno del registro: mandare un prompt, aspettare che
// il turno finisca, aprire la chat nuova, legare le due nei rispettivi journal.
//
// La regola che tiene insieme il tutto: **il file è il contratto**. Non si passa niente
// dall'una all'altra se non un percorso — nessuno stato condiviso, nessuna traduzione
// fra due vocabolari. Se il passaggio va male, quello che restava da sapere è comunque
// su disco, in Markdown, e lo si legge.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { briefingDalJournal, percorsoHandoff, promptBriefing, promptRipresa } from '../core/handoff.ts'
import type { Registry } from './registry.ts'

/**
 * Come si ottiene il briefing.
 *
 * - `agent`: lo scrive il modello uscente. Costa un turno vero, e vale di più — è
 *   l'unico che sa dire «cosa manca» e «attenzione a questo».
 * - `journal`: lo compone STARK dal journal. Gratis, e dice meno: la cronaca, non il
 *   giudizio.
 *
 * Non c'è un default, ed è voluto: su una chat che dorme la scelta cambia il costo, e
 * indovinarla al posto dell'utente vorrebbe dire svegliargli una sessione senza averlo
 * chiesto. Chi chiama senza `via` su una chat non viva si sente rispondere `serve-scelta`.
 */
export type ViaBriefing = 'agent' | 'journal'

export type EsitoHandoff =
  | { ok: true; id: string; file: string }
  /** La chat che deve lasciare non ha un processo dietro: chiedere all'utente. */
  | { ok: false; serveScelta: true; state: string }
  | { ok: false; error: string }

export type RichiestaHandoff = {
  /** La conversazione che lascia. */
  id: string
  agent: string
  model: string
  via?: ViaBriefing
}

/**
 * Quanto si aspetta che il modello uscente scriva il file.
 *
 * Generoso di proposito: è un turno vero su una conversazione che può essere lunga, e
 * scadere troppo presto lascerebbe due chat aperte con un file a metà — il caso peggiore,
 * perché quello che si vede dopo è una chat nuova che legge un briefing troncato e ci
 * lavora sopra convinta.
 */
const ATTESA_MS = 5 * 60 * 1000

export async function eseguiHandoff(
  registry: Registry, r: RichiestaHandoff,
): Promise<EsitoHandoff> {
  const snap = registry.snapshot(r.id)
  if (!snap) return { ok: false, error: 'conversazione sconosciuta' }
  const cwd = snap.cwd
  if (!cwd) return { ok: false, error: 'questa conversazione non ha una cartella' }
  if (snap.agent === r.agent) {
    // Non è un errore dell'utente, è un errore di chi chiama: dentro lo stesso agent il
    // modello si cambia con `session.setModel`, che non costa niente e non apre niente.
    return { ok: false, error: 'stesso agent: usa il cambio di modello, non il passaggio' }
  }

  const viva = registry.isLive(r.id)
  const via = r.via ?? (viva ? 'agent' : undefined)
  if (!via) return { ok: false, serveScelta: true, state: snap.state }
  if (via === 'agent' && !viva) {
    return { ok: false, error: 'la conversazione non è viva: risvegliala prima, o usa il briefing dal journal' }
  }

  const file = percorsoHandoff(new Date())

  if (via === 'journal') {
    // Lo scrive STARK. `resolve` contro la cwd della chat, e non si accetta un percorso
    // assoluto da fuori: il nome lo decide `percorsoHandoff`, non chi chiama la rotta.
    if (isAbsolute(file)) return { ok: false, error: 'percorso inatteso' }
    const pieno = resolve(cwd, file)
    try {
      mkdirSync(dirname(pieno), { recursive: true })
      writeFileSync(pieno, briefingDalJournal(snap, new Date()), 'utf8')
    } catch (e) {
      return { ok: false, error: `non riesco a scrivere ${file}: ${(e as Error).message}` }
    }
  } else {
    const esito = await scriviColModello(registry, r.id, file)
    if (esito) return { ok: false, error: esito }
  }

  // Solo adesso si apre la chat nuova. L'ordine conta: se il briefing fallisce non deve
  // restare in giro una conversazione vuota che l'elenco mostra come se fosse successo
  // qualcosa — la stessa malattia delle «chat fantasma» del 26 agosto.
  let nuova: string
  try {
    nuova = await registry.open({ cwd, agent: r.agent, model: r.model })
  } catch (e) {
    return { ok: false, error: `il passaggio è scritto in ${file}, ma la chat nuova non si è aperta: ${(e as Error).message}` }
  }

  // Le due metà del legame, una per journal. Si scrivono **prima** del primo prompt: se
  // qualcosa va storto subito dopo, resta comunque scritto dove è finito il lavoro.
  registry.annota(r.id, { k: 'session.handedOff', to: nuova, agent: r.agent, model: r.model, file })
  registry.annota(nuova, { k: 'session.continued', from: r.id, file })

  await registry.command(nuova, {
    c: 'session.prompt', text: promptRipresa(file, snap.agent),
  })
  return { ok: true, id: nuova, file }
}

/**
 * Fa scrivere il briefing al modello che lascia, e aspetta che abbia finito.
 *
 * Si aspetta il `turn.ended` **del turno che abbiamo aperto noi**, non il primo che
 * passa: se l'utente aveva già un turno in corso, il nostro prompt entra in coda (la
 * fila FIFO), e il primo `turn.ended` che arriva è quello del suo lavoro, non del
 * nostro. Guardare il `turnId` sbagliato vorrebbe dire aprire la chat nuova su un file
 * che ancora non esiste.
 *
 * Torna `null` se è andata, un messaggio se no.
 */
function scriviColModello(registry: Registry, id: string, file: string): Promise<string | null> {
  const testo = promptBriefing(file)
  return new Promise<string | null>(risolvi => {
    let mio: string | null = null
    let finito = false
    // `let` e non `const`: `subscribe` **riproduce in modo sincrono** gli eventi da
    // `da` in poi prima di restituire, quindi il gestore può essere chiamato mentre
    // `stop` non esiste ancora. Con un `const` sarebbe un ReferenceError nella zona
    // morta, cioè un guasto che compare solo quando due eventi arrivano nell'istante
    // sbagliato — il genere che non si riproduce mai a comando.
    let stop: (() => void) | null = null
    const chiudi = (msg: string | null) => {
      if (finito) return
      finito = true
      clearTimeout(orologio)
      stop?.()
      risolvi(msg)
    }
    const orologio = setTimeout(
      () => chiudi(`il modello non ha finito entro ${Math.round(ATTESA_MS / 60000)} minuti`),
      ATTESA_MS,
    )
    // Da adesso in poi, non da capo: `lastSeq` è il confine fra ciò che è già successo
    // e ciò che stiamo per provocare. Con `0` si riceverebbe tutta la storia della
    // conversazione, e il primo `turn.started` letto sarebbe quello di mesi fa.
    const da = registry.snapshot(id)?.lastSeq ?? 0
    const disiscrivi = registry.subscribe(id, da, e => {
      const p = e.payload
      // Il turno nostro si riconosce **dal testo del prompt**, non dall'essere il primo
      // che parte. Sembrava equivalente e non lo è: se l'utente aveva già scritto
      // qualcosa mentre l'agent lavorava, il nostro prompt entra in coda dietro il suo
      // (la fila è FIFO), e il primo `turn.started` che passa è il suo. Aspettare la
      // fine di quello vorrebbe dire aprire la chat nuova su un file non ancora scritto.
      if (p.k === 'turn.started' && !mio) {
        const scritto = p.prompt.map(x => (x.type === 'text' ? x.text : '')).join('')
        if (scritto === testo) mio = p.turnId
      }
      if (p.k === 'turn.ended' && p.turnId === mio) {
        chiudi(p.reason === 'completed'
          ? null
          : `il turno che doveva scrivere ${file} è finito come «${p.reason}»`)
      }
      if (p.k === 'session.error' && p.fatal) chiudi(p.message)
    })
    if (finito) disiscrivi()
    else stop = disiscrivi
    void registry.command(id, { c: 'session.prompt', text: testo })
      .then(esito => { if (!esito.ok) chiudi(esito.error) })
      .catch((e: unknown) => chiudi(String((e as Error).message ?? e)))
  })
}
