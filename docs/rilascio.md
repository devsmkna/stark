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

## Cosa succede quando si tagga

1. Il tag fa partire `.github/workflows/publish-release.yml`: una build per ogni
   piattaforma supportata (`npm ci` + `npm run ui:build`, una volta sola, in CI — non
   su ogni macchina che installa), pubblicata su `starkapp.dev` insieme a un
   `version.txt` col tag appena uscito. Il come e il perché: `docs/distribuzione.md`.

## Cosa succede a chi ce l'ha installato

1. Alla prima accensione del daemon dopo il rilascio, STARK chiede a `starkapp.dev`
   qual è l'ultima versione pubblicata (un `fetch` di poche righe di testo, non più
   `git ls-remote`: dal 5 settembre 2026 la copia installata non è più un checkout git,
   vedi `docs/distribuzione.md`).
2. Se la release più alta è più alta della `version` su disco, in cima alla UI compare
   una banda: **«STARK 1.4.0 is available»**, col bottone che aggiorna e il comando
   `stark update` accanto.
3. Il bottone fa esattamente `stark update`: scarica il bundle già pronto per questa
   piattaforma, lo estrae sopra la cartella installata, riscrive il lanciatore, e il
   daemon riparte. Niente `npm install` né `npm run ui:build` qui: quel lavoro l'ha
   già fatto la CI al passo precedente.

Il controllo lo fa **il daemon**, all'accensione e poi ogni tre ore finché resta acceso
(`daemon/aggiornamenti.ts`) — non la pagina: quella rilegge il risultato una volta
all'apertura e di nuovo ogni volta che si riconnette dopo un'interruzione (persa la
connessione e tornata viva), che è il momento in cui un riavvio fatto da un altro
terminale diventa visibile senza dover ricaricare a mano.

## Le regole, e perché

### Perché un tag resta la release, anche senza più `git ls-remote`

Sono due cose ufficiali, non una ufficiale e una fatta in casa: le Release di GitHub
*usano* i tag sotto. Restano il modo in cui si dichiara «questa è pronta» anche ora che
non è più `git` a portare la notizia a chi ha installato: un tag `vX.Y.Z` è ciò che fa
partire la pipeline di pubblicazione (`docs/distribuzione.md`), e il file che quella
pipeline scrive (`version.txt`) contiene esattamente quel tag. Non legano STARK a
GitHub — chi domani sposta il repo altrove non deve riscrivere questa regola, solo la
pipeline che la applica. Le note di rilascio restano possibili: si aggiungono **sopra**
i tag senza toccare niente.

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

### La copia installata non è più un checkout git

Fino al 5 settembre 2026 un aggiornamento si rifiutava se c'erano modifiche a file
**tracciati** nella copia installata: `git checkout --detach` su un albero sporco non
rifiuta da solo, si porta dietro la modifica in silenzio, e quel controllo esisteva per
non lasciarlo fare senza dirlo.

Da quando l'installer scarica un bundle già pronto invece di clonare (vedi
`docs/distribuzione.md`), non c'è più un albero git da sporcare, quindi non c'è più
niente da controllare: un aggiornamento estrae il bundle nuovo sopra quello vecchio, e
un file toccato a mano dentro la cartella installata si perde — esattamente come si
sarebbe perso ieri fra due `npm install` che toccavano lo stesso file, solo senza più un
`git status` a dirlo prima di procedere. La cartella installata (`~/.local/share/stark/app`
o l'equivalente Windows) non è pensata per essere modificata a mano: chi sviluppa STARK
lavora su un checkout separato, con `git` vero, come sempre.

## Dove sta cosa

| Cosa | Dove |
| --- | --- |
| Qual è l'ultima release, e se sono indietro (regola pura) | `src/core/release.ts` |
| Chiedere a `starkapp.dev`, scaricare il bundle | `src/daemon/aggiornamenti.ts` |
| `stark update` | `src/cli/stark.ts` |
| Le rotte `GET`/`POST /api/update` | `src/daemon/server.ts` |
| La banda in cima | `ui/src/App.svelte`, `.upd` in `ui/src/app.css` |
| La pipeline che compila e pubblica i bundle | `.github/workflows/publish-release.yml` |
| Chi serve i bundle e gli installer | `docs/distribuzione.md` |
