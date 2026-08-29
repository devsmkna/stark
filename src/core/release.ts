// Qual è l'ultima versione **rilasciata**, e se quella installata è indietro.
//
// La domanda a cui risponde questo file è una sola e non riguarda git: date delle
// stringhe che qualcuno ha messo come tag, qual è la più recente, e la versione che ho
// su disco è più vecchia? Le chiamate a `git` stanno in `daemon/aggiornamenti.ts`, i
// bottoni nella UI: qui c'è solo la regola, e infatti si prova con `node` puro dentro
// `npm run check` — come già fanno `layout.ts` per i pannelli e `gruppi.ts` per i turni.
//
// **Questo file non importa niente.** Non è una coincidenza da non rompere: `install.sh`
// lo esegue **prima** di `npm install`, cioè su una cartella dove `node_modules` non
// esiste ancora, per sapere su quale release mettere il clone appena fatto. Un import
// di un pacchetto qui dentro romperebbe l'installazione, e lo farebbe solo sulla
// macchina di chi installa per la prima volta — cioè dove non lo vedremmo mai.
//
// ── Perché i tag e non le Release di GitHub ────────────────────────────────────
// Le Release di GitHub sono la cosa «ufficiale», e la regola del progetto dice di
// preferire ciò che è ufficiale e già pronto. Qui però il confronto è fra due cose
// ufficiali, non fra una ufficiale e una fatta in casa: i tag sono di **git**, e sono
// il meccanismo che le Release di GitHub usano sotto. Sceglierli costa meno e regge di
// più, per tre ragioni misurabili:
//   1. `git ls-remote --tags` è **un giro di rete e zero oggetti scaricati**, e passa
//      dalle credenziali git che la macchina ha già. L'API di GitHub, su un repo
//      privato, vorrebbe un token in più da distribuire a ogni collega.
//   2. non lega STARK a GitHub: chi domani sposta il repo altrove non deve riscrivere
//      niente.
//   3. il clone è già lì. Chiedere a `git` una cosa che `git` sa è la strada corta.
// Restano vere le Release come *vetrina* (note di rilascio, allegati): se un giorno
// servissero, si aggiungono **sopra** i tag senza toccare questa regola.

/** Una versione rilasciata: il tag così com'è sul remoto, e i suoi numeri. */
export type Release = {
  /** `v1.4.0` — il nome esatto del ref, che è quello che poi si passa a `git`. */
  tag: string
  /** `1.4.0` — senza la `v`, che è la forma in cui sta dentro `package.json`. */
  versione: string
  numeri: number[]
}

/**
 * I numeri di un tag di release, o `null` se quel tag non è una release.
 *
 * Due esclusioni volute. Una **pre-release** (`v1.4.0-rc.1`) non è l'ultima versione:
 * è una versione che si va a cercare, e offrirla in un banner vorrebbe dire spingere
 * su un collega una cosa che non è ancora stata dichiarata pronta. E un tag che non ha
 * questa forma — `backup-prima-riscrittura`, che in questo repo esiste davvero — non
 * è una versione affatto: ignorarlo è l'unica risposta giusta, e l'alternativa
 * (leggerlo come `0.0.0`) lo farebbe *vincere* su niente.
 *
 * La `v` iniziale è facoltativa in ingresso perché è una convenzione, non un fatto:
 * `npm version` la mette, qualcuno la omette, e rifiutare `1.4.0` vorrebbe dire non
 * accorgersi di una release per un carattere.
 */
export function numeriDiTag(tag: string): number[] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(tag.trim())
  if (!m) return null
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

/** `<0`, `0`, `>0` come vuole `sort`. */
export function confronta(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * L'output di `git ls-remote --tags <remoto>` ridotto ai nomi dei tag.
 *
 * Il pezzo che non si indovina è `^{}`: un tag **annotato** compare due volte, una col
 * proprio oggetto e una — con quel suffisso — col commit a cui punta. Senza toglierlo
 * ci si ritroverebbe `v1.4.0` e `v1.4.0^{}` come se fossero due release, e la seconda
 * non sarebbe nemmeno un nome che `git checkout` accetta. È il motivo per cui questa
 * funzione esiste invece di uno `split` sul posto: è una stortura del formato, e va
 * scritta una volta sola in un punto dove si può provare.
 */
export function tagDaLsRemote(out: string): string[] {
  const visti = new Set<string>()
  for (const riga of out.split('\n')) {
    const m = /\trefs\/tags\/(.+?)(\^\{\})?$/.exec(riga.trimEnd())
    if (m?.[1]) visti.add(m[1])
  }
  return [...visti]
}

/** La release più alta fra questi tag, o `null` se nessuno di loro è una release. */
export function ultimaRelease(tags: string[]): Release | null {
  let vinta: Release | null = null
  for (const tag of tags) {
    const numeri = numeriDiTag(tag)
    if (!numeri) continue
    if (!vinta || confronta(numeri, vinta.numeri) > 0) {
      vinta = { tag, versione: numeri.join('.'), numeri }
    }
  }
  return vinta
}

/**
 * C'è da aggiornare?
 *
 * `installata` è la `version` di `package.json`, e il confronto è **solo** con quella:
 * non con l'ultimo commit, non con `origin/main`. È la richiesta stessa — un push su
 * main non deve chiamare nessuno — e ha un effetto secondario che vale quanto il
 * primo: su una copia di sviluppo, dove `package.json` porta già la versione dell'
 * ultima release e i commit in più non l'hanno alzata, il banner **non compare**. Chi
 * lavora al progetto non viene invitato a buttare via il proprio ramo.
 *
 * Perché regga, il numero va alzato **nel commit che porta il tag** e mai prima:
 * `npm version <x>` fa esattamente questo, in un colpo solo. Se un giorno si prendesse
 * l'abitudine di alzarlo subito dopo una release, questa funzione comincerebbe a dire
 * «sei avanti» a tutti — vedi `docs/rilascio.md`.
 */
export function daAggiornare(installata: string, ultima: Release | null): boolean {
  if (!ultima) return false
  const mia = numeriDiTag(installata)
  // Una versione locale illeggibile non è «sono indietro»: è «non lo so», e nel dubbio
  // non si manda nessuno a fare un aggiornamento che potrebbe non servire.
  if (!mia) return false
  return confronta(ultima.numeri, mia) > 0
}
