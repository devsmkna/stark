// Quale hook dei permessi scatta davvero, e chi di loro sa ricordare una regola.
//
// ─── Perche' ─────────────────────────────────────────────────────────────────
//
// «Consenti sempre» su Claude Code non scrive niente quando la card nasce dall'hook
// `PreToolUse` — cioe' nel caso normale, perche' in `auto` mode il classificatore
// risolve prima e `canUseTool` non viene mai chiamata (misurato, §16.5). Il motivo sta
// nei tipi: `PreToolUseHookSpecificOutput` ha solo `permissionDecision`,
// `permissionDecisionReason` e `additionalContext` — **non puo' ricordare niente**.
// Quindi il bottone si comporta come «Consenti» e il journal scrive `always`: una
// bugia su disco, che si scopre solo la volta dopo.
//
// Esiste pero' un altro hook, `PermissionRequest`, il cui output porta
// `decision.updatedPermissions` e il cui **input** porta `permission_suggestions` —
// cioe' le regole gia' pronte che il CLI propone. Sulla carta e' la porta giusta.
//
// Sulla carta. Oggi la stessa promessa e' stata smentita tre volte (l'hook
// `PermissionDenied`, dichiarato e mai chiamato; `session.wait` di OpenCode, «not
// available yet»; i `Task*` dichiarati nei tipi e assenti dai tool veri). Quindi si
// misura: si registrano ENTRAMBI gli hook e si guarda chi parla.
//
// Costo: un turno corto.

import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { mkdirSync, rmSync } from 'node:fs'

// Una cartella NUOVA a ogni giro. Claude Code ricorda i progetti per percorso: una
// regola concessa in un giro precedente rende muti quelli dopo, e si legge come «il
// meccanismo non scatta» quando invece non c'e' piu' niente da chiedere. E' lo stesso
// genere di contaminazione dell'orologio di WSL nella sonda della citazione con `@`.
const CASA = `/tmp/stark-hook-permessi-${process.pid}-${Math.floor(performance.now())}`
rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })

const visti: string[] = []
const suggerimenti: unknown[] = []

// La modalita' e' un parametro: la domanda «quale porta si apre» ha una risposta
// diversa in `auto` (il classificatore risolve prima) e in `default`, e sapere solo
// meta' del quadro porterebbe a una correzione sbagliata.
const MODO = (process.argv[2] ?? 'auto') as 'auto' | 'default'
// Terzo giro: **senza** l'hook. Se `canUseTool` parte solo cosi', allora non e' che
// «non viene mai chiamata»: e' che **l'hook la scavalca**. Sono due diagnosi diverse e
// portano a due correzioni diverse, quindi va distinto invece che dedotto.
const SENZA_HOOK = process.argv[3] === 'senza-hook'
// Il tool su cui si prova. **NON `echo`**: i comandi innocui sono pre-approvati e non
// chiedono niente a nessuno (gia' scritto in CLAUDE.md, e questa sonda ci e' cascata
// una volta). Per vedere il meccanismo serve una scrittura.
const TOOL = process.argv[4] ?? 'Write'
// Cosa risponde l'hook. `HookPermissionDecision` ammette anche **`defer`**, che nel
// commento dell'adapter non era mai stato provato: se «rimanda» facesse cadere la
// decisione su `canUseTool`, «Consenti sempre» tornerebbe possibile senza che STARK
// scriva a mano nel file di configurazione di un altro programma.
const RISPOSTA = (process.argv[5] ?? 'allow') as 'allow' | 'deny' | 'ask' | 'defer'
const PROMPT = TOOL === 'Write'
  ? 'Crea un file nuovo `nota.txt` con dentro la parola CIAO. Fallo e basta.'
  : 'Lancia il comando `echo CIAO` e dimmi cosa stampa.'

const options: Options = {
  cwd: CASA,
  model: 'claude-sonnet-5',
  permissionMode: MODO,
  // L'altra porta: questa **sa** ricordare (`updatedPermissions` sta nel suo tipo di
  // ritorno). La domanda e' se venga chiamata.
  canUseTool: async (nome: string, input: Record<string, unknown>) => {
    visti.push(`canUseTool(${nome})`)
    return {
      behavior: 'allow' as const,
      updatedInput: input,
      updatedPermissions: [{
        type: 'addRules' as const,
        rules: [{ toolName: TOOL }],
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
      }],
    }
  },
  strictMcpConfig: false,
  ...(SENZA_HOOK ? {} : { hooks: {
    PreToolUse: [{
      matcher: TOOL,
      hooks: [async (input: Record<string, unknown>) => {
        visti.push(`PreToolUse(${String(input['tool_name'])})`)
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: RISPOSTA,
            permissionDecisionReason: 'sonda',
          },
        }
      }],
    }],
    // Nessun `matcher`: se il filtro fosse la ragione per cui non scatta, si vuole
    // saperlo senza confonderlo con «l'hook non esiste».
    PermissionRequest: [{
      hooks: [async (input: Record<string, unknown>) => {
        visti.push(`PermissionRequest(${String(input['tool_name'])})`)
        const sugg = input['permission_suggestions']
        if (sugg) suggerimenti.push(sugg)
        return {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest' as const,
            decision: {
              behavior: 'allow' as const,
              // La domanda vera: se questo hook scatta, questa riga rende «Consenti
              // sempre» onesto senza che il daemon tocchi nessun file.
              updatedPermissions: [{
                type: 'addRules' as const,
                rules: [{ toolName: TOOL }],
                behavior: 'allow' as const,
                destination: 'localSettings' as const,
              }],
            },
          },
        }
      }],
    }],
  } }),
}

console.log(`tool ${TOOL} · modalità ${MODO}${SENZA_HOOK ? ' · SENZA hook' : ` · hook risponde ${RISPOSTA}`} · PreToolUse(Bash) · PermissionRequest(senza matcher) · canUseTool\n`)

// Serve sapere anche **se il tool e' stato davvero tentato**: un giro in cui il
// modello non prova nemmeno a scrivere darebbe «nessun hook scattato» e sembrerebbe
// una risposta sul meccanismo, mentre e' solo silenzio.
let tentato = false
let esito = ''
const q = query({ prompt: PROMPT, options })
for await (const m of q) {
  const o = m as Record<string, unknown>
  if (o['type'] === 'assistant') {
    const c = ((o['message'] as Record<string, unknown>)?.['content'] ?? []) as Array<Record<string, unknown>>
    if (c.some(x => x['type'] === 'tool_use' && x['name'] === TOOL)) tentato = true
  }
  if (o['type'] === 'result') { esito = String(o['subtype'] ?? ''); break }
}

console.log(`il tool ${TOOL} e' stato tentato:`, tentato, '· esito del turno:', esito || '?')
console.log('hook scattati:', visti.length ? visti.join(' · ') : 'NESSUNO')
console.log('suggerimenti ricevuti:', suggerimenti.length
  ? JSON.stringify(suggerimenti).slice(0, 400)
  : 'nessuno')

const { existsSync, readFileSync } = await import('node:fs')
const { resolve } = await import('node:path')
const dove = resolve(CASA, '.claude', 'settings.local.json')
console.log('\nregola scritta su disco:', existsSync(dove)
  ? readFileSync(dove, 'utf8').replace(/\s+/g, ' ').slice(0, 300)
  : 'NO — nessun file')
process.exit(0)
