param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Branch = "main",
    [switch]$SkipPull
)

$ErrorActionPreference = "Stop"

$deployDir = Join-Path $ProjectRoot ".deploy"
$stateFile = Join-Path $deployDir "last-deploy.json"
$backendDir = Join-Path $ProjectRoot "backend"
$frontendDir = Join-Path $ProjectRoot "frontend"
$stopScript = Join-Path $PSScriptRoot "stop-all.ps1"
$startScript = Join-Path $PSScriptRoot "start-all.ps1"

if (-not (Test-Path $deployDir)) {
    New-Item -ItemType Directory -Path $deployDir | Out-Null
}

Write-Host "Project root: $ProjectRoot" -ForegroundColor Cyan
Set-Location $ProjectRoot

$beforeCommit = (git rev-parse HEAD).Trim()
Write-Host "Current commit: $beforeCommit" -ForegroundColor DarkCyan

Write-Host "Stopping old frontend/backend..." -ForegroundColor Cyan
& $stopScript

if (-not $SkipPull) {
    Write-Host "Updating repository from origin/$Branch..." -ForegroundColor Cyan
    $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($currentBranch -ne $Branch) {
        git checkout $Branch | Out-Host
    }
    git fetch origin | Out-Host
    git pull --ff-only origin $Branch | Out-Host
}

$afterCommit = (git rev-parse HEAD).Trim()
Write-Host "Deploy commit: $afterCommit" -ForegroundColor Green

Write-Host "Preparing backend venv and dependencies..." -ForegroundColor Cyan
Set-Location $backendDir
if (-not (Test-Path ".\.venv\Scripts\Activate.ps1")) {
    py -3 -m venv .venv | Out-Host
}
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt | Out-Host

Write-Host "Building frontend..." -ForegroundColor Cyan
Set-Location $frontendDir
npm install | Out-Host
npm run build | Out-Host

Write-Host "Starting frontend/backend (preview mode)..." -ForegroundColor Cyan
& $startScript -ProjectRoot $ProjectRoot -UsePreview

$state = [ordered]@{
    deployed_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    branch          = $Branch
    previous_commit = $beforeCommit
    current_commit  = $afterCommit
}
$state | ConvertTo-Json | Set-Content -Encoding UTF8 $stateFile

Write-Host ""
Write-Host "Deploy finished." -ForegroundColor Green
Write-Host "State file: $stateFile" -ForegroundColor Green
