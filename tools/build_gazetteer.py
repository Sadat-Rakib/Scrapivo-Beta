"""Build data-derived gazetteer from canonical Parquet (no hand-typed places).

Outputs C:\\ScrapivoData\\processed\\gazetteer\\gazetteer.json:
  business_locality: {normalized place -> [stems]}   (from locality/region/country)
  business_country:  {normalized country -> [stems]}
  people_country:    [normalized countries present]
  company_location:  [distinct location strings]      (for matcher reference)
Uploaded to s3://BUCKET/processed/gazetteer/gazetteer.json by this script.
Usage: python tools/build_gazetteer.py [--upload]
"""
import glob
import json
import os
import re
import sys

DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
OUT_DIR = os.path.join(DATA_ROOT, "processed", "gazetteer")
OUT = os.path.join(OUT_DIR, "gazetteer.json")
BUCKET = "scrapivo-raw-data-2026-523220341033-us-east-2-an"


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def main():
    import duckdb
    os.makedirs(OUT_DIR, exist_ok=True)
    c = duckdb.connect()
    biz = os.path.join(DATA_ROOT, "processed", "businesses", "by_country", "*.parquet").replace("\\", "/")
    loc_rows = c.execute(
        f"SELECT DISTINCT locality, region, country, source_file FROM read_parquet('{biz}')"
    ).fetchall()
    locality, country = {}, {}
    for loc, reg, cty, src in loc_rows:
        stem = os.path.basename(src or "").replace("local_businesses_", "").replace(".jsonl", "")
        for val, table in ((loc, locality), (reg, locality), (cty, country)):
            n = norm(val)
            if len(n) >= 2:
                table.setdefault(n, [])
                if stem not in table[n]:
                    table[n].append(stem)
    people = os.path.join(DATA_ROOT, "processed", "people", "person.parquet").replace("\\", "/")
    p_countries = sorted({
        norm(r[0]) for r in c.execute(
            f"SELECT DISTINCT country FROM read_parquet('{people}') WHERE country IS NOT NULL"
        ).fetchall() if norm(r[0])})
    comp = os.path.join(DATA_ROOT, "processed", "companies", "company.parquet").replace("\\", "/")
    comp_locs = sorted({
        r[0] for r in c.execute(
            f"SELECT DISTINCT location FROM read_parquet('{comp}') WHERE location IS NOT NULL"
        ).fetchall()})
    gaz = {"business_locality": locality, "business_country": country,
           "people_country": p_countries, "company_location": comp_locs,
           "stats": {"locality_keys": len(locality), "country_keys": len(country),
                     "people_countries": len(p_countries),
                     "company_locations": len(comp_locs)}}
    json.dump(gaz, open(OUT, "w", encoding="utf-8"))
    print("gazetteer:", gaz["stats"], "->", OUT,
          f"({os.path.getsize(OUT)/1024:.0f} KiB)")
    if "--upload" in sys.argv:
        import boto3
        s3 = boto3.Session(profile_name="scrapivo").client("s3", region_name="us-east-2")
        s3.upload_file(OUT, BUCKET, "processed/gazetteer/gazetteer.json")
        print("uploaded verified:",
              s3.head_object(Bucket=BUCKET, Key="processed/gazetteer/gazetteer.json")["ContentLength"])


if __name__ == "__main__":
    sys.exit(main() or 0)
