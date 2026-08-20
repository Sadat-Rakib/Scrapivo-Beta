# FreeHire Docker Compose Setup Guide

This document provides instructions for setting up and running the FreeHire job aggregation system's infrastructure using Docker Compose on Windows.

## Overview

The Docker Compose configuration provides:
- **PostgreSQL 16** - Source of truth for all job data (port 5432)
- **Meilisearch v1.10** - Fast search index for job queries (port 7700)

## Prerequisites

- Docker Desktop for Windows installed and running
- Git for Windows (to clone FreeHire repository)
- PowerShell or Command Prompt

## Repository Setup

The FreeHire repository has been cloned to:
```
C:\Users\mirsa\OneDrive\Desktop\freehire-external
```

This is separate from the Scrapivo codebase as required by the architecture.

## Starting the Services

### 1. Start Docker Compose

From the Scrapivo project directory, run:

```powershell
docker-compose up -d
```

This will:
- Download PostgreSQL and Meilisearch Docker images (first time only)
- Create persistent volumes for data storage
- Start both containers in detached mode
- Run health checks to verify services are ready

### 2. Verify Services are Running

Check container status:
```powershell
docker-compose ps
```

Expected output:
```
NAME                    STATUS              PORTS
freehire-postgres       Up (healthy)        0.0.0.0:5432->5432/tcp
freehire-meilisearch    Up (healthy)        0.0.0.0:7700->7700/tcp
```

### 3. Check Logs

View logs for both services:
```powershell
docker-compose logs -f
```

View logs for specific service:
```powershell
docker-compose logs -f postgres
docker-compose logs -f meilisearch
```

## Health Checks

Both services include health checks that verify they're ready to accept connections:

**PostgreSQL Health Check:**
- Command: `pg_isready -U freehire_user -d freehire`
- Interval: Every 10 seconds
- Retries: 5 attempts before marking unhealthy

**Meilisearch Health Check:**
- Command: HTTP GET to `/health` endpoint
- Interval: Every 10 seconds
- Retries: 5 attempts before marking unhealthy

## Connection Details

### PostgreSQL

- **Host:** localhost
- **Port:** 5432
- **Database:** freehire
- **Username:** freehire_user
- **Password:** freehire_password
- **Connection URL:** `postgresql://freehire_user:freehire_password@localhost:5432/freehire`

### Meilisearch

- **Host:** localhost
- **Port:** 7700
- **Master Key:** freehire_master_key_change_in_production
- **URL:** http://localhost:7700
- **Web UI:** http://localhost:7700 (accessible in browser)

## Testing Connections

### Test PostgreSQL Connection

Using psql:
```powershell
docker exec -it freehire-postgres psql -U freehire_user -d freehire -c "SELECT version();"
```

### Test Meilisearch Connection

Using curl (PowerShell):
```powershell
curl http://localhost:7700/health
```

Or open in browser: http://localhost:7700

## Data Persistence

Data is persisted in Docker volumes:

- **postgres_data** - PostgreSQL database files
- **meilisearch_data** - Meilisearch index files

Volumes persist even when containers are stopped or removed.

### View Volume Information

```powershell
docker volume ls
docker volume inspect scrapivo-2_postgres_data
docker volume inspect scrapivo-2_meilisearch_data
```

## Managing Services

### Stop Services

```powershell
docker-compose stop
```

### Start Stopped Services

```powershell
docker-compose start
```

### Restart Services

```powershell
docker-compose restart
```

### Stop and Remove Containers

```powershell
docker-compose down
```

**Note:** This preserves data volumes. To also remove volumes:

```powershell
docker-compose down -v
```

## Troubleshooting

### Port 5432 Already in Use

If PostgreSQL fails to start with "port is already allocated":

1. Check if PostgreSQL is already running locally:
   ```powershell
   Get-Process postgres -ErrorAction SilentlyContinue
   ```

2. Stop local PostgreSQL service or change the port in docker-compose.yml

### Port 7700 Already in Use

If Meilisearch fails to start:

1. Check what's using the port:
   ```powershell
   netstat -ano | findstr :7700
   ```

2. Stop the conflicting service or change the port in docker-compose.yml

### Health Check Failing

If a service shows "unhealthy":

1. Check logs: `docker-compose logs [service-name]`
2. Verify the service is actually starting (not crashing)
3. Wait for initial startup (can take 30-60 seconds on first run)

### Cannot Connect from Application

1. Verify containers are running: `docker-compose ps`
2. Check health status shows "healthy"
3. Verify firewall isn't blocking localhost connections
4. Try connecting from container network: `docker exec -it freehire-postgres psql -U freehire_user -d freehire`

### Data Volume Issues on Windows

If you encounter permission errors:

1. Ensure Docker Desktop has file sharing enabled for your drive
2. Try running Docker Desktop as administrator
3. Check Docker Desktop settings → Resources → File Sharing

## Windows-Specific Notes

1. **Line Endings:** Docker Compose YAML uses LF line endings. Git should handle this automatically.

2. **Paths:** Volume paths use Docker's internal paths (`/var/lib/postgresql/data`, `/meili_data`). Docker handles Windows path translation.

3. **Named Volumes:** We use named volumes (not bind mounts) for cross-platform compatibility.

4. **PowerShell Commands:** All commands work in PowerShell. For Command Prompt, use `^` instead of `` ` `` for line continuation.

## Next Steps

After verifying both services are healthy:

1. Initialize the PostgreSQL database schema (see FreeHire repository)
2. Configure FreeHire ingestion pipeline to use these services
3. Run a test ingestion to verify jobs flow from source → PostgreSQL → Meilisearch
4. Proceed to Task 1.2: Initialize FreeHire database schema

## Security Notes

**FOR DEVELOPMENT ONLY:**

The default credentials and keys in this configuration are **NOT SECURE** and should only be used for local development.

For production deployment:
- Change all passwords and keys
- Use environment variables or secrets management
- Enable SSL/TLS for PostgreSQL
- Configure Meilisearch for production mode
- Restrict network access using firewall rules
- Use Docker Compose override files for environment-specific configuration

## References

- [PostgreSQL Docker Hub](https://hub.docker.com/_/postgres)
- [Meilisearch Docker Documentation](https://www.meilisearch.com/docs/learn/cookbooks/docker)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [FreeHire Repository](https://github.com/strelov1/freehire)
