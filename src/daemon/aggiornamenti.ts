// Se esiste una versione più nuova di quella installata, e come ci si passa.
//
// La regola su *quale* sia l'ultima release sta in `core/release.ts` e non qui: quella
// si prova con `node` puro, questa parla con la rete. Il confine è lo stesso di
// `core/quota.ts` contro il pannellino che la disegna.
//
// Fino al 5 settembre 2026 questo file parlava con `git` (`ls-remote`, `fetch`,
// `checkout --detach`), e la copia installata era un checkout vero. Da quel giorno
// l'installer non clona più: scarica un **bundle già pronto** (codice, `node_modules`
// e interfaccia già compilate) per la piattaforma esatta, pubblicato da una pipeline
// che gira sui tag di release — vedi `docs/distribuzione.md` per il perché. Questo
// file fa la stessa domanda di prima («qual è l'ultima release, e come ci si arriva»)
// con un trasporto più semplice: un `fetch` HTTPS al posto di un processo `git`.
//
// Sparisce con quel cambio anche `alberoSporco()`/`riallinea()`: esistevano solo
// perché `npm install`, girando in locale a ogni aggiornamento, riscriveva
// `package-lock.json` e sporcava l'albero. Con un bundle già pronto quel passo non
// gira più in locale, quindi non c'è più niente da rimettere a posto.

import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WIN, esegui } from '../core/platform.ts'
import { ultimaRelease, daAggiornare, type Release } from '../core/release.ts'

/** Il controllo all'avvio non deve poter rallentare l'accensione: o risponde in fretta
 *  o non risponde. Dieci secondi sono larghi per scaricare un file di poche righe, e
 *  stretti abbastanza da non lasciare una richiesta appesa a lungo. */
const TIMEOUT_MS = 10_000

/** Da dove si pubblicano i bundle e il numero dell'ultima release. Sovrascrivibile
 *  per la stessa ragione di `STARK_RELEASE_BASE` in `install.sh`/`install.ps1`: una
 *  seconda copia di STARK, o una prova, senza toccare il default di produzione. */
const baseRelease = (): string =>
  process.env.STARK_RELEASE_BASE ?? 'https://starkapp.dev/releases/latest'

/** Il nome del bundle per **questa** macchina, nella stessa forma di `install.sh`
 *  (`stark-$SO-$ARCH.tar.gz`) e `install.ps1` (`stark-win-$Arch.tar.gz`). Non riusa
 *  `SO` di `core/platform.ts`: quello distingue WSL da Linux perché la domanda lì è
 *  «come si raggiunge Windows», qui invece WSL vuole lo stesso bundle di Linux — è
 *  già cosa `uname -s` risponde dentro WSL, ed è per questo che l'installer non ha
 *  mai avuto bisogno di un caso a parte. */
const nomeBundle = (): string => {
  const so = WIN ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `stark-${so}-${arch}.tar.gz`
}

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
 * L'ultima release pubblicata, chiesta senza scaricare il bundle.
 *
 * `releases/latest/version.txt` contiene un solo tag (`v1.4.0`), scritto dalla stessa
 * pipeline che pubblica i bundle — mai un push su `main`, solo un tag. Un file di testo
 * e non un JSON: niente da fare il parsing in `install.sh`, che deve leggerlo con `sh`
 * puro, e qui basta `fetch` + `trim`.
 */
export async function ultimaReleaseRemota(): Promise<Release | null> {
  const risposta = await fetch(`${baseRelease()}/version.txt`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!risposta.ok) throw new Error(`${risposta.status} ${risposta.statusText} leggendo version.txt`)
  const tag = (await risposta.text()).trim()
  return ultimaRelease([tag])
}

/** Il controllo che gira all'avvio del daemon. Non lancia mai. */
export async function controlla(radice: string): Promise<StatoAggiornamento> {
  const installata = versioneInstallata(radice)
  try {
    const ultima = await ultimaReleaseRemota()
    return {
      installata,
      ultima: ultima?.versione ?? null,
      tag: ultima?.tag ?? null,
      disponibile: daAggiornare(installata, ultima),
    }
  } catch (e) {
    // Niente rete, server irraggiungibile: sono lo stesso fatto visto da fuori — non
    // lo so — e nessuno dei due è un guasto di STARK.
    return {
      installata, ultima: null, tag: null, disponibile: false,
      errore: (e as Error).message,
    }
  }
}

/**
 * Scarica il bundle dell'ultima release per questa piattaforma e lo estrae sopra
 * `radice`, sovrascrivendo quello che c'era. Lancia se qualcosa va storto: qui
 * l'errore va detto, non inghiottito.
 *
 * Nessun controllo sull'albero sporco: non c'è più un albero git da sporcare. Chi
 * mette mano ai file dentro la cartella installata li perde al prossimo
 * aggiornamento — vale oggi come valeva ieri fra due `npm install` che toccano lo
 * stesso file, solo senza più un `git status` a dirlo prima.
 */
export async function passaAllaRelease(radice: string): Promise<void> {
  const url = `${baseRelease()}/${nomeBundle()}`
  const risposta = await fetch(url)
  if (!risposta.ok) {
    throw new Error(`${risposta.status} ${risposta.statusText} scaricando ${url}`)
  }
  const tmp = await mkdtemp(join(tmpdir(), 'stark-update-'))
  try {
    const archivio = join(tmp, 'bundle.tar.gz')
    await writeFile(archivio, Buffer.from(await risposta.arrayBuffer()))
    // `tar` e non una libreria: è già un requisito dell'installer (`install.sh`
    // rifiuta di partire senza), quindi qui è già garantito che ci sia.
    await esegui('tar', ['-xzf', archivio, '-C', radice], { timeout: 120_000 })
  } finally {
    await rm(tmp, { recursive: true, force: true })
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

/** Scrive il risultato di un controllo — all'avvio come a un «check» esplicito: è un
 *  solo fatto dell'installazione, e due scrittori diverrebbero due verità. */
export function notaAggiornamento(s: StatoAggiornamento): void {
  noto = s
  if (s.errore) console.error(`[update] controllo non riuscito: ${s.errore}`)
  else if (s.disponibile) console.log(`[update] disponibile la ${s.ultima} (hai la ${s.installata})`)
}

/** Ogni quanto si ripete il controllo dopo il primo, all'accensione. Un giro di rete
 *  minuscolo (poche righe di testo), quindi non è il costo a porre un limite: è che
 *  una release non esce due volte in un'ora, e ricontrollare più spesso di così non
 *  farebbe comparire il banner prima, solo più chiamate a vuoto. */
const RICONTROLLO_MS = 3 * 60 * 60 * 1000

/**
 * Il controllo all'avvio, e poi a intervalli. **Non si aspetta**: chi accende STARK non
 * deve stare fermo per un giro di rete che non gli serve, e il banner può comparire un
 * secondo dopo che la pagina si è aperta senza che nessuno se ne accorga.
 *
 * Il giro periodico esiste perché un daemon lasciato acceso per giorni non deve
 * dipendere da un riavvio per accorgersi di una release uscita nel frattempo — prima
 * girava solo all'accensione, e chi non riavviava (la maggioranza: STARK è pensato per
 * restare su) vedeva il banner comparire solo se e quando toccava `stark update` a
 * mano, cioè mai da sé. `unref()` perché questo timer non è un motivo per tenere vivo
 * il processo: se tutto il resto è fermo, il daemon deve poter uscire lo stesso.
 */
export function controllaAllAvvio(radice: string): void {
  const giro = (): void => {
    void controlla(radice).then(notaAggiornamento)
  }
  giro()
  setInterval(giro, RICONTROLLO_MS).unref()
}
