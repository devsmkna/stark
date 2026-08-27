# Finder di sistema per "New chat"

Data: 27 agosto 2026.

## Problema

`NewChat.svelte` ha già un browser di cartelle manuale (`Open path…`), che elenca le
sottocartelle una alla volta interrogando `GET /api/browse` (`registry.browse`, già
esistente). Funziona ma è scomodo per chi è abituato al Finder/Explorer del proprio
sistema. Va aggiunta una seconda via, **accanto** alla prima (non al suo posto): un
bottone che apre il selettore di cartelle nativo della macchina.

## Vincolo strutturale

STARK è client-server: la UI gira nel browser, il daemon (che apre le sessioni) gira
sulla macchina con lo schermo. Il dialogo nativo **deve** aprirsi lì, non nel browser —
un `<input type=file webkitdirectory>` lato client non restituisce mai un percorso
assoluto utilizzabile dal daemon per aprire un processo figlio, quindi non è
un'alternativa reale.

Le due macchine reali sono entrambe WSL. Il codice esistente (`core/platform.ts`,
`daemon/reveal.ts`) già distingue WSL / macOS / Linux nativo per azioni analoghe,
dichiarando onestamente quali rami sono verificati dal vivo e quali no. Stesso
trattamento qui: WSL verificato, macOS e Linux nativo scritti seguendo lo stesso
pattern ma non provati (nessuna delle due macchine li è).

## Backend

### `src/daemon/native-browse.ts` (nuovo modulo)

Stessa forma di `reveal.ts`: `execFile` (mai `exec` — argomenti come array, niente
interpolazione in una stringa di shell), non lancia mai eccezioni verso il chiamante.

```ts
export type NativePickResult = { ok: true; path: string } | { ok: false }

export async function pickFolderNative(): Promise<NativePickResult>
export async function nativeFolderPickerAvailable(): Promise<boolean>
```

**`pickFolderNative()`** parte sempre dalla home dell'utente del processo (`os.homedir()`
— `/root` su queste macchine), non dalla cartella già scritta nella casella "Folder":
decisione esplicita dell'utente, per semplicità e indipendenza da cosa c'è già scritto.

- **WSL**: `powershell.exe -NoProfile -STA -Command "<script>"`, dove lo script apre
  `System.Windows.Forms.FolderBrowserDialog` con `SelectedPath` impostato al percorso
  Windows della home (tradotto con `wslpath -w`, la stessa funzione già usata al
  contrario in `reveal.ts` per le UNC `\\wsl.localhost\...`). Se l'utente conferma,
  lo script scrive il percorso scelto su stdout; se annulla, non scrive nulla.
  Il percorso Windows restituito si traduce indietro con `wslpath -u`.
  `-STA` è necessario: `FolderBrowserDialog` è un dialogo WinForms e richiede un
  thread STA, altrimenti PowerShell lancia un'eccezione COM.
- **macOS** (non verificato dal vivo): `osascript -e 'POSIX path of (choose folder
  with prompt "…" default location (path to home folder))'`. L'utente che preme
  Annulla fa uscire `osascript` con codice diverso da zero, quindi `execFile` rigetta
  la promise — si cattura e si tratta come annullo, non come errore.
- **Linux nativo** (non verificato dal vivo): `zenity --file-selection --directory
  --filename=<home>/`. Annullo → uscita 1 → stessa gestione di sopra.

Annullo, comando assente, o qualunque eccezione → `{ ok: false }`. Nessun messaggio di
errore risale alla UI: per decisione esplicita, annullare il dialogo nativo non deve
produrre un avviso, deve solo lasciare tutto com'era.

**`nativeFolderPickerAvailable()`** controlla se il meccanismo esiste **senza aprire
nulla**: `which powershell.exe` su WSL, sempre `true` su macOS (`osascript` è di
sistema), `which zenity` su Linux nativo. Va **rifatto a ogni chiamata**, non messo in
cache all'avvio del daemon: lo stesso file registra già il motivo per cui una cache di
questo tipo si sbaglia — il rilevamento dell'hostname Tailscale, calcolato una sola
volta alla costruzione del guard, restava sbagliato per tutta la vita del processo se
Tailscale veniva installato a daemon già acceso. Qui il costo di ripetere il controllo è
un singolo `execFile` veloce, quindi non c'è ragione di rischiare la stessa staleness.

### Route `POST /api/browse-native`

In `server.ts`, accanto alle altre rotte di comodo (`/api/browse`, `/api/reveal`), dietro
lo stesso `route()` e le stesse quattro difese di perimetro di ogni altra rotta. Nessun
corpo richiesto. Risposta: `{ ok: true, path }` o `{ ok: false }`, sempre `200` — un
annullo non è un errore HTTP.

### `GET /api/system`

Aggiunge un campo `nativeFolderPicker: boolean` al `SystemInfo` restituito, calcolato
chiamando `nativeFolderPickerAvailable()`. `NewChat.svelte` chiama già questa rotta per
sapere i profili Claude disponibili — si riusa la stessa risposta, nessuna richiesta in
più.

## Frontend — `NewChat.svelte`

- Nuovo bottone accanto a `Open path…` (stesso blocco `.dlg`), es. `Sfoglia (Finder di
  sistema)…`. Disabilitato con `title` esplicativo quando `nativeFolderPicker` è
  `false` — mai nascosto, stessa filosofia delle voci non ancora disponibili nelle
  Impostazioni.
- Click → `POST /api/browse-native`. Il bottone si disabilita e mostra uno stato di
  attesa per la durata della richiesta (il dialogo nativo blocca la risposta finché
  l'utente non sceglie o annulla — può durare secondi o minuti).
- Successo (`ok:true`) → `cwd = path` direttamente, stesso effetto pratico di
  `useThisFolder()` nel browser manuale, senza passare dal tree.
- Annullo o fallimento (`ok:false`) → nessun cambiamento visibile, nessun messaggio.
- Il tree manuale (`Open path…`, navigazione cartella per cartella) resta **intatto e
  parallelo**: le due vie coesistono nello stesso riquadro, nessuna sostituisce l'altra.

## Verifica

- `npm run check`: nuove verifiche per `nativeFolderPickerAvailable()` (comando
  presente/assente, mockato) e per `pickFolderNative()`/la route (successo simulato,
  annullo, comando assente) — costo zero di quota, sono `execFile` su comandi di
  sistema o mock.
- Dal vivo, sull'unica macchina reale disponibile (WSL): verifica che il bottone compaia
  abilitato (screenshot Playwright), e un giro manuale dell'utente per il click che apre
  davvero il dialogo Windows — un dialogo nativo di Windows non è pilotabile da qui.
- macOS e Linux nativo: il codice segue lo stesso pattern di `reveal.ts` ma resta
  dichiaratamente non verificato dal vivo, come già accade per quel modulo.

## Fuori scope

- Nessuna modifica al tree manuale esistente (`/api/browse`, `registry.browse`).
- Nessuna cache o persistenza della scelta nativa oltre a scrivere `cwd`.
- Nessun tentativo di far partire il dialogo dalla cartella già scritta in `cwd` —
  parte sempre dalla home, per scelta esplicita.
