$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'The .env file does not exist. Run scripts/demo-up.cmd first.'
}

$accessKey = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^NAVIGATOR_DEMO_ACCESS_KEY=' } |
    ForEach-Object { $_.Substring('NAVIGATOR_DEMO_ACCESS_KEY='.Length) }

if (-not $accessKey) {
    throw 'The .env file is missing NAVIGATOR_DEMO_ACCESS_KEY.'
}

$client = New-Object System.Net.WebClient
$client.Proxy = $null
$client.Encoding = [System.Text.Encoding]::UTF8
$client.Headers.Add('X-Demo-Key', $accessKey)
try {
    $result = $client.UploadString('http://127.0.0.1:8000/api/v1/demo/reset', 'POST', '') |
        ConvertFrom-Json
} finally {
    $client.Dispose()
}

$countryCount = $result.data.record_counts.countries
Write-Host "Synthetic demo data reset complete: $countryCount countries." -ForegroundColor Green
