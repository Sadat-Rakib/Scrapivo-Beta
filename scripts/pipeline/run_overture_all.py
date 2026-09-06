"""Walk the whole country manifest, region by region, resumable.

Skips countries whose JSONL already exists (delete the file to force a
re-extract). Designed to run in the background for hours:

  python -m scripts.pipeline.run_overture_all            # all remaining
  python -m scripts.pipeline.run_overture_all --wave 1   # flagship subset
  python -m scripts.pipeline.run_overture_all --only GB,DE,FR
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import duckdb

from .countries import COUNTRIES, WAVE_1
from .run_overture import DATA_DIR, export_regions_manifest, extract_country, track
from .store import DuckStore

MIN_FREE_GB = 3.0


def done_countries() -> set[str]:
    store = DuckStore()
    try:
        rows = store.con.execute("SELECT country FROM local_files").fetchall()
        return {r[0] for r in rows}
    except duckdb.CatalogException:
        return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wave", type=int, choices=[1], help="flagship subset only")
    ap.add_argument("--only", help="comma-separated ISO2 list")
    ap.add_argument("--force", action="store_true", help="re-extract even if the file exists")
    args = ap.parse_args()

    if args.only:
        order = [iso.strip().upper() for iso in args.only.split(",")]
    elif args.wave:
        order = WAVE_1
    else:
        order = [c.iso2 for c in COUNTRIES]

    done = done_countries()
    if args.force:
        todo = [c for c in COUNTRIES if c.iso2 in order]
        for c in todo:
            f = DATA_DIR / f"local_businesses_{c.file_stem}.jsonl"
            if f.exists():
                f.unlink()
    else:
        todo = [c for c in COUNTRIES if c.iso2 in order and c.iso2 not in done]
    skipped = len([c for c in COUNTRIES if c.iso2 in order]) - len(todo)
    print(f"[overture-all] {len(todo)} countries to extract ({skipped} already done)")

    for i, country in enumerate(todo, 1):
        free = shutil.disk_usage(DATA_DIR).free / 1024**3
        if free < MIN_FREE_GB:
            print(f"[overture-all] STOP — only {free:.1f} GB free (need ≥{MIN_FREE_GB})")
            break
        print(f"[overture-all] ({i}/{len(todo)}) {country.name} [{country.iso2}] cap={country.cap:,}")
        try:
            out, total, sha, elapsed = extract_country(country, 0.6, country.cap)
            track(country, total, sha, elapsed)
        except Exception as e:  # noqa: BLE001 — one country failing never stops the run
            print(f"[overture-all] {country.iso2} FAILED: {str(e)[:200]}")
            continue

    export_regions_manifest()
    print("[overture-all] complete — status:")
    for c in sorted(COUNTRIES, key=lambda x: x.region):
        f = DATA_DIR / f"local_businesses_{c.file_stem}.jsonl"
        status = f"{f.stat().st_size / 1024 / 1024:.0f} MiB" if f.exists() else "—"
        print(f"  {c.iso2}  {c.name:<28} {status}")


if __name__ == "__main__":
    main()
