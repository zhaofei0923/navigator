[CmdletBinding()]
param(
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$composePath = Join-Path $repoRoot 'compose.yaml'

function New-DemoSecret {
    param([int]$ByteCount)

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string[]]$Lines
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $Lines, $encoding)
}

function Get-JsonWithoutProxy {
    param([string]$Uri)

    $client = New-Object System.Net.WebClient
    $client.Proxy = $null
    try {
        return ($client.DownloadString($Uri) | ConvertFrom-Json)
    } finally {
        $client.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $envPath)) {
    $databasePassword = New-DemoSecret 24
    $accessKey = 'NAV-' + (New-DemoSecret 12)
    $passphrase = 'DEMO-' + (New-DemoSecret 9)
    $sessionSecret = New-DemoSecret 32
    Write-Utf8NoBom -Path $envPath -Lines @(
        "NAVIGATOR_DB_PASSWORD=$databasePassword"
        "NAVIGATOR_DEMO_ACCESS_KEY=$accessKey"
        "NAVIGATOR_DEMO_PASSPHRASE=$passphrase"
        "NAVIGATOR_DEMO_SESSION_SECRET=$sessionSecret"
    )
    Write-Host 'Created a local-only .env file.'
}

$values = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.+)$') {
        $values[$matches[1]] = $matches[2]
    }
}

if (-not $values['NAVIGATOR_DEMO_PASSPHRASE']) {
    $passphrase = 'DEMO-' + (New-DemoSecret 9)
    $lines = @(Get-Content -LiteralPath $envPath)
    $lines += "NAVIGATOR_DEMO_PASSPHRASE=$passphrase"
    Write-Utf8NoBom -Path $envPath -Lines $lines
    $values['NAVIGATOR_DEMO_PASSPHRASE'] = $passphrase
}

if (
    -not $values['NAVIGATOR_DB_PASSWORD'] -or
    -not $values['NAVIGATOR_DEMO_ACCESS_KEY'] -or
    -not $values['NAVIGATOR_DEMO_PASSPHRASE'] -or
    -not $values['NAVIGATOR_DEMO_SESSION_SECRET']
) {
    throw 'The .env file is missing a required demo setting.'
}

$composeArgs = @(
    'compose',
    '--project-directory', $repoRoot,
    '--env-file', $envPath,
    '-f', $composePath,
    'up', '-d'
)
if (-not $NoBuild) {
    $composeArgs += '--build'
}

& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed with exit code $LASTEXITCODE."
}

$deadline = (Get-Date).AddMinutes(4)
$health = $null
do {
    Start-Sleep -Seconds 2
    try {
        $health = Get-JsonWithoutProxy 'http://127.0.0.1:3000/api/health'
        if ($health.status -eq 'ok') {
            break
        }
    } catch {
        $health = $null
    }
} while ((Get-Date) -lt $deadline)

if (-not $health -or $health.status -ne 'ok') {
    $psArgs = @(
        'compose',
        '--project-directory', $repoRoot,
        '--env-file', $envPath,
        '-f', $composePath,
        'ps'
    )
    & docker @psArgs
    throw 'The demo did not become healthy within four minutes.'
}

Write-Host ''
Write-Host 'Navigator internal demo is ready:' -ForegroundColor Green
Write-Host '  URL: http://localhost:3000'
Write-Host "  Passphrase: $($values['NAVIGATOR_DEMO_PASSPHRASE'])"
Write-Host '  Data scope: synthetic_demo / not an official conclusion'
