-- Projects / Research Context (Workstream 3) — ADDITIVE extension of the
-- existing 20260718090000_projects.sql table. Never drops or repurposes
-- user data: the wizard-era columns (kind, niche, service, …) stay exactly
-- as they are; this migration only adds columns and child tables.
--
--   * projects           — extended with description/purpose/status.
--   * project_context    — one row per project (upsert-on-create), the
--                          frozen research context the resolver merges.
--   * project_icps       — reusable target definitions (distinct from
--                          saved searches).
--   * project_saved_searches, project_lists, project_list_items,
--     project_activity   — per-project artifacts.
--   * project_global_defaults — per-user fallback layer for the resolver
--                          (explicit > project > global). Backfilled from
--                          profiles below; the profiles data is KEPT.
--
-- context_version: incremented at the application level on every
-- project_context UPDATE (no trigger — the server fn owns the bump so the
-- UI can warn about running search_jobs in the same request). Choice
-- documented here per WS3 design.

-- =========================================================================
-- 1. Extend public.projects (additive only)
-- =========================================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- =========================================================================
-- 2. project_context — one row per project
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.project_context (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  context_version       INT NOT NULL DEFAULT 1,
  default_icp_id        UUID,  -- FK added after project_icps exists (below)
  offer_profile         JSONB NOT NULL DEFAULT '{}',
  preferred_geographies JSONB NOT NULL DEFAULT '[]',
  exclusions            JSONB NOT NULL DEFAULT '[]',
  preferred_signals     JSONB NOT NULL DEFAULT '[]',
  messaging_preferences JSONB NOT NULL DEFAULT '{}',
  custom_context        JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- 3. project_icps
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.project_icps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_icps_project
  ON public.project_icps (project_id);

ALTER TABLE public.project_context
  ADD CONSTRAINT project_context_default_icp_fkey
  FOREIGN KEY (default_icp_id) REFERENCES public.project_icps(id) ON DELETE SET NULL;

-- =========================================================================
-- 4. project_saved_searches
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.project_saved_searches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  spec       JSONB NOT NULL,
  icp_id     UUID REFERENCES public.project_icps(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_saved_searches_project
  ON public.project_saved_searches (project_id, created_at DESC);

-- =========================================================================
-- 5. project_lists + project_list_items
--    source_row is a minimal DISPLAY snapshot only — canonical entity data
--    stays in the graph/stores (Workstream 4 owns canonical).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.project_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_lists_project
  ON public.project_lists (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_list_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       UUID NOT NULL REFERENCES public.project_lists(id) ON DELETE CASCADE,
  entity_id     TEXT NOT NULL,
  source_job_id UUID,
  source_row    JSONB,
  note          TEXT,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe: one entity per list, idempotent re-adds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_list_items_list_entity
  ON public.project_list_items (list_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_project_list_items_list
  ON public.project_list_items (list_id, added_at DESC);

-- =========================================================================
-- 6. project_activity
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.project_activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_activity_project
  ON public.project_activity (project_id, created_at DESC);

-- =========================================================================
-- 7. project_global_defaults — resolver's global layer
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.project_global_defaults (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE,
  context    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- 8. Grants + RLS (repo convention: WS1 child-table pattern)
-- =========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_context TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_icps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_saved_searches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_list_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_activity TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_global_defaults TO authenticated;
GRANT ALL ON public.project_context TO service_role;
GRANT ALL ON public.project_icps TO service_role;
GRANT ALL ON public.project_saved_searches TO service_role;
GRANT ALL ON public.project_lists TO service_role;
GRANT ALL ON public.project_list_items TO service_role;
GRANT ALL ON public.project_activity TO service_role;
GRANT ALL ON public.project_global_defaults TO service_role;

ALTER TABLE public.project_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_icps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_global_defaults ENABLE ROW LEVEL SECURITY;

-- Child tables carry no user_id (frozen design) — ownership via parent join.
DROP POLICY IF EXISTS "project_context_select_own" ON public.project_context;
CREATE POLICY "project_context_select_own" ON public.project_context
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_context_insert_own" ON public.project_context;
CREATE POLICY "project_context_insert_own" ON public.project_context
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_context_update_own" ON public.project_context;
CREATE POLICY "project_context_update_own" ON public.project_context
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_context_delete_own" ON public.project_context;
CREATE POLICY "project_context_delete_own" ON public.project_context
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "project_icps_select_own" ON public.project_icps;
CREATE POLICY "project_icps_select_own" ON public.project_icps
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_icps_insert_own" ON public.project_icps;
CREATE POLICY "project_icps_insert_own" ON public.project_icps
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_icps_update_own" ON public.project_icps;
CREATE POLICY "project_icps_update_own" ON public.project_icps
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_icps_delete_own" ON public.project_icps;
CREATE POLICY "project_icps_delete_own" ON public.project_icps
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "project_saved_searches_select_own" ON public.project_saved_searches;
CREATE POLICY "project_saved_searches_select_own" ON public.project_saved_searches
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_saved_searches_insert_own" ON public.project_saved_searches;
CREATE POLICY "project_saved_searches_insert_own" ON public.project_saved_searches
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_saved_searches_update_own" ON public.project_saved_searches;
CREATE POLICY "project_saved_searches_update_own" ON public.project_saved_searches
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_saved_searches_delete_own" ON public.project_saved_searches;
CREATE POLICY "project_saved_searches_delete_own" ON public.project_saved_searches
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "project_lists_select_own" ON public.project_lists;
CREATE POLICY "project_lists_select_own" ON public.project_lists
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_lists_insert_own" ON public.project_lists;
CREATE POLICY "project_lists_insert_own" ON public.project_lists
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_lists_update_own" ON public.project_lists;
CREATE POLICY "project_lists_update_own" ON public.project_lists
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_lists_delete_own" ON public.project_lists;
CREATE POLICY "project_lists_delete_own" ON public.project_lists
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "project_list_items_select_own" ON public.project_list_items;
CREATE POLICY "project_list_items_select_own" ON public.project_list_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_lists l
    JOIN public.projects p ON p.id = l.project_id
    WHERE l.id = list_id AND p.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "project_list_items_insert_own" ON public.project_list_items;
CREATE POLICY "project_list_items_insert_own" ON public.project_list_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_lists l
    JOIN public.projects p ON p.id = l.project_id
    WHERE l.id = list_id AND p.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "project_list_items_delete_own" ON public.project_list_items;
CREATE POLICY "project_list_items_delete_own" ON public.project_list_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_lists l
    JOIN public.projects p ON p.id = l.project_id
    WHERE l.id = list_id AND p.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "project_activity_select_own" ON public.project_activity;
CREATE POLICY "project_activity_select_own" ON public.project_activity
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "project_activity_insert_own" ON public.project_activity;
CREATE POLICY "project_activity_insert_own" ON public.project_activity
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "project_global_defaults_select_own" ON public.project_global_defaults;
CREATE POLICY "project_global_defaults_select_own" ON public.project_global_defaults
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "project_global_defaults_insert_own" ON public.project_global_defaults;
CREATE POLICY "project_global_defaults_insert_own" ON public.project_global_defaults
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "project_global_defaults_update_own" ON public.project_global_defaults;
CREATE POLICY "project_global_defaults_update_own" ON public.project_global_defaults
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 9. Backfill (part 2): copy account-level profile context into the global
--    defaults layer. Old profiles data is NOT touched or deleted.
-- =========================================================================
INSERT INTO public.project_global_defaults (user_id, context)
SELECT
  pr.id,
  jsonb_strip_nulls(jsonb_build_object(
    'geography', pr.location,
    'offer', jsonb_strip_nulls(jsonb_build_object(
      'name', pr.full_name,
      'what_they_do', pr.job_title,
      'rate_range', pr.rate_range,
      'work_preference', pr.work_preference
    )),
    'custom', jsonb_build_object(
      'skills', to_jsonb(pr.skills)
    )
  ))
FROM public.profiles pr
ON CONFLICT (user_id) DO NOTHING;
