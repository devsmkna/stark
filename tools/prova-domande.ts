// Prova a occhio del box delle domande ridisegnato (28 agosto 2026). Casa in /tmp e porta
// effimera: non tocca né le conversazioni vere né il daemon acceso.
//
// **Costo zero di quota.** Le sessioni si aprono davvero — serve un processo vero, vedi
// sotto — ma un'apertura è solo l'handshake: nessun turno parte mai.
//
// Tre casi, perché sono i tre che si sbagliano in modo diverso:
//   1. domanda sola, con un'opzione raccomandata e le descrizioni
//   2. due domande, la seconda a scelta multipla (il segno diventa quadrato)
//   3. opzione con `preview`, ed etichette lunghe che devono andare a capo
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-domande')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
// Prima dell'import: `registry.ts` risolve `STARK_HOME` una volta sola al load del
// modulo, e un `import` statico verrebbe issato in cima al file — cioè eseguito prima
// di questa riga, sulla casa vera dell'utente.
process.env['STARK_HOME'] = CASA

const { startDaemon } = await import('../src/daemon/server.ts')
const { applyTo } = await import('../src/core/reduce.ts')
const daemon = await startDaemon({ port: 0, token: 'prova'.padEnd(64, '0') })

/**
 * Una domanda in attesa **ha bisogno di una chat viva**: `Dock.svelte` monta il box solo
 * se `store.live`, e ha ragione — su una chat senza processo dietro non ci sarebbe
 * nessuno a ricevere la risposta, quindi un box di bottoni sarebbe una bugia.
 *
 * Quindi si apre una sessione vera e le si consegna la domanda dalla stessa porta da cui
 * passerebbe se l'agent l'avesse fatta davvero: journal, snapshot, watchers, nell'ordine
 * esatto di `onPayload`. L'unica cosa finta è che nessuno aspetta la risposta — qui si
 * guarda **com'è fatto** il box, e premere Send non risolverà nessuna `pending`.
 */
async function apri(questions: unknown[]): Promise<string> {
  const id = await daemon.registry.open({ cwd: process.cwd() })
  const l = (daemon.registry as unknown as {
    live: Map<string, {
      journal: { append: (p: unknown) => unknown }
      snapshot: unknown
      watchers: Set<(e: unknown) => void>
    }>
  }).live.get(id)!
  const e = l.journal.append({ k: 'question.asked', requestId: `req-${id}`, questions })
  applyTo(l.snapshot as never, e as never)
  for (const w of l.watchers) w(e)
  return id
}

const UNA = await apri([{
  question: 'Il daemon ha 2 conversazioni vive con un processo dietro. Riavviarlo le '
    + 'interrompe (i journal restano, ma vanno risvegliate a mano). Procedo?',
  header: 'Riavvio',
  multiSelect: false,
  options: [
    { label: 'Prima il pull, il riavvio dopo che mi dici tu (Recommended)',
      description: 'Aggiorno il codice e mi fermo. Le due chat restano vive e decidi tu quando.' },
    { label: 'Riavvia comunque',
      description: 'Le due conversazioni si interrompono a metà turno.' },
    { label: 'Riavvia e risveglia le due chat',
      description: 'Stesso riavvio, ma le riapro io subito dopo con --resume.' },
  ],
}])

const DUE = await apri([
  {
    question: 'Da dove prendo il codice nuovo?',
    header: 'Sorgente',
    multiSelect: false,
    options: [
      { label: 'origin/main (Recommended)', description: 'Il ramo su cui stai lavorando.' },
      { label: 'Il tag più recente', description: 'Più prudente, ma resta indietro di tre commit.' },
    ],
  },
  {
    question: 'Quali suite rilancio dopo l\'aggiornamento?',
    header: 'Verifiche',
    multiSelect: true,
    options: [
      { label: 'npm run check', description: '136 verifiche, costo zero di quota.' },
      { label: 'npm run daemon', description: '25 verifiche su un daemon vero in /tmp.' },
      { label: 'npm run opencode', description: 'Richiede il server OpenCode acceso.' },
    ],
  },
])

const PREV = await apri([{
  question: 'Come scrivo il messaggio di commit?',
  header: 'Commit',
  multiSelect: false,
  options: [
    { label: 'Una riga sola, imperativa, che dice cosa cambia per chi guarda (Recommended)',
      description: 'Lo stile del repo: il perché sta nel corpo, non nel titolo.',
      preview: 'Le domande si leggono come una scelta, non come una barra di comandi' },
    { label: 'Conventional commits (feat:, fix:, chore:)',
      description: 'Machine-readable, ma nessun altro file di questo repo lo usa.' },
  ],
}])

console.log(`una:  ${daemon.url}/chat/${UNA}?token=${daemon.token}`)
console.log(`due:  ${daemon.url}/chat/${DUE}?token=${daemon.token}`)
console.log(`prev: ${daemon.url}/chat/${PREV}?token=${daemon.token}`)
