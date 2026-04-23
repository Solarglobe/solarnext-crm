# Export DB + snapshot fichiers depuis la machine locale vers artefacts prêts pour Railway.
# Exécuter dans PowerShell depuis la racine du repo.
#
# IMPORTANT : si votre terminal a deja DATABASE_URL (ex. proxy Railway), ce script
# FORCE la source locale pour l'export uniquement.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $RepoRoot "backend"

# --- Ajustez si votre .env.dev differe ---
$SourceDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/solarnext"

Set-Location $Backend

$env:DATABASE_URL = $SourceDatabaseUrl
Remove-Item Env:PGHOST -ErrorAction SilentlyContinue

Write-Host "[1/2] Sauvegarde PostgreSQL (npm run backup:db)..."
npm run backup:db
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[2/2] Snapshot fichiers storage + calpinage + uploads (npm run backup:files)..."
$env:BACKUP_FORCE = "1"
npm run backup:files
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "OK — Artefacts :"
Write-Host "  - DB  : backend\backups\YYYY-MM\*.sql.gz (dernier fichier le plus recent)"
Write-Host "  - Fichiers : backend\backups\documents\YYYY-MM-DD\"
Write-Host ""
Write-Host "Import Railway : definir DATABASE_URL (URL du plugin Postgres Railway, avec ?sslmode=require si demande), puis depuis backend\ :"
Write-Host '  $env:DATABASE_URL = "<RAILWAY_POSTGRES_URL>"'
Write-Host '  $env:BACKUP_RESTORE_RESET = "schema"   # si DROP DATABASE interdit (managed Postgres)'
Write-Host '  $env:CONFIRM_RESTORE = "YES"'
Write-Host "  npm run restore:db -- --yes backups\YYYY-MM\FICHIER.sql.gz"
Write-Host "Verification : node scripts/verify-db-counts.mjs `$env:DATABASE_URL"
Write-Host ""
Write-Host "Fichiers : deployer le dossier backups\documents\DATE\storage\ vers /app/storage sur le service (volume persistant)."
