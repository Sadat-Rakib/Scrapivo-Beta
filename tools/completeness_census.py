"""Per-CSV completeness census (read-only; full streaming pass, bounded RAM).

Locked gates (user-approved):
  PERSON row COMPLETE = Name + Company + Title + Email + Phone(Comp Phone ONLY)
      + Website + Social(any of LinkedIn/Facebook/Twitter) + Location.
  COMPANY row COMPLETE = name + website + location + category + email AND phone
      (+ people noted as bonus coverage when present, never gated).
  Online presence mandatory (website or social) — implied by the gates above.
  Presence = non-empty after trim and not null-like. Validity stays in quality
  scoring, NOT in this census. No transforms, no writes except reports/.

Usage: python tools/completeness_census.py [--limit N]
Writes: reports/COMPLETENESS_CENSUS.md + reports/completeness/<slug>.json
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROF_DIR = os.path.join(REPO, "reports", "csv_profiles")
OUT_DIR = os.path.join(REPO, "reports", "completeness")
OUT_MD = os.path.join(REPO, "reports", "COMPLETENESS_CENSUS.md")
CACHE = os.path.join(os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData"), "cache")

NULL_LIKE = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "#n/a", "?"}


def slug(key):
    return re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")[:100]


def present(v):
    v = (v or "").strip()
    return bool(v) and v.lower() not in NULL_LIKE


def cols_named(columns, *names):
    low = {c.lower(): c for c in columns}
    return [low[n.lower()] for n in names if n.lower() in low]


def required_spec(columns, entity):
    """Return {field: [columns]} using first-present column per field."""
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
        # Phone = Comp Phone ONLY (locked rule)
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
        loc = cols_named(columns, "Country")
        if not loc:
            loc = cols_named(columns, "Company Country")
        if loc:
            spec["Location"] = [loc[0]]
    else:  # company
        n = cols_named(columns, "name", "company_name")
        if n:
            spec["CompanyName"] = [n[0]]
        w = cols_named(columns, "website", "website_url", "url")
        if w:
            spec["Website"] = w  # any-of ok for website variants
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
    os.makedirs(OUT_DIR, exist_ok=True)
    paths = sorted([p for p in os.listdir(PROF_DIR) if p.endswith(".json")])
    if a.limit:
        paths = paths[: a.limit]
    index = []
    for p in paths:
        prof = json.load(open(os.path.join(PROF_DIR, p), encoding="utf-8"))
        if "error" in prof:
            continue
        key, entity = prof["key"], prof["entity"]
        columns = prof["columns"]
        spec = required_spec(columns, entity)
        missing_spec_fields = []
        # expected fields per entity for reporting gaps
        expected = (["Name", "Company", "Title", "Email", "Phone", "Website",
                     "Social(any)", "Location"] if entity == "person"
                    else ["CompanyName", "Website", "Location", "Category",
                          "Email", "Phone", "Social(any)"])
        for f in expected:
            if f not in spec:
                missing_spec_fields.append(f)
        local = os.path.join(CACHE, slug(key) + ".csv")
        total, complete = 0, 0
        miss_counts = Counter()
        patterns = Counter()
        people_bonus = 0
        bonus_col = None
        if entity == "company":
            bc = cols_named(columns, "founders", "founder_name")
            bonus_col = bc[0] if bc else None
        with open(local, encoding="utf-8-sig", errors="replace", newline="") as f:
            rdr = csv.DictReader(f)
            for row in rdr:
                total += 1
                missing = [fld for fld, cs in spec.items()
                           if not any(present(row.get(c)) for c in cs)]
                # Social(any): missing only if ALL social cols empty
                for fld in missing:
                    miss_counts[fld] += 1
                if not missing and not missing_spec_fields:
                    complete += 1
                else:
                    patterns[tuple(sorted(set(missing) | set("MISSINGCOL:" + m for m in missing_spec_fields)))] += 1
                if bonus_col and present(row.get(bonus_col)):
                    people_bonus += 1
        rec = {
            "key": key, "entity": entity, "rows": total,
            "required_fields": expected,
            "absent_columns": missing_spec_fields,
            "complete": complete, "incomplete": total - complete,
            "complete_pct": round(100.0 * complete / total, 1) if total else 0,
            "missing_counts": dict(miss_counts),
            "top_patterns": [{"missing": list(k), "rows": v}
                             for k, v in patterns.most_common(20)],
            "people_bonus_rows": people_bonus,
        }
        json.dump(rec, open(os.path.join(OUT_DIR, slug(key) + ".json"), "w",
                            encoding="utf-8"), indent=2)
        index.append(rec)
        print(f"{complete:>8}/{total:<8} ({rec['complete_pct']:>5}%) {entity:<7} {key}")
    # rollup
    tot_rows = sum(r["rows"] for r in index)
    tot_comp = sum(r["complete"] for r in index)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# COMPLETENESS_CENSUS (generated, full streaming pass, read-only)\n\n")
        f.write("Gates — PERSON: Name+Company+Title+Email+Phone(Comp Phone only)+"
                "Website+Social(any)+Location. COMPANY: name+website+location+"
                "category+email AND phone (+people bonus, not gated). "
                "Presence only; validity stays in quality scoring.\n\n")
        f.write(f"Files: {len(index)} | Rows: {tot_rows} | "
                f"Complete: {tot_comp} ({100.0*tot_comp/tot_rows:.1f}%) | "
                f"Incomplete: {tot_rows-tot_comp}\n\n")
        f.write("| file | entity | rows | complete | % | top missing |\n"
                "|---|---|---|---|---|---|\n")
        for r in sorted(index, key=lambda x: -x["rows"]):
            top = "; ".join(
                f"{','.join(p['missing'][:3])}:{p['rows']}"
                for p in r["top_patterns"][:3])
            f.write(f"| {r['key']} | {r['entity']} | {r['rows']} | "
                    f"{r['complete']} | {r['complete_pct']} | {top} |\n")
        f.write("\nPer-file detail: `reports/completeness/<slug>.json`.\n"
                "NO splits written. NO transforms run. STOP for review.\n")
    print(f"census: {len(index)} files, {tot_rows} rows, {tot_comp} complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
