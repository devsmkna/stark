// Se esiste una versione più nuova di quella installata, e come ci si passa.
//
// La regola su *quale* sia l'ultima release sta in `core/release.ts` e non qui: quella
// si prova con `node` puro, questa parla con `git` e con la rete. Il confine è lo
// stesso di `core/quota.ts` contro il pannellino che la disegna.
//
// Si passa da `esegui` di `core/platform.ts` e non da `execFile` nudo, e non è
// pignoleria: su Windows il daemon non ha una console (nasce `DETACHED_PROCESS`),
// quindi ogni comando lanciato senza `windowsHide` se ne prende una **nuova** — cioè
// una finestra nera che lampeggia addosso a chi non ha chiesto niente. Questo modulo
// lancia `git` a ogni accensione e a ogni controllo dell'albero, quindi senza il punto
// unico sarebbe il difetto del 28 agosto daccapo.
//
// Vale la pena saperlo: la guardia statica in `npm run check` **non** l'avrebbe preso.
// Cerca `execFile(`, e `promisify(execFile)` non è una chiamata — una prova che guarda
// il posto giusto con la forma sbagliata non fallisce, tace.
//
// Di riflesso arriva anche l'altra garanzia: gli argomenti viaggiano come array e mai
// come stringa di shell, quindi un nome di tag strano è un argomento e non
// un'iniezione. Stessa regola di `reveal.ts` e `git.ts`.
//
// Due cose che si scoprono solo provandolo, e che qui sono scritte invece che dedotte:
//
// **`GIT_TERMINAL_PROMPT=0`.** Su un repo privato senza credenziali in cache, `git`
// *chiede la password* — e un daemon non ha una tastiera davanti. Senza questa riga il
// controllo all'avvio non fallirebbe: resterebbe appeso, tenendosi un processo `git`
// per sempre. Con essa fallisce subito, che è la risposta giusta.
//
// **`--depth 1` solo se il repo è già poco profondo.** L'installer clona con
// `--depth 1`, quindi lì aggiungerlo è gratis e giusto. Su un clone intero — quello di
// chi sviluppa — passarlo lo **renderebbe** poco profondo, cioè butterebbe via la
// storia di qualcun altro per fare una cosa che non gliel'aveva chiesto.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ultimaRelease, daAggiornare, tagDaLsRemote, type Release } from '../core/release.ts'
import { esegui } from '../core/platform.ts'


/** Il controllo all'avvio non deve poter rallentare l'accensione: o risponde in fretta
 *  o non risponde. Dieci secondi sono larghi per un `ls-remote`, che scarica zero
 *  oggetti, e stretti abbastanza da non lasciare un processo appeso a lungo. */
const TIMEOUT_MS = 10_000

const ambiente = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

const git = (radice: string, args: string[], ms = TIMEOUT_MS): Promise<string> =>
  esegui('git', ['-C', radice, ...args], { timeout: ms, env: ambiente })
    .then(r => r.stdout.trim())

export type StatoAggiornamento = {
  /** La `version` di `package.json`. */
  installata: string
  /** La release più alta pubblicata, se se n'è trovata una. */
  ultima: string | null
  tag: string | null
  disponibile: boolean
  /** Perché non si è potuto guardare, quando non si è potuto. Non è un errore da
   *  mostrare: è ciò che si scrive nel log per non lasciare un silenzio inspiegabile. */
  errore?: string
}

/** La versione su disco. Mai lancia: un `package.json` illeggibile non deve poter
 *  impedire al daemon di partire, e `core/release.ts` tratta già una versione che non
 *  si legge come «non lo so», cioè come «niente banner». */
export function versioneInstallata(radice: string): string {
  try {
    const p = JSON.parse(readFileSync(resolve(radice, 'package.json'), 'utf8')) as { version?: string }
    return p.version ?? ''
  } catch { return '' }
}

/**
 * L'ultima release sul remoto, chiesta senza scaricare niente.
 *
 * `ls-remote` è un giro di rete e basta: nessun oggetto, nessun ref locale toccato.
 * È la ragione per cui questa domanda si può fare a ogni avvio senza che costi.
 */
export async function ultimaReleaseRemota(radice: string): Promise<Release | null> {
  return ultimaRelease(tagDaLsRemote(await git(radice, ['ls-remote', '--tags', 'origin'])))
}

/** Se ci sono modifiche a file **tracciati**. Gli untracked non contano: non li tocca
 *  nessuno e bloccare l'aggiornamento per un file di appunti sarebbe un no gratuito. */
export async function alberoSporco(radice: string): Promise<boolean> {
  return (await git(radice, ['status', '--porcelain', '--untracked-files=no'])).length > 0
}

/** Il controllo che gira all'avvio del daemon. Non lancia mai. */
export async function controlla(radice: string): Promise<StatoAggiornamento> {
  const installata = versioneInstallata(radice)
  try {
    const ultima = await ultimaReleaseRemota(radice)
    return {
      installata,
      ultima: ultima?.versione ?? null,
      tag: ultima?.tag ?? null,
      disponibile: daAggiornare(installata, ultima),
    }
  } catch (e) {
    // Niente rete, repo senza `origin`, credenziali che mancano: sono tutti lo stesso
    // fatto visto da fuori — non lo so — e nessuno di loro è un guasto di STARK.
    return {
      installata, ultima: null, tag: null, disponibile: false,
      errore: (e as Error).message,
    }
  }
}

/** I comandi che portano il repo su una release. Restituiti invece che eseguiti,
 *  perché chi aggiorna dalla UI li deve far girare **dopo** che il daemon è morto —
 *  vedi `riavvio.ts`: un `npm install` mentre il processo vecchio è ancora vivo
 *  cambierebbe `node_modules` sotto i piedi a chi lo sta usando. */
export async function comandiPerPassare(radice: string, tag: string): Promise<string[][]> {
  const poco = (await git(radice, ['rev-parse', '--is-shallow-repository'])) === 'true'
  return [
    // `+refs/tags/…` con il più: un tag omonimo già presente in locale verrebbe
    // altrimenti rifiutato («would clobber existing tag») e l'aggiornamento si
    // fermerebbe per un ref che stiamo comunque per sovrascrivere di proposito.
    ['fetch', ...(poco ? ['--depth', '1'] : []), 'origin', `+refs/tags/${tag}:refs/tags/${tag}`],
    // Testa staccata sul tag, di proposito: un'installazione **è** ferma a una
    // versione, e `git status` che dice «HEAD detached at v1.4.0» è la verità scritta
    // nel posto dove uno la va a cercare. `advice.detachedHead=false` toglie solo il
    // muro di testo che git stamperebbe per spiegarlo a chi non l'ha chiesto.
    ['-c', 'advice.detachedHead=false', 'checkout', '--detach', `refs/tags/${tag}`],
  ]
}

/**
 * Porta il repo sulla release. Lancia se qualcosa va storto: qui l'errore va detto.
 *
 * Il controllo sull'albero sporco sta **qui dentro** e non nei chiamanti, per la stessa
 * ragione per cui `isDir` è finita dentro `registry.open()`: chi chiama non deve poterlo
 * saltare. E non è una cintura di sicurezza in più su una che c'era già — **git non
 * rifiuta**. Misurato: con `f` modificato in locale e una release che tocca solo
 * `package.json`, `git checkout --detach` è **passato**, portandosi dietro la modifica
 * senza dire niente. Sembrava la difesa naturale ed è l'esatto contrario: la copia di
 * chi ha messo mano ai file finirebbe su un tag di release *quasi* uguale a quello
 * pubblicato, e nessuno saprebbe più in cosa differisce.
 */
export async function passaAllaRelease(radice: string, tag: string): Promise<void> {
  if (await alberoSporco(radice)) {
    throw new Error(
      'ci sono modifiche locali a file tracciati: risolvile a mano prima di aggiornare. '
      + 'Sono il tuo lavoro, e sovrascriverlo non è una decisione che prende STARK.')
  }
  for (const args of await comandiPerPassare(radice, tag)) {
    await git(radice, args, 120_000)
  }
}

// ─── quello che il daemon ricorda ───────────────────────────────────────────
//
// Un valore a livello di modulo e non un campo passato in giro, perché non è uno stato
// *del daemon*: è un fatto **dell'installazione** — quale versione sta su disco e quale
// c'è là fuori — e ce n'è una sola per processo. La rotta lo legge, l'avvio lo scrive.

let noto: StatoAggiornamento | null = null

/** Quello che si sa adesso, o `null` se il controllo non è ancora tornato. */
export function aggiornamentoNoto(): StatoAggiornamento | null { return noto }

/**
 * Il controllo all'avvio. **Non si aspetta**: chi accende STARK non deve stare fermo
 * per un giro di rete che non gli serve, e il banner può comparire un secondo dopo che
 * la pagina si è aperta senza che nessuno se ne accorga.
 *
 * Gira una volta sola, all'accensione, e la conseguenza va detta invece che scoperta:
 * un daemon lasciato acceso per una settimana non si accorge di una release uscita nel
 * frattempo. È accettabile perché aggiornare **riavvia** — quindi ogni aggiornamento
 * rimette in moto il controllo — ma è il limite che questa scelta si porta dietro.
 */
export function controllaAllAvvio(radice: string): void {
  void controlla(radice).then(s => {
    noto = s
    if (s.errore) console.error(`[update] controllo non riuscito: ${s.errore}`)
    else if (s.disponibile) console.log(`[update] disponibile la ${s.ultima} (hai la ${s.installata})`)
  })
}

/**
 * Rimette a posto i file tracciati che **l'aggiornamento stesso** ha sporcato.
 *
 * Misurato, ed è un difetto che si vede solo aggiornando due volte: `npm install`
 * riscrive `package-lock.json` (ci tiene dentro la `version`) e **anche `yarn.lock`**,
 * a ogni esecuzione, su questo repo. L'aggiornamento si chiudeva quindi la porta alle
 * spalle: finiva lasciando l'albero sporco, e il successivo si rifiutava con «ci sono
 * modifiche locali» — modifiche che non erano di nessuno, se non nostre.
 *
 * Buttarle via è sicuro per un motivo preciso, e solo per quello: `passaAllaRelease`
 * **si rifiuta di partire** su un albero sporco. Quindi quando si arriva qui la
 * partenza era pulita per costruzione, e tutto ciò che è cambiato da allora l'abbiamo
 * cambiato noi. Chiamarla in un altro momento vorrebbe dire cancellare il lavoro di
 * qualcuno, ed è la ragione per cui questa funzione non va usata altrove.
 *
 * Solo i file **tracciati**: quelli non tracciati non li ha messi lì `npm install`.
 */
export async function riallinea(radice: string): Promise<void> {
  await git(radice, ['checkout', '--', '.'], 60_000)
    .catch(() => { /* niente da rimettere a posto, o non è un repo: va bene così */ })
}
