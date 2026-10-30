$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $rootDir "server"
$clientDir = Join-Path $rootDir "client"

foreach ($port in @(3001, 5173)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        if ($conn.OwningProcess -and $conn.OwningProcess -gt 0) {
            Write-Host "Stopping existing process $($conn.OwningProcess) on port $port..." -ForegroundColor Yellow
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "Starting AICRM Backend Server in a new window..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'AICRM Backend (Port 3001)'; Set-Location '$serverDir'; npm run dev"
)

Write-Host "Starting AICRM Frontend Client in a new window..." -ForegroundColor Magenta
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'AICRM Frontend (Port 5173)'; Set-Location '$clientDir'; npm run dev"
)

Write-Host "Both windows launched!" -ForegroundColor Green
Write-Host "  Backend API : http://localhost:3001"
Write-Host "  Frontend UI : http://localhost:5173"
Write-Host "  Server Logs : $(Join-Path $rootDir 'logs\server.log')"
