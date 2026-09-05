# Installa STARK con un comando solo, su Windows.
#
#   irm https://starkapp.dev/install.ps1 | iex
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
# Da dove si scarica il bundle già pronto per questa piattaforma — non un repo da
# clonare: vedi la sezione «Codice» più sotto, e docs/distribuzione.md per il perché.
$ReleaseBase = if ($env:STARK_RELEASE_BASE) { $env:STARK_RELEASE_BASE } else { 'https://starkapp.dev/releases/latest' }

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

# ── kanban-md, il motore della board ─────────────────────────────────────────
# La board di progetto (kanban.md) è un binario Go: STARK lo scarica qui, dentro la
# cartella di STARK, e il daemon lo chiama con **percorso assoluto** — la lezione di
# Tailscale su macOS, dove il `PATH` non è affidabile. Uno per piattaforma.
$KanbanVersione = if ($env:STARK_KANBAN_VERSION) { $env:STARK_KANBAN_VERSION } else { 'v0.38.0' }
$KanbanBin = Join-Path $Base 'bin\kanban-md.exe'
$KanbanArch = if ($Arch -eq 'x64') { 'amd64' } else { 'arm64' }
if ((Test-Path $KanbanBin) -and (& $KanbanBin --version 2>$null)) {
  Grigio "kanban-md:  già scaricato"
} else {
  Grigio "kanban-md:  scarico $KanbanVersione (windows-$KanbanArch)"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("stark-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Invoke-WebRequest -Uri "https://github.com/antopolskiy/kanban-md/releases/download/$KanbanVersione/kanban-md_$($KanbanVersione.TrimStart('v'))_windows_$KanbanArch.zip" -OutFile "$tmp\kb.zip"
    Expand-Archive -Path "$tmp\kb.zip" -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Path (Split-Path $KanbanBin) -Force | Out-Null
    Move-Item (Join-Path $tmp 'kanban-md.exe') $KanbanBin -Force
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  Verde "           kanban-md pronto"
}

# ── il codice ───────────────────────────────────────────────────────────────
# Non un `git clone`: un bundle già pronto (codice, `node_modules` e interfaccia già
# compilata) per l'ultima **release** e per questa piattaforma esatta. Lo stesso bundle
# lo scarica anche `stark update` (`daemon/aggiornamenti.ts`) — è la ragione per cui qui
# non c'è compilazione né `npm install`: quel lavoro l'ha già fatto la CI una volta sola,
# non ogni macchina che installa. Perché non più un repo da clonare, e cosa c'è dentro
# un bundle: docs/distribuzione.md.
Titolo 'Codice'
if (Test-Path (Join-Path $App 'package.json')) {
  Write-Host "c'e' gia': aggiorno ($App)"
} else {
  New-Item -ItemType Directory -Path $App -Force | Out-Null
}

$Bundle = "stark-win-$Arch.tar.gz"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("stark-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  try {
    Invoke-WebRequest -Uri "$ReleaseBase/$Bundle" -OutFile "$tmp\stark.tar.gz"
  } catch {
    Muori "Non sono riuscito a scaricare $ReleaseBase/$Bundle.
Se questa piattaforma (win-$Arch) non e' ancora fra quelle pubblicate, dillo — si aggiunge."
  }
  # `tar` e' incluso in Windows dalla 1803 in poi (bsdtar) — un formato solo, lo stesso
  # di `install.sh`, invece di un'estrazione diversa per piattaforma.
  & tar -xzf "$tmp\stark.tar.gz" -C $App
  if ($LASTEXITCODE -ne 0) { Muori 'Il bundle scaricato non si e'' estratto correttamente.' }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
# Barre in avanti nel path passato a `require()`: Node le accetta anche su Windows, ed
# evita di dover raddoppiare i backslash per non romperli dentro la stringa JS.
$AppPerNode = $App -replace '\\', '/'
try { Grigio "versione $(& $NodeExe -p "require('$AppPerNode/package.json').version")" } catch { }

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
