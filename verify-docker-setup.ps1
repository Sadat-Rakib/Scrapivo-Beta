# FreeHire Docker Setup Verification Script
# This script verifies Docker Compose services are running correctly

Write-Host "FreeHire Docker Compose Setup Verification" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "1. Checking Docker status..." -ForegroundColor Yellow
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✓ Docker is running (version $dockerVersion)" -ForegroundColor Green
    } else {
        Write-Host "   ✗ Docker is not running" -ForegroundColor Red
        Write-Host "   Please start Docker Desktop and try again" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "   ✗ Docker is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Check if docker-compose.yml exists
Write-Host "2. Checking docker-compose.yml..." -ForegroundColor Yellow
if (Test-Path "docker-compose.yml") {
    Write-Host "   ✓ docker-compose.yml found" -ForegroundColor Green
} else {
    Write-Host "   ✗ docker-compose.yml not found" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Validate docker-compose configuration
Write-Host "3. Validating Docker Compose configuration..." -ForegroundColor Yellow
$configOutput = docker-compose config 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✓ Docker Compose configuration is valid" -ForegroundColor Green
} else {
    Write-Host "   ✗ Docker Compose configuration is invalid" -ForegroundColor Red
    Write-Host "   $configOutput" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Check if FreeHire repository exists
Write-Host "4. Checking FreeHire repository..." -ForegroundColor Yellow
$freehirePath = "..\freehire-external"
if (Test-Path $freehirePath) {
    Write-Host "   ✓ FreeHire repository found at $freehirePath" -ForegroundColor Green
    
    # Check if it's a git repository
    if (Test-Path "$freehirePath\.git") {
        Write-Host "   ✓ Valid Git repository" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ Directory exists but is not a Git repository" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ✗ FreeHire repository not found" -ForegroundColor Red
    Write-Host "   Expected location: $freehirePath" -ForegroundColor Red
    Write-Host "   Run: git clone https://github.com/strelov1/freehire.git $freehirePath" -ForegroundColor Yellow
}

Write-Host ""

# Check container status
Write-Host "5. Checking container status..." -ForegroundColor Yellow
$containers = docker-compose ps --format json 2>$null | ConvertFrom-Json

if ($null -eq $containers) {
    Write-Host "   ℹ No containers running" -ForegroundColor Cyan
    Write-Host "   Run: docker-compose up -d" -ForegroundColor Yellow
} else {
    $pgContainer = $containers | Where-Object { $_.Service -eq "postgres" }
    $msContainer = $containers | Where-Object { $_.Service -eq "meilisearch" }
    
    if ($pgContainer) {
        if ($pgContainer.State -eq "running") {
            Write-Host "   ✓ PostgreSQL container is running" -ForegroundColor Green
            
            # Check health status
            if ($pgContainer.Health -eq "healthy") {
                Write-Host "     ✓ Health check: healthy" -ForegroundColor Green
            } elseif ($pgContainer.Health -eq "starting") {
                Write-Host "     ⚠ Health check: starting (wait a moment)" -ForegroundColor Yellow
            } else {
                Write-Host "     ⚠ Health check: $($pgContainer.Health)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "   ✗ PostgreSQL container is $($pgContainer.State)" -ForegroundColor Red
        }
    } else {
        Write-Host "   ✗ PostgreSQL container not found" -ForegroundColor Red
    }
    
    if ($msContainer) {
        if ($msContainer.State -eq "running") {
            Write-Host "   ✓ Meilisearch container is running" -ForegroundColor Green
            
            # Check health status
            if ($msContainer.Health -eq "healthy") {
                Write-Host "     ✓ Health check: healthy" -ForegroundColor Green
            } elseif ($msContainer.Health -eq "starting") {
                Write-Host "     ⚠ Health check: starting (wait a moment)" -ForegroundColor Yellow
            } else {
                Write-Host "     ⚠ Health check: $($msContainer.Health)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "   ✗ Meilisearch container is $($msContainer.State)" -ForegroundColor Red
        }
    } else {
        Write-Host "   ✗ Meilisearch container not found" -ForegroundColor Red
    }
}

Write-Host ""

# Test PostgreSQL connection
Write-Host "6. Testing PostgreSQL connection..." -ForegroundColor Yellow
$pgTest = docker exec freehire-postgres pg_isready -U freehire_user -d freehire 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✓ PostgreSQL is accepting connections" -ForegroundColor Green
} else {
    Write-Host "   ✗ Cannot connect to PostgreSQL" -ForegroundColor Red
    Write-Host "   Container may still be starting, or there's a connection issue" -ForegroundColor Yellow
}

Write-Host ""

# Test Meilisearch connection
Write-Host "7. Testing Meilisearch connection..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:7700/health" -UseBasicParsing -TimeoutSec 5 2>$null
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✓ Meilisearch is responding to health checks" -ForegroundColor Green
        Write-Host "   Web UI available at: http://localhost:7700" -ForegroundColor Cyan
    } else {
        Write-Host "   ✗ Meilisearch returned status code $($response.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "   ✗ Cannot connect to Meilisearch" -ForegroundColor Red
    Write-Host "   Container may still be starting, or port 7700 is not accessible" -ForegroundColor Yellow
}

Write-Host ""

# Check volumes
Write-Host "8. Checking data volumes..." -ForegroundColor Yellow
$volumes = docker volume ls --filter "name=scrapivo2" --format "{{.Name}}" 2>$null
if ($volumes) {
    Write-Host "   ✓ Found $($volumes.Count) data volume(s):" -ForegroundColor Green
    foreach ($volume in $volumes) {
        Write-Host "     - $volume" -ForegroundColor Cyan
    }
} else {
    Write-Host "   ℹ No data volumes found yet" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Verification complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. If containers are not running: docker-compose up -d" -ForegroundColor White
Write-Host "  2. View logs: docker-compose logs -f" -ForegroundColor White
Write-Host "  3. Proceed to Task 1.2: Initialize FreeHire database schema" -ForegroundColor White
Write-Host ""
