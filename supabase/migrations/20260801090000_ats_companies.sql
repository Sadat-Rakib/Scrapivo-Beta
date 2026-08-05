-- =====================================================================
-- ats_companies — enrich the existing board registry.
--
-- The table already existed with a minimal shape (provider, board_id, active,
-- last_checked_at, added_by, created_at). This migration is ADDITIVE ONLY: it
-- adds the columns the discovery script wants to record and the index the
-- rotation query needs. Nothing is dropped or renamed, so applying it cannot
-- break the running app.
--
-- Populate with: npx tsx scripts/discover-ats-boards.mts
-- =====================================================================

-- Human-readable name, used as the card label instead of the raw board token.
ALTER TABLE public.ats_companies
  ADD COLUMN IF NOT EXISTS company_name text;

-- Company domain — the handoff point to the contact-discovery layer.
ALTER TABLE public.ats_companies
  ADD COLUMN IF NOT EXISTS domain text;

-- Open roles seen at discovery time. Rough popularity signal for ordering.
ALTER TABLE public.ats_companies
  ADD COLUMN IF NOT EXISTS job_count integer DEFAULT 0;

-- Consecutive empty polls, so dead boards can be retired automatically rather
-- than being re-fetched forever.
ALTER TABLE public.ats_companies
  ADD COLUMN IF NOT EXISTS miss_streak integer NOT NULL DEFAULT 0;

-- One row per (provider, board). Without this, re-running discovery duplicates
-- every board instead of refreshing it.
CREATE UNIQUE INDEX IF NOT EXISTS ats_companies_provider_board_key
  ON public.ats_companies (provider, board_id);

-- The hot path: "N boards for this provider, least-recently-checked first".
-- Without it that's a sequential scan on every single search.
CREATE INDEX IF NOT EXISTS ats_companies_rotation_idx
  ON public.ats_companies (provider, active, last_checked_at NULLS FIRST);
