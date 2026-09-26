"""Safe local -> S3 migration tool (read-only by default).

Usage:
    python tools/s3_migrate.py --dry-run [--profile scrapivo]
    python tools/s3_migrate.py --upload [--profile scrapivo]
    python tools/s3_migrate.py --verify [--profile scrapivo]

Rules (locked plan v3):
- NEVER deletes local files. No --delete flag exists on purpose.
- NEVER renames raw files; preserves original filenames under raw/<entity>/.
- NEVER overwrites existing raw objects without --overwrite flag.
- --dry-run performs ZERO S3 calls (fully offline: categorize + sizes + dest).
- --upload uses boto3 upload_file (automatic multipart for large files),
  retries with backoff, skips identical (HEAD size compare), verifies after.
- Bucket stays private; no ACL/public-url logic anywhere.
- Credentials via named profile / env chain only. No hard-coded secrets.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "data")
REPORT = os.path.join(REPO, "reports", "S3_MIGRATION_REPORT.md")
MANIFEST_JSON = os.path.join(REPO, "reports", "S3_MIGRATION_MANIFEST.json")

BUCKET = "scrapivo-raw-data-2026-523220341033-us-east-2-an"
REGION = "us-east-2"
DEFAULT_PROFILE = "scrapivo"
RETRIES = 4


def categorize(fname):
    n = fname.lower()
    if n.startswith("investors"):
        return "investors"
    if n.startswith("companies") or n.startswith("basiccompanydata"):
        return "companies"
    if n.startswith("local_businesses"):
        return "local-businesses"
    if n.startswith("people"):
        return "people"
    return "other"


def discover():
    items = []
    for fname in sorted(os.listdir(DATA_DIR)):
        fpath = os.path.join(DATA_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        # Skip editor/backup sidecars; raw .bak/.prev/.tmp stay local only.
        if fname.endswith((".bak", ".prev", ".tmp")):
            items.append({
                "file": fname, "size": os.path.getsize(fpath),
                "entity": categorize(fname), "dest": None,
                "note": "sidecar/backup: kept local, NOT migrated",
            })
            continue
        entity = categorize(fname)
        items.append({
            "file": fname, "size": os.path.getsize(fpath),
            "entity": entity, "dest": f"raw/{entity}/{fname}",
            "note": "",
        })
    return items


def cmd_dry_run(profile):
    items = discover()
    migrate = [i for i in items if i["dest"]]
    skipped = [i for i in items if not i["dest"]]
    total = sum(i["size"] for i in migrate)
    print(f"profile={profile} bucket={BUCKET} region={REGION}")
    print(f"files to upload: {len(migrate)} | bytes: {total} ({total/1024**3:.2f} GiB)")
    print(f"sidecars kept local: {len(skipped)}")
    print("destination prefixes:")
    agg = {}
    for i in migrate:
        agg.setdefault(i["entity"], [0, 0])
        agg[i["entity"]][0] += 1
        agg[i["entity"]][1] += i["size"]
    for ent, (c, b) in sorted(agg.items()):
        print(f"  raw/{ent}/  {c} files  {b/1024**2:.1f} MiB")
    print("largest 10:")
    for i in sorted(migrate, key=lambda x: -x["size"])[:10]:
        print(f"  {i['file']}  {i['size']/1024**2:.1f} MiB  -> {i['dest']}")
    print("DRY-RUN COMPLETE: zero S3 calls made, nothing uploaded.")
    with open(MANIFEST_JSON, "w", encoding="utf-8") as f:
        json.dump({"bucket": BUCKET, "region": REGION, "mode": "dry-run",
                   "items": items}, f, indent=2)
    print(f"manifest: {MANIFEST_JSON}")
    return 0


def _client(profile):
    import boto3
    from botocore.config import Config
    sess = boto3.Session(profile_name=profile)
    return sess.client(
        "s3", region_name=REGION,
        config=Config(retries={"max_attempts": RETRIES, "mode": "standard"}),
    )


def cmd_upload(profile, overwrite):
    import botocore
    s3 = _client(profile)
    items = [i for i in discover() if i["dest"]]
    results = []
    for it in items:
        local = os.path.join(DATA_DIR, it["file"])
        key = it["dest"]
        try:
            head = s3.head_object(Bucket=BUCKET, Key=key)
            remote = head.get("ContentLength", -1)
            if remote == it["size"] and not overwrite:
                results.append({**it, "status": "skipped-identical",
                                "remote_size": remote})
                print(f"SKIP identical {it['file']}")
                continue
            if not overwrite:
                results.append({**it, "status": "skipped-exists",
                                "remote_size": remote})
                print(f"SKIP exists (use --overwrite) {it['file']}")
                continue
        except botocore.exceptions.ClientError as e:
            if e.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "NotFound"):
                results.append({**it, "status": f"head-error: {e}"})
                print(f"HEAD-ERROR {it['file']}: {e}")
                continue
        ok = False
        err = ""
        for attempt in range(1, RETRIES + 1):
            try:
                # upload_file does multipart automatically for large files.
                s3.upload_file(local, BUCKET, key)
                ok = True
                break
            except Exception as e:
                err = str(e)[:300]
                print(f"RETRY {attempt}/{RETRIES} {it['file']}: {err}")
                time.sleep(2 ** attempt)
        if not ok:
            results.append({**it, "status": f"FAILED: {err}"})
            continue
        try:
            remote = s3.head_object(Bucket=BUCKET, Key=key).get("ContentLength", -1)
        except Exception as e:
            results.append({**it, "status": f"uploaded-unverified: {e}"[:300]})
            continue
        status = "uploaded-verified" if remote == it["size"] else \
            f"SIZE-MISMATCH local={it['size']} remote={remote}"
        results.append({**it, "status": status, "remote_size": remote})
        print(f"{status} {it['file']}")
    with open(MANIFEST_JSON, "w", encoding="utf-8") as f:
        json.dump({"bucket": BUCKET, "region": REGION, "mode": "upload",
                   "overwrite": overwrite, "items": results}, f, indent=2)
    fails = [r for r in results if r["status"].startswith(("FAILED", "SIZE-MISMATCH"))]
    print(f"upload done: {len(results)-len(fails)}/{len(results)} ok; manifest: {MANIFEST_JSON}")
    return 1 if fails else 0


def cmd_verify(profile):
    import botocore
    s3 = _client(profile)
    items = [i for i in discover() if i["dest"]]
    bad = 0
    for it in items:
        try:
            remote = s3.head_object(Bucket=BUCKET, Key=it["dest"]).get("ContentLength", -1)
            ok = remote == it["size"]
            print(f"{'OK' if ok else 'MISMATCH'} {it['file']} local={it['size']} remote={remote}")
            bad += 0 if ok else 1
        except botocore.exceptions.ClientError as e:
            print(f"MISSING {it['file']}: {e.response.get('Error', {}).get('Code')}")
            bad += 1
    print(f"verify: {len(items)-bad}/{len(items)} match")
    return 1 if bad else 0


def cmd_inventory(profile):
    """Read-only recursive bucket listing -> reports/S3_INVENTORY.*"""
    s3 = _client(profile)
    out_json = os.path.join(REPO, "reports", "S3_INVENTORY.json")
    out_csv = os.path.join(REPO, "reports", "S3_INVENTORY.csv")
    out_md = os.path.join(REPO, "reports", "S3_INVENTORY.md")
    objs, token = [], None
    while True:
        kw = {"Bucket": BUCKET, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        page = s3.list_objects_v2(**kw)
        objs.extend(page.get("Contents", []))
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
    rows = [{"key": o["Key"], "size": o["Size"],
             "last_modified": str(o.get("LastModified", "")),
             "extension": os.path.splitext(o["Key"])[1].lower().lstrip(".")}
            for o in objs]
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["key", "size", "last_modified", "extension"])
        w.writeheader()
        w.writerows(rows)
    total = sum(r["size"] for r in rows)
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("# S3_INVENTORY (generated, read-only listing)\n\n")
        f.write(f"Bucket: {BUCKET} Region: {REGION}\nObjects: {len(rows)} "
                f"Total: {total} bytes ({total/1024**3:.2f} GiB)\n\n")
        f.write("| key | size | last_modified |\n|---|---|---|\n")
        for r in sorted(rows, key=lambda x: -x["size"])[:200]:
            f.write(f"| {r['key']} | {r['size']} | {r['last_modified']} |\n")
    print(f"inventory: {len(rows)} objects, {total/1024**3:.2f} GiB")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Safe local->S3 migration (no deletes).")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--inventory", action="store_true")
    ap.add_argument("--overwrite", action="store_true",
                    help="allow overwriting existing raw objects (default: skip)")
    ap.add_argument("--profile", default=os.environ.get("AWS_PROFILE", DEFAULT_PROFILE))
    a = ap.parse_args()
    if sum([a.dry_run, a.upload, a.verify, a.inventory]) != 1:
        ap.error("pass exactly one of --dry-run | --upload | --verify | --inventory")
    if a.dry_run:
        return cmd_dry_run(a.profile)
    if a.upload:
        return cmd_upload(a.profile, a.overwrite)
    if a.verify:
        return cmd_verify(a.profile)
    return cmd_inventory(a.profile)


if __name__ == "__main__":
    sys.exit(main())
