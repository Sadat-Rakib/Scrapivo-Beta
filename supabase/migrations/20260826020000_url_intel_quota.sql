-- URL intelligence: per-user daily extraction budget.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS url_intel_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS url_intel_reset_at timestamptz;
