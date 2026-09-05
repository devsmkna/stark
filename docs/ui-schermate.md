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
  (Dal 28 agosto 2026 il raggruppamento si sceglie — vedi «Due modi di guardare l'elenco».)
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
  contesto, sessione corrente e settimana, e quando si azzerano le ultime due — **nei due
  formati**: fra quanto, e a che ora esattamente.
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
dormienti.

### Due modi di guardare l'elenco

Sopra la lista c'è **«Group by: Project | Status»**, e sono due domande diverse:

- **by status** (il default, ed è com'è sempre stato) — `Waiting`, `Working`, `Sleeping`, e
  dentro ogni stato per progetto, **sempre**, anche quando il progetto è uno solo. Risponde a
  *a cosa devo rispondere adesso*, che è la domanda che si fa aprendo STARK
- **by project** — i progetti in **ordine alfabetico**, e dentro ognuno le chat con davanti
  quelle che aspettano te. Risponde a *cosa sta succedendo su questo lavoro*, e serve quando
  le conversazioni aperte sono tante e su cartelle diverse

Dentro un progetto le chat restano ordinate **per stato prima che per tempo**: fuori dal
raggruppamento per stato nessun altro lo fa più, e senza, una che dorme capiterebbe sopra una
che ti sta aspettando. L'elenco degli stati è **lo stesso** che dà l'ordine alle sezioni
nell'altro modo: la convinzione «prima chi aspetta te» sta in un posto solo.

Il comando sta **sull'elenco** e non nelle impostazioni, perché la scelta si fa guardando il
risultato — cercarla dietro un pannello vorrebbe dire farla al buio. Sparisce mentre si cerca,
dove l'albero non c'è: un comando che non muove niente di ciò che vedi è peggio di un comando
assente. E la scelta vive **nel browser**, come il tema e la dimensione del testo: «su questo
schermo voglio vederle per progetto» è del dispositivo, non del progetto.

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

### Cercare (27 agosto 2026)

Sopra l'elenco c'è una casella. Cercare non è un posto dove andare, è **un modo di guardare
l'elenco**: per questo i risultati prendono il posto dell'albero invece di aprirsi in un
pannello a parte.

Due ricerche in una casella sola, tenute separate anche a schermo, perché rispondono a due
domande diverse:

- **Titles** — le conversazioni il cui titolo contiene quello che hai scritto. Il filtro lo fa
  il browser: i titoli sono già tutti lì, e aspettare il daemon per nascondere righe che ho già
  in mano sarebbe un ritardo inventato.
- **Inside conversations** — le conversazioni che *ne parlano dentro*. Le cerca il daemon, che è
  l'unico ad avere i journal. Sotto il titolo di ciascuna, fino a cinque righe: chi ha scritto
  quel testo (`you asked`, `answered`, `did`) e il ritaglio con la parola evidenziata. Accanto
  al titolo, **quante volte in tutto** — con cinque righe mostrate e quaranta trovate, tacere
  sul resto direbbe che sono cinque.

Premere un risultato non apre la conversazione e basta: la apre **su quel turno**, che si apre
da sé, si porta in vista e lampeggia una volta. Se il turno stava sopra un `/clear`, si apre
anche il capitolo che lo conteneva — portare in vista qualcosa che non è disegnato non porta in
vista niente. Premere invece il *titolo* apre la conversazione senza scegliere un punto, che è
quello che si vuole quando le corrispondenze sono tante e nessuna in particolare è quella
giusta.

Il lampo dura e sparisce: dice «è questo» a chi è appena arrivato, e da lì in poi sarebbe un
colore senza significato su una riga come le altre.

### Quanto è larga (5 settembre 2026)

La barra si allarga **trascinandone il bordo destro**: la maniglia compare sfiorandola, il
doppio clic riporta al valore di partenza (212px), e da tastiera le frecce la muovono di
sedici pixel alla volta. Fra 170 e 460px — sotto i 170 il nome di una chat non ci sta più e
l'elenco diventa una colonna di ellissi, e per «via dai piedi» c'è già il collasso (mod+b),
che si riapre da un bottone visibile invece che da una striscia da riafferrare.

La larghezza è una preferenza **del dispositivo**, come il collasso e la disposizione dei
pannelli: sta nel `localStorage`, non in `settings.json`. Lo stesso account su un portatile
da 13" e su un monitor da 27" non vuole lo stesso numero.

Sotto la soglia stretta (§8) non c'è nessuna maniglia: là la barra, quando c'è, è tutta la
schermata. Per questo la larghezza passa da una variabile CSS e non da uno `style="width:…"`
— uno stile in linea batterebbe la media query, e la barra resterebbe larga quanto l'ha
lasciata il mouse su uno schermo dove quel numero non vuol dire niente.

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

### L'indirizzo dice dove sei

Deciso implementando il 24 agosto 2026. La chat aperta sta nell'indirizzo — `/chat/<id>`, e
`/chat/<id>/effects` quando guardi gli effetti — quindi un **ricaricamento non perde il posto**,
e riaprire il browser sulla scheda di ieri riapre quella conversazione. In un'app che si tiene
aperta per giorni è la differenza fra riprendere e ricominciare.

Gli **effetti sono un posto**, non un interruttore: il tasto «indietro» del browser riporta alla
conversazione, esattamente come la freccia dentro l'app. Un indirizzo che punta a una
conversazione che non c'è più lo dice e riporta all'elenco, invece di girare a vuoto.

### La struttura: il turno è un contenitore

Ogni cosa che l'utente chiede apre un **turno**, e tutto ciò che l'assistente fa in risposta
sta **dentro** quel turno. La richiesta non è un messaggio come gli altri: è
**l'intestazione** di ciò che segue.

Il turno intero si può **richiudere**. La conversazione diventa così una lista delle cose
che si sono chieste — tredici titoli invece di quattrocento blocchi — e si tiene aperto solo
quello a cui si sta lavorando.

### Dentro il turno: il lavoro sta in un blocco solo (27 agosto 2026)

Aperto un turno, fra la richiesta e la risposta c'è **una riga sola**: `259 operations ·
51 notes`, chiusa, che si apre sull'elenco esatto di prima. Ci finisce tutto ciò che è il
*come* — i comandi, le modifiche, i ragionamenti — e con loro le **narrazioni di servizio**,
cioè le righe con cui l'agent racconta quello che sta per fare («ora guardo il CSS»).

Ne restano fuori tre cose, e sono le tre volte in cui l'agent smette di raccontare e si
rivolge a te: la **risposta finale**; una **domanda o un permesso** con la risposta data; e
il **testo che introduce quella domanda**, perché è quello che ti serve per scegliere.
Insieme a loro restano fuori la compattazione e i retry, che non sono lavoro ma tagli del
flusso. Resta fuori anche l'**operazione in corso**, l'unica di cui ha senso chiedersi a che
punto è.

Perché non basta raggruppare le operazioni (com'era fino a ieri): l'agent scrive una nota
ogni tre o quattro comandi, e un testo in mezzo spezzava il gruppo. Su un turno vero da 418
parti restavano **103 blocchi** in colonna; adesso ne fa **2**, e il turno intero sta in una
schermata. La media su 48 turni veri passa da **29,6 blocchi a 2,5**.

Il taglio si decide per **posizione**, non per lunghezza: sui journal veri una narrazione ha
mediana **131 caratteri** (710 casi, solo 2 sopra gli 800), il testo che introduce una
domanda **2631**, il recap finale **2487**. Sono due specie, e la posizione le separa senza
soglie da tarare.

Arrivando da una **ricerca** il turno si apre con i gruppi **aperti**: chi cerca ha chiesto di
vedere, e portare in vista un turno in cui la frase trovata è dentro una riga chiusa sarebbe
come non portare in vista niente.

La regola sta in `ui/src/lib/gruppi.ts`, fuori dal componente, e si prova con `node` puro:
`npm run gruppi:check`, 24 verifiche.

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
| **il lavoro accorpato** | tutte le operazioni e le narrazioni di un tratto di turno | una riga che le conta (`46 operations · 3 notes`), chiusa, che si apre sull'elenco di prima |
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

Compare un **riquadro in basso**. Tre casi:

- **un permesso**: vuole eseguire qualcosa e chiede il consenso. Mostra esattamente cosa
  farebbe e in quale cartella
- **una domanda**: vuole sapere come procedere, con due o quattro alternative fra cui
  scegliere — righe con un segno di scelta, ognuna con la sua spiegazione sotto. A volte se
  ne può scegliere più di una, e allora il segno è quadrato invece che tondo
- **un piano** (27 agosto 2026): ha finito di pianificare e chiede di partire

### Il piano è l'unico dei tre che si legge

Un permesso lo si riconosce a colpo d'occhio — è una riga, un comando, un percorso. Una domanda
è un titolo e delle opzioni. Un piano è **un documento**, e va letto per intero prima di
approvarlo: per questo il suo riquadro ha un corpo che scorre, con il markdown reso, invece di
un sommario. Ha un tetto d'altezza legato allo schermo e non a un numero di pixel, perché la
cosa da non superare è lo schermo — e sotto ci sono i bottoni con cui si approva, che non devono
mai finire fuori.

Prima che esistesse questo riquadro il piano finiva nella card generica dei permessi, che di
quel testo **non mostrava niente**: si approvava un piano che non si poteva leggere.

Le vie d'uscita sono tre, e le prime due sono due bottoni distinti invece di uno con una spunta
accanto: **«Go ahead, accept edits»** e **«Go ahead, ask me first»**. Nel terminale sono due
voci, ed è la stessa decisione presa in due modi — chi approva la sta già prendendo, farla
scegliere dopo da un menu la nasconderebbe. La terza è **«Keep planning»**, con accanto una riga
per dire cosa cambiare: facoltativa, perché obbligare a motivare un «no» renderebbe più scomodo
dire di no che dire di sì.

Sotto il piano c'è il **file** in cui il CLI se l'è scritto per conto suo: si può aprire dove si
aprono gli altri file. Dirlo permette di arrivarci; leggerlo da lì per mostrarlo qui vorrebbe
dire preferire il disco a ciò che il protocollo ha già mandato.

Approvato, il piano **resta nel flusso** e si riapre: è il documento su cui l'agent ha lavorato
da lì in poi, e nel journal non è scritto da nessun'altra parte. Chiuso di default come tutto il
resto — lo si rilegge solo quando ci si chiede *perché* ha fatto in quel modo.

Nel normale funzionamento questi riquadri **quasi non compaiono**: l'assistente decide da
sé quasi tutto, e si ferma solo per le cose serie. Chi vuole più controllo può chiedere di
essere interrogato su categorie precise, e allora compaiono più spesso.

**Ferma solo quella conversazione.** Le altre continuano a lavorare.

### Più domande insieme: uno stepper, non un modulo

Una richiesta può portare **fino a quattro domande**, e sono domande diverse. Il riquadro
ne mostra **una per passo**, con i passi **nella riga del titolo**: quante sono in tutto, a
quale si è, e quali hanno già una risposta.

Stavano su una riga loro fino al 28 agosto 2026, e con l'etichetta di stato («asking»)
facevano **tre righe di cornice** prima della domanda vera — su telefono, misurato, un terzo
del riquadro. Ora sono una riga sola: titolo a sinistra, passi al centro, Stop a destra.
Se n'è andato con loro anche il contatore «3 answers total»: diceva un numero che adesso si
**conta guardando** (tre pastiglie sono tre domande), e in fondo il bottone dice comunque
«Send 3 answers». E se n'è andata l'etichetta di stato, perché la stessa parola sta già sulla
riga dell'elenco a sinistra: chi è arrivato a leggere la domanda sa che gli si sta chiedendo
qualcosa. I passi si **premono**: rivedere la prima dopo aver letto la
terza è esattamente ciò che si vuole fare, e con quattro domande *quale mi manca* è la
domanda che ci si fa davvero — a cui un avanzamento lineare non saprebbe rispondere.

A scelta singola, premere un'opzione porta al passo dopo. A scelta multipla no: non si può
sapere quando si ha finito di spuntare. **«Send answer» c'è sempre**, anche su una domanda
sola. Fino al 27 agosto 2026 non c'era: lì la scelta *era* la conferma, e premere un'opzione
inviava di colpo. Con le opzioni disegnate come pillole era coerente — si premeva un bottone, e
un bottone fa succedere qualcosa. Con le opzioni a pallini no: un pallino dice «questa è
selezionata», non «è partita», e chi lo preme si aspetta ancora un momento per rileggere.

### Le opzioni sono righe, non pillole

Ridisegnato il 28 agosto 2026 su un riferimento portato dall'utente. Ogni opzione è una
**riga piena con un segno di scelta a sinistra**: tondo quando se ne prende una, quadrato
quando se ne possono prendere quante si vuole. Prima erano pillole larghe quanto il loro
testo, che andavano a capo in fila — una barra di comandi, non una scelta — e `multiSelect`
non si vedeva da nessuna parte: lo si scopriva premendo due opzioni e vedendole restare
accese entrambe.

In una riga piena ci sta anche la **descrizione** che l'assistente scrive per ogni opzione.
Prima era in un tooltip: cioè la sola cosa che dice *cosa costa* una scelta si raggiungeva
solo fermandoci sopra il mouse, e da telefono per niente.

Le righe stanno in **una scheda sola con dei filetti**, non in otto riquadri staccati
(28 agosto 2026). Non è una preferenza: otto bordi più sette spazi da 6px sono **quindici
linee orizzontali** per una lista di otto voci, e il riquadro cresceva di una cinquantina di
pixel senza dire niente di più. Con i filetti restano sette linee, tutte più leggere, e da
telefono la differenza è fra vedere quattro opzioni e vederne sei. L'opzione scelta si segna
col fondo e una **barretta a sinistra** invece che con un bordo attorno: dentro una scheda un
bordo colorato dovrebbe combattere coi filetti dei vicini, e sulla prima e sull'ultima riga
cadrebbe sopra il bordo della scheda stessa.

### Domande e risposte sono Markdown (28 agosto 2026)

Il testo della domanda, l'**etichetta** di ogni opzione e la sua **descrizione** passano da
`renderMarkdown` come il resto della conversazione. Prima erano testo semplice, e la
conseguenza si vedeva: una domanda che citava tre file li mostrava **coi backtick attorno**, e
nessuno dei tre era raggiungibile. Ora un percorso citato dentro una domanda si copia e si apre
come ovunque (vedi «Un percorso citato nel testo si copia e si apre»), compresi i percorsi
citati in un'etichetta o in una descrizione.

Le etichette usano una resa **in linea** (`renderInline`) e non quella per blocchi: dentro una
riga il cui layout è già deciso, un `<p>` porterebbe i suoi margini. Il testo della domanda
invece passa da quella per blocchi, perché lì l'agent può portarsi dietro un elenco — è il
posto dove spiega, non un'etichetta.

Quando l'assistente **consiglia** un'opzione, quella porta un badge blu **«Recommended»**
in fondo a destra della riga dell'etichetta. Stava **appoggiato sul bordo** in alto fino al
28 agosto, e la ragione scritta allora era buona — «si vede scorrendo con l'occhio senza
entrare nel testo» — ma dentro una scheda con i filetti quel bordo non c'è più, e su schermo
stretto il badge finiva **sopra** l'etichetta (misurato a 430px). Un'etichetta coperta è un
difetto più grosso di un badge meno sporgente, e all'estremo destro della riga l'occhio lo
trova comunque scorrendo la colonna. Non è un campo del protocollo: il CLI dice al modello
di scriverlo in fondo all'etichetta, quindi STARK lo riconosce lì, lo toglie dal testo — il
badge lo dice meglio — e lo rimanda indietro **intero**, perché la risposta è indicizzata per
etichetta esatta.

Il riquadro resta **giallo**, che è l'identità del blocco «tocca a te», e ambra restano il
titolo e l'icona. Il blu è riservato a ciò che si tocca: l'opzione scelta, il badge, «Send
answer». Due colori con due mestieri, invece di uno solo che li fa entrambi.

### Due strade in più, su ogni domanda, sempre

Oltre alle opzioni proposte ci sono sempre due voci, che non propone l'assistente — le mette
STARK:

- **Chat about this** — «non ho abbastanza per scegliere: parliamone»
- **Type in your answer** — una **casella sempre aperta**, in fondo alla lista, tratteggiata
  finché non ci si scrive dentro

La casella non è dietro un bottone da premere, e non è una scelta di disposizione: il
contratto del tool la promette al modello — «*AskUserQuestion always includes a Skip button
and a free-text input box for custom answers, so do not include `None` or `Other` as
options*» — quindi l'assistente **omette apposta** l'opzione «nessuna di queste», contando su
di lei. Tenerla dietro un bottone la rendeva una via da scoprire proprio mentre l'agent dava
per scontato che fosse aperta.

Non prende il fuoco da sola quando la domanda arriva: sarebbe un campo di testo che ruba la
tastiera a chi stava scrivendo altrove. Scriverci dentro spegne l'opzione scelta prima, e
svuotarla torna a «non ho ancora risposto» — sono tre strade, non tre campi da riempire
insieme.

Che le opzioni coprano tutto lo ha deciso l'assistente. Chi risponde deve poter dire sia
*nessuna di queste* sia *non ho abbastanza per scegliere*.

«Parliamone» vale per **una domanda sola, non per la richiesta**: le altre risposte partono
lo stesso, e solo quella marcata torna indietro come richiesta di approfondimento, che
l'assistente ripone dopo. Non è un annulla — ed è scritto nel riquadro **prima** di premere
Send, perché scoprirlo dopo sarebbe una sorpresa a spese di chi risponde.

### Cosa resta nella conversazione

Dopo la risposta il riquadro sparisce, ma **la domanda e la risposta restano nella
conversazione**, nel punto in cui sono avvenute. Riaprendo il lavoro due giorni dopo si
capisce cosa si era deciso, e perché l'assistente ha fatto in quel modo.

Quando le domande erano più d'una resta un **blocco**, non una riga: ogni domanda con la
propria risposta sotto, numerate, nell'ordine in cui sono state poste. Una riga sola con le
risposte separate da `·` faceva perdere l'unica cosa che serve rileggendo — **quale
risposta stava a quale domanda**.

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

### La cartella, e il ramo su cui si sta (28 agosto 2026)

Nella barra c'è il **nome** della cartella, non il percorso: quello è lungo, uguale nei primi
due terzi fra un progetto e l'altro, e la parte che distingue è l'ultima — cioè proprio quella
che l'ellissi mangiava quando lo spazio stringeva. Il percorso intero resta a un passo, nel
titolo al passaggio del mouse. È la stessa parola che l'elenco a sinistra usa per il progetto,
e sono la stessa cosa: due modi di scriverla costringerebbero a tradurre fra le due colonne per
capire che è la stessa chat.

Accanto, il **ramo git**, quando la cartella è dentro un repo. Non compare mai «no branch»: dove
git non c'è non c'è un fatto da riportare. Con la testa staccata si mostra la sigla del commit,
che è l'unica risposta vera a «dove sono».

Il ramo **non è nel journal e non ha un evento canonico**: è un fatto del filesystem, non
dell'agent. Chi fa `git checkout` in un terminale accanto non manda niente a STARK, quindi la
risposta si chiede (`GET /api/git`) invece di ricordarla — e ricordarla sarebbe peggio, perché
il journal è per sempre e il ramo cambia da solo.

Si chiede quando cambia la cartella e **una volta per turno**. Un turno di confini ne muove
due, all'inizio e alla fine, e chiederlo su entrambi vorrebbe dire sapere due volte la stessa
cosa: se il ramo è cambiato, a cambiarlo è stato il turno, quindi conta la risposta dopo.
L'eccezione è una chat aperta *mentre* lavora, che altrimenti resterebbe senza ramo fino a fine
turno. Verificato dal vivo cambiando ramo dal terminale senza dire niente a STARK: al confine
del turno la barra passa da `principale` a `sviluppo`, e da lì a `a6d8c33` con la testa
staccata.

### Scrivere mentre l'agent lavora

Corretto il **26 agosto 2026**. La casella non si blocca quando l'agent sta lavorando — nel CLI
non si blocca, quindi qui nemmeno (Principio 5). Quello che cambia è dove finisce quel messaggio:
**apre un turno suo e si mette in fila**, e parte quando il precedente ha finito. In ordine, uno
alla volta.

- **nella conversazione si vede aspettare**: il blocco c'è già, bordato d'ambra, con scritto
  «queued — waiting its turn». Il prompt è un fatto appena l'hai mandato, non appena l'agent lo
  guarda — quindi si mostra subito.
- **prima finiva dentro il turno in corso**, e la risposta al primo prompt compariva nel blocco
  del secondo: due domande diventavano un pastone illeggibile. Il perché di quell'errore e come
  è stato smontato stanno nel modello di eventi (§7): vale la pena leggerlo, perché la premessa
  sbagliata sembrava un limite della piattaforma.
- **Stop ferma tutto, fila compresa.** Chi preme il quadrato rosso vuole che la macchina si
  fermi; se il prossimo partisse mezzo secondo dopo, tre prompt in coda vorrebbero quattro Stop.
  I turni che non gireranno restano nella conversazione, chiusi come interrotti — spariti
  sarebbero peggio: hai scritto qualcosa, e dov'è finito deve vedersi.
- **la fila si svuota anche una voce alla volta (1º settembre 2026).** Nell'intestazione di un
  turno in coda c'è una ×: la toglie dalla fila **sola lei**, e il resto prosegue. È la
  controparte puntuale dello Stop — che però toglie tutte. Il turno tolto resta nella
  conversazione chiuso come interrotto, per la stessa ragione di qui sopra; il comando è
  `session.dequeue` (modello di eventi §11) e il metodo vive nell'adapter, dove sta la fila.
  Un turno già consegnato non ha la ×: non si richiama.
- **fra un turno e il successivo la chat non si dichiara ferma.** Sembra un dettaglio: è lo
  stato su cui suona la notifica «ha finito», e suonerebbe a metà lavoro.

### Un lavoro che continua dopo la riga che lo ha lanciato (27 agosto 2026)

Un comando lanciato in **background**, o un **sub-agent**, non finisce quando finisce la
chiamata: quella risponde subito «lancio riuscito». Fino a oggi la riga mostrava quindi un ✓
verde su un lavoro ancora in corso, e l'esito vero — che arriva molto dopo, spesso in un altro
turno — non compariva da nessuna parte.

Adesso la riga dice cosa sta succedendo davvero: **`running`** (o `agent running`) finché il
lavoro gira, poi **`failed`** se è andata male. E quando il CLI manda il suo resoconto, quello
compare **sotto la riga chiusa**, non dentro il dettaglio da aprire: è la risposta alla domanda
per cui si stava guardando quella riga — «com'è andata?» — e nasconderla dietro un clic
significherebbe nasconderla proprio a chi era tornato apposta per leggerla. Su un sub-agent è
anche **l'unica** cosa che ne resta: il suo lavoro interno non passa da questo canale.

Il resoconto è prosa e sta su più righe, ma con un tetto di quattro: venti righe dentro una riga
di elenco non sono più una riga di elenco.

Quanto pesa, su journal veri di questa macchina: **316** lavori in una sola conversazione, di
cui 15 in background, 5 sub-agent e **10 falliti**. Quei dieci fallimenti prima erano invisibili.

### Perché un comando è stato lanciato, non solo quale

Fatto il **26 agosto 2026** (F2, Notion). La riga di un tool mostrava il soggetto nudo —
`grep -rn "summary" src/adapters/` — e chi guardava doveva dedurre da solo cosa l'agent stesse
cercando. Ora, quando l'agent ha scritto perché, è quella la riga: **«Search for summarize
definition»** invece del comando. È il principio fondante applicato al posto più frequente del
flusso — un terminale mostra il comando perché non ha altro da mostrare, una GUI può mostrare
l'intenzione.

- **il comando non sparisce**: resta nel tooltip al passaggio del mouse, e per intero — con la
  motivazione accanto — aprendo la riga, come sempre. Non è mai a più di un tocco.
- **non è STARK a inventarla.** È testo che l'agent scrive già da sé in un campo `description`
  del tool, e prima veniva buttato via. Generarla con un modello sarebbe costata quota su ogni
  comando di ogni turno — la risorsa scarsa — quindi non si fa: se l'agent non l'ha scritta, la
  riga torna quella di sempre.
- **dipende dal modello.** Verificato dal vivo, non dedotto dallo schema: con Opus arriva quasi
  sempre, con Sonnet su un comando breve spesso manca. Nessun problema quando manca — è il caso
  già gestito — ma è la ragione per cui questa riga non compare identica su ogni sessione.
- **vale anche nella riga «cosa sta facendo adesso»**, sotto la casella e nell'elenco: è lì che
  conta di più, mentre l'agent lavora e il comando scorre via.

### Arrivare a un file citato, non solo leggerne il percorso

Fatto il **26 agosto 2026** (F3, Notion). Un piccolo bottone «cartella aperta» compare accanto
alla riga di un tool che nomina un file (`Read`, `Edit`, `Write`, …) e accanto al blocco di un
file modificato: apre il gestore di file della macchina sulla cartella giusta, **col file
selezionato**. È la versione minima che la specifica sancisce come sufficiente — non serve che
STARK sappia qual è l'editor preferito, basta arrivarci.

- **non sostituisce il clic esistente.** Il blocco di un file modificato si apre ancora sul
  confronto affiancato, come sempre: il bottone nuovo è un secondo bottone, attaccato di fianco,
  non un rimpiazzo — un bottone dentro un bottone non è nemmeno HTML valido.
- ~~**solo dove STARK sa già che è un percorso.**~~ — **rovesciata il 28 agosto 2026**, su
  richiesta dell'utente: «quando citi i file usa un blocco inline che abbia il tasto copia path
  e apri accanto, così che possa consumare subito quell'informazione». Vale ora anche nel **testo
  libero** delle risposte. Vedi il capitolo qui sotto: la ragione per cui era stata esclusa resta
  giusta, ed è il modo di aggirarla che è cambiato.

### Un percorso citato nel testo si copia e si apre (28 agosto 2026)

Un `code` in linea che è davvero un file porta due bottoni dentro di sé — **copia il percorso**
e **rivela nel gestore di file** — e una sottolineatura punteggiata che lo dice anche col mouse
altrove. Vale nelle **risposte dell'agent** e nel **riquadro del piano**; nei prompt vale solo
per le citazioni con `@`, che sono dichiarate e non indovinate.

**La ragione per cui era stato escluso era giusta, e non è stata ignorata.** Una regola
tipografica non può decidere: non distingue `and/or` da una cartella, e sbaglia anche
all'incontrario — `core/reduce.ts` *sembra* un percorso e non esiste (il file è
`src/core/reduce.ts`). Un bottone «apri» che non apre niente è peggio di nessun bottone, perché
insegna a non fidarsi nemmeno degli altri.

**La cura non è una regola più furba: è non indovinare.** La regola serve solo a fare una rosa
(niente spazi, niente `--opzione`, o una barra o un'estensione plausibile); a decidere è il
**disco**, che il daemon guarda relativamente al `cwd` della chat — `POST /api/sessions/:id/paths`,
una domanda sola per messaggio, e le risposte si tengono. Un percorso o c'è o non c'è: smette di
essere un giudizio e diventa un fatto. È la stessa mossa di `file_suggestions`, dove a cercare
i file è il CLI e STARK mostra. Funziona anche su una chat che **dorme**: non serve un processo
dietro, serve solo sapere da dove partire, e quello lo dice il journal.

- **la decorazione è asincrona di proposito.** Il testo compare subito com'è sempre comparso,
  i bottoni arrivano dopo: legare il rendering alla richiesta vorrebbe dire che un daemon lento
  ritarda la **lettura** della risposta.
- **i bottoni stanno dentro il `code`, non accanto.** Accanto, una riga potrebbe andare a capo
  fra il percorso e i suoi bottoni, lasciando due icone orfane a inizio riga.
- **nel prompt le citazioni stanno nella finestra «Your prompt», non nella riga del turno.**
  Quella riga *è* un bottone (apre il turno), e un bottone dentro un bottone non è HTML valido —
  è scritto tre righe sopra di essa nel sorgente, e ci si è cascati lo stesso alla prima
  stesura. È anche il posto giusto: la riga serve a **riconoscere** un turno, la finestra a
  **rileggerlo**, e agire appartiene alla seconda.
- **i due bottoni si vedono sempre**, non al passaggio del mouse (richiesta dell'utente).
  Prima comparivano in hover, e c'è stata per mezz'ora una sottolineatura punteggiata a dire
  «questo porta a un file» in loro assenza. Con i bottoni sempre presenti quel segno era
  diventato il doppio della stessa cosa — lo stesso difetto del pallino ripetuto su ogni riga
  dell'elenco — ed è stato tolto. Un comando che si scopre solo passandoci sopra è un comando
  che chi non lo sa già non trova; e su un telefono, dove il passaggio del mouse non esiste,
  non lo trova nessuno. Costo accettato e detto: in un paragrafo con cinque percorsi ci sono
  dieci icone.
- **si tiene decorato, non si decora una volta.** Difetto segnalato dall'utente: richiudendo
  e riaprendo un turno i percorsi tornavano nudi. La causa non era la decorazione ma **quando**
  la si chiamava — un effetto che dipendeva da «quanti turni» e «quante parti», due numeri che
  richiudere un turno non cambia, mentre il `{@html}` rifà il DOM da zero. Misurato:
  all'apertura 5 candidati e 6 bottoni, alla riapertura 5 candidati e **0** bottoni.
  Aggiungere lo stato aperto/chiuso alle dipendenze avrebbe chiuso *quel* caso e lasciato
  aperti quelli non ancora incontrati (un salto da una ricerca, un pannello che cambia chat):
  il difetto vero era che le dipendenze erano **indovinate**. Ora si osserva il DOM
  (`MutationObserver`), che è la cosa che deve essere vera, invece dell'elenco dei motivi per
  cui potrebbe essere cambiata.
- **la prova guarda anche i negativi**, ed è metà del suo valore: `npm run percorsi:check`
  verifica che `core/reduce.ts`, `addAppLinks`, `and/or`, `--permission-mode` e `npm run check`
  restino testo, non solo che i tre percorsi veri si accendano. La funzione fallisce in silenzio
  in **entrambi** i versi, e il verso «non scatta» è indistinguibile dal non averla scritta.

Cosa resta fuori, e detto invece che scoperto: il **testo della domanda** (`.qtext`) è stampato
come testo semplice, non come Markdown, quindi lì un percorso fra backtick resta backtick.
Renderlo Markdown si può, ma cambierebbe l'aspetto di ogni domanda — è una decisione a parte,
non una ricaduta di questa.

- **il resto vale come prima:** `file_path`, `path`, `notebook_path` — gli stessi
  campi che il riassunto del tool riconosce già (`summary.ts`) — continuano ad avere il loro
  bottone sulla riga del tool e sul blocco del file modificato.
- **su WSL2 apre Explorer di Windows**, col percorso tradotto da `wslpath` — funziona sia per un
  repo su `/mnt/…` sia per uno nativo, verificato su entrambe le forme. Su macOS apre Finder. Su
  Linux nativo usa Nautilus se c'è, altrimenti apre la cartella (senza garanzia di selezione: non
  esiste un comando universale per «seleziona» su ogni gestore file Linux) — quest'ultimo ramo
  non è verificato dal vivo, le due macchine reali sono entrambe WSL2.
- **non allarga il perimetro** — il daemon esegue già comandi come root — ma sta dietro le stesse
  quattro difese di ogni altra rotta (`POST /api/reveal`, token, `Origin`, `Host`, loopback):
  provato, non dato per scontato solo perché passa dallo stesso `route()`.

### Aprire un link con la sua app, non solo nel browser

Fatto il **26 agosto 2026** (F1, Notion). Un link riconosciuto — oggi solo verso Notion — porta
accanto un piccolo bottone **«Open in Notion»**. Il link resta quello che era, clic normale,
scheda nuova: il bottone è la seconda via, non un rimpiazzo — decisione dell'utente, non dedotta,
perché la prima proposta (riscrivere il link stesso) rischiava di sorprendere chi si aspettava il
browser.

- **l'app non c'è? Lo dice, non fallisce in silenzio.** Windows non avvisa chi lancia un
  protocollo non registrato — fallisce muto, o mostra un dialogo di sistema che STARK non vede.
  Per questo si controlla nel registro **prima** di tentare (`HKCR\<schema>` su WSL,
  `xdg-mime query` su Linux), non dopo: verificato dal vivo, non dedotto dallo schema di un URL.
- **verificato per davvero**, non solo per esito HTTP: il link cliccato nella UI vera ha aperto la
  pagina Notion giusta — provato due volte, con conferma diretta di cosa si è visto sullo schermo,
  perché è l'unica cosa che STARK non può controllare da sé.
- **su WSL2 (le due macchine reali) passa da Windows**, non da un browser Linux che non c'è:
  `cmd.exe /c start` con l'URL tradotto nello schema dell'app, dalla cartella di sistema di
  Windows — lanciarlo dalla cartella del daemon (un percorso WSL) fallisce, verificato dal vivo.
- **il perimetro non si fida del client.** La rotta (`POST /api/open-app`) ricontrolla da sé che
  il dominio dell'URL appartenga davvero al servizio dichiarato: un client che chiedesse di aprire
  un sito qualunque spacciandolo per Notion non deve poterlo fare.
- **un servizio alla volta.** Solo Notion per ora — è l'unico verificato — non un elenco di domini
  indovinati. Aggiungerne un altro è un'aggiunta a `core/services.ts`, non un redesign.

### Due rifiniture del 26 agosto, in serata

**Il blocco del prompt è blu-azzurro** (`--user`/`--user-bg`, distinto sia da `--accent`, indaco,
sia da `--work`, il blu di stato): scorrendo una conversazione lunga, ogni turno inizia con una
riga colorata che salta all'occhio senza doverla leggere — è dove hai chiesto qualcosa, e da lì
riparte quello che segue. Vale sia chiuso sia aperto: anche il turno che si sta leggendo deve
restare riconoscibile come tale. Lo stesso colore copre il blocco «You answered» — la risposta a
una o più domande dell'agent: è ancora l'utente a parlare, e la ragione per riconoscerlo scorrendo
è identica.

> **Corretto il 26 agosto in serata, su segnalazione dell'utente**: il colore è del **blocco**,
> non del testo. Il prompt vero e proprio è tornato al colore normale (`--ink`), perché ciano su
> fondo azzurro ha poco contrasto e più il prompt è lungo più si fatica a leggerlo — e quel testo
> è la cosa che si legge, non un'etichetta. Nello stesso giro l'**ora** è passata a grigio e peso
> normale, come il conteggio dei blocchi in fondo alla stessa riga: è un riferimento, non un
> titolo, e in blu grassetto competeva col prompt per l'attenzione. A firmare il blocco resta lo
> **sfondo**, che da solo basta a far saltare all'occhio dove ricomincia un turno.

**La riga di un tool con una motivazione (F2) mostra prima quella, il comando dopo e più
piccolo.** Prima il comando esatto stava solo in un tooltip — bisognava sapere che c'era per
andarlo a cercare. Ora, quando l'agent ha scritto perché, la riga diventa due: sopra il nome del
tool e la motivazione, sotto — piccolo, monospace, mai il soggetto della riga — il comando o il
percorso esatto. Senza motivazione la riga resta esattamente com'era, una sola linea: la
struttura a due righe esiste solo per chi ne ha bisogno.

### Quanto ne resta

Fatto il **26 agosto 2026**. Il pannellino sotto la percentuale di contesto dice **tre cose, e
sono tre domande diverse**: quanto contesto ha in mano *questa* chat, quanto hai consumato della
finestra da **5 ore**, quanto della **settimana**. Sotto la settimana, rientrate, le finestre che
il piano tiene separate per modello, quando ce ne sono.

- **contesto e quota non stanno sulla stessa scala.** Il contesto è della conversazione e si
  legge dai token; la quota è del **piano**, e la consumano anche le altre chat e l'altra
  macchina. Sommarli qui darebbe un numero che non esiste da nessuna parte: il livello si chiede
  al piano, e si dice **quando** è stato letto.
- **il reset è scritto due volte**: «fra 6d 12h» e «Sep 01 23:00». Non è ridondanza — la prima
  dice se conviene aspettare, la seconda se conviene rimandare a domani mattina, e su un'attesa
  di giorni la prima da sola non basta per decidere.
- **niente barra a zero quando non si sa.** Una finestra che il piano non riporta lo dice a
  parole: uno zero disegnato si leggerebbe come «non hai consumato niente», che è l'opposto.
- **quello che c'era prima è uscito.** «This chat, total» ripeteva in un altro modo il numero già
  scritto sopra, e la riga degli eventi era diagnostica. Il pannellino si apre di sfuggita,
  mentre si sta scrivendo: tre voci si leggono, sei si guardano soltanto.

### Il contesto diceva 100%, e non era vero

Bug segnalato dall'utente il 26 agosto 2026, corretto lo stesso giorno. La percentuale di
contesto era **calcolata**, non chiesta: STARK sommava i token dell'ultimo turno e li divideva
per una finestra che indovinava dal nome del modello. Su Opus con contesto esteso quel nome
arriva con le parentesi (`claude-opus-5[1m]`), il confronto non lo riconosceva, e la finestra
usata era 200K invece del milione vero — un contesto reale al 21% si vedeva 100%. Non era la
cache, come si sospettava all'inizio: era il numero sotto la frazione, non quello sopra.

La correzione è smettere di indovinare: STARK ora fa la stessa domanda a cui risponde `/context`
nel terminale (`getContextUsage()`, un metodo stabile dell'SDK, non sperimentale), e riporta la
percentuale che arriva — non la ricalcola. La barra sotto la percentuale mostra le categorie
**vere** di Claude Code — prompt di sistema, tool, MCP, memoria, riserva di auto-compattazione —
non più input/output/cache, che raccontano una fattura API e non uno spazio occupato. Si rilegge
negli stessi tre momenti della quota: avvio, fine turno, apertura del pannellino.

### Quando il contesto si riassume

Deciso implementando il 24 agosto 2026. Una conversazione lunga prima o poi **compatta**: il
modello non ha più i messaggi per intero ma un riassunto, e succede da solo quando il contesto
si riempie o quando lo si chiede con `/compact`.

Nel flusso compare **una riga che taglia**, con quanto c'era, quanto è rimasto e *perché* è
successo. È la spiegazione di metà delle volte in cui l'agent sembra aver dimenticato qualcosa:
non dirlo lascia quel «sembra» addosso all'utente, che al posto di una spiegazione si fa
un'idea sbagliata dello strumento.

### Quando il contesto si azzera

Deciso e implementato il 26 agosto 2026, su richiesta dell'utente. `/clear` non riassume: da lì
in giù il modello non ha più **niente** di quello che c'era sopra. Prima non si vedeva affatto —
il turno del comando restava vuoto e la conversazione continuava a scorrere identica, come se
contasse ancora tutta.

Ora tutto ciò che precede un `/clear`, **il turno del comando compreso**, si raccoglie in un
**capitolo chiuso**: una riga sola che taglia il flusso, «Context cleared · 3 turns before ·
16:18».

- **Chiuso di default**, perché è esattamente quello che è successo al contesto. Ma si **riapre
  cliccandoci**: azzerato non vuol dire cancellato, il journal ce l'ha ancora, ed è spesso lì che
  si va a rileggere cosa si stava facendo.
- Riaperto, il capitolo resta **riconoscibile come passato**: rientrato, con una riga di lato e
  più spento. Senza, quei turni tornerebbero identici a quelli veri e sarebbe di nuovo impossibile
  vedere a occhio dove il contesto smette di valere — cioè il motivo per cui esiste.
- Il turno del `/clear` non si conta fra i turni riposti: è il taglio, non uno degli scambi.
- La stessa grammatica della compattazione (due stanghette e il fatto in mezzo), ma **più
  marcata**: lì resta un riassunto, qui non resta niente.

Aperto: dopo un `/clear` il **titolo** della chat resta quello del primo prompt, che ora sta
dentro il capitolo chiuso. Non è stato cambiato perché nessuno l'ha chiesto, ma è la cosa che
stona di più nella schermata.

### Fargli vedere una cosa

Deciso implementando il 24 agosto 2026. Il prompt non è più solo testo: si **incolla** uno
screenshot o si **trascina** un'immagine sul blocco in basso — su tutto il blocco, non su un
rettangolo di ventiquattro pixel: chi arriva con un'immagine in mano punta *in basso*. Gli
allegati restano in attesa sopra la casella finché non si manda.

- **quali tipi, lo dice il modello** (28 agosto 2026, chiesto dall'utente). Non è una lista di
  STARK: ogni modello dichiara cosa accetta, e la casella filtra con quella. Su Claude Code sono
  le quattro immagini più PDF, TXT, Markdown e CSV; su OpenCode dipende dal modello — 61 dei 151
  di questa macchina leggono immagini, 4 anche i PDF. Un file di un altro tipo lo **dice**,
  invece di sparire nel nulla, e dice anche cosa avrebbe preso.
- **un modello che non legge allegati spegne la graffetta**, con la ragione nel tooltip: spenta e
  spiegata, mai nascosta. Cambiando modello a caldo il bottone si riaccende da sé, perché la
  domanda è del modello e non della chat.
- **un file di testo si allega**, e la regola di prima («si nomina per percorso, l'agent sa
  leggerlo») resta vera solo per i file **del progetto**, che infatti si citano con `@`. Dal
  telefono, un percorso da nominare non c'è.
- **nella conversazione l'allegato resta**, sopra la risposta, com'era davanti al modello:
  l'immagine come immagine, tutto il resto come una scheda col nome e il peso, che si apre.
  Riaprendo il lavoro due giorni dopo si capisce di cosa si stava parlando.

### I comandi slash

Deciso implementando il 24 agosto 2026. La sessione ne offre **quarantotto**, e da STARK non
se ne poteva scrivere nemmeno uno. Ora la casella li propone appena si scrive `/`, filtrando
mentre si digita: ↑↓ per scegliere, Tab o Invio per completare, Esc per chiudere.

- **il suggerimento degli argomenti conta quanto il nome**: `/code-review` da solo è un
  indovinello, e che accetti `[low|medium|high]` lo sa la sessione. Stessa cosa per gli
  **alias** — `/reset` e `/new` portano a `/clear`, e chi cerca la parola che ha in mente
  la trova.
- **una riga per riga**: la descrizione di una skill è un paragrafo intero, e lasciata libera
  fa una riga alta mezzo schermo. Qui serve riconoscere il comando, non leggerne il manuale.
- **completare chiude il menu**, e riscrivere lo riapre. Senza, un comando che non prende
  argomenti resta a filtrare se stesso e il secondo Invio ricompleta invece di mandare.
- **quelli legati al terminale restano in elenco** con l'etichetta. Il CLI li ha; e se li si
  manda lo stesso, a dire che lì non funzionano è l'agent, non noi.

### Citare un file con `@`

Deciso implementando il 26 agosto 2026, chiesto dall'utente. Si preme `@` e compare lo stesso
menu dei comandi slash, con i file del progetto; scrivendo si filtra; ↑↓ per scegliere, Tab o
Invio per citare, Esc per chiudere. Nella casella resta `@percorso/del/file.ts`.

- **la ricerca non è nostra**: è `file_suggestions` del canale di controllo, cioè *la stessa*
  che il terminale mostra. Rifarla in casa avrebbe voluto dire decidere da soli cosa ignorare
  (`.git`, `node_modules`, il `.gitignore`, i binari) e divergere dal CLI al primo
  aggiornamento. Il filtro quindi **non lo fa il browser**: si manda quello che si è digitato e
  si mostra ciò che torna.
- **`@` non è decorazione, è un'istruzione**: il CLI espande la citazione da sé e mette il file
  nel contesto — verificato, e non dedotto dal fatto che il terminale lo faccia (una parola
  nascosta in un file citato è tornata nella risposta **senza** che l'agent aprisse un tool per
  leggerlo). Citare tre file costa quindi tre letture in meno.
- **una cartella non chiude la citazione**: la si sceglie, si scende dentro e il menu resta
  aperto — niente spazio dopo. Un file invece è la risposta, e lo spazio serve a continuare la
  frase. Le cartelle si riconoscono dall'icona e dalla barra finale; una cartella **vuota** non
  compare, ed è il CLI a decidere così.
- **si cita in mezzo a una frase**, non solo in cima come per `/`: quello che conta è il pezzo
  subito prima del cursore, e dopo aver scelto il cursore torna dov'era invece di saltare in
  fondo. Una `@` attaccata a una parola — un indirizzo email — non apre niente.
- **i primi ~1,5 secondi di una chat nuova il menu è vuoto**, perché il CLI sta ancora
  costruendo il suo indice. Non è aggirabile scaldandolo prima (provato e misurato: nessun
  guadagno). Si ritenta una volta, e la lettera successiva lo riempie.

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

Riquadro quasi a tutto schermo sopra l'app, con sette sezioni. Ognuna risponde a una domanda
diversa, e sono queste:

| | |
|---|---|
| **Permissions** | la tabella qui sotto |
| **Agent** | come lavora, non di cosa ci si fida: oggi una voce sola, le **descrizioni dei comandi** |
| **Projects** | ciò che appartiene al progetto e non all'app: il colore e il **profilo di Claude** |
| **Notifications** | come si viene chiamati quando si guarda altrove |
| **Appearance** | il tema |
| **Storage** | dove stanno i journal, quanto pesano, come si cancellano |
| **System** | indirizzo e token di STARK, la diagnostica dell'agent, i profili trovati |

### Quota esaurita, e azioni fermate dal classificatore

Deciso implementando il 27 agosto 2026, per chiudere la Fase 1. Sono le due sole schermate in
cui STARK, prima, **taceva su un fatto**: entrambe hanno a che fare con qualcosa che si ferma
senza che nessuno lo abbia chiesto.

**La quota finita è dell'elenco, non della chat.** Una banda sopra l'elenco quando almeno una
conversazione è ferma per limite raggiunto: quante sono, e fino a quando.

- **sta lì e non dentro una chat** perché la quota è del *piano*: quando finisce si fermano
  tutte insieme, e scoprirlo entrando in una per volta non è una risposta. È l'unico guasto di
  STARK che non appartiene a nessuna riga in particolare.
- **solo l'ora esatta, niente conto alla rovescia.** Fra le due formulazioni è l'orario a
  decidere («rimando a domani?»), e la durata avrebbe richiesto un orologio al secondo —
  esattamente quello che è stato tolto dall'elenco il 26 agosto perché era calcolo per niente.
- **si spegne da sola.** Le chat fermate dalla quota non ricevono più eventi, quindi senza
  niente che rilegga l'orologio la banda resterebbe per ore dopo il reset. C'è **una sveglia
  sola**, all'istante del reset, non un intervallo.
- **si riparte dal limite più lontano**, non dal più vicino: uscire dalla finestra da 5 ore
  mentre la settimanale è ancora chiusa vuol dire ricascarci un istante dopo, e dire l'ora più
  vicina sarebbe una promessa che non si mantiene.
- **solo «limite raggiunto», mai «ci sei quasi»**: quell'avviso ha già il suo posto nel
  pannellino della barra di stato, insieme a quanto ne resta. Un allarme che compare anche
  quando si può ancora lavorare diventa arredamento.

**Un'azione fermata dal classificatore non è un fallimento.** La riga lo diceva già —
`Blocked · stopped for safety`, con la sua icona, invece di un errore rosso — ma finiva lì, e
non c'era niente da premere: un blocco **non è** una richiesta di permesso, quindi non sale
nessuna card dal basso. Adesso, aprendo la riga, si legge cosa si può fare.

- **le tre vie d'uscita sono quelle del CLI, non nostre.** Sono le stesse che Claude Code scrive
  al modello quando blocca: prova un'altra strada; leggere file e cercare **non** passano dal
  classificatore e funzionano comunque; torna a questa cosa più tardi. Le ripetiamo all'utente
  perché il modello le legge e lui no.
- **non c'è un «consenti questa e riprova»**, ed è una scelta. Il CLI non lo offre, e ignora
  apposta le voci di `permissions.allow` che aggirerebbero il classificatore (verificato nel
  binario). Metterlo qui sarebbe STARK che fa **di più** del CLI proprio su una difesa: il
  Principio 5 dice che non dobbiamo poter *meno*, non che dobbiamo scavalcare.
- **la via vera è cambiare modalità**, e il bottone la offre lì: passare la chat a «ask me»
  toglie la decisione al classificatore e la dà a te. Dice anche che vale **da adesso in poi**,
  quindi quella cosa va richiesta di nuovo — scoprirlo dopo sarebbe una sorpresa.
- **la spiegazione c'è sempre, il bottone no.** Cambiare modalità è un comando a un processo:
  su una chat che dorme non c'è nessuno a riceverlo. Il *perché* quell'azione non è avvenuta
  resta invece la domanda che ci si fa rileggendo un lavoro mesi dopo.

### Le descrizioni dei comandi

Deciso implementando il 27 agosto 2026, chiesto dall'utente. **Accesa di default.** Con la voce
accesa la riga di un tool dice *perché* è stato lanciato — «Find where the default model is
decided» invece di `grep -rn "claude-sonnet" src/` — perché l'agent scrive una `description` che
prima non scriveva sempre.

- **la voce non cambia niente dentro STARK**: scrive una regola nel `CLAUDE.md` **globale
  dell'agent**, cioè in `<CLAUDE_CONFIG_DIR>/CLAUDE.md`. Non c'è un'opzione dell'SDK da
  accendere — quel campo lo scrive il modello, e l'unico modo di chiederglielo è dirglielo dove
  lo rilegge sempre. Conseguenza che va detta e sta scritta nel pannello: la regola vale
  **anche fuori da STARK**, nel terminale.
- **il file è dell'utente, quindi si tocca solo il proprio pezzo**: il blocco sta fra due
  commenti Markdown, e spegnere la voce toglie *esattamente* quello. Se il file resta vuoto
  perché conteneva solo quello, sparisce; se conteneva altro, l'altro resta identico.
- **il percorso è scritto nel pannello**, perché è l'unica cosa che dal browser non si può
  dedurre — e se quel file non è scrivibile lo si dice, invece di lasciare una spunta accesa
  sopra un file che non è cambiato.
- **si riallinea anche all'avvio del daemon**, non solo quando si tocca l'interruttore: fra
  un'accensione e l'altra quel file può essere stato cambiato a mano. Senza quel giro la spunta
  direbbe una cosa e il file un'altra.
- **perché serve una regola scritta e non l'abitudine**: misurato su una sessione vera, la
  percentuale di comandi con motivazione è passata da ~100% a **0 su 27** subito dopo un
  `/clear`. L'abitudine viveva negli esempi in contesto; il file di memoria no.

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
- nel pannellino della quota, che dovrà dire **su quale profilo** sta contando — disegnato,
  **non ancora fatto**: oggi quel pannellino dice le tre voci (contesto, 5 ore, settimana) e
  tace su quale profilo le sta contando, che è un'informazione che manca proprio quando i
  profili sono due

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

### Cosa di questa schermata è vero oggi

Costruita il 24 agosto 2026. **Vero e funzionante:** le sei categorie dei permessi, salvate
sulla macchina e applicate alle chat nuove; il colore per progetto; le tre notifiche con il
silenzio per la chat aperta e per progetto; il tema; Storage e System per intero.

**Non ancora, e la voce lo dice invece di sparire:** i pattern fini della shell e il riquadro
*Never* — STARK non ha regole di divieto, e un confine duro che non blocca sarebbe la peggiore
delle bugie; il **profilo per progetto**, perché il daemon apre una sola `CLAUDE_CONFIG_DIR`
per volta; la scelta dei suoni, che sono tre e sono quelli.

Una cosa che vale la pena ricordare quando si toccherà: **la tabella vale per le chat nuove**.
I controlli di una conversazione si installano quando l'agent parte, e cambiarli a metà
vorrebbe dire rinegoziare l'handshake di qualcosa che sta lavorando. La schermata lo scrive.

### Dove vive un'impostazione

Non è un dettaglio tecnico, è una decisione di prodotto:

- **sulla macchina** (`~/.stark/settings.json`) ciò che cambia cosa fa l'agent — i permessi — e
  ciò che descrive un progetto: il suo colore, se è silenziato. Deve valere da qualunque
  browser apra STARK.
- **nel browser** ciò che è del dispositivo: il tema e i suoni. «Voglio sentire i suoni su
  questo portatile» non è un fatto del progetto, e portarselo sul fisso sarebbe sbagliato.

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
