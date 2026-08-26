// Avvia il daemon, o lo guarda, o lo ferma.
//
//   npm run stark          in primo piano, Ctrl-C lo ferma
//   npm run stark:start    staccato: sopravvive alla chiusura del terminale
//   npm run stark:status   dove sta, da quanto, quante conversazioni
//   npm run stark:stop     lo ferma
//
// Perché staccato conta più di quanto sembri: quando il daemon muore, muoiono con lui
// tutti i processi degli agent. Riaprire una conversazione rilegge tutto il contesto,
// quindi **costa quota** (ADR-005). Chiudere per sbaglio la finestra del terminale era
// il modo più facile di pagare quel prezzo senza aver deciso di pagarlo.

import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startDaemon, PORTA } from '../daemon/server.ts'
import { STARK_HOME } from '../daemon/registry.ts'
import {
  clearPid, ensureHome, logPath, pidPath, readToken, runningPid, tokenPath, writePid, writeToken,
} from '../daemon/identity.ts'

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
  // `detached` mette il figlio in una sessione sua: quando il terminale se ne va,
  // il SIGHUP che uccide tutto ciò che gli appartiene non lo raggiunge.
  ensureHome(STARK_HOME)
  const log = openSync(logPath(STARK_HOME), 'a')
  const figlio = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  })
  // `unref` toglie il figlio dalla contabilità di questo processo, che altrimenti
  // resterebbe vivo ad aspettarlo — cioè non si staccherebbe niente.
  figlio.unref()

  if (!await finche(risponde, true)) {
    console.error(`STARK non ha risposto entro ${ATTESA_MS / 1000}s. Il perché sta in ${logPath(STARK_HOME)}`)
    process.exit(1)
  }
  console.log(`STARK è partito staccato (pid ${figlio.pid}). Sopravvive a questo terminale.`)
  indirizzo(readToken(STARK_HOME))
  console.log(`log in ${logPath(STARK_HOME)} · "npm run stark:stop" per fermarlo`)
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
  console.error('usa: run (default) · start · status · stop · token [--new]')
  process.exit(1)
}
