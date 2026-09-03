# Il flusso fra Claude Code e l'API — dove occorre anonimizzare

> Documento di **riferimento**, non di decisione: le decisioni stanno in
> `docs/anonimizzazione.md`, questo dice com'è fatto il traffico su cui vanno applicate.
> Sta nel repo e non su Notion perché è accoppiato al codice e cambia con lui (ADR-003).
>
> Misurato il **3 settembre 2026**, non dedotto. Solo Claude Code: OpenCode è un altro
> giro (§8).

## 1. Come è stato misurato, e cosa la misura **non** dice

Sonda: `spike/flusso-anthropic.ts`. Alza un proxy su `127.0.0.1`, ci fa passare il CLI con
`ANTHROPIC_BASE_URL`, cattura **integralmente** richieste e risposte, e invece di elencare
a memoria i campi dell'API **cammina il JSON vero** stampando ogni percorso in cui c'è del
testo, con quanti byte. Se domani l'API aggiunge un campo, la sonda lo vede senza che
nessuno l'abbia previsto.

La scena: una cartella con un file che porta **tre esche** di forma diversa apposta — un
nome senza forma riconoscibile, una chiave con prefisso noto, un'email. L'agent deve
leggerle e poi **riscriverne una** in un file nuovo. Servono a seguirle dentro il payload:
rispondono alla domanda «il contenuto di un file letto dall'agent dove finisce,
esattamente?», che è il buco strutturale del §2 dell'altro documento.

**Condizioni della misura** (vanno dette, perché una misura fuori contesto mente):
CLI bundled **2.1.241**, SDK **0.3.241**, modello **Sonnet 5**, `thinking: adaptive`,
un account su abbonamento. E soprattutto: la sonda usa `buildOptions` **grezza**, senza la
riconciliazione MCP che l'adapter vero fa prima di ogni turno — quindi i conteggi dei tool
qui sotto sono **gonfi rispetto a STARK** (84 → 117 tool a sessione avviata: è la trappola
già documentata dei connettori di claude.ai che compaiono qualche secondo dopo).

---

## 2. Gli endpoint

Con la base URL puntata al proxy, tutto il traffico osservato è passato di lì. Due
endpoint, non di più:

| Metodo e percorso | Chi lo chiama | Cosa porta |
|---|---|---|
| `HEAD /api/hello` | il CLI stesso, user-agent `Bun/1.4.0`, **nessuna credenziale** | niente. È una sonda di raggiungibilità: **il proxy deve rispondere**, o il CLI si crede offline |
| `POST /v1/messages?beta=true` | il client `stainless` dentro il CLI, `Bearer sk-ant-oat01-…` | tutto il resto |

Non è passato **nessun** endpoint separato per la quota, la telemetria o i modelli: la
quota STARK la legge da un metodo dell'SDK, non da una rotta sua.

*Nota su cosa questo non esclude:* il binario del CLI contiene riferimenti a molti altri
host (`claude.ai`, `code.claude.com`, connettori vari). Non sono comparsi in questa
sessione, ma «non è comparso» non è «non esiste»: chi vuole la garanzia guarda il
**socket**, non l'elenco delle stringhe.

---

## 3. Anatomia della richiesta

Chiavi di primo livello osservate:
`model`, `messages`, `system`, `tools`, `metadata`, `max_tokens`, `thinking`,
`context_management`, `output_config`, `stream`.

### 3.1 Dove vive il testo, e cosa farne

| Percorso JSON | Cosa c'è | Cosa deve farne il filtro |
|---|---|---|
| `system[].text` | 3 blocchi, ~27 KB. Il system prompt di Claude Code, **più cartella di lavoro, ramo git e stato del repo** | **Anonimizzare.** I percorsi assoluti contengono nomi di clienti più spesso di quanto si creda (`/clienti/acme/…`) |
| `messages[].content` (stringa) | un messaggio di ruolo `system` da ~9,7 KB iniettato dal CLI | **Anonimizzare.** E notare la forma: `content` qui è una **stringa**, non un array — chi cammina il payload deve reggere entrambe |
| `messages[].content[].text` | la prosa: quella dell'utente e quella dell'assistente | **Anonimizzare** |
| `messages[].content[].content` | **`tool_result`** — l'output dei tool: contenuto dei file letti, uscita dei comandi | **Anonimizzare. È il punto più importante di tutti** (§4) |
| `messages[].content[].input.*` | **`tool_use`** — percorsi, comandi Bash, e **il contenuto che il modello scrive nei file** | **Anonimizzare in uscita, deanonimizzare in entrata.** È dove passa un `Write` |
| `messages[].content[].thinking` | vuoto (`""`) su questa configurazione | niente da fare, oggi (§5.2) |
| `messages[].content[].signature` | blob opaco, 420–976 caratteri | **Mai toccare, mai confrontare col dizionario.** Passa identico |
| `tools[].description` e `tools[].input_schema.**.description` | 284–377 KB, l'**88-90%** del payload in questa configurazione | Testo di terzi, non dell'utente. Non va anonimizzato, ma **va saltato in fretta**: è il grosso del lavoro di scansione a ogni turno |
| `metadata.user_id` | una stringa JSON con `device_id`, `account_uuid`, `session_id` | → §6, ed è la nota onesta più importante del documento |

### 3.2 I punti di ancoraggio della cache

`cache_control: {type: ephemeral, ttl: 1h}` compare su `system[1]`, `system[2]` e
**sull'ultimo `tool_result`**. Cioè: il prefisso stabile è ancorato, e un secondo ancoraggio
si sposta in avanti man mano che la conversazione cresce.

Conseguenza pratica: la trasformazione dei blocchi `system` **si può memoizzare**, sono gli
stessi 27 KB a ogni giro. E una voce nuova nel dizionario invalida il prefisso una volta
sola, non per sempre.

---

## 4. Il viaggio di un dato, misurato

Il file conteneva `Ludovica Ferrante-Malaspina`. Ecco dove è passata, in ordine:

1. **Non passa** quando il file viene letto: il `Read` avviene sulla macchina.
2. **Attraversa il confine** come `messages[].content[].content` — cioè dentro il
   `tool_result` del `Read`. **Il journal di STARK di questo non vede nulla**: riceve il
   riassunto del tool, non il testo. È la dimostrazione sperimentale del §2 dell'altro
   documento.
3. **Riattraversa** come `messages[].content[].input.content` quando il modello scrive
   `scheda.md`, cioè dentro un `tool_use` di `Write`.
4. **Riattraversa ancora**, e ancora: il transcript si rispedisce **intero a ogni giro**.
   Un prompt solo con tre tool ha prodotto **4 andate da ~420 KB, ~1,5 MB in tutto**, e la
   stessa esca è comparsa in due di esse.

> **Un dato letto una volta viene trasmesso N volte**, dove N è il numero di giri che
> restano nella conversazione. È la ragione quantificata per cui «non esiste il ritiro»: al
> momento in cui lo si scopre, è già uscito, e mascherarlo dopo cambia solo il futuro.

L'agent, va notato, ha usato **`Bash`** per il primo giro (`ls -la`) e `Read` per il
secondo. Il buco non è di un tool: è di tutti.

---

## 5. Anatomia della risposta

`Content-Type` SSE, e — **misurato, non previsto** — il corpo arriva **compresso in gzip**.
Uno stream compresso non si può riscrivere leggendolo: un proxy che deve deanonimizzare o
chiede `identity` togliendo `accept-encoding` (e paga banda vera fra sé e Anthropic), o
decomprime e ricomprime. La sonda fa la prima.

### 5.1 Gli eventi osservati

```
message_start
content_block_start/{text | tool_use | thinking}
content_block_delta/text_delta          ← la prosa del modello
content_block_delta/input_json_delta    ← l'input di un tool, a pezzi
content_block_delta/thinking_delta
content_block_delta/signature_delta
content_block_stop
message_delta
message_stop
ping
```

### 5.2 Il ragionamento non attraversa il filo in chiaro

Osservato su questa configurazione: i `thinking_delta` portano `thinking: ""` con solo un
`estimated_tokens`, e ciò che arriva davvero è un `signature_delta` con un blob opaco. Nella
richiesta successiva il blocco torna come `{type: thinking, thinking: "", signature: "…"}`.

**Ne discende una regola semplice, e un rischio evitato.** Semplice: non c'è nulla da
deanonimizzare nel ragionamento, e la firma si passa identica. Evitato: se il testo del
ragionamento *fosse* stato in chiaro, deanonimizzarlo all'andata e rianonimizzarlo al
ritorno avrebbe dovuto essere **byte per byte reversibile**, o la firma non avrebbe più
validato — il che avrebbe **escluso** la sostituzione inversa «tollerante» (§6.4
dell'altro documento) su quei blocchi.

*Da non generalizzare:* questa è un'osservazione su una configurazione, non una legge. Se
un domani il testo del ragionamento arrivasse leggibile, il vincolo di reversibilità
byte-per-byte torna, e va gestito.

### 5.3 Il problema vero del ritorno, misurato

L'input di un tool arriva **spezzato in frammenti arbitrari** di una stringa JSON in
costruzione. Catturato dal vivo, il `Write` del giro 4:

```
["", "{\"file_", "path\": \"/tm", "p/f", "lusso-H1", "M9hJ/scheda.", "md\"",
 ", \"co", "ntent\": \"Re", "ferente", ": ", "Ludovi", …]
```

Il nome si spezza in mezzo — `"Ludovi"` e poi `"ca Ferrante-Malaspina"`. E i tagli non
cadono sui confini delle parole né su quelli della sintassi JSON: cadono dove capita.

Quindi chi deanonimizza lo stream **non può guardare un frammento alla volta**. Servono due
cose insieme:

- un **buffer di ricucitura** che trattiene una coda lunga almeno quanto l'alias più lungo
  prima di lasciar passare;
- la consapevolezza che si sta riscrivendo **dentro una stringa JSON escapata**, quindi un
  valore vero che contenga `"` o `\` va riscapato mentre lo si reinserisce.

---

## 6. La nota onesta: l'anonimizzazione nasconde il **contenuto**, non l'**identità**

`metadata.user_id` viaggia a ogni richiesta e contiene, in chiaro:

```json
{"device_id":"3ef35882…","account_uuid":"486d8de8-…","session_id":"4187b3ab-…"}
```

Non è un nome, ma è un **identificatore stabile** che lega ogni richiesta a quell'account e
a quella macchina. Toglierlo non è una scelta libera: è plausibilmente il modo in cui viene
attribuita la quota.

Va detto perché tocca la frase da vendere: **il provider sa comunque chi sei.** Ciò che il
filtro impedisce è che sappia *di chi stai parlando* — cioè protegge le persone e i nomi nei
dati, non l'anonimato dell'utente di STARK. Chi vende la seconda cosa vende un'altra.

---

## 7. Cosa ne discende, in concreto

1. **Il punto di intercetto è uno**: `POST /v1/messages`. Tutto il resto del CLI non tocca
   dati.
2. **Cinque regioni da trattare in uscita**: `system[].text`, `messages[].content`
   (stringa), `messages[].content[].text`, `.content` dei `tool_result`, `.input.*` dei
   `tool_use`.
3. **Una regione da non toccare mai**: `signature`.
4. **Una regione da saltare in fretta**: `tools[]`, che è l'88-90% dei byte e non contiene
   dati dell'utente. Un filtro che la scansiona tutta a ogni turno spreca il 90% del lavoro.
5. **Il prefisso si memoizza**: gli stessi 27 KB di `system` a ogni giro.
6. **In entrata serve un buffer di ricucitura**, perché gli alias si spezzano fra i delta.
7. **Serve `identity` come codifica**, o decomprimere e ricomprimere.
8. **Il `tool_result` è il punto più importante**: è la porta da cui entrano i file, ed è
   l'unica che il journal non vede.

---

## 8. Cosa resta da misurare

- **OpenCode**: server proprio, più provider, formati diversi. Da rifare da capo.
- Il traffico con la **riconciliazione MCP di STARK attiva**, per avere i rapporti veri
  invece di quelli gonfi di questa sonda.
- Cosa succede alla **compattazione**: il riassunto lo genera il modello su una
  conversazione già anonimizzata, quindi torna pieno di alias e va rimesso a posto. Non
  osservato qui — la sessione era troppo corta.
- ~~Gli **allegati**~~ → **non è più una domanda: è un limite dichiarato** (D29, §5.4
  dell'altro documento). `image` e `document` in base64 non si anonimizzano — un nome dentro
  uno screenshot non lo vede nessuna espressione regolare, e riconoscerlo vorrebbe dire OCR,
  scelta delle regioni e ridipintura dei pixel: un prodotto a sé. I tipi **testuali** fra gli
  allegati (`text/plain`, `markdown`, `csv`) passano invece dal filtro normale, perché sono
  testo. E su un progetto protetto **non vengono rifiutati**: STARK avvisa che quel documento
  non sarà anonimizzato, la verifica passa all'utente, e l'evento finisce nel registro
  (D30, §5.5 — l'unica eccezione al blocco in tutto il sistema, con la sua ragione).
- Le **intestazioni di risposta** (`anthropic-ratelimit-*`): la sonda non le ha registrate,
  e il proxy deve passarle intatte o il pannellino della quota smette di sapere.
