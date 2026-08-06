-- CASL email automation: compliance log, sends, suppressions, sequences, sender identity
-- Apply via Supabase SQL editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS sender_physical_address text,
  ADD COLUMN IF NOT EXISTS outreach_from_email text;

CREATE TABLE IF NOT EXISTS public.outreach_compliance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_lead_id uuid REFERENCES public.saved_leads(id) ON DELETE SET NULL,
  email text NOT NULL,
  basis text NOT NULL DEFAULT 'none',
  source_url text,
  role_title text,
  captured_at timestamptz,
  content_hash text,
  anti_cem_statement boolean,
  relevance_note text,
  verifier_tier text,
  outreach_ready boolean NOT NULL DEFAULT false,
  reasons jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_compliance_user_idx
  ON public.outreach_compliance (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_compliance TO authenticated;
GRANT ALL ON public.outreach_compliance TO service_role;
ALTER TABLE public.outreach_compliance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_compliance_owner ON public.outreach_compliance;
CREATE POLICY outreach_compliance_owner ON public.outreach_compliance
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS outreach_compliance_service ON public.outreach_compliance;
CREATE POLICY outreach_compliance_service ON public.outreach_compliance
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_lead_id uuid REFERENCES public.saved_leads(id) ON DELETE SET NULL,
  compliance_id uuid REFERENCES public.outreach_compliance(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  resend_id text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_sends_user_idx ON public.email_sends (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_sends_resend_idx ON public.email_sends (resend_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_sends TO authenticated;
GRANT ALL ON public.email_sends TO service_role;
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_sends_owner ON public.email_sends;
CREATE POLICY email_sends_owner ON public.email_sends
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS email_sends_service ON public.email_sends;
CREATE POLICY email_sends_service ON public.email_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
CREATE INDEX IF NOT EXISTS email_suppressions_email_idx
  ON public.email_suppressions (user_id, email);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_suppressions TO authenticated;
GRANT ALL ON public.email_suppressions TO service_role;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_suppressions_owner ON public.email_suppressions;
CREATE POLICY email_suppressions_owner ON public.email_suppressions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS email_suppressions_service ON public.email_suppressions;
CREATE POLICY email_suppressions_service ON public.email_suppressions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_lead_id uuid NOT NULL REFERENCES public.saved_leads(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_sequences_user_idx ON public.email_sequences (user_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_sequences TO authenticated;
GRANT ALL ON public.email_sequences TO service_role;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_sequences_owner ON public.email_sequences;
CREATE POLICY email_sequences_owner ON public.email_sequences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS email_sequences_service ON public.email_sequences;
CREATE POLICY email_sequences_service ON public.email_sequences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.email_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_index integer NOT NULL DEFAULT 0,
  delay_days integer NOT NULL DEFAULT 0,
  subject text,
  body text,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  email_send_id uuid REFERENCES public.email_sends(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_index)
);
CREATE INDEX IF NOT EXISTS email_sequence_steps_due_idx
  ON public.email_sequence_steps (status, due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_sequence_steps TO authenticated;
GRANT ALL ON public.email_sequence_steps TO service_role;
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_sequence_steps_owner ON public.email_sequence_steps;
CREATE POLICY email_sequence_steps_owner ON public.email_sequence_steps
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS email_sequence_steps_service ON public.email_sequence_steps;
CREATE POLICY email_sequence_steps_service ON public.email_sequence_steps
  FOR ALL TO service_role USING (true) WITH CHECK (true);
