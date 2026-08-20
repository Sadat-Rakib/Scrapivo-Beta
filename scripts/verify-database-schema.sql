-- FreeHire Database Schema Verification Script
-- This script verifies that all required tables, indexes, and constraints exist
-- Task 1.2: Initialize FreeHire database schema

-- Verify tables exist
SELECT 
    tablename,
    schemaname
FROM pg_tables 
WHERE schemaname = 'public' 
    AND tablename IN ('jobs', 'companies', 'ingestion_runs')
ORDER BY tablename;

-- Verify jobs table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'jobs' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verify required indexes on jobs table
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'jobs' 
    AND schemaname = 'public'
    AND (
        indexname LIKE '%dedupe_id%' OR
        indexname LIKE '%is_active%' OR
        indexname LIKE '%posted_at%' OR
        indexname LIKE '%company_domain%'
    )
ORDER BY indexname;

-- Verify companies table structure
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'companies' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verify ingestion_runs table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'ingestion_runs' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verify foreign key constraints
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name = 'jobs';

-- Test basic insert and query operations
-- Insert test company
INSERT INTO companies (name, domain, ats_type)
VALUES ('Test Company', 'test.com', 'greenhouse')
ON CONFLICT (domain) DO NOTHING
RETURNING id, name, domain;

-- Insert test job
WITH test_company AS (
    SELECT id FROM companies WHERE domain = 'test.com' LIMIT 1
)
INSERT INTO jobs (
    source,
    sources,
    source_job_id,
    dedupe_id,
    company_id,
    company_name,
    company_domain,
    title,
    url,
    is_active
)
SELECT
    'test',
    ARRAY['test']::varchar[],
    'test-job-001',
    encode(sha256('test.com|software engineer|remote'::bytea), 'hex'),
    tc.id,
    'Test Company',
    'test.com',
    'Software Engineer',
    'https://test.com/jobs/001',
    true
FROM test_company tc
ON CONFLICT (source, source_job_id) DO NOTHING
RETURNING id, title, company_name, dedupe_id;

-- Verify test job was inserted
SELECT 
    id,
    source,
    title,
    company_name,
    company_domain,
    dedupe_id,
    is_active,
    created_at
FROM jobs
WHERE source = 'test'
LIMIT 1;

-- Verify indexes are being used
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM jobs 
WHERE dedupe_id = encode(sha256('test.com|software engineer|remote'::bytea), 'hex');

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM jobs 
WHERE is_active = true
LIMIT 10;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM jobs 
WHERE company_domain = 'test.com';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM jobs 
ORDER BY posted_at DESC NULLS LAST
LIMIT 10;

-- Clean up test data
DELETE FROM jobs WHERE source = 'test';
DELETE FROM companies WHERE domain = 'test.com';

-- Final verification counts
SELECT 'jobs' as table_name, COUNT(*) as row_count FROM jobs
UNION ALL
SELECT 'companies', COUNT(*) FROM companies
UNION ALL
SELECT 'ingestion_runs', COUNT(*) FROM ingestion_runs;
