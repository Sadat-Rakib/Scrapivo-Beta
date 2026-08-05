-- =====================================================================
-- Scrapivo — consolidated schema for a fresh Supabase project.
--
-- HOW TO APPLY (one-time, ~30s):
--   1. Supabase dashboard → your project (fxcrmybvfokyrvcuhcgh)
--   2. SQL Editor → New query
--   3. Paste this entire file → Run
--
-- Idempotent-ish: profiles/search_history/saved_leads use IF NOT EXISTS;
-- ai_cache/lead_research/campaigns use plain CREATE TABLE (safe on a fresh
-- project). Re-running on a populated DB may error on the latter three —
-- that's expected; they only need to be created once.
--
-- This is the concatenation of:
--   supabase/migrations/20260612022051_*.sql   (profiles, search_history, saved_leads, touch_updated_at)
--   supabase/migrations/20260620062821_*.sql   (ai_cache, lead_research, campaigns)
-- in dependency order (touch_updated_at() must exist before migration 2).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Migration 1 — profiles, search_history, saved_leads, touch_updated_at()
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  skills TEXT[] NOT NULL DEFAULT '{}',
  job_title TEXT,
  years_experience INTEGER,
  rate_range TEXT,
  work_preference TEXT,
  location TEXT,
  searches_used INTEGER NOT NULL DEFAULT 0,
  searches_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notify_email BOOLEAN NOT NULL DEFAULT true,
  slack_webhook TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS public.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  sources_searched TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_history TO authenticated;
GRANT ALL ON public.search_history TO service_role;

CREATE INDEX IF NOT EXISTS search_history_user_created_idx
  ON public.search_history (user_id, created_at DESC);

ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "history_own" ON public.search_history;
CREATE POLICY "history_own" ON public.search_history
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.saved_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source TEXT NOT NULL,
  platform TEXT,
  title TEXT,
  snippet TEXT,
  full_post_url TEXT NOT NULL,
  author TEXT,
  author_url TEXT,
  posted_at TIMESTAMPTZ,
  engagement INTEGER NOT NULL DEFAULT 0,
  tier TEXT,
  score INTEGER,
  is_decision_maker BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'saved',
  notes TEXT,
  outreach_dm TEXT,
  outreach_email_subject TEXT,
  outreach_email_body TEXT,
  outreach_call TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, full_post_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_leads TO authenticated;
GRANT ALL ON public.saved_leads TO service_role;

CREATE INDEX IF NOT EXISTS saved_leads_user_created_idx
  ON public.saved_leads (user_id, created_at DESC);

ALTER TABLE public.saved_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_own" ON public.saved_leads;
CREATE POLICY "leads_own" ON public.saved_leads
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS saved_leads_touch_updated_at ON public.saved_leads;
CREATE TRIGGER saved_leads_touch_updated_at
  BEFORE UPDATE ON public.saved_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Migration 2 — ai_cache, lead_research, campaigns
-- ─────────────────────────────────────────────────────────────────────

-- AI response cache (24h TTL, content-keyed) — backs the Task 0.3 persistent
-- role-expansion cache tier and all other aiComplete() calls.
CREATE TABLE IF NOT EXISTS public.ai_cache (
  cache_key text PRIMARY KEY,
  task text NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_cache_service_only ON public.ai_cache;
CREATE POLICY ai_cache_service_only ON public.ai_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS ai_cache_expires_idx ON public.ai_cache(expires_at);

-- Per-lead AI research (cached so we never re-research the same URL)
CREATE TABLE IF NOT EXISTS public.lead_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_url text NOT NULL,
  overview text,
  pain_points jsonb DEFAULT '[]'::jsonb,
  why_now text,
  recommended_angle text,
  citations jsonb DEFAULT '[]'::jsonb,
  status_quo text,
  urgency text,
  verified_hooks jsonb DEFAULT '[]'::jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lead_url)
);
ALTER TABLE public.lead_research ADD COLUMN IF NOT EXISTS status_quo text;
ALTER TABLE public.lead_research ADD COLUMN IF NOT EXISTS urgency text;
ALTER TABLE public.lead_research ADD COLUMN IF NOT EXISTS verified_hooks jsonb DEFAULT '[]'::jsonb;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_research TO authenticated;
GRANT ALL ON public.lead_research TO service_role;
ALTER TABLE public.lead_research ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_research_own ON public.lead_research;
CREATE POLICY lead_research_own ON public.lead_research FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS lead_research_updated_at ON public.lead_research;
CREATE TRIGGER lead_research_updated_at BEFORE UPDATE ON public.lead_research
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Saved campaigns (structured search definitions)
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text NOT NULL,
  icp jsonb DEFAULT '{}'::jsonb,
  expansions jsonb,
  expansions_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_own ON public.campaigns;
CREATE POLICY campaigns_own ON public.campaigns FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS campaigns_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';
