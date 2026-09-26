"""Phase 1.2a: build data/coverage-matrix.json (generated artifact).

Measured tiers (never guessed):
  - s3: per-file LIST + parquet footer row counts (GET only, sources untouched).
  - hot-index: per-country row counts from the Supabase idx_* tables via
    PostgREST count=exact (read-only; keys never printed).
Declared tier (labeled as such, NOT measured):
  - providers: capability declared from existing provider code paths
    (OSM Nominatim+Overpass = primary live places pipeline per repo docs).

No writes anywhere. No CRDB RU (Supabase + S3 only).
Usage: python scripts/pipeline/build_coverage_matrix.py [--out data/coverage-matrix.json]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BUCKET = "scrapivo-raw-data-2026-523220341033-us-east-2-an"
S3_PREFIXES = {
    "businesses": "processed/local-businesses/by_country/",
    "companies": "processed/companies_by_initial/",
    "people": "processed/people_by_country/",
}
IDX_TABLES = {
    "businesses": "idx_businesses",
    "companies": "idx_companies",
    "people": "idx_people",
}
# Declared (code-grounded) live-provider capability per entity. OSM
# Nominatim+Overpass is the primary places/geocoding pipeline (.env docs);
# registry APIs are optional keys, not live providers. Labeled declared.
DECLARED_PROVIDERS = {
    "businesses": ["osm-nominatim", "osm-overpass"],
    "companies": [],
    "people": [],
}


def load_dotenv() -> dict[str, str]:
    env: dict[str, str] = {}
    p = REPO / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    return env


def s3_client():
    import boto3  # lazy

    prof = os.environ.get("AWS_PROFILE", "scrapivo")
    return boto3.Session(profile_name=prof, region_name="us-east-2").client("s3")


def s3_list(s3, prefix: str) -> list[tuple[str, int]]:
    out, tok = [], None
    while True:
        kw: dict = {"Bucket": BUCKET, "Prefix": prefix}
        if tok:
            kw["ContinuationToken"] = tok
        page = s3.list_objects_v2(**kw)
        for it in page.get("Contents", []):
            out.append((it["Key"], it.get("Size", 0)))
        tok = page.get("NextContinuationToken")
        if not tok:
            break
    return out


def parquet_rows(s3, key: str) -> int | None:
    try:
        import pyarrow.parquet as pq  # lazy

        obj = s3.get_object(Bucket=BUCKET, Key=key)
        pf = pq.ParquetFile(io.BytesIO(obj["Body"].read()))
        return int(pf.metadata.num_rows)
    except Exception:
        return None


def stem_of(key: str, prefix: str, entity: str) -> str:
    rest = key[len(prefix):]
    if entity == "businesses":
        base = rest.split("/")[0]
        return base[:-len(".parquet")] if base.endswith(".parquet") else base
    m = re.search(r"_part=([^/]+)/", key)
    if m:
        return urllib.parse.unquote(m.group(1))
    base = rest.split("/")[-1]
    return base[:-len(".parquet")] if base.endswith(".parquet") else base


GEO_KIND = {"businesses": "iso2", "companies": "initial", "people": "slug"}


def hot_counts(sb_url: str, sb_key: str) -> dict[str, dict[str, int | None]]:
    """Per-country counts via count=exact + limit=1 (index scans, no row data)."""
    out: dict[str, dict[str, int | None]] = {e: {} for e in IDX_TABLES}
    # Hot tables are per-country for every entity: probe the businesses ISO
    # stem list (companies/people S3 layouts are by initial/slug, not ISO).
    iso_probes = sorted({s.upper() for s in S3_STEMS.get("businesses", ())
                         if len(s) == 2 and s.isalpha()})
    for entity, table in IDX_TABLES.items():
        probes = iso_probes
        for i, iso in enumerate(probes):
            n = hot_count_one(sb_url, sb_key, table, iso)
            if n is not None:
                out[entity][iso] = n
        print(f"[matrix] hot {entity}: {len(probes)} probes", flush=True)
    return out


def hot_count_one(sb_url: str, sb_key: str, table: str, iso: str) -> int | None:
    url = f"{sb_url}/rest/v1/{table}?country=eq.{iso}&select=registry_key&limit=1"
    req = urllib.request.Request(url, headers={
        "apikey": sb_key, "Authorization": "Bearer " + sb_key,
        "Prefer": "count=exact"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            cr = resp.headers.get("Content-Range", "")
            # Content-Range: 0-0/12345 (or */0 when empty)
            tot = cr.split("/")[-1]
            return int(tot) if tot.isdigit() else None
    except Exception:
        return None


S3_STEMS: dict[str, list[str]] = {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "data" / "coverage-matrix.json"))
    ap.add_argument("--skip-hot", action="store_true",
                    help="Skip Supabase counts (offline matrix).")
    ap.add_argument("--max-footers", type=int, default=400,
                    help="Cap parquet footer reads (deterministic first-N).")
    ap.add_argument("--max-footer-file-bytes", type=int, default=25_000_000,
                    help="Only read footers for files at most this big.")
    ap.add_argument("--max-footer-total-bytes", type=int, default=300_000_000,
                    help="Cap total bytes downloaded for footer reads.")
    args = ap.parse_args()

    t0 = time.perf_counter()
    s3 = s3_client()
    matrix: dict = {
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "bucket": BUCKET,
        "entities": {},
    }
    footers_used = 0
    footer_bytes = 0
    for entity, prefix in S3_PREFIXES.items():
        files = sorted(s3_list(s3, prefix))
        print(f"[matrix] {entity}: {len(files)} objects listed", flush=True)
        stems: dict[str, dict] = {}
        for key, size in files:
            if not key.endswith(".parquet"):
                continue
            stem = stem_of(key, prefix, entity)
            S3_STEMS.setdefault(entity, []).append(stem)
            gkey = stem.upper() if entity == "businesses" else stem.lower()
            # s3Rows is null until a footer is actually read: presence
            # (files/bytes) is always measured, row counts only when cheap.
            entry = stems.setdefault(gkey, {"s3Rows": None, "s3Bytes": 0,
                                                    "s3Files": 0, "footerMeasured": False})
            entry["s3Files"] += 1
            entry["s3Bytes"] += size
            if (footers_used < args.max_footers and size <= args.max_footer_file_bytes
                    and footer_bytes + size <= args.max_footer_total_bytes):
                n = parquet_rows(s3, key)
                footers_used += 1
                footer_bytes += size
                if n is not None:
                    entry["s3Rows"] = (entry["s3Rows"] or 0) + n
                    entry["footerMeasured"] = True
        matrix["entities"][entity] = {
            "s3Prefix": prefix,
            "geoKind": GEO_KIND[entity],
            "s3Files": len([f for f in files if f[0].endswith(".parquet")]),
            "declaredProviders": DECLARED_PROVIDERS[entity],
            "byGeo": stems,
        }

    hot: dict[str, dict[str, int | None]] = {}
    if not args.skip_hot:
        env = load_dotenv()
        sb_url = (env.get("MY_SUPABASE_URL") or "").rstrip("/")
        sb_key = env.get("MY_SUPABASE_SERVICE_ROLE_KEY") or ""
        if sb_url and sb_key:
            print("[matrix] hot-index counts via Supabase …", flush=True)
            hot = hot_counts(sb_url, sb_key)
            for entity, per_iso in hot.items():
                # Separate map: hot tables are per-ISO for every entity,
                # while S3 byGeo keys are iso2/initial/slug per layout.
                matrix["entities"][entity]["hotIndexByIso"] = per_iso
            matrix["hotIndex"] = {"measured": True,
                                  "via": "supabase-postgrest-count-exact"}
        else:
            matrix["hotIndex"] = {"measured": False,
                                  "reason": "MY_SUPABASE_URL/SERVICE_ROLE absent"}
    else:
        matrix["hotIndex"] = {"measured": False, "reason": "skipped by flag"}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(matrix, indent=1, sort_keys=True), encoding="utf-8")

    geos = sum(len(e["byGeo"]) for e in matrix["entities"].values())
    s3rows = sum(g.get("s3Rows") or 0 for e in matrix["entities"].values()
                 for g in e["byGeo"].values())
    hotrows = sum(n or 0 for e in matrix["entities"].values()
                  for n in e.get("hotIndexByIso", {}).values())
    print(json.dumps({"out": str(out), "geoEntries": geos,
                      "s3RowsMeasured": s3rows, "hotIndexRows": hotrows,
                      "footersRead": footers_used,
                      "elapsedMs": int((time.perf_counter() - t0) * 1000)}, indent=2))


if __name__ == "__main__":
    main()
