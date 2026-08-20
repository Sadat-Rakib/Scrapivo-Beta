# FreeHire Docker Compose Startup Script
# This script starts PostgreSQL and Meilisearch containers

Write-Host "Starting FreeHire Docker Compose services..." -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "Checking Docker status..." -ForegroundColor Yellow
try {
    docker version --format '{{.Server.Version}}' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Docker is not running!" -ForegroundColor Red
        Write-Host "Please start Docker Desktop and try again." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "✗ Docker is not installed or not accessible" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Start services
Write-Host "Starting PostgreSQL and Meilisearch containers..." -ForegroundColor Yellow
docker-compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ Services started successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Waiting for health checks..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    Write-Host ""
    Write-Host "Container Status:" -ForegroundColor Cyan
    docker-compose ps
    
    Write-Host ""
    Write-Host "Connection Details:" -ForegroundColor Cyan
    Write-Host "  PostgreSQL: localhost:5432" -ForegroundColor White
    Write-Host "    Database: freehire" -ForegroundColor White
    Write-Host "    Username: freehire_user" -ForegroundColor White
    Write-Host "    Password: freehire_password" -ForegroundColor White
    Write-Host ""
    Write-Host "  Meilisearch: http://localhost:7700" -ForegroundColor White
    Write-Host "    Master Key: freehire_master_key_change_in_production" -ForegroundColor White
    Write-Host ""
    Write-Host "View logs with: docker-compose logs -f" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "✗ Failed to start services" -ForegroundColor Red
    Write-Host "Check the logs with: docker-compose logs" -ForegroundColor Yellow
    exit 1
}
