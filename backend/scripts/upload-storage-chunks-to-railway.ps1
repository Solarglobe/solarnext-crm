# Envoie storage.tar.gz vers Railway par morceaux (stdin -> dd) pour éviter timeout WebSocket.
# Prérequis : railway link, service solarnext-crm, exécuter depuis backend\
param(
  [string]$TarPath = (Resolve-Path "$PSScriptRoot\..\..\storage.tar.gz").Path,
  [int]$ChunkMB = 120
)

$ErrorActionPreference = "Stop"
$railway = (Get-Command railway.cmd -ErrorAction Stop).Source
$partsDir = Join-Path (Split-Path $TarPath) "storage_tar_parts"
if (Test-Path $partsDir) { Remove-Item $partsDir -Recurse -Force }
New-Item -ItemType Directory -Path $partsDir | Out-Null

Write-Host "[split] $TarPath -> $partsDir (${ChunkMB}MB chunks)"
$fs = [System.IO.File]::OpenRead($TarPath)
try {
  $buf = New-Object byte[] ($ChunkMB * 1MB)
  $idx = 0
  while (($read = $fs.Read($buf, 0, $buf.Length)) -gt 0) {
    $out = Join-Path $partsDir ("part{0:D4}.bin" -f $idx)
    $ms = New-Object System.IO.MemoryStream
    $ms.Write($buf, 0, $read)
    [System.IO.File]::WriteAllBytes($out, $ms.ToArray())
    $ms.Dispose()
    $idx++
    Write-Host "  wrote $out ($read bytes)"
  }
} finally { $fs.Close() }

Write-Host "[remote] reset /app/storage.tar.gz"
& $railway ssh -- "rm -f /app/storage.tar.gz"

$n = 0
Get-ChildItem $partsDir -Filter "part*.bin" | Sort-Object Name | ForEach-Object {
  $n++
  Write-Host "[$n] uploading $($_.Name) ($([math]::Round($_.Length/1MB,1)) MB)..."
  $p = Start-Process -FilePath $railway -ArgumentList @("ssh", "--", "sh", "-c", "dd of=/app/storage.tar.gz bs=1M conv=notrunc oflag=append") `
    -RedirectStandardInput $_.FullName -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "railway ssh dd failed exit $($p.ExitCode) on $($_.Name)" }
}

Write-Host "[remote] size check"
& $railway ssh -- "ls -la /app/storage.tar.gz"

$localSize = (Get-Item $TarPath).Length
Write-Host "[done] local bytes=$localSize (compare with remote)"
