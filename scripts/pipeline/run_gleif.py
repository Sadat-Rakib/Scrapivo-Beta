"""Run a bounded GLEIF sample into the companies table + JSONL export.

Usage:  python -m scripts.pipeline.run_gleif [--pages 10]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from .sources.gleif import fetch_gleif_companies
from .store import DuckStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=10, help="200 records per page (60 req/min cap)")
    args = ap.parse_args()

    print(f"[gleif] fetching {args.pages} pages …")
    records = fetch_gleif_companies(pages=args.pages)
    print(f"[gleif] validated {len(records)} CompanyRecords")

    store = DuckStore()
    store.ensure_table("companies", records[0] if records else None)
    stats = store.upsert("companies", records)
    print(
        f"[gleif] upsert: seen={stats.seen} inserted={stats.inserted} "
        f"updated={stats.updated} touched={stats.touched}"
    )

    out = DATA_DIR / "companies_complete.jsonl"
    n = store.export_jsonl("companies", out)
    print(f"[gleif] exported {n} total companies → {out} ({out.stat().st_size / 1024 / 1024:.1f} MiB)")


if __name__ == "__main__":
    main()
