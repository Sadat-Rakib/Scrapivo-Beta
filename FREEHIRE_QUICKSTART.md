# FreeHire Integration - Quick Start Guide

This guide helps you get the FreeHire job aggregation system running locally in under 5 minutes.

## Prerequisites

✅ Docker Desktop installed and running  
✅ Git for Windows installed  
✅ PowerShell or Command Prompt

## Step 1: Start Docker Desktop

1. Open Docker Desktop application
2. Wait for it to show "Docker Desktop is running" in the system tray
3. Verify: Open PowerShell and run `docker version`

## Step 2: Start the Services

Open PowerShell in the Scrapivo project directory and run:

```powershell
.\start-freehire-docker.ps1
```

Or manually:

```powershell
docker-compose up -d
```

**Expected output:**
```
✓ Docker is running
Starting PostgreSQL and Meilisearch containers...
✓ Services started successfully!

Container Status:
NAME                    STATUS              PORTS
freehire-postgres       Up (healthy)        0.0.0.0:5432->5432/tcp
freehire-meilisearch    Up (healthy)        0.0.0.0:7700->7700/tcp
```

## Step 3: Verify Everything Works

Run the verification script:

```powershell
.\verify-docker-setup.ps1
```

Or manually check:

```powershell
# Check containers are running
docker-compose ps

# Check PostgreSQL
docker exec freehire-postgres pg_isready -U freehire_user -d freehire

# Check Meilisearch
curl http://localhost:7700/health
```

## Step 4: View Logs (Optional)

```powershell
# View all logs
docker-compose logs -f

# View PostgreSQL logs only
docker-compose logs -f postgres

# View Meilisearch logs only
docker-compose logs -f meilisearch
```

## Step 5: Access the Services

**PostgreSQL:**
- Host: `localhost`
- Port: `5432`
- Database: `freehire`
- Username: `freehire_user`
- Password: `freehire_password`
- Connection URL: `postgresql://freehire_user:freehire_password@localhost:5432/freehire`

**Meilisearch:**
- URL: http://localhost:7700
- Master Key: `freehire_master_key_change_in_production`
- Web UI: Open http://localhost:7700 in your browser

## Common Commands

```powershell
# Start services
docker-compose up -d

# Stop services (keeps data)
docker-compose stop

# Restart services
docker-compose restart

# Stop and remove containers (keeps data)
docker-compose down

# Stop and remove everything INCLUDING DATA
docker-compose down -v

# View container status
docker-compose ps

# View logs
docker-compose logs -f

# Execute command in PostgreSQL
docker exec -it freehire-postgres psql -U freehire_user -d freehire

# Check data volumes
docker volume ls | findstr scrapivo2
```

## Troubleshooting

### "Cannot connect to Docker daemon"
- **Solution:** Start Docker Desktop and wait for it to fully initialize

### "Port 5432 is already in use"
- **Solution:** Stop any local PostgreSQL service or change the port in `docker-compose.yml`

### "Port 7700 is already in use"
- **Solution:** Stop the conflicting service or change the port in `docker-compose.yml`

### Containers show "unhealthy"
- **Solution:** Wait 30-60 seconds for initial startup
- **Check logs:** `docker-compose logs [service-name]`

### "Cannot find freehire-external directory"
- **Solution:** The repository should be at `C:\Users\mirsa\OneDrive\Desktop\freehire-external`
- **Verify:** `Test-Path "C:\Users\mirsa\OneDrive\Desktop\freehire-external"`

## Next Steps

Once services are running and healthy:

1. ✅ Task 1.1: Docker setup complete
2. ➡️ **Task 1.2:** Initialize FreeHire database schema
3. ➡️ **Task 1.3:** Configure and verify FreeHire ingestion pipeline

## Getting Help

- View full documentation: `FREEHIRE_DOCKER_SETUP.md`
- View task completion summary: `TASK_1.1_COMPLETION_SUMMARY.md`
- Check requirements: `.kiro/specs/freehire-job-integration/requirements.md`
- Check design: `.kiro/specs/freehire-job-integration/design.md`

## FreeHire Repository Location

The FreeHire repository is cloned at:
```
C:\Users\mirsa\OneDrive\Desktop\freehire-external
```

This is separate from the Scrapivo codebase as required by the architecture.
