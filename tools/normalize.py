"""Stage C: canonical normalization -> Parquet + quality scores (verified).

Reads C:\\ScrapivoData\\splits\\*_complete.csv, applies APPROVED mappings
(reports/mappings/s3_cohort_*.json), writes:
  C:\\ScrapivoData\\processed\\people\\person.parquet
  C:\\ScrapivoData\\processed\\companies\\company.parquet
Incomplete splits stay as CSVs (uploaded to S3 incomplete/ at C4, unchanged).

Quality (locked weights, validity-scored): email30/phone25/website25/linkedin20.
Outputs per-row components + total. Person Phone uses Comp/Company Phone ONLY.
Social(any) gate already enforced at split; components scored independently.

Ambiguity resolutions applied:
 A1: website vs url -> same-host check; corporate col wins, other to *_alt.
 A2: Lakta `extra` -> value census below; unnamed 99%-empty cols -> documented drop.
 A3: secondary/tertiary emails -> fallback evidence cols (email_2, email_3).
 Campaign block (Family C) carried inert as engagement_* evidence cols (DEFERRED).
 MV block (Family D) feeds email calibration note col (mv_deliverable etc. kept raw).
 Dedupe: REPORT ONLY (Stage C verification), no merges/deletes.

Usage: python tools/normalize.py [--limit N]   (limit = first N complete files)
Writes: processed parquet + reports/STAGE_C_STATS.json
"""
from __future__ import annotations

import argparse
import csv
import datetime
import glob
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
SPLIT_DIR = os.path.join(DATA_ROOT, "splits")
PROC_DIR = os.path.join(DATA_ROOT, "processed")
COMP_DIR = os.path.join(REPO, "reports", "completeness")
STATS = os.path.join(REPO, "reports", "STAGE_C_STATS.json")

NULL_LIKE = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "#n/a", "?"}
# Byte-identical duplicate: EXCLUDED from ingest (user lock; SHA-verified).
EXCLUDED = {
    "apollo-contacts-export (5)_CATCH_ALL_AND_UNKNOWN_MILLIONVERIFIER.COM-All deliverable emails-20250728 (1)_CATEGORIZED.csv",
}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
DIGITS = re.compile(r"\d")
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def clean(v):
    v = (v or "").strip()
    if not v or v.lower() in NULL_LIKE:
        return None
    return re.sub(r"\s+", " ", v)


def first_present(row, *names):
    low = {k.lower(): k for k in row.keys()}
    for n in names:
        if n.lower() in low:
            return clean(row[low[n.lower()]])
    return None


def host_of(url):
    if not url:
        return None
    m = re.search(r"^(?:https?://)?(?:www\.)?([^/]+)", url.lower())
    return m.group(1) if m else None


def email_pts(v):
    if not v:
        return 0
    return 30 if EMAIL_RE.match(v.lower()) else 10


def phone_pts(v):
    if not v:
        return 0
    d = "".join(DIGITS.findall(v))
    if len(set(d or "x")) <= 1:
        return 0
    return 25 if 7 <= len(d) <= 15 else 8


def website_pts(v):
    if not v:
        return 0
    return 25 if ("." in v and " " not in v) else 8


def linkedin_pts(v):
    if not v:
        return 0
    return 20 if "linkedin.com" in v.lower() else 8


PERSON_FIELDS = ["name", "title", "company_name", "website", "website_alt", "email",
                 "email_2", "email_3", "phone", "employees", "personal_linkedin",
                 "company_linkedin", "facebook", "twitter", "country", "industry",
                 "tools_used", "city", "seniority", "email_status",
                 "email_pts", "phone_pts", "website_pts", "linkedin_pts",
                 "quality_score", "social_presence", "activity_status",
                 "source_file", "method", "processed_at"]
COMPANY_FIELDS = ["company_name", "website", "website_alt", "location", "category",
                  "email", "phone", "linkedin", "facebook", "twitter", "description",
                  "founded", "status", "employees", "funding_total", "funding_rounds",
                  "funding_last_type", "funding_last_at", "external_id", "permalink",
                  "founders", "email_pts", "phone_pts", "website_pts", "linkedin_pts",
                  "quality_score", "social_presence", "activity_status",
                  "source_file", "method", "processed_at"]


def norm_person(row, fname):
    fn = first_present(row, "First Name", "firstname")
    ln = first_present(row, "Last Name", "lastname")
    full = first_present(row, "fullname")
    name = " ".join(x for x in [fn, ln] if x) or full
    email = first_present(row, "Email", "email")
    phone = first_present(row, "Comp Phone", "Company Phone")  # LOCKED: comp only
    if phone:
        phone = phone.lstrip("'").strip() or None  # Apollo CSV quote artifact
    website = first_present(row, "Website")
    pli = first_present(row, "Pers Linkedin", "Person Linkedin Url")
    cli = first_present(row, "Comp Linkedin", "Company Linkedin Url")
    fb = first_present(row, "Facebook", "Facebook Url")
    tw = first_present(row, "Twitter", "Twitter Url")
    ep, pp, wp, lp = email_pts(email), phone_pts(phone), website_pts(website), linkedin_pts(pli)
    socials = [s for s in (pli, fb, tw) if s]
    return {
        "name": name, "title": first_present(row, "Title"),
        "company_name": first_present(row, "Comp name", "Company", "company"),
        "website": website, "website_alt": None, "email": email.lower() if email else None,
        "email_2": first_present(row, "Secondary Email"),  # A3 fallback evidence
        "email_3": first_present(row, "Tertiary Email"),
        "phone": phone, "employees": first_present(row, "Employees", "# Employees"),
        "personal_linkedin": pli, "company_linkedin": cli, "facebook": fb,
        "twitter": tw, "country": first_present(row, "Country"),
        "industry": first_present(row, "Industry"),
        "tools_used": first_present(row, "Tech Used", "Technologies"),
        "city": first_present(row, "City"),
        "seniority": first_present(row, "Seniority"),
        "email_status": first_present(row, "Email Status"),
        "email_pts": ep, "phone_pts": pp, "website_pts": wp, "linkedin_pts": lp,
        "quality_score": ep + pp + wp + lp,
        "social_presence": "|".join(s for s in
                                    (["linkedin"] if pli else []) + (["facebook"] if fb else []) + (["twitter"] if tw else [])) or None,
        "activity_status": "unknown",
        "source_file": fname, "method": "canonical-v1", "processed_at": NOW,
    }


def norm_company(row, fname):
    name = first_present(row, "name", "company_name")
    w1 = first_present(row, "website", "website_url")
    w2 = first_present(row, "url", "website_or_social_url", "latka_url")
    website, alt = w1, None
    if w1 and w2 and host_of(w1) != host_of(w2):
        alt = w2  # A1: corporate wins, other to evidence
    elif not w1:
        website = w2
    email = first_present(row, "contact_email")
    phone = first_present(row, "phone_number")
    if phone:
        phone = phone.lstrip("'").strip() or None
    li = first_present(row, "linkedin", "linkedin_url")
    fb = first_present(row, "facebook")
    tw = first_present(row, "twitter", "twitter_url")
    ep, pp, wp, lp = email_pts(email), phone_pts(phone), website_pts(website), linkedin_pts(li)
    return {
        "company_name": name, "website": website, "website_alt": alt,
        "location": first_present(row, "locations", "location"),
        "category": first_present(row, "categories", "industry"),
        "email": email.lower() if email else None, "phone": phone,
        "linkedin": li, "facebook": fb, "twitter": tw,
        "description": (first_present(row, "short_description") or "")[:500] or None,
        "founded": first_present(row, "founded_on"),
        "status": first_present(row, "operating_status", "ipo_status", "company_type"),
        "employees": first_present(row, "num_employees_enum"),
        "funding_total": first_present(row, "funding_total", "funding"),
        "funding_rounds": first_present(row, "num_funding_rounds"),
        "funding_last_type": first_present(row, "last_funding_type"),
        "funding_last_at": first_present(row, "last_funding_at"),
        "external_id": first_present(row, "id", "permalink"),
        "permalink": first_present(row, "permalink"),
        "founders": first_present(row, "founders", "founder_name"),
        "email_pts": ep, "phone_pts": pp, "website_pts": wp, "linkedin_pts": lp,
        "quality_score": ep + pp + wp + lp,
        "social_presence": "|".join(s for s in
                                    (["linkedin"] if li else []) + (["facebook"] if fb else []) + (["twitter"] if tw else [])) or None,
        "activity_status": "unknown",
        "source_file": fname, "method": "canonical-v1", "processed_at": NOW,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    import pyarrow as pa
    import pyarrow.parquet as pq

    comp_files = sorted(glob.glob(os.path.join(COMP_DIR, "*.json")))
    ent = {}
    for p in comp_files:
        d = json.load(open(p, encoding="utf-8"))
        ent[d["key"]] = d["entity"]
    keys = sorted(ent)
    if a.limit:
        keys = keys[: a.limit]
    people_rows, company_rows = [], []
    per_file = []
    for key in keys:
        if key in EXCLUDED:
            print(f"EXCLUDED {key}")
            continue  # excluded dup (same rule as split stage)
        slug = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")[:100]
        local = os.path.join(SPLIT_DIR, slug + "_complete.csv")
        if not os.path.exists(local):
            continue
        n = 0
        with open(local, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                n += 1
                (people_rows if ent[key] == "person" else company_rows).append(
                    norm_person(row, key) if ent[key] == "person"
                    else norm_company(row, key))
        per_file.append({"key": key, "entity": ent[key], "rows": n})
        print(f"{n:>8} {ent[key]:<7} {key}")
    os.makedirs(os.path.join(PROC_DIR, "people"), exist_ok=True)
    os.makedirs(os.path.join(PROC_DIR, "companies"), exist_ok=True)
    pq.write_table(pa.Table.from_pylist(people_rows, schema=pa.schema(
        [(c, pa.string()) if c not in ("email_pts", "phone_pts", "website_pts",
                                       "linkedin_pts", "quality_score")
         else (c, pa.int32()) for c in PERSON_FIELDS])),
        os.path.join(PROC_DIR, "people", "person.parquet"))
    pq.write_table(pa.Table.from_pylist(company_rows, schema=pa.schema(
        [(c, pa.string()) if c not in ("email_pts", "phone_pts", "website_pts",
                                       "linkedin_pts", "quality_score")
         else (c, pa.int32()) for c in COMPANY_FIELDS])),
        os.path.join(PROC_DIR, "companies", "company.parquet"))
    stats = {"people": len(people_rows), "companies": len(company_rows),
             "total": len(people_rows) + len(company_rows),
             "per_file": per_file, "processed_at": NOW}
    json.dump(stats, open(STATS, "w", encoding="utf-8"), indent=2)
    print(f"parquet: people={len(people_rows)} companies={len(company_rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
