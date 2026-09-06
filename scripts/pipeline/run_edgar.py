"""Run the SEC EDGAR slice end-to-end:

fetch → normalize → pydantic validate → DuckDB upsert (content-hash diff) →
data/companies_complete.jsonl (the file Scrapivo ingests).

Usage:  python -m scripts.pipeline.run_edgar
"""
from __future__ import annotations

from pathlib import Path

from .sources.edgar import fetch_edgar_companies
from .store import DuckStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def main() -> None:
    print("[edgar] fetching company_tickers.json …")
    records = fetch_edgar_companies()
    print(f"[edgar] validated {len(records)} CompanyRecords")

    store = DuckStore()
    store.ensure_table("companies", records[0] if records else None)
    stats = store.upsert("companies", records)
    print(
        f"[edgar] upsert: seen={stats.seen} inserted={stats.inserted} "
        f"updated={stats.updated} touched={stats.touched}"
    )

    out = DATA_DIR / "companies_complete.jsonl"
    n = store.export_jsonl("companies", out)
    print(f"[edgar] exported {n} rows → {out} ({out.stat().st_size / 1024:.0f} KiB)")

    stale = store.mark_stale("companies", older_than_days=30)
    print(f"[edgar] rows not seen in 30d (flag-only, no removal): {stale}")


if __name__ == "__main__":
    main()
