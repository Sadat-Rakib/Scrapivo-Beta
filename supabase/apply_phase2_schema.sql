-- =====================================================================
-- Scrapivo — Phase 2/4 schema (run once in the Supabase SQL editor)
--
-- Adds the tables the hardening build introduced:
--   • ats_companies   (Task 1.7) — DB-driven ATS board list w/ rotation
--   • source_health   (Task 1.5) — per-source-per-run observability log
--   • lead_outcome    (Task 4.2) — outcome plumbing for future score tuning
--   • ats_check_queue (Task 2.4) — companies flagged by news leading-indicators
--
-- Safe to re-run: uses IF NOT EXISTS / idempotent policy drops + upserts.
-- =====================================================================

-- ── Task 1.7 — growable ATS company list ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ats_companies (
  provider        text NOT NULL,             -- 'ashby' | 'smartrecruiters' | 'workable' | 'recruitee'
  board_id        text NOT NULL,             -- board/company slug used in the public API URL
  active          boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,               -- oldest-first rotation cursor (Task 1.3 applied here)
  added_by        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, board_id)
);
CREATE INDEX IF NOT EXISTS ats_companies_rotation_idx
  ON public.ats_companies(provider, active, last_checked_at NULLS FIRST);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ats_companies TO service_role;
ALTER TABLE public.ats_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ats_companies_service_only ON public.ats_companies;
CREATE POLICY ats_companies_service_only ON public.ats_companies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed with boards verified live during the build (admin-insert path = just
-- INSERT more rows here or via the service key; no code deploy needed).
INSERT INTO public.ats_companies (provider, board_id) VALUES
  ('ashby','ramp'), ('ashby','openai'), ('ashby','posthog'), ('ashby','linear'),
  ('ashby','vanta'), ('ashby','hex'),
  ('smartrecruiters','BoschGroup'), ('smartrecruiters','Visa'), ('smartrecruiters','Square'),
  ('workable','automattic'),
  ('recruitee','channable')
ON CONFLICT (provider, board_id) DO NOTHING;

-- ── Task 1.5 — source health logging ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.source_health (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       uuid NOT NULL,
  query        text,
  source       text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  error_count  integer NOT NULL DEFAULT 0,
  ran_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_health_ran_at_idx ON public.source_health(ran_at DESC);
CREATE INDEX IF NOT EXISTS source_health_source_idx ON public.source_health(source, ran_at DESC);
GRANT SELECT, INSERT ON public.source_health TO service_role;
ALTER TABLE public.source_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_health_service_only ON public.source_health;
CREATE POLICY source_health_service_only ON public.source_health
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Task 4.2 — lead outcome plumbing (structure only, no tuning logic) ───────
CREATE TABLE IF NOT EXISTS public.lead_outcome (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_url   text NOT NULL,
  lead_title text,
  outcome    text NOT NULL,   -- 'saved' | 'contacted' | 'replied' | 'won' | 'lost' | 'ignored'
  metadata   jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_outcome_user_idx ON public.lead_outcome(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_outcome TO authenticated, service_role;
ALTER TABLE public.lead_outcome ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_outcome_owner ON public.lead_outcome;
CREATE POLICY lead_outcome_owner ON public.lead_outcome
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS lead_outcome_service ON public.lead_outcome;
CREATE POLICY lead_outcome_service ON public.lead_outcome
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Task 2.4 — ATS-check trigger queue (news leading indicators) ─────────────
CREATE TABLE IF NOT EXISTS public.ats_check_queue (
  company      text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  checked_at   timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ats_check_queue TO service_role;
ALTER TABLE public.ats_check_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ats_check_queue_service_only ON public.ats_check_queue;
CREATE POLICY ats_check_queue_service_only ON public.ats_check_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Scrapivo-native CRM: contacts on saved leads + activity log ───────────────
ALTER TABLE public.saved_leads
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_company text,
  ADD COLUMN IF NOT EXISTS contact_meta jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.lead_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_lead_id uuid REFERENCES public.saved_leads(id) ON DELETE CASCADE,
  lead_url text,
  kind text NOT NULL,
  detail text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_activity_user_idx
  ON public.lead_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_activity_lead_idx
  ON public.lead_activity (saved_lead_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_activity TO authenticated;
GRANT ALL ON public.lead_activity TO service_role;
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_activity_owner ON public.lead_activity;
CREATE POLICY lead_activity_owner ON public.lead_activity
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS lead_activity_service ON public.lead_activity;
CREATE POLICY lead_activity_service ON public.lead_activity
  FOR ALL TO service_role USING (true) WITH CHECK (true);
