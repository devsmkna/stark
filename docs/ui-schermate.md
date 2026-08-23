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
  In cima nessun numero, solo un **pallino** che dice che c'è qualcosa da vedere.
- **Tutti i comandi stanno in basso**, attorno alla casella di scrittura. Sopra di essa un blocco
  con l'operazione in corso e, a destra, il **pulsante per fermare** — solo l'icona, un ottagono
  pieno dentro un cerchio, in rosso.
- **Quello stesso blocco è ciò che si espande** quando l'agent chiede un permesso o fa una domanda.
  Le richieste **non compaiono più in mezzo alla conversazione**: guardi sempre nello stesso posto.
  Nel flusso resta solo *cosa hai risposto*, dopo. Il pulsante per fermare **resta visibile anche
  quando il blocco è espanso**: una domanda arriva mentre l'agent lavora ancora, e se lo stop
  sparisse proprio lì si perderebbe il controllo nel momento in cui serve di più.
- **Sotto la casella una barra di stato**: a sinistra modalità, cartella e branch; a destra modello
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
- in che stato è: pronta, sta lavorando, **ti aspetta**, dorme, errore

Ogni conversazione ha un **colore** che la rende riconoscibile senza leggere, un **titolo**
che si genera da solo ma che si può cambiare, e la **cartella** a cui si riferisce.

### Il comportamento che conta

Quando una conversazione si ferma ad aspettare una risposta, **non deve essere cercata**.
Il suo gruppo sale in cima e diventa una coda da smaltire: si risponde e si passa alla
successiva. L'utente non fa la ronda; è STARK che gli serve chi lo vuole.

Questa non è una schermata diversa, è **la stessa lista letta in un altro modo**. Mentre si
lavora si pensa per progetto («che sta facendo quello del sito?»); tornando dopo venti
minuti si pensa per urgenza («chi mi vuole?»).

### Come si viene avvisati

Con una **notifica di sistema** e un **suono**. Non con un pallino nella lista: il pallino
funziona solo se si sta già guardando STARK, e il punto è poter guardare altrove.

Il suono deve distinguere **«ho finito»** da **«ti sto aspettando»**: per chi ascolta sono
due situazioni opposte.

---

## 2. Una conversazione aperta

Le conversazioni su cui si sta lavorando restano aperte in **linguette**, come le schede di
un browser: si passa dall'una all'altra senza perdere il punto in cui si era. Con tre o
quattro sono semplici linguette; quando diventano molte si raggruppano per progetto.

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
| **la risposta a parole** | il testo dell'assistente | formattato per davvero: titoli, elenchi, tabelle. Se è molto lungo **si richiude**, mostrando l'inizio |
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

Serve scegliere: **la cartella** su cui lavorare, quale **assistente** (per ora ce n'è uno),
quale **modello**, e quanto **controllo** si vuole sui permessi.

Il modello e il livello di controllo si possono cambiare anche **a lavoro già avviato**,
senza ricominciare.

Si può anche **riprendere una conversazione già esistente**, comprese quelle iniziate dal
terminale fuori da STARK.

---

## 7. Le impostazioni dei permessi

Una lista di categorie riconoscibili — eseguire comandi, modificare file, accedere alla
rete — ognuna con un interruttore fra **«fai pure»** e **«chiedimelo»**.

La posizione di partenza è *fai pure* per tutto: è il comportamento che rende il lavoro
scorrevole, ed è quello che si vuole quasi sempre. Ogni interruttore spostato **aggiunge**
un riquadro di conferma dove lo si desidera.

Se una voce non è disponibile, **si mostra spenta con la spiegazione del perché**. Mai
nascosta, mai lasciata accesa e non funzionante.

---

## 8. La versione da telefono

Non nella prima versione, ma il disegno non deve renderla impossibile.

Dal telefono non si lavora: si **sorveglia e si sblocca**. Serve vedere lo stato di tutti i
lavori, leggere per intero l'ultima risposta, rispondere a permessi e domande, e poter
scrivere una richiesta nuova.

**Lo schermo stretto non rimpicciolisce: cambia.** Le linguette e il confronto affiancato
non funzionano stretti — lì servono soluzioni diverse, non le stesse più piccole.

---

# Le regole che valgono ovunque

**Quasi tutto è chiuso di default.** Ragionamenti, risultati dei comandi, turni già visti,
testi lunghi. Si apre ciò che serve. È l'unico modo di reggere quattrocento blocchi.

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
