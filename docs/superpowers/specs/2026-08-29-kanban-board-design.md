# La Board — kanban-md come motore, STARK come GUI

Spec di design, 29 agosto 2026.

Una bacheca in stile Jira/Trello per progetto, **file-based e agents-first**, costruita
sopra lo strumento esistente **kanban-md** (MIT, binario Go) invece di reimplementarlo.
La board è la **superficie di coordinamento centrale** per gli agent: se un progetto ha
una board, gli agent ci parlano quasi sempre.

---

## 1. Da dove nasce, e cosa NON è

La richiesta di partenza era *«un board manager semplice (as simple as possible)»*. La
ricerca ha trovato **kanban-md**: un kanban file-based pensato apposta per i flussi
multi-agent (claim atomici, output token-efficiente, skill pre-scritte per gli agent).
La scelta di integrarlo invece di scriverne uno nostro è la regola di STARK già scritta:
*«se esiste qualcosa di ufficiale e già pronto, si preferisce sempre… a dover essere
motivato è il non usarlo»*.

### Non è

- **Non è un clone di Jira/Trello.** Non c'è un modello parallelo di task: la fonte di
  verità sono i file di kanban-md (`.stark/kanban/tasks/*.md` + `config.yml`), che STARK
  legge e modifica **solo** attraverso il CLI. Nessuna reimplementazione di claims,
  `next_id`, atomicità.
- **Non è un secondo sistema di task.** Il sistema todo esistente
  (`.stark/todo.json` + sidebar) **resta**: è la lista veloce "dove sono" per chat. La
  board è la gestione del progetto. Due sistemi, due scopi, tenuti separati di proposito.
- **Non è un editor a drag&drop** nell'MVP. Lo spostamento fra colonne avviene dai
  dettagli della card (via `edit`), non trascinando.

## 2. Il principio che decide i casi al bordo

> Se un progetto ha una board, gli agent ci parlano quasi sempre.

È il cuore della richiesta: la board non è una vista di gestione, è la **superficie di
coordinamento**. Un agent che lavora in un progetto con board deve leggerla, agganciarsi
a un task (claim), aggiornarne lo stato mentre lavora. Quando una scelta di design è
ambigua, si risolve chiedendosi quale delle due strade tiene viva questa centralità.

Corollario: **se non c'è una board, niente cambia.** Il comportamento di oggi resta
identico. La board è un'aggiunta, non una sostituzione.

## 3. Architettura

**kanban-md come motore, STARK come GUI.** Il daemon non reimplementa nulla: per ogni
operazione esegue il binario `kanban-md` con `--dir <progetto>/.stark/kanban`. La UI
disegna la board e parla col daemon. Gli agent usano il CLI di kanban-md direttamente
(con le sue skill).

Componenti:

1. **Binario** — scaricato dall'installer dentro la cartella di STARK, chiamato dal
   daemon con **percorso assoluto** (lezione Tailscale: niente `PATH`). Uno per
   piattaforma: macOS arm64, WSL (Linux amd64), Windows nativo.
2. **Daemon** — nuovi endpoint:
   - `GET /api/board?cwd=…` → legge la board (`kanban-md list --json`), raggruppata per
     colonna.
   - `POST /api/board/task` → crea (`kanban-md create`).
   - `POST /api/board/task/:id/edit` → modifica stato/titolo/priorità (`kanban-md edit`).
   - `POST /api/board/init` → inizializza (`kanban-md init --dir`).
   - `boardStream` SSE con **file-watching** su `.stark/kanban/` (stesso pattern di
     `todo.ts`: watch sulla cartella, timer di sicurezza).
   - Il `cwd` si risolve dall'id sessione (mai un percorso dal browser) — stessa regola
     di `/todo`.
3. **UI** — una vista "board" (modo) a tutto schermo con colonne, card, dettaglio card;
   progetto a fuoco di default + selettore.
4. **Sicurezza** — il daemon valida l'id task prima di passarlo al CLI (niente iniezione
   di argomenti). Il percorso del binario è assoluto e sotto il controllo dell'installer.

## 4. Dove vive la board

`.stark/kanban/` dentro il progetto (kanban-md con `--dir`). Scelto perché tutto il
tooling STARK sta in `.stark/`; il default di kanban-md (`kanban/`) si sposta con `--dir`.

## 5. Modello dati

**Fonte di verità = i file di kanban-md.** STARK non ha un modello parallelo: legge
`kanban-md list --json` e raggruppa per colonna.

- **Colonne** = gli `statuses` di `config.yml` (default: `backlog, todo, in-progress,
  review, done, archived`). L'ordine è quello del config.
- **Card** = i campi che kanban-md espone: `id`, `title`, `status`, `priority`,
  `assignee`, `tags`, `due`, `estimate`, `class`, `claimed_by`, `created`, `updated`,
  `blocked`. In board la card mostra: titolo, priorità (badge), assegnatario, eventuale
  claim.
- **Dettaglio card** (si apre cliccando): tutti i campi + il corpo markdown. Da qui si
  **cambia stato** (dropdown = `move`), si **modifica titolo/priorità** (`edit`), si
  **archivia** (`archive`). Niente drag&drop in MVP.
- **Create**: form minimale (titolo + opzionali: priorità, descrizione) → `create`.

## 6. La vista board nella UI

- **Apertura**: bottone/tab nella barra in alto (accanto al toggle Todo) che apre il
  "modo" board a tutto schermo.
- **Layout**: colonne orizzontali (una per status, nell'ordine del `config.yml`), card
  dentro. Ogni colonna ha il conteggio. Card compatta: titolo + badge priorità +
  assegnatario/claim.
- **Clic su card** → pannello dettaglio (a lato o sovrapposto): tutti i campi, corpo
  markdown, azioni.
- **Create**: bottone "+" che apre un form minimale.
- **Progetto**: selettore in cima — default il progetto della chat a fuoco, cambia col
  dropdown.
- **Live**: SSE + file-watching su `.stark/kanban/` → quando un agent sposta/crea card,
  la UI si aggiorna da sola. È il "quasi sempre": vedi cosa fanno gli agent mentre
  lavorano.

## 7. Gli agent e la board

Quando un progetto **ha una board**, STARK:

1. **Installa le skill di kanban-md nel progetto** (non globali), così ogni agent che ci
   lavora le ha automaticamente (per Claude Code, OpenCode, Codex).
2. **Inietta un riassunto della board nel contesto** delle sessioni di quel progetto
   (`kanban-md context`), così l'agent "vede" la board senza doverci pensare.

Se il progetto **non ha** una board, niente di tutto questo: comportamento invariato.

## 8. Errori e casi limite

- **Board non inizializzata**: progetto senza `.stark/kanban/` → vuoto con bottone
  "Inizializza" (`init`).
- **Binario mancante/corrotto**: il daemon mostra un errore chiaro (non un crash muto) e
  suggerisce di reinstallare.
- **File scritto a metà / JSON non valido**: kanban-md è tollerante (si auto-ripara), ma
  se `list --json` fallisce la UI mostra il motivo invece di un vuoto muto — stesso
  pattern di `todo.ts` (`scartate`/`motivo`).
- **Concorrenza**: agent e UI scrivono insieme. STARK va **sempre** attraverso il CLI di
  kanban-md (che gestisce atomicità, claims, `next_id`) — mai scrittura diretta dei file.
  Questo elimina la classe di bug "due scrittori".
- **Id task non valido**: validazione prima di passarlo al CLI (niente iniezione di
  argomenti).
- **Progetto a fuoco senza sessione**: la board mostra il selettore, non un errore.

## 9. Direzione futura (non MVP)

**Board collaborative**: un collega potrà "accedere alla mia board" — accesso remoto alla
board, coerente con l'accesso remoto che STARK ha già via Tailscale/`STARK_PUBLIC_HOST`.
La scelta file-based+git di kanban-md è quella giusta per arrivarci. Rimandato, non
buttato.
