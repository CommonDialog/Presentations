foreach ($port in @(3001, 5173)) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        if ($conn.OwningProcess -and $conn.OwningProcess -gt 0) {
            Write-Host "Stopping process $($conn.OwningProcess) on port $port..." -ForegroundColor Yellow
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*AICRM*" -and $_.ProcessId -ne $PID }
foreach ($p in $procs) {
    Write-Host "Stopping AICRM process $($p.ProcessId) ($($p.Name))..." -ForegroundColor Yellow
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "All AICRM processes stopped." -ForegroundColor Green
