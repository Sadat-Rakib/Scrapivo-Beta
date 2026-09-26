"""Stage C4: first S3 data placement (canonical Parquet + incomplete splits).

Uploads (multipart via upload_file, 4 retries, skip-identical, HEAD-verify):
  C:\\ScrapivoData\\processed\\people\\person.parquet
      -> s3://BUCKET/processed/people/person.parquet
  C:\\ScrapivoData\\processed\\companies\\company.parquet
      -> s3://BUCKET/processed/companies/company.parquet
  C:\\ScrapivoData\\splits\\*_incomplete.csv
      -> s3://BUCKET/incomplete/<people|companies>/<slug>_incomplete.csv
Entity per slug resolved from reports/completeness/*.json.
Writes reports/STAGE_C_UPLOAD.json (per-object local/remote sizes + status).
Usage: python tools/upload_processed.py [--dry-run]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
OUT = os.path.join(REPO, "reports", "STAGE_C_UPLOAD.json")
BUCKET = "scrapivo-raw-data-2026-523220341033-us-east-2-an"
REGION = "us-east-2"
RETRIES = 4


def collect():
    import re
    items = [
        (os.path.join(DATA_ROOT, "processed", "people", "person.parquet"),
         "processed/people/person.parquet"),
        (os.path.join(DATA_ROOT, "processed", "companies", "company.parquet"),
         "processed/companies/company.parquet"),
    ]
    ent = {}
    for p in glob.glob(os.path.join(REPO, "reports", "completeness", "*.json")):
        d = json.load(open(p, encoding="utf-8"))
        slug = re.sub(r"[^a-z0-9]+", "_", d["key"].lower()).strip("_")[:100]
        ent[slug] = d["entity"]
    for local in sorted(glob.glob(os.path.join(DATA_ROOT, "splits", "*_incomplete.csv"))):
        slug = os.path.basename(local)[: -len("_incomplete.csv")]
        e = ent.get(slug, "other")
        e = {"person": "people", "company": "companies"}.get(e, e)  # locked layout
        items.append((local, f"incomplete/{e}/{os.path.basename(local)}"))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    items = collect()
    total = sum(os.path.getsize(l) for l, _ in items)
    print(f"objects: {len(items)} | bytes: {total} ({total/1024**3:.2f} GiB)")
    if a.dry_run:
        for l, k in items[:5]:
            print(f"  {os.path.getsize(l)/1024**2:.1f} MiB -> {k}")
        print(f"  ... +{len(items)-5} more. DRY-RUN: no S3 calls.")
        return 0
    import boto3
    import botocore
    from botocore.config import Config
    s3 = boto3.Session(profile_name="scrapivo").client(
        "s3", region_name=REGION,
        config=Config(retries={"max_attempts": RETRIES, "mode": "standard"}))
    results = []
    for local, key in items:
        size = os.path.getsize(local)
        try:
            head = s3.head_object(Bucket=BUCKET, Key=key)
            if head.get("ContentLength") == size:
                results.append({"key": key, "status": "skipped-identical",
                                "local": size, "remote": size})
                print(f"SKIP identical {key}")
                continue
        except botocore.exceptions.ClientError as e:
            if e.response.get("Error", {}).get("Code") not in (
                    "404", "NoSuchKey", "NotFound"):
                results.append({"key": key, "status": f"head-error {e}"[:200]})
                continue
        ok, err = False, ""
        for att in range(1, RETRIES + 1):
            try:
                s3.upload_file(local, BUCKET, key)
                ok = True
                break
            except Exception as e:
                err = str(e)[:200]
                print(f"RETRY {att}/{RETRIES} {key}: {err}")
                time.sleep(2 ** att)
        if not ok:
            results.append({"key": key, "status": f"FAILED {err}"})
            continue
        remote = s3.head_object(Bucket=BUCKET, Key=key).get("ContentLength", -1)
        st = "uploaded-verified" if remote == size else f"SIZE-MISMATCH {size}/{remote}"
        results.append({"key": key, "status": st, "local": size, "remote": remote})
        print(f"{st} {key}")
    json.dump(results, open(OUT, "w", encoding="utf-8"), indent=2)
    bad = [r for r in results if not r["status"].endswith(("verified", "identical"))]
    print(f"done: {len(results)-len(bad)}/{len(results)} ok -> {OUT}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
