# STARK

Interfaccia web locale per gestire le sessioni con gli agent AI installati sulla macchina.
Le decisioni e la roadmap stanno su Notion; qui c'è il codice e la specifica che cambia col
codice. Vedi `CLAUDE.md` per i link e `docs/event-model.md` per il modello di eventi.

## Stato

Fetta verticale funzionante sopra l'**Agent SDK ufficiale** (ADR-009): avvio di una sessione,
traduzione nel vocabolario canonico, permessi e domande a scelta multipla, journal JSONL, Sleep,
risveglio e ricostruzione dello stato dal journal. Nessuna UI.

## Requisiti

Node **≥ 22.18**. Claude Code **non** va installato a parte: l'SDK porta il proprio. I sorgenti TypeScript girano direttamente (`node src/…​.ts`), senza build:
è da 22.18 che l'esecuzione dei `.ts` è attiva senza flag. `tsc` resta necessario per il
controllo dei tipi, che lo stripping **non** fa.

```
npm install
```

## Comandi

| | |
|---|---|
| `npm run typecheck` | controllo dei tipi. Nessun file emesso. |
| `npm run check` | catena completa su eventi finti: 26 verifiche, **zero quota spesa** |
| `npm run slice` | sessione Claude Code vera, poi Sleep, poi replay del journal |
| `npm run resume` | prova il risveglio: spegne la sessione e verifica che il modello ricordi |
| `npm run takeover` | cosa succede con due processi sulla stessa sessione |
| `npm run import -- <trascritto.jsonl>` | apre in STARK una conversazione nata nella CLI |
| `npm run stark` | **avvia il daemon** e stampa indirizzo e token |
| `npm run daemon` | prova il daemon da capo a fondo, perimetro di sicurezza compreso |
| `npm run diff` | fa modificare un file davvero e disegna il confronto affiancato |
| `npm run build` | emette JS in `dist/`. Serve solo se un giorno si vuole distribuire compilato. |

`npm run check` è quello da eseguire spesso: la risorsa scarsa è la quota, non i dollari, e un
test che costa un turno di modello è un test che nessuno esegue.

### Variabili per `npm run slice`

| | |
|---|---|
| `STARK_MODEL` | default `claude-sonnet-5`. Con un modello che non regge auto mode la sessione riparte in Manual e la fetta lo segnala. |
| `STARK_MODE` | default `auto` (ADR-008) |
| `STARK_ASK` | nomi di tool separati da virgola per cui chiedere il permesso. Vuoto = zero card. `STARK_ASK=Bash` mostra il comportamento di ADR-008: `Write` ed `Edit` passano dal classificatore, solo `Bash` torna indietro. |
| `STARK_PROMPT` | il prompt da mandare |

La sandbox è `spike/sandbox/vslice/`, che è gitignorata: contiene journal di sessione e
percorsi assoluti della macchina.

## Il daemon

`npm run stark` mette in ascolto un server su `127.0.0.1` con una porta casuale e stampa un
token. Il token cambia a ogni avvio: non è un segreto da conservare, è ciò che impedisce a
un'altra pagina aperta nel browser di parlare con questo processo.

| | |
|---|---|
| `GET /api/health` | il daemon risponde |
| `GET /api/sessions` | elenco delle sessioni, vive e dormienti |
| `POST /api/sessions` | apre o riprende una sessione: `{cwd, model?, mode?, resume?, askTools?}` |
| `GET /api/sessions/:id` | lo stato ricostruito |
| `GET /api/sessions/:id/events?from=N` | rilettura del journal da `N` in poi |
| `GET /api/sessions/:id/stream?from=N` | flusso SSE: prima ciò che si è perso, poi il resto |
| `POST /api/sessions/:id/command` | i comandi del §11 della specifica |

### Perché è protetto così

Un server su localhost **non** è al sicuro per il fatto di essere su localhost: qualunque
pagina web che hai aperta può mandargli richieste, e STARK esegue comandi come root. Le difese
sono tre e coprono attacchi diversi:

- **token** in `Authorization: Bearer`, confrontato a tempo costante — distingue STARK da
  qualunque altro processo sulla macchina
- **`Origin`** — ferma le richieste che arrivano da un altro sito
- **`Host`** — ferma il DNS rebinding, cioè un dominio dell'attaccante che punta a `127.0.0.1`.
  È l'unica cosa che il browser non lascia falsificare, ed è per questo che regge

Non ci sono intestazioni CORS, di proposito.

## Dove finiscono i journal delle conversazioni vere

In `~/.stark/sessioni/`, **fuori dal repo**. Un journal importato contiene la conversazione
intera: sta fuori da git per costruzione, non per una riga di `.gitignore` che qualcuno può
cancellare per sbaglio.

Riprendere una sessione richiede il trascritto di Claude Code, quindi le sessioni di STARK
non usano `--no-session-persistence`. Il journal di STARK ricostruisce la UI; il contesto del
modello vive nel trascritto dell'agent. Sono due memorie diverse e servono entrambe.
