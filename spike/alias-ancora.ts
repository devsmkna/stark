// Misura B-bis (docs/anonimizzazione.md §6.4/§6.5): l'ANCORA sopravvive alla derivazione?
//
// La misura B ha detto che il modello, costretto a derivare un identificatore da un alias,
// lo trasforma sempre — e che il trasformato non ha piu' forma di alias, quindi passa
// SILENZIOSO: il proxy non lo riconosce, non lo inverte, non lo ferma. La cura proposta e'
// un'ancora dentro l'alias: contatore + codice breve da un alfabeto non-esadecimale
// (`[Cliente-02k7]`), che sopravvive a case e separatori perche' il riconoscitore lavora
// sul testo normalizzato e cerca un INSIEME CHIUSO di codici emessi, non un pattern.
//
// La scommessa che questa sonda misura: il modello CONSERVA il codice quando deriva
// (`tariffaCliente02k7`), o lo «ripulisce» come rumore (`tariffaCliente02`,
// `tariffaCliente`)? La misura B fa ben sperare — ha conservato il `02`, cioe' cio' che
// considerava il nome distintivo — ma «fa ben sperare» non e' una misura.
//
// Due varianti, stessa scena ostile, un turno a testa:
//   1. SENZA aiuti: l'alias nudo, come lo vedrebbe oggi.
//   2. CON una riga in append al system prompt che dichiara i token opachi e chiede di
//      conservare la coda. STARK la controlla (`systemPrompt.append`), quindi e' una leva
//      vera — ma l'obbedienza a una riga di prompt si misura, non si assume.
//
// A differenza di alias-tenuta.ts, la cattura si SALVA (spike/captures/alias-ancora.jsonl):
// l'output a schermo della misura B e' andato perso, e non si perde due volte.
//
// COSTO: due turni di Sonnet.   Uso:  node spike/alias-ancora.ts

import { appendFileSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const CATTURA = join(import.meta.dirname, 'captures', 'alias-ancora.jsonl')
// Il modello si sceglie da riga di comando: la misura B-bis nasce su Sonnet, ma un
// campione di un modello solo e' cio' che le «nove cose» segnano come contestabile
// (§12bis). Un secondo modello — Haiku, quasi gratis — dice se l'ancora e' una proprieta'
// del comportamento o un caso.
const MODELLO = process.argv.find(a => a.startsWith('claude-')) ?? 'claude-sonnet-5'

/** La forma nuova: contatore (D9, leggibile) + codice da {g h j k m n p q r s t v w x z}
 *  piu' cifre — una lettera non-esadecimale garantisce che il codice non viva dentro uno
 *  SHA o un UUID per caso. L'ancora e' `NNcc`; la parola-tipo e' solo leggibilita' (§6.1),
 *  e la sua eventuale traduzione (Cliente→Customer) non tocca il riconoscimento. */
const ALIAS = {
  'cliente A':   { pieno: '[Cliente-02k7]',     ancora: '02k7' },
  'cliente B':   { pieno: '[Cliente-03xq]',     ancora: '03xq' },
  'referente A': { pieno: '[NomeCognome-01v4]', ancora: '01v4' },
  'referente B': { pieno: '[NomeCognome-04mz]', ancora: '04mz' },
} as const

const RIGA_PROMPT =
  'Tokens of the form [Word-NNcc] (for example [Cliente-02k7]) are opaque placeholders ' +
  'for masked data. When deriving identifiers, file names, function names or any other ' +
  'name from such a placeholder, always preserve its full trailing code (e.g. "02k7") ' +
  'inside the derived name; never shorten or drop it.'

/** Forma canonica del §6.4: via i separatori, tutto minuscolo. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function conta(ago: string, pagliaio: string): number {
  if (!ago) return 0
  let n = 0, i = 0
  for (;;) { const j = pagliaio.indexOf(ago, i); if (j < 0) break; n++; i = j + ago.length }
  return n
}

/** La stessa scena ostile di alias-tenuta.ts, con gli alias nella forma nuova: il compito
 *  COSTRINGE a derivare nomi di file e di funzioni dai nomi dei clienti. */
function scena(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aliasBbis-'))
  writeFileSync(join(dir, 'clienti.md'), [
    '# Clienti attivi',
    '',
    `- **${ALIAS['cliente A'].pieno}** — referente ${ALIAS['referente A'].pieno}, tariffa 90`,
    `- **${ALIAS['cliente B'].pieno}** — referente ${ALIAS['referente B'].pieno}, tariffa 120`,
  ].join('\n'))
  writeFileSync(join(dir, 'index.ts'), [
    '// Punto di ingresso. Ogni cliente ha il suo modulo, importato qui.',
    'export {}',
  ].join('\n'))
  return dir
}

const COMPITO = [
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

type Giro = {
  variante: 'senza riga' | 'con riga'
  prosa: string
  usiTool: { nome: string; input: string }[]
  scritti: Record<string, string>
  dir: string
}

async function unGiro(variante: Giro['variante']): Promise<Giro> {
  const dir = scena()
  const opts = buildOptions({
    cwd: dir, mode: 'acceptEdits', model: MODELLO, title: 'sonda ancora',
  }) as Record<string, unknown>
  if (variante === 'con riga') {
    opts['systemPrompt'] = { type: 'preset', preset: 'claude_code', append: RIGA_PROMPT }
  }

  let prosa = ''
  const usiTool: Giro['usiTool'] = []
  try {
    const q = query({ prompt: COMPITO, options: opts as never })
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
    prosa += `\n[errore: ${String((e as Error)?.message ?? e).slice(0, 300)}]`
  }

  // I file che il modello ha scritto: sono l'artefatto che decide (la misura B lo ha
  // insegnato — l'output a schermo si perde, i file no).
  const scritti: Record<string, string> = {}
  const cammina = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) cammina(p)
      else scritti[relative(dir, p)] = readFileSync(p, 'utf8')
    }
  }
  cammina(dir)
  return { variante, prosa, usiTool, scritti, dir }
}

/** Esito per alias, nelle classi che contano per l'ancora. */
function esiti(g: Giro) {
  const tool = g.usiTool.map(u => u.input).join('\n')
  const testi = { prosa: g.prosa, tool, file: Object.values(g.scritti).join('\n') }
  return Object.entries(ALIAS).map(([etichetta, a]) => {
    const righe: Record<string, string> = {}
    for (const [dove, testo] of Object.entries(testi)) {
      const nte = norm(testo)
      const esatto = conta(a.pieno, testo)
      const ancorato = conta(a.ancora, nte)
      // ancora persa ma contatore tenuto: la «pulizia» che temiamo
      const contatore = a.ancora.slice(0, 2)
      const spogliato = ancorato === 0 && conta('cliente' + contatore, nte)
        + conta('nomecognome' + contatore, nte) + conta('customer' + contatore, nte)
        + conta('client' + contatore, nte) > 0
      righe[dove] = esatto > 0 && ancorato > esatto ? `intatto ×${esatto} + derivato ×${ancorato - esatto}`
        : esatto > 0 ? `intatto ×${esatto}`
        : ancorato > 0 ? `ANCORA VIVA nel derivato ×${ancorato}`
        : spogliato ? 'ANCORA SPOGLIATA (resta il contatore)'
        : 'assente'
    }
    return { etichetta, alias: a.pieno, ...righe }
  })
}

async function main() {
  const giri: Giro[] = []
  for (const v of ['senza riga', 'con riga'] as const) {
    console.log(`\n${'='.repeat(78)}\ngiro «${v}» in corso…`)
    const g = await unGiro(v)
    giri.push(g)
    console.log(`scena: ${g.dir} — tool: ${g.usiTool.map(u => u.nome).join(', ')}`)
    console.log(`\n${'alias'.padEnd(24)} ${'in prosa'.padEnd(24)} ${'nei tool'.padEnd(24)} nei file scritti`)
    console.log('-'.repeat(96))
    for (const e of esiti(g)) {
      console.log(`${e.alias.padEnd(24)} ${String(e['prosa']).padEnd(24)} ${String(e['tool']).padEnd(24)} ${e['file']}`)
    }
    appendFileSync(CATTURA, JSON.stringify({
      quando: new Date().toISOString(), variante: v, compito: COMPITO,
      riga: v === 'con riga' ? RIGA_PROMPT : null,
      esiti: esiti(g), prosa: g.prosa, usiTool: g.usiTool, scritti: g.scritti,
    }) + '\n')
  }

  console.log(`\n${'='.repeat(78)}\nLETTURA`)
  for (const g of giri) {
    const es = esiti(g)
    const vive = es.filter(e => Object.values(e).some(v => String(v).includes('ANCORA VIVA') || String(v).includes('derivato')))
    const spogliate = es.filter(e => Object.values(e).some(v => String(v).includes('SPOGLIATA')))
    console.log(`  «${g.variante}»: ancore vive nei derivati ${vive.length}/${es.length}, spogliate ${spogliate.length}/${es.length}`)
  }
  console.log(`\ncattura in ${CATTURA}`)
  process.exit(0)
}

main()
