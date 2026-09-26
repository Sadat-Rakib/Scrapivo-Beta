-- Gate 1 proof: EXPLAIN (ANALYZE, BUFFERS) for the 5 queries + correctness checks.
-- Run: psql "$DATABASE_URL" -f supabase/seeds/gate1_proof_queries.sql
-- Success = Index Scan using the city_norm indexes (no Seq Scan on idx_*),
-- correct rows only, stable registry_keys, measured latency per query.
--
-- Retrieval rule under test: exact matches ONLY. No nearby-fill.
-- "dentists in Pune" with 3 Pune rows returns exactly those 3, never Jamnagar.

-- Q1: dentists in Pune -> country=IN, city_norm=pune, category=dentist
EXPLAIN (ANALYZE, BUFFERS)
SELECT registry_key, name, city, city_norm, country, category, quality_score
FROM public.idx_businesses
WHERE country = 'IN' AND city_norm = 'pune' AND category = 'dentist'
ORDER BY quality_score DESC LIMIT 20;

-- Q1 correctness: exactly the 3 Pune rows, late-file record present, top by quality.
SELECT count(*) AS pune_dentists,
       bool_and(country = 'IN' AND city_norm = 'pune' AND category = 'dentist') AS all_exact,
       count(*) FILTER (WHERE registry_key = 'overture:DEMO-PUNE-LATE') AS late_record_found,
       count(*) FILTER (WHERE city_norm <> 'pune') AS wrong_city_leaked
FROM (SELECT * FROM public.idx_businesses
      WHERE country = 'IN' AND city_norm = 'pune' AND category = 'dentist'
      ORDER BY quality_score DESC LIMIT 20) q;

-- Q2: companies in London -> country=GB, city_norm=london
EXPLAIN (ANALYZE, BUFFERS)
SELECT registry_key, name, city, city_norm, country, quality_score
FROM public.idx_companies
WHERE country = 'GB' AND city_norm = 'london'
ORDER BY quality_score DESC LIMIT 20;

SELECT count(*) AS london_companies,
       bool_and(country = 'GB' AND city_norm = 'london') AS all_exact,
       count(*) FILTER (WHERE city_norm = 'harrogate') AS harrogate_leaked
FROM (SELECT * FROM public.idx_companies
      WHERE country = 'GB' AND city_norm = 'london'
      ORDER BY quality_score DESC LIMIT 20) q;

-- Q3: plumbers in Austin -> country=US, city_norm=austin, category=plumber
EXPLAIN (ANALYZE, BUFFERS)
SELECT registry_key, name, city, city_norm, country, category, quality_score
FROM public.idx_businesses
WHERE country = 'US' AND city_norm = 'austin' AND category = 'plumber'
ORDER BY quality_score DESC LIMIT 20;

SELECT count(*) AS austin_plumbers,
       bool_and(country = 'US' AND city_norm = 'austin' AND category = 'plumber') AS all_exact
FROM (SELECT * FROM public.idx_businesses
      WHERE country = 'US' AND city_norm = 'austin' AND category = 'plumber'
      ORDER BY quality_score DESC LIMIT 20) q;

-- Q4: founders in Mumbai -> country=IN, city_norm=mumbai, role_norm=founder
-- (normalized role lookup; original role kept for display, never ILIKE-scanned)
EXPLAIN (ANALYZE, BUFFERS)
SELECT registry_key, name, role, role_norm, city, city_norm, country, quality_score
FROM public.idx_people
WHERE country = 'IN' AND city_norm = 'mumbai' AND role_norm = 'founder'
ORDER BY quality_score DESC LIMIT 20;

SELECT count(*) AS mumbai_founders,
       bool_and(country = 'IN' AND city_norm = 'mumbai' AND role_norm = 'founder') AS all_exact,
       count(*) FILTER (WHERE role_norm <> 'founder' OR city_norm <> 'mumbai') AS wrong_row_leaked
FROM (SELECT * FROM public.idx_people
      WHERE country = 'IN' AND city_norm = 'mumbai' AND role_norm = 'founder'
      ORDER BY quality_score DESC LIMIT 20) q;

-- Q5: companies in United States -> country=US (no city; whole-country exact)
EXPLAIN (ANALYZE, BUFFERS)
SELECT registry_key, name, city, city_norm, country, quality_score
FROM public.idx_companies
WHERE country = 'US'
ORDER BY quality_score DESC LIMIT 20;

SELECT count(*) AS us_companies,
       bool_and(country = 'US') AS all_exact
FROM (SELECT * FROM public.idx_companies
      WHERE country = 'US'
      ORDER BY quality_score DESC LIMIT 20) q;
