-- Scrapivo MVP schema. Paste & run this in YOUR Supabase project's SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE where possible).

-- =========================================================================
-- 1. profiles
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS years_experience INTEGER,
  ADD COLUMN IF NOT EXISTS rate_range TEXT,
  ADD COLUMN IF NOT EXISTS work_preference TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS searches_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS searches_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack_webhook TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- =========================================================================
-- 2. search_history
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  sources_searched TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_history TO authenticated;
GRANT ALL ON public.search_history TO service_role;

ALTER TABLE public.search_history
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS query TEXT,
  ADD COLUMN IF NOT EXISTS results_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sources_searched TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS search_history_user_created_idx
  ON public.search_history (user_id, created_at DESC);

ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "history_own" ON public.search_history;
CREATE POLICY "history_own" ON public.search_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 3. saved_leads
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.saved_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- lead snapshot
  source TEXT NOT NULL,           -- reddit/hn/github/bluesky/upwork/remoteok/serpapi/tavily/scrapecreators
  platform TEXT,                  -- display name
  title TEXT,
  snippet TEXT,
  full_post_url TEXT NOT NULL,
  author TEXT,
  author_url TEXT,
  posted_at TIMESTAMPTZ,
  engagement INTEGER NOT NULL DEFAULT 0,
  tier TEXT,                      -- hot | warm | signal
  score INTEGER,
  is_decision_maker BOOLEAN DEFAULT false,
  -- workflow
  status TEXT NOT NULL DEFAULT 'saved', -- new | saved | contacted | replied | archived
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

ALTER TABLE public.saved_leads
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS snippet TEXT,
  ADD COLUMN IF NOT EXISTS full_post_url TEXT,
  ADD COLUMN IF NOT EXISTS author TEXT,
  ADD COLUMN IF NOT EXISTS author_url TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engagement INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS score INTEGER,
  ADD COLUMN IF NOT EXISTS is_decision_maker BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'saved',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS outreach_dm TEXT,
  ADD COLUMN IF NOT EXISTS outreach_email_subject TEXT,
  ADD COLUMN IF NOT EXISTS outreach_email_body TEXT,
  ADD COLUMN IF NOT EXISTS outreach_call TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS saved_leads_user_full_post_url_idx
  ON public.saved_leads (user_id, full_post_url);

CREATE INDEX IF NOT EXISTS saved_leads_user_created_idx
  ON public.saved_leads (user_id, created_at DESC);

ALTER TABLE public.saved_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_own" ON public.saved_leads;
CREATE POLICY "leads_own" ON public.saved_leads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 4. updated_at trigger
-- =========================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS saved_leads_touch_updated_at ON public.saved_leads;
CREATE TRIGGER saved_leads_touch_updated_at
  BEFORE UPDATE ON public.saved_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================================
-- 5. auto-create profile on signup
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- 6. core intelligence entities (Phase 1)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  legal_name TEXT,
  domain TEXT,
  website TEXT,
  description TEXT,
  industry TEXT,
  categories TEXT[] DEFAULT '{}',
  employee_count INTEGER,
  location TEXT,
  headquarters TEXT,
  country TEXT,
  state_province TEXT,
  city TEXT,
  postal_code TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  phone TEXT,
  logo_url TEXT,
  social_profiles JSONB DEFAULT '{}',
  source_ids JSONB DEFAULT '[]',
  source_metadata JSONB DEFAULT '{}',
  enrichment_status TEXT DEFAULT 'none',
  last_enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.persons (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  seniority TEXT,
  department TEXT,
  linkedin_url TEXT,
  website TEXT,
  location TEXT,
  source_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contacts (
  id TEXT PRIMARY KEY,
  person_id TEXT REFERENCES public.persons(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence_score INTEGER DEFAULT 0,
  verification_status TEXT DEFAULT 'unverified',
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signals (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES public.persons(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  evidence_url TEXT,
  evidence_text TEXT,
  confidence INTEGER DEFAULT 0,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  raw_metadata JSONB DEFAULT '{}'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persons TO authenticated;
GRANT ALL ON public.persons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;