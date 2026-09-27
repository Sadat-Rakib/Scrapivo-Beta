-- Watch v2 on the job engine (Workstream 5).
--
-- campaigns gains project linkage + a frozen compiled SearchSpec (thesis) so a
-- watch re-runs the SAME deterministic spec until the project context version
-- changes. delivery selects which notification channels a watch completion
-- fans out to. change_mode picks the diff semantics:
--   new_entity  — notify when an entity is seen for the first time
--   new_signal  — notify when a KNOWN entity shows a new signal fingerprint
--
-- watch_seen_matches is the durable memory of what a watch has already
-- reported. Ownership joins through campaigns (WS1 child-table pattern).

-- =========================================================================
-- 1. campaigns columns
-- =========================================================================
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS thesis JSONB;
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS thesis_context_version INT;
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS change_mode TEXT NOT NULL DEFAULT 'new_entity'
    CHECK (change_mode IN ('new_entity','new_signal'));
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS delivery JSONB NOT NULL DEFAULT '{"channels":["in_app"]}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_campaigns_project
  ON public.campaigns (project_id) WHERE project_id IS NOT NULL;

-- =========================================================================
-- 2. watch_seen_matches
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.watch_seen_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id          UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  entity_id         TEXT NOT NULL,
  match_fingerprint TEXT NOT NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One memory per (watch, entity, fingerprint): the same match can never be
  -- reported twice; a changed fingerprint (new signal) is a new row.
  CONSTRAINT uq_watch_seen UNIQUE (watch_id, entity_id, match_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_watch_seen_watch
  ON public.watch_seen_matches (watch_id);

GRANT SELECT, INSERT, DELETE ON public.watch_seen_matches TO authenticated;
GRANT ALL ON public.watch_seen_matches TO service_role;

ALTER TABLE public.watch_seen_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watch_seen_matches_select_own" ON public.watch_seen_matches;
CREATE POLICY "watch_seen_matches_select_own" ON public.watch_seen_matches
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = watch_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "watch_seen_matches_insert_own" ON public.watch_seen_matches;
CREATE POLICY "watch_seen_matches_insert_own" ON public.watch_seen_matches
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = watch_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "watch_seen_matches_delete_own" ON public.watch_seen_matches;
CREATE POLICY "watch_seen_matches_delete_own" ON public.watch_seen_matches
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = watch_id AND c.user_id = auth.uid()));
