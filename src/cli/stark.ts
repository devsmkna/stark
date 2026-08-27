// Avvia il daemon, o lo guarda, o lo ferma.
//
//   stark                  (= stark up) accendi se serve e aprimi STARK — vedi sotto
//   npm run stark          in primo piano, Ctrl-C lo ferma
//   npm run stark:start    staccato: sopravvive alla chiusura del terminale
//   npm run stark:status   dove sta, da quanto, quante conversazioni
//   npm run stark:stop     lo ferma
//   npm run stark:install  mette `stark` in /usr/local/bin
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
import { chmodSync, openSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openInBrowser } from '../core/platform.ts'
import { startDaemon, PORTA } from '../daemon/server.ts'
import { uiIsBuilt } from '../daemon/static.ts'
import { STARK_HOME } from '../daemon/registry.ts'
import {
  clearPid, ensureHome, logPath, pidPath, readToken, runningPid, tokenPath, writePid, writeToken,
} from '../daemon/identity.ts'

/** La radice del repo: questo file sta in `src/cli/`, due livelli sotto. */
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const comando = process.argv[2] ?? 'run'
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

/**
 * Mette un `stark` eseguibile in `/usr/local/bin`, così il comando esiste da qualunque
 * cartella invece di richiedere `cd` nel repo più `npm run …`.
 *
 * È un lanciatore di tre righe, non una copia: dentro ci sono solo due percorsi
 * assoluti, quindi il codice vero resta quello del repo e un `git pull` lo aggiorna da
 * sé. In cambio va rigenerato se il repo si sposta — lo dice il file stesso, in testa.
 *
 * Perché `process.execPath` e non `env node`: questo è il Node che sta funzionando
 * adesso, cioè quello con cui il progetto gira davvero (≥ 22.18, che serve per
 * eseguire i `.ts` senza compilarli — ADR-007). `env node` prenderebbe quello che
 * capita nel `PATH`, che con nvm cambia da shell a shell e in un lanciatore grafico
 * spesso non c'è affatto.
 */
function installa(): void {
  const dove = '/usr/local/bin/stark'
  const script = [
    '#!/bin/sh',
    '# Generato da `npm run stark:install`. Rigeneralo se sposti il repo.',
    `# repo: ${RADICE}`,
    '',
    '# Senza un verbo il default è `up`: accendi se serve e aprimi STARK. Non è il',
    '# default del CLI, che resta `run` (primo piano) per non cambiare `npm run stark`.',
    '#',
    '# Il secondo caso è `stark --no-open`: un argomento c\'è, ma è un\'opzione, non un',
    '# verbo. Senza questo controllo finiva al CLI come nome di comando — «comando',
    '# sconosciuto: --no-open», che è vero e inutile.',
    'case "${1-}" in',
    '  ""|-*) set -- up "$@" ;;',
    'esac',
    '',
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(RADICE, 'src/cli/stark.ts'))} "$@"`,
    '',
  ].join('\n')

  try {
    writeFileSync(dove, script)
    chmodSync(dove, 0o755)
  } catch (e) {
    console.error(`Non sono riuscita a scrivere ${dove}: ${String((e as Error).message ?? e)}`)
    console.error('Se non sei root, una via senza privilegi è mettere lo stesso lanciatore')
    console.error('in ~/.local/bin (se è nel PATH), oppure un alias nel tuo ~/.bashrc:')
    console.error(`  alias stark='${process.execPath} ${resolve(RADICE, 'src/cli/stark.ts')}'`)
    process.exit(1)
  }

  console.log(`Fatto: ${dove}\n`)
  console.log('Da qualunque cartella, adesso:')
  console.log('  stark          accende se serve e apre STARK nel browser')
  console.log('  stark status   come sta')
  console.log('  stark stop     lo ferma')
  console.log('  stark token    ristampa l\'indirizzo col token')
}

/**
 * Le variabili che il daemon legge davvero, nella forma che vuole `systemd-run`.
 *
 * Vanno passate a mano perché un servizio transiente parte con un ambiente **pulito**:
 * senza `HOME` il registro cercherebbe i journal nel posto sbagliato, e senza
 * `CLAUDE_CONFIG_DIR` i processi figli non troverebbero le sessioni da riprendere —
 * che è il modo in cui questa cosa si rompe sembrando rotta senza motivo (§Vincoli).
 *
 * Diventano visibili in `systemctl show`, e va detto: non è un'esposizione nuova,
 * perché lo stesso ambiente si legge già da `/proc/<pid>/environ`, e in entrambi i casi
 * serve essere root — cioè chi ha già avviato il daemon.
 */
function ambiente(): string[] {
  const fuori: string[] = []
  // `STARK_PUBLIC_HOST` e `STARK_VAPID_SUBJECT` sono qui per una ragione precisa:
  // dimenticarle qui non rompe niente in primo piano (`npm run stark`) e **richiude il
  // perimetro in silenzio** dopo `stark start`, con il telefono che si becca un 403 che
  // sembra un problema di token. È già successo con Tailscale, in un'altra forma.
  for (const k of ['STARK_HOME', 'STARK_PORT', 'STARK_MODEL', 'STARK_TOKEN',
    'STARK_PUBLIC_HOST', 'STARK_VAPID_SUBJECT',
    'CLAUDE_CONFIG_DIR', 'PATH', 'HOME']) {
    const v = process.env[k]
    if (v) fuori.push('--setenv', `${k}=${v}`)
  }
  return fuori
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
  const impronta = createHash('sha1').update(STARK_HOME).digest('hex').slice(0, 8)
  const log = logPath(STARK_HOME)
  const r = spawnSync('systemd-run', [
    '--unit', `stark-${impronta}`,
    '--description', `STARK — ${STARK_HOME}`,
    '--collect', '--quiet',
    `--property=StandardOutput=append:${log}`,
    `--property=StandardError=append:${log}`,
    ...ambiente(),
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
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
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
    const esito = spawnSync('npm', ['run', 'ui:build'], { cwd: RADICE, stdio: 'inherit' })
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
  process.kill(pid, 'SIGTERM')
  const morto = await finche(async () => runningPid(STARK_HOME) !== null, false)
  if (!morto) {
    console.error(`Il processo ${pid} non si è fermato entro ${ATTESA_MS / 1000}s.`)
    process.exit(1)
  }
  console.log(`STARK fermato (pid ${pid}). Le conversazioni restano su disco.`)
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
  console.error('usa: run (default) · up · start · status · stop · token [--new] · install')
  process.exit(1)
}
