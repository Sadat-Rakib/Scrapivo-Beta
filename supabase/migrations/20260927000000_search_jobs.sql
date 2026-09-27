-- Durable Search Job engine (Workstream 1) — the spine of the product.
--
-- search_jobs is the durable unit of search work: a frozen SearchSpec plus
-- target/budgets, driven by a lease-owning engine that widens the candidate
-- pool pass by pass until TARGET_REACHED / COVERAGE_EXHAUSTED / BUDGET_EXHAUSTED
-- / USER_STOPPED / FAILED. Child tables persist per-job state so any worker can
-- resume exactly where the last one stopped:
--   * search_job_candidates — dedupe key per job, lifecycle state machine.
--   * search_job_queries    — every attempted query variant (hash-deduped).
--   * search_job_sources    — per-source cursor/exhaustion so passes resume.
--
-- Ownership: RLS with user_id = auth.uid() on search_jobs; child tables carry
-- no user_id (frozen design) so their policies join through search_jobs.
-- Engine access is service-side only (SECURITY DEFINER RPCs bypass RLS);
-- user-facing reads/writes stay RLS-scoped.
--
-- Atomic claim: claim_search_job() is a single-statement UPDATE ... FROM
-- (SELECT ... FOR UPDATE SKIP LOCKED) so concurrent workers can never grab
-- the same job. Watch idempotency: partial UNIQUE (watch_id, scheduled_for)
-- makes scheduled enqueue safe to retry.

-- =========================================================================
-- 1. search_jobs
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.search_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL,
  project_id              UUID,          -- NO FK: projects table arrives later
  watch_id                UUID,
  scheduled_for           TIMESTAMPTZ,
  spec                    JSONB NOT NULL,
  target                  INT NOT NULL DEFAULT 10,
  mode                    TEXT NOT NULL DEFAULT 'job'
                          CHECK (mode IN ('interactive','batch','job','watch')),
  status                  TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','running','paused','stopped','completed','failed')),
  completion_reason       TEXT
                          CHECK (completion_reason IN ('TARGET_REACHED','COVERAGE_EXHAUSTED','BUDGET_EXHAUSTED','USER_STOPPED','FAILED')),
  discovered_count        INT NOT NULL DEFAULT 0,
  researched_count        INT NOT NULL DEFAULT 0,
  qualified_count         INT NOT NULL DEFAULT 0,
  current_pass            INT NOT NULL DEFAULT 0,
  budgets                 JSONB NOT NULL DEFAULT '{}',
  project_context_version INT,
  context_snapshot        JSONB,
  lease_owner             TEXT,
  lease_expires_at        TIMESTAMPTZ,
  heartbeat_at            TIMESTAMPTZ,
  pause_requested_at      TIMESTAMPTZ,
  stop_requested_at       TIMESTAMPTZ,
  error                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Watch idempotency: the same (watch, schedule slot) can only ever enqueue once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_jobs_watch_sched
  ON public.search_jobs (watch_id, scheduled_for)
  WHERE watch_id IS NOT NULL AND scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_jobs_user_created
  ON public.search_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_jobs_active_status
  ON public.search_jobs (status)
  WHERE status IN ('queued','running');
-- Plain index: project_id gets its FK in a later workstream.
CREATE INDEX IF NOT EXISTS idx_search_jobs_project
  ON public.search_jobs (project_id)
  WHERE project_id IS NOT NULL;

-- =========================================================================
-- 2. search_job_candidates
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.search_job_candidates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES public.search_jobs(id) ON DELETE CASCADE,
  candidate_key TEXT NOT NULL,
  entity_id     TEXT,
  state         TEXT NOT NULL DEFAULT 'DISCOVERED',
  priority      INT NOT NULL DEFAULT 0,
  attempts      INT NOT NULL DEFAULT 0,
  data          JSONB NOT NULL DEFAULT '{}',
  discovered_at TIMESTAMPTZ,
  researched_at TIMESTAMPTZ,
  qualified_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sjc_job_key
  ON public.search_job_candidates (job_id, candidate_key);
CREATE INDEX IF NOT EXISTS idx_sjc_job_state
  ON public.search_job_candidates (job_id, state);

-- =========================================================================
-- 3. search_job_queries
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.search_job_queries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES public.search_jobs(id) ON DELETE CASCADE,
  query_hash    TEXT NOT NULL,
  query         TEXT NOT NULL,
  source_family TEXT,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  result_count  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sjq_job_hash
  ON public.search_job_queries (job_id, query_hash);

-- =========================================================================
-- 4. search_job_sources
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.search_job_sources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID NOT NULL REFERENCES public.search_jobs(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  cursor     JSONB NOT NULL DEFAULT '{}',
  status     TEXT,
  exhausted  BOOLEAN NOT NULL DEFAULT false,
  metrics    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sjs_job_source
  ON public.search_job_sources (job_id, source);

-- =========================================================================
-- 5. Grants + RLS (repo convention: projects.sql pattern)
-- =========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_job_candidates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_job_queries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_job_sources TO authenticated;
GRANT ALL ON public.search_jobs TO service_role;
GRANT ALL ON public.search_job_candidates TO service_role;
GRANT ALL ON public.search_job_queries TO service_role;
GRANT ALL ON public.search_job_sources TO service_role;

ALTER TABLE public.search_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_job_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_job_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_job_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "search_jobs_select_own" ON public.search_jobs;
CREATE POLICY "search_jobs_select_own" ON public.search_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "search_jobs_insert_own" ON public.search_jobs;
CREATE POLICY "search_jobs_insert_own" ON public.search_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "search_jobs_update_own" ON public.search_jobs;
CREATE POLICY "search_jobs_update_own" ON public.search_jobs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "search_jobs_delete_own" ON public.search_jobs
;
CREATE POLICY "search_jobs_delete_own" ON public.search_jobs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Child tables carry no user_id (frozen design) — ownership via parent join.
DROP POLICY IF EXISTS "search_job_candidates_select_own" ON public.search_job_candidates;
CREATE POLICY "search_job_candidates_select_own" ON public.search_job_candidates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_candidates_insert_own" ON public.search_job_candidates;
CREATE POLICY "search_job_candidates_insert_own" ON public.search_job_candidates
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_candidates_update_own" ON public.search_job_candidates;
CREATE POLICY "search_job_candidates_update_own" ON public.search_job_candidates
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_candidates_delete_own" ON public.search_job_candidates;
CREATE POLICY "search_job_candidates_delete_own" ON public.search_job_candidates
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));

DROP POLICY IF EXISTS "search_job_queries_select_own" ON public.search_job_queries;
CREATE POLICY "search_job_queries_select_own" ON public.search_job_queries
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_queries_insert_own" ON public.search_job_queries;
CREATE POLICY "search_job_queries_insert_own" ON public.search_job_queries
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_queries_update_own" ON public.search_job_queries;
CREATE POLICY "search_job_queries_update_own" ON public.search_job_queries
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_queries_delete_own" ON public.search_job_queries;
CREATE POLICY "search_job_queries_delete_own" ON public.search_job_queries
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));

DROP POLICY IF EXISTS "search_job_sources_select_own" ON public.search_job_sources;
CREATE POLICY "search_job_sources_select_own" ON public.search_job_sources
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_sources_insert_own" ON public.search_job_sources;
CREATE POLICY "search_job_sources_insert_own" ON public.search_job_sources
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_sources_update_own" ON public.search_job_sources;
CREATE POLICY "search_job_sources_update_own" ON public.search_job_sources
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "search_job_sources_delete_own" ON public.search_job_sources;
CREATE POLICY "search_job_sources_delete_own" ON public.search_job_sources
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.search_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));

-- =========================================================================
-- 6. Lease RPCs (SECURITY DEFINER, engine is server-side only)
-- =========================================================================

-- Atomically claim one claimable job (queued/running with expired-or-absent
-- lease). Single statement: FOR UPDATE SKIP LOCKED means concurrent workers
-- never double-claim. Zero rows returned = nothing claimable.
CREATE OR REPLACE FUNCTION public.claim_search_job(p_owner TEXT, p_lease_seconds INT DEFAULT 300)
RETURNS SETOF public.search_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.search_jobs AS j
  SET status           = 'running',
      lease_owner      = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at     = now(),
      updated_at       = now()
  FROM (
    SELECT id
    FROM public.search_jobs
    WHERE status IN ('queued','running')
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ) AS eligible
  WHERE j.id = eligible.id
  RETURNING j.*;
$$;

-- Extend the lease ONLY when the caller still owns it and it has not expired.
-- Returns whether the heartbeat landed (false = ownership lost).
CREATE OR REPLACE FUNCTION public.heartbeat_search_job(p_job_id UUID, p_owner TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.search_jobs
    SET lease_expires_at = now() + interval '300 seconds',
        heartbeat_at     = now(),
        updated_at       = now()
    WHERE id = p_job_id
      AND lease_owner = p_owner
      AND lease_expires_at > now()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$;

-- Clear the lease (graceful pause); only the current owner may release.
CREATE OR REPLACE FUNCTION public.release_search_job(p_job_id UUID, p_owner TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.search_jobs
  SET lease_owner      = NULL,
      lease_expires_at = NULL,
      updated_at       = now()
  WHERE id = p_job_id
    AND lease_owner = p_owner;
$$;

GRANT EXECUTE ON FUNCTION public.claim_search_job(TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_search_job(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_search_job(UUID, TEXT) TO authenticated, service_role;
