#requires -version 5
# Accounting ERP - Windows setup: database, schema, packages, owner user.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($msg) {
  Write-Host ""
  Write-Host "[ERROR] $msg" -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

function Find-PgBin {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return (Split-Path -Parent $cmd.Source) }
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
           Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.Directory.FullName }
  return $null
}

function Read-Secret($label) {
  $secure = Read-Host $label -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
           [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

Write-Host ""
Write-Host "===== Accounting ERP - Setup =====" -ForegroundColor Cyan
Write-Host ""

# ------------------------------- requirements -------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js not found. Install it from https://nodejs.org and run this again."
}

$bin = Find-PgBin
if (-not $bin) {
  Fail "PostgreSQL not found. Install it from https://www.postgresql.org/download/windows/ and run this again."
}
$env:Path = "$bin;$env:Path"

Write-Host ("  Node.js " + (node -v)) -ForegroundColor DarkGray
Write-Host ("  " + (psql --version)) -ForegroundColor DarkGray

$env:PGUSER = "postgres"
$env:PGHOST = "localhost"
$env:PGPORT = "5432"
# Schema files are UTF-8; psql on Windows assumes the ANSI code page otherwise.
$env:PGCLIENTENCODING = "UTF8"

$db      = "erp"
$dataDir = "$env:LOCALAPPDATA\pgdata"

# ---------------------------- database server -------------------------------
Write-Host ""
Write-Host "[1/6] Checking database server..." -ForegroundColor Yellow

$running = $false
try {
  $running = [bool](Test-NetConnection -ComputerName localhost -Port 5432 `
                      -InformationLevel Quiet -WarningAction SilentlyContinue)
} catch { $running = $false }

if ($running) {
  Write-Host "      Server is running" -ForegroundColor DarkGray
  $pass = Read-Secret "      Password for user 'postgres'"
  $env:PGPASSWORD = $pass

  & psql -d postgres -c "select 1" *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Wrong password, or the server refused the connection." }
}
else {
  Write-Host "      No server on port 5432 - setting up a local database" -ForegroundColor DarkGray

  if (Test-Path "$dataDir\PG_VERSION") {
    Write-Host "      Starting the existing local database..." -ForegroundColor DarkGray
    & "$bin\pg_ctl.exe" -D $dataDir -l "$env:LOCALAPPDATA\pg.log" -w start *> $null
    $pass = Read-Secret "      Password for user 'postgres'"
    $env:PGPASSWORD = $pass
  }
  else {
    Write-Host ""
    Write-Host "      Choose a password for the database user 'postgres' (save it)" -ForegroundColor Cyan
    $pass = Read-Secret "      Password"
    if ([string]::IsNullOrWhiteSpace($pass)) { Fail "No password entered." }

    $pwFile = "$env:TEMP\pgpw.txt"
    [System.IO.File]::WriteAllText($pwFile, $pass, [System.Text.Encoding]::ASCII)
    Write-Host "      Initializing database cluster..." -ForegroundColor DarkGray
    & "$bin\initdb.exe" -D $dataDir -U postgres --pwfile=$pwFile -E UTF8 --locale=C
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path "$dataDir\PG_VERSION")) { Fail "Database initialization failed." }

    & "$bin\pg_ctl.exe" -D $dataDir -l "$env:LOCALAPPDATA\pg.log" -w start *> $null
    $env:PGPASSWORD = $pass
  }

  Start-Sleep 2
  & psql -d postgres -c "select 1" *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Could not connect. See the log: $env:LOCALAPPDATA\pg.log" }
  Write-Host "      [OK] Database is running" -ForegroundColor Green
}

# ---------------------------- application database --------------------------
Write-Host "[2/6] Creating the application database..." -ForegroundColor Yellow

$exists = (& psql -d postgres -tAc "select 1 from pg_database where datname = '$db'")
if ($exists -eq "1") {
  Write-Host ""
  Write-Host "      WARNING: database '$db' already exists. Rebuilding erases all its data." -ForegroundColor Red
  $answer = Read-Host "      Type  y  to continue, anything else to cancel"
  if ($answer -notmatch '^(y|yes)$') {
    Write-Host "      Cancelled."
    Read-Host "Press Enter"
    exit 0
  }
  & psql -d postgres -c "drop database $db with (force);" *> $null
}
& psql -d postgres -c "create database $db;" *> $null
if ($LASTEXITCODE -ne 0) { Fail "Could not create the database." }

# --------------------------------- schema -----------------------------------
Write-Host "[3/6] Applying database schema..." -ForegroundColor Yellow
Get-ChildItem "supabase\migrations\*.sql" | Sort-Object Name | ForEach-Object {
  Write-Host ("      " + $_.Name) -ForegroundColor DarkGray
  & psql -d $db -v ON_ERROR_STOP=1 -q -f $_.FullName
  if ($LASTEXITCODE -ne 0) { Fail ("Failed on " + $_.Name) }
}

# -------------------------------- packages ----------------------------------
Write-Host "[4/6] Installing packages (this can take a few minutes)..." -ForegroundColor Yellow
& npm install --no-fund --no-audit --loglevel=error
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

# ------------------------------ configuration -------------------------------
Write-Host "[5/6] Writing configuration..." -ForegroundColor Yellow
$secret = -join ((1..48) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
$envText = "DATABASE_URL=postgres://postgres:$pass@localhost:5432/$db`r`nSESSION_SECRET=$secret`r`n"
[System.IO.File]::WriteAllText("$root\.env.local", $envText, (New-Object System.Text.UTF8Encoding($false)))

# ------------------------------- owner user ---------------------------------
Write-Host "[6/6] Creating the login user..." -ForegroundColor Yellow
$adminPass = Read-Host "      Password for the 'admin' login"
if ([string]::IsNullOrWhiteSpace($adminPass)) { $adminPass = "admin123" }

$env:DATABASE_URL = "postgres://postgres:$pass@localhost:5432/$db"
& node scripts/create-user.mjs admin $adminPass "System Manager" --owner
if ($LASTEXITCODE -ne 0) { Fail "Could not create the user." }

# ------------------------------- demo data ----------------------------------
Write-Host ""
$demo = Read-Host "Load demo data for testing? (type y for yes)"
if ($demo -match '^(y|yes)$') {
  & psql -d $db -q -f "scripts\seed-demo.sql"
  if ($LASTEXITCODE -eq 0) { Write-Host "  [OK] Demo data loaded" -ForegroundColor Green }
}

Write-Host ""
Write-Host "===== Setup complete =====" -ForegroundColor Green
Write-Host ""
Write-Host "  Run the system: double-click  start.bat" -ForegroundColor Cyan
Write-Host "  Username: admin"
Write-Host ""
Read-Host "Press Enter to close"
