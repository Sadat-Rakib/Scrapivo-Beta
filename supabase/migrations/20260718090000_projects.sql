-- Projects: per-user saved "who I am / who I need" contexts that pre-fill
-- every search (Project 1 = leads for my business, Project 2 = clients for
-- my freelance work, ...). Collected by the chat-style onboarding wizard.
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Project 1',
  kind TEXT NOT NULL DEFAULT 'freelance',          -- 'business' | 'freelance'
  business_name TEXT,
  website TEXT,
  about_doc TEXT,                                   -- detailed "about you/business" document
  niche TEXT,                                       -- who you need, e.g. "SaaS startups"
  service TEXT,                                     -- what you provide, e.g. "web development"
  location TEXT,                                    -- target location or 'Anywhere'
  audience TEXT NOT NULL DEFAULT 'companies',       -- 'companies' | 'agencies' | 'people'
  goal TEXT NOT NULL DEFAULT 'both',                -- 'jobs' | 'clients' | 'both'
  experience_level TEXT NOT NULL DEFAULT '0-1',     -- '0-1' | '2-4' | '5+'
  work_style TEXT NOT NULL DEFAULT 'remote',        -- 'remote' | 'onsite' | 'any'
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
CREATE POLICY "projects_select_own" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;
CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
