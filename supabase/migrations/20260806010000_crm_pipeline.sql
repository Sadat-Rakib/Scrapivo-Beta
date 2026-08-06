-- Scrapivo-native CRM: contacts on saved leads + activity log
-- Apply via Supabase SQL editor or `supabase db push` when ready.

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
