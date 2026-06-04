param()

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL) {
  Write-Error 'DATABASE_URL is required for backup-postgres.ps1'
  exit 1
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Error 'pg_dump not found in PATH. Install PostgreSQL client tools.'
  exit 1
}

$backupDir = $env:BACKUP_DIR ?? (Join-Path (Get-Location) 'backups')
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupFile = Join-Path $backupDir ("wa-dashboard-$timestamp.dump")
$logFile = Join-Path $backupDir ("wa-dashboard-$timestamp.log")

Write-Host "Creating backup: $backupFile"
& pg_dump $env:DATABASE_URL --format=custom --compress=9 --file $backupFile 2> $logFile

if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed. See: $logFile"
  exit $LASTEXITCODE
}

if ($env:BACKUP_RETENTION_DAYS) {
  $retentionDays = 0
  if ([int]::TryParse($env:BACKUP_RETENTION_DAYS, [ref]$retentionDays) -and $retentionDays -gt 0) {
    Get-ChildItem -Path $backupDir -Filter 'wa-dashboard-*.dump' |
      Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) } |
      Remove-Item -Force
  }
}

Write-Host "Backup completed: $backupFile"
