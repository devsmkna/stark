// Il `claude` che l'SDK si porta dietro e il `claude` che hai installato tu: cosa
// cambia, e quanto costa la differenza.
//
// STARK non usa quello del PATH. Usa il bundled, appaiato alla versione dell'SDK
// (`profiles.ts` → `bundledExecutable()`, passato come `pathToClaudeCodeExecutable`).
// Le due versioni divergono, e ADR-009 lo aveva previsto: questa sonda misura **di
// quanto**, invece di dedurlo dai numeri di versione.
//
// Costo: ZERO quota. Handshake piu' richieste sul canale di controllo — nessun turno
// parte mai. Le due trappole di `costo-vs-cli.ts` valgono identiche: un generatore di
// prompt vuoto chiude lo stdin e il processo muore prima di rispondere, e
// «System tools (deferred)» non entra nel totale.
//
// Due precauzioni che non sono cerimonia, e senza le quali il risultato mentirebbe:
//  1. `strictMcpConfig` — «System tools» conta anche i tool MCP, e i connettori di
//     claude.ai si collegano **qualche secondo dopo** l'avvio (gia' misurato: 71 tool
//     `mcp__` entrati in un turno che ne voleva zero). Senza spegnerli si misurerebbe
//     quando si e' guardato, non quale binario si e' usato.
//  2. **ordine invertito** — se il secondo misurato risultasse sempre il piu' magro, la
//     differenza sarebbe del momento. E' lo stesso controllo che ha smontato il
//     presunto +1% del classificatore.
//
// Cosa questa sonda **non** puo' dire, e va saputo invece di scoprirlo: l'elenco dei
// tool. `initializationResult()` non lo porta (`SDKControlInitializeResponse` ha
// `commands` e `models`, non `tools` ne' `capabilities`) e non esiste un
// `supportedTools()`. Quella lista sta nel `system:init` **grezzo**, che il CLI emette
// all'inizio del primo turno — cioe' costa un turno. Qui si misura il **peso** dei tool,
// che e' la domanda sui token; i nomi si leggono da una cattura nativa.
//
// Uso:  node spike/due-claude.ts [percorso-al-secondo-claude]
import { query } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const CWD = process.cwd()

/** Il bundled, trovato come lo trova l'SDK: risolvendo il pacchetto della piattaforma. */
function bundled(): string | null {
  const req = createRequire(import.meta.url)
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  for (const s of ['', '-musl']) {
    try {
      const p = req.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${s}/package.json`)
      const abs = resolve(p, '..', exe)
      if (existsSync(abs)) return abs
    } catch { /* non installato per questa piattaforma */ }
  }
  return null
}

/** Quello dell'utente: l'argomento, o `claude` risolto dal PATH di una shell di login. */
function dellUtente(): string | null {
  const dato = process.argv[2]
  if (dato) return resolve(dato)
  try {
    const p = execFileSync('sh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim()
    return p ? realpathSync(p) : null
  } catch { return null }
}

const versione = (exe: string) => {
  try { return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim() }
  catch { return '?' }
}

type Cat = { name: string; tokens: number }
type Misura = { sys: number; tools: number; defer: number; mem: number; skill: number; tot: number; max: number }

async function misura(exe: string): Promise<Misura> {
  const q = query({
    prompt: (async function* () { await new Promise(() => {}) })() as never,
    options: {
      cwd: CWD, pathToClaudeCodeExecutable: exe,
      // Le due scelte che STARK fa sempre: si misura la condizione vera, non una
      // configurazione che nessuno usa.
      systemPrompt: { type: 'preset', preset: 'claude_code' }, permissionMode: 'auto',
      strictMcpConfig: true,
    } as never,
  })
  try {
    await q.initializationResult()
    const ctx = await (q as unknown as { getContextUsage(): Promise<Record<string, unknown>> }).getContextUsage()
    const cat = (ctx['categories'] as Cat[]) ?? []
    const t = (n: string) => cat.find(c => c.name === n)?.tokens ?? 0
    return {
      sys: t('System prompt'), tools: t('System tools'), defer: t('System tools (deferred)'),
      mem: t('Memory files'), skill: t('Skills'),
      tot: Number(ctx['totalTokens']), max: Number(ctx['maxTokens']),
    }
  } finally { try { await q.interrupt?.() } catch { /* sta gia' morendo */ } }
}

const A = bundled()
const B = dellUtente()
if (!A) { console.error('Il pacchetto binario dell\'SDK per questa piattaforma non e\' installato.'); process.exit(1) }
if (!B || !existsSync(B)) { console.error('Non trovo il `claude` dell\'utente. Passalo come argomento.'); process.exit(1) }
if (realpathSync(A) === realpathSync(B)) { console.log('Sono lo stesso file: niente da confrontare.'); process.exit(0) }

const mb = (p: string) => (statSync(p).size / 1e6).toFixed(1).padStart(7)
console.log(`SDK     ${versione(A).padEnd(24)} ${mb(A)} MB  ${A}`)
console.log(`utente  ${versione(B).padEnd(24)} ${mb(B)} MB  ${B}`)

// Quattro giri, non due: gli ultimi due invertono l'ordine (vedi l'intestazione).
const giri: [string, string][] = [['SDK', A], ['utente', B], ['utente (invertito)', B], ['SDK (invertito)', A]]
const out: [string, Misura][] = []
for (const [et, exe] of giri) { process.stdout.write(`… ${et}\n`); out.push([et, await misura(exe)]) }

const n = (v: number) => String(v).padStart(9)
console.log('\n' + '='.repeat(80))
console.log(`${'giro'.padEnd(22)}${'system'.padStart(9)}${'tools'.padStart(9)}${'defer'.padStart(9)}${'memoria'.padStart(9)}${'skill'.padStart(9)}${'TOTALE'.padStart(10)}`)
for (const [et, m] of out) console.log(`${et.padEnd(22)}${n(m.sys)}${n(m.tools)}${n(m.defer)}${n(m.mem)}${n(m.skill)}${String(m.tot).padStart(10)}`)

const a = out[0]![1], b = out[1]![1]
const stabile = JSON.stringify(out[0]![1]) === JSON.stringify(out[3]![1])
  && JSON.stringify(out[1]![1]) === JSON.stringify(out[2]![1])
console.log('-'.repeat(80))
console.log(`ordine invertito: ${stabile ? 'stessi numeri → la differenza e\' del binario' : 'NUMERI DIVERSI → e\' un artefatto, non fidarsi'}`)
const d = (x: number, y: number) => { const v = y - x; return (v ? (v > 0 ? '+' : '') + v : '—').padStart(9) }
console.log(`\nil tuo rispetto al bundled: system ${d(a.sys, b.sys)} · tools ${d(a.tools, b.tools)} · defer ${d(a.defer, b.defer)} · skill ${d(a.skill, b.skill)}`)
console.log(`TOTALE del prefisso fisso: ${d(a.tot, b.tot)} token su una finestra da ${a.max}`)
process.exit(0)
