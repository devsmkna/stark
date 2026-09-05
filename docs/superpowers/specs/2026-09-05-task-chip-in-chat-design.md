# Board in chat: `#NNN` diventa un chip cliccabile

**Data**: 2026-09-05 · **Card**: #31 · **Stato**: approvata dall'utente in conversazione

## Problema

Quando in chat arriva una richiesta di lavoro (task, fix), l'agent oggi legge la board e
fa il claim (regola del blocco gestito), ma la conversazione non mostra *quale* card sta
lavorando: il collegamento fra la chat e la Board esiste solo nella testa dell'agent.
L'utente vuole vederlo nel flusso — la card citata, parsata, cliccabile — e dal click
arrivare al dettaglio del task nella Board.

## Decisione sul meccanismo

L'agent scrive **solo `#NNN`** nel testo (stile GitHub). La UI riconosce il pattern,
chiede i dati alla board e renderizza. La verità viene **dalla board, non dal testo**:
la card non può essere stantia rispetto a ciò che l'agent ha scritto, e funziona anche
quando `#NNN` lo scrive l'utente.

Alternative scartate: blocco strutturato emesso dall'agent (dati che possono divergere
dalla board, dipende dall'obbedienza del modello); link espliciti `stark://task/NNN`
(più verbosi, stesso risultato).

## 1. Lato agent

Il blocco board che STARK scrive in `CLAUDE.md`/`AGENTS.md` (`allineaContestoBoard` in
`src/daemon/board.ts`) si estende con una regola:

> Quando la richiesta è un task o un fix, verifica se corrisponde a una card della
> board. Se sì, **citala come `#NNN`** nella risposta e falle claim. Se no, creala
> (regola già esistente) e cita l'id nuovo.

Vale per tutti i progetti con board e per entrambi gli adapter: nessuna modifica
all'SDK, è testo di contesto.

## 1-bis. Trigger interno a STARK (emendamento, stessa data)

Il trigger non deve dipendere **solo** dai file di progetto: un blocco in `CLAUDE.md`
vale dove è scritto e finché nessuno lo toglie. Quando la sessione nasce o si risveglia
in un progetto con `.stark/kanban/`, l'adapter inietta l'istruzione board **da dentro
STARK**:

- **Claude Code**: `systemPrompt: { type: 'preset', preset: 'claude_code', append: '…' }`
  — documentato nell'SDK (`sdk.d.ts:2073`), il preset resta intero e l'istruzione si
  somma.
- **OpenCode**: campo `system` sulla richiesta di prompt. **Da misurare prima di usarlo**:
  i tipi non dicono se `system` si somma o *sostituisce* il prompt dell'agent — se
  sostituisce, sarebbe un agent istruito meno del terminale (rovescio del Principio 5).
  Regola nota: i default dell'SDK non sono i default del CLI, e si scoprono misurando.

I due canali **si sommano, non si escludono**: il blocco nei file di progetto resta,
perché copre il CLI nel terminale e qualunque altro strumento che legga `CLAUDE.md`/
`AGENTS.md`. Il canale interno copre ogni sessione STARK anche dove il blocco manca o è
stato rimosso.

Limite dichiarato: board creata a metà sessione → l'append entra al prossimo
risveglio/sessione, non a caldo, perché l'append si fissa alla costruzione delle
opzioni.

## 2. Riconoscimento UI

Pattern `#NNN` (1–4 cifre) nel testo della chat, **messaggi dell'utente compresi**.
La risoluzione è numerica: `#012` e `#12` sono lo stesso task — i file della board
paddano a tre cifre, ma `id` è un numero e il confronto si fa su quello.
Post-process **sul DOM dopo** il render markdown, stesso aggancio di `decoraColoriDom`
in `ui/src/lib/markdown.ts`: cammina solo i nodi testo, mai dentro `code`, `pre` o link
già esistenti.

Un `#NNN` diventa chip **solo se** il progetto ha una board **e** l'id esiste in essa.
Altrimenti resta testo intatto: un `#123` che parla di una issue GitHub non deve
travestirsi da task.

## 3. Dati

La UI risolve gli id contro la board del progetto tramite la rotta esistente del daemon
(quella che serve già `Board.svelte`), con cache in store **per progetto**.

Refresh: al primo `#NNN` incontrato senza cache, e **a fine turno dell'agent** — il
claim e i `move` cambiano lo stato mentre lavora, e un chip che mostra uno stato vecchio
è una board che mente nel posto più visibile.

## 4. Forma (varianti scelte: B + D)

- **Chip inline (B), sempre**: pallino colore stato + `#NNN` in mono + titolo troncato.
  Sta nella frase senza spezzarla.
- **Card blocco (D), solo alla prima citazione del turno**: riquadro stile card della
  board — titolo, badge stato, badge priorità (se alta), `claimed_by` — inserito dopo
  il paragrafo che la cita. Citazioni successive dello stesso task nello stesso turno:
  solo chip.

Mockup approvato: quattro varianti mostrate in HTML coi colori di `docs/ui-anteprima.html`;
l'utente ha scelto B inline + D alla prima citazione.

## 5. Click

Chip e card aprono la **Board col task già aperto nel dettaglio** (`aperta` in
`Board.svelte`): metodo store tipo `openBoardTask(id)`, e `Board.svelte` accetta una
selezione iniziale. Regola del link prevedibile: il click apre sempre quel task, anche
se la Board è già visibile su un altro.

## 6. Degradazione

Board rimossa, `kanban-md` mancante, id sparito dalla board: nessun chip, testo normale.
Mai un errore visibile in chat per un pattern che non si risolve.

## 7. Prove

Unit sul post-processor: match, no-match (board assente, id inesistente), `#NNN` dentro
un code fence o un link che resta intatto, prima-citazione-del-turno che produce la card
blocco una volta sola. Agganciate a `npm run check` come le prove esistenti.

## Fuori scope (detto esplicitamente)

Chip nei titoli delle sessioni; ricerca per `#NNN`; parsing lato daemon.
