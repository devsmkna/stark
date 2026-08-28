// Il passaggio di consegne fra due agent.
//
// Perché esiste. In STARK la conversazione **vive dentro il CLI** (ADR-009): il suo
// stato è il transcript di Claude Code o la sessione del server OpenCode, non una
// struttura nostra. Quindi «cambia modello» dentro un agent è un parametro — e infatti
// una chat OpenCode sceglie già fra tutti i suoi modelli — ma **fra** due agent non è un
// parametro: è un'altra conversazione, perché nessuno dei due sa riprendere il
// transcript dell'altro.
//
// Happy Agent risolve lo stesso problema rovesciando l'architettura: possiede lui
// sessioni, tool e permessi, e dei CLI ufficiali usa solo l'inferenza («calls the
// official Claude Agent SDK directly for inference, but disables its built-in tools,
// skills, slash commands, and filesystem settings»). Così il passaggio è gratis, perché
// la sessione non è mai stata dentro Claude Code. Quella strada qui è esclusa: è ciò che
// ci darebbe da riscrivere skill, comandi slash, compattazione, `/clear` e quota.
//
// La via che resta, ed è quella scelta: **un file**. È l'unica cosa che i due agent
// sanno leggere entrambi, non ha bisogno di un protocollo comune, e resta leggibile
// anche da un umano — che è il caso in cui serve di più, quando il passaggio è andato
// male e si vuole capire cosa sapeva chi lasciava.
//
// Questo file è **puro**: niente processi, niente filesystem, niente daemon. Decide i
// nomi e le parole, che sono la parte che si sbaglia davvero e che si prova offline.

import type { SessionSnapshot } from './reduce.ts'

/** La cartella dentro il progetto. Una sola, così è una riga sola da mettere in
 *  `.gitignore` se non li si vuole in git — e chi li vuole, li committa. */
export const CARTELLA = '.stark'

/**
 * Dove va scritto il passaggio di consegne, relativo alla cartella del progetto.
 *
 * Nel progetto e non in `~/.stark`: scelta dell'utente, e ha una ragione buona — il
 * briefing parla di *quel* codice, quindi sta accanto a quel codice, si apre con
 * l'editor che si sta già usando e si può committare se il lavoro passa a una persona
 * invece che a un altro modello.
 *
 * Il minuto nel nome e non i millisecondi: due passaggi nello stesso minuto sono un
 * caso che non esiste, e un nome leggibile vale più di un'unicità che nessuno guarda.
 * `quando` si passa invece di leggere l'orologio qui dentro perché una funzione che
 * dipende dall'ora non si prova.
 */
export function percorsoHandoff(quando: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stampa = `${quando.getFullYear()}-${p(quando.getMonth() + 1)}-${p(quando.getDate())}`
    + `-${p(quando.getHours())}${p(quando.getMinutes())}`
  return `${CARTELLA}/handoff-${stampa}.md`
}

/**
 * Cosa si chiede al modello che lascia.
 *
 * Le voci sono quelle che un umano scriverebbe passando il lavoro, e l'ordine conta:
 * prima l'obiettivo (senza, il resto non si interpreta), poi lo stato, poi le trappole
 * — che sono la sola parte che chi arriva non può ricostruire leggendo il codice.
 *
 * Si chiede esplicitamente di **non** riassumere la conversazione: il valore non è la
 * cronaca di cosa è stato detto, è cosa sapere adesso per continuare. Un riassunto del
 * dialogo lo saprebbe fare anche STARK dal journal, gratis (vedi `briefingDalJournal`);
 * il giudizio su cosa manca e su cosa sta per rompersi, no.
 */
export function promptBriefing(file: string): string {
  return [
    `Stiamo passando questo lavoro a un altro agent, che non ha nessuna memoria di`,
    `questa conversazione. Scrivi il passaggio di consegne nel file \`${file}\``,
    `(crealo, insieme alla cartella se non c'è), in Markdown, con queste sezioni:`,
    ``,
    `- **Obiettivo** — cosa si sta cercando di ottenere, in due righe.`,
    `- **Fatto** — cosa è già stato fatto e verificato, con i file toccati.`,
    `- **Da fare** — cosa manca, nell'ordine in cui conviene farlo.`,
    `- **Come si verifica** — i comandi da lanciare per sapere se funziona.`,
    `- **Trappole** — quello che ti ha sorpreso, le piste sbagliate già escluse, e`,
    `  le decisioni prese con la ragione per cui sono state prese.`,
    ``,
    `Scrivi per qualcuno che apre il progetto adesso e non ha visto niente: nomina i`,
    `file per intero e non dire "come sopra". Non riassumere la conversazione — serve`,
    `cosa sapere per continuare, non la cronaca di cosa ci siamo detti.`,
    `Quando hai scritto il file, rispondi solo con: PRONTO`,
  ].join('\n')
}

/**
 * Il primo prompt della chat nuova.
 *
 * Il file si **cita** con `@` invece di dire «leggi quel file»: la citazione la espande
 * il CLI da sé, quindi il contenuto entra nel contesto senza spendere una chiamata a
 * `Read` — misurato quando è stato aggiunto `@` alla casella di scrittura.
 *
 * Non gli si dice di mettersi subito a lavorare. Chi arriva deve prima dire cosa ha
 * capito, se no il primo turno di una conversazione nuova è già un'azione presa su un
 * contesto che nessuno ha ancora verificato — ed è il momento in cui un passaggio di
 * consegne andato storto fa il danno.
 */
export function promptRipresa(file: string, agentPrecedente?: string): string {
  const da = agentPrecedente ? ` da ${agentPrecedente}` : ''
  return [
    `Riprendi un lavoro cominciato${da} in un'altra sessione. Il passaggio di consegne`,
    `è in @${file} — leggilo.`,
    ``,
    `Prima di toccare qualcosa: dimmi in poche righe cosa hai capito che c'è da fare e`,
    `qual è il primo passo. Se qualcosa nel documento non torna con quello che vedi nel`,
    `progetto, dillo invece di aggirarlo: il file l'ha scritto un altro modello e può`,
    `essersi sbagliato.`,
  ].join('\n')
}

/**
 * Il passaggio di consegne composto da STARK, senza spendere un turno.
 *
 * È la seconda via, per quando la chat che lascia è addormentata o ferma e non la si
 * vuole svegliare. Dice **meno**, e va detto invece che lasciarlo scoprire: qui c'è la
 * cronaca — cosa è stato chiesto, quali file sono stati toccati, cosa ha risposto per
 * ultimo — mentre «cosa manca» e «attenzione a questo» sono giudizi, e un giudizio non
 * si ricava da un journal. Per questo il documento lo dichiara in cima a chi lo legge:
 * un briefing che sembra completo e non lo è è peggio di uno che dichiara i propri
 * limiti.
 */
export function briefingDalJournal(snap: SessionSnapshot, quando: Date): string {
  const primo = snap.turns[0]?.prompt.find(p => p.type === 'text')?.text?.trim()
  // L'ultima risposta a parole è il recap, cioè la cosa più vicina a «a che punto
  // siamo» che il journal contenga. Si cerca dal fondo perché i turni finali possono
  // essere interrotti e non avere testo.
  let recap = ''
  for (let i = snap.turns.length - 1; i >= 0 && !recap; i--) {
    const parti = snap.turns[i]?.parts ?? []
    for (let j = parti.length - 1; j >= 0; j--) {
      const p = parti[j]
      // `typeof` e non solo `kind`: il riduttore copia il testo finale dall'evento
      // così com'è (`part.text = p.text`), quindi un journal scritto da un adapter con
      // un difetto può avere una parte `text` senza testo. Il tipo dice `string`, i
      // fatti no — e qui costa una parola non crederci.
      if (p?.kind === 'text' && typeof p.text === 'string' && p.text.trim()) {
        recap = p.text.trim(); break
      }
    }
  }
  // Un file toccato dieci volte è **un** file da guardare, non dieci righe di rumore.
  const file = [...new Set(snap.files.map(f => f.path))]
  const comandi = [...new Set(snap.shell.map(c => c.command))].slice(-12)

  const r: string[] = [
    `# Passaggio di consegne`,
    ``,
    `> Questo documento l'ha composto **STARK dal journal**, non il modello che stava`,
    `> lavorando. Contiene quindi *cosa è successo*, non *cosa manca*: quel giudizio non`,
    `> c'è, e va ricostruito leggendo il progetto.`,
    ``,
    `- Scritto: ${quando.toISOString()}`,
    `- Cartella: \`${snap.cwd ?? '?'}\``,
    `- Veniva da: ${snap.agent ?? '?'} · ${snap.model ?? '?'}`,
    `- Turni: ${snap.turns.length}`,
    ``,
  ]
  if (primo) r.push(`## Cosa era stato chiesto`, ``, primo, ``)
  if (snap.todos.length) {
    r.push(`## Checklist dell'agent`, ``)
    for (const t of snap.todos) r.push(`- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`)
    r.push(``)
  }
  if (file.length) {
    r.push(`## File toccati`, ``)
    for (const f of file) r.push(`- \`${f}\``)
    r.push(``)
  }
  if (comandi.length) {
    r.push(`## Ultimi comandi eseguiti`, ``, '```')
    for (const c of comandi) r.push(c)
    r.push('```', ``)
  }
  if (recap) r.push(`## L'ultima cosa che aveva detto`, ``, recap, ``)
  return r.join('\n')
}
