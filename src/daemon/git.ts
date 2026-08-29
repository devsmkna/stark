// Su quale ramo sta la cartella di una chat.
//
// Non è un fatto dell'agent, quindi non passa dal modello canonico e non ha un evento:
// è una domanda sul **filesystem**, come `browse` e `reveal`, e la risposta la sa il
// daemon senza chiedere niente a nessuno. Metterla nel journal vorrebbe dire scrivere
// per sempre un dato che cambia da sé — chi fa `git checkout` in un terminale accanto
// non manda nessun evento a STARK.
//
// `execFile`, non `exec`: gli argomenti viaggiano come array, mai come stringa di
// shell, quindi una cartella con spazi o caratteri strani è un argomento, non
// un'iniezione. Stessa regola di `reveal.ts`.
//
// Perché `git` e non leggere `.git/HEAD` a mano, che sarebbe più veloce: la cartella di
// una chat può essere **una sottocartella** del repo (e allora `.git` lì non c'è, e
// bisognerebbe risalire), può essere un worktree o un submodulo (e allora `.git` è un
// **file** che punta altrove), e il ramo di un repo appena inizializzato non ha ancora
// un commit. Sono quattro casi che `git` conosce già: rifarli qui vorrebbe dire
// riscrivere una cosa ufficiale che cambia, cioè esattamente ciò che ADR-009 evita.

import { isDir } from './registry.ts'
import { esegui } from '../core/platform.ts'


export type GitInfo = {
  /** Falso anche quando `git` non è installato: da fuori è lo stesso fatto — non c'è
   *  un ramo da mostrare — e distinguerli darebbe alla barra un errore da spiegare. */
  repo: boolean
  /** Il nome del ramo, o la sigla del commit quando la testa è staccata. */
  branch?: string
  detached?: boolean
}

const NO: GitInfo = { repo: false }

/**
 * Il ramo di `cwd`. Non lancia mai: un repo che non c'è non è un guasto di STARK, e la
 * barra di stato non deve avere un modo di rompersi per una cartella qualunque.
 *
 * Un colpo solo nel caso normale. `symbolic-ref` e non `rev-parse --abbrev-ref` perché
 * risponde anche su un repo **appena inizializzato**, dove il ramo esiste ma non c'è
 * ancora nessun commit a cui puntare — `rev-parse` lì fallisce e direbbe «non è un
 * repo», che è falso.
 */
export async function ramoDi(cwd: string): Promise<GitInfo> {
  if (!isDir(cwd)) return NO
  const git = (args: string[]): Promise<string> =>
    esegui('git', ['-C', cwd, ...args], { timeout: 2000 }).then(r => r.stdout.trim())
  try {
    return { repo: true, branch: await git(['symbolic-ref', '--quiet', '--short', 'HEAD']) }
  } catch { /* testa staccata, oppure non è un repo: le distingue il colpo dopo */ }
  try {
    // Una testa staccata **ha** per forza un commit sotto, quindi qui si fallisce solo
    // se non è un repo per davvero: non serve un terzo controllo per dirlo.
    return { repo: true, detached: true, branch: await git(['rev-parse', '--short', 'HEAD']) }
  } catch { return NO }
}
