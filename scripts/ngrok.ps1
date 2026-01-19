param(
  [int]$Port = 3000
)

$ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrok) {
  Write-Host "ngrok not found. Install it from https://ngrok.com/download"
  exit 1
}

ngrok http $Port
