# Emora — one-command setup for Windows 10/11.
#
#   setup.bat                (double-click, or run from a terminal)
#   setup.bat -NoStart       install only
#
# On a fresh machine this installs, in order:
#   1. System tools via winget: Python 3.12, Node.js LTS, ffmpeg, and the
#      Visual C++ runtime that TensorFlow and PyTorch need on Windows.
#   2. Python packages into .\venv (torch, TensorFlow, DeepFace, Whisper, ...).
#      About 3 GB; the first run takes 10-20 minutes on a normal connection.
#   3. Frontend packages, and a production build of the UI.
#   4. A .env with a freshly generated SECRET_KEY.
#
# Safe to re-run: every step skips what is already done.

param([switch]$NoStart)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$Root = $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" }
function Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

# winget installs land on PATH only for new shells; pull the fresh PATH in.
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# ── 1. System prerequisites ───────────────────────────────────────────────────
Step 'Checking system prerequisites'

if (-not (Have winget)) {
  Fail 'winget not found. Install "App Installer" from the Microsoft Store (Windows 10/11), then re-run.'
}

function Winget-Install($id, $label) {
  Info "Installing $label ..."
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  Refresh-Path
}

# The py launcher finds a specific version even when several are installed.
$hasPy312 = $false
if (Have py) { py -3.12 --version *> $null; $hasPy312 = ($LASTEXITCODE -eq 0) }
if (-not $hasPy312) { Winget-Install 'Python.Python.3.12' 'Python 3.12' }
if (-not (Have node))   { Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
if (-not (Have ffmpeg)) { Winget-Install 'Gyan.FFmpeg' 'ffmpeg' }
# TensorFlow and PyTorch DLLs fail to load without the MSVC runtime.
Winget-Install 'Microsoft.VCRedist.2015+.x64' 'Visual C++ runtime'

Refresh-Path
if (-not (Have py)) { Fail 'Python launcher (py) not found after install. Open a new terminal and re-run setup.bat.' }
py -3.12 --version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Python 3.12 not available (TensorFlow does not support newer versions). Open a new terminal and re-run.' }
if (-not (Have node))   { Fail 'Node.js not found after install. Open a new terminal and re-run setup.bat.' }
if (-not (Have ffmpeg)) { Fail 'ffmpeg not found after install. Open a new terminal and re-run setup.bat.' }

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Fail "Node.js 20+ required (found $(node -v))." }

Info "Python : $(py -3.12 --version)"
Info "Node   : $(node -v)"

# TensorFlow's install tree exceeds Windows' 260-character path limit.
$longPaths = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
if ($longPaths -ne 1) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1
    Info 'Enabled Windows long paths (needed by TensorFlow)'
  } else {
    Warn 'Windows long paths are off; TensorFlow may fail to install. Re-run setup.bat as Administrator once to enable them, or keep this folder at a short path like C:\emora.'
  }
}

# ── 2. Python environment ─────────────────────────────────────────────────────
Step 'Python packages (first run: ~3 GB, 10-20 minutes)'

$venvPy = Join-Path $Root 'venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) { py -3.12 -m venv venv }
if (-not (Test-Path $venvPy)) { Fail 'Could not create the Python virtual environment.' }

& $venvPy -m pip install --upgrade pip wheel | Out-Null
& $venvPy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Fail 'pip install failed (see the messages above).' }

# ── 3. Configuration ──────────────────────────────────────────────────────────
Step 'Configuration'

New-Item -ItemType Directory -Force -Path 'data\memories' | Out-Null
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Info 'Created .env from .env.example'
}
# A default SECRET_KEY lets anyone forge a login, so never leave the placeholder.
$envText = Get-Content '.env' -Raw
if ($envText -match '(?m)^SECRET_KEY=(change-me.*|dev-secret.*)?\s*$') {
  $key = & $venvPy -c 'import secrets; print(secrets.token_urlsafe(48))'
  $envText = $envText -replace '(?m)^SECRET_KEY=.*$', "SECRET_KEY=$key"
  Set-Content -Path '.env' -Value $envText -NoNewline
  Info 'Generated a random SECRET_KEY'
}

# ── 4. Frontend ───────────────────────────────────────────────────────────────
Step 'Frontend packages and UI build'

Push-Location 'emora-frontend'
if (Test-Path 'package-lock.json') {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    Info 'npm ci failed, retrying with npm install...'
    npm install --no-audit --no-fund
  }
} else {
  npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'npm install failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'UI build failed.' }
Pop-Location

# ── 5. Smoke test ─────────────────────────────────────────────────────────────
Step 'Checking the install'

& $venvPy -c "import importlib; [importlib.import_module(m) for m in ('fastapi','deepface','tensorflow','torch','transformers','whisper','nano_parakeet','edge_tts','cv2')]; from backend.app.main import app; print('    backend imports OK')"
if ($LASTEXITCODE -ne 0) { Fail 'Backend import check failed (see the error above).' }
if (Test-Path 'emora-frontend\dist\index.html') { Info 'UI build OK' }

Step 'Setup complete'
Write-Host @'

    Start Emora any time with:   start.bat
    Then open:                   http://localhost:5173

    Chat needs one AI provider key - add it in the app: Settings > AI Providers
    (or set LLM_API_KEY in .env). Everything else works without a key.

'@

if (-not $NoStart) { & (Join-Path $Root 'start.ps1') }
