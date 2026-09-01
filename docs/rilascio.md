# Come si rilascia una versione di STARK

Un push su `main` **non** arriva a nessuno. Ad arrivare sono le **release**, e una
release è un tag `vX.Y.Z` sul remoto più la stessa versione dentro `package.json`.

Questo documento dice come farne una, e perché le regole sono queste.

## Farne una

```sh
npm version minor -m "STARK %s"     # alza package.json, committa e crea il tag
git push origin main --follow-tags
```

`npm version` fa le due cose **in un colpo solo**, ed è il motivo per cui si usa quello
invece di alzare il numero a mano: alzare la versione senza il tag darebbe una release
che nessuno vede, e taggare senza alzare la versione darebbe una release che c'è ma che
STARK non riesce a distinguere da quella installata (vedi «Perché il confronto è su
`package.json`»).

`--follow-tags` perché `git push` da solo **non manda i tag**: senza, il commit arriva e
la release no — cioè il caso peggiore, in cui `main` è avanti e nessuno viene chiamato.

`minor` / `patch` / `major` come al solito. Il numero non deve essere consecutivo: conta
solo che sia più alto.

## Cosa succede a chi ce l'ha installato

1. Alla prima accensione del daemon dopo il rilascio, STARK chiede al remoto quali tag
   esistono (`git ls-remote --tags`, un giro di rete e zero oggetti scaricati).
2. Se la release più alta è più alta della `version` su disco, in cima alla UI compare
   una banda: **«STARK 1.4.0 is available»**, col bottone che aggiorna e il comando
   `stark update` accanto.
3. Il bottone fa esattamente `stark update`: si va sul tag, `npm install`, si ricompila
   la UI, si riscrive il lanciatore, e il daemon riparte.

Il controllo lo fa **il daemon**, all'accensione e poi ogni tre ore finché resta acceso
(`daemon/aggiornamenti.ts`) — non la pagina: quella rilegge il risultato una volta
all'apertura e di nuovo ogni volta che si riconnette dopo un'interruzione (persa la
connessione e tornata viva), che è il momento in cui un riavvio fatto da un altro
terminale diventa visibile senza dover ricaricare a mano.

## Le regole, e perché

### Perché i tag e non le Release di GitHub

Sono due cose ufficiali, non una ufficiale e una fatta in casa: le Release di GitHub
*usano* i tag sotto. I tag costano meno e reggono di più — `ls-remote` passa dalle
credenziali git che la macchina ha già (su un repo privato l'API di GitHub vorrebbe un
token in più da distribuire a ogni collega), e non legano STARK a GitHub. Le note di
rilascio restano possibili: si aggiungono **sopra** i tag senza toccare niente.

### Perché il confronto è su `package.json` e non sui commit

Perché è l'unico modo di dire «un push su `main` non chiama nessuno» senza casi
speciali. Fra una release e l'altra `main` ha commit in più ma la stessa `version`,
quindi il confronto dà «sei aggiornato» — che è la verità: non c'è nessuna *release* più
nuova.

Ne segue una regola da non rompere: **la versione si alza nel commit che porta il tag, e
mai prima.** `npm version` fa già così. Se un giorno si prendesse l'abitudine di alzarla
subito *dopo* una release, ogni copia installata comincerebbe a vedersi «avanti» e il
banner smetterebbe di comparire.

Ricaduta gradita: su una **copia di sviluppo** — `main`, versione uguale all'ultima
release, commit in più — il banner non compare. Chi lavora al progetto non viene
invitato a buttare via il proprio ramo.

### Le pre-release non vengono offerte

`v1.4.0-rc.1` è ignorato: una pre-release è una cosa che si va a cercare, e spingerla su
un collega dentro un banner vorrebbe dire dichiarare pronto qualcosa che non lo è. Per
provarla si passa da git a mano.

### I tag che non sono versioni vengono ignorati

In questo repo esiste `backup-prima-riscrittura`. Letto come `0.0.0` vincerebbe su un
elenco vuoto, cioè STARK offrirebbe di «aggiornare» a un backup.

### Non si sovrascrive il lavoro di nessuno

Se nella copia installata ci sono modifiche a file **tracciati**, l'aggiornamento si
rifiuta e lo dice. I file non tracciati non contano — restano dove sono.

Il controllo è nostro e non di git, e non è una cintura in più su una che c'era già:
misurato, `git checkout --detach` su un albero sporco **non rifiuta**, si porta dietro
la modifica in silenzio. La copia finirebbe su un tag di release *quasi* uguale a quello
pubblicato, e nessuno saprebbe più in cosa differisce.

## Dove sta cosa

| Cosa | Dove |
| --- | --- |
| Qual è l'ultima release, e se sono indietro (regola pura) | `src/core/release.ts` |
| Chiedere al remoto, spostare il repo | `src/daemon/aggiornamenti.ts` |
| `stark update` | `src/cli/stark.ts` |
| «Mettimi sull'ultima release», per l'installer | `src/cli/release.ts` |
| Le rotte `GET`/`POST /api/update` | `src/daemon/server.ts` |
| La banda in cima | `ui/src/App.svelte`, `.upd` in `ui/src/app.css` |

## La prima release

Oggi il repo **non ha nessun tag di versione**, e `package.json` dice `0.0.0`. Finché
resta così non compare nessun banner e `stark update` risponde «nessuna release
pubblicata» senza toccare niente — che è il comportamento voluto, non un guasto.

Il primo `npm version` accende tutto il resto.
