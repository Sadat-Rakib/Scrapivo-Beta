# FreeHire Integration Setup

This document describes the Docker Compose environment for the FreeHire job aggregation integration.

## Overview

The FreeHire repository has been cloned to: `c:\Users\mirsa\OneDrive\Desktop\freehire`

This setup provides PostgreSQL and Meilisearch containers configured for Windows development.

## Services

### PostgreSQL
- **Port**: 5432
- **Database**: freehire
- **User**: freehire
- **Password**: freehire_password
- **Container Name**: freehire-postgres
- **Data Volume**: postgres_data (persistent storage)
- **Health Check**: Runs every 10 seconds to verify database readiness

### Meilisearch
- **Port**: 7700
- **Master Key**: freehire_master_key_change_in_production
- **Environment**: development
- **Container Name**: freehire-meilisearch
- **Data Volume**: meilisearch_data (persistent storage)
- **Health Check**: Runs every 10 seconds to verify API availability

## Starting the Environment

### Prerequisites
- Docker Desktop for Windows installed and **running** (check system tray for Docker icon)
- PowerShell or Command Prompt access

**IMPORTANT**: Before running any docker-compose commands, ensure Docker Desktop is started. You can verify by running:
```powershell
docker ps
```
If you see an error about the Docker daemon not running, start Docker Desktop from the Start menu.

### Commands

**Start all services:**
```powershell
docker-compose up -d
```

**Check service health:**
```powershell
docker-compose ps
```

**View logs:**
```powershell
# All services
docker-compose logs -f

# PostgreSQL only
docker-compose logs -f postgres

# Meilisearch only
docker-compose logs -f meilisearch
```

**Stop services:**
```powershell
docker-compose down
```

**Stop services and remove volumes (WARNING: This deletes all data):**
```powershell
docker-compose down -v
```

## Testing Connectivity

### PostgreSQL
```powershell
# Using psql (if installed)
psql -h localhost -p 5432 -U freehire -d freehire

# Or using Docker exec
docker exec -it freehire-postgres psql -U freehire -d freehire
```

### Meilisearch
```powershell
# Health check
curl http://localhost:7700/health

# Get version info
curl -H "Authorization: Bearer freehire_master_key_change_in_production" http://localhost:7700/version
```

## Environment Variables

Connection details for application configuration:

```env
# PostgreSQL
DATABASE_URL=postgresql://freehire:freehire_password@localhost:5432/freehire
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=freehire
POSTGRES_PASSWORD=freehire_password
POSTGRES_DB=freehire

# Meilisearch
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_MASTER_KEY=freehire_master_key_change_in_production
```

## Troubleshooting

### Port 5432 already in use
If PostgreSQL port is already occupied:
1. Check for other PostgreSQL instances: `Get-Process -Name postgres`
2. Stop conflicting services or change the port in docker-compose.yml

### Port 7700 already in use
If Meilisearch port is already occupied:
1. Check running processes on port 7700: `netstat -ano | findstr :7700`
2. Stop conflicting services or change the port in docker-compose.yml

### Health checks failing
1. Wait 10-30 seconds after starting for services to initialize
2. Check logs: `docker-compose logs`
3. Verify Docker Desktop has sufficient resources allocated

### Volume permissions issues
If you encounter permission errors:
1. Ensure Docker Desktop has access to the drive
2. Check Docker Desktop Settings > Resources > File Sharing

## Next Steps

1. Verify Docker Compose starts successfully (Task 1.1) ✓
2. Explore FreeHire repository structure
3. Run FreeHire ingestion pipeline to verify data flow (Task 1.2)
4. Verify jobs are stored in PostgreSQL and indexed in Meilisearch (Task 1.3)
