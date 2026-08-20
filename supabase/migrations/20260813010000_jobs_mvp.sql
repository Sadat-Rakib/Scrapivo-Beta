-- Jobs MVP tables (optional persistence; app works with live ATS fetch without these).

CREATE TABLE IF NOT EXISTS public.job_sources (
  id text PRIMARY KEY,
  label text NOT NULL,
  kind text NOT NULL,
  board_id text,
  domain text,
  active boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_postings (
  id text PRIMARY KEY,
  title text NOT NULL,
  company text NOT NULL,
  location text,
  url text NOT NULL,
  source text NOT NULL,
  board_id text,
  posted_at timestamptz,
  description text,
  salary text,
  remote boolean NOT NULL DEFAULT false,
  seniority text,
  raw jsonb,
  seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_postings_source_idx ON public.job_postings (source);
CREATE INDEX IF NOT EXISTS job_postings_posted_idx ON public.job_postings (posted_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.job_seen (
  job_id text PRIMARY KEY REFERENCES public.job_postings(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_job_state (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id text NOT NULL,
  status text NOT NULL DEFAULT 'saved',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_job_state ENABLE ROW LEVEL SECURITY;

-- Read-only public job catalog for authenticated users; per-user state is private.
DO $$ BEGIN
  CREATE POLICY job_postings_select_auth ON public.job_postings
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY job_sources_select_auth ON public.job_sources
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY job_seen_select_auth ON public.job_seen
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY user_job_state_own ON public.user_job_state
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
