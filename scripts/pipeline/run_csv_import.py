"""Import user-supplied people CSVs into the people table + JSONL export.

Every row is provenance-marked (csv:{file}:{row}); malformed emails are
dropped, unparseable LinkedIn URLs are dropped, dedupe is by LinkedIn slug.
Nothing is invented â€” a row with no usable name never enters the DB.

Usage:
  python -m scripts.pipeline.run_csv_import --csv data/people_al.csv [--csv data/people_xk.csv ...]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from .store import DuckStore
from .sources.csv_people import parse_csv

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", action="append", required=True, help="user CSV file (repeatable)")
    args = ap.parse_args()

    store = DuckStore()
    total_stats = {"rows": 0, "kept": 0, "dropped_no_name": 0, "dropped_bad_linkedin": 0, "deduped": 0}
    for csv_path in args.csv:
        records, stats = parse_csv(csv_path)
        for k in total_stats:
            total_stats[k] += stats.get(k, 0)
        if records:
            store.ensure_table("people", records[0])
            up = store.upsert("people", records)
            print(
                f"[csv] {csv_path}: rows={stats['rows']} kept={stats['kept']} "
                f"dropped_no_name={stats['dropped_no_name']} "
                f"dropped_bad_linkedin={stats['dropped_bad_linkedin']} "
                f"deduped={stats['deduped']} â†’ upsert seen={up.seen} "
                f"inserted={up.inserted} updated={up.updated} touched={up.touched}"
            )
        else:
            print(f"[csv] {csv_path}: no usable rows (stats={stats})")

    out = DATA_DIR / "people_complete.jsonl"
    n = store.export_jsonl("people", out)
    print(f"[csv] exported {n} people â†’ {out} ({out.stat().st_size / 1024:.0f} KiB)")
    print(f"[csv] totals={total_stats}")


if __name__ == "__main__":
    main()
