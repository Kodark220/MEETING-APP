param(
  [switch]$ApiOnly,
  [switch]$WorkerOnly
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $WorkerOnly) {
  Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $root
}

if (-not $ApiOnly) {
  Start-Process -FilePath "npm" -ArgumentList "run", "worker" -WorkingDirectory $root
}
