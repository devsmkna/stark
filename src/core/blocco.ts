// Aggiungere e togliere un blocco delimitato in un file di testo altrui, senza
// toccare nient'altro. Stessa idea di `memoria.ts`, generalizzata: chi deve tenere
// allineato un file dell'utente — la regola globale delle descrizioni, la presenza
// della board nel contesto di progetto — lavora solo fra due delimitatori che gli
// appartengono, e tutto quello che sta fuori passa attraverso identico.

/** Garantisce che `contenuto` (che inizia e finisce con i suoi delimitatori) stia
 *  nel testo. Se un blocco con lo stesso delimitatore d'inizio c'è già, viene
 *  sostituito per intero — è così che una regola nuova prende il posto di quella
 *  vecchia senza accumulare copie. Altrimenti si aggiunge in fondo, MAI in cima:
 *  quello che l'utente ha scritto viene prima del nostro. */
export function conBlocco(testo: string, inizio: string, fine: string, contenuto: string): string {
  const a = testo.indexOf(inizio)
  if (a >= 0) {
    const b = testo.indexOf(fine)
    // Un blocco senza chiusura (processo morto a metà, mano che ha toccato il file)
    // non autorizza a cancellare il resto: si lascia tutto com'è.
    if (b < 0 || b < a) return testo
    return testo.slice(0, a) + contenuto + testo.slice(b + fine.length)
  }
  if (testo.trim() === '') return `${contenuto}\n`
  return `${testo.replace(/\s*$/, '')}\n\n${contenuto}\n`
}

/** Toglie il blocco delimitato, se c'è. Porta via anche le righe vuote che il blocco
 *  si era portato dietro: accendere e spegnere dieci volte non deve lasciare dieci
 *  buchi. Un blocco senza chiusura non fa cancellare nulla. */
export function senzaBlocco(testo: string, inizio: string, fine: string): string {
  const a = testo.indexOf(inizio)
  const b = testo.indexOf(fine)
  if (a < 0 || b < 0 || b < a) return testo
  const testa = testo.slice(0, a).replace(/\s*$/, '')
  const coda = testo.slice(b + fine.length).replace(/^\s*/, '')
  if (testa === '' && coda === '') return ''
  if (testa === '') return `${coda}\n`.replace(/\n+$/, '\n')
  if (coda === '') return `${testa}\n`
  return `${testa}\n\n${coda}\n`.replace(/\n+$/, '\n')
}
