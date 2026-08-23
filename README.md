# STARK

Interfaccia web locale per gestire le sessioni con gli agent AI installati sulla macchina.
Le decisioni e la roadmap stanno su Notion; qui c'è il codice e la specifica che cambia col
codice. Vedi `CLAUDE.md` per i link e `docs/event-model.md` per il modello di eventi.

## Stato

Fetta verticale funzionante: avvio di una sessione Claude Code, traduzione nel vocabolario
canonico, journal JSONL, Sleep e ricostruzione dello stato dal journal. Nessuna UI.

## Requisiti

Node **≥ 22.18**. I sorgenti TypeScript girano direttamente (`node src/…​.ts`), senza build:
è da 22.18 che l'esecuzione dei `.ts` è attiva senza flag. `tsc` resta necessario per il
controllo dei tipi, che lo stripping **non** fa.

```
npm install
```

## Comandi

| | |
|---|---|
| `npm run typecheck` | controllo dei tipi. Nessun file emesso. |
| `npm run check` | catena completa su eventi finti: 15 verifiche, **zero quota spesa** |
| `npm run slice` | sessione Claude Code vera, poi Sleep, poi replay del journal |
| `npm run resume` | prova il risveglio: spegne la sessione e verifica che il modello ricordi |
| `npm run takeover` | cosa succede con due processi sulla stessa sessione |
| `npm run import -- <trascritto.jsonl>` | apre in STARK una conversazione nata nella CLI |
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

## Dove finiscono i journal delle conversazioni vere

In `~/.stark/sessioni/`, **fuori dal repo**. Un journal importato contiene la conversazione
intera: sta fuori da git per costruzione, non per una riga di `.gitignore` che qualcuno può
cancellare per sbaglio.

Riprendere una sessione richiede il trascritto di Claude Code, quindi le sessioni di STARK
non usano `--no-session-persistence`. Il journal di STARK ricostruisce la UI; il contesto del
modello vive nel trascritto dell'agent. Sono due memorie diverse e servono entrambe.
