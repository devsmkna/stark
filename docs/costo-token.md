# STARK costa più token del `claude` da terminale?

Misurato il 27 agosto 2026 su `@anthropic-ai/claude-agent-sdk` **0.3.241** ↔ Claude Code
bundled **2.1.241**. La sonda è `spike/costo-vs-cli.ts` e costa **zero quota**: sono
handshake più una richiesta sul canale di controllo, nessun turno parte mai.
Va rifatta a ogni salto di versione del CLI incluso.

## Risposta breve

**No — e non era una buona notizia.** Prima di questa verifica STARK mandava ~1.944 token
**in meno** del CLI, e il risparmio veniva per intero dal fatto che le sessioni giravano
**senza il system prompt di Claude Code**, cioè senza le sue istruzioni operative. Un
deficit di capacità travestito da risparmio, e il rovescio del Principio 5 («STARK non
deve mai poter meno del CLI»).

**Corretto il 27 agosto 2026**: `buildOptions` passa ora
`systemPrompt: { type: 'preset', preset: 'claude_code' }`. Da qui in avanti STARK manda
**+1.348 token** rispetto al CLI headless nudo, e sono tutti `AskUserQuestion` — cioè
spesi per fare *quanto* il terminale, non di più (§2). Su ogni altra voce misurata
— memoria, skill, modalità, cache, TTL — la parità è esatta.

## Il fatto che decide tutto: STARK non compone nessun prompt

L'SDK **lancia il binario vero**. Verificato leggendo `/proc/<pid>/exe` del processo
figlio, non dedotto:

```
node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude \
  --output-format stream-json --verbose --input-format stream-json --permission-mode default
```

`manifest.json` dell'SDK dichiara `version: 2.1.241`. Quindi la composizione del prompt,
i breakpoint di cache, la compattazione e il conteggio dei token li fa **lo stesso
eseguibile** che sta dietro `claude`. STARK non può sbagliarli: può solo passare opzioni
diverse. Tutta la domanda si riduce quindi a **quali opzioni**, e la superficie è
`buildOptions` in `src/adapters/claude-code/sdk-options.ts` — un file solo.

## La misura

`getContextUsage()` è la stessa domanda a cui risponde `/context` nel terminale. Token
presenti nel prompt **prima che l'utente scriva**, su questo repo come `cwd`:

| scena | system | tool | defer | memoria | skill | **TOTALE** |
|---|---:|---:|---:|---:|---:|---:|
| **STARK (com'è oggi)** | **677** | 15.059 | 15.030 | 62.414 | 1.875 | **80.033** |
| STARK + preset `claude_code` | 3.969 | 15.059 | 15.030 | 62.414 | 1.875 | 83.325 |
| SDK nudo + preset | 3.969 | 13.711 | 12.950 | 62.414 | 1.875 | 81.977 |
| solo `permissionMode: 'auto'` | 3.969 | 13.595 | 12.950 | 62.414 | 1.875 | 81.861 |
| solo `canUseTool` | 3.969 | 15.175 | 15.030 | 62.414 | 1.875 | 83.441 |
| solo `includePartialMessages` | 3.969 | 13.711 | 12.950 | 62.414 | 1.875 | 81.977 |
| solo `strictMcpConfig: true` | 3.969 | 13.711 | 12.950 | 62.414 | 1.875 | 81.977 |
| `settingSources` esplicito | 3.969 | 13.711 | 12.950 | 62.414 | 1.875 | 81.977 |

Due letture da non sbagliare. **`System tools (deferred)` non entra nel totale**: la somma
delle altre cinque categorie dà esattamente `totalTokens` (677+15.059+62.414+1.875+8 =
80.033). Sono i tool che il modello carica su richiesta con la ricerca tool, non quelli nel
prefisso. E le differenze sono **perfettamente additive**: 13.711 − 116 + 1.464 = 15.059,
cioè ogni opzione pesa da sola e non interagisce con le altre.

## Le tre differenze, una per una

### 1. Il system prompt — **−3.292 token, ed era un bug** ⚠️ (corretto)

`buildOptions` **non passava** `systemPrompt`. Il default dell'SDK non è «il prompt di Claude
Code»: è un prompt **minimo**. La riga esatta nel bundle (`sdk.mjs`, `xP()`):

```js
if (s === void 0) p = "";           // nessun systemPrompt  →  stringa vuota
else if (typeof s === "string") p = s;
else if (s.type === "preset") { f = s.append; m = s.excludeDynamicSections }
```

Cioè: non passare nulla **non** vuol dire «lascia fare al CLI», vuol dire «sostituisci il
tuo system prompt con una stringa vuota». Confermato dalla misura (677 contro 3.969) e
dalla documentazione ufficiale, che lo dice nei termini che contano
(<https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts>):

> **Minimal default**: when you don't set `systemPrompt` […] the SDK uses a minimal prompt
> that covers tool calling but omits Claude Code's coding guidelines, response style, and
> project context. **This differs from `claude -p`, which uses the full Claude Code prompt
> by default.**

I 677 token che restano sono il contesto dinamico (cartella di lavoro, piattaforma, shell,
stato git, percorso dell'auto-memory), che il CLI mette comunque.

**Cosa NON si perde**, e vale la pena dirlo perché sembrerebbe il contrario: `CLAUDE.md`
c'è (62.414 token di «Memory files», identici in tutte le scene) e le skill pure (1.875).
Quelli non passano dal system prompt — la doc lo dice esplicitamente: «the SDK reads it and
injects its content into the conversation as project context, **not into the system
prompt**». Si perdono le *istruzioni operative di Claude Code*, non il contesto del
progetto.

Perché conta anche sui token, non solo sulla capacità: un agent istruito peggio fa più
giri per arrivare allo stesso punto, e un giro in più costa molto più di 3.292 token. Il
risparmio è misurato, il costo indiretto no — ma va nella direzione opposta.

Il modo in cui questo difetto è sopravvissuto merita una riga, perché è il genere che si
ripeterà. Non c'era **nessuna scelta registrata**: `grep -rn "systemPrompt" src/ docs/`
non trovava niente. Non è stato deciso di rinunciarci — è che al tempo di ADR-009 il
default dell'SDK *era* il prompt di Claude Code (v0.0.x), è cambiato nella v0.1.0, e
un'opzione che non si passa non compare in nessuna diff. Fallisce nel modo peggiore
possibile: non dà errore, risponde peggio.

### 2. `canUseTool` — **+1.464 token, ed è parità, non eccesso**

Passare la callback è ciò che fa comparire `AskUserQuestion` nell'elenco dei tool
(scritto e verificato in `sdk-options.ts`): toglierla non rende STARK «meno interattivo»,
fa sparire le domande dell'agent del tutto. Il CLI interattivo quelle domande le ha.
Quindi qui STARK **raggiunge** il terminale, non lo supera: sono token spesi per non poter
meno.

### 3. `permissionMode: 'auto'` — **−116 token, e il paragone era sbagliato**

Sul prefisso pesa in meno, non in più. Ma il fatto interessante è un altro, ed è una
**correzione a quanto scritto in `CLAUDE.md`** («`claude` senza `--permission-mode` parte
in `default`, STARK chiedeva `auto`»). Quella misura era stata presa via SDK, e la
documentazione spiega perché il numero era giusto e la conclusione no
(<https://code.claude.com/docs/en/permission-modes>, tabella «Which mode a session starts
in»):

| Come lanci Claude Code | Modalità di partenza |
|---|---|
| `claude -p` **o l'Agent SDK** | `default` |
| **Un piano Pro, Max o Team, in un terminale** | **`auto`** |

Cioè: il termine di paragone dell'utente — `claude` interattivo su piano Max — parte
**già in `auto`**. STARK non aggiunge un classificatore che il terminale non ha: ha lo
stesso default. La misura del costo del classificatore (sotto la risoluzione, registrata
in `CLAUDE.md`) resta valida e ora è anche irrilevante al confronto.

⚠️ Da non dedurre: la doc dice che le chiamate del classificatore contano nell'usage «On
Enterprise plans and on accounts that use the Claude API […]» e **non nomina Pro e Max**.
Che sui piani a quota fissa non contino è *suggerito e non affermato*.

### Le quattro che non cambiano niente

`includePartialMessages`, `strictMcpConfig`, `settingSources` esplicito: **zero** token di
differenza, misurato. Su `settingSources` c'è una premessa da correggere: il cambio della
v0.1.0 («nessun setting dal filesystem») è stato **annullato**
(<https://code.claude.com/docs/en/agent-sdk/migration-guide>):

> This default was briefly changed in v0.1.0 to load no filesystem settings and then
> reverted, so no migration action is needed. **Omitting `settingSources` […] matches the
> CLI.**

La misura lo conferma: passarlo o non passarlo dà lo stesso identico totale. Quindi la
funzione «Command descriptions» di `memoria.ts`, che scrive nel `CLAUDE.md` globale, **è
letta davvero** dalle sessioni STARK. Non era scontato ed è la seconda cosa che questa
verifica ha chiuso.

## La cache

### STARK non la può sbagliare per costruzione, ma la può invalidare

La cache la gestisce il binario. Il quale, e questo si scopre solo guardandoci dentro,
tiene una **diagnostica interna delle cause di cache miss** — le stringhe sono nel
binario:

```
system prompt changed (±N chars) · tools changed (+N/-N tools) ·
tool prompt/schema changed, same tool set · model changed (X → Y) · fast mode toggled ·
global cache strategy changed · cache_control changed (scope or TTL) · betas changed ·
auto mode toggled · overage state changed (TTL flip expected) · effort changed ·
defer_loading presence flipped
```

Confrontata con l'elenco ufficiale (<https://code.claude.com/docs/en/prompt-caching>),
ecco cosa fa STARK e cosa costa:

| Cosa fa STARK | Invalida la cache? | Perché |
|---|---|---|
| Riconciliazione MCP prima di ogni turno (`reconcileMcp`) | **No** | Tocca solo in caso di delta (`if (acceso === …) continue`), e con i tool *deferred* — il default sui modelli supportati — «a server connecting, disconnecting, or changing its tool list only appends new content and doesn't disturb anything already cached». La misura conferma i deferred attivi: 15.030 token in quella categoria. |
| Cambio modalità dal chip della barra | **No** | «mode changes are cache-safe»: non cambiano né system prompt né tool. |
| Cambio modello dal chip della barra | **Sì** | «each model has its own cache». Identico a `/model` nel terminale. |
| Sleep e risveglio con `--resume` | Solo oltre la TTL | Vedi sotto. |
| `getContextUsage()` / `usage_…` / `file_suggestions` a ogni fine turno | **No** | Sono richieste sul canale di controllo, non chiamate all'API: questa sonda ne fa otto senza spendere un token di quota. |
| Fila FIFO dei prompt | — | Vedi sotto: non invalida, ma moltiplica i turni. |

### La TTL è un'ora, non cinque minuti

E i turni dell'SDK stanno nello stesso secchiello di quelli interattivi
(<https://code.claude.com/docs/en/prompt-caching>):

> * **Main conversation**: your interactive turns, non-interactive `-p` runs, **and Agent
>   SDK turns** […]

| Secchiello | Abbonamento entro quota | Crediti / API key |
|---|---|---|
| Main conversation | **Un'ora** | Cinque minuti |
| Tutto il resto (subagent, compattazione, titoli) | Cinque minuti | Cinque minuti |

Questo chiude una misura lasciata a metà in `CLAUDE.md`: «al risveglio la storia arriva
come `cache_read` […] e regge dopo 420 secondi; oltre la TTL non è stato misurato». La TTL
vera è **3600 secondi**, quindi 420 era ampiamente dentro. Il limite da conoscere è l'ora,
e non è di STARK: è dell'abbonamento, e il terminale ha lo stesso.

Nota sulla versione: le variabili `ENABLE_PROMPT_CACHING_1H`, `FORCE_PROMPT_CACHING_5M` e
`DISABLE_PROMPT_CACHING` esistono nel binario 2.1.241. Le impostazioni `promptCacheTtl` /
`subagentPromptCacheTtl` no: la doc le dà da **2.1.242**, cioè una patch più avanti del
bundled. STARK non ne imposta nessuna e passa `process.env` al figlio, quindi qui è
allineato al terminale per definizione.

### Dove la cache è per macchina e cartella

> In Claude Code, the cache is effectively scoped to **one machine and directory**. […]
> Sessions you run in parallel in the same directory build matching prefixes and read each
> other's cache.

Conseguenza a favore di STARK, che vale la pena scriverla: N chat affiancate sulla stessa
cartella **condividono il prefisso**. Il layout multi-pannello non moltiplica il costo del
prefisso, lo divide.

`excludeDynamicSections: true` non serve qui: serve a una flotta di macchine diverse che
vogliono far combaciare il prefisso fra utenti, mentre STARK gira su una macchina sola.

## L'unico punto in cui STARK spende davvero più del terminale

**La fila FIFO dei prompt.** Mandare due prompt mentre l'agent lavora apre in STARK **due
turni**, consegnati uno alla volta; il CLI, ricevendo un lotto, li **fonde in un turno
solo**. Due turni vogliono dire due richieste, cioè due riletture della conversazione — a
tariffa `cache_read` (0,1×) finché la cache è calda, ma due — e due generazioni di output,
che non sono cachate affatto.

Non è un difetto da correggere: è la scelta registrata in `CLAUDE.md` («un prompt mandato
mentre l'agent lavora apre un turno suo»), presa perché fondere i messaggi rende
imprevedibile a quale dei due l'agent stia rispondendo. Ma è **il** posto in cui STARK
costa più del terminale, e finora non era scritto da nessuna parte.

## Il titolo non lo genera più l'agent

STARK non passava l'opzione `title`, quindi il CLI **generava il titolo da sé** con una
chiamata al modello — mentre STARK il titolo se lo calcola già per conto suo (`titleOf` in
`registry.ts`: rinomina dell'utente, altrimenti il primo prompt troncato a 64 caratteri).
Lavoro pagato e buttato. **Corretto il 27 agosto 2026**: `registry.open()` passa sempre
`title: titleOf(snapshot)`.

Quattro fatti misurati prima di toccarlo, perché tre di essi cambiano il conto.

**È una chiamata sola, non molte.** Il journal nativo di una sessione STARK vera contiene
**163** voci `"type":"ai-title"`, che a colpo d'occhio sembrano 163 generazioni. Sono 163
riscritture dello **stesso** valore (`uniq -c` sui valori distinti: una riga sola). È
metadato ripersistito a ogni salvataggio, non lavoro rifatto.

**Il titolo non arriva nel flusso.** Cercato nella cattura nativa da 42 MB di quella
sessione: nessun evento lo porta. STARK non poteva quindi *usarlo* invece di buttarlo, se
non leggendo i file di Claude Code.

**Il campo conta solo alla nascita.** Su un risveglio non fa niente — «the resumed
session's persisted title takes precedence» — ed è esattamente alla nascita che quella
chiamata sarebbe partita, perché il titolo il CLI lo genera *dal primo messaggio*.

**Il costo, dichiarato invece che scoperto dopo.** Quando la chat nasce STARK il titolo non
ce l'ha ancora: quello che passa è il segnaposto che mostra anche lui, `new chat <id8>`.
Chi guarda le stesse conversazioni **dal terminale** (`claude --resume`, e l'elenco di
import di STARK) vede quel segnaposto invece di un riassunto leggibile. È una decisione
dell'utente, presa sapendolo, sul criterio «meno token e costo dell'agent».

**La via pulita per riallineare quel segnaposto esiste ma non è percorribile qui**, e vale
la pena scriverlo perché sembra facile: `renameSession(sessionId, title, { dir })` è
**filesystem, non quota** (verificato — scrive un `customTitle` nel journal nativo). Ma
risolve la cartella dei progetti dal `CLAUDE_CONFIG_DIR` **del processo che chiama**, letto
al momento della chiamata, e `dir` da solo non basta: misurato, non dedotto — con `dir`
esplicito e un config dir finto fallisce con «not found in project directory». Chi
chiamerebbe è il daemon, che ne ha uno solo, mentre STARK tiene un profilo **per progetto**.
Sulle chat con un profilo diverso scriverebbe nel posto sbagliato.

La sonda è `spike/titolo-non-generato.ts` e **costa un turno corto**, perché è l'unico modo
di vederlo: `title` fallisce in silenzio — se non arrivasse al CLI la sessione funzionerebbe
identica, spendendo. Verificato dal vivo passando dalla via dell'utente (daemon, non
adapter): turno vero, **0** voci `ai-title` nel journal nativo, `customTitle` uguale al
titolo di STARK. Nello scriverla è caduta una prova che mentiva: la prima versione aspettava
«lo stato non è più `busy`», ma per il primo secondo la chat non è ancora `busy` — usciva
subito dichiarando finito un turno mai cominciato, e con la rotta sbagliata (`/prompt`
invece di `/command`) il prompt non era neanche partito. A salvarla è stata la verifica
successiva, che cercava il journal nativo e non lo trovava.

## Cosa resta non misurato

- **Il costo indiretto del system prompt mancante**: un agent senza le istruzioni di
  Claude Code fa più giri? Plausibile, non misurato. Servirebbe un A/B a compito uguale, e
  costa quota vera.
- **Il classificatore sui piani Pro/Max**: la doc tace, e la misura di `CLAUDE.md` diceva
  «sotto la risoluzione». Resta sotto la risoluzione.
- **Il resto oltre l'ora di TTL**: mai misurato, e ora si sa che servirebbe più di un'ora
  di attesa per farlo.
- **Quali tool esatti aggiunge `canUseTool`**: il peso è misurato (+1.464 token), i nomi
  no. La lista `tools` non arriva nell'handshake e il `system:init` del flusso non si
  presenta finché non parte un turno — quindi contarli costerebbe quota. Che sia
  `AskUserQuestion` è scritto e verificato in `sdk-options.ts`, non rimisurato qui.

## Nota trovata per strada, non correlata

`npm run typecheck` segnala `src/cli/offline-check.ts(874,13): This kind of expression is
always truthy`. È nella verifica «OpenCode: il carico utile si legge sia in `data` sia in
`properties`», dove un `{...} as never ? A : B` prende sempre il ramo A: la prova passa
senza provare la seconda metà. Non è di questo giro (il file ha lavoro non committato di
un'altra sessione) e non è stato toccato — ma è la malattia già registrata in `CLAUDE.md`:
«una prova che guarda il posto sbagliato non fallisce, mente».
