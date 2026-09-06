"""DuckDB store — upsert with content-hash change detection + JSONL export.

Tables are per-collection (companies / local_businesses / people); each row
keeps last_seen and content_hash so incremental runs can:
  - update rows whose content changed (content_hash differs)
  - touch rows seen again (last_seen only)
  - flag stale rows (not seen in N runs — removal is a separate explicit step)
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import duckdb

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "pipeline.duckdb"


@dataclass
class UpsertStats:
    table: str
    seen: int
    inserted: int
    updated: int
    touched: int
    invalid: int


class DuckStore:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(str(db_path))

    def ensure_table(self, table: str, model: Any) -> None:
        self.con.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table} (
                registry_key VARCHAR PRIMARY KEY,
                content_hash VARCHAR,
                last_seen TIMESTAMP,
                payload JSON
            )
            """
        )

    def upsert(self, table: str, records: Iterable[Any]) -> UpsertStats:
        records = list(records)
        stats = UpsertStats(table=table, seen=0, inserted=0, updated=0, touched=0, invalid=0)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for rec in records:
            stats.seen += 1
            key = rec.registry_key
            row = self.con.execute(
                "SELECT content_hash FROM " + table + " WHERE registry_key = ?", [key]
            ).fetchone()
            payload = json.dumps(rec.model_dump(mode="json"), ensure_ascii=False, default=str)
            if row is None:
                self.con.execute(
                    f"INSERT INTO {table} VALUES (?, ?, ?, ?)",
                    [key, rec.content_hash, now, payload],
                )
                stats.inserted += 1
            elif row[0] != rec.content_hash:
                self.con.execute(
                    f"UPDATE {table} SET content_hash = ?, last_seen = ?, payload = ? WHERE registry_key = ?",
                    [rec.content_hash, now, payload, key],
                )
                stats.updated += 1
            else:
                self.con.execute(
                    f"UPDATE {table} SET last_seen = ? WHERE registry_key = ?",
                    [now, key],
                )
                stats.touched += 1
        return stats

    def export_jsonl(self, table: str, out_path: Path) -> int:
        """Deterministic export: sorted by name, one JSON object per line —
        the exact file shape Scrapivo's *-file-source modules read."""
        rows = self.con.execute(
            f"SELECT payload FROM {table} ORDER BY json_extract_string(payload, '$.name')"
        ).fetchall()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        tmp = out_path.with_suffix(out_path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for (payload,) in rows:
                f.write(json.dumps(json.loads(payload), ensure_ascii=False, sort_keys=True) + "\n")
                count += 1
        tmp.replace(out_path)
        return count

    def count(self, table: str) -> int:
        return self.con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def mark_stale(self, table: str, older_than_days: int) -> int:
        """Flag-only: returns rows not seen in N days. Removal stays explicit."""
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None).timestamp() - older_than_days * 86_400
        cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc).replace(tzinfo=None)
        n = self.con.execute(
            f"SELECT COUNT(*) FROM {table} WHERE last_seen < ?",
            [cutoff_dt],
        ).fetchone()[0]
        return n
