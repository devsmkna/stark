// Avvia il daemon, o lo guarda, o lo ferma.
//
//   stark                  (= stark up) accendi se serve e aprimi STARK — vedi sotto
//   stark update           scarica l'ultima versione, ricompila, riavvia se era acceso
//   npm run stark          in primo piano, Ctrl-C lo ferma
//   npm run stark:start    staccato: sopravvive alla chiusura del terminale
//   npm run stark:status   dove sta, da quanto, quante conversazioni
//   npm run stark:stop     lo ferma
//   npm run stark:install  mette `stark` nel PATH dell'utente (`--system` per tutti)
//
// Gira su Linux, WSL2, macOS e **Windows nativo**. Le differenze non stanno sparse:
// `core/platform.ts` dice su cosa siamo, e qui dentro i tre punti che cambiano sono
// dichiarati sul posto — come si stacca il daemon (systemd di sistema, systemd utente,
// `DETACHED_PROCESS`), come si chiama `npm`, e come gli si chiede di spegnersi.
//
// Perché esiste `up` oltre a `start`: sono due domande diverse. `start` è «accendi il
// daemon», e si arrabbia se ne trova già uno. `up` è «voglio usare STARK adesso», e
// quindi è **idempotente**: se gira già non è un errore, è la condizione normale. Chi
// scrive `stark` la mattina non sa e non deve sapere se ieri sera l'ha lasciato acceso.
//
// Perché staccato conta più di quanto sembri: quando il daemon muore, muoiono con lui
// tutti i processi degli agent. Riaprire una conversazione rilegge tutto il contesto,
// quindi **costa quota** (ADR-005). Chiudere per sbaglio la finestra del terminale era
// il modo più facile di pagare quel prezzo senza aver deciso di pagarlo.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openInBrowser, WIN } from '../core/platform.ts'
import { startDaemon, PORTA } from '../daemon/server.ts'
import { uiIsBuilt } from '../daemon/static.ts'
import { STARK_HOME } from '../daemon/registry.ts'
import {
  clearPid, ensureHome, logPath, pidPath, readToken, runningPid, tokenPath, writePid, writeToken,
} from '../daemon/identity.ts'
import { controlla, passaAllaRelease, riallinea } from '../daemon/aggiornamenti.ts'
import { ambienteSystemd } from '../daemon/riavvio.ts'

/** La radice del repo: questo file sta in `src/cli/`, due livelli sotto. */
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Quale verbo, e qual è il default quando non ce n'è uno.
 *
 * Sono due default diversi per due porte diverse, e la differenza è voluta:
 * `npm run stark` significa «fammi vedere il daemon lavorare», quindi `run` (primo
 * piano); il comando `stark` installato significa «voglio usare STARK adesso», quindi
 * `up`. A dirlo è il lanciatore, con `STARK_DEFAULT_VERB=up`.
 *
 * Prima quella regola stava **nel lanciatore**, scritta in `sh`. Con Windows nativo
 * sarebbe servita una seconda volta in `cmd`, dove esprimere «il primo argomento è
 * un'opzione, non un verbo» costa sei righe di `findstr`. Due copie della stessa regola
 * in due linguaggi diversi è il modo in cui una delle due resta indietro: sta qui, una
 * volta sola, dove si legge e si prova.
 *
 * Il caso che il controllo su `-` esiste per risolvere è `stark --no-open`: un
 * argomento c'è, ma è un'opzione. Senza, finiva al CLI come nome di comando —
 * «comando sconosciuto: --no-open», che è vero e inutile.
 */
const primo = process.argv[2]
const comando = (!primo || primo.startsWith('-'))
  ? (process.env['STARK_DEFAULT_VERB'] === 'up' ? 'up' : 'run')
  : primo
const porta = process.env['STARK_PORT'] ? Number(process.env['STARK_PORT']) : PORTA
const url = `http://127.0.0.1:${porta}`

/** Quanto aspettare che il daemon risponda, o che smetta di farlo. */
const ATTESA_MS = 15_000

async function risponde(): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/sessions`, {
      headers: { authorization: `Bearer ${readToken(STARK_HOME)}` },
    })
    return res.ok
  } catch {
    return false
  }
}

async function finche(cosa: () => Promise<boolean>, atteso: boolean): Promise<boolean> {
  const fine = Date.now() + ATTESA_MS
  for (;;) {
    if (await cosa() === atteso) return true
    if (Date.now() > fine) return false
    await new Promise(r => setTimeout(r, 200))
  }
}

function indirizzo(token: string): void {
  console.log(`\n  Apri STARK:  ${url}/?token=${token}\n`)
  console.log(`Il token sta nell'indirizzo una volta sola: al primo caricamento STARK lo`)
  console.log(`sposta in un cookie e lo toglie dalla barra degli indirizzi.`)
}

/** Dove va il lanciatore. Per utente di default — vedi `installa()`. */
function dovePerIlLanciatore(sistema: boolean): { dir: string; file: string } {
  if (WIN) {
    // `LOCALAPPDATA` e non `APPDATA`: il primo non segue un profilo mobile su rete,
    // e qui dentro finisce un percorso assoluto al Node e al repo **di questa
    // macchina** — su un'altra sarebbe un comando che c'è e non funziona.
    const base = process.env['LOCALAPPDATA'] ?? resolve(homedir(), 'AppData', 'Local')
    return { dir: resolve(base, 'stark', 'bin'), file: 'stark.cmd' }
  }
  if (sistema) return { dir: '/usr/local/bin', file: 'stark' }
  return { dir: resolve(homedir(), '.local', 'bin'), file: 'stark' }
}

/**
 * Il file del lanciatore: `sh` su POSIX, `cmd` su Windows nativo.
 *
 * È un lanciatore di tre righe, non una copia: dentro ci sono solo due percorsi
 * assoluti, quindi il codice vero resta quello del repo e un `git pull` lo aggiorna da
 * sé. In cambio va rigenerato se il repo si sposta — lo dice il file stesso, in testa.
 *
 * Perché `process.execPath` e non `env node` (o `node` nel `PATH` su Windows): questo è
 * il Node che sta funzionando adesso, cioè quello con cui il progetto gira davvero
 * (≥ 22.18, che serve per eseguire i `.ts` senza compilarli — ADR-007). Il `PATH`
 * prenderebbe quello che capita, che con nvm cambia da shell a shell, in un lanciatore
 * grafico spesso non c'è affatto, e su questa macchina è addirittura un Node 12.
 */
function testoLanciatore(): string {
  const nodo = process.execPath
  const entrata = resolve(RADICE, 'src/cli/stark.ts')
  if (WIN) {
    return [
      '@echo off',
      'REM Generato da `stark install`. Rigeneralo se sposti il repo o cambi Node.',
      `REM repo: ${RADICE}`,
      'REM Senza un verbo il default e` `up`: vedi STARK_DEFAULT_VERB in src/cli/stark.ts',
      'set "STARK_DEFAULT_VERB=up"',
      `"${nodo}" "${entrata}" %*`,
      '',
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    '# Generato da `stark install`. Rigeneralo se sposti il repo o cambi Node.',
    `# repo: ${RADICE}`,
    '# Senza un verbo il default è `up`: vedi STARK_DEFAULT_VERB in src/cli/stark.ts',
    'STARK_DEFAULT_VERB=up',
    'export STARK_DEFAULT_VERB',
    '',
    `exec ${JSON.stringify(nodo)} ${JSON.stringify(entrata)} "$@"`,
    '',
  ].join('\n')
}

/** `dir` è già una voce del `PATH` di questo processo? Confronto normalizzato, perché
 *  `~/.local/bin` e `/root/.local/bin` sono la stessa cartella scritta in due modi. */
function nelPath(dir: string): boolean {
  const sep = WIN ? ';' : ':'
  const voci = (process.env['PATH'] ?? '').split(sep).filter(Boolean).map(v => resolve(v))
  const bersaglio = resolve(dir)
  // Su Windows i percorsi non distinguono maiuscole e minuscole; su POSIX sì.
  return WIN
    ? voci.some(v => v.toLowerCase() === bersaglio.toLowerCase())
    : voci.includes(bersaglio)
}

/**
 * Aggiunge `dir` al `PATH` dell'utente, in modo che valga anche nei terminali futuri.
 *
 * Condotta presa da `memoria.ts`, che ha lo stesso problema — scrivere dentro un file
 * **dell'utente**: non si riscrive niente, si aggiunge in fondo un blocco riconoscibile,
 * e se il blocco c'è già non se ne aggiunge un secondo. Restituisce il file toccato, o
 * `null` se non c'era niente da fare o non si è saputo dove scrivere: in quel caso chi
 * chiama stampa la riga da aggiungere a mano, che è meglio di indovinare il file.
 */
function aggiungiAlPath(dir: string): string | null {
  if (WIN) {
    // Il `PATH` dell'utente su Windows sta nel registro, non in un file: si legge e si
    // riscrive con .NET. **Mai `setx`**, che tronca a 1024 caratteri — cioè può
    // cancellare in silenzio metà del `PATH` di chi lo aveva lungo.
    const ps = [
      "$d = [Environment]::GetEnvironmentVariable('Path','User')",
      `$n = '${dir.replace(/'/g, "''")}'`,
      "if (($d -split ';') -notcontains $n) {",
      "  $v = if ([string]::IsNullOrEmpty($d)) { $n } else { $d.TrimEnd(';') + ';' + $n }",
      "  [Environment]::SetEnvironmentVariable('Path', $v, 'User')",
      '  Write-Output "aggiunto"',
      '}',
    ].join('\n')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    return r.status === 0 && r.stdout.includes('aggiunto') ? 'PATH utente (registro di Windows)' : null
  }

  const shell = basename(process.env['SHELL'] ?? '')
  const rc = shell === 'zsh' ? resolve(homedir(), '.zshrc')
    : shell === 'bash' ? resolve(homedir(), '.bashrc')
    : shell === 'fish' ? resolve(homedir(), '.config/fish/config.fish')
    : null
  if (!rc) return null

  const marchio = '# STARK — aggiunto da `stark install`'
  try {
    const gia = readFileSync(rc, 'utf8')
    if (gia.includes(marchio)) return null
  } catch { /* il file può non esistere ancora: si crea appendendo */ }
  const riga = shell === 'fish'
    ? `fish_add_path ${JSON.stringify(dir)}`
    : `export PATH=${JSON.stringify(dir)}:"$PATH"`
  try {
    mkdirSync(dirname(rc), { recursive: true })
    appendFileSync(rc, `\n${marchio}\n${riga}\n`)
    return rc
  } catch {
    return null
  }
}

/**
 * Mette un `stark` eseguibile dove il `PATH` lo trova, così il comando esiste da
 * qualunque cartella invece di richiedere `cd` nel repo più `npm run …`.
 *
 * **Per utente, non di sistema**, e la ragione non è la comodità di evitare `sudo`.
 * `sudo` servirebbe solo a *scrivere il file*: il lanciatore non ha il bit setuid, e un
 * eseguibile di proprietà di root lanciato da un altro utente gira **come quell'utente**.
 * Cioè installare da root non darebbe all'agent un permesso in più — a decidere cosa
 * l'agent può fare è chi digita `stark`, sempre, esattamente come chi digita `claude`.
 *
 * Installare in `/usr/local/bin` avrebbe invece due effetti veri, entrambi contro:
 * il file è condiviso da tutti gli utenti ma i due percorsi assoluti che contiene no —
 * un altro utente lo troverebbe nel `PATH` e si beccherebbe un errore di permessi sul
 * repo; e inviterebbe a lanciarlo con `sudo`, che non è «lo stesso STARK con più
 * poteri» ma **un altro STARK**: `~/.claude` e `~/.stark` sono per utente, quindi
 * cambierebbero login, journal, token e impostazioni tutti insieme.
 *
 * `--system` resta per chi lo vuole comunque: la voce c'è, disabilitata di default e
 * con la ragione scritta, non nascosta.
 */
function installa(): void {
  const sistema = process.argv.includes('--system')
  const { dir, file } = dovePerIlLanciatore(sistema)
  const dove = resolve(dir, file)

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(dove, testoLanciatore())
    if (!WIN) chmodSync(dove, 0o755)
  } catch (e) {
    console.error(`Non sono riuscita a scrivere ${dove}: ${String((e as Error).message ?? e)}`)
    if (sistema) console.error('`--system` scrive in /usr/local/bin, che vuole root. Prova senza.')
    else console.error(`Un ripiego senza scrivere niente è un alias:\n  alias stark='${process.execPath} ${resolve(RADICE, 'src/cli/stark.ts')}'`)
    process.exit(1)
  }

  console.log(`Fatto: ${dove}\n`)

  if (!nelPath(dir)) {
    const toccato = aggiungiAlPath(dir)
    if (toccato) {
      console.log(`${dir} non era nel PATH: l'ho aggiunto in ${toccato}.`)
      console.log(WIN
        ? 'Vale dal prossimo terminale che apri.'
        : `Vale dal prossimo terminale, o subito con:  . ${toccato}`)
    } else {
      console.log(`${dir} non è nel PATH e non ho saputo dove scriverlo. Aggiungi a mano:`)
      console.log(WIN ? `  setx PATH "%PATH%;${dir}"` : `  export PATH=${JSON.stringify(dir)}:"$PATH"`)
    }
    console.log('')
  }

  console.log('Da qualunque cartella, adesso:')
  console.log('  stark          accende se serve e apre STARK nel browser')
  console.log('  stark status   come sta')
  console.log('  stark stop     lo ferma')
  console.log('  stark update   scarica l\'ultima versione e riavvia')
  console.log('  stark token    ristampa l\'indirizzo col token')
}

/**
 * Le variabili che il daemon legge davvero le elenca `riavvio.ts`, non questo file.
 *
 * Erano due copie della stessa lista — una qui per l'unità del daemon, una là per
 * l'unità del ricambio — e due copie vogliono dire che un giorno una delle due perde
 * una variabile. Quella perdita è già successa una volta con `STARK_PUBLIC_HOST`, e si
 * manifesta come un perimetro che si richiude in silenzio dopo un riavvio.
 */

/**
 * `npm`, ma **quello accanto al nostro Node**, non quello che capita nel `PATH`.
 *
 * Trovato provando `stark update` su un'installazione fatta da `install.sh`, cioè
 * esattamente la condizione del collega: il lanciatore pinna il Node giusto con un
 * percorso assoluto (`process.execPath`), ma `npm` no — e su una macchina in cui il
 * `PATH` porta un Node vecchio, o non porta npm affatto, `stark update` moriva su
 * «npm install è fallito» senza dire che il colpevole era un altro Node. Misurato con
 * `PATH=/usr/bin:/bin` e Node 12 di sistema.
 *
 * Serve **tutte e due** le metà, e la seconda si dimentica: il percorso assoluto a
 * `npm`, e la sua cartella in testa al `PATH` del figlio — perché npm è uno script che
 * a sua volta invoca `node`, e senza quella riga risalirebbe al Node sbagliato lo stesso.
 *
 * Su Windows `npm` è `npm.cmd`, e dal 2024 Node **rifiuta** di eseguire un `.cmd` senza
 * `shell: true` (correzione di CVE-2024-27980, su come Windows costruisce la riga di
 * comando). Gli argomenti che passano di qui sono nostri e letterali — `run`,
 * `ui:build`, `install` — quindi la shell non è una superficie: non ci arriva niente
 * che venga da fuori.
 */
function npm(args: string[]): ReturnType<typeof spawnSync> {
  const dirNode = dirname(process.execPath)
  const accanto = resolve(dirNode, WIN ? 'npm.cmd' : 'npm')
  // Se accanto non c'è (un Node impacchettato in modo insolito), si ricade su quello
  // del `PATH`: meglio provare con quello che arrendersi prima di aver tentato.
  const comandoNpm = existsSync(accanto) ? accanto : (WIN ? 'npm.cmd' : 'npm')
  return spawnSync(comandoNpm, args, {
    cwd: RADICE,
    stdio: 'inherit',
    shell: WIN,
    env: { ...process.env, PATH: `${dirNode}${WIN ? ';' : ':'}${process.env['PATH'] ?? ''}` },
  })
}

/**
 * Avvia il daemon come **servizio transiente di systemd**, se si può.
 *
 * Perché non basta `spawn(detached)` — e questo è stato riprodotto, non dedotto
 * (27 agosto 2026, segnalato dall'utente: «ho avviato stark da terminale, l'ho chiuso, e
 * dopo qualche minuto la sessione si è interrotta»).
 *
 * `detached: true` chiama `setsid()`, che stacca il processo dal **terminale**: il
 * SIGHUP della chiusura non lo raggiunge, ed è quello che il vecchio commento qui
 * prometteva. Ma systemd non traccia i processi per sessione: li traccia per **cgroup**,
 * e un figlio eredita quello del padre. Un terminale vive dentro
 * `session-N.scope`; alla chiusura logind ferma quello scope, e fermare uno scope
 * significa **uccidere tutto ciò che sta nel suo cgroup** — session leader o no.
 * Misurato: daemon avviato dentro uno scope → `0::/system.slice/…scope`, scope fermato
 * → daemon **morto**, porta chiusa. E la via manuale non c'è: su WSL il cgroup radice è
 * in sola lettura, quindi il processo non può uscirsene da solo.
 *
 * Un servizio transiente invece nasce in `system.slice`, cioè **fuori** da qualunque
 * sessione: stessa prova, scope fermato → daemon vivo. È il meccanismo che systemd
 * offre apposta per questo, quindi si usa quello invece di inventarne uno (§«se esiste
 * qualcosa di ufficiale e già pronto»).
 *
 * `--collect` perché un'unità fermata non resti in giro a bloccare il proprio nome; il
 * nome porta un'impronta di `STARK_HOME` perché due daemon su case diverse — quello
 * vero e uno di prova — devono poter convivere, come già fa `process.title`.
 * Il log resta `daemon.log` e non il journal: `stark status` manda a leggere lì, e
 * spostarlo vorrebbe dire cambiare la risposta a «perché non è partito».
 */
function avviaConSystemd(): boolean {
  if (WIN) return false // systemd non esiste: su Windows si va di `spawn(detached)`
  const impronta = createHash('sha1').update(STARK_HOME).digest('hex').slice(0, 8)
  const log = logPath(STARK_HOME)

  // Da root il manager di sistema; da utente normale il **proprio**.
  //
  // `systemd-run` senza `--user` parla col manager di sistema, che vuole root: per un
  // utente normale fallisce, si ripiegava su `spawn(detached)`, e quello è esattamente
  // il caso documentato come rotto qui sopra — logind ferma lo scope del terminale e
  // porta via tutto il cgroup. Cioè la protezione c'era solo per chi girava da root, e
  // per tutti gli altri il bug era ancora lì, silenzioso.
  //
  // Il limite di `--user`, che va detto invece di scoprirlo: senza
  // `loginctl enable-linger <utente>` il manager utente viene chiuso all'**ultimo
  // logout**, e con lui l'unità. Chiudere una finestra di terminale va bene — è il caso
  // per cui tutto questo esiste; disconnettersi dall'ultima sessione SSH no.
  const utente = process.getuid?.() !== 0
  const r = spawnSync('systemd-run', [
    ...(utente ? ['--user'] : []),
    '--unit', `stark-${impronta}`,
    '--description', `STARK — ${STARK_HOME}`,
    '--collect', '--quiet',
    // Senza, l'unità parte con la `WorkingDirectory` di default di systemd (la radice,
    // non il checkout): i percorsi relativi che leggono la versione dell'SDK
    // (`node_modules/@anthropic-ai/claude-agent-sdk`, il suo gemello per OpenCode)
    // puntano al posto sbagliato e la pagina System mostra «unknown» per sempre — non
    // per un `try/catch` che fallisce, ma perché guarda una cartella che non esiste lì.
    // Stessa proprietà già presente nel ricambio del riavvio (`riavvio.ts`); qui mancava.
    `--property=WorkingDirectory=${RADICE}`,
    `--property=StandardOutput=append:${log}`,
    `--property=StandardError=append:${log}`,
    ...ambienteSystemd(),
    process.execPath, fileURLToPath(import.meta.url), 'run',
  ], { stdio: 'ignore' })
  return r.status === 0
}

/**
 * Accende il daemon staccato e aspetta che risponda. Restituisce il pid, o `null` se non
 * ha risposto in tempo. Non controlla se ne gira già uno: quella domanda ha risposte
 * diverse per `start` (è un errore) e per `up` (è la normalità), quindi resta a chi chiama.
 */
async function avviaStaccato(): Promise<number | null> {
  ensureHome(STARK_HOME)

  // Prima la via che sopravvive davvero alla chiusura del terminale. Se systemd non
  // c'è, o non siamo root, o la chiamata fallisce per qualunque motivo, si ripiega su
  // `spawn(detached)`: è quello che c'era prima, e su una macchina senza systemd non
  // c'è nessuno scope da cui scappare — quindi lì funzionava ed è ancora giusto.
  if (avviaConSystemd()) {
    if (!await finche(risponde, true)) return null
    return runningPid(STARK_HOME) ?? 0
  }

  const log = openSync(logPath(STARK_HOME), 'a')
  const figlio = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run'], {
    // Su Windows `detached` non è `setsid()` ma il flag `DETACHED_PROCESS`: il figlio
    // **non eredita la console** del terminale, quindi non riceve il `CTRL_CLOSE_EVENT`
    // che il sistema manda a tutti i processi attaccati a una finestra che si chiude.
    // È la stessa garanzia del ramo systemd, ottenuta dal meccanismo che offre Windows.
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
    // Senza, comparirebbe una finestra di console vuota che resta lì tutta la sessione.
    windowsHide: true,
  })
  // `unref` toglie il figlio dalla contabilità di questo processo, che altrimenti
  // resterebbe vivo ad aspettarlo — cioè non si staccherebbe niente.
  figlio.unref()
  if (!await finche(risponde, true)) return null
  return figlio.pid ?? 0
}

// ─── in primo piano ─────────────────────────────────────────────────────────

if (comando === 'run') {
  const gia = runningPid(STARK_HOME)
  if (gia !== null) {
    console.error(`STARK è già in esecuzione (pid ${gia}). "npm run stark:stop" per fermarlo.`)
    process.exit(1)
  }
  // Il titolo dice **quale** STARK è questo. Due daemon con `STARK_HOME` diversi — quello
  // vero e uno di prova — sono la stessa identica riga in `ps`, perché a distinguerli sono
  // variabili d'ambiente, che lì non si vedono. Chi ne ferma uno con
  // `ps | grep "stark.ts run"` li prende quindi tutti: è successo davvero, due volte in
  // un'ora, e a morire è stato quello di produzione con dentro le conversazioni dell'utente.
  //
  // Attenzione a cosa risolve: rende il grep capace di **mirare**, non lo rende il modo
  // giusto di fermare un daemon. Quello resta `stark stop`, e non perché il grep sbagli
  // bersaglio: perché manda SIGTERM e **aspetta** la chiusura, così gli agent si fermano uno
  // per uno e i journal si chiudono. Una `kill` secca li lascia a metà turno, e la barra
  // laterale mostra per sempre lavori che non stanno lavorando.
  process.title = `stark ${STARK_HOME} :${porta}`
  const daemon = await startDaemon({
    port: porta,
    ...(process.env['STARK_MODEL'] ? { model: process.env['STARK_MODEL'] } : {}),
  })
  writePid(STARK_HOME, process.pid)
  indirizzo(daemon.token)
  console.log(`\njournal in ${STARK_HOME}/sessioni`)
  console.log(`\ntoken: ${daemon.token}`)
  console.log(`\nEsempio:\n  curl -s ${daemon.url}/api/sessions -H "Authorization: Bearer ${daemon.token}"`)
  console.log(`\nIl token **non** cambia più a ogni avvio: sta in ${tokenPath(STARK_HOME)}, con`)
  console.log(`permessi 0600. Impedisce a un'altra pagina del browser di parlare con questo`)
  console.log(`processo; "npm run stark:token" ne fa uno nuovo se serve.`)
  console.log(`\nQuesto è il primo piano: chiudendo il terminale muore, e con lui gli agent.`)
  console.log(`Per farlo sopravvivere: npm run stark:start`)

  const spegni = async (): Promise<void> => {
    console.log('\nchiusura…')
    // Il pid si toglie **dopo**, non prima: `stark stop` aspetta che sparisca, e
    // toglierlo per primo lo farebbe tornare mentre gli agent si stanno ancora
    // chiudendo — cioè direbbe «fermato» di un daemon che sta ancora scrivendo.
    await daemon.stop()
    clearPid(STARK_HOME)
    process.exit(0)
  }
  process.on('SIGINT', () => { void spegni() })
  process.on('SIGTERM', () => { void spegni() })

// ─── staccato ───────────────────────────────────────────────────────────────

} else if (comando === 'start') {
  const gia = runningPid(STARK_HOME)
  if (gia !== null) {
    console.log(`STARK è già in esecuzione (pid ${gia}).`)
    indirizzo(readToken(STARK_HOME))
    process.exit(0)
  }
  const pid = await avviaStaccato()
  if (pid === null) {
    console.error(`STARK non ha risposto entro ${ATTESA_MS / 1000}s. Il perché sta in ${logPath(STARK_HOME)}`)
    process.exit(1)
  }
  console.log(`STARK è partito staccato (pid ${pid}). Sopravvive a questo terminale.`)
  indirizzo(readToken(STARK_HOME))
  console.log(`log in ${logPath(STARK_HOME)} · "npm run stark:stop" per fermarlo`)
  process.exit(0)

// ─── accendi e aprimi ───────────────────────────────────────────────────────

} else if (comando === 'up') {
  // La UI compilata è un artefatto locale e non sta in git: dopo un `git clone` o un
  // `git pull` che tocca `ui/`, `ui/dist` può mancare o essere vecchia. Senza questo
  // controllo il browser si aprirebbe su un 503 con scritto «esegui npm run ui:build»
  // — cioè su un comando da digitare, che è esattamente la cosa che `up` esiste per
  // togliere di mezzo. Costruirla qui costa qualche secondo una volta sola.
  if (!uiIsBuilt()) {
    console.log('La UI non è compilata: la compilo adesso (succede dopo un clone o un pull).')
    const esito = npm(['run', 'ui:build'])
    if (esito.status !== 0) {
      console.error('\n`npm run ui:build` è fallito. Il daemon parte lo stesso, ma la pagina')
      console.error('darebbe 503: senza la UI compilata c\'è solo l\'API.')
      process.exit(1)
    }
  }

  const gia = runningPid(STARK_HOME)
  if (gia !== null) {
    console.log(`STARK è già acceso (pid ${gia}).`)
  } else {
    const pid = await avviaStaccato()
    if (pid === null) {
      console.error(`STARK non ha risposto entro ${ATTESA_MS / 1000}s. Il perché sta in ${logPath(STARK_HOME)}`)
      process.exit(1)
    }
    console.log(`STARK acceso (pid ${pid}). Sopravvive a questo terminale.`)
  }

  const token = readToken(STARK_HOME)
  const completo = `${url}/?token=${token}`
  // `--no-open` c'è per chi è entrato da SSH: là aprire un browser non ha senso (o apre
  // una finestra su una macchina che nessuno sta guardando), ma accendere il daemon sì.
  const soloAccendi = process.argv.includes('--no-open')
  const aperto = soloAccendi ? null : await openInBrowser(completo)

  // L'indirizzo si stampa **sempre**, anche quando il browser si è aperto: su WSL la
  // finestra compare dall'altra parte — su Windows, non nel terminale che si sta
  // guardando — e la riga da copiare deve essere lì comunque, non un ripiego da
  // chiedere dopo aver visto che non è successo niente.
  if (aperto?.ok) console.log(`\n  Aperto nel browser:  ${completo}\n`)
  else {
    console.log(`\n  Apri STARK:  ${completo}\n`)
    if (aperto) console.log(`(il browser non si è aperto da qui: ${aperto.error})`)
  }
  process.exit(0)

// ─── installa il comando ────────────────────────────────────────────────────

} else if (comando === 'install') {
  installa()
  process.exit(0)

// ─── stato ──────────────────────────────────────────────────────────────────

} else if (comando === 'status') {
  const pid = runningPid(STARK_HOME)
  const vivo = await risponde()
  if (pid === null && !vivo) {
    console.log('STARK non è in esecuzione.')
    process.exit(1)
  }
  if (pid === null && vivo) {
    // Qualcuno l'ha avviato in un modo che non passa da qui, per esempio a mano.
    console.log(`Qualcosa risponde su ${url}, ma non c'è un pid in ${pidPath(STARK_HOME)}.`)
  } else {
    console.log(`STARK è in esecuzione (pid ${pid}) e ${vivo ? 'risponde' : 'NON risponde'} su ${url}`)
  }
  if (vivo) {
    const { sessions } = await fetch(`${url}/api/sessions`, {
      headers: { authorization: `Bearer ${readToken(STARK_HOME)}` },
    }).then(r => r.json()) as { sessions: { live: boolean }[] }
    const attive = sessions.filter(s => s.live).length
    console.log(`${sessions.length} conversazioni, ${attive} con un processo dietro`)
    const sistema = await fetch(`${url}/api/system`, {
      headers: { authorization: `Bearer ${readToken(STARK_HOME)}` },
    }).then(r => r.json()) as { perimeter?: { open: boolean; hosts: { host: string; source: string }[] } }
    // Lo chiede al daemon invece di rileggere l'ambiente: quello che conta è cosa ha
    // letto **il processo in esecuzione**, che può essere partito prima dell'ultima
    // modifica alla configurazione.
    if (sistema.perimeter?.open) {
      for (const h of sistema.perimeter.hosts) console.log(`raggiungibile anche come ${h.host} (${h.source})`)
    } else {
      console.log('raggiungibile solo da questa macchina')
    }
    indirizzo(readToken(STARK_HOME))
  }
  process.exit(vivo ? 0 : 1)

// ─── stop ───────────────────────────────────────────────────────────────────

} else if (comando === 'stop') {
  const pid = runningPid(STARK_HOME)
  if (pid === null) {
    console.log('STARK non è in esecuzione.')
    process.exit(0)
  }
  // SIGTERM e non SIGKILL: il daemon chiude gli agent uno per uno e scrive nei journal
  // che si sono fermati. Ammazzarlo lascerebbe ogni conversazione a metà di un turno,
  // e la barra laterale mostrerebbe per sempre lavori che non stanno lavorando.
  //
  // Su Windows quel segnale **non esiste**: Node traduce `process.kill(pid,'SIGTERM')`
  // in `TerminateProcess`, che è la `kill -9` di lassù — nessun handler gira, i journal
  // restano aperti a metà turno, e i processi degli agent restano orfani (là i figli non
  // muoiono col padre). Quindi lì si chiede al daemon di spegnersi da sé, dalla rotta
  // che fa girare *lo stesso* handler: una via sola per chiudere, non due che divergono.
  if (WIN) {
    const res = await fetch(`${url}/api/shutdown`, {
      method: 'POST', headers: { authorization: `Bearer ${readToken(STARK_HOME)}` },
    }).catch(() => null)
    if (!res?.ok) {
      console.error('Il daemon non ha accettato la richiesta di spegnimento.')
      console.error(`Se è piantato: taskkill /PID ${pid} /T /F — ma lascia i journal a metà.`)
      process.exit(1)
    }
  } else {
    process.kill(pid, 'SIGTERM')
  }
  const morto = await finche(async () => runningPid(STARK_HOME) !== null, false)
  if (!morto) {
    console.error(`Il processo ${pid} non si è fermato entro ${ATTESA_MS / 1000}s.`)
    process.exit(1)
  }
  console.log(`STARK fermato (pid ${pid}). Le conversazioni restano su disco.`)
  process.exit(0)

// ─── aggiorna ───────────────────────────────────────────────────────────────

} else if (comando === 'update') {
  // Esiste perché senza di lui un collega che ha installato con `curl … | bash` non ha
  // nessuna via per prendere una correzione: il lanciatore punta al repo, ma nessuno gli
  // ha dato il comando per aggiornarlo, e «fai `cd` là dentro e `git pull`» è di nuovo
  // il tipo di istruzione che l'installer esiste per togliere di mezzo.
  //
  // Si aggiorna **all'ultima release**, non all'ultimo commit di `main`. Prima era
  // `git pull --ff-only`, cioè: qualunque push tirava dietro tutti. Chi rilascia deve
  // poter spingere su `main` senza spedire quel commit a un collega nello stesso
  // minuto — e chi installa deve prendere una versione che qualcuno ha dichiarato
  // pronta, non l'ultima cosa scritta. Cosa sia una release lo dice `core/release.ts`;
  // come ci si arriva, `daemon/aggiornamenti.ts`.
  const stato = await controlla(RADICE)
  if (stato.errore) {
    console.error(`Non sono riuscito a chiedere le versioni al remoto: ${stato.errore}`)
    console.error('Serve rete e accesso al repo. La copia su disco non è stata toccata.')
    process.exit(1)
  }
  if (!stato.ultima || !stato.tag) {
    // Non è un errore: è un progetto che non ha ancora rilasciato niente. Dirlo con
    // un codice di uscita rosso manderebbe a cercare un guasto che non c'è.
    console.log('Nessuna release pubblicata su questo repo: non c\'è niente a cui')
    console.log('aggiornarsi. Le release sono tag `vX.Y.Z` — vedi docs/rilascio.md.')
    process.exit(0)
  }
  if (!stato.disponibile) {
    console.log(`Già all'ultima versione: ${stato.installata} (release ${stato.ultima}).`)
    process.exit(0)
  }
  console.log(`Aggiorno da ${stato.installata} a ${stato.ultima} (tag ${stato.tag}).`)
  try {
    await passaAllaRelease(RADICE, stato.tag)
  } catch (e) {
    console.error(`\nNon sono riuscito a passare a ${stato.tag}: ${(e as Error).message}`)
    process.exit(1)
  }
  // `npm install` e non `ci`: `ci` cancella `node_modules` e riscarica tutto, compresi i
  // ~340 MB del binario di Claude Code, ogni volta. Il lockfile lo rispettano entrambi.
  if (npm(['install']).status !== 0) { console.error('`npm install` è fallito.'); process.exit(1) }
  // …ma `npm install` **sporca l'albero**: riscrive `package-lock.json` e `yarn.lock` a
  // ogni esecuzione. Senza questa riga l'aggiornamento si chiuderebbe la porta alle
  // spalle, e il prossimo si rifiuterebbe per modifiche locali che sono nostre. Vedi
  // `riallinea()`: è sicura qui e solo qui, perché la partenza era pulita per costruzione.
  await riallinea(RADICE)
  if (npm(['run', 'ui:build']).status !== 0) { console.error('`npm run ui:build` è fallito.'); process.exit(1) }

  // Il lanciatore va riscritto: `process.execPath` può essere cambiato (un Node nuovo
  // sotto la cartella di STARK), e il file contiene quel percorso per esteso.
  installa()

  // Il daemon in esecuzione ha in memoria il codice **di prima**: finché non riparte,
  // l'aggiornamento è su disco e basta. Si riavvia solo se era già acceso — accenderlo
  // qui vorrebbe dire che `update` fa anche `up`, che è un'altra domanda.
  if (runningPid(STARK_HOME) !== null) {
    console.log('\nSTARK era acceso: lo riavvio perché prenda il codice nuovo.')
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'stop'], { stdio: 'inherit' })
    if (r.status === 0) spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'start'], { stdio: 'inherit' })
  }
  process.exit(0)

// ─── token ──────────────────────────────────────────────────────────────────

} else if (comando === 'token') {
  const token = process.argv.includes('--new') ? writeToken(STARK_HOME) : readToken(STARK_HOME)
  if (process.argv.includes('--new')) {
    console.log('Token nuovo. Le schede aperte con quello vecchio vanno ricaricate')
    console.log('dall\'indirizzo qui sotto, e un daemon già in esecuzione va riavviato.')
  }
  indirizzo(token)
  console.log(`token: ${token}`)
  process.exit(0)

} else {
  console.error(`comando sconosciuto: ${comando}`)
  console.error('usa: run (default) · up · start · status · stop · update · token [--new] · install [--system]')
  process.exit(1)
}
