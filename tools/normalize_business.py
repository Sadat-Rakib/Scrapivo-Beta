"""Business canonical sample index (bounded corpus; streaming).

Reads local_businesses_{stem}.jsonl from data/ (repo, read-only), writes
canonical Parquet to C:\\ScrapivoData\\processed\\businesses\\business.parquet.
Canonical: registry_id,name,category(canonical craft or raw),categories_raw,
address,locality,region,country,lat,lon,phone,email,website,domain,
confidence,evidence,quality_score,social_presence,activity_status,source_file.
Junk-flagged rows (landmarks/parks) KEPT with junk_flag=1, filtered at query.

Usage: python tools/normalize_business.py austin gb de
"""
import json
import os
import re
import sys

DATA_ROOT = os.environ.get("SCRAPIVO_DATA_ROOT", r"C:\ScrapivoData")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(DATA_ROOT, "processed", "businesses", "by_country")

CRAFT = {
    "plumber": "plumber", "plumbing": "plumber", "dentist": "dentist",
    "dental": "dentist", "restaurant": "restaurant", "cafe": "cafe",
    "coffee_shop": "cafe", "gym": "gym", "salon": "salon", "barber": "barber",
    "lawyer": "lawyer", "attorney": "lawyer", "electrician": "electrician",
    "roofer": "roofer", "roofing": "roofer", "hotel": "hotel",
    "bakery": "bakery", "florist": "florist", "spa": "spa",
}
JUNK = {"landmark_and_historical_building", "park", "national_park", "monument",
        "museum", "church", "school", "parking"}


def canon_cat(cat, cats):
    for c in [cat] + list(cats or []):
        if c and c.lower() in CRAFT:
            return CRAFT[c.lower()]
    return (cat or "").lower() or None


def main():
    import glob as _glob
    import pyarrow as pa
    import pyarrow.parquet as pq
    import shutil
    stems = sys.argv[1:]
    if not stems or stems == ["ALL"]:
        stems = sorted(
            os.path.basename(p)[len("local_businesses_"):-len(".jsonl")]
            for p in _glob.glob(os.path.join(REPO, "data", "local_businesses_*.jsonl"))
        )
    os.makedirs(OUT_DIR, exist_ok=True)
    # 5 GB pre-flight guard (locked recovery rule).
    if shutil.disk_usage(OUT_DIR).free < 5 * 1024**3:
        print("ABORT: free space < 5 GiB. Stopping safely at file boundary.")
        sys.exit(2)
    grand = 0
    for stem in stems:
        out = os.path.join(OUT_DIR, f"{stem}.parquet")
        if os.path.exists(out):
            print(f"SKIP exists {stem}")
            continue
        if shutil.disk_usage(OUT_DIR).free < 5 * 1024**3:
            print(f"ABORT at {stem}: free space < 5 GiB. Re-run resumes (skip-exists).")
            sys.exit(2)
        p = os.path.join(REPO, "data", f"local_businesses_{stem}.jsonl")
        rows = []
        with open(p, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cat = o.get("category")
                phone, web = o.get("phone"), o.get("website")
                q = (6 if phone else 0) + (6 if web else 0)
                q += (25 if web and "." in web else 0)
                rows.append({
                    "registry_id": o.get("registry_id"),
                    "name": o.get("name"),
                    "category": canon_cat(cat, o.get("categories")),
                    "category_raw": cat,
                    "junk_flag": 1 if (cat or "").lower() in JUNK else 0,
                    "address": o.get("address_normalized") or o.get("address_raw"),
                    "locality": o.get("locality"), "region": o.get("region"),
                    "country": o.get("country"),
                    "lat": o.get("latitude"), "lon": o.get("longitude"),
                    "phone": phone, "email": o.get("email"), "website": web,
                    "domain": o.get("domain"),
                    "confidence": o.get("confidence_score") or o.get("confidence"),
                    "evidence": "|".join(o.get("evidence") or []),
                    "quality_score": q,
                    "social_presence": "website" if web else None,
                    "activity_status": "unknown",
                    "source_file": f"local_businesses_{stem}.jsonl",
                })
        pq.write_table(pa.Table.from_pylist(rows), out)
        grand += len(rows)
        print(f"{len(rows)} rows -> {stem}.parquet")
    print(f"business corpus total this run: {grand} rows")


if __name__ == "__main__":
    main()
