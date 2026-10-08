# Start Emora on Windows: backend on :8000 and frontend on :5173.
#
#   start.bat           local only (recommended)
#   start.bat -Lan      also reachable from your phone on the same Wi-Fi
#
# Each server opens in its own window; close a window to stop that server.
# -Lan binds the backend to 0.0.0.0, which exposes it to everyone on that
# network (and /register needs no login). Use it only on a trusted Wi-Fi.

param([switch]$Lan)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$Root = $PSScriptRoot

$venvUvicorn = Join-Path $Root 'venv\Scripts\uvicorn.exe'
if (-not (Test-Path $venvUvicorn)) { Write-Host 'venv missing - run setup.bat first.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $Root 'emora-frontend\node_modules'))) { Write-Host 'Frontend packages missing - run setup.bat first.' -ForegroundColor Red; exit 1 }

foreach ($port in 8000, 5173) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Port $port is already in use - is Emora already running? Close it first." -ForegroundColor Red
    exit 1
  }
}

$bindHost = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

# .env decides (EMORA_WARMUP=1 preloads models). If it doesn't say, load lazily:
# preloading pins 2-3 GB, too much alongside a browser on an 8-16 GB machine.
$envFile = Join-Path $Root '.env'
$envSaysWarmup = (Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^EMORA_WARMUP=' -Quiet)
if (-not $envSaysWarmup -and -not $env:EMORA_WARMUP) { $env:EMORA_WARMUP = '0' }

$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

Start-Process -FilePath $venvUvicorn `
  -ArgumentList 'backend.app.main:app', '--host', $bindHost, '--port', '8000' `
  -WorkingDirectory $Root -WindowStyle Normal
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/k', 'title Emora frontend && npm run dev' `
  -WorkingDirectory (Join-Path $Root 'emora-frontend') -WindowStyle Normal

# Wait for the backend so the first page load doesn't show "offline".
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8000/api/health' | Out-Null; break }
  catch { Start-Sleep -Seconds 1 }
}

Write-Host ''
Write-Host '  Emora is running' -ForegroundColor Cyan
Write-Host '    App      http://localhost:5173'
Write-Host '    Backend  http://127.0.0.1:8000'
if ($Lan) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
  Write-Host "    Phone    backend reachable at http://${ip}:8000 (trusted Wi-Fi only)"
}
Write-Host '  Close the two server windows to stop Emora.'
Start-Process 'http://localhost:5173'
