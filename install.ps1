# Installa STARK con un comando solo, su Windows.
#
#   irm https://raw.githubusercontent.com/devsmkna/stark/main/install.ps1 | iex
#
# Gemello di `install.sh`, con cui condivide le tre scelte che contano:
#
# 1. **Per utente, niente amministratore.** Tutto sotto %LOCALAPPDATA%\stark, e il
#    comando `stark` nel PATH dell'utente. Elevare servirebbe solo a scrivere dei file
#    in una cartella condivisa, e non darebbe all'agent nessun permesso in piu': a
#    decidere cosa l'agent puo' fare e' chi lancia `stark`, esattamente come chi lancia
#    `claude` dal terminale. Lanciarlo da un prompt elevato sarebbe invece **un altro
#    STARK**, perche' `~/.claude` e `~/.stark` seguono l'utente.
#
# 2. **Non tocca il Node di sistema.** Se quello installato e' troppo vecchio (o non
#    c'e'), il Node ufficiale finisce dentro la cartella di STARK e ci punta solo il
#    lanciatore, con percorso assoluto.
#
# 3. **Niente avvio automatico.** STARK si accende quando digiti `stark`, sopravvive
#    alla chiusura del terminale, e a macchina spenta resta spento: al riavvio lo
#    riaccendi tu. E' una scelta — il daemon tiene in piedi processi di agent, e uno che
#    riparte da solo al boot e' uno che lavora senza che nessuno gliel'abbia chiesto.

$ErrorActionPreference = 'Stop'
# Senza, Invoke-WebRequest su PowerShell 5.1 disegna una barra di avanzamento che rallenta
# il download di un ordine di grandezza. Non e' cosmesi: sono minuti su un pacchetto Node.
$ProgressPreference = 'SilentlyContinue'
# Windows 10 non abilita TLS 1.2 di default in .NET Framework, e nodejs.org accetta solo
# quello: senza questa riga il download fallisce con un errore sulla connessione chiusa.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ── dove va cosa ────────────────────────────────────────────────────────────
$Base    = if ($env:STARK_DIR) { $env:STARK_DIR } else { Join-Path $env:LOCALAPPDATA 'stark' }
$App     = Join-Path $Base 'app'
$NodeDir = Join-Path $Base 'node'
$Repo    = if ($env:STARK_REPO)   { $env:STARK_REPO }   else { 'https://github.com/devsmkna/stark.git' }
$Ramo    = if ($env:STARK_BRANCH) { $env:STARK_BRANCH } else { 'main' }

# Fissata invece di «l'ultima»: un installer che prende ogni volta una versione diversa
# e' un installer che funziona finche' non smette, senza che nessuno abbia cambiato nulla.
$NodeVersione = if ($env:STARK_NODE_VERSION) { $env:STARK_NODE_VERSION } else { 'v24.13.1' }
# La soglia vera, da package.json: sotto la 22.18 Node non esegue i `.ts` senza compilarli.
$NodeMinMajor = 22
$NodeMinMinor = 18

function Titolo($t) { Write-Host ''; Write-Host $t -ForegroundColor White }
function Grigio($t) { Write-Host $t -ForegroundColor DarkGray }
function Verde($t)  { Write-Host $t -ForegroundColor Green }
function Muori($t)  { Write-Host $t -ForegroundColor Red; exit 1 }

function Esiste($nome) { $null -ne (Get-Command $nome -ErrorAction SilentlyContinue) }

# ── che macchina e' ─────────────────────────────────────────────────────────
$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  # Un PowerShell a 32 bit su un Windows a 64 bit: la variabile giusta e' l'altra.
  'x86'   { if ($env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') { 'x64' } else { $null } }
  default { $null }
}
if (-not $Arch) { Muori "Architettura non supportata: $env:PROCESSOR_ARCHITECTURE. STARK gira su x64 e arm64." }

# ── il Node giusto ──────────────────────────────────────────────────────────
function NodeVaBene($exe) {
  if (-not (Test-Path $exe)) { if (-not (Esiste $exe)) { return $false } }
  try { $v = (& $exe -v 2>$null) } catch { return $false }
  if ($v -notmatch '^v(\d+)\.(\d+)\.') { return $false }
  $maj = [int]$Matches[1]; $min = [int]$Matches[2]
  return ($maj -gt $NodeMinMajor) -or ($maj -eq $NodeMinMajor -and $min -ge $NodeMinMinor)
}

Titolo 'STARK - installazione'
Grigio "cartella:  $Base"

$NodeExe = $null
$MioNode = Join-Path $NodeDir 'node.exe'
# Prima quello che STARK si e' gia' scaricato, poi quello di sistema: il secondo puo'
# essere cambiato sotto i piedi, mentre della propria copia sappiamo la versione.
if (NodeVaBene $MioNode) {
  $NodeExe = $MioNode
  Grigio "Node:      $(& $NodeExe -v) (gia' scaricato da STARK)"
} elseif ((Esiste 'node') -and (NodeVaBene 'node')) {
  $NodeExe = (Get-Command node).Source
  Grigio "Node:      $(& $NodeExe -v) (di sistema)"
} else {
  if (Esiste 'node') { Grigio "Node:      $(& node -v) di sistema, troppo vecchio (serve >= $NodeMinMajor.$NodeMinMinor)" }
  else               { Grigio 'Node:      assente' }
  Write-Host "           scarico $NodeVersione solo per STARK, senza toccare il tuo"

  $pacco = "node-$NodeVersione-win-$Arch"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("stark-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersione/$pacco.zip" -OutFile "$tmp\node.zip"
    Expand-Archive -Path "$tmp\node.zip" -DestinationPath $tmp -Force
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $NodeDir) -Force | Out-Null
    # Lo zip di Windows ha tutto in una sottocartella col nome della versione, e dentro
    # `node.exe` e `npm.cmd` sono allo stesso livello (su POSIX invece stanno in `bin/`).
    Move-Item (Join-Path $tmp $pacco) $NodeDir
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  $NodeExe = $MioNode
  if (-not (NodeVaBene $NodeExe)) { Muori "Il Node scaricato non parte. Contenuto in $NodeDir" }
  Verde "           Node $(& $NodeExe -v) pronto"
}

$NodeBin = Split-Path $NodeExe
$Npm = Join-Path $NodeBin 'npm.cmd'
if (-not (Test-Path $Npm)) {
  if (Esiste 'npm') { $Npm = (Get-Command npm).Source } else { Muori 'Trovato node ma non npm.' }
}

if (-not (Esiste 'git')) {
  Muori "Serve git, e non lo trovo.
Installalo con:  winget install --id Git.Git -e
Poi apri un terminale nuovo e rilancia questo comando."
}

# ── il codice ───────────────────────────────────────────────────────────────
Titolo 'Codice'
if (Test-Path (Join-Path $App '.git')) {
  Write-Host "c'e' gia': aggiorno ($App)"
} else {
  New-Item -ItemType Directory -Path (Split-Path $App) -Force | Out-Null
  & git clone --quiet --branch $Ramo --depth 1 $Repo $App
  if ($LASTEXITCODE -ne 0) { Muori "Non sono riuscito a clonare $Repo (ramo $Ramo).
Se il repo e' privato, servono le tue credenziali git su questa macchina." }
}

# Ci si mette sull'ultima **release**, non sulla punta del ramo: si installa una
# versione che qualcuno ha dichiarato pronta, non l'ultima cosa scritta. Il clone qui
# sopra prende il ramo perche' serve un punto da cui partire — la regola vera e' la riga
# qui sotto, e se non c'e' ancora nessuna release lo dice e resta sul ramo.
#
# E' TypeScript e non PowerShell perche' la stessa regola serve a `stark update` e a
# `install.sh`: tre copie in tre linguaggi sono tre modi di restare indietro. Gira
# **prima** di `npm install`, quindi quel file non dipende da `node_modules`.
#
# `--ff-only` dentro: se qualcuno ha messo mano al repo, si ferma invece di
# sovrascrivere. E' il suo lavoro, e cancellarlo non e' una decisione dell'installer.
& $NodeExe (Join-Path $App 'src/cli/release.ts') checkout $App
if ($LASTEXITCODE -ne 0) { Muori "Non sono riuscito a mettere $App sull'ultima release.
Se ci hai lavorato dentro, le modifiche locali vanno risolte a mano." }
Grigio (& git -C $App log --oneline -1)

# Da qui in poi `npm` deve trovare **questo** node: npm e' uno script che invoca `node`
# dal PATH, e senza questa riga un Node vecchio in testa rifiuterebbe i pacchetti che
# dichiarano `engines`. Vale solo per questo processo, non per il sistema.
$env:Path = "$NodeBin;$env:Path"

Titolo 'Dipendenze'
Write-Host "(la prima volta ci mette qualche minuto: dentro c'e' il binario di Claude Code, ~340 MB)"
Push-Location $App
try {
  & $Npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Muori 'npm install e'' fallito.' }
  # `npm install` riscrive `package-lock.json` e `yarn.lock` a ogni esecuzione
  # (misurato). Senza questo, l'installazione lascerebbe l'albero sporco e il rilancio
  # dell'installer — o il primo `stark update` — si rifiuterebbe per «modifiche locali»
  # che sono nostre.
  & $NodeExe (Join-Path $App 'src/cli/release.ts') riallinea $App

  Titolo 'Interfaccia'
  & $Npm run ui:build | Out-Null
  if ($LASTEXITCODE -ne 0) { Muori "La compilazione della UI e' fallita.
Rilancia a mano per vedere il perche':  cd $App ; npm run ui:build" }
  Verde 'compilata'
} finally { Pop-Location }

# ── il comando ──────────────────────────────────────────────────────────────
Titolo 'Comando stark'
# Lo scrive il CLI stesso e non questo script: il lanciatore contiene il percorso di
# **questo** Node e di **questo** repo, e chi li conosce per certo e' il processo che sta
# girando adesso. Una seconda copia di quella logica qui sarebbe la stessa regola scritta
# due volte, cioe' la prima che resta indietro. E' anche il punto in cui il PATH utente
# viene aggiornato, con la stessa condotta su Windows e su POSIX.
& $NodeExe (Join-Path $App 'src\cli\stark.ts') install
if ($LASTEXITCODE -ne 0) { Muori 'Non sono riuscito a installare il comando `stark`.' }

Titolo 'Fatto.'
Write-Host 'Adesso, da qualunque cartella:'
Write-Host ''
Write-Host '  stark          accende STARK e lo apre nel browser'
Write-Host '  stark status   come sta'
Write-Host '  stark stop     lo ferma'
Write-Host '  stark update   prende l''ultima versione'
Write-Host ''
Grigio 'STARK resta acceso anche se chiudi il terminale, e si spegne quando spegni il PC:'
Grigio 'al riavvio digita di nuovo `stark`. Niente parte da solo.'
Write-Host ''
Grigio 'Apri un terminale nuovo: il PATH e'' appena cambiato e questo non lo vede.'
Write-Host ''
Write-Host 'Serve un login di Claude Code: la prima chat te lo dira''.'
