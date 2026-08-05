-- Optional columns for research-driven outreach (also stored in lead_research.raw for compatibility).
-- Campaign schedule/metadata continues to live in campaigns.icp jsonb.

ALTER TABLE public.lead_research
  ADD COLUMN IF NOT EXISTS status_quo text,
  ADD COLUMN IF NOT EXISTS urgency text,
  ADD COLUMN IF NOT EXISTS verified_hooks jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.lead_research.verified_hooks IS
  'Array of { claim, citation_url, source_type } for signal-grounded outreach';

NOTIFY pgrst, 'reload schema';
