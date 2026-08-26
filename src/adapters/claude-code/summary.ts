// «Su cosa» ha lavorato un tool, ricavato dal suo input — e, dove c'è, «perché».
//
// Questo file esiste per togliere una bugia dalla UI. Finora era `Conversation.svelte`
// a frugare dentro `input` cercando `command`, `file_path`, `path`: cioè a conoscere la
// forma di Claude Code fuori dall'adapter, che è precisamente ciò che il §1 vieta. La
// conoscenza non è sparita — non poteva — ma è tornata dalla parte giusta del confine,
// dove sta tutto il resto di ciò che riguarda un agent solo.
//
// Fuori di qui viaggiano due stringhe già pronte: `summarize()` in
// `tool.input.ended.summary` (il soggetto — *cosa*), `intentOf()` in `.intent` (la
// motivazione — *perché*). Sono la stessa idea del riassunto, un passo più in là:
// prima STARK mostrava solo `grep -rn "summary" src/adapters/`, e chi guardava doveva
// dedurre da solo cosa si stesse cercando. F2 (Notion, 25 agosto 2026).

/** I campi in cui, in quest'ordine, vive il soggetto dell'azione. */
const KEYS = ['command', 'file_path', 'path', 'notebook_path', 'pattern', 'url', 'query', 'prompt']

/**
 * Una riga sola, senza a capo, tagliata dove smette di essere leggibile.
 * `undefined` e non stringa vuota quando non c'è niente da dire: la UI deve poter
 * distinguere «nessun soggetto» da «soggetto vuoto» e non mostrare una riga muta.
 */
export function summarize(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const o = input as Record<string, unknown>

  // Una domanda all'utente non ha un soggetto: il soggetto È la domanda. Senza
  // questo caso la riga nel flusso mostrerebbe il JSON grezzo delle opzioni, che è
  // materiale di lavorazione e non dice niente a chi legge.
  if (tool === 'AskUserQuestion') {
    const qs = o['questions']
    if (Array.isArray(qs)) {
      const testi = qs
        .map(q => str((q as Record<string, unknown>)?.['question']))
        .filter((x): x is string => !!x)
      if (testi.length > 0) return cut(testi.join(' · '))
    }
    return undefined
  }

  // Un sotto-agent non lavora su un file: lavora su un incarico, e il campo che lo
  // dice è la descrizione, non il prompt intero.
  if (tool === 'Task' || tool === 'Agent') {
    const d = str(o['description']) ?? str(o['prompt'])
    return d ? cut(d) : undefined
  }
  for (const k of KEYS) {
    const v = str(o[k])
    if (v) return cut(v)
  }
  return undefined
}

/**
 * Tool per cui `description` non è un'intenzione da mostrare a parte: o è già IL
 * soggetto (`Task`/`Agent` — vedi sopra, `summarize()` la usa già lì, ripeterla come
 * intento direbbe due volte la stessa cosa), o il campo stesso dichiara di essere
 * ignorato (`Workflow`: «Ignored — set the workflow description in the script's meta
 * block», dai tipi ufficiali dell'SDK — mostrarlo sarebbe mostrare rumore come se
 * fosse un motivo).
 */
const SENZA_INTENTO = new Set(['Task', 'Agent', 'Workflow'])

/**
 * *Perché* è stato lanciato questo tool, quando l'agent l'ha scritto. Non è dedotto
 * né generato da STARK — costerebbe quota, e su ogni tool di ogni turno (F2, «Non
 * generarla noi con un modello»): è testo che l'agent scrive già da sé in un campo
 * `description`, e prima veniva buttato via.
 *
 * Verificato su una cattura vera prima di scriverlo (265 chiamate `Bash` reali,
 * 26 agosto 2026), non dedotto dallo schema soltanto: il campo arriva, sempre.
 * `Bash` è il caso che conta — è dove il soggetto (`command`) è più criptico — ma la
 * regola non è ristretta a lui: qualunque tool, compreso un domani un server MCP, che
 * scriva un `description` proprio lo mostra, senza bisogno di una riga di codice in
 * più qui. È lo stesso principio di `KEYS` sopra, letto al contrario: non si elenca
 * cosa cercare, si elenca cosa NON contare due volte.
 */
export function intentOf(tool: string, input: unknown): string | undefined {
  if (SENZA_INTENTO.has(tool)) return undefined
  if (!input || typeof input !== 'object') return undefined
  const d = str((input as Record<string, unknown>)['description'])
  return d ? cut(d) : undefined
}

/**
 * Le risorse che la richiesta di permesso nomina. È lo stesso mestiere del riassunto,
 * ma per il §8: lì serve una lista, perché il blocco in basso deve poter dire *cosa
 * esattamente* verrebbe toccato prima che si prema Allow.
 */
export function resourcesOf(tool: string, input: Record<string, unknown>): string[] {
  if (tool === 'Bash' && typeof input['command'] === 'string') return [input['command']]
  if (typeof input['file_path'] === 'string') return [input['file_path']]
  if (typeof input['path'] === 'string') return [input['path']]
  const s = summarize(tool, input)
  return s ? [s] : []
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function cut(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > 160 ? `${oneLine.slice(0, 159)}…` : oneLine
}
