"""Profile S3 CSV cohort (read-only GETs; streaming csv parse, bounded RAM).

Downloads each .csv object to TEMP dir (skip-if-same-size), streams rows in
chunks, and records per file:
  columns, row count, null/missing rate per column (top 40 cols),
  representative values (up to 3 samples per column, truncated),
  contact-field detection (email/phone/website/linkedin/social),
  activity-candidate fields, source-metadata columns,
  probable entity + confidence (heuristic, value-checked).

Writes:
  reports/CSV_DATASET_INVENTORY.csv   (one row per file, summary)
  reports/CSV_DATASET_INVENTORY.md    (human-readable + entity rollup)
  reports/csv_profiles/<slug>.json    (per-file detail)

Usage: python tools/profile_s3_csvs.py [--profile scrapivo] [--limit N] [--refresh]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "reports", "csv_profiles")
OUT_CSV = os.path.join(REPO, "reports", "CSV_DATASET_INVENTORY.csv")
OUT_MD = os.path.join(REPO, "reports", "CSV_DATASET_INVENTORY.md")
CACHE = os.path.join(os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData"), "cache")

BUCKET = "scrapivo-raw-data-2026-523220341033-us-east-2-an"
REGION = "us-east-2"
SAMPLE_ROWS = 4000  # cap streamed rows per file for value stats (row count is exact)
MAX_COLS = 80

NULL_LIKE = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "#n/a", "?"}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
PHONE_DIGITS = re.compile(r"\d")


def s3_client(profile):
    import boto3
    return boto3.Session(profile_name=profile).client("s3", region_name=REGION)


def slug(key):
    s = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
    return s[:100]


def col_role(name):
    n = name.lower()
    if any(k in n for k in ("email", "e-mail", "mail")):
        return "email"
    if any(k in n for k in ("phone", "mobile", "tel", "fax", "cell")):
        return "phone"
    if "linkedin" in n:
        return "linkedin"
    if any(k in n for k in ("twitter", "x_handle", "facebook", "instagram", "youtube")):
        return "social"
    if any(k in n for k in ("website", "site", "domain", "url", "web")):
        return "website"
    if any(k in n for k in ("first", "fname", "given")) and "name" in n:
        return "first_name"
    if any(k in n for k in ("last", "lname", "family", "surname")) and "name" in n:
        return "last_name"
    if n.strip() in ("name", "full name", "fullname", "contact name", "lead name"):
        return "full_name"
    if any(k in n for k in ("company", "organization", "organisation", "account", "employer", "business")):
        return "company"
    if any(k in n for k in ("title", "job title", "position", "role", "designation")):
        return "title"
    if any(k in n for k in ("countr", "nation")):
        return "country"
    if any(k in n for k in ("industr", "sector", "vertical", "category", "niche")):
        return "industry"
    if any(k in n for k in ("employee", "headcount", "company size", "size")):
        return "employees"
    if any(k in n for k in ("tech", "stack", "tools")):
        return "tech"
    if any(k in n for k in ("keyword", "seo", "description", "notes", "about")):
        return "descriptive"
    return "other"


def valid_email(v):
    return bool(EMAIL_RE.match(v.strip().lower()))


def valid_phone(v):
    d = "".join(PHONE_DIGITS.findall(v))
    if len(set(d)) <= 1:
        return False
    return 7 <= len(d) <= 15


def detect_entity(columns, roles, samples):
    roleset = set(roles.values())
    has_person = bool({"first_name", "last_name", "full_name"} & roleset)
    has_title = "title" in roleset
    has_company = "company" in roleset
    # value check: person names look like names, not domains
    name_vals = []
    for c, r in roles.items():
        if r in ("first_name", "last_name", "full_name"):
            name_vals += [s for s in samples.get(c, []) if s and "." not in s and "@" not in s]
    if has_person and (has_company or has_title) and len(name_vals) >= 2:
        return "person", 0.9, "name columns + company/title with name-like values"
    if has_person and len(name_vals) >= 2:
        return "person", 0.7, "name columns with name-like values"
    if has_company and not has_person:
        return "company", 0.7, "company columns, no person-name columns"
    cols = " ".join(columns).lower()
    if any(k in cols for k in ("investor", "fund", "check", "thesis", "portfolio", "stage")):
        return "investor", 0.6, "investor-like columns"
    if any(k in cols for k in ("category", "address", "locality", "hours", "rating")):
        return "local-business", 0.6, "places-like columns"
    if has_company:
        return "mixed", 0.5, "company present but schema ambiguous"
    return "unknown", 0.3, "no decisive columns"


def profile_file(local_path):
    cols, n = None, 0
    counts = {}
    samples = {}
    with open(local_path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        # sniff dialect from first chunk
        head = f.read(65536)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(head, delimiters=[",", ";", "\t", "|"])
            delim = dialect.delimiter
        except Exception:
            delim = ","
        reader = csv.DictReader(f, delimiter=delim)
        cols = [c for c in (reader.fieldnames or [])][:MAX_COLS]
        counts = {c: 0 for c in cols}
        non_null = {c: 0 for c in cols}
        for row in reader:
            n += 1
            if n > SAMPLE_ROWS:
                # keep counting rows exactly, stop value stats
                continue
            for c in cols:
                v = (row.get(c) or "").strip()
                key = c
                if v and v.lower() not in NULL_LIKE:
                    non_null[c] += 1
                    if len(samples.setdefault(key, [])) < 3 and len(v) <= 120:
                        samples[key].append(v)
                counts[c] += 1
        # exact total rows even beyond sample cap
        if n > SAMPLE_ROWS:
            pass
    # count remaining rows exactly (we already iterated all rows above; n is exact)
    roles = {c: col_role(c) for c in cols}
    miss = {}
    denom = min(n, SAMPLE_ROWS) or 1
    for c in cols:
        miss[c] = round(100.0 * (denom - non_null.get(c, 0)) / denom, 1)
    # contact validity on sampled values
    validity = {}
    for c, r in roles.items():
        vals = samples.get(c, [])
        if r == "email" and vals:
            validity[c] = f"{sum(valid_email(v) for v in vals)}/{len(vals)} valid-shape"
        elif r == "phone" and vals:
            validity[c] = f"{sum(valid_phone(v) for v in vals)}/{len(vals)} valid-shape"
    entity, conf, why = detect_entity(cols, roles, samples)
    social_cols = [c for c, r in roles.items() if r in ("linkedin", "social", "website")]
    activity_keys = [c for c, r in roles.items()
                     if r in ("linkedin", "social", "website", "company", "full_name",
                              "first_name", "last_name", "email", "phone")]
    return {
        "columns": cols, "row_count": n, "sampled_rows": min(n, SAMPLE_ROWS),
        "delimiter": delim, "roles": roles, "missing_pct": miss,
        "samples": samples, "validity": validity,
        "entity": entity, "entity_confidence": conf, "entity_why": why,
        "social_cols": social_cols, "activity_match_keys": activity_keys,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "scrapivo"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    s3 = s3_client(a.profile)
    objs = []
    token = None
    while True:
        kw = {"Bucket": BUCKET, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        page = s3.list_objects_v2(**kw)
        objs.extend([o for o in page.get("Contents", []) if o["Key"].lower().endswith(".csv")])
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
    objs.sort(key=lambda o: o["Key"].lower())
    if a.limit:
        objs = objs[: a.limit]
    index = []
    for o in objs:
        key, size = o["Key"], o["Size"]
        local = os.path.join(CACHE, slug(key) + ".csv")
        if a.refresh or not (os.path.exists(local) and os.path.getsize(local) == size):
            print(f"GET {size/1024:.0f} KiB  {key}")
            s3.download_file(BUCKET, key, local)
        else:
            print(f"CACHE {key}")
        try:
            prof = profile_file(local)
        except Exception as e:
            prof = {"error": str(e)[:300]}
        rec = {"key": key, "size": size,
               "last_modified": str(o.get("LastModified", "")), **prof}
        with open(os.path.join(OUT_DIR, slug(key) + ".json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, indent=2, ensure_ascii=False)
        index.append({
            "key": key, "size_kb": round(size / 1024),
            "rows": prof.get("row_count", ""),
            "columns": len(prof.get("columns", [])),
            "entity": f"{prof.get('entity','?')} ({prof.get('entity_confidence','?')})",
            "contact_roles": ",".join(sorted({r for r in prof.get("roles", {}).values()
                                              if r in ("email", "phone", "website", "linkedin", "social")})),
        })
        print(f"  rows={prof.get('row_count')} cols={len(prof.get('columns', []))} "
              f"entity={prof.get('entity')} conf={prof.get('entity_confidence')}")
    import csv as _csv
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = _csv.DictWriter(f, fieldnames=["key", "size_kb", "rows", "columns", "entity",
                                           "contact_roles"])
        w.writeheader()
        w.writerows(index)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# CSV_DATASET_INVENTORY (generated, read-only GETs; no transforms)\n\n")
        f.write(f"Files: {len(index)} | Cohort: new S3 CSVs at bucket root\n\n")
        f.write("| file | KiB | rows | cols | entity (conf) | contact cols |\n"
                "|---|---|---|---|---|---|\n")
        for r in index:
            f.write(f"| {r['key']} | {r['size_kb']} | {r['rows']} | {r['columns']} "
                    f"| {r['entity']} | {r['contact_roles']} |\n")
        f.write("\nPer-file detail: `reports/csv_profiles/<slug>.json` "
                "(columns, missing %, samples, validity, match keys).\n")
    print(f"inventory: {len(index)} files -> {OUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
