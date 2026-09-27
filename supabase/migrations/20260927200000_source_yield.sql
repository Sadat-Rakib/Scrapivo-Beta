-- Source yield learning (Workstream 4).
--
-- source_yield_stats accumulates per-source outcome counters bucketed in UTC
-- daily windows, keyed by (query_family, entity_type, source, window_start).
-- The reader folds the last ~28 windows with a 7-day half-life exponential
-- decay into a smoothed qualification yield; buildSourcePlan post-steps use it
-- to reorder capable sources (see src/lib/search/source-yield.server.ts).
--
-- Ownership: internal engine table. RLS is enabled with NO user policies —
-- only the service role (which bypasses RLS) may read/write. Writers use the
-- admin client; no authenticated grant is issued on purpose.

-- =========================================================================
-- 1. source_yield_stats
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.source_yield_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_family   TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  source         TEXT NOT NULL,
  window_start   TIMESTAMPTZ NOT NULL,          -- UTC daily bucket (00:00Z)
  attempts       INT NOT NULL DEFAULT 0,
  candidates     INT NOT NULL DEFAULT 0,
  qualified      INT NOT NULL DEFAULT 0,
  contacts       INT NOT NULL DEFAULT 0,
  signals        INT NOT NULL DEFAULT 0,
  latency_ms_sum BIGINT NOT NULL DEFAULT 0,
  failures       INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (family, entity, source, day) — upsert target for accumulators.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_yield_window
  ON public.source_yield_stats (query_family, entity_type, source, window_start);
-- Reader path: fold the trailing 28 windows per (family, entity, source).
CREATE INDEX IF NOT EXISTS idx_source_yield_lookup
  ON public.source_yield_stats (query_family, entity_type, source, window_start DESC);

-- =========================================================================
-- 2. Grants + RLS (service-role only; internal table, no user policies)
-- =========================================================================
GRANT ALL ON public.source_yield_stats TO service_role;

ALTER TABLE public.source_yield_stats ENABLE ROW LEVEL SECURITY;

-- Deliberately no CREATE POLICY statements: authenticated/anon roles get no
-- grants above and RLS denies everything not covered by a policy, so the
-- table is reachable exclusively through the service-role admin client.
