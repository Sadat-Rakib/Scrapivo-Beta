-- Gate 2B candidate-discovery indexes. Schema only; applying this migration
-- is a separately controlled production operation.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Country-wide people searches cannot use the existing
-- (country, city_norm, role_norm) index because city is unconstrained.
CREATE INDEX IF NOT EXISTS idx_ppl_country_role_quality
  ON public.idx_people (country, role_norm, quality_score DESC);

-- Partial title/category matching is required for compound labels such as
-- "Founder & CEO" and "Information Technology, Software".
CREATE INDEX IF NOT EXISTS idx_ppl_role_trgm
  ON public.idx_people USING gin (role_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ppl_industry_trgm
  ON public.idx_people USING gin (industry gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_co_category_trgm
  ON public.idx_companies USING gin (category gin_trgm_ops);
