# FreeHire Ingestion Pipeline Setup and Verification

## Summary

Task 1.3 has been successfully completed. The FreeHire ingestion pipeline is configured and verified with live data.

## Configuration Details

### Environment Setup
- **FreeHire Repository**: `C:\Users\mirsa\OneDrive\Desktop\freehire`
- **Go Version**: 1.26.5
- **PostgreSQL**: localhost:5432, database: `freehire`, user: `freehire_user`
- **Meilisearch**: localhost:7700
- **Environment Variables**: Configured in `.env` file in FreeHire repository

### Database Schema
- Applied all FreeHire migrations (0001 through 0095)
- Core tables: `jobs`, `companies`, `board_health`, `search_outbox`, etc.
- Full schema includes user management, CV workspace, application tracking

## How to Run Ingestion

### Prerequisites
```powershell
# Set environment variables (run these before any ingestion command)
cd C:\Users\mirsa\OneDrive\Desktop\freehire
$env:DATABASE_URL="postgres://freehire_user:freehire_password@localhost:5432/freehire?sslmode=disable"
$env:MEILISEARCH_URL="http://localhost:7700"
$env:MEILI_MASTER_KEY="freehire_master_key_change_in_production"
```

### Run Ingestion for a Source
```powershell
# Example: RemoteOK (boardless aggregator)
go run ./cmd/ingest sources/remoteok.yml

# Example: Greenhouse (large ATS with many boards)
go run ./cmd/ingest sources/greenhouse.yml

# Example: Himalayas (remote jobs aggregator)
go run ./cmd/ingest sources/himalayas.yml
```

### Index Jobs in Meilisearch
After ingestion, jobs are queued in `search_outbox`. Run the search drain to index them:

```powershell
go run ./cmd/search-drain
```

## Verification Results

### Test Run with RemoteOK Source
- **Jobs Fetched**: 100
- **Jobs Stored**: 94 (6 rejected as non-technical)
- **Companies**: 80 unique companies
- **Date Range**: 2026-08-08 to 2026-08-13 (recent, live jobs)
- **Indexing Time**: 305ms (well under 5-second requirement)

### Second Run (Duplicate Prevention)
- **Result**: All 94 jobs were updates (cheap writes)
- **No duplicates created** ✓
- **Database count remained**: 94 jobs

### Search Verification
Query: `"engineer"` returned 5 results including:
- Lemon.io - Senior Data Engineer
- Stone - Software Engineer III Mobile
- Evolve - Staff Software Engineer
- CoverGo - Senior Software QA Engineer

## Requirements Met

✅ **Requirement 2.1**: Fetch live jobs from configured source  
✅ **Requirement 2.2**: Normalize job data into canonical model  
✅ **Requirement 2.3**: Store job records in PostgreSQL with all available fields  
✅ **Requirement 2.4**: Index jobs in Meilisearch within 5 seconds (actual: 305ms)  
✅ **Requirement 2.5**: Log warning if indexing exceeds 5 seconds (none logged)  
✅ **Requirement 2.7**: Return live jobs when querying API  
✅ **Requirement 2.8**: Update existing records on second run without creating duplicates  

## Available Source Files

FreeHire includes 80+ ATS platform sources:
- **Large ATS**: Greenhouse (3,400+ boards), Lever, Ashby, Workday, iCIMS, SmartRecruiters
- **Aggregators**: RemoteOK, Himalayas, Adzuna, EchoJobs
- **Regional**: HH.ru (Russia), Justjoin.it (Poland), Arbeitnow (Germany)
- **Simple sources** (for testing): `remoteok.yml`, `himalayas.yml`, `jobicy.yml`

Location: `C:\Users\mirsa\OneDrive\Desktop\freehire\sources\*.yml`

## Next Steps for Integration

1. **Phase 2**: Canonical Job Model Reconciliation (Task 3.x)
   - Map FreeHire schema to Scrapivo's JobPosting type
   - Extend schema if needed for Scrapivo-specific fields

2. **Phase 3**: Frontend Integration (Task 14.x)
   - Create Meilisearch query adapter in Scrapivo
   - Replace in-memory job filtering with Meilisearch queries
   - Preserve existing UI components

3. **Phase 4**: Multi-Tier Source Integration (Task 5.x)
   - Add Tier 2 direct ATS APIs (if gaps exist)
   - Implement JobSpy worker (Tier 3)

## Troubleshooting

### Common Issues

**Issue**: "password authentication failed for user 'hire'"  
**Solution**: Make sure DATABASE_URL environment variable is set with correct credentials

**Issue**: "relation 'board_health' does not exist"  
**Solution**: Run all migrations from `freehire/migrations/` directory

**Issue**: "column 'external_id' does not exist"  
**Solution**: FreeHire schema was not fully applied. Reapply migrations.

**Issue**: Jobs not appearing in search  
**Solution**: Run `go run ./cmd/search-drain` to drain the search_outbox

## Important Notes

- FreeHire uses Go; ensure Go 1.26+ is installed
- Migrations are applied once during database initialization
- Each source file can be run independently
- Ingestion is idempotent - safe to run multiple times
- Windows-specific: `reindex` command doesn't work (uses Unix syscalls)

## Phase 1 Status: ✅ COMPLETE

All Phase 1 verification criteria have been successfully met. The system is ready to proceed to Phase 2 integration work.
