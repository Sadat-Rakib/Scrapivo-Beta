
-- AI response cache (24h TTL, content-keyed)
CREATE TABLE public.ai_cache (
  cache_key text PRIMARY KEY,
  task text NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_cache_service_only ON public.ai_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX ai_cache_expires_idx ON public.ai_cache(expires_at);

-- Per-lead AI research (cached so we never re-research the same URL)
CREATE TABLE public.lead_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_url text NOT NULL,
  overview text,
  pain_points jsonb DEFAULT '[]'::jsonb,
  why_now text,
  recommended_angle text,
  citations jsonb DEFAULT '[]'::jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lead_url)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_research TO authenticated;
GRANT ALL ON public.lead_research TO service_role;
ALTER TABLE public.lead_research ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_research_own ON public.lead_research FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER lead_research_updated_at BEFORE UPDATE ON public.lead_research
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Saved campaigns (structured search definitions)
CREATE TABLE public.campaigns (
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
CREATE POLICY campaigns_own ON public.campaigns FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
