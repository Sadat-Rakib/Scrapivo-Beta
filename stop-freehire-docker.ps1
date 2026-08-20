# FreeHire Docker Compose Stop Script
# This script stops PostgreSQL and Meilisearch containers

Write-Host "Stopping FreeHire Docker Compose services..." -ForegroundColor Cyan
Write-Host ""

docker-compose stop

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ Services stopped successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To remove containers (but keep data): docker-compose down" -ForegroundColor Yellow
    Write-Host "To remove containers AND data: docker-compose down -v" -ForegroundColor Yellow
    Write-Host "To start again: docker-compose up -d" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "✗ Failed to stop services" -ForegroundColor Red
    exit 1
}
