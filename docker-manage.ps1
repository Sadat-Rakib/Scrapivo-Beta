# FreeHire Docker Compose Management Script
# This script helps manage the PostgreSQL and Meilisearch containers for FreeHire integration

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'clean', 'test')]
    [string]$Action = 'status'
)

$ErrorActionPreference = "Continue"

function Test-DockerRunning {
    try {
        docker ps | Out-Null
        return $true
    }
    catch {
        Write-Host "❌ Docker Desktop is not running!" -ForegroundColor Red
        Write-Host "Please start Docker Desktop and try again." -ForegroundColor Yellow
        return $false
    }
}

function Start-Services {
    Write-Host "🚀 Starting FreeHire services..." -ForegroundColor Cyan
    docker-compose up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services started successfully!" -ForegroundColor Green
        Start-Sleep -Seconds 5
        Show-Status
    }
    else {
        Write-Host "❌ Failed to start services." -ForegroundColor Red
    }
}

function Stop-Services {
    Write-Host "🛑 Stopping FreeHire services..." -ForegroundColor Cyan
    docker-compose down
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services stopped successfully!" -ForegroundColor Green
    }
    else {
        Write-Host "❌ Failed to stop services." -ForegroundColor Red
    }
}

function Restart-Services {
    Write-Host "🔄 Restarting FreeHire services..." -ForegroundColor Cyan
    docker-compose restart
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services restarted successfully!" -ForegroundColor Green
        Start-Sleep -Seconds 5
        Show-Status
    }
    else {
        Write-Host "❌ Failed to restart services." -ForegroundColor Red
    }
}

function Show-Status {
    Write-Host "`n📊 Service Status:" -ForegroundColor Cyan
    docker-compose ps
    
    Write-Host "`n🏥 Health Checks:" -ForegroundColor Cyan
    
    # Check PostgreSQL
    $pgHealth = docker inspect --format='{{.State.Health.Status}}' freehire-postgres 2>$null
    if ($pgHealth -eq "healthy") {
        Write-Host "  PostgreSQL: ✅ Healthy" -ForegroundColor Green
    }
    elseif ($pgHealth -eq "starting") {
        Write-Host "  PostgreSQL: ⏳ Starting..." -ForegroundColor Yellow
    }
    else {
        Write-Host "  PostgreSQL: ❌ Unhealthy or not running" -ForegroundColor Red
    }
    
    # Check Meilisearch
    $msHealth = docker inspect --format='{{.State.Health.Status}}' freehire-meilisearch 2>$null
    if ($msHealth -eq "healthy") {
        Write-Host "  Meilisearch: ✅ Healthy" -ForegroundColor Green
    }
    elseif ($msHealth -eq "starting") {
        Write-Host "  Meilisearch: ⏳ Starting..." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Meilisearch: ❌ Unhealthy or not running" -ForegroundColor Red
    }
}

function Show-Logs {
    Write-Host "📋 Container Logs (press Ctrl+C to exit):" -ForegroundColor Cyan
    docker-compose logs -f
}

function Clean-All {
    Write-Host "⚠️  WARNING: This will remove all containers and volumes (ALL DATA WILL BE LOST)!" -ForegroundColor Red
    $confirm = Read-Host "Type 'YES' to confirm"
    
    if ($confirm -eq 'YES') {
        Write-Host "🧹 Cleaning up services and volumes..." -ForegroundColor Cyan
        docker-compose down -v
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Cleanup completed!" -ForegroundColor Green
        }
        else {
            Write-Host "❌ Cleanup failed." -ForegroundColor Red
        }
    }
    else {
        Write-Host "❌ Cleanup cancelled." -ForegroundColor Yellow
    }
}

function Test-Connectivity {
    Write-Host "🔍 Testing service connectivity..." -ForegroundColor Cyan
    
    # Test PostgreSQL
    Write-Host "`n  Testing PostgreSQL..." -ForegroundColor Yellow
    $pgTest = docker exec freehire-postgres pg_isready -U freehire -d freehire 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ PostgreSQL: Connected successfully" -ForegroundColor Green
        Write-Host "  Connection: postgresql://freehire:***@localhost:5432/freehire" -ForegroundColor Gray
    }
    else {
        Write-Host "  ❌ PostgreSQL: Connection failed" -ForegroundColor Red
    }
    
    # Test Meilisearch
    Write-Host "`n  Testing Meilisearch..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:7700/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host "  ✅ Meilisearch: API responding" -ForegroundColor Green
            Write-Host "  API URL: http://localhost:7700" -ForegroundColor Gray
        }
        else {
            Write-Host "  ❌ Meilisearch: API not responding" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  ❌ Meilisearch: Connection failed" -ForegroundColor Red
    }
}

# Main script execution
Write-Host "FreeHire Docker Compose Manager" -ForegroundColor Magenta
Write-Host "================================`n" -ForegroundColor Magenta

if (-not (Test-DockerRunning)) {
    exit 1
}

switch ($Action) {
    'start' { Start-Services }
    'stop' { Stop-Services }
    'restart' { Restart-Services }
    'status' { Show-Status }
    'logs' { Show-Logs }
    'clean' { Clean-All }
    'test' { 
        Show-Status
        Test-Connectivity
    }
    default { Show-Status }
}
