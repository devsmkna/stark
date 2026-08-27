// Quando la quota ferma davvero.
//
// Sta in `core/` e non dentro la barra laterale per una ragione sola: è una regola con
// un caso al bordo che si sbaglia leggendo il codice e non guardando lo schermo — un
// limite **già ripartito** letto da un journal vecchio. Qui si prova da sola, senza
// dover mettere in scena una quota esaurita in un browser.
//
// Non è vocabolario di Claude Code: `status` e `resetsAt` sono già canonici (§10,
// `quota.updated`), quindi questa funzione varrà identica per il secondo adapter.

/** Quel tanto di `quota.updated` che serve a decidere. */
export type QuotaStato = {
  status: string
  resetsAt: number
}

/**
 * Questa quota impedisce di lavorare **adesso**?
 *
 * Tre condizioni, e ognuna esclude un modo di mentire:
 *
 * 1. `rejected` e non `allowed_warning`. «Ci sei quasi» ha già il suo posto nel
 *    pannellino della barra di stato, insieme a quanto ne resta. Un allarme che
 *    compare anche quando si può ancora lavorare diventa arredamento, e si smette di
 *    guardarlo proprio prima della volta in cui contava.
 * 2. Il reset **non è già passato**. Le chat fermate dalla quota sono quelle senza più
 *    un processo, quindi su di loro non arriva più nessun evento: senza questo
 *    controllo l'avviso resterebbe lì per ore dopo che il limite è ripartito, e
 *    l'unico modo di toglierlo sarebbe ricaricare la pagina.
 * 3. `resetsAt` a zero vuol dire «non lo so», non «è passato». In quel caso si crede
 *    allo stato: meglio un avviso che resta un po' troppo di uno che sparisce mentre
 *    il limite morde ancora.
 */
export function quotaFerma(q: QuotaStato | undefined, adesso: number): boolean {
  if (q?.status !== 'rejected') return false
  if (!q.resetsAt) return true
  return q.resetsAt > adesso
}

/**
 * Quando si torna a lavorare: il reset **più lontano** fra quelli che ci stanno
 * fermando, non il più vicino.
 *
 * Se la finestra da cinque ore e quella settimanale sono finite insieme, ripartire
 * dalla prima non serve a niente — si ricadrebbe subito nella seconda. Dire l'ora più
 * vicina sarebbe una promessa che non si mantiene, ed è il tipo di bugia che il
 * Principio 5 vieta: meglio nessuna ora che un'ora sbagliata.
 *
 * Zero: nessuno di quelli che ci fermano sa dire quando riparte.
 */
export function quandoRiparte(quote: (QuotaStato | undefined)[], adesso: number): number {
  const veri = quote.filter(q => quotaFerma(q, adesso)).map(q => q!.resetsAt)
  return veri.length > 0 ? Math.max(...veri) : 0
}
