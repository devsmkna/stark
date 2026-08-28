// Il CLI di Claude Code accetta un PDF **allegato al prompt**, o solo immagini?
//
// Perche' la domanda conta: la casella di STARK accetta quattro tipi di immagine e
// basta, e quel numero non e' mai stato misurato — e' stato scritto. `ModelInfo`
// dell'handshake non dichiara **niente** sulla multimodalita' (verificato: cinque
// modelli, nessun campo), quindi cosa si puo' allegare lo sa solo chi prova.
//
// Costo: un turno corto (poche centinaia di token di output). Va rifatta a ogni salto
// di versione del CLI incluso nell'SDK.
//
// Uso:  node spike/allegato-pdf.ts
import { readFileSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const PDF = process.argv[2] ?? '/tmp/prova-allegato.pdf'
const b64 = readFileSync(PDF).toString('base64')

// La stessa forma che manda l'adapter, con un blocco `document` al posto di `image`.
const msg = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: 'Which single word is written in the attached PDF? Answer with that word only, nothing else.' },
    ],
  },
  parent_tool_use_id: null,
  session_id: '',
}

async function* input() {
  yield msg as never
  // Non si chiude: uno stdin chiuso porta giu' il processo prima della risposta.
  await new Promise<void>(() => {})
}

const q = query({
  prompt: input() as never,
  options: buildOptions({ cwd: process.cwd(), model: 'sonnet', mode: 'default' }) as never,
})

let risposta = ''
let errore = ''
try {
  for await (const m of q as AsyncIterable<Record<string, unknown>>) {
    if (m['type'] === 'assistant') {
      const c = ((m['message'] as Record<string, unknown>)?.['content'] ?? []) as Array<Record<string, unknown>>
      for (const b of c) if (b['type'] === 'text') risposta += String(b['text'])
    }
    if (m['type'] === 'result') {
      if (m['is_error']) errore = JSON.stringify(m).slice(0, 400)
      break
    }
  }
} catch (e) {
  errore = String((e as Error)?.message ?? e).slice(0, 400)
} finally {
  await q.return(undefined as never).catch(() => {})
}

console.log('risposta:', JSON.stringify(risposta.trim().slice(0, 200)))
console.log('errore  :', errore || '(nessuno)')
console.log(risposta.toUpperCase().includes('MELANZANA')
  ? 'OK — il CLI ha passato il PDF al modello, che lo ha letto'
  : 'NO — il PDF non e\' arrivato leggibile')
