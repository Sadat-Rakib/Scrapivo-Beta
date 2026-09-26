"""Bridge loader: gate1-pg (or any PG) -> hosted Supabase via PostgREST.

Why this exists: Supabase hosts have no DB password in this repo, so
psycopg2 cannot connect to them. The service_role key CAN write through
PostgREST. Reads come from the local verification DB (already normalized).

Idempotent: PostgREST upsert (Prefer: resolution=merge-duplicates,
on_conflict=registry_key). Re-runs converge; failures never stop the job.

Usage:
  python scripts/pipeline/supabase_bridge.py --dry-run
  python scripts/pipeline/supabase_bridge.py --live --slice proof-cities

Slices (demo sizing for hosted DB limits):
  proof-cities : proof metros + US/GB demo companies + IN/US/GB/CA people
  full-4       : entire IN/GB/US/CA scope (needs ~4GB headroom on target)
Env: PG_DSN (source), SB_URL, SB_SERVICE_KEY. Keys never printed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

SLICES = {
    # (table, where-clause, order-by-pk) — exact-match friendly, demo-sized.
    "proof-cities": [
        ("idx_businesses",
         "city_norm IN ('pune','mumbai','delhi','bangalore','hyderabad',"
         "'chennai','kolkata','austin','london','toronto','new york',"
         "'los angeles')",
         "registry_key"),
        ("idx_companies",
         "((country = 'GB' AND city_norm = 'london') OR country = 'US' OR "
         "(country = 'IN' AND city_norm IN ('pune','mumbai')))",
         "registry_key"),
        ("idx_people",
         "country IN ('IN','US','GB','CA')",
         "registry_key"),
    ],
    "full-4": [
        ("idx_businesses", "country IN ('IN','GB','US','CA')", "registry_key"),
        ("idx_companies", "country IN ('IN','GB','US','CA')", "registry_key"),
        ("idx_people", "country IN ('IN','GB','US','CA')", "registry_key"),
    ],
}

PG_COLS = {
    "idx_businesses": ["registry_key", "source", "name", "name_normalized",
                       "category", "category_raw", "city", "city_norm",
                       "region", "country", "postal_code", "address",
                       "latitude", "longitude", "phone", "email", "website",
                       "domain", "quality_score", "confidence", "junk_flag",
                       "content_hash", "source_file"],
    "idx_companies": ["registry_key", "source", "name", "name_normalized",
                      "country", "city", "city_norm", "region", "category",
                      "website", "domain", "email", "phone", "linkedin",
                      "description", "quality_score", "content_hash"],
    "idx_people": ["registry_key", "source", "name", "name_normalized",
                   "role", "role_norm", "company", "company_domain", "city",
                   "city_norm", "country", "industry", "email", "phone",
                   "linkedin", "quality_score", "content_hash"],
}

CHUNK_SELECT = 5000
CHUNK_POST = 500


def _req(url: str, key: str, data: bytes | None = None,
         prefer: str = "return=minimal") -> tuple[int, bytes]:
    r = urllib.request.Request(
        url, data=data, method="POST" if data is not None else "GET",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json", "Prefer": prefer})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--live", action="store_true",
                    help="Actually POST (without it: dry run, zero writes).")
    ap.add_argument("--slice", default="proof-cities",
                    choices=list(SLICES),
                    help="Which row set to bridge.")
    ap.add_argument("--pg-dsn", default=None)
    ap.add_argument("--sb-url", default=None)
    ap.add_argument("--sb-key", default=None)
    args = ap.parse_args()

    import psycopg2

    pg_dsn = args.pg_dsn or os.environ.get("PG_DSN")
    sb_url = (args.sb_url or os.environ.get("SB_URL") or "").rstrip("/")
    sb_key = args.sb_key or os.environ.get("SB_SERVICE_KEY")
    if not pg_dsn:
        ap.error("Need --pg-dsn/$PG_DSN.")
    if args.live and (not sb_url or not sb_key):
        ap.error("Live needs --sb-url/$SB_URL and --sb-key/$SB_SERVICE_KEY.")
    if not args.live:
        print(json.dumps({"dry_run": True, "writes": False,
                          "note": "pass --live to POST"}))

    pg = psycopg2.connect(pg_dsn)
    total = {"selected": 0, "posted": 0, "failed": 0}
    t0 = time.perf_counter()
    for table, where, order in SLICES[args.slice]:
        cols = PG_COLS[table]
        posted_table = 0
        selected_table = 0
        with pg.cursor(name="bridge_%s" % table) as cur:  # server-side cursor
            cur.execute("SELECT %s FROM %s WHERE %s ORDER BY %s"
                        % (",".join(cols), table, where, order))
            while True:
                batch = cur.fetchmany(CHUNK_SELECT)
                if not batch:
                    break
                total["selected"] += len(batch)
                selected_table += len(batch)
                if not args.live:
                    continue
                payload = [dict(zip(cols, row)) for row in batch]
                for i in range(0, len(payload), CHUNK_POST):
                    chunk = payload[i:i + CHUNK_POST]
                    status, body = _req(
                        "%s/rest/v1/%s?on_conflict=registry_key"
                        % (sb_url, table), sb_key,
                        json.dumps(chunk, ensure_ascii=False,
                                   default=str).encode("utf-8"),
                        prefer="return=minimal,resolution=merge-duplicates")
                    if status in (200, 201, 204):
                        posted_table += len(chunk)
                    else:
                        total["failed"] += len(chunk)
                        print("POST failed %s: %s" %
                              (status, body[:300]), file=sys.stderr)
        total["posted"] += posted_table
        print("table %s: selected=%d posted=%d" %
              (table, selected_table, posted_table), flush=True)
    pg.close()
    total["elapsedMs"] = int((time.perf_counter() - t0) * 1000)
    total["writes"] = bool(args.live)
    print(json.dumps(total))


if __name__ == "__main__":
    main()
