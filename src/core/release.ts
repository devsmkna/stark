// Qual è l'ultima versione **rilasciata**, e se quella installata è indietro.
//
// La domanda a cui risponde questo file è una sola e non riguarda la rete: date delle
// stringhe che qualcuno ha messo come tag, qual è la più recente, e la versione che ho
// su disco è più vecchia? Chi va a chiederlo in giro — un giro HTTP a
// `releases/latest/version.txt` — sta in `daemon/aggiornamenti.ts`; qui c'è solo la
// regola pura, e infatti si prova con `node` puro dentro `npm run check` — come già
// fanno `layout.ts` per i pannelli e `gruppi.ts` per i turni.
//
// **Questo file non importa niente.** Resta una proprietà voluta anche senza il motivo
// per cui è nata (girare prima di `npm install`, quando l'installer clonava un repo:
// oggi scarica un bundle già pronto, e non chiama più questo file): una regola pura e
// senza dipendenze si prova più in fretta, e nessuno la rompe per sbaglio con un import.
//
// ── Perché un tag resta la release ──────────────────────────────────────────────
// `docs/rilascio.md` lo spiega per esteso: un tag `vX.Y.Z` è ciò che la CI legge per
// decidere quando pubblicare, non un numero scritto a mano da qualche parte. Il file
// `version.txt` che `daemon/aggiornamenti.ts` legge contiene esattamente quel tag —
// questo file non sa, e non deve sapere, come ci si arriva.

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
