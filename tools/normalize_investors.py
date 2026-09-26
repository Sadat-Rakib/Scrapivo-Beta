"""Investor canonicalization -> Parquet (approved adapters, verified).

Sources (read-only): data/investors_complete.jsonl (1252 clean rows) +
data/investors_merged.json (8098 mixed rows). Dedupe on id (complete first).
Canonical: id,name,kind,firm,role,location_raw,location_city,location_country,
stages[],sectors[],check_min_usd,check_max_usd,email,linkedin,website,
image_url,bio,quality{email,phone,website,linkedin,score},social_presence,
activity_status=unknown,provenance.
Output: C:\\ScrapivoData\\processed\\investors\\investor.parquet (small: no partitions).
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
OUT = os.path.join(DATA_ROOT, "processed", "investors", "investor.parquet")
NOW = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def clean(v):
    v = (v or "").strip() if isinstance(v, str) else v
    return v or None


def money(s):
    s = (s or "").strip().replace("$", "").replace(",", "").replace(" ", "")
    m = re.match(r"^([\d.]+)\s*([kmb])?$", s, re.I)
    if not m:
        return 0
    n = float(m[1])
    u = (m[2] or "").lower()
    return int(n * {"k": 1e3, "m": 1e6, "b": 1e9}.get(u, 1))


def parse_range(s):
    parts = re.split(r"[–—-]", s or "")
    if len(parts) >= 2:
        return money(parts[0]), money(parts[1])
    n = money(s or "")
    return (n, n) if n else (None, None)


def quality(email, phone, website, linkedin):
    ep = 30 if email and EMAIL_RE.match(email.lower()) else (10 if email else 0)
    pp = 25 if phone else 0
    wp = 25 if website and "." in website else 0
    lp = 20 if linkedin and "linkedin.com" in linkedin.lower() else 0
    return ep, pp, wp, lp, ep + pp + wp + lp


def split_loc(loc):
    if isinstance(loc, dict):
        loc = loc.get("raw") or loc.get("city") or loc.get("label") or None
    if not loc or not isinstance(loc, str):
        return None, None
    parts = [p.strip() for p in loc.split(",")]
    if len(parts) >= 2:
        return parts[0], parts[-1]
    return loc, loc


rows, seen = [], set()

# 1. Clean set first (canonical truth for these ids).
with open(os.path.join(REPO, "data", "investors_complete.jsonl"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        seen.add(r.get("id"))
        city = r.get("location_city")
        country = r.get("location_country")
        ep, pp, wp, lp, q = quality(r.get("email"), None, r.get("website"), r.get("linkedin"))
        rows.append({
            "id": r.get("id"), "name": r.get("name"), "kind": "individual",
            "firm": r.get("firm"), "role": r.get("role"),
            "location_raw": r.get("location"), "location_city": city,
            "location_country": country,
            "stages": r.get("stages") or [], "sectors": r.get("sectors") or [],
            "check_min_usd": r.get("check_min_usd"), "check_max_usd": r.get("check_max_usd"),
            "email": (r.get("email") or "").lower() or None, "linkedin": r.get("linkedin"),
            "website": r.get("website"), "image_url": r.get("image_url"),
            "bio": (r.get("bio") or "")[:600] or None,
            "email_pts": ep, "phone_pts": pp, "website_pts": wp, "linkedin_pts": lp,
            "quality_score": q,
            "social_presence": "linkedin" if r.get("linkedin") else None,
            "activity_status": "unknown",
            "provenance": "investors_complete.jsonl",
            "processed_at": NOW,
        })

# 2. Merged-only rows via adapters (skip ids already covered).
merged = json.load(open(os.path.join(REPO, "data", "investors_merged.json"), encoding="utf-8"))["investors"]
added = 0
for r in merged:
    rid = r.get("id") or f"merged-{r.get('name', '')}-{r.get('firm', '')}".lower().replace(" ", "-")[:80]
    if rid in seen:
        continue
    seen.add(rid)
    t = (r.get("type") or "")
    kind = "firm" if t == "firm" else "individual"
    ws = r.get("websites") or {}
    pf = r.get("profiles") or {}
    lk = r.get("links") or {}
    website = r.get("website") or ws.get("firm_website") or ws.get("investor_website") or lk.get("website")
    linkedin = pf.get("linkedin") or lk.get("linkedin")
    email = (r.get("email") or "").lower() or None
    stages = list(r.get("investment_stages") or r.get("stages") or [])
    sectors = list(r.get("investment_sectors") or r.get("sectors") or [])
    cats = r.get("investment_categories") or []
    for c in cats:  # "Stage (Sector)" -> split out
        m = re.match(r"^(.+?)\s*\(([^)]+)\)\s*$", c)
        if m:
            if m.group(1).strip() not in stages:
                stages.append(m.group(1).strip())
            if m.group(2).strip() not in sectors:
                sectors.append(m.group(2).strip())
    sw = r.get("sweet_spot") or {}
    cmin, cmax = (None, None)
    if sw.get("sweet_spot"):
        n = money(sw["sweet_spot"])
        cmin, cmax = (n, n) if n else (money(sw.get("range_min")), money(sw.get("range_max")))
    elif r.get("cheque_size"):
        cmin, cmax = parse_range(r["cheque_size"])
    loc = r.get("location")
    city, country = split_loc(loc)
    loc_raw = loc if isinstance(loc, str) else (json.dumps(loc) if loc else None)
    assoc = r.get("associated_firm")
    firm = r.get("firm") or (assoc.get("name") if isinstance(assoc, dict) else None)
    ep, pp, wp, lp, q = quality(email, None, website, linkedin)
    rows.append({
        "id": rid, "name": r.get("name"), "kind": kind,
        "firm": firm,
        "role": r.get("title") or r.get("role"),
        "location_raw": loc_raw, "location_city": city, "location_country": country,
        "stages": stages, "sectors": sectors,
        "check_min_usd": cmin, "check_max_usd": cmax,
        "email": email, "linkedin": linkedin, "website": website,
        "image_url": lk.get("image_url"),
        "bio": (r.get("bio") or r.get("thesis") or "")[:600] or None,
        "email_pts": ep, "phone_pts": pp, "website_pts": wp, "linkedin_pts": lp,
        "quality_score": q,
        "social_presence": "linkedin" if linkedin else None,
        "activity_status": "unknown",
        "provenance": "investors_merged.json",
        "processed_at": NOW,
    })
    added += 1

import pyarrow as pa
import pyarrow.parquet as pq

os.makedirs(os.path.dirname(OUT), exist_ok=True)
tbl = pa.Table.from_pylist(rows)
pq.write_table(tbl, OUT)
print(f"investors: clean=1252 (minus blanks) merged_added={added} total={len(rows)} -> {OUT}")
print(f"size: {os.path.getsize(OUT)/1024:.0f} KiB")
