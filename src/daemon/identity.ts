// Chi è questo daemon fra un avvio e l'altro: il token, il pid, il log.
//
// Il token era buttato via a ogni avvio, e finché STARK viveva in un terminale aperto
// era la scelta giusta: nasceva col processo e moriva con lui. Ma un daemon che deve
// sopravvivere alla finestra da cui l'hai lanciato non può cambiare indirizzo ogni
// volta — la pagina aperta nel browser smetterebbe di funzionare a ogni riavvio, e
// l'indirizzo non si potrebbe mettere fra i preferiti.
//
// Il costo di tenerlo su disco è onesto e va detto: diventa un segreto a riposo. È
// scritto con permessi `0600` accanto ai journal, che nella stessa cartella contengono
// già tutto ciò che l'agent ha letto — chi può leggere il token può già leggere quelli.
// Quello che il token continua a impedire è l'unica cosa per cui esiste: che **un'altra
// pagina del browser** parli con questo processo.

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Un token valido: 64 caratteri esadecimali, come quelli che generiamo. */
const FORMA = /^[0-9a-f]{64}$/

/** La cartella deve esistere prima del primo file che ci si scrive dentro: al primo
 *  avvio su una macchina nuova non c'è, e il log è la prima cosa che ci finisce. */
export function ensureHome(home: string): void {
  mkdirSync(home, { recursive: true })
}

export const tokenPath = (home: string): string => resolve(home, 'token')

// `nome` esiste da quando il proxy dell'anonimizzazione (D15: processo separato) ha
// bisogno del suo pid e del suo log accanto a quelli del daemon, senza sovrascriverli:
// `daemon.pid`/`daemon.log` restano il default per non toccare nessun chiamante
// esistente, e `nome: 'proxy'` produce `proxy.pid`/`proxy.log`.
export const pidPath = (home: string, nome = 'daemon'): string => resolve(home, `${nome}.pid`)
export const logPath = (home: string, nome = 'daemon'): string => resolve(home, `${nome}.log`)

/**
 * Il token di questo daemon. `STARK_TOKEN` vince su tutto: chi lo imposta sa cosa sta
 * facendo, ed è il modo per averne uno diverso per un daemon di prova senza toccare
 * quello vero.
 *
 * Un file illeggibile o con dentro qualcosa che non è un token viene **riscritto**
 * invece di far fallire l'avvio: il token non è un dato dell'utente da preservare, è
 * una chiave che si può sempre rifare.
 */
export function readToken(home: string): string {
  const dal = process.env['STARK_TOKEN']
  if (dal) return dal
  const path = tokenPath(home)
  if (existsSync(path)) {
    const letto = readFileSync(path, 'utf8').trim()
    if (FORMA.test(letto)) return letto
  }
  return writeToken(home)
}

/** Ne fa uno nuovo e lo scrive. Chi aveva il vecchio smette di poter parlare col daemon. */
export function writeToken(home: string): string {
  mkdirSync(home, { recursive: true })
  const token = randomBytes(32).toString('hex')
  const path = tokenPath(home)
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  // `writeFileSync` non cambia i permessi di un file che esiste già: senza questa
  // riga, un token nato con la umask sbagliata resterebbe leggibile da tutti per
  // sempre, e nessuno se ne accorgerebbe.
  chmodSync(path, 0o600)
  return token
}

/** Il pid del processo (`nome`) che risulta in piedi, o `null` se non ce n'è uno. */
export function runningPid(home: string, nome = 'daemon'): number | null {
  const path = pidPath(home, nome)
  if (!existsSync(path)) return null
  const pid = Number(readFileSync(path, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    // Il segnale 0 non fa niente: serve solo a chiedere «esiste, e posso toccarlo?».
    process.kill(pid, 0)
    return pid
  } catch {
    // Il file è rimasto da un processo morto male. Toglierlo qui evita che «STARK è
    // già in esecuzione» diventi la risposta permanente a chi prova a riavviarlo.
    rmSync(path, { force: true })
    return null
  }
}

export function writePid(home: string, pid: number, nome = 'daemon'): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(pidPath(home, nome), `${pid}\n`)
}

export function clearPid(home: string, nome = 'daemon'): void {
  rmSync(pidPath(home, nome), { force: true })
}
