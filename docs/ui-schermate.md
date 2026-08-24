# STARK — il progetto e le schermate

> Documento per ragionare sulla grafica. Descrive **cosa deve esserci e come si deve
> comportare**, non come deve apparire. Nessun dettaglio tecnico: serve a discutere le
> singole schermate con chi le disegna.

---

## Che cos'è STARK

Gli assistenti AI che scrivono codice — Claude Code e simili — si usano dal terminale.
Funzionano bene, ma l'interfaccia è un flusso di testo che scorre: tutto ha lo stesso
aspetto, niente si può richiudere, e ciò che è passato è passato.

STARK è **un'interfaccia vera** per gli stessi assistenti. Gira sulla macchina
dell'utente e si apre nel browser. Non mostra il terminale dentro una pagina: sostituisce
il terminale con qualcosa che sa **cosa sta succedendo** e può quindi mostrarlo bene.

### Come viene usato davvero

Non si lavora con un assistente alla volta. Se ne lanciano **tre o quattro in parallelo**,
su progetti diversi, e li si sorveglia: chi ha finito, chi è fermo ad aspettare una
risposta, chi sta ancora lavorando. Si entra in una conversazione **quando quella
conversazione chiama**, non controllandole a mano una per una.

Per questo STARK assomiglia più a un **cruscotto di lavori in corso** che a un'app di
messaggistica. In una chat la conversazione è il punto, e l'altro non cambia stato mentre
non guardi. Qui la conversazione è un sottoprodotto: quello che conta è **lo stato del
lavoro**, e cambia proprio mentre sei girato dall'altra parte.

### I dolori da cui nasce

Sono le cose che oggi rendono faticoso lavorare con questi assistenti dal terminale.
Vale la pena tenerle presenti perché quasi ogni scelta di questo documento risponde a una
di esse.

1. Un muro di testo in cui non si capisce cosa sia stato fatto.
2. Non si capisce dove comincia la risposta dell'assistente.
3. Ogni blocco sembra uguale agli altri.
4. Non c'è formattazione vera per tipi di contenuto diversi.
5. Il ragionamento dell'assistente non si vede.
6. Non si vedono le operazioni che ha eseguito, né cosa hanno prodotto.
7. Non si capisce quali file ha modificato e su quali righe.
8. Non si ritrovano le domande che ha fatto né le risposte che gli si sono date.

Un numero per dare la misura del problema: **tredici scambi di lavoro reale producono
circa quattrocento blocchi** fra testo, ragionamenti e operazioni. Qualunque cosa si
disegni deve reggere quel volume.

---

# L'impianto scelto

> **Deciso il 23 agosto 2026**, scegliendo fra tre anteprime, e rifinito il 24 agosto.
> Anteprima viva: https://claude.ai/code/artifact/ea5bfede-34b3-4fa7-b267-286409f964fb
> Sorgente: `docs/ui-anteprima.html` — **è il file da modificare** per aggiornare quell'indirizzo.

**Elenco compatto sempre a fianco.** Nessuna barra di navigazione separata: **l'elenco è la
navigazione**, ridotto all'essenziale — colore, nome, stato, da quanto tempo. Tutto lo spazio
che avanza va alla conversazione, che resta larga.

Le due conseguenze che hanno deciso la scelta:

- l'insieme dei lavori è **sempre visibile**, già ordinato per urgenza: chi aspetta sta in cima
  e non va cercato
- la conversazione ha **spazio vero**, quindi il confronto affiancato ci sta dentro il flusso
  invece di doversi aprire sopra tutto

### Le rifiniture del 24 agosto

- **La barra a sinistra** raggruppa per stato e, dentro ogni stato, **per progetto — sempre**,
  anche quando il progetto è uno solo: la struttura non deve cambiare forma sotto gli occhi.
- **Tutti i comandi stanno in basso**, attorno alla casella di scrittura. Sopra di essa un blocco
  con l'operazione in corso e, a destra, il **pulsante per fermare** — solo l'icona: un cerchio
  con dentro un quadrato (`circle-stop`), in rosso.
- **Quello stesso blocco è ciò che si espande** quando l'agent chiede un permesso o fa una domanda.
  Le richieste **non compaiono più in mezzo alla conversazione**: guardi sempre nello stesso posto.
  Nel flusso resta solo *cosa hai risposto*, dopo. Il pulsante per fermare **resta visibile anche
  quando il blocco è espanso**: una domanda arriva mentre l'agent lavora ancora, e se lo stop
  sparisse proprio lì si perderebbe il controllo nel momento in cui serve di più.
- **Sotto la casella una barra di stato**: a sinistra modalità, **strumenti esterni**, cartella e
  branch; a destra modello
  e percentuale di contesto. La percentuale, al passaggio del mouse, apre un pannellino con
  contesto, sessione corrente e settimana, e quando si azzerano le ultime due.
- **Gli effetti prendono il posto della conversazione**, con una freccia per tornare, e un
  interruttore compatto fra due letture: **per file** (blocchi che si aprono, stile pull request)
  e **in ordine di tempo** (comandi e singole modifiche in sequenza, quindi lo stesso file tre
  volte se è stato toccato tre volte).
- **Ogni tipo di blocco ha il suo segno**: cervello per il ragionamento, terminale per i comandi,
  mattone per le scritture, documento per le letture, globo per la rete, spina per gli strumenti
  esterni. Segni disegnati, non emoji.

Lo stile: laterale chiara, pill di stato, un colore per progetto, densità alta ma leggibile.

### Le rifiniture del 24 agosto, seconda tornata

- **La lingua dell'interfaccia è l'inglese.** Questo documento e le pagine su Notion restano in
  italiano: sono documentazione di progetto, non prodotto.
- **Tre stati soli, e si chiamano `Waiting`, `Working`, `Sleeping`.** Non esiste più un gruppo
  «finite»: **finito non vuol dire chiuso**. L'agent ha risposto e ora aspetta un prompt nuovo,
  quindi sta in *Waiting* come chi aspetta un permesso. Un lavoro è concluso quando lo decide
  l'utente, non quando l'agent smette di parlare.
- **I nomi dei progetti in maiuscolo**, come intestazioni di gruppo. Sono maiuscoli per
  presentazione, non nel dato: il nome resta la cartella così com'è.
- **Un progetto ha un colore solo**, in qualunque stato compaia. Lo stesso progetto in *Waiting*
  e in *Sleeping* porta lo stesso colore: il colore identifica il progetto, non la sezione.
- **Sotto il titolo: prima l'orario, poi lo stato** — `asking` quando aspetta un permesso o la
  risposta a una domanda, `done` quando ha finito il compito, `stopped` quando l'ha fermata
  l'utente. Nelle altre sezioni, `working` e `sleeping`.
- **Un pallino a destra sulle chat che aspettano.** Non è il «non letto» di una app di
  messaggistica: **non sparisce quando si apre la chat**, sparisce quando la chat **riprende a
  lavorare** — cioè quando le si manda un prompt nuovo, o quando riparte da sola dopo che si è
  risposto a una domanda bloccante. Dice *tocca a te*, non *non l'hai vista*: leggere non è
  rispondere, e una chat aperta e lasciata lì sta ancora aspettando.
  Sì, sotto questa regola il pallino dice la stessa cosa della sezione *Waiting*. È voluto:
  la sezione è un'intestazione che scorre via, il pallino viaggia con la riga.
- **Il pulsante degli effetti non si chiama.** Niente etichetta «Effetti»: resta il conteggio
  `4 files · 12 commands` con un'icona a barre a destra. Il conteggio dice già cosa si apre.
- **A sinistra del testo scritto dall'utente c'è l'orario** (`HH:MM`), nell'intestazione del turno.
- **La risposta a parole non si richiude mai**, per quanto sia lunga. Vedi le regole in fondo.
- **La X che chiude i riquadri è una X.** Nell'anteprima era il cerchio sbarrato di `ban`, che
  vuol dire *vietato* e non *chiudi*. Cambiato il 24 agosto 2026: si usa il segno che tutti
  riconoscono.
- **Le icone vengono da una libreria vera**: [Lucide](https://lucide.dev) (licenza ISC), non
  disegnate a mano. Nell'anteprima sono incorporate come sprite SVG perché il sandbox degli
  artifact blocca le CDN; nell'app si installa il pacchetto e si usa normalmente.

---

# Le schermate

## 1. L'insieme dei lavori

È la schermata da cui si parte e a cui si torna. Mostra tutte le conversazioni attive e
dormienti, raggruppate per progetto.

**Cosa serve sapere di ciascuna, per decidere se entrarci:**

- di che progetto e cartella si tratta
- **cosa sta facendo proprio adesso** — il comando che sta eseguendo o il file che sta
  scrivendo
- **da quanto tempo è in quello stato** — «ferma da 4 minuti», «lavora da 2». È
  l'informazione che più spesso fa entrare: distingue un lavoro che procede da uno piantato
- in che stato è: **ti aspetta** (`Waiting`), sta lavorando (`Working`), dorme (`Sleeping`)

Ogni conversazione ha un **colore** che la rende riconoscibile senza leggere, un **titolo**
che si genera da solo ma che si può cambiare, e la **cartella** a cui si riferisce.

Come sta nella riga, deciso implementando il 24 agosto 2026:

- sotto il titolo, **l'orario, lo stato e da quanto ci sta** — `working · 2m 14s`,
  `asking · 5m 12s`, `done · 12m`. «Da quanto» conta dall'**ultimo cambio di stato**, non
  dall'ultima riga scritta: su un lavoro che procede sono la stessa cosa, su uno piantato
  divergono, ed è lì che serve saperlo.
- una **terza riga** con l'operazione in corso, e **solo sulle righe vive**. Chi ha finito,
  chi dorme e chi è stato fermato non sta facendo niente: una riga in più su ognuna
  costerebbe l'altezza dell'elenco per non dire nulla. Su una sessione senza processo
  dietro sarebbe anche **falsa** — il suo journal è rimasto aperto a metà di un turno.

### Il comportamento che conta

Quando una conversazione si ferma ad aspettare una risposta, **non deve essere cercata**.
Il suo gruppo sale in cima e diventa una coda da smaltire: si risponde e si passa alla
successiva. L'utente non fa la ronda; è STARK che gli serve chi lo vuole.

Questa non è una schermata diversa, è **la stessa lista letta in un altro modo**. Mentre si
lavora si pensa per progetto («che sta facendo quello del sito?»); tornando dopo venti
minuti si pensa per urgenza («chi mi vuole?»).

### Come si viene avvisati

Con una **notifica di sistema** e un **suono**. Il pallino nella lista **non è** il modo in cui
si viene avvisati: funziona solo se si sta già guardando STARK, e il punto è poter guardare
altrove. Sono due cose con due mestieri — la notifica ti chiama, il pallino ti dice dove
guardare quando sei già dentro.

Il suono deve distinguere **«ho finito»** da **«ti sto aspettando»**: per chi ascolta sono
due situazioni opposte.

Come è fatto, deciso implementando il 24 agosto 2026:

- **tre chiamate**, che sono le stesse tre che le impostazioni sapranno spegnere una per una:
  *ti aspetta*, *ha finito*, *si è fermata da sola*. Suoni diversi, e i primi due opposti per
  costruzione — due note che salgono contro due che scendono.
- la notifica dice **chi ti vuole e di che progetto** nel titolo (`Needs you · api-pagamenti`),
  e nel corpo il titolo della chat più **cosa stava facendo**. Senza la seconda riga bisogna
  aprire per sapere cosa vuole, che è esattamente ciò che la notifica doveva evitare.
- **premerla apre quella chat**, e porta la finestra davanti.
- una chat non impila due notifiche: la seconda **sostituisce** la prima. Con quattro lavori
  in parallelo è la differenza fra essere avvisati ed essere sommersi.
- **non chiama se stai già guardando quella chat** e la finestra è in primo piano: lì il
  blocco in basso l'ha già detto.
- **aprire una chat non è «ha finito»**. Una conversazione appena nata passa da *starting* a
  *idle* senza che nessuno abbia fatto niente, e una notifica falsa insegna a spegnerle tutte.

**L'interruttore è una campanella in cima all'elenco**, perché le notifiche non sono di una
chat ma di tutte. Premerla la prima volta è anche il momento in cui **il browser chiede il
permesso**: fuori da un gesto dell'utente non si può nemmeno chiedere, e chiederlo all'apertura
della pagina è il modo migliore per farsi rispondere di no una volta per sempre.

Se il permesso viene negato la campanella **resta**, spenta e con scritto perché: il **suono
non ha bisogno di alcun permesso** e continua a funzionare, e quel che si perde è solo il
riquadro fuori dalla finestra. Nascondere il comando avrebbe fatto sembrare rotto STARK al
posto del browser.

Non c'è ancora, e arriva con le impostazioni: scegliere il suono di ciascun evento e
**silenziare un progetto intero**. L'acceso/spento di adesso vive nel browser, perché «voglio
sentire i suoni su questo computer» non è un fatto della conversazione; il silenziamento per
progetto invece dovrà stare dal lato del daemon, perché vale su qualunque browser lo apra.

---

## 2. Una conversazione aperta

Si passa da una conversazione all'altra **dall'elenco a sinistra**, senza perdere il punto in
cui si era. Niente linguette: l'elenco fa già da scambiatore, ed è sempre visibile — due
navigazioni per la stessa cosa sarebbero una di troppo.

### La struttura: il turno è un contenitore

Ogni cosa che l'utente chiede apre un **turno**, e tutto ciò che l'assistente fa in risposta
sta **dentro** quel turno. La richiesta non è un messaggio come gli altri: è
**l'intestazione** di ciò che segue.

Il turno intero si può **richiudere**. La conversazione diventa così una lista delle cose
che si sono chieste — tredici titoli invece di quattrocento blocchi — e si tiene aperto solo
quello a cui si sta lavorando.

### Cosa resta sempre sotto gli occhi

Tre cose, e solo queste:

- **il pulsante per fermare** l'assistente, raggiungibile senza cercarlo e senza scorrere
- **cosa sta facendo adesso**
- **quanto lavoro gli resta prima di dover aspettare** — e a che ora torna disponibile.
  Mai una cifra in denaro: l'utente ha un abbonamento a consumo fisso, quindi i soldi non
  sono la risorsa che scarseggia

### Le cose diverse che compaiono in una conversazione

Sono **quattordici**, e nel terminale hanno tutte lo stesso aspetto. Qui devono essere
**riconoscibili senza leggerle**.

| | Cos'è | Come si comporta |
|---|---|---|
| **la richiesta dell'utente** | ciò che ha chiesto | apre il turno e ne è l'intestazione |
| **la risposta a parole** | il testo dell'assistente | formattato per davvero: titoli, elenchi, tabelle. **Sempre per intero**, non si richiude mai |
| **il ragionamento** | il pensiero prima di rispondere | **chiuso**, con l'indicazione di quanto ha pensato. Si apre per capire una scelta |
| **un'operazione** | un comando, una modifica a un file, una ricerca | una riga sola: *cosa* ha fatto e *su cosa*, più l'esito. Il risultato resta **chiuso** |
| **il risultato di un comando** | ciò che il comando ha stampato | separato fra output normale, errori, ed esito |
| **un file modificato** | il file e quante righe sono cambiate | un blocco cliccabile che apre il confronto |
| **una richiesta di permesso** | vuole fare qualcosa e chiede | riquadro in basso, ferma **solo questa** conversazione |
| **una domanda** | vuole sapere come procedere | riquadro in basso, a scelta multipla |
| **la risposta data** | cosa si è deciso | **resta lì**, in evidenza, dove è successo |
| **un'azione bloccata** | il sistema di sicurezza l'ha fermata | **non è un errore**: significa «bloccato, ma puoi consentirlo tu» |
| **un avviso** | informazione, attenzione, errore | tre livelli distinguibili |
| **la memoria che si accorcia** | l'assistente ha dimenticato la parte più vecchia | una linea: «da qui in giù ricorda solo un riassunto di quello che c'è sopra» |
| **la fine del turno** | quanto è durato, quanto è costato | chiude il contenitore |
| **un contenuto da portare fuori** | una mail, un messaggio, un testo da usare altrove | copiabile, con i suoi campi separati |

### Dentro il testo dell'assistente

Il testo non è solo testo: contiene **riferimenti a cose che esistono davvero** sulla
macchina. Un percorso non è una parola, è un file. Un indirizzo web non è una parola, è un
posto dove andare.

Quindi STARK riconosce, **e solo quando ne è sicuro**:

- un **file** → si apre
- un **punto preciso in un file** («quel file, riga 42») → si apre lì
- un **indirizzo web** → si apre nel browser

Tutto il resto — nomi di funzioni, opzioni, valori — resta testo, con la possibilità di
**copiarlo**. Copiare è disponibile ovunque, sempre.

I **blocchi di codice** sono colorati secondo il linguaggio e si copiano con un gesto. Se è
chiaro a quale file appartengono, si può aprire quel file. E se un blocco **è** un confronto
fra prima e dopo, va mostrato come tale e non come testo colorato.

Una cosa che nessuna formattazione può fare da sola: quando l'assistente scrive *«ho
aggiornato quel file»*, **STARK sa se è vero**. Quella frase diventa un collegamento alla
modifica reale — e se quel file non è stato toccato affatto, STARK se ne accorge.

> **Nota sul contenuto da portare fuori.** Quando si chiede una mail, un messaggio di
> commit o una descrizione da incollare altrove, quel testo è un **prodotto finito**, non un
> commento. Va in un blocco a sé, copiabile — e con i campi separati quando ne ha, per
> esempio oggetto e corpo di una mail. Perché i campi si separino bene, l'assistente deve
> segnalare che si tratta di un prodotto e quali sono i campi: è una convenzione da
> insegnargli, ed è una cosa in più da decidere.

---

## 3. Quando l'assistente chiede qualcosa

Compare un **riquadro in basso**. Due casi:

- **un permesso**: vuole eseguire qualcosa e chiede il consenso. Mostra esattamente cosa
  farebbe e in quale cartella
- **una domanda**: vuole sapere come procedere, con due o quattro alternative fra cui
  scegliere, ognuna con una breve spiegazione. A volte si può scegliere più di una

Nel normale funzionamento questi riquadri **quasi non compaiono**: l'assistente decide da
sé quasi tutto, e si ferma solo per le cose serie. Chi vuole più controllo può chiedere di
essere interrogato su categorie precise, e allora compaiono più spesso.

**Ferma solo quella conversazione.** Le altre continuano a lavorare.

Dopo la risposta, il riquadro sparisce ma **la domanda e la risposta restano nella
conversazione**, nel punto in cui sono avvenute. Riaprendo il lavoro due giorni dopo si
capisce cosa si era deciso, e perché l'assistente ha fatto in quel modo.

---

## 4. Il confronto delle modifiche a un file

Si apre cliccando il blocco del file dentro la conversazione.

Mostra **prima a sinistra e dopo a destra**, con i numeri di riga, come si guarda una
proposta di modifica su GitHub. Le righe aggiunte e quelle tolte si distinguono a colpo
d'occhio.

Su schermo stretto l'affiancato non ci sta: lì serve la forma a colonna unica, con le
righe vecchie e nuove alternate.

---

## 5. Il riepilogo di ciò che è stato fatto

Ogni conversazione ha un elenco, **sempre consultabile**, di tutti i file toccati e di tutti
i comandi eseguiti. È separato dalla conversazione e non richiede di scorrerla.

**Perché esiste.** L'assistente scrive «ho aggiornato il file e i test passano». Quella è
una **affermazione**. Le operazioni che ha eseguito sono i **fatti**. Nel terminale stanno
mescolate e non resta che fidarsi delle parole. Qui i fatti hanno un posto loro, dove si va
a controllare.

Nella conversazione i fatti stanno **dove sono accaduti**; in questo elenco stanno **tutti
insieme**, per rivedere alla fine.

> **Un file può essere modificato più volte nello stesso turno**, e ogni modifica è un fatto
> a sé. Nella conversazione vanno mostrate separate, perché sono avvenute in momenti diversi
> e in mezzo l'assistente ha fatto altro. In questo elenco invece il file va nominato **una
> volta sola**, con quante volte è stato toccato: qui si guarda *cosa è cambiato*, non
> *quando*. Verificato su una modifica reale: due cambi allo stesso file arrivano come due
> confronti distinti, non come uno solo cumulativo.

---

## 6. Avviare un nuovo lavoro

Serve scegliere due cose sole: **l'agent** — cioè quale installazione, fra quelle trovate
sulla macchina — e **la cartella**. Solo la seconda è obbligatoria; la cartella decide anche
progetto, colore e branch.

Se la cartella appartiene a un progetto che STARK non ha mai visto, si sceglie anche il
**profilo di Claude** — vedi la sezione 7. Per un progetto già noto è deciso e si mostra
soltanto.

**Le opzioni non si scelgono qui.** Modello, modalità dei permessi e server MCP servono
*mentre* si lavora e si cambiano **a caldo**: vivono nella barra di stato sotto la casella di
scrittura, che già le mostrava e ora le rende premibili. Chiederle prima del primo messaggio
sarebbe farsi rispondere a domande non ancora poste.

### Gli strumenti esterni, chat per chat

Deciso implementando il 24 agosto 2026. Il chip **MCP** nella barra apre l'elenco dei server che
questa macchina ha, e ognuno si accende per **questa** conversazione. Il menu non si chiude a
ogni tocco: accenderne due è il caso normale.

- **Di partenza sono tutti spenti**, e non è prudenza: ereditarli tutti costa circa 5× di
  contesto per turno — su quota fissa è la voce più cara della barra — e apre una via d'uscita
  ai dati che nessuno ha chiesto. Ma spento di *default* non vuol dire irraggiungibile: prima
  STARK li rendeva impossibili da accendere, ed era il Principio 5 rotto in casa.
- **Spento vuol dire spento davvero.** STARK non si limita a non chiederli: li spegne per nome
  prima di ogni turno. Serve, e si è visto: i connettori di claude.ai compaiono qualche secondo
  *dopo* la nascita della chat, quindi spegnerli una volta sola all'avvio li lasciava accesi —
  71 tool entrati in un turno che doveva averne zero.
- **La scelta torna col risveglio.** Sta nel journal, quindi una chat che dorme si risveglia con
  i suoi strumenti invece che senza, e senza modo di collegare la cosa allo Sleep.
- **Un server che chiede un login resta in elenco**, con scritto il comando da dare nel
  terminale (`claude mcp login <nome>`). È una cosa che si fa fuori da STARK: dirlo è meglio che
  farlo sparire, e sparire lo farebbe sembrare rotto.

Non è una schermata a sé ma un **riquadro sopra l'app**, che resta visibile dietro: creare una
chat non è cambiare posto, è aggiungere una riga a un elenco che stai già guardando.

**Riprendere una conversazione nata nel terminale** è la seconda porta, e sta **nello stesso
riquadro, dietro una linguetta** — non in una tendina sul `+`. *(Deciso il 24 agosto 2026,
implementando.)* Le due strade fanno la stessa cosa, aggiungere una riga all'elenco, quindi
nessuna merita di stare un passo indietro dell'altra; e soprattutto una tendina si apre solo se
sai già che c'è qualcosa da scegliere. Chi non sa che STARK può riprendere una conversazione del
terminale non andrà a cercarla lì. Con le linguette la seconda porta **si vede**, e l'elenco di
ciò che c'è da importare è esso stesso la scoperta.

Mostra ciò che c'è già sulla macchina — primo prompt, cartella, branch, data, dimensione — e si
sceglie riconoscendola. Chi era in corso *in quel momento* porta l'avviso della presa in
carico: non si perde niente, ma i due processi smettono di vedersi (P16). Nota su com'è fatto
oggi: «in corso in quel momento» STARK lo **stima** dall'ora dell'ultima scrittura del
trascritto, perché il file non dice se un processo è ancora aperto. Sbagliare per eccesso di
avviso costa una frase in più da leggere; per difetto, non dire a qualcuno che sta per guidare
la stessa conversazione da due posti.

### Rinominare, addormentare, eliminare

Non esiste una schermata «modifica chat»: con cartella e agent bloccati per costruzione
sarebbe stata un contenitore con dentro un campo solo. Sono **azioni**, e stanno dove sta
l'oggetto — col tasto destro sulla riga nell'elenco. **Sleep ha in più un pulsante suo** in
alto nella chat aperta, perché è l'unica delle tre che si fa spesso e a chat aperta.

---

## 7. Le impostazioni

Riquadro quasi a tutto schermo sopra l'app, con sei sezioni. Ognuna risponde a una domanda
diversa, e sono queste:

| | |
|---|---|
| **Permissions** | la tabella qui sotto |
| **Projects** | ciò che appartiene al progetto e non all'app: il colore e il **profilo di Claude** |
| **Notifications** | come si viene chiamati quando si guarda altrove |
| **Appearance** | il tema |
| **Storage** | dove stanno i journal, quanto pesano, come si cancellano |
| **System** | indirizzo e token di STARK, la diagnostica dell'agent, i profili trovati |

### Il profilo di Claude è del progetto, non dell'app

Un **profilo** è una configurazione di Claude Code — in concreto una `CLAUDE_CONFIG_DIR` — e
si porta dietro il login, i server MCP, la memoria e le conversazioni che si possono
riprendere. Sulla stessa macchina ne convivono più d'uno: per esempio uno di lavoro e uno
personale.

**La scelta è per progetto.** Non è una comodità: la **quota si conta per profilo**, quindi
due progetti su profili diversi non si mangiano la settimana a vicenda. Una sola impostazione
globale renderebbe impossibile separarli.

Dove compare:

- in **Projects**, una riga per progetto con colore e profilo
- nella creazione di una chat, **solo se STARK non conosce ancora quella cartella** — per un
  progetto già visto il profilo è deciso, e si mostra senza chiederlo
- in **System**, in sola lettura: quali profili esistono sulla macchina, con quante
  conversazioni e quanti MCP ciascuno
- nel pannellino della quota, che dice **su quale profilo** sta contando

Puntare un progetto al profilo sbagliato è il modo più confondente in cui questa cosa può
rompersi: l'agent non trova nessuna conversazione da riprendere e forse nemmeno il login, con
l'aria di essere rotto senza motivo apparente.

> **Nota sui nomi.** «Ambiente» è già preso: indica *dove gira* l'agent — la macchina, cioè
> WSL, un container, un host SSH. Il profilo è *quale identità e configurazione* usa. Sono due
> assi diversi e chiamarli con la stessa parola li farebbe collidere proprio dove serve
> distinguerli.

### I permessi

Una lista di categorie riconoscibili — eseguire comandi, modificare file, leggere file,
accedere alla rete, sotto-agent, strumenti esterni — ognuna con un interruttore fra
**«fai pure»** e **«chiedimelo»**. Categorie, non nomi di tool: `Bash` e `mcp__*` sono
vocabolario di Claude Code, ed è esattamente ciò che il modello canonico esiste per non far
uscire dall'adapter.

La posizione di partenza è *fai pure* per tutto: è il comportamento che rende il lavoro
scorrevole, ed è quello che si vuole quasi sempre. Ogni interruttore spostato **aggiunge**
un riquadro di conferma dove lo si desidera.

**«Vietalo» non è una terza posizione dello stesso interruttore**, ed è un riquadro a parte.
Sono due meccanismi diversi: «chiedimelo» aggiunge un passaggio che si può concedere lì per
lì, «vietalo» blocca **prima** che il classificatore veda l'azione e non lo scavalca nessuno
— nemmeno una regola della singola chat. È anche il motivo per cui i confini duri possono
restare pochi e veri.

La tabella è **globale**, e una singola chat può discostarsene: in quel caso le impostazioni
lo dicono («2 chat non seguono queste regole») e ci si arriva da lì. L'eccezione si imposta
dalla barra sotto la casella di scrittura di quella chat, dove già vivono modalità, modello
e MCP.

Se una voce non è disponibile, **si mostra spenta con la spiegazione del perché**. Mai
nascosta, mai lasciata accesa e non funzionante.

### Le notifiche

Un interruttore per ciascun evento — *ti aspetta*, *ha finito*, *si è fermata da sola* — con
un suono scegliibile per ognuno, e la possibilità di **silenziare un intero progetto**, per
quando ha un lavoro lungo che non si vuole sentire mentre due corti sì. Resta valida la
regola della sezione 1: i primi due suoni devono essere diversi, perché «ho finito» e «ti sto
aspettando» sono situazioni opposte per chi ascolta.

### Cosa non c'è, e perché

Nessuna sezione «Accesso»: per l'MVP si ascolta solo su `localhost`, quindi non c'è niente da
configurare — c'è da *sapere*, e indirizzo e token stanno in *System*. Fuori anche il TTL
automatico dello Sleep (ADR-005 lo rimanda), la rotazione del journal (§16.7 non decisa),
l'anonimizzazione e la configurazione di un secondo agent (ADR-004). Ognuna aprirebbe una
decisione non ancora presa.

---

## 8. La versione da telefono

Non nella prima versione, ma il disegno non deve renderla impossibile.

Dal telefono non si lavora: si **sorveglia e si sblocca**. Serve vedere lo stato di tutti i
lavori, leggere per intero l'ultima risposta, rispondere a permessi e domande, e poter
scrivere una richiesta nuova.

**Lo schermo stretto non rimpicciolisce: cambia.** Deciso il 24 agosto 2026: si segue la
logica di WhatsApp e Telegram. **L'elenco *è* la schermata principale**, a tutto schermo;
toccando una chat si apre soltanto quella, a tutto schermo, con una freccia per tornare.
Una alla volta, non due colonne rimpicciolite.

Funziona perché è già l'impianto che c'è: l'elenco è la navigazione, e su schermo largo le
due cose stanno affiancate solo perché lo spazio lo permette. Stretto, si alternano. Il
confronto affiancato resta l'eccezione che non regge: lì serve la forma a colonna unica,
con righe vecchie e nuove alternate (vedi la sezione 4).

---

# Le regole che valgono ovunque

**Quasi tutto è chiuso di default.** Ragionamenti, risultati dei comandi, turni già visti. Si
apre ciò che serve. È l'unico modo di reggere quattrocento blocchi.

**Con un'eccezione: la risposta a parole si mostra sempre intera.** È l'unica cosa scritta
*per l'utente*; tutto il resto è materiale di lavorazione. Troncarla costringe a un clic per
leggere ciò che gli è stato risposto, e un turno già richiuso la nasconde comunque.

**Ogni cosa che accade è un oggetto**, con un tipo riconoscibile e uno stato aperto o
chiuso. Non righe di testo indistinguibili.

**L'interfaccia non mente mai.** Se qualcosa non è disponibile, si vede che non lo è **e si
capisce perché**. Non si nasconde e non si lascia acceso qualcosa che non funziona.

**Mai parlare di soldi.** Solo di quanto lavoro resta e di quando si torna disponibili.

**Una cosa bloccata per sicurezza non è un fallimento.** Va detto che è bloccata e che
l'utente può consentirla, non che è andata storta.

---

# Come valutare una proposta grafica

Due domande, in quest'ordine.

**«Con quattrocento blocchi dentro, questa cosa regge?»** Molte grafiche belle su tre
messaggi collassano su trecento. È il vero avversario.

**«Il ragionamento e i risultati dei comandi sono mostrati aperti?»** Se sì, la proposta sta
barando: sembrerà ariosa nel disegno e sarà un muro nell'uso reale. Sono loro la gran parte
del volume.
