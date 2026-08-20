-- FreeHire Job Aggregation Schema
-- This migration creates the database schema for the FreeHire job integration
-- Requirements: 1.5, 3.2

-- =========================================================================
-- 1. Companies Table
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(500) NOT NULL,
    domain VARCHAR(255) UNIQUE,
    ats_type VARCHAR(50), -- greenhouse, lever, ashby, workday, smartrecruiters, etc.
    ats_board_id VARCHAR(255), -- Company identifier for ATS API
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_domain ON public.companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_ats_type ON public.companies(ats_type);

-- =========================================================================
-- 2. Jobs Table (Source of Truth)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Source information
    source VARCHAR(100) NOT NULL, -- Primary source that created this record
    sources VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR[], -- All contributing sources
    source_job_id VARCHAR(255) NOT NULL, -- Original ID from source
    dedupe_id VARCHAR(64) NOT NULL, -- SHA256(company_domain + normalized_title + normalized_location)
    
    -- Company information
    company_id UUID REFERENCES public.companies(id),
    company_name VARCHAR(500) NOT NULL,
    company_domain VARCHAR(255), -- For deduplication
    company_type VARCHAR(50), -- startup, scaleup, enterprise, agency
    
    -- Job details
    title VARCHAR(500) NOT NULL,
    description TEXT,
    url VARCHAR(1000) NOT NULL,
    
    -- Location
    location VARCHAR(500),
    cities VARCHAR(255)[],
    countries VARCHAR(100)[],
    regions VARCHAR(100)[],
    work_mode VARCHAR(50), -- remote, hybrid, onsite
    relocation BOOLEAN,
    
    -- Classification
    role VARCHAR(100), -- engineer, designer, product, sales, etc.
    category VARCHAR(100), -- backend, frontend, devops, data, etc.
    seniority VARCHAR(50), -- entry, mid, senior, staff, principal, executive
    employment_type VARCHAR(50), -- full_time, part_time, contract, internship
    
    -- Skills and domains
    skills VARCHAR(100)[],
    domains VARCHAR(100)[],
    
    -- Requirements
    english_level VARCHAR(50), -- native, fluent, professional, conversational
    
    -- Compensation
    salary_min INTEGER,
    salary_max INTEGER,
    salary_currency VARCHAR(10),
    
    -- Timestamps
    posted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Constraints
    UNIQUE(source, source_job_id)
);

-- Indexes for performance and deduplication
CREATE INDEX IF NOT EXISTS idx_jobs_dedupe_id ON public.jobs(dedupe_id);
CREATE INDEX IF NOT EXISTS idx_jobs_is_active ON public.jobs(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON public.jobs(posted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_jobs_company_domain ON public.jobs(company_domain);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON public.jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_work_mode ON public.jobs(work_mode) WHERE work_mode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_seniority ON public.jobs(seniority) WHERE seniority IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON public.jobs(company_id);

-- GIN indexes for array fields
CREATE INDEX IF NOT EXISTS idx_jobs_skills ON public.jobs USING GIN(skills);
CREATE INDEX IF NOT EXISTS idx_jobs_domains ON public.jobs USING GIN(domains);
CREATE INDEX IF NOT EXISTS idx_jobs_cities ON public.jobs USING GIN(cities);
CREATE INDEX IF NOT EXISTS idx_jobs_countries ON public.jobs USING GIN(countries);

-- =========================================================================
-- 3. Ingestion Runs Table (Observability)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(100) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Metrics
    jobs_seen INTEGER DEFAULT 0, -- Total fetched from source
    jobs_created INTEGER DEFAULT 0, -- New records inserted
    jobs_updated INTEGER DEFAULT 0, -- Existing records modified
    jobs_deactivated INTEGER DEFAULT 0, -- Marked inactive
    jobs_failed INTEGER DEFAULT 0, -- Processing errors
    
    -- Error tracking
    errors JSONB, -- Array of error objects with messages and stack traces
    status VARCHAR(50) DEFAULT 'running', -- running, completed, failed
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON public.ingestion_runs(source);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started_at ON public.ingestion_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON public.ingestion_runs(status);

-- =========================================================================
-- 4. Row Level Security (RLS)
-- =========================================================================

-- Companies: Read-only for authenticated users
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select_auth" ON public.companies;
CREATE POLICY "companies_select_auth" ON public.companies
    FOR SELECT TO authenticated USING (TRUE);

-- Jobs: Read-only for authenticated users
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_select_auth" ON public.jobs;
CREATE POLICY "jobs_select_auth" ON public.jobs
    FOR SELECT TO authenticated USING (TRUE);

-- Ingestion Runs: Admin-only (can be adjusted based on app requirements)
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ingestion_runs_select_auth" ON public.ingestion_runs;
CREATE POLICY "ingestion_runs_select_auth" ON public.ingestion_runs
    FOR SELECT TO authenticated USING (TRUE);

-- =========================================================================
-- 5. Grants
-- =========================================================================

GRANT SELECT ON public.companies TO authenticated;
GRANT SELECT ON public.jobs TO authenticated;
GRANT SELECT ON public.ingestion_runs TO authenticated;

GRANT ALL ON public.companies TO service_role;
GRANT ALL ON public.jobs TO service_role;
GRANT ALL ON public.ingestion_runs TO service_role;

-- =========================================================================
-- 6. Functions and Triggers
-- =========================================================================

-- Update updated_at timestamp on companies
DROP TRIGGER IF EXISTS companies_touch_updated_at ON public.companies;
CREATE TRIGGER companies_touch_updated_at
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Update updated_at timestamp on jobs
DROP TRIGGER IF EXISTS jobs_touch_updated_at ON public.jobs;
CREATE TRIGGER jobs_touch_updated_at
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================================
-- 7. Comments for documentation
-- =========================================================================

COMMENT ON TABLE public.companies IS 'Company registry for job aggregation';
COMMENT ON TABLE public.jobs IS 'Canonical job postings aggregated from multiple sources';
COMMENT ON TABLE public.ingestion_runs IS 'Ingestion pipeline observability and metrics';

COMMENT ON COLUMN public.jobs.dedupe_id IS 'Deterministic hash for deduplication: SHA256(company_domain + normalized_title + normalized_location)';
COMMENT ON COLUMN public.jobs.sources IS 'Array of all sources that contributed to this job record (for merged duplicates)';
COMMENT ON COLUMN public.jobs.source IS 'Primary source that initially created this job record';
COMMENT ON COLUMN public.jobs.is_active IS 'Whether the job is currently active/available';

COMMENT ON COLUMN public.ingestion_runs.jobs_seen IS 'Total jobs fetched from source during this run';
COMMENT ON COLUMN public.ingestion_runs.jobs_created IS 'New job records inserted during this run';
COMMENT ON COLUMN public.ingestion_runs.jobs_updated IS 'Existing job records updated during this run';
COMMENT ON COLUMN public.ingestion_runs.jobs_deactivated IS 'Job records marked inactive during this run';
COMMENT ON COLUMN public.ingestion_runs.jobs_failed IS 'Job records that encountered errors during this run';
