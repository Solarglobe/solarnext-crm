$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$js = Join-Path $repo "scripts\railway-probe-dp-calpinage.js"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList @(
  "/c",
  "type `"$js`" | railway ssh -- sh -c `"cat `> /tmp/probe-dp.js `&`& cd /app/backend `&`& NODE_PATH=/app/backend/node_modules node /tmp/probe-dp.js`""
) -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\railway-probe-out.txt" -RedirectStandardError "$env:TEMP\railway-probe-err.txt"
Get-Content "$env:TEMP\railway-probe-out.txt" -ErrorAction SilentlyContinue
Get-Content "$env:TEMP\railway-probe-err.txt" -ErrorAction SilentlyContinue
exit $p.ExitCode
