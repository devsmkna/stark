# Come si distribuisce STARK: bundle precompilati su starkapp.dev

Fino al 5 settembre 2026 `install.sh`/`install.ps1` clonavano `github.com/devsmkna/stark`
e compilavano in locale (`npm install`, poi `npm run ui:build`) — e `stark update` faceva
lo stesso con `git fetch`/`checkout --detach`. Da quel giorno il repo GitHub è **privato**
(sviluppo, issue, storia completa) e chi installa non lo tocca più: scarica un **bundle
già pronto** — codice, `node_modules` e interfaccia già compilata — da `starkapp.dev`,
un server che STARK possiede e controlla per intero.

Perché non uno specchio git pubblico del repo privato (la prima idea, scartata): un
utente che scarica un bundle già pronto salta interamente `npm install` e
`npm run ui:build` in locale — minuti, non secondi, dice il commento che c'era in
`install.sh` — e il repo privato non ha bisogno di nessun'altra credenziale per restare
leggibile da fuori: a leggerlo resta solo la CI, con le sue.

## Cosa fa scattare cosa

Un tag `vX.Y.Z` resta **la release** (`docs/rilascio.md` spiega perché un tag e non un
numero scritto a mano). Cambia solo cosa succede quando esce:

1. `.github/workflows/publish-release.yml` parte sul push del tag. Una build per ogni
   piattaforma supportata (matrix), ciascuna: `npm ci --omit=dev` (non `install`: la
   cartella è appena clonata, non c'è nessun lockfile locale da rispettare più del
   solito) + `npm run ui:build`, impacchettati in `stark-<piattaforma>.tar.gz` — `src/`,
   `node_modules/`, `ui/dist/`, `package.json`, `package-lock.json`. Un formato solo,
   `tar.gz`, anche su Windows: dalla 1803 in poi Windows include `tar` (bsdtar), quindi
   non serve un secondo formato solo per lì.
2. Un job finale scarica tutti i bundle e li manda su `starkapp.dev` via `rsync`, sia
   sotto `releases/<tag>/` (un bundle preciso, per chi lo vuole) sia sotto
   `releases/latest/` — la cartella che `install.sh`/`install.ps1`/`stark update`
   leggono davvero, perché nessuno dei tre sa né deve sapere qual è il tag più recente
   prima di chiederlo. Nella stessa cartella finisce `version.txt`, una riga col tag:
   è quello che confronta `daemon/aggiornamenti.ts` (`core/release.ts` fa il confronto
   vero e proprio, invariato da prima — la regola non è cambiata, è cambiato solo come
   ci si arriva).
3. `install.sh`/`install.ps1` cambiano molto più raramente delle release, e non seguono
   i tag: `.github/workflows/publish-installer.yml` li pubblica a ogni push su `main`
   che li tocca, fuori da `releases/`, alla radice di `starkapp.dev` — la stessa
   distinzione fra «segue ogni push» e «segue solo una release» che il progetto fa
   altrove (`docs/rilascio.md`).

## Le piattaforme

| target | runner GitHub-hosted |
|---|---|
| linux-x64 | `ubuntu-24.04` |
| linux-arm64 | `ubuntu-24.04-arm` |
| darwin-x64 | `macos-13` |
| darwin-arm64 | `macos-14` |
| win-x64 | `windows-2022` |
| win-arm64 | **non pubblicata**: nessun runner GitHub-hosted nativo per quella combinazione. `install.ps1` lo dice invece di scaricare un bundle che non esiste. Se serve davvero, la strada da provare è forzare `npm install --cpu=arm64 --os=win32` da un runner x64 — npm risolve gli `optionalDependencies` sui flag passati, non sull'host reale, ma non è stato ancora verificato dal vivo. |

WSL non è una piattaforma a parte: `uname -s` dentro WSL2 risponde `Linux` come su
qualunque altra distribuzione, quindi prende il bundle `linux-x64`/`linux-arm64` senza
bisogno di un caso in più — né in `install.sh` (non lo distingueva già), né nel bundle
stesso (nessuna dipendenza compilata contro l'ABI di Node: l'unico pezzo per-piattaforma
è l'eseguibile di Claude Code, che l'SDK sceglie da sé via `optionalDependencies`, e non
è un modulo nativo caricato con `require()` — la piattaforma su cui gira `npm ci` non
deve combaciare con quella su cui gira poi il bundle).

## Il server (45.77.53.112 → starkapp.dev)

Un webserver e basta — non un server git, non più: `nginx` + `certbot` (Let's Encrypt).

Un utente di sistema a bassi privilegi, `deploy`, la cui chiave SSH è ristretta con
**`rrsync`** — lo script "rsync ristretto" incluso ufficialmente nel pacchetto `rsync`
(`/usr/share/doc/rsync/scripts/rrsync` su Debian/Ubuntu), non uno strumento nostro:

```
# /home/deploy/.ssh/authorized_keys
command="rrsync -wo /var/www/starkapp.dev/" ssh-ed25519 AAAA... github-actions-deploy
```

La radice è `/var/www/starkapp.dev/` intera — non solo `releases/`: sotto ci stanno sia
`releases/` (i bundle) sia `install.sh`/`install.ps1` alla radice, e la stessa chiave
pubblica un po' l'una un po' l'altri a seconda del workflow. Il costo accettato, e vale
la pena dirlo esplicitamente: chi avesse quella chiave privata potrebbe riscrivere
l'installer o un bundle di release — cioè trojanizzare ogni installazione futura. È
per questo che la chiave vive **solo** come secret di GitHub Actions (`STARK_DEPLOY_SSH_KEY`),
mai su una macchina di sviluppo, e `STARK_DEPLOY_HOST_KEY` (l'host key del VPS,
verificata **a mano** confrontando l'impronta con quella del pannello del provider, non
un `ssh-keyscan` alla cieca in CI) protegge dal lato opposto — che il push non finisca
altrove per un DNS o un routing compromesso.

nginx serve `/install.sh`, `/install.ps1` e `/releases/...` come file statici — niente
CGI, niente backend, niente stato lato server oltre al filesystem. TLS via `certbot
--nginx -d starkapp.dev`, rinnovo automatico (il pacchetto Debian/Ubuntu installa già il
timer systemd: `systemctl list-timers | grep certbot` per verificarlo).

`ufw`: 22 (SSH — verificata **prima** di attivare il firewall, per non restare tagliati
fuori), 80, 443. Nient'altro in ascolto verso l'esterno.

## DNS

Un record `A` per `starkapp.dev` → `45.77.53.112`, su Cloudflare **DNS only** (nuvola
grigia, non proxata) — la stessa scelta e la stessa ragione di `docs/fuori-casa.md`: un
proxy che bufferizza o che si mette in mezzo al TLS non aggiunge niente qui e toglie
semplicità nell'emettere il certificato con la sfida HTTP-01.

## Cosa non è cambiato

- `core/release.ts` (qual è l'ultima release, `daAggiornare`) — le stesse funzioni pure
  di sempre, provate in `npm run check`.
- Il fatto che una release sia un tag, e le regole su quali tag contano
  (`docs/rilascio.md`): pre-release ignorate, tag non-versione ignorati, il confronto è
  su `package.json` e non sui commit.
- `stark up`/`stark stop`/`stark status`, il lanciatore, il fatto che STARK non parta da
  solo al boot: tutto quello che non riguarda *come arriva il codice* è rimasto com'era.

## Cosa è cambiato, esplicitamente

- La copia installata **non è più un checkout git**: niente più protezione contro
  modifiche locali tracciate, perché non c'è più un albero tracciato. Un aggiornamento
  estrae il bundle nuovo sopra quello vecchio, punto — vedi `docs/rilascio.md` per il
  dettaglio.
- `src/cli/release.ts` è sparito: esisteva solo per portare un clone appena fatto
  sull'ultima release prima di `npm install`. Non c'è più né il clone né l'`npm
  install` locale da far precedere.
- Non è più possibile puntare l'installer a un branch di sviluppo
  (`STARK_BRANCH`/`STARK_REPO` sono spariti): i bundle esistono solo per i tag
  pubblicati. Chi sviluppa STARK lavora su un checkout git vero, come sempre — non
  passa da `install.sh`.

## Verificare, invece di sperare

```sh
curl -fsSL https://starkapp.dev/install.sh | sh          # installazione pulita
curl -o v.txt https://starkapp.dev/releases/latest/version.txt && cat v.txt
```

Push anonimo rifiutato (conferma che `rrsync -wo` non lascia scrivere da fuori la CI):

```sh
echo test | ssh deploy@starkapp.dev   # deve rifiutare una shell interattiva
```

Dopo un tag di prova, la pagina delle Actions del repo mostra la matrix a schermo:
cinque piattaforme verdi (win-arm64 assente per costruzione, non per errore).
