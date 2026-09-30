param(
  [string]$EnvironmentFile = '.env.docker.local'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
  New-Item -ItemType File -Path $EnvironmentFile | Out-Null
}

$existing = Get-Content -LiteralPath $EnvironmentFile
if ($existing -match '^AI_DATA_ENCRYPTION_KEY=') {
  Write-Output 'AI data encryption key already exists; no changes made.'
  exit 0
}

$keyBytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($keyBytes)
} finally {
  $generator.Dispose()
}
$encoded = [Convert]::ToBase64String($keyBytes)

Add-Content -LiteralPath $EnvironmentFile -Value "AI_DATA_ENCRYPTION_KEY=$encoded"
Add-Content -LiteralPath $EnvironmentFile -Value 'AI_DATA_ENCRYPTION_KEY_VERSION=v1'
Write-Output "Generated AI data encryption key in $EnvironmentFile."
