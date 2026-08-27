// Il vocabolario canonico di STARK. Vedi docs/event-model.md.
//
// Regola non negoziabile (§1 della specifica): fuori dall'adapter nessun componente
// deve conoscere l'esistenza di Claude Code. Qui dentro non entrano nomi dell'API
// Anthropic: si parla di sessioni, turni, parti, permessi ed effetti.

export const MODEL_VERSION = 1 as const

// ─── §5 stati della sessione ────────────────────────────────────────────────

export type SessionState =
  | 'starting'   // processo avviato, initialize non ancora ricevuto
  | 'idle'       // pronta, nessun turno in corso
  | 'busy'       // turno in corso
  | 'awaiting'   // ferma su una richiesta bloccante (permesso o domanda)
  | 'sleeping'   // processo terminato di proposito, journal su disco — ADR-005
  | 'error'
  | 'closed'

/**
 * La modalità dei permessi, **come la chiama l'agent**.
 *
 * Era un'enumerazione chiusa delle sei modalità di Claude Code, dentro il modello
 * canonico: la quinta falla del confine del §1, e l'unica che stava qui invece che nel
 * daemon. La prova di carico l'ha resa impossibile da ignorare — OpenCode non ha
 * modalità, ha **agenti** (`build`, `plan`), ciascuno col proprio modello e il proprio
 * ruleset. Non è la stessa cosa con un altro nome: è un concetto diverso che occupa lo
 * stesso posto nella barra di stato.
 *
 * Adesso è una stringa opaca, e **chi la può usare lo dichiara l'agent** (`options`
 * in `session.created`). Fuori dall'adapter nessuno deve conoscere questi valori — se
 * un componente ne confronta uno per nome, quello è il difetto da registrare. ADR-014.
 */
export type PermissionMode = string

// ─── tipi di supporto ───────────────────────────────────────────────────────

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * `nominalUsd` si chiama così di proposito. L'utente è su abbonamento a quota
 * fissa: quel numero è un prezzo di listino API, non una spesa. Chiamarlo `usd`
 * inviterebbe la UI a mostrarlo come denaro, che sarebbe una bugia (Principio 3).
 * La risorsa scarsa la racconta `quota.updated`.
 */
export type Cost = { nominalUsd: number }

/**
 * Una finestra di quota del piano, come la racconta il piano stesso.
 *
 * `quota.updated` dice **se stai passando** e quando la finestra che ti sta stretta si
 * riapre; questa dice **quanto ne hai consumata**, per ciascuna finestra insieme. Sono
 * due domande diverse e servono tutte e due: la prima è un semaforo, la seconda è il
 * livello del serbatoio — ed è quella che si guarda per decidere se cominciare adesso
 * un lavoro lungo.
 *
 * `kind` è canonico, non il nome del fornitore: `five_hour` e `seven_day` sono
 * vocabolario di Claude Code e restano nell'adapter (§1). `scope` è il modello a cui
 * la finestra è ristretta, quando lo è — il piano ne manda una per modello oltre a
 * quella generale, e sono numeri diversi.
 *
 * `used` e `resetsAt` sono **opzionali sul serio**: il piano li manda a `null` quando
 * non li sa, e mostrare uno zero al posto di «non lo so» sarebbe la solita bugia
 * comoda (Principio 3).
 */
export type QuotaWindow = {
  kind: 'session' | 'weekly'
  /** Il modello a cui questa finestra è ristretta. Assente = vale per tutto. */
  scope?: string
  /** Percentuale consumata, 0-100. */
  used?: number
  /** Epoch **ms**, come ogni altro istante del modello canonico. */
  resetsAt?: number
}

/**
 * Quanto è pieno il contesto **adesso**, secondo Claude Code stesso — non una
 * percentuale che STARK calcola sommando token di API e dividendo per una finestra
 * indovinata dal nome del modello.
 *
 * Bug trovato il 26 agosto 2026: quel calcolo indovinato usava 200K come finestra per
 * un modello che ne aveva un milione, perché il nome arrivava con un suffisso
 * (`claude-opus-5[1m]`) che il confronto testuale non riconosceva — un contesto vero
 * al 21% appariva 105%, tagliato al 100% mostrato. La correzione non è stata
 * aggiustare la formula: è smettere di indovinare. `getContextUsage()` dell'SDK è la
 * stessa domanda a cui risponde `/context` nel terminale, e la risposta porta già
 * `percentage` calcolato — STARK la riporta, non la ricalcola.
 *
 * `categories` è la stessa scomposizione che l'SDK dà (system prompt, tool, MCP,
 * messaggi, memoria, riserva di auto-compattazione, spazio libero…): non sono
 * `input`/`output`/`cache*`, che raccontano una fattura, non uno spazio. Elenco
 * aperto — un nome nuovo che l'SDK aggiunge un domani si mostra lo stesso, la UI non
 * deve conoscerli tutti in anticipo.
 */
export type ContextUsage = {
  totalTokens: number
  maxTokens: number
  /** 0-100, già arrotondata da chi la manda: non si ricalcola una seconda volta. */
  percentage: number
  categories: { name: string; tokens: number }[]
}

/**
 * Un comando slash offerto dalla sessione.
 *
 * `argumentHint` è ciò che va scritto dopo il nome (`<file>`, `[low|high]`), e senza
 * di quello metà dei comandi sono indovinelli. `terminalOnly` marca quelli la cui UX
 * è legata al terminale: **non si nascondono** — si mostrano con scritto perché,
 * come ogni altra cosa che il CLI consente e qui non ha senso (Principio 5).
 */
export type SlashCommand = {
  name: string
  description?: string
  argumentHint?: string
  /** Altri nomi che portano allo stesso comando: `/cost` e `/stats` → `/usage`. */
  aliases?: string[]
  terminalOnly?: boolean
}

/**
 * Un modello fra cui la sessione puo scegliere. `id` e cio che si rimanda indietro
 * con `session.setModel`, `resolved` il modello vero a cui un alias punta.
 *
 * Sta nel vocabolario canonico e non in una lista dentro la UI per la ragione del §1:
 * i nomi dei modelli sono vocabolario dell'agent, e la UI non deve conoscerli. Lo
 * stesso vale per `autoMode`, che dipende dal modello e non dall'agent: senza, la UI
 * dovrebbe sapere da se che Haiku non regge auto mode, cioe indovinare.
 */
export type ModelChoice = {
  id: string
  label?: string
  resolved?: string
  autoMode: boolean
  /** In token. Stesso motivo di `autoMode`: dipende dal modello, non dall'agent, e
   *  saperlo fuori dall'adapter vorrebbe dire indovinare la finestra di contesto. */
  contextWindow: number
}

/**
 * Una modalita dei permessi, e se questa sessione puo davvero usarla.
 *
 * `available: false` non e un motivo per nascondere la voce: il Principio 5 vuole che
 * si veda spenta CON la spiegazione. La spiegazione la scrive l'adapter, che e l'unico
 * che sa chi rifiuta e perche.
 *
 * `label` esiste da ADR-014: finche' le modalita' erano sei parole note, la UI poteva
 * saperle a memoria. Ora l'agent le dichiara, e deve poter dire **come si chiamano** —
 * «build» e «plan» non sono nomi che una GUI possa indovinare.
 */
export type ModeChoice = {
  mode: PermissionMode
  label?: string
  available: boolean
  reason?: string
}

// ─── §11-bis le opzioni di sessione (ADR-014) ───────────────────────────────

/**
 * Una scelta dentro un selettore, e se si puo' davvero fare.
 *
 * `note` non e' `reason`: `reason` dice **perche' non si puo'**, `note` e' un avviso su
 * una scelta che si puo' fare lo stesso. Tenerli distinti evita la riga che oggi
 * compare su tutti i 61 modelli di OpenCode — «no auto mode» — dove l'auto mode non
 * esiste nemmeno come concetto.
 */
export type OptionChoice = {
  value: string
  label?: string
  available: boolean
  reason?: string
  note?: string
}

/**
 * Un selettore che l'agent dichiara e la barra di stato disegna **senza conoscerlo**.
 *
 * E' la forma generale di cio' che oggi sono `models` e `modes`: due casi particolari
 * cablati nella UI. Un agent nuovo popola la barra senza una riga di codice nel
 * browser, e diventano esprimibili scelte che oggi non hanno posto — il livello di
 * ragionamento, la variante di un modello, quale agent e' attivo.
 *
 * `kind` serve **solo alla presentazione** (quale icona, quanto e' importante): non e'
 * un elenco chiuso di cose che la UI deve saper trattare, ed e' la differenza fra
 * «disegna cio' che ti dicono» e «conosci le sei parole».
 */
export type SessionOption = {
  id: string
  label: string
  value: string
  choices: OptionChoice[]
  kind?: 'mode' | 'model' | 'other'
}

/**
 * Un server MCP visto da una sessione, e cosa STARK ne ha deciso.
 *
 * Due campi e non uno perche dicono due cose diverse: `enabled` e la scelta di STARK
 * per questa chat, `status` e cosa risponde l'agent. Un server acceso puo essere
 * `needs-auth` o `failed`, e schiacciare le due cose in una sola nasconderebbe
 * esattamente il caso in cui l'utente si chiede perche non funziona.
 *
 * `status` e vocabolario dell'adapter solo all'apparenza: sono i cinque stati che il
 * protocollo dichiara, e la UI li mostra senza interpretarli.
 */
export type McpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  /** L'ha acceso STARK per questa conversazione. Di partenza sono tutti spenti. */
  enabled: boolean
  /** Perche non va, quando `status` e `failed`. */
  error?: string
}

/**
 * Una domanda dell'agent, nella forma documentata di `AskUserQuestion`.
 * Da 1 a 4 domande per richiesta, da 2 a 4 opzioni ciascuna, `header` max 12 caratteri.
 */
export type AgentQuestion = {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string; preview?: string }[]
}

/** §16.3 resta aperto: nell'MVP il prompt è testo semplice. */
/**
 * Un pezzo di ciò che hai mandato. §16.3 era aperto proprio qui: nell'MVP il prompt era
 * solo testo, e uno schermo da far vedere all'agent non aveva strada per arrivarci.
 *
 * L'immagine nel journal viaggia **per riferimento**, non per contenuto: `ref` è lo
 * sha256 dei byte, che stanno in un file accanto ai journal. Metterci dentro il base64
 * gonfierebbe di un megabyte a colpo un file che si rilegge tutto a ogni risveglio, e
 * il §4 continua a valere lo stesso — la rilettura ritrova il riferimento e il file c'è.
 */
export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; ref: string; mediaType: string; bytes: number; name?: string }

/**
 * Cosa la UI allega a un prompt. Qui i byte ci sono davvero, perché è il viaggio
 * dal browser al daemon: è il daemon a scriverli su disco e a sostituirli con un `ref`.
 *
 * I quattro tipi sono quelli che il modello accetta. Un file di testo non sta qui:
 * si incolla, o si nomina per percorso — l'agent sa leggerlo da solo, ed è il motivo
 * per cui non serve spedirglielo.
 */
export type Attachment = {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  /** base64, senza il prefisso `data:`. */
  data: string
  name?: string
}

/** §9: esattamente la forma di `structuredPatch`. Nessun diff da calcolare. */
export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// ─── §12 capability ─────────────────────────────────────────────────────────

export type Capabilities = {
  interrupt: boolean
  switchModel: boolean
  switchMode: boolean
  /** Dipende dal MODELLO, non solo dall'agent: Haiku non regge auto mode. */
  autoMode: boolean
  permissionAlways: boolean
  questions: boolean
  revert: boolean
  toolProgress: boolean
  fileBrowser: boolean
  pty: boolean
}

// ─── §6-§10 il payload ──────────────────────────────────────────────────────

export type Payload =
  // §6 sessione
  | { k: 'session.created'; agent: string; cwd: string; model: string
      capabilities: Capabilities; tools: string[]; commands: SlashCommand[]
      // Cosa si puo scegliere dalla barra di stato, senza che la UI debba saperlo.
      // `models`/`modes` sono i due casi particolari nati con Claude Code; `options`
      // e' la forma generale che li supera (ADR-014). Restano tutti e tre perche' un
      // journal scritto prima ha solo i primi due, e il §4 vuole che si possa
      // ricostruire com'era — non che si riscriva la storia.
      models?: ModelChoice[]; modes?: ModeChoice[]; options?: SessionOption[]
      // I comportamenti di protocollo che questa versione implementa. È documentato
      // usare questi nomi per la feature detection invece di confrontare versioni.
      protocolCapabilities?: string[] }
  | { k: 'session.state'; state: SessionState; reason?: string }
  /**
   * Una scelta dichiarata dall'agent e' cambiata (ADR-014).
   *
   * Sostituisce `session.model` e `session.mode`, che restano **leggibili** perche' i
   * journal gia' scritti ne sono pieni, ma che nessun adapter emette piu'. Un solo
   * modo per andare avanti, piu' un lettore per la storia: e' la stessa regola con cui
   * il §13 tratta un file append-only.
   *
   * Due `id` sono **convenzione**, non vocabolario di un agent: `'mode'` e `'model'`.
   * Servono perche' l'elenco delle chat e le notifiche vogliono sapere quei due valori
   * senza aprire una conversazione. Un agent che non ha modalita' semplicemente non
   * dichiara `'mode'`.
   */
  | { k: 'session.option'; id: string; value: string }
  | { k: 'session.model'; model: string }
  | { k: 'session.mode'; mode: PermissionMode }
  // La lista dei tool non è nota alla nascita della sessione: arriva col primo turno.
  // Vedi la correzione al §14 in fondo a docs/event-model.md.
  | { k: 'session.tools'; tools: string[] }
  // Quali server MCP questa conversazione ha davanti, e quali sono accesi. Nel journal
  // perche il §4 vuole che la UI non mostri niente che non nasca da li, e perche il
  // risveglio deve poter riaccendere quello che avevi acceso: senza, una chat che
  // dorme si sveglia senza i suoi strumenti e sembra rotta.
  | { k: 'session.mcp'; servers: McpServer[] }
  // I comandi slash arrivano con l'handshake, ma la lista **cambia in corsa**: l'agent
  // scopre skill nuove lavorando in una sottocartella. È un rimpiazzo, non un'aggiunta.
  | { k: 'session.commands'; commands: SlashCommand[] }
  // Il manico con cui questa sessione si riapre. Sta nel journal perche senza, il
  // journal non basta a risvegliare: saprebbe dire cosa e successo ma non come tornarci.
  | { k: 'session.resumeRef'; ref: string }
  /** Il titolo scelto dall'utente. Da qui in poi STARK non lo riscrive piu da solo. */
  | { k: 'session.renamed'; title: string }
  | { k: 'session.slept' }
  | { k: 'session.woke'; resumedFromSeq: number }
  | { k: 'session.error'; message: string; fatal: boolean }

  // §7 turni, step, parti
  | { k: 'turn.started'; turnId: string; prompt: PromptPart[] }
  /**
   * Un messaggio piegato dentro il turno `turnId`, che era ancora aperto.
   *
   * **STARK non lo produce più** (26 agosto 2026), e la storia di come c'è finito vale
   * la riga che occupa. Era stato scritto leggendo i tipi dell'Agent SDK — "coalesced
   * into one turn", un uuid "folded" che "never runs as its own turn" — e concludendone
   * che un prompt mandato durante un turno *non può* essere un turno a sé. Quelle
   * parole però descrivono cosa fa il CLI con **un lotto di messaggi che gli arrivano
   * mentre lavora**, non un limite del modello: se glieli si consegna uno alla volta e
   * a sessione ferma, ogni prompt è un turno suo. Misurato, non dedotto:
   * `prompt` numero 2 mandato dopo 4s su un turno lungo dodici → due `turn.started`,
   * due `turn.ended`, in ordine (vedi la fila in `adapters/claude-code/adapter.ts`).
   *
   * L'errore non era il codice ma il passo prima: un'assenza osservata in una
   * configurazione presa per un'assenza in generale. Costava caro, perché il secondo
   * messaggio si mangiava il turno del primo e la conversazione diventava illeggibile.
   *
   * L'evento resta nel vocabolario per due ragioni: i journal scritti prima di oggi
   * ne contengono, e `applyTo` deve continuare a saperli rileggere (§4); e il giorno
   * in cui STARK offrirà di **guidare** il turno in corso invece di accodarsi — che è
   * un gesto diverso, e va chiesto — è questo l'evento che lo racconta.
   */
  | { k: 'turn.promptAdded'; turnId: string; prompt: PromptPart[] }
  | { k: 'turn.ended'; turnId: string; reason: 'completed' | 'aborted' | 'error' | 'interrupted'
      usage: Usage; cost: Cost }
  | { k: 'step.started'; stepId: string }
  | { k: 'step.ended'; stepId: string; finish: string; usage: Usage }

  | { k: 'text.started'; partId: string }
  | { k: 'text.delta'; partId: string; delta: string }
  | { k: 'text.ended'; partId: string; text: string }

  | { k: 'reasoning.started'; partId: string }
  | { k: 'reasoning.delta'; partId: string; delta: string; estimatedTokens?: number }
  | { k: 'reasoning.ended'; partId: string }

  | { k: 'tool.started'; callId: string; name: string }
  | { k: 'tool.input.delta'; callId: string; delta: string }
  // `summary` e "su cosa" il tool ha lavorato, gia pronto: il comando, il percorso,
  // l'indirizzo. Lo scrive l'adapter perche estrarlo da `input` vuol dire conoscere la
  // forma di un agent, ed e esattamente cio che il §1 vieta fuori di li.
  //
  // `intent` e "perche", non "cosa": e la motivazione che l'agent stesso scrive in un
  // campo `description` del tool (verificato: Bash la porta sempre), non qualcosa che
  // STARK deduce o genera — un LLM che spiega ogni comando costerebbe quota su ogni
  // tool di ogni turno (F2, Notion, 25 agosto 2026). Assente quando l'agent non l'ha
  // scritta: nessuna riga muta, nessuna spiegazione inventata al suo posto.
  | { k: 'tool.input.ended'; callId: string; input: unknown; summary?: string; intent?: string }
  | { k: 'tool.ended'; callId: string; ok: boolean; output?: unknown; error?: string }

  /**
   * Un lavoro che l'agent ha avviato e che **il CLI segue per conto suo**, oltre la
   * fine della chiamata che lo ha lanciato.
   *
   * Non è un doppione di `tool.started`, ed è la differenza che rende necessari questi
   * due eventi. Un comando lanciato in background risponde **subito** — «Async agent
   * launched successfully» — quindi il suo `tool.ended` arriva con esito positivo una
   * riga dopo, e la conversazione lo mostra come finito. Non lo è: quello che è finito
   * è il *lancio*. L'esito vero arriva molto più tardi, spesso in un altro turno.
   * Misurato su un journal reale: `tool_result` alla riga 53, esito alla riga **810**.
   * Senza questi due eventi quell'esito non esiste in STARK, e chi guarda vede una
   * riga verde al posto di un lavoro ancora in corso — cioè la bugia peggiore, quella
   * su cui si aspetta.
   *
   * `callId` è la chiamata che lo ha avviato: il task **non** è una riga nuova nel
   * flusso, è ciò che si scopre dopo su una riga che c'è già. Attaccarlo lì invece di
   * inventargli un posto è la stessa scelta della compattazione, che è una riga *nel*
   * flusso perché nel flusso è avvenuta.
   *
   * `kind` è canonico: `local_bash`/`local_agent` sono vocabolario di Claude Code e
   * restano nell'adapter (§1). `other` non è pigrizia — è la promessa che un tipo
   * nuovo, aggiunto dal CLI domani, si mostri lo stesso invece di sparire.
   */
  | { k: 'task.started'; taskId: string; callId?: string
      kind: 'command' | 'agent' | 'other'; description?: string; background: boolean }
  /**
   * Com'è andata, quando si sa. `summary` è scritto dal CLI, non da noi: su un
   * sub-agent è il resoconto di cosa ha fatto, ed è l'unica cosa che ne resta —
   * il suo lavoro interno non passa da questo canale.
   */
  | { k: 'task.ended'; taskId: string; status: 'completed' | 'failed'
      summary?: string; outputFile?: string }

  // §8 richieste bloccanti — nel caso normale NON esistono affatto (ADR-008)
  | { k: 'permission.asked'; requestId: string; action: string; resources: string[]
      savable: string[]; source: { callId?: string } }
  | { k: 'permission.replied'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string; message?: string }
  // §16.1 risolto: le domande arrivano come una normale richiesta di permesso sul tool
  // `AskUserQuestion`. Non sono un canale a parte, ma restano un evento a parte: per
  // l'utente "scegli fra queste opzioni" e "posso eseguire questo comando?" sono due
  // cose diverse, e una UI che le mostrasse uguali mentirebbe.
  /**
   * L'agent ha finito di pianificare e chiede di partire.
   *
   * È un evento a sé e non un `permission.asked`, per la stessa ragione per cui lo
   * sono le domande (§16.1): per chi guarda, «ho scritto un piano, lo approvi?» e
   * «posso eseguire questo comando?» sono due cose diverse, e una UI che le mostrasse
   * uguali mentirebbe. Qui la differenza è anche più netta — il permesso si concede
   * guardando **un soggetto** (un comando, un percorso), il piano si approva
   * **leggendolo**: è un documento, non una riga.
   *
   * Verificato dal vivo il 27 agosto 2026 (`spike/piano-todo-subagent.ts`): arriva
   * come richiesta di permesso sul tool `ExitPlanMode`, con `{plan, planFilePath}`.
   * Prima di questo evento finiva nella card generica, e siccome `plan` non è fra i
   * campi in cui `summarize()` cerca un soggetto, quella card **non mostrava niente**:
   * si approvava un piano che non si poteva leggere.
   *
   * `path` è il file in cui il CLI ha scritto il piano per conto suo. Si riporta e non
   * si legge: dirlo permette di aprirlo, leggerlo qui vorrebbe dire preferire il disco
   * a ciò che il protocollo ha già mandato.
   */
  | { k: 'plan.proposed'; requestId: string; plan: string; path?: string }
  /**
   * Cosa si è deciso. `mode` è la parte che non si può omettere: nel terminale
   * approvare un piano vuol dire anche scegliere **come** proseguire — accettando le
   * modifiche da sé o approvandole una per una — e senza quella scelta STARK potrebbe
   * meno del CLI. `feedback` è cosa cambiare, quando si rimanda a pianificare: senza,
   * «no» sarebbe un muro invece che una correzione.
   */
  | { k: 'plan.replied'; requestId: string; decision: 'approved' | 'rejected'
      mode?: PermissionMode; feedback?: string }

  | { k: 'question.asked'; requestId: string; questions: AgentQuestion[] }
  | { k: 'question.replied'; requestId: string
      answers: Record<string, string | string[]>; response?: string }
  | { k: 'question.rejected'; requestId: string }

  // §9 effetti collaterali
  | { k: 'file.edited'; path: string; hunks: Hunk[]; created: boolean
      originalFile?: string; callId?: string }
  | { k: 'command.executed'; command: string; stdout: string; stderr: string
      exitCode?: number; interrupted: boolean; callId?: string }

  // §10 meta
  | { k: 'usage.updated'; usage: Usage; cost: Cost }
  | { k: 'quota.updated'; status: string; kind: string; resetsAt: number
      usingOverage: boolean }
  /**
   * Quanto è pieno il serbatoio, tutte le finestre insieme. Arriva da una domanda che
   * STARK fa (all'avvio, a fine turno, e quando l'utente apre il pannellino), non da un
   * messaggio che l'agent manda per conto suo: per questo porta con sé il momento in cui
   * è stata misurata — l'evento ha già `ts`, e su una chat che dorme è quello che
   * permette di dire «misurato due ore fa» invece di spacciare un numero vecchio per
   * attuale.
   */
  | { k: 'quota.windows'; windows: QuotaWindow[] }
  /** Vedi `ContextUsage`. Arriva quando STARK lo chiede — avvio, fine turno, apertura
   *  del pannellino — non quando l'agent lo decide: non è un fatto che l'agent
   *  racconta da sé, è una domanda che STARK fa. */
  | { k: 'context.usage'; usage: ContextUsage }
  /**
   * Il contesto è stato riassunto: da qui in su il modello non ha più i messaggi per
   * intero, ma un riassunto. Osservato dal vivo: `manual` con 34.802 → 743 token in
   * 8,7 s. `after` è opzionale perché il protocollo lo dichiara tale — mostrare uno
   * zero al posto di «non lo so» sarebbe la solita bugia comoda.
   */
  | { k: 'context.compacted'; before: number; after?: number
      trigger?: 'manual' | 'auto'; ms?: number }
  /**
   * Il contesto è stato **azzerato**, non riassunto: `/clear`. Da qui in giù il
   * modello non ha più niente di quello che c'era sopra — nemmeno il riassunto che
   * lascia una compattazione.
   *
   * Verificato dal vivo il 26 agosto 2026 (`spike/clear-probe.ts`), perché il nome
   * del comando non è una prova: mandato `/clear` fra due prompt, il secondo non
   * sapeva più la parola detta nel primo. Il CLI lo annuncia con un messaggio suo,
   * `conversation_reset`, dentro il turno del comando, e subito dopo manda un
   * `system:init` con un **session_id nuovo** — è quello che diventa il
   * `session.resumeRef`, ed è già gestito: risvegliare una chat azzerata riprende la
   * conversazione vuota, non quella di prima.
   *
   * `ref` è il `new_conversation_id` del messaggio, e **non** è il riferimento per il
   * risveglio: nella cattura i due id erano diversi (`31830557…` contro `f98faabe…`).
   * Sta qui perché è l'unico modo di ritrovare quella conversazione nei trascritti
   * del CLI, non perché serva a riprenderla.
   */
  | { k: 'context.cleared'; ref?: string }
  | { k: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  | { k: 'action.blocked'; by: 'classifier' | 'denyRule'; callId?: string; reason: string }

export type PayloadKind = Payload['k']

// ─── §4 involucro ───────────────────────────────────────────────────────────

export type CanonicalEvent = {
  v: typeof MODEL_VERSION
  seq: number       // progressivo per sessione, assegnato da STARK, senza buchi
  ts: number        // epoch ms, assegnato da STARK alla normalizzazione
  sessionId: string
  payload: Payload
}

// ─── §11 comandi dalla UI al daemon ─────────────────────────────────────────

export type PermissionRuleDecision = 'allow' | 'ask' | 'deny'
export type PermissionRules = Record<string, PermissionRuleDecision>

/**
 * Le categorie del pannello dei permessi (§16.5, e ADR-008).
 *
 * **Categorie, non nomi di tool**: «comandi shell» invece di `Bash`, «strumenti
 * esterni» invece di `mcp__*`. I nomi dei tool sono vocabolario di Claude Code, ed è
 * esattamente ciò che il modello canonico esiste per non far uscire dall'adapter — a
 * tradurre una categoria nei tool di un agent è l'adapter, che è l'unico a conoscerli.
 *
 * Sono sei perché sono sei le cose che un utente riconosce guardando cosa sta per
 * succedere. Un elenco di venti tool sarebbe più preciso e inservibile.
 */
export type PermissionCategory =
  | 'shell'     // eseguire comandi
  | 'edit'      // scrivere, cambiare, cancellare file
  | 'read'      // aprire e cercare dentro la cartella
  | 'net'       // rete: pagine, ricerche
  | 'agents'    // sotto-agent che lavorano per conto loro
  | 'external'  // strumenti esterni collegati (MCP)

export const PERMISSION_CATEGORIES: PermissionCategory[] =
  ['shell', 'edit', 'read', 'net', 'agents', 'external']

/** Cosa fa STARK per ciascuna categoria. `deny` è un altro meccanismo: vedi §16.5. */
export type CategoryRules = Record<PermissionCategory, 'allow' | 'ask'>

export const CATEGORY_DEFAULTS: CategoryRules = {
  // Tutto su «fai pure»: è il comportamento che rende il lavoro scorrevole ed è quello
  // che si vuole quasi sempre (ADR-008). Ogni interruttore spostato **aggiunge** un
  // riquadro di conferma dove lo si desidera, invece di toglierne uno.
  shell: 'allow', edit: 'allow', read: 'allow', net: 'allow',
  agents: 'allow', external: 'allow',
}

export type Command =
  | { c: 'session.open'; agent: string; cwd: string; model?: string; mode?: PermissionMode }
  | { c: 'session.prompt'; text: string; attachments?: Attachment[] }
  | { c: 'session.interrupt' }
  /**
   * Cambia una scelta dichiarata dall'agent (ADR-014). La UI manda l'`id` che ha
   * ricevuto e il valore scelto, senza sapere cosa significhino: e' la differenza fra
   * «disegna cio' che ti dicono» e «conosci le sei parole».
   */
  | { c: 'session.setOption'; id: string; value: string }
  | { c: 'session.setModel'; model: string }
  | { c: 'session.setMode'; mode: PermissionMode }
  | { c: 'session.setMcp'; server: string; enabled: boolean }
  /**
   * Rileggi il livello della quota adesso. Non cambia niente nella conversazione: è una
   * domanda al piano, e la si fa quando l'utente guarda il pannellino — che è l'unico
   * momento in cui quel numero deve essere fresco.
   */
  | { c: 'session.refreshQuota' }
  /** Rileggi quanto è pieno il contesto, dalla stessa domanda a cui risponde `/context`
   *  nel terminale — non un ricalcolo nostro. Stessa ragione di `refreshQuota`. */
  | { c: 'session.refreshContext' }
  | { c: 'permissions.setRules'; rules: PermissionRules }
  | { c: 'session.rename'; title: string }
  | { c: 'session.sleep' }
  | { c: 'session.wake' }
  | { c: 'session.close' }
  | { c: 'permission.reply'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string }
  | { c: 'question.reply'; requestId: string
      answers: Record<string, string | string[]>; response?: string }
  | { c: 'question.reject'; requestId: string }
  /**
   * La risposta a un piano. `mode` viaggia con l'approvazione e non separatamente,
   * perché nel terminale sono un gesto solo: approvare vuol dire anche dire **come**
   * proseguire. Mandarli come due comandi lascerebbe una finestra in cui l'agent è
   * già ripartito nella modalità di prima.
   */
  | { c: 'plan.reply'; requestId: string; decision: 'approved' | 'rejected'
      mode?: PermissionMode; feedback?: string }

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Il testo di un prompt, senza le immagini. Sta qui perché serve identico in tre posti
 * — il titolo della conversazione, l'intestazione del turno, l'import — e perché da
 * quando un prompt può contenere altro, `parts.map(p => p.text)` non è più vero.
 */
export const promptText = (parts: PromptPart[]): string =>
  parts.filter(p => p.type === 'text').map(p => p.text).join(' ')
