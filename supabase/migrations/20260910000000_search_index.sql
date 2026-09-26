-- Indexed retrieval layer, Gate 1 (Postgres-first, S3 stays source of truth).
--
-- Design (approved):
--   * Parser (SearchSpec) owns WHAT+WHERE interpretation; these tables own retrieval.
--   * city TEXT keeps the display value; city_norm TEXT is the normalized lookup
--     value (lowercase, alias-resolved, e.g. Bombay->Mumbai, Poona->Pune).
--     Indexes target city_norm, never city.
--   * country is ALWAYS ISO2 uppercase (IN, GB, US, CA); enforced by CHECK.
--   * People carry role TEXT for display plus role_norm TEXT for retrieval
--     (founder/co-founder/cofounder/founding partner -> 'founder', etc.).
--     Retrieval filters on role_norm with ILIKE only as a last-resort fallback.
--   * No nearby-fill in these indexes: exact-match queries return exact matches.
--     Nearby is an explicit, labelled second query (Gate 3+), never silent fill.
--   * Loader (scripts/pipeline/store.py extension, Gate 2) upserts by registry_key
--     and must write city_norm/role_norm with the same normalizers as the parser
--     (GEO_ALIAS / COUNTRY_ISO / canonCraft mirrors).
--
-- Scope: IN, GB, US, CA first. Same tables/indexes scale to all 90 countries.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================================================================
-- 1. Businesses (local POIs: Overture / OSM / gosom via pipeline models)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.idx_businesses (
  registry_key    TEXT PRIMARY KEY,   -- source:registry_id, stable across rebuilds
  source          TEXT NOT NULL,      -- overture | osm | gosom
  name            TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  category        TEXT,               -- canonical craft (dentist, plumber, hvac, ...)
  category_raw    TEXT,
  city            TEXT,               -- display value, e.g. 'Pune'
  city_norm       TEXT,               -- lookup value, e.g. 'pune'
  region          TEXT,
  country         TEXT NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  postal_code     TEXT,
  address         TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  domain          TEXT,
  quality_score   INT NOT NULL DEFAULT 0,
  confidence      DOUBLE PRECISION,
  junk_flag       INT NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL,
  source_file     TEXT,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary retrieval path: country + city_norm + category (exact match).
CREATE INDEX IF NOT EXISTS idx_biz_country_citynorm_cat
  ON public.idx_businesses (country, city_norm, category);
-- Country-wide queries (e.g. companies-style "in United States" equivalent).
CREATE INDEX IF NOT EXISTS idx_biz_country_cat_quality
  ON public.idx_businesses (country, category, quality_score DESC);
-- Name fallback / dedupe support.
CREATE INDEX IF NOT EXISTS idx_biz_name_trgm
  ON public.idx_businesses USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_biz_domain
  ON public.idx_businesses (domain);

-- =========================================================================
-- 2. Companies (registries: Companies House / EDGAR / GLEIF / YC ...)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.idx_companies (
  registry_key    TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  country         TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  city            TEXT,               -- display value, e.g. 'London'
  city_norm       TEXT,               -- lookup value, e.g. 'london'
  region          TEXT,
  category        TEXT,               -- primary industry/category
  website         TEXT,
  domain          TEXT,
  email           TEXT,
  phone           TEXT,
  linkedin        TEXT,
  description     TEXT,
  quality_score   INT NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_co_country_citynorm_cat
  ON public.idx_companies (country, city_norm, category);
CREATE INDEX IF NOT EXISTS idx_co_country_citynorm
  ON public.idx_companies (country, city_norm);
CREATE INDEX IF NOT EXISTS idx_co_name_trgm
  ON public.idx_companies USING gin (name_normalized gin_trgm_ops);
-- Covering index for big-city company queries (measured: London 66k-row
-- query 309ms -> 0.18ms index-only-able scan; run VACUUM ANALYZE after load).
CREATE INDEX IF NOT EXISTS idx_co_country_city_quality_cover
  ON public.idx_companies (country, city_norm, quality_score DESC)
  INCLUDE (name, registry_key);

-- =========================================================================
-- 3. People (founders / executives from public directories)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.idx_people (
  registry_key    TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  role            TEXT,               -- display value, e.g. 'Founder & CEO'
  role_norm       TEXT,               -- lookup value, e.g. 'founder'
  company         TEXT,
  company_domain  TEXT,
  city            TEXT,               -- display value, e.g. 'Mumbai'
  city_norm       TEXT,               -- lookup value, e.g. 'mumbai'
  country         TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  industry        TEXT,
  email           TEXT,               -- only when publicly published
  phone           TEXT,               -- only when publicly published
  linkedin        TEXT,
  quality_score   INT NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppl_country_citynorm_rolenorm
  ON public.idx_people (country, city_norm, role_norm);
CREATE INDEX IF NOT EXISTS idx_ppl_name_trgm
  ON public.idx_people USING gin (name_normalized gin_trgm_ops);
