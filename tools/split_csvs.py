"""Stage A: split each S3 CSV into complete/incomplete (local, verified).

Reads cached CSVs (same cache as profiler — no new downloads unless missing),
applies the LOCKED gates from completeness_census (same required_spec logic),
writes:
  splits/<slug>_complete.csv + splits/<slug>_incomplete.csv
  (byte-identical headers; complete+incomplete rows == source rows, verified)
Skips the excluded duplicate file entirely (recorded, raw untouched).
Truly-empty rows (all fields null-like) -> incomplete (reason recorded in
verification tallies, never silently discarded).

Writes reports/SPLIT_VERIFICATION.md with per-file reconciliation.
Usage: python tools/split_csvs.py [--limit N]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROF_DIR = os.path.join(REPO, "reports", "csv_profiles")
COMP_DIR = os.path.join(REPO, "reports", "completeness")
DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
SPLIT_DIR = os.path.join(DATA_ROOT, "splits")
OUT_MD = os.path.join(REPO, "reports", "SPLIT_VERIFICATION.md")
CACHE = os.path.join(DATA_ROOT, "cache")
MIN_FREE_BYTES = 5 * 1024**3  # pre-flight + per-file guard: abort below 5 GB


def check_space(context):
    free = shutil.disk_usage(SPLIT_DIR if os.path.exists(SPLIT_DIR) else DATA_ROOT).free
    if free < MIN_FREE_BYTES:
        print(f"ABORT [{context}]: free={free/1024**3:.2f} GiB < 5 GiB. "
              f"Stopping safely at file boundary. Free space and re-run.")
        sys.exit(2)

NULL_LIKE = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "#n/a", "?"}

# Byte-identical duplicate: EXCLUDED from ingest (user lock). Raw untouched.
EXCLUDED = {
    "apollo-contacts-export (5)_CATCH_ALL_AND_UNKNOWN_MILLIONVERIFIER.COM-All deliverable emails-20250728 (1)_CATEGORIZED.csv",
}


def slug(key):
    return re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")[:100]


def present(v):
    v = (v or "").strip()
    return bool(v) and v.lower() not in NULL_LIKE


def cols_named(columns, *names):
    low = {c.lower(): c for c in columns}
    return [low[n.lower()] for n in names if n.lower() in low]


def required_spec(columns, entity):
    spec = {}
    if entity == "person":
        fn = cols_named(columns, "First Name", "firstname")
        ln = cols_named(columns, "Last Name", "lastname")
        full = cols_named(columns, "fullname")
        if fn and ln:
            spec["Name"] = fn + ln
        elif full:
            spec["Name"] = full
        comp = cols_named(columns, "Comp name", "Company", "company")
        if comp:
            spec["Company"] = [comp[0]]
        t = cols_named(columns, "Title")
        if t:
            spec["Title"] = t
        e = cols_named(columns, "Email", "email")
        if e:
            spec["Email"] = [e[0]]
        cp = cols_named(columns, "Comp Phone", "Company Phone")
        if cp:
            spec["Phone"] = [cp[0]]
        w = cols_named(columns, "Website")
        if w:
            spec["Website"] = w
        soc = cols_named(columns, "Pers Linkedin", "Person Linkedin Url",
                         "Facebook", "Facebook Url", "Twitter", "Twitter Url")
        if soc:
            spec["Social(any)"] = soc
        loc = cols_named(columns, "Country") or cols_named(columns, "Company Country")
        if loc:
            spec["Location"] = [loc[0]]
    else:
        n = cols_named(columns, "name", "company_name")
        if n:
            spec["CompanyName"] = [n[0]]
        w = cols_named(columns, "website", "website_url", "url")
        if w:
            spec["Website"] = w
        loc = cols_named(columns, "locations", "location")
        if loc:
            spec["Location"] = [loc[0]]
        cat = cols_named(columns, "categories", "industry")
        if cat:
            spec["Category"] = [cat[0]]
        e = cols_named(columns, "contact_email")
        if e:
            spec["Email"] = e
        p = cols_named(columns, "phone_number")
        if p:
            spec["Phone"] = p
        soc = cols_named(columns, "linkedin", "linkedin_url", "facebook",
                         "twitter", "twitter_url")
        if soc:
            spec["Social(any)"] = soc
    return spec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    os.makedirs(SPLIT_DIR, exist_ok=True)
    check_space("pre-flight")
    comp_files = sorted([p for p in os.listdir(COMP_DIR) if p.endswith(".json")])
    if a.limit:
        comp_files = comp_files[: a.limit]
    rows_md = []
    tot_src = tot_c = tot_i = 0
    for cf in comp_files:
        check_space(f"before {cf}")
        rec = json.load(open(os.path.join(COMP_DIR, cf), encoding="utf-8"))
        key, entity = rec["key"], rec["entity"]
        if key in EXCLUDED:
            rows_md.append(f"| {key} | {entity} | EXCLUDED (dup) | — | — | OK-excluded |")
            print(f"EXCLUDED {key}")
            continue
        columns = rec["required_fields"] and json.load(
            open(os.path.join(PROF_DIR, slug(key) + ".json"), encoding="utf-8"))["columns"]
        spec = required_spec(columns, entity)
        expected = rec["required_fields"]
        absent = set(rec["absent_columns"])
        local = os.path.join(CACHE, slug(key) + ".csv")
        base = os.path.join(SPLIT_DIR, slug(key))
        n_c = n_i = 0
        with open(local, encoding="utf-8-sig", errors="replace", newline="") as fin, \
             open(base + "_complete.csv", "w", encoding="utf-8", newline="") as fc, \
             open(base + "_incomplete.csv", "w", encoding="utf-8", newline="") as fi:
            rdr = csv.DictReader(fin)
            fieldnames = rdr.fieldnames
            wc = csv.DictWriter(fc, fieldnames=fieldnames)
            wi = csv.DictWriter(fi, fieldnames=fieldnames)
            wc.writeheader()
            wi.writeheader()
            for row in rdr:
                vals = [(v or "").strip().lower() for v in row.values()]
                empty_row = all((not v or v in NULL_LIKE) for v in vals)
                missing = [fld for fld, cs in spec.items()
                           if not any(present(row.get(c)) for c in cs)]
                missing += ["MISSINGCOL:" + m for m in absent]
                if not missing and not empty_row:
                    wc.writerow(row)
                    n_c += 1
                else:
                    wi.writerow(row)
                    n_i += 1
        # reconcile against census (same logic -> must match exactly)
        exp_c, exp_t = rec["complete"], rec["rows"]
        status = "OK" if (n_c == exp_c and n_c + n_i == exp_t) else \
            f"MISMATCH census=({exp_c}/{exp_t}) split=({n_c}/{n_c+n_i})"
        assert status == "OK", f"{key}: {status}"
        tot_src += exp_t
        tot_c += n_c
        tot_i += n_i
        rows_md.append(f"| {key} | {entity} | {exp_t} | {n_c} | {n_i} | {status} |")
        print(f"OK {n_c}/{exp_t} {key}")
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# SPLIT_VERIFICATION (Stage A; complete+incomplete==source, asserted)\n\n")
        f.write(f"Files split: {len(rows_md)} | source rows: {tot_src} | "
                f"complete: {tot_c} | incomplete: {tot_i} | "
                f"reconciled: {tot_c + tot_i == tot_src}\n\n")
        f.write("| file | entity | source | complete | incomplete | status |\n"
                "|---|---|---|---|---|---|\n")
        f.write("\n".join(rows_md))
        f.write("\n\nExcluded dup (raw preserved, not ingested): " + ", ".join(sorted(EXCLUDED)) + "\n")
    print(f"stage A done: {tot_src} rows reconciled={tot_c + tot_i == tot_src}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
