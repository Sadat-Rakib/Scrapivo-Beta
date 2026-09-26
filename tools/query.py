"""D1: DuckDB query layer over canonical Parquet (local proof of fetch).

Proves the ingest is queryable: person/company search with the same filters
the app will use (name/company/title/industry/country/category + quality rank).
Usage:
  python tools/query.py people --name "Juan Cruz"
  python tools/query.py people --title CTO --country Brazil --limit 5
  python tools/query.py companies --category "Health Care" --limit 5
  python tools/query.py companies --name "Global Healthline"
Reads C:\\ScrapivoData\\processed (or SCRAPIVO_DATA_ROOT). Read-only.
"""
import argparse
import os
import sys

DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
P = os.path.join(DATA_ROOT, "processed", "people", "person.parquet").replace("\\", "/")
C = os.path.join(DATA_ROOT, "processed", "companies", "company.parquet").replace("\\", "/")


def main():
    import duckdb
    ap = argparse.ArgumentParser()
    ap.add_argument("entity", choices=["people", "companies"])
    ap.add_argument("--name", default=None)
    ap.add_argument("--title", default=None)
    ap.add_argument("--company", default=None)
    ap.add_argument("--country", default=None)
    ap.add_argument("--industry", default=None)
    ap.add_argument("--category", default=None)
    ap.add_argument("--limit", type=int, default=5)
    a = ap.parse_args()
    c = duckdb.connect()
    if a.entity == "people":
        cols = ("name, title, company_name, email, phone, website, country, "
                "industry, quality_score")
        where, params, tbl = [], [], f"read_parquet('{P}')"
        for col, val in (("name", a.name), ("title", a.title),
                         ("company_name", a.company), ("country", a.country),
                         ("industry", a.industry)):
            if val:
                where.append(f"lower({col}) LIKE '%' || lower(?) || '%'")
                params.append(val)
        q = (f"SELECT {cols} FROM {tbl}"
             + (" WHERE " + " AND ".join(where) if where else "")
             + " ORDER BY quality_score DESC, name LIMIT " + str(a.limit))
    else:
        cols = ("company_name, category, location, website, email, phone, "
                "quality_score")
        where, params, tbl = [], [], f"read_parquet('{C}')"
        for col, val in (("company_name", a.name or a.company),
                         ("category", a.category or a.industry)):
            if val:
                where.append(f"lower({col}) LIKE '%' || lower(?) || '%'")
                params.append(val)
        q = (f"SELECT {cols} FROM {tbl}"
             + (" WHERE " + " AND ".join(where) if where else "")
             + " ORDER BY quality_score DESC, company_name LIMIT " + str(a.limit))
    rows = c.execute(q, params).fetchall()
    print(f"{len(rows)} result(s) [{a.entity}]")
    for r in rows:
        print("  | ".join(str(x) for x in r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
