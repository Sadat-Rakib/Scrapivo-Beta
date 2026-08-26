-- Jobs: per-user daily search quota + result cache for bigger/free-first lists.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_searches_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_searches_reset_at timestamptz;

CREATE TABLE IF NOT EXISTS public.jobs_cache (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_cache_fetched_idx ON public.jobs_cache (fetched_at DESC);
