"""Run the YC directory slice: fetch → validate → DuckDB → JSONL export.

Writes into the same companies table + companies_complete.jsonl as EDGAR —
the two sources coexist (registry_key = source:registry_id keeps them apart;
domain/name keys let resolve.py corroborate across them).

Usage:  python -m scripts.pipeline.run_yc
"""
from __future__ import annotations

from pathlib import Path

from .sources.yc import fetch_yc_companies
from .store import DuckStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def main() -> None:
    print("[yc] fetching YC companies directory …")
    records = fetch_yc_companies()
    print(f"[yc] validated {len(records)} CompanyRecords")

    store = DuckStore()
    store.ensure_table("companies", records[0] if records else None)
    stats = store.upsert("companies", records)
    print(
        f"[yc] upsert: seen={stats.seen} inserted={stats.inserted} "
        f"updated={stats.updated} touched={stats.touched}"
    )

    out = DATA_DIR / "companies_complete.jsonl"
    n = store.export_jsonl("companies", out)
    print(f"[yc] exported {n} total companies → {out} ({out.stat().st_size / 1024 / 1024:.1f} MiB)")


if __name__ == "__main__":
    main()
