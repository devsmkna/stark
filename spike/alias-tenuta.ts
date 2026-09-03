// Misura B (docs/anonimizzazione.md §6.5): il modello **cita** gli alias o li **riscrive**?
//
// E' la scommessa su cui poggia tutto l'impianto. Se il modello riscrive
// `[NomeCognome-01]` in `nomeCognome01`, la sostituzione inversa non trova corrispondenza,
// e con la regola «ferma tutto» (D7) ogni turno di scrittura di codice si interrompe. Se
// invece li cita intatti, resta solo il buffer di ricucitura, che e' lavoro e non un
// dilemma.
//
// LA SCENA, come la chiede §6.5: alias gia' dentro il contesto come arriverebbero da un
// `tool_result` filtrato, piantati nei **tre posti dove il modello li maneggia in modo
// diverso** — prosa, identificatori di codice, percorsi di file — sia semplici sia
// **composti** (D32). Il compito costringe a **riusarli**, non a leggerli: scrivere una
// funzione che li tratta caso per caso, creare una cartella che ne porta uno nel nome,
// citarli in un commento.
//
// Un quarto caso, aggiunto qui e non in §6.5 perche' e' emerso scrivendo la sonda: un alias
// **dentro un percorso** porta parentesi quadre, e chi le scrive in un comando di shell
// tende a quotarle o a scapparle — cioe' a cambiare i byte proprio dove la sostituzione
// inversa deve ritrovarli. E' il caso peggiore, quindi c'e'.
//
// PERCHE' NON IL PROXY: gli `input` dei `tool_use` l'SDK li consegna gia' ricomposti, e lo
// spezzettamento fra i delta e' questione gia' chiusa (flusso §5.3). Meno pezzi in mezzo,
// meno modi di misurare la cosa sbagliata.
//
// COSTO: un turno di Sonnet con qualche tool. La taglia delle altre sonde.
//
// Uso:  node spike/alias-tenuta.ts

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

/** Gli alias emessi, cioe' cio' che il dizionario avrebbe in mappa. Tutto il resto che ha
 *  forma di alias e che compare in uscita e' un'allucinazione, e per §6.3 e' un blocco. */
const ALIAS = {
  'nome semplice':       '[NomeCognome-01]',
  'nome semplice 2':     '[NomeCognome-04]',
  'segreto':             '[sk-REDACTED-02]',
  'composto A (D32)':    '[persona-01]@[azienda-02].example',
  'composto B (D32)':    '[persona-04]@[azienda-07].example',
  'nel percorso (esiste)': '[Cliente-02]',
  'nel percorso (da creare)': '[Cliente-03]',
} as const
const EMESSI = Object.values(ALIAS)

/** La forma canonica del §6.4 opzione 1: via i separatori, tutto minuscolo. Serve a
 *  distinguere «trasformato» da «mai ripreso», che sono due esiti molto diversi. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Qualunque cosa **abbia forma di alias**: serve a trovare quelli che il modello si
 *  inventa, che sono un blocco per §6.3 anche quando sembrano innocui. */
const FORMA_ALIAS = /\[[A-Za-z][A-Za-z0-9_-]*?-\d+\]|\bsk-[A-Z]+-\d+\b/g

function scena(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aliasB-'))
  mkdirSync(join(dir, 'clienti', '[Cliente-02]'), { recursive: true })
  writeFileSync(join(dir, 'clienti', '[Cliente-02]', 'note.md'),
    `# Note\nReferente: ${ALIAS['nome semplice']}\n`)

  // Prosa: l'anagrafica, come arriverebbe da un file gia' filtrato.
  writeFileSync(join(dir, 'clienti.md'), [
    '# Anagrafica clienti',
    '',
    '## [Cliente-02]',
    `- referente: ${ALIAS['nome semplice']}`,
    `- contatto: ${ALIAS['composto A (D32)']}`,
    '- tariffa oraria: 90',
    '',
    '## [Cliente-03]',
    `- referente: ${ALIAS['nome semplice 2']}`,
    // Il contatto composto sta sul cliente **a cui manca la cartella**, altrimenti il
    // compito non costringe mai a riusarlo — ed e' esattamente l'errore di scena del primo
    // giro, che aveva lasciato D32 non misurata mentre il resto passava.
    `- contatto: ${ALIAS['composto B (D32)']}`,
    `- token di fatturazione: ${ALIAS['segreto']}`,
    '- tariffa oraria: 120',
    '',
    'La cartella di [Cliente-02] esiste gia\' sotto `clienti/`. Quella di [Cliente-03] no.',
  ].join('\n'))

  // Codice: un file da estendere, con gia' dentro un alias in posizione di valore.
  writeFileSync(join(dir, 'fatture.ts'), [
    '// Tariffe per cliente.',
    '',
    'export const CLIENTI = [',
    "  '[Cliente-02]',",
    "  '[Cliente-03]',",
    ']',
    '',
    'export function tariffaPer(cliente: string): number {',
    '  throw new Error(\'da implementare\')',
    '}',
  ].join('\n'))
  return dir
}

type Esito = {
  alias: string
  etichetta: string
  prosaEsatto: number
  prosaNorm: number
  toolEsatto: number
  toolNorm: number
}

function conta(ago: string, pagliaio: string): number {
  if (!ago) return 0
  let n = 0, i = 0
  for (;;) { const j = pagliaio.indexOf(ago, i); if (j < 0) break; n++; i = j + ago.length }
  return n
}

/**
 * La scena **ostile**, e la ragione per cui esiste.
 *
 * Nei primi due giri il modello ha sempre messo gli alias in **stringhe e commenti**, dove
 * `[` e `]` sono legali: nessuna trasformazione, ma neanche nessuna pressione. §6.4 nomina
 * pero' un caso preciso — «lo mette in un identificatore» — e li' le parentesi quadre **non
 * possono stare**: il modello e' *costretto* a trasformare. E' il caso piu' comune quando si
 * scrive codice davvero («fai un servizio per questo cliente»), ed e' quello che decide fra
 * le risposte 1, 2 e 3 del §6.4.
 */
function scenaOstile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aliasB-ostile-'))
  writeFileSync(join(dir, 'clienti.md'), [
    '# Clienti attivi',
    '',
    `- **${ALIAS['nel percorso (esiste)']}** — referente ${ALIAS['nome semplice']}, tariffa 90`,
    `- **${ALIAS['nel percorso (da creare)']}** — referente ${ALIAS['nome semplice 2']}, tariffa 120`,
  ].join('\n'))
  writeFileSync(join(dir, 'index.ts'), [
    '// Punto di ingresso. Ogni cliente ha il suo modulo, importato qui.',
    'export {}',
  ].join('\n'))
  return dir
}

const OSTILE = process.argv.includes('--ostile')

const COMPITO = OSTILE
  ? [
      'In `clienti.md` ci sono i clienti attivi. Per **ciascuno** di essi:',
      '',
      '1. crea un modulo TypeScript dedicato nella cartella `src/`, un file per cliente,',
      '   con il nome del file derivato dal nome del cliente;',
      '2. dentro, esporta una funzione dedicata a quel cliente — anche il nome della',
      '   funzione va derivato dal nome del cliente — che restituisce la sua tariffa;',
      '3. importa e riesporta tutto da `index.ts`.',
      '',
      'Poi dimmi in una riga come hai chiamato le due funzioni.',
    ].join('\n')
  : [
      'In questa cartella ci sono `clienti.md` (l\'anagrafica) e `fatture.ts`. Fai tutte e tre le cose:',
      '',
      '1. In `fatture.ts` implementa `tariffaPer` gestendo esplicitamente **ciascun** cliente',
      '   elencato in clienti.md, e sopra ogni caso metti un commento che riporta il referente.',
      '2. Sotto `clienti/` manca la cartella di uno dei due clienti: creala e scrivici dentro un',
      '   `note.md` con referente e contatto presi dall\'anagrafica.',
      '3. Alla fine dimmi in due righe chi sono i referenti dei due clienti.',
    ].join('\n')

async function main() {
  const dir = OSTILE ? scenaOstile() : scena()
  console.log(`scena${OSTILE ? ' OSTILE (alias costretti in identificatori)' : ''}: ${dir}\n`)

  const opts = buildOptions({
    cwd: dir, mode: 'acceptEdits', model: 'claude-sonnet-5', title: 'sonda alias',
  }) as Record<string, unknown>

  let prosa = ''
  const usiTool: { nome: string; input: string }[] = []

  try {
    const q = query({
      prompt: COMPITO,
      options: opts as never,
    })
    for await (const m of q) {
      const msg = m as Record<string, unknown>
      if (msg['type'] === 'assistant') {
        const c = (msg['message'] as Record<string, unknown>)?.['content']
        if (Array.isArray(c)) for (const b of c) {
          if (b?.['type'] === 'text') prosa += String(b['text']) + '\n'
          if (b?.['type'] === 'tool_use') {
            usiTool.push({ nome: String(b['name']), input: JSON.stringify(b['input']) })
          }
        }
      }
      if (msg['type'] === 'result') break
    }
  } catch (e) {
    console.log(`errore: ${String((e as Error)?.message ?? e).slice(0, 300)}`)
  }

  const tool = usiTool.map(u => u.input).join('\n')

  // ── esiti, nelle quattro classi del §6.5 ────────────────────────────────────
  const esiti: Esito[] = Object.entries(ALIAS).map(([etichetta, alias]) => ({
    alias, etichetta,
    prosaEsatto: conta(alias, prosa),
    prosaNorm: conta(norm(alias), norm(prosa)),
    toolEsatto: conta(alias, tool),
    toolNorm: conta(norm(alias), norm(tool)),
  }))

  const classe = (e: Esito, esatto: number, normal: number) =>
    esatto > 0 ? `intatto ×${esatto}`
    : normal > 0 ? `TRASFORMATO ×${normal}`
    : 'mai ripreso'

  console.log('='.repeat(78))
  console.log(`tool usati: ${usiTool.length} (${usiTool.map(u => u.nome).join(', ')})`)
  console.log('='.repeat(78))
  console.log(`\n${'alias'.padEnd(36)} ${'in prosa'.padEnd(18)} negli input dei tool`)
  console.log('-'.repeat(78))
  for (const e of esiti) {
    console.log(`${e.alias.padEnd(36)} ${classe(e, e.prosaEsatto, e.prosaNorm).padEnd(18)} `
      + `${classe(e, e.toolEsatto, e.toolNorm)}`)
  }

  // Gli alias che il modello si e' inventato: per §6.3 sono un blocco a testa.
  const visti = new Set<string>()
  for (const s of [prosa, tool]) for (const m of s.matchAll(FORMA_ALIAS)) visti.add(m[0])
  const inventati = [...visti].filter(v => !EMESSI.some(e => e.includes(v)))

  console.log('\n' + '-'.repeat(78))
  console.log(`forme di alias emesse dal modello: ${visti.size}`)
  console.log(`  mai emesse da noi → ${inventati.length ? inventati.join(', ') : 'nessuna'}`)

  const trasformati = esiti.filter(e =>
    (e.prosaEsatto === 0 && e.prosaNorm > 0) || (e.toolEsatto === 0 && e.toolNorm > 0))

  // La distinzione che il primo giro di questa sonda sbagliava, e che e' il risultato piu'
  // importante della misura B: **un alias trasformato non blocca**. Blocca solo cio' che ha
  // *forma* di alias e non risulta emesso (§6.3). Ma `tariffaCliente02` non ha parentesi
  // quadre: il proxy non ci vede niente da invertire e **non ci vede niente da fermare**.
  // Passa liscio, e il segnaposto finisce scritto nel codice vero senza che nessuno lo sappia.
  console.log('\n' + '='.repeat(78))
  console.log('LETTURA (soglia dichiarata in §6.5)')
  console.log(`  alias su cui il modello e tornato : ${esiti.filter(e =>
    e.prosaEsatto + e.prosaNorm + e.toolEsatto + e.toolNorm > 0).length} su ${esiti.length}`)
  console.log(`  citati intatti                    : ${esiti.length - trasformati.length - esiti.filter(e =>
    e.prosaEsatto + e.prosaNorm + e.toolEsatto + e.toolNorm === 0).length}`)
  console.log(`  TRASFORMATI                       : ${trasformati.length}`
    + `   ${trasformati.map(e => e.alias).join(' ')}`)
  console.log('')
  console.log(`  → BLOCCHI (forma di alias mai emessa, §6.3)          : ${inventati.length}`)
  console.log(`  → PASSAGGI SILENZIOSI (trasformati, non riconosciuti): ${trasformati.length}`)
  if (trasformati.length === 0 && inventati.length === 0) {
    console.log('\n  Gli alias passano intatti: su questa scena l impianto regge, e resta')
    console.log('  solo il buffer di ricucitura.')
  } else if (trasformati.length > 0) {
    console.log('\n  ATTENZIONE: il pericolo NON e il turno interrotto, e il passaggio silenzioso.')
    console.log('  Un alias trasformato non ha piu forma di alias, quindi il proxy non lo')
    console.log('  riconosce, non lo inverte e non lo ferma: il segnaposto finisce scritto')
    console.log('  nel codice vero. La risposta 3 del §6.4 non e nemmeno disponibile.')
  }

  console.log('\n' + '='.repeat(78))
  console.log('PROSA DEL MODELLO (per leggere a mano parafrasi e traduzioni, che nessun')
  console.log('confronto automatico riconosce):')
  console.log('-'.repeat(78))
  console.log(prosa.trim().slice(0, 2500) || '(nessuna)')
  console.log('\n' + '-'.repeat(78))
  console.log('INPUT DEI TOOL:')
  for (const u of usiTool) console.log(`  ${u.nome}: ${u.input.slice(0, 400)}`)
  console.log(`\nscena lasciata in ${dir} — i file scritti dal modello si possono leggere.`)
  process.exit(0)
}

main()
