param(
  [switch]$SkipDocker
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipDocker) {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($docker) {
    try {
      docker compose up -d
    } catch {
      Write-Host "Docker is not running. Start Docker Desktop or pass -SkipDocker."
    }
  } else {
    Write-Host "Docker is not installed. Start Redis/Postgres locally or pass -SkipDocker."
  }
}

npm install
npm run migrate
