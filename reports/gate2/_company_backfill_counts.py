import json
import boto3
import duckdb

creds = boto3.Session(profile_name="scrapivo").get_credentials().get_frozen_credentials()
conn = duckdb.connect()
conn.execute("LOAD httpfs")
conn.execute("SET s3_region='us-east-2'")
conn.execute("SET s3_access_key_id=?", [creds.access_key])
conn.execute("SET s3_secret_access_key=?", [creds.secret_key])
if creds.token:
    conn.execute("SET s3_session_token=?", [creds.token])

path = (
    "s3://scrapivo-raw-data-2026-523220341033-us-east-2-an/"
    "processed/companies_by_initial/*/*.parquet"
)
query = f"""
WITH d AS (SELECT lower(coalesce(location, '')) AS loc FROM read_parquet('{path}')),
mapped AS (
  SELECT CASE
    WHEN regexp_matches(loc, '\\b(us|u\\.s\\.|united states)\\b')
      OR regexp_matches(loc, '\\b(san francisco|new york|los angeles|dallas|chicago|austin)\\b') THEN 'US'
    WHEN regexp_matches(loc, '\\b(london)\\b') THEN 'GB'
    WHEN regexp_matches(loc, '\\b(toronto|calgary|vancouver)\\b') THEN 'CA'
    WHEN regexp_matches(loc, '\\b(pune|mumbai|delhi|bangalore|bengaluru)\\b') THEN 'IN'
    ELSE 'UNMAPPED'
  END country
  FROM d
)
SELECT country, count(*) AS n FROM mapped GROUP BY country ORDER BY n DESC
"""
rows = conn.execute(query).fetchall()
print(json.dumps(dict(rows), indent=2))
