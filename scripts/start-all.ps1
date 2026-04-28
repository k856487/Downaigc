param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$BackendHost = "0.0.0.0",
    [int]$BackendPort = 8000,
    [string]$FrontendHost = "0.0.0.0",
    [int]$FrontendPort = 5173,
    [switch]$UsePreview
)

$ErrorActionPreference = "Stop"

$backendPath = Join-Path $ProjectRoot "backend"
$frontendPath = Join-Path $ProjectRoot "frontend"

if (-not (Test-Path $backendPath)) {
    throw "Backend directory not found: $backendPath"
}
if (-not (Test-Path $frontendPath)) {
    throw "Frontend directory not found: $frontendPath"
}

$backendCmd = @"
Set-Location '$backendPath'
if (-not (Test-Path '.\.venv\Scripts\Activate.ps1')) {
    Write-Host 'Missing backend venv: .\.venv\Scripts\Activate.ps1' -ForegroundColor Red
    Write-Host 'Please run: py -3 -m venv .venv ; pip install -r requirements.txt' -ForegroundColor Yellow
    pause
    exit 1
}
. '.\.venv\Scripts\Activate.ps1'
uvicorn main:app --host $BackendHost --port $BackendPort
"@

if ($UsePreview) {
    $frontendCmd = @"
Set-Location '$frontendPath'
npm install
npm run build
npm run preview -- --host $FrontendHost --port $FrontendPort
"@
} else {
    $frontendCmd = @"
Set-Location '$frontendPath'
npm install
npm run dev -- --host $FrontendHost --port $FrontendPort
"@
}

Write-Host "Starting backend on $BackendHost`:$BackendPort ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCmd | Out-Null

Write-Host "Starting frontend on $FrontendHost`:$FrontendPort ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCmd | Out-Null

Write-Host ""
Write-Host "Done. Two new PowerShell windows were opened." -ForegroundColor Green
Write-Host "Frontend URL: http://127.0.0.1:$FrontendPort" -ForegroundColor Green
Write-Host "Backend URL : http://127.0.0.1:$BackendPort/docs" -ForegroundColor Green
