// Una richiesta di permesso (o una domanda) SCADE mentre la leggi?
//
// Nasce dalla segnalazione «in modalita' plan scrivo la risposta, premo invio e non
// succede nulla» (28 agosto 2026). Nei tipi dell'SDK c'e' un'impostazione che lo
// spiegherebbe:
//
//   dialogExpiry?: '60s' | '5m' | '10m' | 'never'
//   «Max time a permission/user dialog forwarded to a remote client stays parked
//    awaiting an answer [...] before either resolves to its safe no-action default
//    (cancelled). Defaults to 5m [...] The CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS env var,
//    when set, overrides this.»
//
// STARK non la imposta mai, quindi vale il default: **5 minuti**. Leggere un piano lungo
// e comporre una risposta ci sta comodamente dentro.
//
// Ma «i tipi non sono i fatti» — l'hook `PermissionDenied` era dichiarato e non scattava
// mai, e `TodoWrite` esisteva nei tipi e non nel runtime. Quindi si misura, con la
// scadenza abbassata a pochi secondi per non aspettarne cinque minuti.
//
// COSTA QUOTA: due turni corti. Da rifare a ogni salto di versione del CLI.
//   node spike/scadenza-dialogo.ts
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCADENZA_MS = 8000
const ATTESA_TARDI_MS = 16_000
process.env['CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS'] = String(SCADENZA_MS)

const { ClaudeCodeAdapter } = await import('../src/adapters/claude-code/adapter.ts')

async function scena(nome: string, ritardoMs: number): Promise<{
  nome: string; volte: number; risposto: boolean; fileCreato: boolean; motivo: string
  strumenti: string[]
}> {
  const dir = resolve(tmpdir(), `stark-scadenza-${nome}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const bersaglio = resolve(dir, 'prova.txt')

  let volte = 0
  let risposto = false
  let motivo = ''
  const strumenti: string[] = []
  let fine: (() => void) | null = null
  const finito = new Promise<void>(r => { fine = r })

  const adapter = new ClaudeCodeAdapter({
    cwd: dir,
    // Sonnet: e' un turno di servizio, non serve il modello grosso.
    model: process.env['STARK_MODEL'] ?? 'claude-sonnet-5',
    mode: 'default',
    // Solo le scritture chiedono: un comando innocuo e' pre-approvato e non fermerebbe
    // niente (ci sono gia' cascata una volta, e' scritto in CLAUDE.md).
    ask: ['edit'],
    onPermission: async () => {
      volte += 1
      console.log(`   [${nome}] permesso chiesto (${volte}ª volta), aspetto ${ritardoMs / 1000}s…`)
      await new Promise(r => setTimeout(r, ritardoMs))
      risposto = true
      console.log(`   [${nome}] rispondo ADESSO: consenti`)
      // La forma la detta il contratto del §1 (`PermissionAnswer`): `{ allow: true }`.
      // La prima versione tornava `{ decision: 'allow' }` — non un errore, un **rifiuto
      // silenzioso**, e la sonda dava «file non creato» in tutte e due le scene, cioe'
      // mentiva con l'aria di aver misurato qualcosa.
      return { allow: true as const }
    },
    onPayload: (p: { k: string; reason?: string; name?: string; ok?: boolean }) => {
      if (p.k === 'tool.ended') strumenti.push(`${p.name ?? '?'}:${p.ok ? 'ok' : 'KO'}`)
      if (p.k === 'turn.ended') { motivo = p.reason ?? ''; fine?.() }
    },
  } as never)

  await adapter.start()
  // `prompt` prende una **stringa** e non si aspetta: restituisce l'id del turno subito,
  // e la fine si sente da `turn.ended`. Attenderlo bloccava la sonda per sempre — e non
  // e' stato un ragionamento a dirlo, e' stato vedere `vertical-slice.ts` che non lo fa.
  adapter.prompt(`Scrivi il file ${bersaglio} con dentro esattamente la parola CIAO. Nient'altro.`)
  // Un tetto: se la scadenza uccide il turno senza chiuderlo, non si resta qui per sempre.
  await Promise.race([finito, new Promise(r => setTimeout(r, 90_000))])
  await adapter.close()
  return { nome, volte, risposto, fileCreato: existsSync(bersaglio), motivo, strumenti }
}

console.log(`scadenza dei dialoghi impostata a ${SCADENZA_MS / 1000}s (default del CLI: 5m)\n`)
console.log('1. SUBITO — si risponde entro la scadenza (il controllo)')
const subito = await scena('subito', 500)
console.log('\n2. TARDI — si risponde dopo la scadenza')
const tardi = await scena('tardi', ATTESA_TARDI_MS)

const riga = (r: typeof subito) =>
  `${r.nome.padEnd(8)} chiesto ${r.volte}x  file creato=${String(r.fileCreato).padEnd(5)} `
  + `turno=${(r.motivo || '(mai chiuso)').padEnd(10)} tool=[${r.strumenti.join(' ')}]`
console.log('\n' + '='.repeat(76))
console.log(riga(subito))
console.log(riga(tardi))
console.log('-'.repeat(76))
if (!subito.fileCreato) {
  console.log('INCONCLUSO: nemmeno il controllo ha funzionato, la scena e\' da rivedere.')
} else if (!tardi.fileCreato) {
  console.log('CONFERMATO: una risposta data dopo la scadenza NON viene onorata.')
} else if (tardi.volte > subito.volte) {
  console.log('CONFERMATO in altra forma: la risposta tardiva arriva a vuoto e il dialogo')
  console.log('viene RIPROPOSTO (chiesto ' + tardi.volte + ' volte contro ' + subito.volte + ').')
  console.log('Per chi guarda la UI questo e\' esattamente «premo invio e non succede nulla».')
} else {
  console.log('SMENTITO: la risposta tardiva e\' stata onorata come quella subito.')
}
process.exit(0)
