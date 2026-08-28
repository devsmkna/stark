# La Mappa — costruzione visiva del sistema e del lavoro

Spec di design, 28 agosto 2026.

Una tela per progetto che dice **com'è fatto** il sistema e **dove c'è lavoro**,
costruita insieme all'agent e modificabile da entrambi.

---

## 1. Da dove nasce, e cosa NON è

La richiesta di partenza era un'altra: *«il nuovo pattern di agentic loop
development»*. La ricerca è stata fatta e sta al §9, perché resta utile — ma il
brainstorming l'ha scartata a metà strada, su indicazione esplicita dell'utente
(«confermo che non mi interessa loop, mi interessa **costruzione visiva**»).

Va scritto perché il prossimo che legge questa spec potrebbe rimetterci il loop:
**la Mappa non è l'interfaccia di un loop agentico.** Il loop era la cornice di
chi ha portato la ricerca; la cosa a cui l'utente è tornato tre volte su tre è
un'altra — vedere il piano e l'architettura come nodi, e costruirli parlando.

Le due funzionalità sono **indipendenti**. Un piano a nodi vale identico se poi
lo esegue un loop, se lo esegui tu a mano, o se lo esegue un agent normale in una
chat. Il loop è rimandato, non buttato.

### Non è

- **Non è un secondo piano.** Il lavoro appeso ai nodi è quello di
  `.stark/todo.json`, letto per **luogo** invece che per ordine. Due elenchi
  divergerebbero: è lo stesso difetto già evitato nello Store con
  `snap`/`link`/`view`.
- **Non è un generatore di diagrammi del codice.** Non è UML, non è una
  dependency graph automatica. Ci vanno le dieci o quindici caselle che si
  tengono in testa ragionando, non trecento.
- **Non è un editor di grafi a nodi liberi.** Non si costruisce trascinando
  primitive da una palette. Si costruisce **parlando**, e la tela mostra ciò che
  è stato deciso.

## 2. Il principio che decide i casi al bordo

> Un nodo dice sempre **se corrisponde a codice vero o è ancora un'intenzione**.

È la regola di STARK già applicata dappertutto — mai nascondere ciò che non c'è,
mostrarlo spento con la ragione — portata su una tela. Una mappa che disegna
uguale ciò che esiste e ciò che vorremmo è la ragione per cui questi strumenti
muoiono: smette di essere consultabile nel momento in cui non ci si può più
fidare a colpo d'occhio.

Quando una scelta di design è ambigua, si risolve chiedendosi quale delle due
strade conserva questa distinzione.

## 3. Il modello

Un file per progetto: **`.stark/mappa.json`**, accanto a `todo.json`.

### Nodo

Un pezzo del sistema.

| Campo | Cosa contiene |
|---|---|
| `id` | stabile, non il nome |
| `nome` | «UI · Svelte», «Daemon», «Canvas» |
| `descrizione` | una o due frasi, quelle che diresti a voce |
| `origine` | **`codice`** o **`intenzione`** — vedi §2 |
| `percorsi` | i file/cartelle che lo compongono (solo se `codice`) |
| `stato` | `attuale` \| `stale` — un nodo `codice` i cui percorsi sono spariti |
| `chat` | gli id delle conversazioni aperte da questo nodo (§4) |
| `posizione` | dove sta sulla tela |

### Legame

Chi dipende da chi. Ha anche lui un `origine`: dedotto dagli import o messo a
mano.

### Il lavoro

**Non sta nel file.** Le voci vengono da `.stark/todo.json` e si agganciano a un
nodo per riferimento. Il conteggio sul nodo è derivato, non copiato.

## 4. Le schermate

### Dove vive — un pannello come gli altri

La Mappa si trascina nel workspace come si trascina una chat. Chat a sinistra,
Mappa a destra, divisore che si sposta.

Scelta motivata: i pannelli affiancati **esistono già e sono provati**; il grafo
ha larghezza vera; e chat e Mappa **si guardano insieme**, che è il punto della
funzionalità.

Scartate: la terza linguetta accanto a `Conversation`/`Effects` (alterna invece
di affiancare) e la barra laterale stretta come la Todo (in 260px un grafo torna
un elenco rientrato).

Costo dichiarato: il workspace oggi affianca solo **chat**, e deve imparare che
un pannello può contenere altro (`kind: 'chat' | 'mappa'`).

Sotto gli 860px decade da sé — il layout multi-pannello è già ignorato lì.

### Come si disegna un nodo

- **`codice`** → bordo pieno, coi percorsi sotto il nome
- **`codice` + lavoro appeso** → bordo acceso, con il contatore delle voci aperte
- **`intenzione`** → bordo **tratteggiato**, colore diverso, «non esiste ancora»
- **`stale`** → segnato, **mai cancellato in automatico**

### Il clic — apre una chat su quel pezzo

Cliccando un nodo nasce (o torna a fuoco) una conversazione **agganciata a quel
nodo**, coi suoi percorsi già in contesto. Il nodo ricorda le proprie chat.

È il punto in cui la Mappa smette di essere un disegno e diventa il **menu del
lavoro**, e sfrutta i pannelli affiancati appena scelti.

La **scheda** del nodo (descrizione, percorsi, lavoro appeso, rinomina, apri
cartella) non sparisce: sta nel nodo **espanso sulla tela**.

Scartata: dirottare la chat già aperta accanto — un clic curioso cambierebbe il
discorso sotto le mani.

## 5. Chi scrive, e come non si pestano i piedi

Due scrittori sullo stesso file.

**Claude scrive** → tocca `.stark/mappa.json` → il daemon se ne accorge → SSE →
la tela si ridisegna mentre lui parla.

**L'utente sposta o corregge dalla tela** → `PUT /api/mappa` → il daemon scrive →
SSE → tutti i pannelli. **E lascia una nota nel flusso** della conversazione.

### Perché la nota, e perché non un turno

Erano tre le strade:

1. **Il canvas scrive e basta.** Gratis e immediato, ma Claude non sa **perché**
   è cambiato, e al turno dopo può rimetterlo com'era in buona fede.
2. **La modifica diventa un turno.** Concettualmente pulito — una sola verità, un
   solo scrittore — ma **costa quota** per spostare un tetto da 30 a 40.
   STARK apre turni suoi in **un** solo punto (la fila FIFO), ed è una scelta
   dichiarata: non si estende a un ritocco di una tela.
3. **Ibrido, scelto.** La modifica va subito nel file, e deposita una **riga nel
   flusso** — una nota, non un turno. Claude la legge al prossimo turno che fa
   comunque, e la tratta come detta dall'utente.

**Ordine**: l'ultimo che scrive vince, **con la nota a dirlo**. Mai una
sovrascrittura muta.

## 6. Come è fatta dentro

| Pezzo | Dove | Cosa fa |
|---|---|---|
| `core/mappa.ts` | modello puro | tipi e funzioni: aggiungi, sposta, collega, **riconcilia** una semina con la mappa esistente. Niente Svelte, DOM, fs. |
| `daemon/mappa.ts` | daemon | legge/scrive `.stark/mappa.json`, lo sorveglia, lo serve |
| rotte | daemon | `GET /api/mappa?cwd=`, `PUT /api/mappa`, cambi sul flusso SSE esistente |
| `Mappa.svelte` | UI | la tela |
| `ui/src/lib/mappa-layout.ts` | UI | posizionamento dei nodi, **puro e a parte** |
| skill `stark-mappa` | disco | come l'agent legge e scrive il file |

### La cosa che rende tutto economico

**L'agent non ha bisogno di nessuna capacità nuova.** Scrive un file JSON con gli
strumenti che ha già. Il pezzo «costruzione con Claude» è **una skill, non
codice** — ed è esattamente ciò che `stark-todo` ha già dimostrato in questo
stesso progetto.

Le funzioni pure si provano con `node`, come `layout.ts` (22 verifiche) e
`gruppi.ts` (24). Precedente in casa, due volte.

### L'unico innesto nel modello canonico

**`map.edited`**, evento nuovo nel journal della chat a fuoco. Non un turno: un
fatto mostrato, come `context.cleared` e la riga della compattazione.

La UI dichiara al daemon **in quale sessione** va la nota — la Mappa è del
progetto, il journal è della chat, e il ponte va dichiarato invece che
indovinato.

### Cosa NON si tocca

Il contratto degli adapter (§1 di `event-model.md`), il vocabolario degli eventi
degli agent, la quota. La Mappa vive **sopra** il journal, non dentro il canale
con l'agent.

## 7. La semina

Un comando manda l'agent a leggere il repo e **proporre** la prima passata —
proporre, non scrivere: la si vede e si accetta.

Da lì in poi ci si lavora parlando. I nodi `codice` si possono **rinfrescare** su
richiesta; quelli aggiunti a mano non li tocca nessuno.

Scelta motivata: una mappa **solo derivata** dal codice è sempre vera ma mostra
solo ciò che esiste — e la tela serve a progettare ciò che ancora non c'è. Una
mappa **solo a mano** contiene il futuro ma marcisce. La semina più la
costruzione a mano tiene entrambe, a patto che §2 resti vero.

## 8. Cosa va storto, e cosa si fa

| Caso | Condotta |
|---|---|
| `mappa.json` illeggibile | si **rifiuta**, non si sovrascrive. È un file dell'utente (precedente: `memoria.ts`, `regole.ts`) |
| nodo `codice` coi percorsi spariti | si marca **stale**, non si cancella: è cambiato il codice, non l'intenzione di parlarne |
| la semina propone 200 nodi | tetto, e si **dice** cosa è stato tagliato — un limite silenzioso si legge come «ho coperto tutto» |
| due pannelli sulla stessa Mappa | uno solo, come le chat: due sottoscrizioni sullo stesso stato possono divergere |
| progetto senza `.stark/` | il pannello dice cosa fare, non resta vuoto |
| voce di `todo.json` appesa a un nodo cancellato | la voce **sopravvive** e torna senza nodo: il lavoro non si perde perché è cambiata la mappa |

## 9. La ricerca sui loop agentici (rimandata, non buttata)

Fatta il 28 agosto 2026. Il pattern:

**Agent development** = una sessione che cresce, e degrada — context rot,
fallimenti accumulati, spec che esce dalla finestra.

**Agentic loop (Ralph, Huntley, luglio 2025)** = N sessioni corte in un `while`.
Ogni giro butta il contesto e rilegge lo stato **da disco**. L'imprevedibilità di
una run si media su cento.

Le quattro parti che contano:

1. **Anchor files** — la memoria è il filesystem, non il contesto (`VISION.md`,
   spec, git)
2. **Gate di verifica oggettivo** — test/typecheck. Loop *aperto* (l'agent dice
   «fatto») = demo; *chiuso* (un oracolo dice «fatto») = spedibile
3. **Stop hook** — intercetta l'uscita, controlla il criterio, **reinietta** il
   prompt
4. **Guardrail** — tetto di iterazioni, no-progress detection, **tetto di spesa**

Stato dei tool ad agosto 2026: il loop è già una **primitiva** — Claude Code
`/goal` (2.1.139, maggio 2026) e `/loop`; Codex CLI `/goal` (0.128.0, aprile
2026); Gas Town (Yegge) per il parallelo. Quindi se un giorno si farà, **non si
scrive il loop**: si usa quello che c'è.

Il buco che resta scoperto, e che la Mappa **non** copre: l'osservabilità del
loop mentre gira — a che giro siamo, sta progredendo o gira a vuoto, quanto ho
speso. Le fonti alla voce «observability» propongono `tail -f` per iterazione.
STARK avrebbe i pezzi (journal, pannelli, quota, push), ed è la cosa da
riprendere se il tema torna.

Fonti principali:
[loop engineering](https://explainx.ai/blog/loop-engineering-coding-agents-claude-code-guide-2026) ·
[Simon Willison](https://simonw.substack.com/p/designing-agentic-loops) ·
[decodingai](https://www.decodingai.com/p/ralph-loops) ·
[dwmkerr](https://dwmkerr.com/ralph-wiggum-loop/)

## 10. Come si prova

- **`npm run mappa:check`** — le funzioni pure di `core/mappa.ts` e
  `mappa-layout.ts` con `node`, sul modello di `layout:check` e `gruppi:check`.
  Coprono: riconciliazione di una semina con nodi aggiunti a mano (i nodi
  dell'utente non spariscono), un nodo `codice` che diventa `stale`, un legame
  verso un nodo cancellato, la posizione conservata attraverso un rinfresco.
- **`npm run daemon`** — le rotte: JSON illeggibile rifiutato, `cwd` inesistente
  respinta al confine, `map.edited` che finisce nel journal dichiarato.
- **Guidando la UI vera**, non per esito HTTP: un nodo trascinato che resta dove
  l'hai messo dopo un ricaricamento; il clic che apre davvero la chat sul pezzo;
  la nota che compare nel flusso; e a 390px la Mappa che **non** compare.

## 11. Cosa resta fuori, e si dice invece di scoprirlo dopo

- **Il loop.** §9. Rimandato.
- **Più mappe per progetto.** Una sola, `.stark/mappa.json`. Se servisse, il
  percorso diventa `.stark/mappe/<nome>.json` senza cambiare il modello.
- **Mappa condivisa fra le due macchine.** I journal non si sincronizzano (vedi
  CLAUDE.md); `mappa.json` invece sta nel repo, quindi git la porta di suo. Non
  è un pezzo da costruire, è una conseguenza da verificare.
- **Il grafo che si dispone da solo** (auto-layout). Prima passata: posizioni
  dalla semina, poi le sposti tu e restano.
