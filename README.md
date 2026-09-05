<p align="center">
  <img src="docs/logo/stark-logo.png" alt="STARK" width="620">
</p>

<p align="center">
  <b>Una GUI per gli agent AI che scrivono codice.</b><br>
  Gira sulla tua macchina, si apre nel browser, e sostituisce il terminale invece di imitarlo.
</p>

---

## Cos'è

STARK è un **cruscotto per gli agent AI che scrivono codice** — Claude Code, OpenCode —
installati sulla tua macchina. Gira in locale, si apre nel browser, e non è un terminale
dentro una pagina web: è una GUI che **sostituisce** la TUI.

- **Tante conversazioni insieme**, in un elenco che dice chi lavora, chi ha finito e chi
  ti sta aspettando. Anche affiancate, in pannelli ridimensionabili.
- **Turni richiudibili**: un turno da quattrocento blocchi diventa una riga che si apre.
- **Permessi, domande e piani** in un blocco solo in basso, con la risposta che resta nel
  flusso — invece di scorrere via.
- **Effetti**: cosa è stato toccato, per file o in ordine di tempo, col confronto affiancato.
- **Ti chiama quando guardi altrove**: notifica di sistema, suono, push sul telefono a
  schermo spento, e un bot Telegram da cui la sessione si guida per intero.
- Il tutto **senza poter meno del CLI**: modello, modalità, server MCP, comandi slash,
  citazione dei file con `@`, quota e finestra di contesto.

Tutto resta sulla tua macchina. Le uniche due cose che escono sono il push sul telefono e
Telegram, entrambi spenti finché non li accendi, col costo scritto dove si accendono.

## Installazione

Un comando solo. Non chiede privilegi di amministratore, e non tocca il Node di sistema.

**Linux**

```sh
curl -fsSL https://starkapp.dev/install.sh | sh
```

**WSL2** — dentro la distribuzione Linux, non in PowerShell

```sh
curl -fsSL https://starkapp.dev/install.sh | sh
```

**macOS**

```sh
curl -fsSL https://starkapp.dev/install.sh | sh
```

**Windows** — in PowerShell, senza WSL

```powershell
irm https://starkapp.dev/install.ps1 | iex
```

Poi apri un terminale **nuovo** (il `PATH` è appena cambiato) e, da qualunque cartella:

```sh
stark
```

Si accende, e il browser si apre sulla pagina già autenticata.

Serve un login di Claude Code. Il CLI **non** va installato a parte: l'SDK porta il proprio
eseguibile, appaiato alla propria versione dal lockfile.

### I comandi

| | |
|---|---|
| `stark` | accendi se serve e aprimi STARK |
| `stark --no-open` | come sopra ma senza browser, per quando sei entrato da SSH |
| `stark status` | se è vivo, dove, quante conversazioni, e chi altro lo raggiunge |
| `stark stop` | lo ferma con garbo: gli agent si chiudono e i journal restano coerenti |
| `stark update` | prende l'ultima versione, ricompila, e riavvia se era acceso |
| `stark token --new` | ne fa uno nuovo, se il vecchio è finito dove non doveva |

`stark` senza altro vuol dire **«voglio usare STARK adesso»**: compila la UI se manca,
accende il daemon se non c'è, e apre il browser. È idempotente — se gira già non è un
errore, è la condizione normale. Chi lo scrive la mattina non deve ricordarsi se ieri sera
l'ha lasciato acceso.

### Cosa fa l'installer, e cosa non fa

**Niente `sudo`, e non è una comodità.** Servirebbe solo a *scrivere* il file del
lanciatore, che non ha il bit setuid: un eseguibile di proprietà di root, lanciato da un
altro utente, gira **come quell'utente**. Cioè installare da root non darebbe all'agent
nessun permesso in più — a decidere cosa l'agent può fare è **chi digita `stark`**,
esattamente come chi digita `claude` dal terminale. Lanciarlo da root non sarebbe «lo
stesso STARK con più poteri» ma **un altro STARK**: `~/.claude` e `~/.stark` seguono
l'utente, quindi cambierebbero login, journal, token e impostazioni tutti insieme. (Il
CLI, da root, per giunta *toglie* una modalità: rifiuta `bypassPermissions`.)

**Non tocca il Node di sistema.** Se quello installato è troppo vecchio, o non c'è, il
Node ufficiale finisce dentro la cartella di STARK e ci punta solo il lanciatore, con
percorso assoluto. Il tuo `PATH` resta quello che era.

**Non registra niente per l'avvio automatico.** STARK si accende quando digiti `stark`,
resta acceso anche se chiudi il terminale, e a macchina spenta resta spento: al riavvio lo
riaccendi tu. È una scelta — il daemon tiene in piedi processi di agent, e uno che riparte
da solo al boot è uno che lavora senza che nessuno gliel'abbia chiesto.

Come resta acceso dopo che hai chiuso il terminale, senza essere un servizio di sistema:
su Linux e WSL2 il daemon nasce come **unità transiente di systemd** — di sistema se sei
root, del tuo utente se non lo sei — perché `setsid()` da solo non basta: systemd traccia i
processi per cgroup, e alla chiusura di un terminale logind ferma lo scope e porta via
tutto ciò che sta dentro. Su Windows nasce con `DETACHED_PROCESS`, che è la stessa garanzia
detta nella lingua di lì: senza console ereditata, la finestra che si chiude non lo tocca.
Su macOS basta `detached`, e non c'è nessuno scope da cui scappare. Transiente vuol dire
che allo spegnimento muore e non risuscita: è esattamente ciò che si vuole.

Un limite che va detto invece di lasciarlo scoprire: da utente non root, senza
`loginctl enable-linger <utente>`, l'unità viene chiusa all'**ultimo logout**. Chiudere una
finestra di terminale va bene; disconnettersi dall'ultima sessione SSH no.

Dove finisce la roba: il codice in `~/.local/share/stark/app` (su Windows
`%LOCALAPPDATA%\stark\app`), il comando in `~/.local/bin/stark`, le conversazioni in
`~/.stark`. Le prime due si spostano con `STARK_DIR=…` davanti al comando.

## Perché esiste

Claude Code e simili si usano dal terminale, e funzionano bene. L'interfaccia però è un
flusso di testo che scorre: tutto ha lo stesso aspetto, niente si può richiudere, e ciò che
è passato è passato. **Tredici scambi di lavoro reale producono circa quattrocento blocchi**
fra testo, ragionamenti e operazioni. Dentro quel muro non si capisce più cosa è stato fatto,
quali file sono stati toccati, né quali domande sono state fatte e cosa si è risposto.

E soprattutto: non si lavora con un agent alla volta. Se ne lanciano tre o quattro in
parallelo su progetti diversi, e li si sorveglia — chi ha finito, chi è fermo ad aspettare
una risposta, chi sta ancora lavorando. Dal terminale quella sorveglianza si fa a mano,
girando fra le finestre.

STARK è un **cruscotto dei lavori in corso**, non un'app di messaggistica: la conversazione
è un sottoprodotto, quello che conta è lo stato del lavoro — e cambia proprio mentre sei
girato dall'altra parte.

> **Il principio fondante.** STARK non è un terminale nel browser: è una GUI che
> **sostituisce** la TUI. Ogni volta che una scelta tecnica costringe a «simulare il
> terminale», è la scelta sbagliata.

Il corollario che ne governa il perimetro: **STARK non deve mai poter meno del CLI.** Se il
CLI lo consente, STARK lo consente. Se il CLI lo rifiuta, la voce si mostra disabilitata
**con la spiegazione**, mai nascosta.

## Com'è fatto

```
 agent (Claude Code, via Agent SDK)
      │  messaggi nella forma dell'agent
      ▼
 adapter ──► eventi canonici ──► journal JSONL ──► reduce ──► stato
      │      l'unico punto che        append-only      funzione pura
      │      nomina Claude Code                        eventi → schermo
      ▼
 daemon: HTTP + SSE su 127.0.0.1 ──► UI nel browser (Svelte)
```

Due cose reggono tutto il resto:

- **Il vocabolario canonico.** Fuori dall'adapter nessun componente sa che esiste Claude
  Code. È quel confine a rendere possibile un secondo agent senza rifare la UI.
- **L'invariante del journal.** Lo stato dello schermo dev'essere ricostruibile *interamente*
  rileggendo il journal dall'inizio. Se la UI tenesse anche un solo dato che non nasce da lì,
  il risveglio di una sessione dormiente mostrerebbe mezzo schermo vuoto — e nessuno se ne
  accorgerebbe fino a quel momento. `core/reduce.ts` è quell'invariante resa eseguibile, e la
  UI nel browser usa **la stessa funzione** del daemon.

Il modello di eventi sta in [`docs/event-model.md`](docs/event-model.md): è il contratto fra
motore e interfaccia, e si legge prima di toccare l'uno o l'altra.

## Stato

Motore completo e funzionante: sessione vera sopra l'**Agent SDK ufficiale**, traduzione nel
vocabolario canonico, permessi in modalità `auto` con zero interruzioni, domande a scelta
multipla, journal, Sleep, risveglio con `--resume`, import di conversazioni nate nella CLI, e
il daemon con il suo perimetro di sicurezza.

**La UI legge e scrive.** Elenco dei lavori agganciato a un flusso globale, conversazione dal
vivo con turni richiudibili, casella di scrittura e Stop, permessi e domande nel blocco in
basso, effetti nelle due letture con il confronto affiancato, modello e modalità che cambiano
a caldo, nuova chat, import di conversazioni dal terminale, risveglio, rinomina, sleep,
elimina, impostazioni, e **notifiche**: suono e notifica di sistema mentre la pagina è
aperta, e **push sul telefono** quando non lo è — quelle le manda il daemon, quindi arrivano
a schermo spento. Su iPhone funzionano solo aggiungendo STARK alla schermata Home: è un
limite di Safari, e l'interruttore lo dice invece di restare un bottone morto.

Il disegno di tutte le schermate, con il perché di ogni scelta, sta in
[`docs/ui-schermate.md`](docs/ui-schermate.md) e nell'anteprima
[`docs/ui-anteprima.html`](docs/ui-anteprima.html).

## Dal repo, per svilupparci

Node **≥ 22.18**. I sorgenti TypeScript girano direttamente (`node src/….ts`), senza
build — è da 22.18 che l'esecuzione dei `.ts` è attiva senza flag. `tsc` resta necessario
per il controllo dei tipi, che lo stripping **non** fa.

```
npm install
npm run stark:install   # mette `stark` nel PATH dell'utente — una volta sola
stark
```

Il lanciatore è uno script di poche righe con dentro due percorsi assoluti — il Node e
questo repo: il codice resta quello del repo, quindi un `git pull` lo aggiorna da sé. Va
rigenerato solo se sposti il repo o cambi Node, e lo dice il file stesso, in testa.
`npm run stark:install -- --system` lo mette invece in `/usr/local/bin` (vuole root, e
vedi sopra perché di norma non conviene).

A mano, senza installare niente, restano le due righe di prima:

```
npm run ui:build      # la UI è servita dal daemon, va compilata una volta
npm run stark:start   # daemon staccato: sopravvive alla chiusura del terminale
```

L'indirizzo stampato contiene il token una volta sola. Al primo caricamento STARK lo sposta
in un cookie e lo toglie dalla barra degli indirizzi.

**L'indirizzo è sempre lo stesso** — `http://127.0.0.1:4571` — e il token **non cambia più a
ogni avvio**: si può tenere una scheda aperta, che dopo un riavvio del daemon si ricollega da
sola. Il motivo non è la comodità: quando il daemon muore, muoiono con lui i processi degli
agent, e riaprire una conversazione rilegge tutto il contesto — cioè **costa quota**.

| | |
|---|---|
| `npm run stark:install` | installa il comando `stark`. Una volta per macchina |
| `npm run stark:start` | lo avvia **staccato**: chiudere il terminale non lo tocca |
| `npm run stark:status` | se è vivo, dove, e quante conversazioni ha |
| `npm run stark:stop` | lo ferma con garbo: gli agent si chiudono e i journal restano coerenti |
| `npm run stark` | in primo piano, per guardarlo lavorare. Ctrl-C lo ferma |
| `npm run stark:token -- --new` | ne fa uno nuovo, se il vecchio è finito dove non doveva |

## La skill dei todo

La colonna Todo legge `.stark/todo.json` dentro il progetto; a scriverlo è l'agent, e a
insegnarglielo è la skill in **`.claude/skills/stark-todo/`**.

**Non c'è niente da installare.** Sta lì e non in `~/.claude/skills/` perché è una skill
*di progetto*: Claude Code carica `.claude/skills/<nome>/SKILL.md` dal repo in cui si sta
lavorando, quindi clonando è già attiva. Un comando di installazione avrebbe voluto dire un
passo in più da ricordare, una copia da tenere allineata a mano, e una skill che può
divergere dal codice che la usa.

## Comandi

| | |
|---|---|
| `npm run stark` | il daemon in primo piano (staccato: `stark:start`, vedi sopra) |
| `npm run ui:dev` | la UI con ricarica a caldo, in parallelo al daemon |
| `npm run ui:build` | compila la UI in `ui/dist`, che è ciò che il daemon serve |
| `npm run check` | catena completa su eventi finti: 269 verifiche, **zero quota spesa** |
| `npm run typecheck` · `npm run ui:check` | controllo dei tipi, motore e UI |
| `npm run slice` | sessione Claude Code vera, poi Sleep, poi replay del journal |
| `npm run resume` | prova il risveglio: spegne la sessione e verifica che il modello ricordi |
| `npm run takeover` | cosa succede con due processi sulla stessa sessione |
| `npm run import -- <trascritto.jsonl>` | apre in STARK una conversazione nata nella CLI |
| `npm run daemon` | prova il daemon da capo a fondo: 103 verifiche, perimetro compreso (con `-- --reveal` una in più, che apre una finestra vera) |
| `npm run diff` | fa modificare un file davvero e disegna il confronto affiancato |
| `npm run queue` | manda due prompt ravvicinati e verifica che restino due turni, in fila |
| `npm run icons` · `python3 tools/gen-logo.py` | rigenerano icone e marchio dalle sorgenti |
| `node tools/gen-app-icons.mjs` | rigenera l'icona dell'app (schermata Home) dal marchio |

`npm run check` è quello da eseguire spesso: la risorsa scarsa è la quota, non i dollari, e
un test che costa un turno di modello è un test che nessuno esegue.

### Variabili per `npm run slice`

| | |
|---|---|
| `STARK_MODEL` | default `claude-sonnet-5`. Con un modello che non regge auto mode la sessione riparte in Manual e la fetta lo segnala. |
| `STARK_MODE` | default `auto` |
| `STARK_ASK` | tool per cui chiedere il permesso, separati da virgola. Vuoto = zero interruzioni. `STARK_ASK=Bash` mostra il comportamento voluto: `Write` ed `Edit` passano dal classificatore, solo `Bash` torna indietro. |
| `STARK_PROMPT` | il prompt da mandare |

## Sicurezza

STARK esegue comandi arbitrari, e sulla macchina di sviluppo lo fa **come root**. La
sicurezza qui è un requisito, non un accorgimento.

Un server su localhost **non** è al sicuro per il fatto di essere su localhost: qualunque
pagina web tu abbia aperta può mandargli richieste. Le difese sono quattro e coprono attacchi
diversi:

- **indirizzo** — si ascolta esplicitamente su `127.0.0.1`, non su tutte le interfacce
- **`Host`** — ferma il DNS rebinding, cioè un dominio dell'attaccante che punta a `127.0.0.1`.
  È l'unica cosa che il browser non lascia falsificare, ed è per questo che regge
- **`Origin`** — ferma le richieste che arrivano da un altro sito
- **token** in `Authorization: Bearer` o in un cookie `SameSite=Strict`, confrontato a tempo
  costante — distingue STARK da qualunque altro processo sulla macchina

Nessuna intestazione CORS, di proposito.

**Il token sta su disco**, in `~/.stark/token` con permessi `0600`, e non cambia più a ogni
avvio: senza, un daemon che sopravvive al terminale cambierebbe indirizzo ogni volta e nessuna
scheda aperta funzionerebbe due volte. Il costo va detto: è un segreto a riposo. Sta accanto ai
journal, che nella stessa cartella contengono già tutto ciò che l'agent ha letto — chi può
leggere il token può già leggere quelli. `npm run stark:token -- --new` ne fa uno nuovo.

Distinzione che vale la pena tenere ferma: questi controlli **non** limitano ciò che puoi
fare. Limitano *chi altro* può guidare l'agent. Il CLI non ne ha bisogno perché non ha
superficie di rete; una web app quella protezione implicita la perde, e il token la
restituisce.

## Dove finiscono le conversazioni

In `~/.stark/sessioni/`, **fuori dal repo**. Un journal importato contiene la conversazione
intera, compreso tutto ciò che l'agent ha letto: sta fuori da git per costruzione, non per
una riga di `.gitignore` che qualcuno può cancellare per sbaglio.

Riprendere una sessione richiede il trascritto dell'agent, quindi STARK non usa
`--no-session-persistence`. Il journal di STARK ricostruisce lo schermo; il contesto del
modello vive nel trascritto dell'agent. Sono due memorie diverse e servono entrambe.

## Dove stanno le decisioni

Le motivazioni, gli ADR e la roadmap **non stanno in questo repo**: stanno su Notion, e i
collegamenti sono in [`CLAUDE.md`](CLAUDE.md). Qui c'è il codice e le specifiche che cambiano
insieme al codice — il modello di eventi e il disegno delle schermate.

Ogni decisione strutturale è registrata come ADR **con la motivazione**, così che se un
domani la si rimette in discussione si sappia su quali premesse era stata presa.

## Crediti

Marchio in `docs/logo/`. `stark-wordmark.svg` è vettorizzato dall'originale e usa
`currentColor`: la stessa immagine sta bene sul chiaro e sullo scuro, senza varianti da
tenere allineate. Icone: [Lucide](https://lucide.dev), licenza ISC. Caratteri: IBM Plex Sans
e IBM Plex Mono, licenza OFL.
