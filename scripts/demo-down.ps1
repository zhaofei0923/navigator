[CmdletBinding()]
param(
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$composePath = Join-Path $repoRoot 'compose.yaml'
$composeArgs = @(
    'compose',
    '--project-directory', $repoRoot,
    '--env-file', $envPath,
    '-f', $composePath,
    'down'
)
if ($RemoveData) {
    $composeArgs += '--volumes'
}

& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw "docker compose down failed with exit code $LASTEXITCODE."
}
