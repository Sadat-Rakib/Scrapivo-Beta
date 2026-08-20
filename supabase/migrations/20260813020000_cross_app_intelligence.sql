-- Domain pattern memory + profile/evidence tables (Cross-App Intelligence P0/P1).

CREATE TABLE IF NOT EXISTS public.domain_email_patterns (
  id bigserial PRIMARY KEY,
  domain text NOT NULL,
  pattern_key text NOT NULL,
  hit_count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, pattern_key)
);

CREATE INDEX IF NOT EXISTS domain_email_patterns_domain_hits_idx
  ON public.domain_email_patterns (domain, hit_count DESC);

CREATE TABLE IF NOT EXISTS public.domain_verify_state (
  domain text PRIMARY KEY,
  is_catch_all boolean NOT NULL DEFAULT false,
  risky_streak integer NOT NULL DEFAULT 0,
  valid_hits integer NOT NULL DEFAULT 0,
  last_status text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entity_profiles (
  id bigserial PRIMARY KEY,
  entity_key text NOT NULL,
  platform text NOT NULL,
  profile_url text NOT NULL,
  username text,
  display_name text,
  profile_type text NOT NULL DEFAULT 'person',
  confidence text NOT NULL DEFAULT 'medium',
  raw jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_key, platform, profile_url)
);

CREATE INDEX IF NOT EXISTS entity_profiles_entity_idx
  ON public.entity_profiles (entity_key);

CREATE TABLE IF NOT EXISTS public.evidence_claims (
  id bigserial PRIMARY KEY,
  entity_key text NOT NULL,
  claim text NOT NULL,
  confidence text NOT NULL DEFAULT 'medium',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_claims_entity_idx
  ON public.evidence_claims (entity_key);

CREATE TABLE IF NOT EXISTS public.canonical_entities (
  id text PRIMARY KEY,
  name text,
  domain text,
  phone text,
  entity_type text NOT NULL DEFAULT 'company',
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  merge_confidence real NOT NULL DEFAULT 0.5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_entities_domain_idx
  ON public.canonical_entities (domain)
  WHERE domain IS NOT NULL;

ALTER TABLE public.domain_email_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_verify_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_entities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY domain_email_patterns_auth ON public.domain_email_patterns
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY domain_verify_state_auth ON public.domain_verify_state
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY entity_profiles_auth ON public.entity_profiles
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY evidence_claims_auth ON public.evidence_claims
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY canonical_entities_auth ON public.canonical_entities
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
