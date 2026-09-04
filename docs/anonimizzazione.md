# Anonimizzazione — quaderno di progetto

> Documento **vivo**, aperto il 3 settembre 2026. Non è una specifica: è il registro di
> cosa abbiamo deciso, cosa abbiamo **scartato** e su quale premessa. Quando una premessa
> cade, la voce si rovescia e la ragione resta scritta, come nel resto del progetto.
>
> Stato al 3 settembre 2026, aggiornato in giornata: **impianto e infrastruttura decisi,
> pronto per la validazione.** Misura A e A-bis fatte e passate (§4, §4.3): il proxy è
> praticabile e non tocca la fatturazione. Il flusso è mappato campo per campo. Le domande
> 1, 2 e 3 del §9 sono **chiuse** (D31–D33) e la frase da vendere ha una **bozza** (§1.2).
> **La misura B è fatta** (§6.5, tre giri): il modello conserva gli alias dove sono
> sintatticamente legali e li trasforma dove non lo sono — e il pericolo non era quello
> che il documento temeva. Non è il turno bloccato: è il **passaggio silenzioso** di un
> segnaposto dentro il codice vero. Ha chiuso una risposta (S13) e **aperto la domanda
> §9.12**, che per qualche ora è stata la più grave in circolazione.
> **La §9.12 è chiusa la sera stessa, con la misura B-bis** (§6.7): gli alias prendono
> un'**àncora** — contatore + codice fusi, `[Cliente-02k7]` — che sopravvive alla
> derivazione (misurato: 2/2 nei nomi derivati, con e senza aiuto nel prompt), e il
> derivato riconosciuto **non si riconverte negli identificatori: si dichiara** (D34–D36).
> Il paesaggio delle soluzioni esistenti è stato guardato (§11bis): il pattern esiste, il
> fabbisogno no — e il proxy è la strada che Anthropic stessa indica.
> **Anche la misura A-ter è fatta, a costo zero** (§4.5): su OpenCode la leva è
> `options.baseURL` nella config del server, il prefisso sopravvive, e §9.4 si chiude con
> D37 — l'aggancio è dell'adapter, il motore è condiviso.
> **Ultimo giro di misure, a costo quasi zero** (§4.6, §4.7, §6.7): la §9.13 è largamente
> chiusa — la leva `options.baseURL` instrada **tutti e cinque** i provider di OpenCode,
> non solo anthropic; la **meccanica della pausa** è misurata — il client regge ~311 s per
> tentativo e ritenta col corpo identico, quindi si trattiene entro ~5 min legando la card
> alla sessione e non al socket, e rilasciare entro la finestra arriva in fondo (PONG); e
> l'**àncora** regge su un **secondo modello** (Haiku, oltre a Sonnet), col caso limite in
> cui il modello traduce la parola-tipo ma conserva il codice. Restano solo residui
> circoscritti (§9.14 il limite della pausa, §12bis le cinque decisioni di forma).
> **Le misure sono finite, e il 4 settembre la modalità ombra è agganciata alle
> sessioni vere.** Il proxy esiste (`src/proxy/`, §12bis) — processo separato,
> fail-closed sulle sessioni non registrate, registro intero per richiesta (D39),
> analisi delle cinque regioni con le forme note — con la sua prova a costo zero
> (`npm run ombra:check`, 20 verifiche). `stark start`/`up` lo alzano accanto al
> daemon (D19, `stark.ts` reso generico), `stop` lo lascia acceso di proposito (D15),
> ed **entrambi gli adapter** — Claude Code per sessione, OpenCode per ciclo di vita
> del server condiviso (D40, solo `anthropic` per ora — D41) — si registrano da soli,
> sempre, best-effort. Provato end-to-end su una casa scratch, non solo a unità:
> un solo avvio del proxy, `status` mostra entrambi anche a daemon fermo,
> `/control/spegni` chiude pulito. `npm run check` resta 338/338.
> Ora servono giorni di sessioni vere, e i numeri che ne escono.
>
> **Com'è fatto il traffico su cui tutto questo va applicato — endpoint, campo per campo,
> nei due versi — sta in `docs/anonimizzazione-flusso.md`.** Quello è riferimento
> misurato; questo è il registro delle decisioni.

---

## Come si legge, e dove conviene attaccarlo

Chi arriva a freddo per **validare** non deve leggere tutto in ordine. Tre strade:

- **Il verdetto in due minuti** → §10 (41 decisioni) e §11 (15 ipotesi scartate, con la
  ragione). Se una scelta sembra sbagliata, la riga dice su quale premessa era stata presa.
- **L'architettura** → §3 (i due livelli), §3.1 (perché il proxy è bidirezionale), §4bis
  (l'infrastruttura). Il resto sono conseguenze di quelle tre.
- **I fatti misurati** → §4, §4.3, §4.5, §6.5, §6.7 e `docs/anonimizzazione-flusso.md`.
  Tutto ciò che è segnato «misurato» ha una sonda in `spike/` che si può rifare.

### Cosa è misurato, cosa è dedotto, cosa è ancora scommessa

| | |
|---|---|
| **Misurato** (rifacibile) | Che `ANTHROPIC_BASE_URL` funzioni in abbonamento; che il prefisso di percorso sopravviva; quali endpoint esistono; dove vive il testo nel payload; che il ragionamento non passi in chiaro; che gli alias si spezzino fra i delta; che la risposta arrivi in gzip; **che il modello conservi l'alias dove è sintatticamente legale e lo trasformi dove non lo è** (§6.5); **che l'àncora `NNcc` sopravviva alla derivazione, senza bisogno di istruzioni nel prompt** (§6.7); **che su OpenCode `options.baseURL` funzioni e il prefisso sopravviva** (§4.5) |
| **Dedotto** da una regola del progetto | Che gli hook non bastino come garanzia (per «i tipi non sono i fatti»); che il proxy separato costi meno di uno dentro il daemon; che un filtro rumoroso venga spento |
| **Ancora scommessa** | Che il tasso di falsi positivi di «in dubbio, ferma» sia accettabile (D7); che la promessa corretta valga ancora come argomento di vendita; che B/B-bis — ora **due modelli** (Sonnet 5, Haiku 4.5), stesso fornitore — generalizzino a un fornitore diverso e a compiti più grandi |

### Le nove cose che vale la pena contestare

Sono i punti in cui, se ho sbagliato, il progetto cambia — non i dettagli.

1. **§6.5 e §6.7, e non è più quella di prima** — misurata due volte. Il modello *cita*
   gli alias ovunque siano legali, li *trasforma* dove non lo sono, e **conserva l'àncora**
   `NNcc` dentro i derivati (2/2, con e senza aiuto nel prompt). La §9.12 è chiusa da
   D34–D36. Resta contestabile la **taglia del campione**: cinque giri in tutto, un solo
   modello (Sonnet 5), compiti piccoli — e la scelta di **non riconvertire** dentro gli
   identificatori (D36), che scambia fedeltà del codice per stabilità ai giri successivi.
2. **D7, «in dubbio ferma»** — il tasso di falsi positivi non è misurato da nessuna parte.
   È l'assunzione più esposta del documento dopo la 1.
3. **D11/D12** — prefissi noti + forme larghe + file ignorati da git: **basta davvero**, o
   la promessa corretta è ancora troppo generosa?
4. **§2 e D25** — che il `tool_result` sia davvero l'imbuto principale è misurato su **una**
   sessione con **un** insieme di tool. Un controesempio lo smonta.
5. **§5.2 del flusso** — «il ragionamento non passa in chiaro» è un'osservazione su una
   configurazione, non una legge. Se cade, torna il vincolo di reversibilità byte per byte.
6. **D15/D16** — un processo separato *sempre* in mezzo è un costo operativo permanente
   pagato da ogni sessione, comprese quelle che non usano la funzione.
7. **D22/D23/D24** — la prassi `.env` per condividere il dizionario: regge al contatto con
   una squadra vera, o è il modo in cui la chiave di lettura di tutto finisce in una chat?
8. **§1.1 e §1** — dopo tutte le correzioni, la promessa che resta è ancora un argomento di
   vendita, o è diventata una nota tecnica?
9. **D30, §5.5** — è **l'unica eccezione** a «in dubbio, ferma» in tutto il sistema: un
   allegato non filtrabile passa dietro un avviso invece di essere rifiutato. La distinzione
   che la giustifica — atto dell'utente contro atto dell'agent — regge, o è il primo
   cedimento da cui poi ne arrivano altri?

---

## 0. Il problema, in una riga

STARK fa lavorare un agent che manda a un modello **di terzi** il codice e i dati su cui
opera. Alcuni di quei dati non devono uscire dalla macchina. Serve uno strato che lo
impedisca, senza rendere l'agent stupido e senza promettere una protezione che non c'è.

---

## 1. Le premesse, fissate con l'utente

**Da cosa ci difendiamo** — tre cose insieme: il provider vede i dati in chiaro; c'è un
**obbligo verso i clienti** (NDA/GDPR), quindi serve qualcosa di dimostrabile; e c'è la
**fuga accidentale di segreti** (chiavi, `.env`). *Fuori perimetro per ora:* l'archivio su
disco e il cloud STARK.

**Cosa promettiamo** — tre frasi: nessuna persona identificabile arriva al modello; nessun
segreto parte; registro ispezionabile di cosa è uscito. **Esclusa** «il codice non esce
affatto»: è una funzione diversa (modello locale), non questa.

Le tre frasi hanno poi preso **due clausole**, entrambe per restare vere: «nessun segreto»
è diventato «di forma nota, più quelli che dichiari, più nulla dai file che git ignora»
(§5.3), e a tutte si aggiunge *«…tranne ciò che alleghi tu, che ti viene detto e resta
scritto»* (§5.5). Sono la forma del **consenso informato**, che è poi il vocabolario in cui
ragiona già la controparte con cui si firma un NDA.

**Per chi** — è un **argomento di vendita**: la ragione per cui uno sceglie STARK invece
del terminale.

**Un limite che la misura ha reso esplicito, e che riguarda proprio la frase da vendere.**
Ogni richiesta porta `metadata.user_id`, che contiene in chiaro `device_id`, `account_uuid`
e `session_id` — un identificatore stabile che lega ogni richiesta a quell'account e a
quella macchina. Toglierlo non è una scelta libera: è plausibilmente il modo in cui viene
attribuita la quota. Quindi:

> **Il filtro nasconde il contenuto, non l'identità. Il provider sa comunque chi sei; ciò
> che non sa più è di chi stai parlando.**

Protegge le persone e i nomi *nei dati*, non l'anonimato di chi usa STARK. Chi vendesse la
seconda cosa venderebbe un'altra.

### 1.1 La premessa che decide da sola

«Argomento di vendita» + «obbligo verso i clienti» non sono due requisiti in più: sono un
requisito **diverso in natura**. Una funzione comoda può coprire l'80% dei casi ed essere
utile. Una *promessa* che copre l'80% dei casi è **falsa**, e una promessa di sicurezza
falsa è peggio del non averla: sposta il comportamento dell'utente — gli fa aprire in STARK
il progetto del cliente che senza non avrebbe aperto — su una garanzia che non regge.

Tutto il §2 discende da qui.

### 1.2 La frase, scritta per intero — bozza al vaglio (§9.7)

> **«Sui progetti protetti, niente di ciò che il filtro sa nominare attraversa il confine:
> le persone e i nomi che dichiari, i segreti di forma nota, e nulla — proprio nulla — dal
> contenuto dei file che git ignora. Il modello lavora su alias coerenti; i tuoi file, le
> risposte e la conversazione restano in chiaro sulla tua macchina; e ogni invio è
> ispezionabile in un registro locale: apri il registro, cerca il nome del tuo cliente,
> non c'è. Due cose restano fuori, e te le diciamo prima: gli allegati non testuali
> partono come sono — te lo dice nel momento in cui li alleghi, e resta scritto — e il
> provider sa comunque che sei tu. Quello che non sa più è di chi stai parlando.»**

Passata al vaglio del §1.1 pezzo per pezzo: ogni proposizione regge a una domanda perché
ogni proposizione **è** una decisione già motivata — «che il filtro sa nominare» è
D11/D12, «file che git ignora» è §5.3a, gli allegati sono D29/D30, l'identità è D28, il
registro è D10. Se un pezzo non suona vendibile, il posto dove intervenire è la decisione
a monte, non la frase: una frase migliorata a mano si scolla da ciò che il sistema fa
davvero, ed è esattamente la promessa falsa del §1.1.

---

## 2. Il fatto scomodo: il journal **non** è il punto di intercetto

`src/core/journal.ts:6` dice, da mesi, che il journal è «il punto unico da cui passa tutto,
cioè dove si aggancerà l'anonimizzazione». **È falso**, e va corretto nel codice prima che
qualcuno ci costruisca sopra.

Il journal vede ciò che STARK **manda** e ciò che l'agent **risponde**. Non vede ciò che
l'agent **legge da solo**:

- `Read`, `Grep`, `Glob` — il contenuto entra nel contesto del modello; STARK ne riceve un
  **riassunto** (`summary.ts`), non il testo.
- `Bash` — `cat`, `env`, `psql`, qualunque cosa.
- `@file` nella casella: per scelta esplicita e registrata (CLAUDE.md) l'espansione **la fa
  il CLI**. È più economico, ed è esattamente il buco.
- `CLAUDE.md`, i file di memoria, il system prompt: li carica il CLI.
- La **compattazione**: il riassunto lo fa il modello su una conversazione che ha già visto
  tutto.
- Le risposte dei **server MCP**.

Filtrare la casella di scrittura è filtrare il rivolo, non il fiume. In una sessione vera
la quota parte dei dati sensibili che arriva al modello **non passa mai** per una riga di
codice nostra.

---

## 3. L'architettura: due livelli, e uno solo è la garanzia

Scelta dell'utente: **«filtra prima, blocca dopo»**. Non è un compromesso fra le tre strade
valutate — è la constatazione che fanno **lavori diversi**.

```
     ┌── livello 1: FILTRO A MONTE (comodità) ─────────────────┐
     │  prompt dell'utente + output dei tool via hook SDK       │
     │  → la scoperta avviene di norma prima che parta          │
     └──────────────────────────────────────────────────────────┘
                              ↓
     ┌── livello 2: PROXY LOCALE (garanzia) ───────────────────┐
     │  ANTHROPIC_BASE_URL → 127.0.0.1                          │
     │  l'ultimo salto: qui non passa niente che non sia        │
     │  stato guardato. Quasi mai deve scattare.                │
     └──────────────────────────────────────────────────────────┘
                              ↓  rete
```

**Livello 1 — il filtro a monte.** Prompt e output dei tool, intercettati dove il codice
già passa. Serve a far sì che le scoperte avvengano *prima* che una richiesta parta, cioè a
non far mai scattare il livello 2. **Non è la garanzia** e non va descritto come tale: la
copertura degli hook dipende da una superficie che il provider può cambiare, e «i tipi non
sono i fatti» è una regola già pagata in questo progetto (`PermissionDenied` dichiarato e
mai scattato).

**Livello 2 — il proxy.** L'unico punto in cui l'invariante si scrive in una frase
verificabile: *tutto ciò che attraversa questo confine è passato dal filtro.* Vede ogni
byte, file letti dall'agent compresi, perché a quel punto sono già dentro la richiesta.

### 3.1 Il proxy è bidirezionale, ed è ciò che risolve il ritorno

```
STARK → CLI → [proxy]  ──anonimizza──→  API del provider
STARK ← CLI ← [proxy]  ←deanonimizza──  API del provider
```

Ne discende una proprietà che vale la pena scrivere per esteso:

> **Il filesystem, il CLI e il journal vedono sempre i dati veri. Solo il filo vede gli
> alias.**

Quando il modello risponde con un `tool_use` che dice «modifica
`clienti/[Cliente-01]/fattura.ts`», il proxy rimette il nome vero **prima** che il CLI
esegua. L'alias non tocca mai un file. Il problema che sembrava il più grave — «il modello
scrive un segnaposto dentro un file vero» — sparisce, e resta solo la **fedeltà della
sostituzione inversa** (§6).

### 3.2 Non esiste il ritiro

Il transcript si rispedisce **intero a ogni turno**. Se al quinto turno si scopre
`Mario Rossi` e lo si aggiunge al dizionario, i turni 1–4 vengono ri-anonimizzati per i
turni futuri — ma nei primi quattro invii **era già uscito in chiaro**. Mascherare
retroattivamente non disfa una trasmissione.

Due conseguenze, entrambe operative:
1. È la ragione tecnica per cui «filtra prima» è giusto e per cui il rilevamento deve
   essere **conservativo per blocco** (§5) e non «impara osservando».
2. La regola sui file ignorati da git (§5.3) vale più di tutte le altre, perché è l'unica
   che decide **senza dover riconoscere niente**.

Secondo effetto, minore: ogni scoperta nuova cambia il prefisso e **invalida la cache** di
quella conversazione, una volta. Costo accettato, e decade da solo col crescere del
dizionario.

---

## 4. Misura A — **fatta il 3 settembre 2026: passa**

**Domanda:** il CLI di Claude Code accetta `ANTHROPIC_BASE_URL` restando sull'abbonamento?
Decisiva perché l'utente è a **quota fissa**: se puntare la base URL altrove forzasse la
fatturazione a chiave API, il costo non sarebbe tecnico ma economico.

Sonda: `spike/proxy-base-url.ts` — proxy su 127.0.0.1 che inoltra ad `api.anthropic.com`,
un turno vero di Haiku da una parola. Cattura in `spike/captures/proxy-base-url.jsonl`.

| Domanda | Esito misurato (CLI bundled 2.1.241, SDK 0.3.241) |
|---|---|
| Il CLI passa dalla base URL? | **Sì** — 3 richieste al proxy |
| Con quale credenziale? | `Authorization: Bearer sk-ant-oat01-…` (108 car.), **inoltrata intatta** |
| Chiave API richiesta? | **No.** `anthropic-beta: oauth-2025-04-20` → modalità abbonamento |
| Il turno arriva in fondo? | **Sì**, risposta ricevuta, streaming compreso |
| Serve TLS sul loopback? | **No**, `http://127.0.0.1:<porta>` accettato |

**Il proxy non tocca la fatturazione: sta in mezzo e basta.** La variabile va messa
nell'`env` passato all'SDK — stessa strada di `CLAUDE_CONFIG_DIR`, stessa trappola se ci si
dimentica.

### 4.1 Il fatto che vale più della misura

Le richieste sono state **tre**, non una:

1. `HEAD /api/hello` — sonda di raggiungibilità che il CLI fa da solo (user-agent `Bun/1.4.0`,
   nessuna credenziale). **Il proxy deve saperla rispondere**, o il CLI si crede offline.
2. `POST /v1/messages?beta=true`, 4 KB — **la generazione automatica del titolo**, col
   prompt dell'utente in chiaro dentro un `<session>…</session>`.
3. `POST /v1/messages?beta=true`, 205 KB — il turno vero.

La seconda è la **prova sperimentale dell'architettura a due livelli**, arrivata gratis:
quella richiesta **STARK non la vede da nessun'altra parte**. Nessun hook, nessun filtro sul
prompt, nessuna traduzione dell'adapter l'avrebbe intercettata — è una chiamata laterale che
il CLI fa per conto suo. Il proxy l'ha vista perché il proxy sta nell'unico punto in cui
tutto è già diventato traffico.

*(In STARK quella specifica chiamata non parte: `buildOptions` passa `title` apposta per
spegnerla. Il punto regge lo stesso, e vale per il classificatore dell'auto mode, per la
compattazione e per qualunque chiamata laterale che il CLI aggiungerà in futuro senza
dircelo.)*

### 4.2 Forma del traffico → **`docs/anonimizzazione-flusso.md`**

La mappa campo per campo, nei due versi, sta in un documento suo: `spike/flusso-anthropic.ts`
fa passare un turno vero con tre tool e **cammina il JSON** invece di elencarne i campi a
memoria. Qui solo le cinque cose che hanno cambiato una decisione:

1. **Due endpoint in tutto**: `HEAD /api/hello` (sonda di raggiungibilità senza credenziali,
   che il proxy deve saper rispondere) e `POST /v1/messages?beta=true`. Nient'altro.
2. **Il `tool_result` è il punto che conta.** Le esche piantate in un file sono attraversate
   il confine come `messages[].content[].content`, cioè dentro il risultato del tool — che è
   esattamente ciò che il journal **non vede**. Il §2 non è più un ragionamento: è misurato.
3. **Il ragionamento non passa in chiaro** (`thinking: ""`, solo una firma opaca), quindi non
   c'è nulla da deanonimizzare lì — e la firma non si tocca mai.
4. **Il grosso del payload non è dell'utente**: `tools[].description` è l'88-90% dei byte. Un
   filtro che lo riscansiona a ogni turno spreca il 90% del lavoro.
5. **La risposta arriva in gzip**, e uno stream compresso non si riscrive leggendolo: o si
   chiede `identity`, o si decomprime e ricomprime.

E un numero che rende concreto il §3.2: un prompt solo con tre tool ha prodotto **4 andate
da ~420 KB**, e la stessa esca è passata in due di esse. *Un dato letto una volta viene
trasmesso N volte*, con N il numero di giri che restano.

### 4.3 Misura A-bis — l'instradamento, **fatta lo stesso giorno: passa**

**Domanda:** un proxy **solo** per tutte le sessioni sa a chi appartiene una richiesta? Il
dizionario è per progetto (§5), ma il CLI manda un `POST /v1/messages` in cui non c'è nulla
che dica quale progetto sia. Con un proxy per sessione la domanda non esisteva; con uno
solo va risolta.

Strada provata: mettere l'identità **nella base URL stessa** —
`http://127.0.0.1:PORT/s/<sessione>` — e toglierla prima di inoltrare a monte. Funziona
solo se il CLI **rispetta il prefisso di percorso** invece di buttarlo via.

| | Esito |
|---|---|
| `HEAD /api/hello` (client `Bun/1.4.0`) | prefisso **tenuto** — `spike/proxy-instradamento.ts`, costo zero |
| `POST /v1/messages` (client `stainless`) | prefisso **tenuto** — `spike/proxy-base-url.ts`, un turno |

Verificato su **entrambi** i client di proposito: sono due librerie diverse dentro lo stesso
CLI, ed è esattamente il caso in cui una normalizza l'URL e l'altra no. Dedurne una dall'altra
sarebbe stata la trappola «i tipi non sono i fatti» nella sua versione HTTP.

**Ricaduta di sicurezza, arrivata gratis:** il proxy può **rifiutare una richiesta il cui
prefisso non riconosce**. Un processo qualunque sulla macchina non può usarlo come relay
aperto verso Anthropic, perché dovrebbe indovinare l'id di una sessione viva. Il fail-closed
diventa il comportamento naturale invece di un controllo in più: sessione non registrata →
non si inoltra.

### 4.4 Cosa resta da misurare qui

- ~~**OpenCode**: esiste l'equivalente?~~ → **misurato il 3 settembre, sera tardi: sì**
  (§4.5, misura A-ter). Con due residui onesti scritti lì.
- La **compattazione**: il riassunto lo genera il modello su una conversazione che ha
  visto solo alias, quindi torna con gli alias dentro — e la bidirezionalità del §3.1
  *dovrebbe* rimetterlo a posto da sola, come qualunque altro testo di ritorno.
  «Dovrebbe» perché non è osservato: la sessione della sonda era troppo corta per
  compattare (flusso §8).
- ~~Un alias può spezzarsi fra due delta~~ → **misurato lo stesso giorno, ed è meccanico**
  (flusso §5.3): i tagli cadono dove capita, anche in mezzo a un nome. Chiuso come
  problema di scelta — serve il buffer di ricucitura del §6.4, che è lavoro, non un
  dilemma.

### 4.5 Misura A-ter — OpenCode, **fatta il 3 settembre 2026: passa**, a costo zero

**La leva esiste ed è ufficiale**: il tipo `Config` dichiara
`provider.<id>.options.baseURL`, `createOpencodeServer` la passa al processo via
`OPENCODE_CONFIG_CONTENT`, e — misurato, non dedotto — il traffico **ci passa davvero**.
Sonda: `spike/opencode/proxy-base-url.ts`.

| Domanda | Esito misurato (binario opencode **1.18.26**, SDK 1.17.20) |
|---|---|
| Il traffico passa dalla baseURL iniettata? | **Sì** — 2 richieste `POST …/v1/messages` al proxy |
| Il prefisso di percorso sopravvive? | **2/2** — `/s/PROVA-ATER/v1/messages` arriva intero |
| L'inoltro a monte funziona? | **Sì** — il 401 vero di Anthropic sulla chiave finta torna fino al client |
| Con quale client? | AI SDK su Bun (`opencode/1.18.26 ai-sdk/provider-utils/…`), credenziale `x-api-key` |

**Come è stata resa a costo zero, ed è la parte da ricordare**: su questa macchina
OpenCode **non ha una credenziale Anthropic** (le sue credenziali sono Zen, Baseten,
Merge Gateway), e senza chiave l'AI SDK lancia **client-side** — la richiesta non parte
proprio. La misura gira quindi con una **chiave finta in env**: il client si costruisce,
la richiesta parte, e la domanda era *dove bussa*, non se il turno riesce. Il 401 a monte
è l'esito atteso.

Il primo giro della sonda ha **mentito due volte** prima di dire la verità, ed entrambe
vanno lasciate scritte: `session.prompt` risolve anche su un turno morto (l'esito vero
sta nei **messaggi** della sessione, dove c'era `ProviderAuthError`), e «zero bussate»
sembrava «baseURL ignorata» mentre era «nessuna richiesta mai partita». Una conclusione
sbagliata — «OpenCode ignora la leva» — è stata scritta e corretta nel giro di dieci
minuti: è il costo di leggere l'assenza senza chiedersi perché (la trappola già nota).

**Due fatti collaterali arrivati gratis**: la **chiamata laterale piccola** (2,7 KB)
prima del turno vero — lo stesso pattern della generazione del titolo di Claude Code
(§4.1): anche qui il proxy vede traffico che nessun'altra superficie di STARK vedrebbe.
E la **deriva di versione**: il binario nel PATH è 1.18.26 mentre l'SDK appaiato è
1.17.20 — ADR-009 l'aveva prevista su Claude Code, vale identica qui.

**I due residui onesti, che diventano la domanda §9.13**: la misura copre il percorso a
**chiave API** del provider `anthropic`. Il percorso **OAuth** (Claude Pro/Max dentro
OpenCode) non è misurabile qui — non c'è la credenziale — ed è comunque **zona grigia**:
Anthropic lo vieta esplicitamente e OpenCode ha rimosso i plugin dalla 1.3.0. E i
provider che questa macchina **usa davvero** (Zen, Baseten, Merge Gateway) hanno la
stessa leva dichiarata nel tipo ma **non misurata**: la copertura dell'anonimizzazione su
OpenCode è per-provider, e ogni provider va misurato prima di prometterci sopra. →
**Misurato subito, §4.6.**

### 4.6 Il secondo residuo, chiuso lo stesso giorno: **tutti i provider, non solo anthropic**

Sonda `spike/opencode/proxy-per-provider.ts`, **costo zero e per costruzione**: il proxy
**non inoltra** — blocca ogni richiesta con un 402 e registra solo *se* e *dove* il
provider ha bussato. La domanda era «la leva instrada?», non «il turno riesce», quindi
nessun upstream viene toccato e nessuna quota di nessun provider si consuma.

| Provider (loader AI SDK diverso) | Bussate al proxy | Prefisso `/pp` tenuto |
|---|---|---|
| `anthropic` | 2 | 2/2 |
| `opencode` (Zen) | 2 | 2/2 |
| `baseten` | 2 | 2/2 |
| `opencode-go` | 2 | 2/2 |
| `merge-gateway` | 2 | 2/2 |

**La leva è dell'AI SDK, non del singolo loader.** Il timore di §4.5 — che `options.baseURL`
fosse un caso speciale di `anthropic`, come lo è il suo percorso OAuth — è caduto: cinque
loader diversi, cinque volte lo stesso instradamento col prefisso intatto. Le **2 bussate**
per provider sono lo stesso pattern di Claude Code (§4.1): una chiamata laterale piccola
più il turno, entrambe viste solo dal proxy. Resta fuori solo l'OAuth (§9.13), che è una
via da rifiutare, non da coprire.

### 4.7 Misura della pausa — quanto regge il client se il proxy trattiene

La domanda che rende «in dubbio, ferma» (D7) un comportamento e non uno slogan: quando il
proxy trattiene un turno per far decidere l'utente, **dall'altra parte cosa succede?**
Sonda `spike/pausa-blocco.ts`, che trattiene il primo `POST /v1/messages` senza rispondere
né inoltrare e **cronometra** il client del CLI. Costo zero: niente raggiunge Anthropic.

```
[  5.9s]  TRATTENGO il POST n.1 (185 KB)
[317.3s]  il client CHIUDE il tentativo n.1        → ha retto ~311 s
[317.9s]  TRATTENGO il POST n.2 (185 KB, identico)  → ha RITENTATO da solo
[633.1s]  il client CHIUDE il tentativo n.2        → altri ~315 s
[634.3s]  TRATTENGO il POST n.3                     → terzo tentativo
[752.9s]  tetto 12 min: l'SDK non è MAI tornato con un errore
```

Tre fatti, tutti nuovi e tutti operativi:

1. **La finestra è ~5 minuti per tentativo.** Entro quella, trattenere e poi inoltrare è
   lecito e il turno arriva (confermato dal giro `--rilascio`, §4.7.1).
2. **Il client ritenta da solo**, con lo **stesso corpo identico** (185 KB byte per byte).
   Il proxy vedrà quindi **richieste duplicate**, e la decisione dell'utente va legata
   alla **sessione, non al socket**: quando l'utente risponde, il socket vivo può essere
   il tentativo n.2, mentre il n.1 è già stato abbandonato.
3. **Non esiste l'attesa infinita gratis.** L'SDK sopra non si arrende (dodici minuti
   senza un errore), ma sotto i socket vanno e vengono ogni ~5 minuti. Trattenere oltre la
   finestra significa gestire i retry, non tenere una richiesta ferma.

Trappola evitata e lasciata scritta: i timeout di Node (`requestTimeout` 300 s di
default) vanno **azzerati** nel server-sonda, o si misura il timeout **nostro** e lo si
scambia per «il client ha mollato» — la prova che guarda il posto sbagliato.

**Ne discende il design del fail-closed**, che prima era una scelta aperta: si **trattiene**
entro la finestra, si **deduplica** il retry per corpo, e la card è **della sessione**.
Oltre un limite scelto da noi (ben dentro i ~5 minuti, così la scadenza è la nostra e non
quella del client) si chiude con un errore distinguibile e si rimanda. Quanto vale quel
limite e come rendere idempotente il retry è il residuo §9.14.

#### 4.7.1 …e rilasciare entro la finestra arriva in fondo

L'altra metà, altrimenti la prima misura direbbe solo «il client aspetta», non «la pausa
è utile». Giro `node spike/pausa-blocco.ts --rilascio 90`: si trattiene 90 s — ben dentro
i 311 — e **poi** si inoltra.

```
[  5.3s]  TRATTENGO il POST n.1
[ 99.7s]  RILASCIO dopo 90s: inoltro a monte
[101.5s]  SDK: result success — PONG        ← turno completo, risposta giusta
          nessun ritentativo orfano nei 45 s successivi
```

**Il ritardo non corrompe il turno.** Un `POST /v1/messages` tenuto fermo un minuto e mezzo
e poi lasciato partire arriva in fondo identico a uno immediato — nessuna firma scaduta,
nessun retry spurio, un solo tentativo. È la prova che «trattieni finché l'utente decide,
poi inoltra» è un comportamento reale e non un'ipotesi: la card dell'utente può stare
aperta i secondi che servono, e alla risposta il turno prosegue dal punto in cui era.

---

## 4bis. L'infrastruttura, come l'ha scelta l'utente

Tre scelte, il 3 settembre 2026 dopo la misura A:

- **Processo separato, uno solo.** Non dentro il daemon. La ragione che regge meglio non è
  l'isolamento ma il **ciclo di vita**: il daemon si riavvia (aggiornamenti, difetti), e un
  riavvio del daemon che uccidesse le richieste in volo interromperebbe i turni di tutti.
  Separandoli, un aggiornamento di STARK non tocca il traffico.
  Il pattern esiste già: `src/cli/stark.ts` (righe ~320-410) ha la macchina per un processo
  che deve sopravvivere al padre, scritta perché **`detached` non fa uscire dal cgroup di
  systemd** — trappola già pagata, da riusare e non da riscoprire.
- **Sempre in mezzo, trasparente quando spento.** Un percorso solo, per la stessa ragione
  per cui il journal non ha un secondo ramo per l'helper: due percorsi divergono col tempo.
  Quando l'anonimizzazione è spenta il proxy inoltra e basta.
- **Fail-closed.** Su un progetto protetto, senza filtro non si lavora. Vendere «i dati non
  escono» e poi partire lo stesso quando il filtro non c'è è il momento preciso in cui la
  promessa si rompe — ed è anche quello in cui nessuno guarda la barra di stato.

### 4bis.1 La forma che ne esce

```
stark start ─┬─→ daemon        (HTTP + SSE, 127.0.0.1, token)
             └─→ proxy         (127.0.0.1, porta propria, nessun token: instrada per URL)

sessione nuova → il daemon la registra presso il proxy → riceve /s/<id>
              → ANTHROPIC_BASE_URL = http://127.0.0.1:PORT/s/<id>  (via `env` dell'SDK)
```

L'identità viaggia nel **prefisso di percorso** (§4.3), non in un'intestazione: non dipende
da `ANTHROPIC_CUSTOM_HEADERS`, cioè da una superficie del provider che può cambiare.

**Quattro doveri del proxy che non dipendono dal filtro** — misurati nel flusso, scritti
qui perché chi lo implementa non li riscopra a caduta avvenuta:

1. rispondere a `HEAD /api/hello`, o il CLI si crede offline (§4.1);
2. passare **intatte** le intestazioni `anthropic-ratelimit-*`, o il pannellino della
   quota smette di sapere (flusso §8);
3. `signature` passa identica, sempre, anche col filtro acceso (D26);
4. quando filtra la risposta, chiedere `identity` a monte o decomprimere e ricomprimere:
   uno stream gzip non si riscrive leggendolo (flusso §5). Da spento, il gzip passa com'è.

### 4bis.2 La conseguenza che le tre scelte producono insieme

«Processo separato» + «sempre in mezzo» ⇒ **il proxy diventa un prerequisito di ogni
sessione**, non solo di quelle protette. Se non è su, o non parte niente (fail-closed
universale, coerente ma severo), oppure esiste una via di fuga diretta — che è il secondo
percorso appena rifiutato.

**Risolta da D19**, e la risposta è che la domanda era mal posta: il proxy non è una cosa
che «può essere giù» più di quanto lo sia il daemon. `stark start` alza entrambi,
`stark status` mostra entrambi, e se muore viene riacceso. Il fail-closed resta, ma morde
nel caso patologico invece che nel quotidiano.

Resta però un costo permanente, ed è il punto **6** dell'elenco in cima: ogni sessione paga
un salto in più, comprese quelle che la funzione non la usano.

## 5. Cosa si riconosce, e chi lo dichiara

Il dizionario **non è uno stato interno che si riempie da solo**: è un **pannello del
progetto** — il perimetro è il progetto, come colore e silenzio, non la sessione. Le voci
arrivano da tre strade e restano tutte modificabili.

1. **Automatiche** — ciò che le forme note riconoscono da sole.
2. **Proposte** — ciò che il rilevatore sospetta e sottopone.
3. **A mano** — ciò che solo l'utente sa: il nome del cliente, il nome in codice del
   progetto, la persona che non ha nessuna forma riconoscibile.

E si **toglie**, non solo si aggiunge. La rimozione è la metà che tiene in piedi il resto:
è il modo di dire «questo non è sensibile» **una volta**, invece di rispondere a una card
ogni volta. Il rumore dei falsi positivi smette di essere un costo ricorrente e diventa un
costo iniziale.

La parte **non-deterministica resta confinata alla scoperta**, mai alla sostituzione: è la
sostituzione a dover essere stabile.

### 5.1 Dove vive il dizionario, e come viaggia — la prassi `.env`

Il file **non** sta nella cartella del progetto: `.stark/` è **tracciato in git** (il kanban
ci sta dentro), quindi il dizionario lì finirebbe in un commit e da lì su GitHub. Sarebbe il
difetto perfetto — la funzione che serve a non far uscire i dati sarebbe l'unica a
pubblicarli. Sta in `~/.stark/`, accanto a `token`, `sessioni` e `settings.json`, cioè
accanto ai journal che contengono comunque tutto.

Ma l'utente ha **tre macchine** e i trascritti non si sincronizzano. Un dizionario che non
viaggia significa che la seconda macchina riparte da zero e, finché non è istruita, **perde**.
E significa anche che la macchina A chiama un cliente `[Cliente-01]` e la B `[Cliente-02]`:
due registri che parlano della stessa persona con due nomi. Il registro è **la prova** (§7),
e una prova che cambia lessico a seconda di dove è stata generata è difficile da mostrare.

**La forma scelta è quella dei `.env` di squadra**, e regge su tre livelli:

**Sulla struttura.** `.env.example` sta nel repo e descrive la *forma*; `.env` si condivide
fuori banda e contiene i *valori*. È esattamente lo spacco: nel repo la **politica** — quali
classi sono accese, quali forme cercare, la severità — committabile e condivisibile con una
squadra; fuori dal repo i **valori** e la loro mappa.

**Sulla fusione, che è il pezzo che risolve un problema che avevo lasciato aperto.**
Nessuno fa il merge di due `.env`, e per una buona ragione. Se due macchine scoprono entità
nuove in parallelo, la A assegna `[Cliente-01]` ad Acme e la B lo assegna a un altro: unirli
non è un'unione, è un **conflitto silenzioso** — il file resta valido e la mappa mente. Una
copia autorevole che si **distribuisce** elimina il problema invece di gestirlo.

Ed è anche ciò che **salva il contatore leggibile** di D9: `-01` è stabile solo se c'è **un
solo scrittore**, e «un solo scrittore» è precisamente la prassi `.env`. La premessa di D9 si
era già mossa una volta (§6.2); questa è la seconda volta, e stavolta la conferma.

**Non regge su una cosa, e va detta perché è la parte scomoda.** «Vie sicure» per i `.env`,
nei fatti, vuol dire 1Password se si è disciplinati e un messaggio se non lo si è. E questo
file è **peggio di un `.env`**: un `.env` dà accesso a dei sistemi, questo è **la chiave di
lettura di tutto ciò che è già stato trasmesso**. Se esce, ogni riga del registro diventa
leggibile a ritroso. La condivisione dev'essere quindi un **gesto esplicito** — esportazione
con passphrase — mai una sincronizzazione che avviene da sé.

### 5.2 In dubbio, ferma

Confermato dall'utente due volte, anche dopo che il pannello dava un posto alternativo dove
dire sì o no: **qualunque cosa il filtro non riconosce ferma l'invio**. Non «passa
segnalando», non «dipende dalla classe».

Il limite onesto di questa regola, che va tenuto a mente: **non si blocca su ciò che non si
rileva.** Il blocco agisce sui dubbi, non sui buchi.

### 5.3 I segreti: forme note, file vietati, e una promessa corretta

Scelta: **niente entropia generica**. Su un repo, SHA di git, UUID, hash dei lockfile e
base64 di asset sembrano tutti segreti, e un filtro che grida a ogni SHA viene spento il
secondo giorno — una funzione spenta non protegge niente.

Ma «solo prefissi noti» e «nessun segreto parte, **mai**» non stanno insieme:
`db_password = "hunter2"` non ha prefisso. Le tre ricuciture scelte, cumulative:

**a) Vietare i file ignorati da git.** *Il contenuto di un file che git ignora non
attraversa il confine.* Non alza un sospetto su una stringa: **vieta un file**.
Deterministica, nessun falso positivo sugli SHA perché non guarda le stringhe, e si scrive
in una frase provabile. Protegge il caso vero, che non è «l'utente incolla una chiave» ma
**«l'agent fa `cat .env` per capire perché non parte il server»**.
*Costo:* l'agent non legge `.env` nemmeno quando servirebbe — ridotto da D31, qui sotto.

**Come si serve un file vietato** (D31, deciso dall'utente il 3 settembre 2026, chiude la
domanda §9.1): non si nega, si serve **con le chiavi in chiaro e i valori sostituiti da
alias** — `DATABASE_URL=[postgres-REDACTED-01]`. L'agent resta capace: può dire «manca la
variabile X» o «l'URL punta a staging» senza aver visto un valore. Vale dove la struttura
si riconosce in modo deterministico (`chiave=valore` e i formati di config che si sanno
camminare); dove non si riconosce, torna il **divieto pieno** — che non è una regola
nuova, è D7 applicata a un file intero invece che a una stringa. Due note oneste: le
chiavi in chiaro **passano comunque dal filtro normale**, quindi un nome di cliente dentro
una chiave (`ACME_PROD_DB_URL`) viene mascherato come ovunque; e gli alias dei valori
seguono la regola §6.1, quindi il modello sa *che tipo* di valore manca, mai quale.

**b) Allargare le forme note oltre i prefissi.** Stringhe di connessione
(`postgres://utente:pass@host`), header `Authorization`, blocchi PEM, JWT, e
`chiave = valore` dove la **chiave** si chiama `password`/`secret`/`token`. Sempre
dichiarato, sempre deterministico, molto più largo di `sk-`/`ghp_`/`AKIA`.

**c) Correggere la promessa.** Si vende «nessun segreto **di forma nota**, più quelli che
dichiari, più nulla dai file che git ignora» invece di «mai». Meno forte, e non si smonta
con una domanda — che è il requisito del §1.1.

### 5.4 Gli allegati **non si anonimizzano**, ed è un limite dichiarato

Decisione dell'utente, 3 settembre 2026. Un allegato viaggia come blocco `image` o
`document` in base64 (`ALLEGABILI` in `sdk-options.ts`: PNG, JPEG, GIF, WebP, PDF, testo,
markdown, CSV). Per i tipi testuali il filtro funziona come su qualunque altro testo; per
**immagini e PDF no**, e la ragione non è che manchi il tempo:

> Un nome dentro uno screenshot non lo vede nessuna espressione regolare. Riconoscerlo
> vorrebbe dire fare OCR, decidere quali regioni sono sensibili e **ridipingere il
> pixel** — che è un prodotto a sé, non una riga in più in un filtro di testo.

Quindi si **dichiara**, invece di lasciarlo scoprire. È la stessa disciplina di §1: una
promessa che copre l'80% dei casi è falsa, e questa è precisamente la fetta scoperta.

**In futuro può diventare una funzione sua** — un anonimizzatore di documenti che lavora
sul contenuto prima che diventi allegato (OCR + mascheramento, o l'estrazione del testo da
un PDF che poi passa dal filtro normale). Va progettato come tale, non innestato qui: ha un
motore diverso, costi diversi e modi di sbagliare diversi.

### 5.5 Cosa fa STARK con un allegato non filtrabile — **l'unica eccezione al blocco**

Deciso dall'utente il 3 settembre 2026: **non si rifiuta, si avvisa.** STARK dice che quel
documento **non verrà anonimizzato**, e da lì in poi la verifica è dell'utente — che se lo
guarda, e se dentro c'è qualcosa lo censura e ricarica il file.

**Va scritto che questa è un'eccezione a D7 e a D17**, ed è l'unica in tutto il sistema:
l'unico punto in cui qualcosa attraversa il confine senza che il filtro ne abbia risposto.
Chi valida il documento la noterà, quindi è meglio che la trovi dichiarata con la sua
ragione invece che come un'incoerenza.

**E la ragione regge, perché il caso è diverso in natura.** Un allegato è **un atto
dell'utente**; un `tool_result` è un atto dell'agent. Il fail-closed difende da ciò che
l'utente **non vede**: un file che l'agent apre da solo entra nel contesto senza che nessuno
l'abbia guardato, e lì un consenso sarebbe una firma in bianco. Un file che l'utente allega
l'ha scelto lui, in quel momento, sapendo cos'è. **Il consenso vale quando chi lo dà ha la
conoscenza**, e qui ce l'ha.

Tre cose che ne discendono, e che non sono opzionali:

1. **L'avviso dice cosa STARK non sa fare**, non «attenzione». La differenza è fra
   un'informazione e un disclaimer: «questo PDF verrà trasmesso **così com'è**: il filtro non
   legge dentro le immagini» è utilizzabile, «procedere con cautela?» no.
2. **L'avviso sta al momento dell'allegato**, non nelle impostazioni, ed è il momento in cui
   togliere il file costa un clic — perché la risposta giusta all'avviso è spesso «allora
   prima lo sistemo».
3. **Il registro lo scrive.** Il §7 dice *«apri il registro, cerca il nome del tuo cliente,
   non c'è»*: se un allegato passa non filtrato e il registro tace, la prova **mente per
   omissione**. Deve risultare che quel file è passato intero, quando, e che l'utente lo
   sapeva.

Ricaduta sulla frase da vendere (§1): acquista una clausola, e la clausola è vera —
*«…tranne ciò che alleghi tu, che ti viene detto e resta scritto»*. È la forma del consenso
informato, che è poi il vocabolario in cui la controparte ragiona già.

---

## 6. Gli alias sicuri — la forma del dato senza il dato

Decisione dell'utente, ed è la più densa del giro: *«al modello mandiamo un placeholder di
forma simile ma senza dati veri — invece di un nome vero `[NomeCognome-01]`, invece di una
chiave API `[sk-REDACTED-01]` — in modo che il modello capisca di cosa parliamo e abbia un
identificatore fake univoco a cui fare riferimento. Alias safe, come se stessimo
parafrasando a mano i dati sensibili prima di darli al modello.»*

Cambia il §8 (la collisione col principio fondante). Un modello che riceve
`[DATO_RIMOSSO]` lavora **bendato**; uno che riceve `[sk-REDACTED-01]` sa che lì c'è una
chiave API, sa che è *quella* e non un'altra, e può parlarne. Il degrado passa da «non
capisce» a «non conosce il valore», che è quasi sempre ciò che serve.

### 6.1 La regola

> **Verosimile quanto basta per dichiarare il tipo, mai abbastanza per essere scambiato per
> un valore vero.**

L'esempio la contiene già: `sk-REDACTED-01` tiene il prefisso e **brucia il corpo**.

Deliberatamente **diverso dal cifrare preservando il formato** (FPE), e la differenza è
sostanziale: un alias *formalmente valido* può **collidere con un dato vero di qualcun
altro** — un IBAN con checksum corretto è l'IBAN di qualcuno. Gli alias vivono in **spazi
riservati**: `example.com`, `REDACTED` nel corpo, intervalli documentati come non
assegnabili.

### 6.2 Reversal — il contatore era stato dato per sbagliato, e non lo è

Prima versione di questo documento: niente contatore incrementale, perché dipende
dall'ordine in cui si incontrano le entità → due sessioni, due mappe diverse → prefisso
instabile → cache saltata a ogni turno su un utente a quota fissa. Alias derivato dal valore
con un hash.

**La premessa è caduta** quando il dizionario è diventato **persistito nel progetto**: il
numero si assegna alla **prima** scoperta, si scrive lì, non si ricicla mai. È stabile fra
sessioni *e* leggibile. E la leggibilità è una funzione, non un vezzo: `[Cliente-01]` è
meglio di `[Cliente-a3f9c2]` per **due** lettori — il modello, che ci ragiona sopra, e
l'utente, che legge il registro.

### 6.3 Requisiti che ne discendono

- **Coerenza referenziale.** Stesso valore → sempre lo stesso alias; valori diversi → mai
  lo stesso alias. Senza questo il modello **fonde due clienti**, ed è un difetto che non si
  vede: produce risposte plausibili e sbagliate.
- **Entità annidate: a strati** (D32, deciso dall'utente il 3 settembre 2026).
  `mario.rossi@acme.it` contiene una persona **e** un'azienda, e mascherare l'email intera
  come blocco unico perderebbe il fatto che quel dominio è lo stesso di altre venti
  occorrenze. L'alias è **composto** — `[persona-01]@[azienda-02].example` — perché la
  coerenza referenziale del punto sopra vale per le parti, non solo per l'intero. Costo
  dichiarato: un alias composto è più fragile al ritorno di uno semplice, quindi la
  **misura B deve provare anche questi** (§6.5), non solo `[NomeCognome-01]`.
- **Un alias mai emesso è un'allucinazione.** Se il modello risponde parlando di
  `sk-REDACTED-07` che non abbiamo emesso, non c'è mappa: per la regola §5.2 è un blocco, ed
  è la scelta giusta — sostituirla con qualcosa sarebbe peggio.

### 6.4 Il rischio che decide se la cosa vive → **seconda misura**

**Il modello trasforma gli alias.** Gli si dà `[NomeCognome-01]` e lui scrive
`nomeCognome01`, `NOME_COGNOME_01`, `nome-cognome-01`, lo mette in un identificatore, lo
spezza su due righe, lo traduce. La sostituzione inversa non trova corrispondenza, e con la
regola «ferma tutto» diventa un **turno interrotto ogni volta che il modello fa il suo
mestiere**, cioè scrivere codice.

**Attenzione a non confondere due problemi diversi**, perché la misura del flusso ne ha
chiuso uno e lasciato aperto l'altro:

- **Lo spezzettamento nello stream — chiuso, ed è meccanico.** L'input di un tool arriva in
  frammenti arbitrari di una stringa JSON in costruzione, e i tagli cadono dove capita:
  catturato dal vivo, `… "ntent\": \"Re", "ferente", ": ", "Ludovi", …`. Non è un problema
  semantico: si risolve con un **buffer di ricucitura** che trattiene una coda lunga quanto
  l'alias più lungo, più il riscape del JSON. Nessuna scelta da fare, solo del lavoro.
- **La trasformazione da parte del modello — ancora aperta, ed è la misura B.** Che il
  modello *riscriva* `[NomeCognome-01]` in `nomeCognome01` è un'altra cosa, e la sonda del
  flusso non la tocca: lì gli alias non c'erano ancora.

Decisione dell'utente sulla seconda: **si misura prima di scegliere.** Si fa girare un turno
vero con alias dentro e si guarda *come* il modello li tratta. Le tre risposte possibili si
scelgono dopo, non prima:

1. **Confronto normalizzato** — si canonicalizzano entrambi i lati (via separatori, tutto
   minuscolo) prima di confrontare. Deterministico e delimitato: è una chiave canonica, non
   fuzzy matching. Non copre l'alias tradotto o spezzato.
2. **Alias a prova di trasformazione** — una forma che sopravvive da sola. Niente da
   ricucire, meno leggibile per entrambi i lettori.
3. **Accettare il blocco** — difendibile solo se è raro, e quanto sia raro è precisamente
   ciò che la misura deve dire.

### 6.5 Misura B — **fatta il 3 settembre 2026. E il pericolo non era quello.**

Sonda: `spike/alias-tenuta.ts`, tre giri di Sonnet 5. Alias piantati come arriverebbero da un
`tool_result` filtrato, semplici e composti (D32), in prosa, in codice e nei percorsi.

**Il risultato si legge in una riga, ed è una regola, non una statistica:**

> **Il modello conserva l'alias byte per byte ovunque sia sintatticamente legale, e lo
> trasforma esattamente dove è illegale.**

| Scena | Dove finivano gli alias | Esito |
|---|---|---|
| Due giri «amichevoli» — implementare una funzione, creare una cartella, scrivere una nota | stringhe, commenti, prosa, percorsi, comandi shell | **12 riusi, 0 trasformazioni, 0 allucinazioni.** Compreso il composto `[persona-04]@[azienda-07].example`, riusato intatto (D32 regge) |
| Un giro **ostile** — «crea un modulo per cliente, col nome del file e della funzione derivati dal cliente» | **identificatori** e nomi di modulo | **2 su 2 trasformati**, sempre |

Dettagli che valgono più del conteggio:

- **Le parentesi quadre nei percorsi non si rompono.** Il modello ha quotato il percorso
  (`mkdir -p '…/[Cliente-03]'` in un giro, `"…"` nell'altro): le virgolette **avvolgono**,
  non scappano — i byte dell'alias restano quelli. Il caso che temevo di più non morde.
- **L'alias che dichiara il tipo funziona come D8 prometteva.** Davanti a
  `[sk-REDACTED-02]` il modello si è rifiutato di copiarlo in una nota, spiegando che «ha
  il formato di una credenziale e non di un recapito». Ha ragionato correttamente sul
  *tipo* senza conoscere il valore: è la conferma sperimentale di D8.
- **Le trasformazioni osservate sono solo di forma**: `[Cliente-02]` → `tariffaCliente02`,
  `cliente-02.ts`, `./src/cliente-02`. Cambio di maiuscole e di separatori. Nessuna
  traduzione, nessuna parafrasi, nessun troncamento.

#### Il ribaltamento: il pericolo non è il turno interrotto

§6.4 temeva un **blocco** a ogni riscrittura. È sbagliato, e la sonda l'ha mostrato
mostrando prima la cosa sbagliata (il primo verdetto che stampava diceva «2 blocchi», ed è
stato corretto):

`tariffaCliente02` **non ha forma di alias**. Non ha parentesi quadre, non combacia con
nulla nel dizionario. Quindi il proxy non ci vede niente da invertire — **e neanche niente
da fermare**. Non blocca: *passa liscio*. La regola §6.3 («un alias mai emesso è
un'allucinazione → blocco») non si applica, perché lì di alias non ce n'è più uno.

Verificato su disco, alla fine del giro ostile:

```
src/cliente-02.ts   → export function tariffaCliente02(): number { return 90 }
index.ts            → export { tariffaCliente02 } from './src/cliente-02'
```

> **Il rischio vero è il passaggio silenzioso**: il segnaposto finisce scritto nel codice
> vero, con nomi di file e di funzione derivati da un cliente mascherato, e nessuno viene
> avvisato. Non corrompe niente — compila — ed è per questo che è peggio di un blocco: un
> blocco lo vedi.

#### Cosa ne segue per le tre risposte del §6.4

- **La risposta 3 («accettare il blocco») non è disponibile**, e non perché sia troppo
  costosa: perché **non c'è nessun blocco da accettare**. Era costruita su una premessa
  falsa. → S13.
- **La risposta 1 (confronto normalizzato) rileva tutto ciò che è stato osservato**:
  `norm('[Cliente-02]') = 'cliente02'`, ed è contenuto in `norm('tariffaCliente02')` e in
  `norm('cliente-02.ts')`. Le trasformazioni viste sono esattamente la classe che la
  normalizzazione cattura.
- **Ma rilevare non è invertire**, ed è la domanda nuova che la misura apre. Trovato
  `Cliente02` dentro `tariffaCliente02`, con cosa lo si sostituisce? Il valore vero è
  `Acme S.p.A.`, e `tariffaAcme S.p.A.` non è un identificatore. **La trasformazione è
  lossy e la posizione sintattica vincola il risultato: non esiste una sostituzione
  inversa corretta in generale.** → §9.12.

**Una candidata, valutata la sera stessa e non scelta** (S14, superata da §6.7 — resta
scritta perché il confronto spiega la scelta). Il dizionario tiene per ogni entità non
un alias ma una **famiglia di forme**, ciascuna col suo corrispettivo vero già nella forma
giusta:

| forma | alias | valore vero |
|---|---|---|
| citazione | `[Cliente-02]` | `Acme S.p.A.` |
| pascal | `Cliente02` | `AcmeSpa` |
| kebab | `cliente-02` | `acme-spa` |
| maiuscolo | `CLIENTE_02` | `ACME_SPA` |

L'inversione torna a essere un **confronto esatto** contro un insieme, non un
riconoscimento tollerante — coerente con la preferenza di questo progetto per il
deterministico — e ciò che produce è codice valido. Costo dichiarato: N forme per entità, e
una forma non prevista resta un passaggio silenzioso. Andava confrontata con la risposta 2
(alias progettato per non essere trasformabile) — e **il confronto c'è stato**: la
risposta 2 una forma l'ha trovata (l'àncora, §6.7), e la famiglia di forme ha perso su
entrambi i lati. Sul riconoscimento: copre solo le forme **enumerate**, mentre l'àncora
sopravvive a qualunque cambio di case e separatori perché il confronto avviene sul testo
normalizzato. Sulla riconversione: il suo scopo — rimettere il nome vero dentro
l'identificatore — è stato rifiutato **in sé** (D36): un nome vero in un identificatore
andrebbe rimascherato come sottostringa al giro dopo, dove i falsi positivi sono reali.

### 6.6 Come era stata specificata la misura B

Un turno vero di **scrittura di codice**, con gli alias già dentro il contesto come
arriverebbero da un `tool_result` filtrato, piantati nei tre posti dove il modello li
maneggia in modo diverso: in **prosa**, dentro **identificatori di codice**, dentro
**percorsi di file**. Sia semplici (`[NomeCognome-01]`, `[sk-REDACTED-01]`) sia
**composti** (`[persona-01]@[azienda-02].example`, dovuti a D32). Il compito deve
costringere il modello a *riusarli* — rinominare, scrivere una funzione che li tratta,
citarli in un commento — non solo a leggerli.

Per ogni alias si registra l'esito, in quattro classi:
**citato intatto** / **trasformato** (e come: case, separatori, troncato) /
**tradotto o parafrasato** / **mai ripreso**. Le prime due si contano anche dentro gli
`input.*` dei `tool_use`, che è dove un alias storpiato fa il danno vero (finirebbe
scritto in un file — no: il proxy lo bloccherebbe, ed è proprio il blocco da contare).

Costo: un turno di Sonnet, la taglia delle sonde già fatte. La soglia di lettura è onesta:
se con la regola «ferma tutto» il blocco scatterebbe più di qualche volta per sessione,
la risposta 3 è fuori e si confrontano le prime due; se gli alias passano intatti quasi
sempre, l'impianto regge com'è e resta solo il buffer di ricucitura.

**Cosa la specifica non aveva previsto, e che è costato due giri in più.** Due errori di
scena, che vale la pena lasciare scritti perché sono il modo tipico in cui una prova
«non fallisce: mente»:

1. Il primo giro dichiarava un alias «inventato dal modello» che invece stava nella scena:
   l'insieme degli emessi era incompleto. Zero allucinazioni, non una.
2. Il primo giro lasciava **D32 non misurata** — l'alias composto risultava «mai ripreso»,
   ma solo perché il compito non lo richiedeva mai: apparteneva al cliente la cui cartella
   esisteva già. Una prova che guarda il posto sbagliato non fallisce, resta verde.
3. E soprattutto: entrambi i giri amichevoli mettevano gli alias **solo dove sono legali**.
   La pressione vera — l'identificatore, che §6.4 nominava — non c'era. È servita una terza
   scena, ostile, per farla comparire; ed è quella che ha ribaltato la lettura.

### 6.7 Misura B-bis — l'àncora, **fatta la sera stessa: passa.** Chiude §9.12

La strada scelta dall'utente davanti al passaggio silenzioso: *«troviamo una forma sempre
riconoscibile per gli alias, in modo da poterli individuare e riconvertire facilmente»*.
Sonda `spike/alias-ancora.ts`, due giri sulla stessa scena ostile della B; **la cattura
stavolta si salva** (`spike/captures/alias-ancora.jsonl` — l'output a schermo della B è
andato perso, e non si perde due volte).

**La forma (D34): contatore + codice fusi.** `[Cliente-02k7]`, `[NomeCognome-01v4]`,
composti inclusi (`[persona-01v4]@[azienda-02k7].example`). Il codice pesca da un alfabeto
**non esadecimale** (`g h j k m n p q r s t v w x z` più cifre), così non può vivere per
caso dentro uno SHA o un UUID. Tre proprietà, una per nemico:

- sopravvive a **case e separatori**: la forma canonica (minuscolo, via i separatori)
  contiene sempre `02k7`, qualunque grafia il modello scelga;
- sopravvive alla **traduzione**: se `Cliente` diventa `Customer`, l'àncora resta — la
  parola-tipo serve alla leggibilità (§6.1), il riconoscimento non poggia su di lei;
- **niente falsi positivi strutturali**: non si cerca un pattern ma un **insieme chiuso**,
  i codici che il dizionario ha emesso davvero. La precisione viene dalla chiusura
  dell'insieme, non dalla rarità della forma — stessa filosofia di D11.

**La scommessa da misurare**: il modello *conserva* il codice quando deriva, o lo ripulisce
come rumore? Due varianti: alias nudi, e una riga in `append` al system prompt che chiede
di conservare la coda (leva che STARK controlla, `systemPrompt.append`).

| | senza riga | con riga |
|---|---|---|
| `[Cliente-02k7]` → | `getTariffaCliente02k7`, `cliente-02k7.ts` | `tariffaCliente02k7`, `cliente02k7.ts` |
| `[Cliente-03xq]` → | `getTariffaCliente03xq`, `cliente-03xq.ts` | `tariffaCliente03xq`, `cliente03xq.ts` |
| àncore vive nei derivati | **2/2** | **2/2** |
| àncore spogliate | 0 | 0 |

Il modello tratta `Cliente-02k7` come **il nome distintivo intero** — coerente con la B,
dove conservava il `02` per la stessa ragione. E la **riga nel prompt non serve**: stesso
risultato senza, quindi non si paga rumore nel system prompt per un problema che non
esiste. La leva resta annotata qui per il giorno in cui un modello si comportasse
diversamente. Campione piccolo (un giro per variante), ma la scommessa era binaria e ha
risposto due volte nello stesso verso, su grafie diverse.

**Ripetuta su un secondo modello — Haiku 4.5, quasi gratis: identica.** Àncore vive 2/2,
zero spogliate, con e senza riga (`spike/alias-ancora.ts claude-haiku-4-5`). E un caso
che vale più del conteggio: nel giro «con riga» Haiku ha scritto `getClienteTariff02k7` —
ha **tradotto e riordinato la parola-tipo** (`Tariffa`→`Tariff`) e **conservato l'àncora
`02k7`**. È la proprietà per cui l'àncora esiste, vista accadere: quando il modello fa la
cosa peggiore per un confronto normalizzato — traduce — l'àncora è ciò che resta. Il
campione ora è **due modelli** dello stesso fornitore; resta aperto un modello di un
fornitore diverso (OpenCode), che è §9.13 sotto un'altra faccia.

**Il riconoscitore che ne esce (D35): due passi, entrambi deterministici.** Esatto (byte
per byte, il percorso veloce e l'unico che riconverte al valore) e **normalizzato
sull'insieme chiuso** degli aghi emessi, che ritrova i derivati. Niente fuzzy, ed è un no
con una ragione misurabile: `…-01` e `…-02` distano un carattere, e un matching a distanza
di Levenshtein può fondere due entità — il difetto invisibile del §6.3 (S15). Il buffer di
ricucitura serve comunque ed è lo stesso.

**Cosa se ne fa il proxy (D36, deciso dall'utente): dipende da dove sta.** In stringhe,
percorsi e prosa — dove il valore vero ci sta — il derivato riconosciuto **si riconverte**.
Dentro un identificatore il valore vero non ci sta (spazi, punti, accenti), e rimettercelo
in una forma derivata da noi sarebbe instabile al giro dopo: il nome vero dentro
`tariffaAcmeSpa`, riletto da un `tool_result`, andrebbe rimascherato come **sottostringa**
in uscita, dove i falsi positivi sono reali («Rossi» dentro `rossiniOpera`). Quindi negli
identificatori si **riconosce, si lascia, e si dichiara**: marcatore di D33 sul nome, riga
nel registro. Il derivato è il **punto fisso** del sistema — riletto, non contiene dati
veri, passa identico, il modello rivede ciò che ha scritto. Grazie all'àncora il passaggio
silenzioso del §6.5 smette di esistere: resta un segnaposto nel codice, ma è un **costo
dichiarato**, non un difetto invisibile. La differenza fra i due è tutta la differenza.

---

## 7. Il registro **è** la prova

Scelta: nel registro va **anche il payload anonimizzato**, non solo l'elenco dei
mascheramenti.

Conseguenza, e vale più di quanto sembri: il registro non *documenta* la protezione — **è**
la protezione, resa verificabile. La frase da vendere smette di chiedere fiducia:

> *Apri il registro, cerca il nome del tuo cliente. Non c'è.*

Stessa forma del journal (JSONL append-only), stesso modo di rileggerlo dalla coda — e la
stessa trappola già imparata: chi rilegge un file che cresce in coda deve leggere la coda.

*Costi da accettare esplicitamente:* è un **secondo archivio** che cresce, e finisce nella
stessa domanda ancora aperta sulla rotazione del journal. E la promessa è su **STARK**, non
sulla macchina: se l'utente apre `claude` in un terminale, quel traffico non passa di qui.

---

## 8. Collisione con un principio fondante, registrata come costo

CLAUDE.md: **«STARK non deve mai poter meno del CLI»**. Un STARK che anonimizza **può
meno** — il §6 riduce molto il danno, ma non a zero: un modello che non vede il valore di
una chiave non può dirti che è scaduta.

Non annulla il principio, lo vincola: la funzione è **spenta di default**, **accesa da chi
sa cosa sta comprando**, e **visibile mentre è accesa**. Come, è deciso (D33, 3 settembre
2026), in due pezzi che rispondono a due domande diverse:

- un **indicatore fisso in barra di stato** finché il progetto è protetto — risponde a
  «il filtro è in mezzo?», e si vede anche quando non sta mascherando niente;
- un **marcatore su ogni mascheramento** nella conversazione — risponde a «cosa ha visto
  il modello?». L'utente legge i valori veri, perché il ritorno è deanonimizzato (§3.1):
  senza il marcatore, la conversazione non direbbe in nessun punto che lì è passato un
  alias, né quale.

**Scartata la terza opzione sul tavolo** — la via d'uscita «questo turno in chiaro» (S12).
Sembrerebbe il gesto simmetrico a D30, e non lo è: il transcript si rispedisce **intero a
ogni giro** (§3.2), quindi «questo turno in chiaro» non manderebbe in chiaro un turno —
manderebbe in chiaro **tutta la conversazione**, `tool_result` mai guardati dall'utente
compresi. Il consenso informato che salva D30 («l'utente ha scelto quel file sapendo
cos'è») lì non si trasferisce: nessuno sa cosa c'è in venti `tool_result` accumulati.

---

## 9. Domande ancora aperte

1. ~~Un file vietato: bloccato o mascherato?~~ → chiusa da **D31**, §5.3: mascherato nei
   valori, chiavi in chiaro; dove la struttura non si riconosce, divieto pieno.
2. ~~Entità annidate~~ → chiusa da **D32**, §6.3: a strati, con alias composti; la misura
   B li prova (§6.5).
3. ~~Come si mostra il prezzo~~ → chiusa da **D33**, §8: barra di stato fissa + marcatore
   per mascheramento. Niente via d'uscita per turno (S12).
4. ~~E OpenCode? Un proxy sul traffico è un fatto dell'adapter o una cosa sola più in
   basso?~~ → **chiusa dalla misura A-ter** (§4.5, D37): **dell'adapter**. Ogni agent ha
   la sua leva ufficiale — Claude Code l'`env` del processo, OpenCode la config del
   server, per provider — e una cosa «più in basso» (mitm, LD_PRELOAD) non sarebbe una
   superficie ufficiale. Il **motore** (dizionario, filtro, registro) resta uno e
   condiviso: è il punto d'aggancio a essere dell'adapter.
5. **I journal restano in chiaro** — fuori perimetro oggi, ma è la prima domanda che fa un
   cliente a cui vendi la cosa.
6. **La rotazione**: due archivi append-only invece di uno.
7. **La frase esatta** che si vende: **bozza scritta** (§1.2), resta il vaglio
   dell'utente — e la regola che l'accompagna: si corregge la decisione a monte, non la
   frase.
8. ~~Il proxy giù ferma tutto?~~ → chiusa da **D19**: si risorveglia, come il daemon.
9. ~~Come il proxy conosce il dizionario?~~ → chiusa da **D20/D21**: file per progetto,
   riletto a caldo, in `~/.stark/` e non nella cartella del progetto.
10. ~~Il dizionario su tre macchine~~ → chiusa da **D22/D23/D24**, §5.1.
11. ~~Un allegato non filtrabile: rifiutato o consentito?~~ → chiusa da **D30**, §5.5: si
    avvisa e passa, con il rischio dichiarato all'utente e l'evento nel registro.
12. ~~Con cosa si sostituisce un alias trasformato?~~ → **chiusa la sera stessa da
    D34–D36** (§6.7, misura B-bis): gli alias prendono un'**àncora** che sopravvive alla
    derivazione, il riconoscitore diventa esatto + normalizzato su insieme chiuso, e negli
    identificatori **non si sostituisce**: si riconosce, si lascia e si dichiara — perché
    la trasformazione è lossy nei due versi, e il nome vero rimesso in un identificatore
    sarebbe instabile al giro dopo. La candidata «famiglia di forme» è S14.
13. **La copertura per-provider su OpenCode** (aperta da A-ter, §4.5) → **largamente
    chiusa la sera stessa** (§4.6, sonda `proxy-per-provider.ts`, costo zero): la leva
    `options.baseURL` instrada **tutti e cinque** i provider di questa macchina —
    anthropic, Zen (`opencode`), Baseten, opencode-go, Merge Gateway — col prefisso di
    percorso tenuto 2/2 ciascuno. Non è un'eccezione di `anthropic`: è un comportamento
    dell'AI SDK sotto OpenCode, non del singolo loader. **Resta grigio solo l'OAuth**
    (Anthropic lo vieta, plugin rimossi dalla 1.3.0): è comunque una via che un progetto
    protetto può **rifiutare** (D17 per provider), non una che deve coprire.
14. ~~Il limite della pausa e l'idempotenza del retry~~ → **chiusa il 4 settembre 2026
    con i valori v1**, dichiarati da tarare coi numeri dell'ombra: (a) il proxy trattiene
    fino a **240 secondi** — ben dentro i ~311 misurati, così la scadenza è la nostra e
    non quella del client; oltre, chiude con un errore distinguibile e la decisione
    dell'utente resta in attesa per il retry; (b) la chiave di deduplica è **l'hash
    SHA-256 del corpo** dentro la stessa sessione — il retry misurato è byte-per-byte
    identico (§4.7), quindi l'hash lo riconosce senza inventare un protocollo. Due
    costanti e una `Map`, come previsto.

---

## 10. Decisioni prese

| # | Decisione | Perché |
|---|---|---|
| D1 | La sostituzione è **reversibile** (alias con mappa locale), non redazione secca | L'utente deve vedere i nomi veri; il modello deve lavorare su dati coerenti |
| D2 | Il filtro **sul solo prompt dell'utente** non è ammissibile come garanzia | §2: la maggior parte dei dati non passa da lì. Col §1.1 sarebbe una promessa falsa |
| D3 | Il journal **non** è il punto di intercetto; `journal.ts:6` va corretto | Vede il riassunto dei tool, non il loro contenuto |
| D4 | **Due livelli**: filtro a monte per comodità, proxy come garanzia | Fanno lavori diversi; solo il secondo si può descrivere come perimetro |
| D5 | Il proxy è **bidirezionale**: solo il filo vede gli alias | Disco, CLI e journal restano coi dati veri → nessun segnaposto tocca un file |
| D6 | Il **dizionario è un pannello del progetto**, con voci automatiche, proposte e a mano, tutte rimovibili | Il rumore diventa un costo iniziale invece che ricorrente; il non-determinismo resta nella scoperta |
| D7 | **In dubbio, ferma** | Confermata due volte, anche dopo che esisteva un posto alternativo dove decidere |
| D8 | **Alias di forma simile al dato**, in spazi riservati | Il modello capisce il tipo e ha un identificatore unico su cui ragionare, senza il valore |
| D9 | Il **contatore per progetto** (`-01`), non un hash del valore | Il dizionario persistito lo rende stabile; ed è leggibile dal modello e dall'utente |
| D10 | Nel registro va **anche il payload anonimizzato** | Il registro diventa la prova, verificabile senza fidarsi di noi |
| D11 | **Niente entropia generica**; forme note larghe + file ignorati da git vietati | Un filtro che grida a ogni SHA di git viene spento, e una funzione spenta non protegge |
| D12 | La promessa sui segreti si **corregge**: «di forma nota, più quelli che dichiari» | §1.1 — deve reggere a una domanda, non suonare bene |
| D13 | Il perimetro è il **progetto**, non la sessione | «Questa cartella è di un cliente» è un fatto della cartella |
| D14 | Spenta di default, visibile quando accesa | §8: può meno del CLI, e non si nasconde un costo |
| D15 | Il proxy è un **processo separato, uno solo** | Il daemon si riavvia; separandoli un aggiornamento non uccide i turni in volo |
| D16 | **Sempre in mezzo**, trasparente quando spento | Un percorso solo: due percorsi divergono col tempo (stessa ragione del journal senza secondo ramo) |
| D17 | **Fail-closed** sui progetti protetti | Partire senza filtro è il momento esatto in cui la promessa si rompe |
| D18 | L'identità della sessione viaggia nel **prefisso di percorso** della base URL | Misurato su entrambi i client del CLI (§4.3); non dipende da `ANTHROPIC_CUSTOM_HEADERS`, e dà gratis il rifiuto delle sessioni sconosciute |
| D19 | Il proxy è **parte di STARK e si risorveglia**: `stark start` alza entrambi, se muore riparte | Così non è una cosa che «può essere giù» più di quanto lo sia il daemon: il fail-closed morde nel caso patologico, non nel quotidiano |
| D20 | Il dizionario è un **file per progetto, riletto a caldo** dal proxy | Nessun protocollo da inventare, sopravvive al riavvio di entrambi i processi — stessa filosofia del journal, che è un file e non un canale |
| D21 | Il file **non vive nella cartella del progetto**, ma in `~/.stark/` | `.stark/` è **tracciato in git** (il kanban ci sta dentro): il dizionario lì finirebbe in un commit e su GitHub. La funzione che serve a non far uscire i dati sarebbe l'unica a pubblicarli |
| D22 | **Spaccato in due, come `.env` / `.env.example`**: la politica nel repo, i valori fuori | La politica si condivide con una squadra e viaggia col progetto; i valori no. Ogni macchina eredita subito le regole |
| D23 | Il dizionario dei valori **si condivide, non si fonde**: una copia autorevole che si distribuisce | Due macchine che scoprono in parallelo assegnano lo stesso `-01` a entità diverse: unirli è un **conflitto silenzioso**, il file resta valido e la mappa mente |
| D24 | La condivisione è un **gesto esplicito** (esportazione con passphrase), mai automatica | È peggio di un `.env`: non dà accesso a dei sistemi, **è la chiave di lettura di tutto ciò che è già stato trasmesso** |
| D25 | Il filtro agisce su **cinque regioni**: `system[].text`, `messages[].content` (stringa), `.text`, il `.content` dei `tool_result`, l'`.input.*` dei `tool_use` | Misurate camminando il JSON vero, non elencate a memoria (`docs/anonimizzazione-flusso.md`) |
| D26 | `signature` **non si tocca e non si confronta** col dizionario | È un blob opaco firmato: modificarlo invaliderebbe il blocco di ragionamento |
| D27 | `tools[]` si **salta**, non si filtra | È l'88-90% dei byte e non contiene dati dell'utente: scansionarlo a ogni turno sprecherebbe il 90% del lavoro |
| D28 | La promessa dice **contenuto, non identità** | `metadata.user_id` porta account e dispositivo a ogni richiesta, e toglierlo romperebbe l'attribuzione della quota |
| D29 | **Immagini e PDF non si anonimizzano**, ed è un limite **dichiarato** | Servirebbero OCR, scelta delle regioni e ridipintura dei pixel: è un prodotto a sé, non una riga in più. Dichiararlo è l'unico modo di non avere una promessa falsa sulla fetta scoperta (§5.4) |
| D30 | Un allegato non filtrabile **non si rifiuta: si avvisa**, e il rischio se lo prende l'utente. **Unica eccezione a D7 e D17** | Un allegato è un atto **dell'utente**, un `tool_result` è un atto dell'agent. Il fail-closed difende da ciò che non si vede; qui l'utente ha scelto quel file sapendo cosa contiene, quindi il consenso è informato invece che una firma in bianco (§5.5) |
| D31 | Un file ignorato da git si serve **mascherato nei valori** (chiavi in chiaro, valori come alias), non negato | L'agent resta capace («manca la variabile X») senza vedere un valore. Dove la struttura non si riconosce torna il divieto pieno — D7 su un file intero. Le chiavi passano comunque dal filtro normale (§5.3) |
| D32 | Le entità annidate si mascherano **a strati**: alias composti, `[persona-01]@[azienda-02].example` | La coerenza referenziale vale per le parti: venti occorrenze dello stesso dominio devono restare lo stesso dominio. Costo: più fragili al ritorno, quindi la misura B li prova (§6.3, §6.5) |
| D33 | Visibilità: **indicatore fisso in barra di stato** + **marcatore su ogni mascheramento**. Nessuna via d'uscita per turno | D14 chiede che il costo si veda: la barra dice «il filtro è in mezzo», il marcatore dice «qui il modello ha visto un alias» mentre l'utente legge i valori veri. La via per turno è S12 (§8) |
| D34 | Gli alias portano un'**àncora**: contatore + codice fusi (`[Cliente-02k7]`), alfabeto non esadecimale | Sopravvive a case, separatori e traduzione dentro i nomi derivati (misurato 2/2, §6.7); una lettera non-hex la tiene fuori da SHA e UUID; l'insieme chiuso dei codici emessi azzera i falsi positivi strutturali |
| D35 | Riconoscitore **a due passi, entrambi deterministici**: esatto + normalizzato sull'insieme chiuso degli aghi emessi | L'esatto è il percorso veloce e l'unico che riconverte; il normalizzato ritrova i derivati. Niente fuzzy: `…-01` e `…-02` distano un carattere, e fonderli è il difetto invisibile del §6.3 (S15) |
| D36 | Derivato riconosciuto: **riconverti** in stringhe/percorsi/prosa, **riconosci-lascia-dichiara** negli identificatori | Il valore vero in un identificatore non ci sta, e in forma derivata sarebbe da rimascherare come sottostringa al giro dopo — instabile e pieno di falsi positivi. Il derivato è il punto fisso; con l'àncora non è più silenzioso: marcatore + registro (§6.7) |
| D37 | Il punto d'aggancio del proxy è **dell'adapter**; il motore (dizionario, filtro, registro) è **uno e condiviso** | Ogni agent ha la sua leva ufficiale, misurata: Claude Code l'`env` del processo (§4), OpenCode la config del server per provider (§4.5). Una cosa «più in basso» non sarebbe una superficie ufficiale — e per OpenCode la copertura si promette **per provider misurato**, §9.13 |
| D38 | **Semina obbligatoria**: la protezione si accende solo a semina del dizionario confermata | §3.2: non esiste il ritiro, quindi un dizionario vuoto rende la promessa falsa il primo giorno. La scoperta assistita passa dal proponitore (§11bis), le proposte si confermano o rimuovono (§12bis.2) |
| D39 | Il registro v1 salva **ogni richiesta intera** | Massima fedeltà probatoria e la scrittura più semplice per l'ombra; il costo (~MB a turno) è dichiarato e rende urgente la rotazione (§9.6). Si stringe dopo, coi numeri dell'ombra (§12bis.4) |
| D40 | Su OpenCode il proxy-id è **per ciclo di vita del server condiviso**, non per conversazione | Il server nasce una volta per macchina e `options.baseURL` si inietta una volta sola, alla nascita: un id per conversazione non avrebbe dove attaccarsi. Registrato quando `server()` avvia, deregistrato in `lascia()` |
| D41 | L'aggancio OpenCode copre **solo il provider `anthropic`**, anche se D37/§4.6 dicono che la leva instrada tutti i provider | `anthropic` è l'unico di cui conosciamo il vero upstream (misurato). Instradare Zen/Baseten/Merge Gateway vorrebbe dire indovinare il loro host reale — sbagliarlo romperebbe conversazioni vere. Si allarga quando si misura, non prima |

## 11. Ipotesi scartate

| # | Scartata | Perché |
|---|---|---|
| S1 | Redazione secca (`███`) | Il modello lavora bendato; scelta la reversibilità (D1), poi superata meglio da D8 |
| S2 | Anonimizzare agganciandosi al journal | §2 — guarda il posto sbagliato. Caso da manuale della trappola «una prova che guarda il posto sbagliato non fallisce: mente» |
| S3 | Solo hook dell'SDK, senza proxy | La copertura dipende da una superficie che il provider cambia senza preavviso, e i tipi non sono i fatti. Sopravvive come **livello 1**, mai come garanzia |
| S4 | Dizionario scritto a mano da zero | Nessuno lo compila davanti a un file vuoto. Sopravvive come **una delle tre strade** di D6 |
| S5 | Rilevatore automatico nel percorso caldo come decisore | Non-deterministico: romperebbe la stabilità della mappa e quindi la cache. Sopravvive per **proporre**, non per decidere |
| S6 | Entropia generica per i segreti | Falsi positivi su SHA, UUID, lockfile, base64: rumore che fa spegnere la funzione |
| S7 | Alias con formato valido (FPE) | Un IBAN con checksum giusto è l'IBAN di qualcuno: si maschera un dato creandone un altro |
| S8 | Hash del valore come alias | La premessa (mappa instabile fra sessioni) è caduta col dizionario persistito; e l'hash è illeggibile per entrambi i lettori |
| S9 | «Il codice del cliente non esce» come promessa | Nessun filtro la mantiene: serve un modello locale. È una funzione diversa |
| S10 | Registro dei soli mascheramenti | Dimostra che il filtro ha lavorato, non cosa ha visto il modello. Non è una prova |
| S11 | Anonimizzare immagini e PDF **dentro questo filtro** | Motore diverso (OCR, regioni, ridipintura), costi diversi, modi di sbagliare diversi. Resta **rimandato a una funzione sua**, non abbandonato — vedi D29 |
| S12 | Via d'uscita «questo turno in chiaro» | Il transcript si rispedisce intero (§3.2): un turno in chiaro è **la conversazione** in chiaro, `tool_result` mai guardati compresi. Sarebbe una seconda eccezione a D7/D17 senza il consenso informato che salva D30 |
| S13 | «Accettare il blocco» come risposta al §6.4 | **Misurata falsa la premessa** (§6.5): un alias trasformato in identificatore non ha più forma di alias, quindi il proxy non lo ferma — passa liscio. Non c'era nessun blocco da accettare, e il pericolo era un altro |
| S14 | **Famiglia di forme** per entità (citazione, pascal, kebab, maiuscolo) con inversione esatta | Persa il confronto con l'àncora (§6.7) su entrambi i lati: copre solo le forme enumerate — una non prevista resta un passaggio silenzioso — e il suo scopo, rimettere il nome vero negli identificatori, è stato rifiutato in sé (D36) |
| S15 | **Fuzzy matching** per i derivati (alla LLM Guard: Levenshtein ≤3) | `…-01` e `…-02` distano un carattere: il fuzzy può fondere due entità, che è il difetto invisibile del §6.3 — risposte plausibili e sbagliate. L'àncora dà lo stesso recupero restando deterministica (§11bis) |

---

## 11bis. Il paesaggio, guardato il 3 settembre 2026

Ricognizione fatta a valle delle misure, per rispondere alla domanda giusta di questo
progetto: **esiste già, e meglio?** Risposta corta: il pattern sì, il fabbisogno no.

Il pattern *anonymize → LLM → deanonymize* con mappa locale è consolidato e ha molti nomi:
Microsoft **Presidio** come mattone (analyzer NER+regex, anonymizer; l'unico operatore
reversibile è `encrypt`), **LLM Guard** con Anonymize/Deanonymize e un Vault, **PII
Shield** come sandwich REST per chiamata, **PrivAiTe** come proxy self-hosted reversibile.
L'impianto del §3 non è un'invenzione: è lo stato dell'arte, applicato a un traffico più
difficile — quello di un agent che scrive codice.

**La conferma che pesa di più è di Anthropic.** La issue **anthropics/claude-code#39882**
chiedeva hook `PreApiCall`/`PostApiCall` per esattamente questo caso d'uso, documentando
il buco che avevamo dedotto: `PostToolUse` **non può modificare** l'output dei tool.
Chiusa **not planned**, col proxy su `ANTHROPIC_BASE_URL` citato come la strada. Cioè: non
arriverà una superficie ufficiale di hook per il traffico, il proxy è la via sanzonata —
valida S3, l'architettura a due livelli, e mette un tetto al livello 1 anche come
comodità.

**Cosa nessuna soluzione trovata ha, e resta il fabbisogno:**

- il **dizionario stabile fra sessioni**: le mappe sono per richiesta (PrivAiTe: in RAM,
  buttata a fine richiesta) o per sessione — lo stesso cliente cambia nome a ogni giro,
  e un registro che cambia lessico non è una prova (§5.1);
- la **bidirezionalità col disco in chiaro** (D5): il prior art specifico per Claude Code
  (**privacy-guard-proxy**: detector deterministici regex+checksum, placeholder stabili,
  whitelist) per quanto documentato è **a senso unico** — i placeholder restano scritti
  nei file, il problema esatto che D5 elimina;
- la **regola sui file ignorati da git** (§5.3a): tutti sono fail-open sul solo
  rilevamento, nessuno ha una regola che decide senza dover riconoscere;
- il **registro come prova** (D10): nessuno conserva il payload anonimizzato ispezionabile;
- il caso **identificatori**: l'unico che tocca i placeholder storpiati è LLM Guard, col
  fuzzy — ed è S15. Il resto tace.

**Un'assenza istruttiva**: PrivAiTe **salta il campo `system` di proposito** — che noi
abbiamo misurato portare cartella di lavoro, ramo git e stato del repo (flusso §3.1). La
copertura si decide camminando il payload vero, non per categoria di campo.

**Da rubare invece di riscrivere**: Presidio o il motore di LLM Guard come **proponitori**
per la strada 2 di D6 — il rilevatore che propone, mai che decide (S5 resta). È la regola
«se esiste qualcosa di ufficiale e già pronto» applicata al pezzo giusto: il detector, non
l'impianto. E la checklist di copertura di PrivAiTe (tool args, refusals, contenuti
multimodali testuali) come lista di prova per la nostra.

In letteratura, **SurrogateShield** (2026) esplora surrogati *verosimili invece che
marcati* — la strada di S7: un surrogato plausibile collide con dati veri di qualcun
altro. Conferma però che la trasformazione dei surrogati da parte del modello è
riconosciuta come problema aperto anche lì: la B-bis, nel suo piccolo, è più avanti.

---

## 12. Prossimi passi, in ordine

1. ~~**Misura A** (§4) — `ANTHROPIC_BASE_URL` con credenziali da abbonamento~~ → **fatta il
   3 settembre 2026: passa.** Il proxy non tocca la fatturazione.
2. ~~**Misura A-bis** (§4.3) — instradamento per prefisso di percorso~~ → **fatta: passa**,
   su entrambi i client del CLI.
3. ~~**Misura B**~~ → **fatta, tre giri** (§6.5). La scelta di pagarla prima di A-ter era
   giusta: ha rovesciato una delle tre risposte del §6.4 (S13) e aperto §9.12.
4. ~~**Chiudere §9.12**~~ → **chiusa la sera stessa, con la misura B-bis** (§6.7, D34–D36):
   l'àncora sopravvive alla derivazione, il riconoscitore è esatto + normalizzato su
   insieme chiuso, e negli identificatori si riconosce-lascia-dichiara. La candidata
   «famiglia di forme» è stata confrontata e non scelta (S14). L'ordine era giusto due
   volte: misurare OpenCode su un meccanismo di inversione non deciso avrebbe pagato un
   giro due volte.
5. ~~**Misura A-ter** — l'equivalente su OpenCode~~ → **fatta il 3 settembre, sera tardi:
   passa, a costo zero** (§4.5, con la chiave finta). La leva è `options.baseURL` nella
   config del server, il prefisso sopravvive 2/2, e §9.4 si chiude con D37: l'aggancio è
   dell'adapter, il motore è condiviso. Restano i residui di §9.13 (OAuth, e i provider
   non-anthropic da misurare uno a uno prima di prometterci sopra).
6. Correggere il commento in `src/core/journal.ts:6`, che oggi indirizza male chiunque lo
   legga. È l'unica modifica al codice esistente che questo lavoro rende necessaria
   **subito**: finché resta, indirizza male chiunque parta da lì.
7. Chiudere ciò che resta del §9 — la 4 (OpenCode) si chiude con la misura A-ter; la 5
   (journal in chiaro) e la 6 (rotazione) sono di perimetro più largo del filtro; la 7
   aspetta solo il vaglio della bozza in §1.2.
8. ~~**L'implementazione parte da §12bis**~~ → **fatta il 4 settembre 2026**: le cinque
   decisioni di forma sono chiuse (D38/D39 e i residui tecnici), la modalità ombra è
   scritta e **agganciata** alle sessioni vere di entrambi gli adapter (D40/D41),
   provata end-to-end. **Prossimo passo: lasciarla girare qualche giorno su sessioni
   vere e leggere i numeri** — sono loro a scrivere la regola del §12bis.3 («cosa conta
   come dubbio»), non il contrario.

**Prima di tutto questo, la validazione.** Il documento va passato a un lettore che non ha
partecipato alle scelte, con in mano l'elenco «Le nove cose che vale la pena contestare» in
cima: sono i punti in cui, se la premessa è sbagliata, cambia il progetto e non un dettaglio.

## 12bis. Cosa va deciso prima della prima riga

Rilettura del 3 settembre 2026, a misure finite, con l'occhio di chi domani scrive il
proxy: le zone grigie rimaste, divise per gravità. Le prime cinque **cambiano la forma del
codice**, quindi vengono prima del codice.

### Le cinque che bloccano

1. **La meccanica della pausa — MISURATA** (`spike/pausa-blocco.ts`, §4.7), e non è più
   una domanda ma un vincolo con un numero. Trattenendo un `POST /v1/messages` senza mai
   rispondere, il client del CLI **regge ~311 secondi**, poi **chiude e ritenta da solo**
   con un corpo identico, e ancora — tre tentativi in dodici minuti, l'SDK mai tornato con
   un errore. Ne discende una regola precisa: **trattenere è la strada giusta entro una
   finestra di ~5 minuti**; la card dell'utente si lega alla **sessione, non al socket**,
   perché il socket sotto può essere già il secondo tentativo. Oltre i ~5 minuti non c'è
   attesa infinita gratis: il proxy deve deduplicare i retry (stesso corpo) e, se la
   decisione tarda troppo, chiudere con un errore distinguibile e rimandare. Il residuo è
   ora piccolo e circoscritto (§9.14): quanto vale «troppo», e come rendere idempotente il
   retry.
2. ~~La partenza a freddo del dizionario~~ → **decisa il 4 settembre 2026 (D38): semina
   obbligatoria.** Attivando la protezione parte una passata di scoperta sul repo
   (proponitore + forme note), l'utente conferma o rimuove le proposte, e **solo a semina
   confermata** il progetto è protetto. La ragione è §3.2: il primo `Read` del primo
   giorno passerebbe in chiaro e non esiste il ritiro — la promessa sarebbe falsa il
   primo giorno. Il flusso di onboarding resta da disegnare (schermata), ma la forma è
   fissata.
3. **Cosa conta come «dubbio», operativamente.** Le forme note sono deterministiche; il
   proponitore no. Ogni sua proposta **ferma** l'invio o **si accoda** senza fermare?
   Serve la regola scritta: cosa blocca (forme note violate, alias mai emessi, file
   git-ignored non parsabili) e cosa propone e basta. Il tasso di falsi positivi è la
   scommessa n. 2 delle «nove cose», e decide da solo se la funzione vive o viene spenta
   (S6 elevato a rischio di prodotto). **È esattamente ciò che la modalità ombra misura**:
   la regola si scrive con quei numeri davanti, non prima.
4. ~~Il registro, politica di taglia v1~~ → **decisa il 4 settembre 2026 (D39): tutto
   intero.** Ogni richiesta salvata per intera: massima fedeltà probatoria e la scrittura
   più semplice per la modalità ombra. Costo accettato e dichiarato: ~MB a turno, quindi
   la **rotazione (§9.6) diventa urgente subito** — è il prezzo di non inventare un
   formato delta prima di sapere cosa serve davvero. Si stringe dopo, coi numeri
   dell'ombra in mano.
5. ~~Chi scrive il dizionario~~ → **chiusa, ed era già scritta in D20/D23**: lo scrittore
   unico è il **daemon** (pannello e conferme passano tutti da lì), il proxy è **solo
   lettore** a caldo. Nessun lock: un solo scrittore non ne ha bisogno, ed è la lezione
   di D23 applicata dentro la stessa macchina.

### Da decidere presto, non prima di iniziare

- la **compattazione** (§4.4): da misurare alla prima sessione lunga vera;
- **§9.13**: l'MVP parte Claude Code-only, con OpenCode dichiarato fuori (fail-closed
  per provider) finché i provider usati non sono misurati uno a uno;
- la **ricucitura col riscape JSON** (flusso §5.3): lavoro noto, ma col maggior numero di
  modi di sbagliare in silenzio — merita una prova automatica coi tagli nei punti peggiori;
- l'**ordine dell'handshake** daemon→proxy: si registra la sessione *prima* di avviare il
  figlio, o la prima richiesta corre contro la registrazione.

### Rischi accettati, sorvegliati in esercizio

- **generalizzazione di B/B-bis** (cinque giri, un modello): il registro **conta** le
  àncore spogliate viste in produzione — la telemetria del degrado sta già dove deve stare;
- **thinking in chiaro**: oggi non passa (flusso §5.2); nel proxy va un'asserzione che
  grida se compare un `thinking` non vuoto, perché lì tornerebbe la reversibilità
  byte-per-byte;
- la **prassi `.env`** resta il punto operativamente più debole, e §5.1 lo dice già.

### Il primo passo dell'implementazione: la modalità ombra — **scritta il 4 settembre 2026**

Tutto l'impianto tecnico è misurato; la scommessa rimasta è **umana** — se il filtro ferma
troppo, l'utente lo spegne. Quindi il primo codice utile è il proxy **in osservazione**:
in mezzo, trasparente, che registra cosa *avrebbe* mascherato e cosa *avrebbe* fermato,
su sessioni vere, per qualche giorno. Misura il tasso di falsi positivi prima che il
blocco esista — si misura, poi si sceglie, come tutto il resto qui — e produce comunque
il primo pezzo vero: il proxy trasparente con la cattura, che serve in ogni caso.

**Com'è fatta** (`src/proxy/`, provata da `npm run ombra:check` — 20 verifiche, costo
zero, upstream finto locale):

- `ombra.ts` — l'occhio, **puro**: le cinque regioni di D25 camminate come nel flusso
  (comprese le due forme di `content`), `tools[]` saltato ma **pesato** (così il rapporto
  88-90% resta misurato dal vivo), `thinking`/`signature` mai toccati, e le forme note di
  §5.3b coi loro nomi leggibili. È il modulo che domani diventa il filtro vero: ombra e
  mascheramento devono guardare con lo stesso occhio, o l'ombra misura una cosa e il
  filtro ne fa un'altra.
- `server.ts` — il processo: registrazione via `/control/*` **col token del daemon**
  (registrare è un potere: chi può registrare può instradare), traffico solo su
  `/s/<id>` registrati (fail-closed §4.3: niente relay aperto), inoltro identico con
  **tutte** le intestazioni (una lista di ammesse sarebbe il posto dove la promessa
  sulle `ratelimit-*` si romperebbe in silenzio), registro JSONL per sessione in
  `~/.stark/ombra/` con la richiesta **intera** (D39) più l'analisi.
- `main.ts` — l'ingresso come processo (`npm run proxy`), separato perché il server è
  una funzione che anche le prove avviano con casa e porta loro (la lezione di
  `daemon-check` sullo `STARK_HOME` risolto troppo presto).

**Cosa manca perché l'ombra conti davvero**: l'aggancio — `stark start` che alza il
proxy accanto al daemon (D19, col pattern di sopravvivenza di `stark.ts`), l'adapter che
registra la sessione e punta `ANTHROPIC_BASE_URL` / `options.baseURL` al prefisso, e la
deregistrazione alla chiusura. Poi qualche giorno di sessioni vere, e i numeri.

**L'aggancio è scritto, lo stesso 4 settembre 2026** (D40, D41 qui sotto), dopo due
scelte confermate con l'utente: **sempre attiva** per ogni sessione (D16 preso alla
lettera, non solo per il progetto protetto che ancora non esiste) e **entrambi gli
adapter nello stesso giro**.

- **`stark.ts`**: `avviaConSystemd`/`avviaStaccato` diventano **generici** — un `Lancio`
  (nome, script, argv, condizione di vita) invece di essere cablati sul daemon — e il
  daemon ne resta un caso, non una copia. `pidPath`/`logPath`/`runningPid`/`writePid`/
  `clearPid` prendono un `nome` opzionale (default `'daemon'`, retrocompatibile al
  100%: nessun chiamante esistente passava un secondo argomento). `start`/`up`
  chiamano `assicuraProxy()` **best-effort**: se il proxy non parte, il comando non
  fallisce — l'ombra è osservazione, non ancora la garanzia di §4bis. `status` mostra
  entrambi (D19), e lo mostra **anche quando il daemon è fermo**: è il caso che conta
  di più, perché `stop` lascia il proxy acceso di proposito. Il proxy ha una rotta di
  spegnimento propria (`POST /control/spegni`, col token) per lo stesso motivo per cui
  il daemon ce l'ha: `SIGTERM` non esiste su Windows.
- **`stop` NON ferma il proxy**, e non per dimenticanza: `update` richiama `stop` poi
  `start` sullo stesso processo per far ripartire il daemon col codice nuovo, ed è
  **esattamente** il caso che D15 vuole proteggere — un riavvio del daemon non deve
  interrompere richieste in volo attraverso il proxy. Fermarlo a ogni `stop` vorrebbe
  dire tagliarle a ogni aggiornamento. Non c'è ancora un verbo per spegnere anche
  l'ombra: onestamente assente, non improvvisato.
- **L'adapter Claude Code** (`adapter.ts`): a ogni `start()`, un `randomUUID()` si
  registra presso il proxy (`proxy/client.ts`) con l'upstream fisso
  `https://api.anthropic.com`; se risponde, `options.env.ANTHROPIC_BASE_URL` punta al
  prefisso — **in merge**, non in sostituzione, perché `buildOptions` può aver già
  messo `env` per `CLAUDE_CONFIG_DIR` e l'assenza di `env` vuol dire «eredita
  `process.env`»: sovrascriverlo toglierebbe `PATH` e `HOME` al processo figlio. Se il
  proxy non risponde entro 800 ms, la sessione parte **senza** osservazione — mai
  bloccata da un proxy lento o giù. `close()` deregistra, senza aspettare la risposta.
- **L'adapter OpenCode** (`host.ts`) — **D40**: un proxy-id per **il ciclo di vita del
  server condiviso**, non per conversazione. La ragione è strutturale, non una scelta:
  il server nasce una volta per macchina (commento in testa al file) e
  `options.baseURL` si inietta una volta sola, alla nascita — un id per conversazione
  non avrebbe dove attaccarsi. E **D41**: si aggancia **solo il provider `anthropic`**,
  anche se la misura del 4.6 dice che la leva instrada tutti e cinque i provider di
  questa macchina. La ragione: `anthropic` è l'unico di cui conosciamo il vero
  upstream (misurato). Instradare Zen/Baseten/Merge Gateway attraverso il proxy
  vorrebbe dire indovinare il loro host reale — sbagliarlo romperebbe conversazioni
  vere su provider che oggi funzionano, un rischio che nessuna misura giustifica
  ancora. Stessa cautela di `stark.ts`: se il proxy non risponde in tempo, il server
  OpenCode nasce **senza** la config, esattamente come nasceva ieri — un proxy lento o
  giù non deve poter rompere OpenCode per l'intera macchina condivisa.
- **La lezione pagata provando dal vivo**, perché vale più della riga che corregge:
  la prima versione chiamava `assicuraProxy()` anche dentro il ramo `run` di
  `stark.ts`. Sembrava innocuo — «se qualcuno lancia `npm run stark` in foreground,
  vuole l'ombra anche lui» — ma `avviaStaccato(lancioDaemon)` **rilancia lo stesso
  file con `run`** come figlio staccato: `stark start` esegue `run` come *child*.
  Risultato, osservato in una prova end-to-end reale e non dedotto: due chiamate a
  `avviaStaccato(lancioProxy)` in parallelo, in due processi diversi (il padre `start`
  e il figlio `run`), che si contendevano lo stesso pid file. Il guard «già in
  esecuzione» ha retto — nessun danno — ma è il sintomo di una race scritta per
  distrazione, non una da lasciare lì confidando nella rete di sicurezza. Tolta da
  `run`: il proxy si accende solo dai comandi ESTERNI (`start`, `up`). Chi lancia
  `npm run stark` per debug in primo piano non ha ancora l'ombra — uno scope più
  piccolo dichiarato, non un buco taciuto.
- **Provato end-to-end**, non solo a unità: `stark start`/`status`/`stop` su una
  `STARK_HOME` scratch, porte non di default — un solo avvio del proxy (non due),
  `status` mostra entrambi i processi vivi, `stop` lascia l'ombra accesa,
  `POST /control/spegni` la ferma pulita (pid file tolto, nessun processo residuo).
  `npm run ombra:check` (20/20) e `npm run check` (338/338) restano verdi.

### Il giudizio, per chi valida

La domanda «è una buona soluzione?» ha una risposta corta con quattro gambe: **sì, ed è
la prima funzione in cui STARK batte la CLI strutturalmente, non incrementalmente.**
Nel terminale questa protezione **non esiste e non può esistere** — Anthropic ha chiuso
*not planned* la superficie di hook che l'avrebbe resa possibile (§11bis) — quindi il
principio «STARK non deve mai poter meno del CLI» qui si rovescia per la prima volta.
Il paesaggio conferma il fabbisogno scoperto (nessuno ha dizionario stabile,
bidirezionalità, regola git-ignore, registro-prova, caso identificatori). Le fondamenta
sono **misurate, non sperate** (sei sonde rifacibili). E la promessa è vendibile perché è
vera: più stretta di quella ingenua, ma regge alle domande — che con un NDA di mezzo vale
più dell'ampiezza (§1.1). Il punto in cui può ancora fallire è l'usabilità del blocco,
ed è esattamente ciò che la modalità ombra misura prima di rischiarlo.

## 13. Le sonde, e cosa costano

| Sonda | Domanda | Costo |
|---|---|---|
| `spike/proxy-base-url.ts` | Il CLI passa dalla base URL restando in abbonamento? E che forma ha il traffico? | un turno di Haiku da una parola |
| `spike/proxy-instradamento.ts` | Il prefisso di percorso sopravvive? | **zero quota** — nessun turno parte |
| `spike/flusso-anthropic.ts` | Quali endpoint, dove vive il testo, che forma ha il ritorno? | un turno con tre tool (≈4 andate) |
| `spike/alias-tenuta.ts` | Il modello cita gli alias o li riscrive? | un turno di Sonnet a giro; `--ostile` è quello che conta |
| `spike/alias-ancora.ts` | L'àncora `NNcc` sopravvive alla derivazione? Con e senza riga nel prompt | due turni di Sonnet; cattura in `spike/captures/alias-ancora.jsonl` |
| `spike/opencode/proxy-base-url.ts` | OpenCode passa dalla baseURL iniettata? Il prefisso sopravvive? | **zero quota** — chiave finta, il 401 a monte è l'esito atteso; cattura in `spike/captures/opencode-proxy.jsonl` |
| `spike/opencode/proxy-per-provider.ts` | La leva `options.baseURL` vale per ogni provider, non solo anthropic? | **zero quota** — il proxy blocca e non inoltra; cattura in `spike/captures/opencode-per-provider.jsonl` |
| `spike/pausa-blocco.ts` | Quanto regge il client del CLI se il proxy trattiene un turno? La pausa è vivibile? | **zero quota** senza `--rilascio`; un turno di Haiku con |

`alias-tenuta.ts` ha **due scene** e la seconda non è un di più: senza `--ostile` gli alias
finiscono solo dove sono legali e passano tutti intatti — cioè la sonda dice «regge» a una
domanda che non ha fatto. La scena ostile li costringe dentro identificatori, ed è l'unica
che misura la cosa per cui la sonda esiste.

E una lezione pagata lo stesso giorno: `alias-tenuta.ts` **non salva una cattura** — stampa
a schermo e basta — e l'output dei suoi tre giri è andato perso; l'esito è stato ricostruito
dai file lasciati nelle scene in `/tmp`, che spariscono al riavvio. `alias-ancora.ts` per
questo scrive tutto in `spike/captures/`: **una sonda che non archivia il proprio esito è
una misura che esiste finché è aperto il terminale.**

Cattura in `spike/captures/proxy-base-url.jsonl`: corpi di richiesta e risposta, credenziali
mostrate solo come schema e prefisso. È la stessa regola §6.1 applicata alla sonda che la
studia — abbastanza per riconoscere il tipo, mai abbastanza per usarla.
