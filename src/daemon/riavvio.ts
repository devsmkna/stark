// Riavviare il daemon da dentro il daemon.
//
// Il pezzo che decide tutto: un processo non può riaccendere sé stesso. Serve
// qualcuno che sopravviva alla sua morte, aspetti che sia davvero morto e poi lo
// riaccenda — quindi un figlio **staccato**, che non muore col padre.
//
// Non si reinventa l'avvio: il figlio lancia `stark.ts up`, che è la via già scritta e
// già provata (systemd quando c'è, `spawn(detached)` altrimenti, e l'attesa che la
// porta risponda). Qui si aggiunge solo la parte che `up` non fa: aspettare che il
// vecchio sia morto, e ricompilare la UI.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { WIN } from '../core/platform.ts'

const QUI = dirname(fileURLToPath(import.meta.url))
/** La radice del repo: `src/daemon/` → due su. */
export const RADICE = resolve(QUI, '..', '..')

export type EsitoRiavvio = { ok: true; pid?: number } | { ok: false; error: string }

/**
 * Accende il ricambio e restituisce subito: **non** ferma questo processo.
 *
 * Fermarlo è mestiere di chi chiama, che deve prima rispondere alla richiesta HTTP —
 * se il daemon morisse qui dentro, il browser vedrebbe la connessione cadere senza
 * mai sapere se il riavvio era partito o se era esploso qualcosa.
 */
export function avviaRicambio(
  home: string,
  opts: { rebuildUi?: boolean; log?: string; aggiorna?: boolean } = {},
): EsitoRiavvio {
  const nodo = JSON.stringify(process.execPath)
  const cli = JSON.stringify(resolve(RADICE, 'src/cli/stark.ts'))
  const script = [
    // Aspetta che il vecchio non risponda più. `up` è idempotente e, trovando ancora
    // il vecchio vivo, direbbe «già acceso» e non riaccenderebbe niente: questa attesa
    // è ciò che distingue un riavvio da un no-op.
    `for i in $(seq 1 60); do kill -0 ${process.pid} 2>/dev/null || break; sleep 0.25; done`,
    // Aggiornare è **lo stesso comando** che si digita da terminale, non una seconda
    // procedura che gli somiglia: `stark update` sa già scegliere la release, scaricare
    // il bundle giusto (codice, dipendenze e interfaccia già dentro — vedi
    // `daemon/aggiornamenti.ts`) e riscrivere il lanciatore. Scriverne qui una copia
    // vorrebbe dire due percorsi di aggiornamento che divergono alla prima correzione
    // fatta su uno solo.
    //
    // Gira **dopo** che il vecchio è morto, di proposito: estrarre il bundle mentre il
    // processo di prima è ancora vivo gli cambierebbe i file sotto i piedi. E lì
    // `runningPid()` è ormai vuoto, quindi `update` non prova a riavviare niente per
    // conto suo: a riaccendere è la riga dopo, una volta sola.
    //
    // `|| true` non è distrazione: se l'aggiornamento fallisce — rete che cade, il
    // server non risponde — STARK deve **tornare acceso comunque**, sulla versione di
    // prima. Un aggiornamento che non riesce è un fastidio; un daemon che non torna è
    // le conversazioni chiuse e nessuna finestra da cui riaprirle.
    ...(opts.aggiorna ? [`${nodo} ${cli} update || true`] : []),
    // La UI è un artefatto locale: dopo modifiche a `ui/` fatte a mano (un checkout di
    // sviluppo, non un'installazione da bundle), senza questo il browser continuerebbe
    // a ricevere il pacchetto vecchio e il riavvio sembrerebbe non aver fatto niente.
    // Con `aggiorna` non serve: il bundle scaricato da `update` la porta già compilata.
    ...(opts.rebuildUi === false || opts.aggiorna
      ? []
      : [`npm --prefix ${JSON.stringify(RADICE)} run ui:build || true`]),
    `exec ${nodo} ${cli} up --no-open`,
  ].join('\n')

  // Prima strada: un'**unità transiente tutta sua**. Non è un lusso, è l'unica che
  // funziona quando il daemon gira sotto systemd — cioè sempre, dopo `stark up`.
  //
  // `detached: true` stacca dal terminale (`setsid`) ma **non** dal cgroup, che un
  // figlio eredita dal padre. Il daemon vive dentro `stark-<impronta>.service`; appena
  // il suo processo principale esce, systemd ferma l'unità, e fermare un'unità vuol
  // dire uccidere **tutto ciò che resta nel suo cgroup** — compreso il ricambio, che a
  // quel punto sta ancora contando i suoi quindici secondi. È la stessa malattia già
  // documentata per gli scope di logind (`stark.ts`, 27 agosto), in un altro vestito, e
  // vale anche per il riavvio dalle impostazioni, che aveva questo difetto da prima.
  //
  // Misurato, non dedotto: stesso identico giro con il daemon **fuori** da systemd →
  // aggiornamento a termine, versione cambiata, STARK tornato su; con il daemon dentro
  // un'unità → il figlio sparisce senza scrivere una riga di log.
  const daSystemd = conSystemd(script, home, opts.log)
  if (daSystemd) return daSystemd

  try {
    const log = opts.log ? openSync(opts.log, 'a') : 'ignore'
    const figlio = spawn('/bin/sh', ['-c', script], {
      cwd: RADICE,
      detached: true,
      stdio: ['ignore', log as never, log as never],
      // L'ambiente si passa intero: un ricambio che partisse senza `STARK_HOME` o
      // senza `CLAUDE_CONFIG_DIR` guarderebbe le conversazioni sbagliate — è lo stesso
      // motivo per cui `stark.ts` le elenca a mano per systemd.
      env: { ...process.env, STARK_HOME: home },
    })
    figlio.unref()
    return figlio.pid ? { ok: true, pid: figlio.pid } : { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Il ricambio come unità transiente, o `null` se qui systemd non c'è.
 *
 * Il nome porta `ricambio` perché l'unità del daemon (`stark-<impronta>`) in questo
 * istante **è ancora viva**: si sta spegnendo, e riusare il suo nome sarebbe chiedere a
 * systemd di creare un'unità che esiste già. Due nomi, due cicli di vita.
 *
 * `--collect` perché un'unità finita non resti a occupare il proprio nome: senza,
 * il secondo aggiornamento della giornata fallirebbe per colpa del primo.
 */
function conSystemd(script: string, home: string, log?: string): EsitoRiavvio | null {
  if (WIN) return null // systemd non esiste: là si va di `spawn(detached)`
  const impronta = createHash('sha1').update(home).digest('hex').slice(0, 8)
  // Da root il manager di sistema, da utente normale il proprio: stessa regola (e
  // stesso limite del linger) di `avviaConSystemd` in `stark.ts`.
  const utente = process.getuid?.() !== 0
  const r = spawnSync('systemd-run', [
    ...(utente ? ['--user'] : []),
    '--unit', `stark-ricambio-${impronta}`,
    '--description', `STARK — ricambio per ${home}`,
    '--collect', '--quiet',
    ...(log ? [`--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`] : []),
    `--property=WorkingDirectory=${RADICE}`,
    ...ambienteSystemd(home),
    '/bin/sh', '-c', script,
  ], { stdio: 'ignore' })
  return r.status === 0 ? { ok: true } : null
}

/**
 * Le variabili che il ricambio deve portarsi dietro, nella forma di `systemd-run`.
 *
 * Un servizio transiente parte con un ambiente **pulito**: senza `HOME` il registro
 * cercherebbe i journal nel posto sbagliato, senza `CLAUDE_CONFIG_DIR` i processi figli
 * non troverebbero le sessioni da riprendere, e senza `PATH` non si troverebbe nemmeno
 * `git`. È la stessa lista di `stark.ts`, e la ragione per cui sta qui — esportata — è
 * che averne due copie vuol dire che una delle due un giorno perde una variabile, e
 * quella perdita non si vede finché qualcuno non riavvia da dentro la UI.
 */
export function ambienteSystemd(home?: string): string[] {
  const fuori: string[] = []
  // `STARK_PUBLIC_HOST` e `STARK_VAPID_SUBJECT` sono qui per una ragione precisa:
  // dimenticarle non rompe niente in primo piano e **richiude il perimetro in
  // silenzio** dopo un riavvio, con il telefono che si becca un 403 che sembra un
  // problema di token. È già successo con Tailscale, in un'altra forma.
  for (const k of ['STARK_HOME', 'STARK_PORT', 'STARK_MODEL', 'STARK_TOKEN',
    'STARK_PUBLIC_HOST', 'STARK_VAPID_SUBJECT',
    'CLAUDE_CONFIG_DIR', 'PATH', 'HOME']) {
    const v = k === 'STARK_HOME' ? (home ?? process.env[k]) : process.env[k]
    if (v) fuori.push('--setenv', `${k}=${v}`)
  }
  return fuori
}
