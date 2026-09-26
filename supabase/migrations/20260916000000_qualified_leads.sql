-- QualifiedLead production persistence (M10 contract → real store).
--
-- Stores the lossless QualifiedLeadRecord JSON (same shape as InMemory).
-- Persistence never qualifies: writers must call canPersistAsQualifiedLead /
-- projectQualifiedLead first. Retrieval re-checks the theorem before surfacing
-- as QualifiedLead (getAsQualified / listQualified).
--
-- lead_key = entity_id || '::' || claim_type (leadKeyOf).

CREATE TABLE IF NOT EXISTS public.qualified_leads (
  lead_key         TEXT PRIMARY KEY,
  entity_id        TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  claim_type       TEXT NOT NULL,
  name             TEXT NOT NULL,
  record           JSONB NOT NULL,
  search_run_id    TEXT,
  conversation_id  TEXT,
  turn_id          TEXT,
  request_id       TEXT,
  location_id      TEXT,
  qualified_at     TIMESTAMPTZ NOT NULL,
  persisted_at     TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  CONSTRAINT qualified_leads_disposition_check
    CHECK ((record ->> 'disposition') = 'qualified')
);

CREATE INDEX IF NOT EXISTS idx_ql_entity_id
  ON public.qualified_leads (entity_id);
CREATE INDEX IF NOT EXISTS idx_ql_claim_type
  ON public.qualified_leads (claim_type);
CREATE INDEX IF NOT EXISTS idx_ql_location_id
  ON public.qualified_leads (location_id)
  WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ql_search_run
  ON public.qualified_leads (search_run_id)
  WHERE search_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ql_updated
  ON public.qualified_leads (updated_at DESC);

COMMENT ON TABLE public.qualified_leads IS
  'M10 QualifiedLead records — proof-preserving persistence; never a second qualifier.';
