#requires -version 5
# Accounting ERP - start the system
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env.local")) {
  Write-Host "[ERROR] Not set up yet. Run setup.bat first." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

# Start the local database if it is not running
$dataDir = "$env:LOCALAPPDATA\pgdata"
if (Test-Path "$dataDir\PG_VERSION") {
  $up = $false
  try {
    $up = [bool](Test-NetConnection -ComputerName localhost -Port 5432 `
                   -InformationLevel Quiet -WarningAction SilentlyContinue)
  } catch { $up = $false }

  if (-not $up) {
    $pgctl = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_ctl.exe" -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1
    if ($pgctl) {
      Write-Host "Starting the database..." -ForegroundColor Yellow
      & $pgctl.FullName -D $dataDir -l "$env:LOCALAPPDATA\pg.log" -w start *> $null
      Start-Sleep 2
    }
  }
}

if (-not (Test-Path ".next")) {
  Write-Host "Building the system for the first time (a minute or two)..." -ForegroundColor Yellow
  & npm run build
  if ($LASTEXITCODE -ne 0) { Read-Host "Build failed. Press Enter"; exit 1 }
}

Write-Host ""
Write-Host "===== System is running =====" -ForegroundColor Green
Write-Host "  Open:  http://localhost:3000" -ForegroundColor Cyan
Write-Host "  To stop: close this window"
Write-Host ""

Start-Job { Start-Sleep 5; Start-Process "http://localhost:3000" } | Out-Null
& npm start
