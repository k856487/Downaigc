param(
    [int[]]$Ports = @(5173, 8000)
)

$ErrorActionPreference = "Stop"

$killedPids = New-Object System.Collections.Generic.HashSet[int]

foreach ($port in $Ports) {
    $matches = netstat -ano -p tcp | Select-String -Pattern "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    if (-not $matches) {
        Write-Host "No LISTENING process found on port $port." -ForegroundColor Yellow
        continue
    }

    foreach ($m in $matches) {
        $pid = [int]$m.Matches[0].Groups[1].Value
        if ($killedPids.Contains($pid)) {
            continue
        }
        try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            $killedPids.Add($pid) | Out-Null
            Write-Host "Stopped PID $pid on port $port." -ForegroundColor Green
        } catch {
            Write-Host "Failed to stop PID $pid on port $port: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}
