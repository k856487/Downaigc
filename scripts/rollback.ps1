param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$TargetCommit = ""
)

$ErrorActionPreference = "Stop"

$deployDir = Join-Path $ProjectRoot ".deploy"
$stateFile = Join-Path $deployDir "last-deploy.json"
$stopScript = Join-Path $PSScriptRoot "stop-all.ps1"
$startScript = Join-Path $PSScriptRoot "start-all.ps1"

Set-Location $ProjectRoot

if ([string]::IsNullOrWhiteSpace($TargetCommit)) {
    if (-not (Test-Path $stateFile)) {
        throw "No state file found: $stateFile. Please provide -TargetCommit explicitly."
    }
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    $TargetCommit = [string]$state.previous_commit
}

if ([string]::IsNullOrWhiteSpace($TargetCommit)) {
    throw "Target commit is empty. Rollback aborted."
}

Write-Host "Rolling back to commit: $TargetCommit" -ForegroundColor Yellow

Write-Host "Stopping old frontend/backend..." -ForegroundColor Cyan
& $stopScript

git checkout $TargetCommit | Out-Host

Write-Host "Rebuilding frontend..." -ForegroundColor Cyan
Set-Location (Join-Path $ProjectRoot "frontend")
npm install | Out-Host
npm run build | Out-Host

Write-Host "Restarting frontend/backend (preview mode)..." -ForegroundColor Cyan
& $startScript -ProjectRoot $ProjectRoot -UsePreview

Write-Host ""
Write-Host "Rollback finished. Current checkout: $TargetCommit" -ForegroundColor Green
Write-Host "Tip: run 'git checkout main' before the next deploy." -ForegroundColor DarkYellow
