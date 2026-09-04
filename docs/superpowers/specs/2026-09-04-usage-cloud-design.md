# Usage sincronizzato in cloud

*4 settembre 2026 — spec concordata in brainstorming, prima di scrivere il codice.*

## Il problema

`Settings → Usage` calcola tutto in locale: `statsFrom()` in `src/core/stats.ts` legge gli
`SessionSnapshot` che il registro tiene già in RAM e restituisce venti numeri. È corretto e
non costa niente, ma i journal **non si sincronizzano fra le macchine** — fisso, portatile e
MacBook hanno tre storie separate. Quindi il numero che leggi non è il tuo uso di STARK: è il
tuo uso di STARK *da quella scrivania*.

Il commento in cima a `stats.ts` aveva previsto questo giorno:

> «Ed è una funzione **pura** su snapshot, non una rotta: il giorno in cui esisterà un server
> che aggrega più utilizzatori, si manderà il suo risultato — venti numeri — invece dei
> journal.»

Quel server adesso c'è (`cloud/`, autenticazione e board), ed è quello che si fa qui.

## Perimetro

Sincronizzazione **personale**. I numeri di un utente li vede solo quell'utente.

Durante la discussione era stata esplorata anche una **classifica** fra account («chi ha
lanciato più prompt») ed è stata **scartata** il 4 settembre 2026. Sta scritto qui perché
l'assenza di una classifica è una scelta, non una dimenticanza: chi rileggerà queste tabelle
vedrà che `usage_daily` è già quasi tutto ciò che servirebbe, e deve sapere che il pezzo
mancante — il confronto fra utenti — non manca per caso.

Fuori perimetro, di conseguenza: team, organizzazioni, ruoli di amministrazione, visibilità
incrociata.

## Le decisioni, e su cosa poggiano

### La macchina sta nella chiave, e si vede

Le tre macchine devono sommarsi, non sovrascriversi. Con una riga per `(giorno, progetto,
agent, modello)` e un UPSERT idempotente, tre macchine che scrivono la stessa chiave si
sovrascriverebbero a vicenda: il totale diventerebbe quello dell'ultima che ha parlato.

Le uniche due uscite erano mettere la macchina nella chiave, oppure rinunciare
all'idempotenza e mandare delta sommanti — che richiede un registro locale di «cosa ho già
mandato» più una tabella di deduplicazione lato server, o i numeri sbagliano in silenzio al
primo ritentativo.

Vince la macchina nella chiave, e il motivo non è l'eleganza: **non aggiunge stato da tenere
in sincronia**. `statsFrom()` calcola già da zero a ogni chiamata, quindi il daemon dichiara
ciò che vede invece di ricordare ciò che ha fatto. Ogni memoria è una cosa che può divergere
dalla realtà.

In più, la macchina è una dimensione che l'utente **vuole vedere** («da quali dispositivi ho
lavorato»), quindi non è una colonna tecnica nascosta: c'è una sezione *By device* nella UI.

### La chiave di progetto è l'origin git, non il `cwd`

`perProgetto` oggi raggruppa per `cwd`. Lo stesso progetto è `/mnt/m/devs-development/stark/stark`
sul fisso e `/Users/veenz/Documents/projects/stark` sul MacBook: sommate in cloud, quelle due
righe non si unirebbero e *By project* mostrerebbe **stark** due volte.

La chiave stabile fra macchine esiste già ed è in uso per la board cloud: l'origin della repo
git, che `originRepo()` (`src/daemon/cloud.ts`) sa ricavare.

- `project_key` — l'origin git se c'è, altrimenti il `cwd`, altrimenti `unknown`. Una cartella
  senza repo *è* di quella macchina, e va bene che resti separata.
- `project_label` — il nome da mostrare; l'ultimo invio vince.

Costo dichiarato: `originRepo()` lancia `git` due volte, quindi il risultato va messo in cache
per `cwd` — si risolve una volta per cartella, non a ogni turno.

### L'invio è idempotente, mai un delta

Il daemon manda **lo stato completo** della finestra, e il server fa `INSERT … ON CONFLICT DO
UPDATE`. Ripetere lo stesso invio mille volte dà lo stesso risultato. Questa è l'architettura,
non un dettaglio: è ciò che permette di non avere code, ritentativi, o memoria di cosa è già
passato. Se un invio fallisce, il prossimo lo copre.

### Spento di default

Oggi l'unica cosa che esce dalla macchina è il Web Push, e ADR-011 lo ha reso una scelta
esplicita. L'usage in cloud è la **seconda**: un interruttore in `Settings → Usage`, spento,
con scritto accanto cosa sale. Il login al cloud (che uno può aver fatto per la board) non è
un consenso a questo.

### Conversazioni: una tabella in più per non gonfiare un numero

Tutte le colonne si sommano senza pensarci tranne `conversations`. Una chat aperta lunedì e
ripresa mercoledì è **una** conversazione nel totale locale, ma sono **due righe** in
`usage_daily`: sommandole il cloud direbbe due. È una delle quattro schede grandi, quindi
sarebbe un numero visibilmente gonfiato.

`usage_session_days` tiene quali conversazioni erano vive in quale giorno, e il conteggio
diventa un `COUNT(DISTINCT session_id)`. Costo: poche decine di righe al giorno, e un uuid di
sessione che sale in cloud — un identificatore, non contenuto.

## Lo schema

In `cloud/src/db/schema.ts`, tre tabelle nuove.

```ts
/** Un dispositivo dell'utente. L'id opaco nasce in ~/.stark/machine-id;
 *  l'etichetta è l'hostname e si può cambiare senza spezzare lo storico. */
export const machines = pgTable('machines', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineKey: text('machine_key').notNull(),
  label:      text('label').notNull(),
  platform:   text('platform'),
  lastSeen:   timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.machineKey)])

/** Una riga di uso: un giorno, un dispositivo, un progetto, un agent, un modello.
 *  Si riscrive intera a ogni invio: è sempre lo stato completo, mai un delta. */
export const usageDaily = pgTable('usage_daily', {
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineId:    uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  day:          date('day', { mode: 'string' }).notNull(),
  projectKey:   text('project_key').notNull(),
  projectLabel: text('project_label'),
  agent:        text('agent').notNull(),
  model:        text('model').notNull(),

  conversations: integer('conversations').notNull().default(0),
  prompts:       integer('prompts').notNull().default(0),
  chars:         bigint('chars',    { mode: 'number' }).notNull().default(0),
  agentMs:       bigint('agent_ms', { mode: 'number' }).notNull().default(0),
  tools:         integer('tools').notNull().default(0),
  files:         integer('files').notNull().default(0),
  commands:      integer('commands').notNull().default(0),
  aborted:       integer('aborted').notNull().default(0),
  errored:       integer('errored').notNull().default(0),
  interrupted:   integer('interrupted').notNull().default(0),
  tokIn:         bigint('tok_in',    { mode: 'number' }).notNull().default(0),
  tokOut:        bigint('tok_out',   { mode: 'number' }).notNull().default(0),
  tokCacheRead:  bigint('tok_cache_read',  { mode: 'number' }).notNull().default(0),
  tokCacheWrite: bigint('tok_cache_write', { mode: 'number' }).notNull().default(0),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.machineId, t.day, t.projectKey, t.agent, t.model] })])

/** Quali conversazioni erano vive in quale giorno. Serve solo a contare le
 *  conversazioni **distinte** su un periodo, senza gonfiarle. */
export const usageSessionDays = pgTable('usage_session_days', {
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  day:       date('day', { mode: 'string' }).notNull(),
  sessionId: text('session_id').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.machineId, t.day, t.sessionId] })])
```

`bigint` e non `integer` su caratteri, millisecondi e token: `integer` si ferma a 2,1 miliardi
e i token di cache read li superano in qualche mese. Modalità `number`, quindi il limite vero
è 2^53 — abbastanza per qualunque uso umano.

Il `day` è `YYYY-MM-DD` nel **fuso della macchina che ha lavorato**, come già fa `giorno()` in
`stats.ts`. Non si converte in UTC: un turno delle 23:30 appartiene a quella giornata lì.

## Il calcolo: `righeUso()` in `src/core/stats.ts`

`statsFrom()` produce ripartizioni **separate** (per progetto, per agent, per modello), non la
loro combinazione. Per le righe serve il raggruppamento sulla tupla piena.

```ts
export type RigaUso = {
  day: string
  projectKey: string
  projectLabel: string
  agent: string
  model: string
  c: Conteggi
}

export type RigheUso = {
  righe: RigaUso[]
  /** Quali conversazioni erano vive in quale giorno. */
  sessionDays: { day: string; sessionId: string }[]
}

export function righeUso(
  snaps: Iterable<SessionSnapshot>,
  p: Periodo,
  chiaveProgetto: (s: SessionSnapshot) => { key: string; label: string },
): RigheUso
```

È facile perché ogni snapshot ha **un** `cwd`, **un** agent, **un** modello: a spezzarsi sono
solo i giorni dei turni. Resta pura — la risoluzione dell'origin git entra come funzione
passata dal chiamante, così `stats.ts` non impara a lanciare `git`.

`statsFrom()` non si tocca: la vista locale continua a funzionare identica quando la sync è
spenta o il cloud è irraggiungibile.

## Le rotte cloud

Due, dietro `Bearer` come la board. Nessun `origin` in query: qui la chiave è l'utente, che sta
già nel token.

```
POST /api/usage
  body: {
    machine:     { key, label, platform },
    rows:        [{ day, projectKey, projectLabel, agent, model, ...conteggi }],
    sessionDays: [{ day, sessionId }],
    window:      { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
  }
  → { ok: true, rows: n }
```

Il server risolve (o crea) la macchina da `machine.key`, aggiorna `label`/`lastSeen`, poi
UPSERT riga per riga, **in una transazione**.

`window` è necessario e non decorativo: senza, una riga che *sparisce* dal calcolo locale
(l'ultima chat di quel progetto cancellata) resterebbe in cloud per sempre. Con la finestra
dichiarata, il server cancella dentro quegli estremi ciò che l'invio non nomina — per quella
macchina soltanto.

```
GET /api/usage?from=<ms>&to=<ms>
  → { totale, perGiorno[], perProgetto[], perAgent[], perModello[], perDevice[] }
```

Stessa forma di `Stats` più `perDevice`, così la UI non impara un secondo formato.
`conversations` esce da `COUNT(DISTINCT session_id)` su `usage_session_days`; tutto il resto da
`SUM()` su `usage_daily`.

Limiti dichiarati: il `readJson` del server si ferma già a 64 KB, e il `POST` accetta al
massimo **90 giorni** per invio. Oltre, il daemon spezza in più invii — ognuno indipendente e
idempotente, quindi non serve nessuna transazione fra invii.

## Il daemon

File nuovo `src/daemon/usage-sync.ts`. Espone `notificaTurnoFinito()` e non sa di HTTP oltre a
`chiama()`, che è già in `cloud.ts`.

- **Innesco:** fine turno.
- **Collasso:** un invio ogni 60 s al massimo. I turni che cadono dentro la finestra non
  accodano niente, alzano solo un flag «c'è da mandare». Senza il collasso, una giornata
  intensa sono centinaia di richieste HTTP.
- **Finestra:** gli **ultimi 3 giorni**. Un turno di oggi non cambia il totale di marzo. Tre e
  non uno perché una macchina che passa un giorno offline deve poter recuperare al primo turno
  online.
- **Primo invio:** se `~/.stark/usage-synced` non c'è, manda tutto lo storico una volta, poi
  scrive il file.
- **Offline:** un fallimento non si ritenta e non si accoda. Non serve: il prossimo turno
  rimanda la stessa finestra.
- **Spento di default:** `usageSync: boolean` in `Settings` (`src/daemon/settings.ts`). Se è
  `false`, o se non c'è token cloud, `notificaTurnoFinito()` ritorna subito.
- **`machine-id`:** un uuid generato al primo bisogno in `~/.stark/machine-id`, `0600`.

## La UI

`ui/src/components/Settings.svelte`, sezione `usage`:

- in cima, l'interruttore **Sync usage to cloud**, spento, con sotto cosa sale: *giorni, nomi
  di progetto, agent, modello, conteggi e token — mai il testo dei prompt né gli output*.
  Disabilitato **con la ragione scritta** se non sei loggato al cloud, mai nascosto (§«STARK non
  deve mai poter meno del CLI», stessa disciplina).
- con la sync accesa, la sezione legge la rotta cloud invece di quella locale: le quattro schede
  diventano il totale di tutti i dispositivi.
- sezione nuova **By device** accanto a *By project* e *By agent and model*: etichetta, prompt,
  tempo agent, «last seen».
- **cloud giù:** ricade sul locale con una nota — *showing this device only, cloud unreachable*.
  Mai una schermata vuota quando il dato in RAM c'è ed è calcolabile all'istante.

## Prove

- `righeUso()` è pura: prove sulla tupla di raggruppamento, sui giorni che si spezzano, e sul
  fatto che i totali per riga sommino a quelli di `statsFrom()` sullo stesso periodo.
- Cloud: due invii identici lasciano i totali fermi (l'idempotenza è tutta l'architettura, e se
  salta non lo dice nessuno); due macchine si sommano invece di sovrascriversi; una chat lunga
  tre giorni resta **1** conversazione; una riga sparita dal calcolo locale sparisce anche in
  cloud dentro la finestra dichiarata.
- Daemon: con `usageSync: false` non parte nessuna richiesta.
- Una sonda `tools/usage-check.ts` come le altre, con un Postgres effimero.

## Cosa resta fuori, e perché

- **Classifica fra utenti** — scartata sopra.
- **Ritenzione / rotazione** delle righe: nessuna cancellazione automatica. `usage_daily` cresce
  di qualche riga al giorno per macchina; parlarne prima di misurarlo sarebbe speculazione.
- **Quota del piano in cloud**: le `QuotaWindow` sono un dato dell'account Claude, uguale su
  tutte le macchine perché l'account è uno. Sincronizzarle non aggiungerebbe niente.
