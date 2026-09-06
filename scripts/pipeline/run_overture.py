"""Overture Maps Places → per-country LocalBusinessRecord JSONL (global).

Streams the release over S3 with bbox pushdown, post-filters rows by
Overture's own address country code, validates through pydantic, and writes
data/local_businesses_{iso2}.jsonl directly (tmp + atomic rename). A slim
per-country tracking table in DuckDB (rows + content sha + last_seen) drives
--resume; per-row payloads live ONLY in the JSONL (halves disk at global scale).

Usage:
  python -m scripts.pipeline.run_overture --country GB
  python -m scripts.pipeline.run_overture --country US --max-rows 500000
  python -m scripts.pipeline.run_overture --bbox=-98.1,30.0,-97.4,30.7 --country US  (city override)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from .confidence import score_confidence
from .countries import COUNTRIES, Country, by_iso
from .models import LocalBusinessRecord
from .normalize import normalize_address, normalize_domain, normalize_phone
from .store import DuckStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

RELEASES = [
    "2026-08-19.0",
    "2026-07-21.0",
]

QUERY = """
SELECT
    id,
    names.primary AS name,
    categories.primary AS category,
    categories.alternate AS alt_categories,
    confidence,
    addresses[1].locality   AS locality,
    addresses[1].region     AS region,
    addresses[1].postcode   AS postcode,
    addresses[1].country    AS country,
    addresses[1].freeform   AS freeform,
    websites,
    phones,
    bbox.xmin AS xmin,
    bbox.ymin AS ymin,
    bbox.xmax AS xmax,
    bbox.ymax AS ymax
FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*', hive_partitioning=1)
WHERE bbox.xmin >= {xmin} AND bbox.xmax <= {xmax}
  AND bbox.ymin >= {ymin} AND bbox.ymax <= {ymax}
  AND confidence >= {min_conf}
  AND names.primary IS NOT NULL
"""


def pick_release(con: duckdb.DuckDBPyConnection, country: Country, min_conf: float) -> str:
    xmin, ymin, xmax, ymax = country.bbox
    probe = QUERY.format(
        release="{release}", xmin=xmin, ymin=ymin, xmax=xmax, ymax=ymax, min_conf=min_conf
    ).replace("{release}", RELEASES[0])
    # Cheap existence probe: the release path may be gone (only 2 kept on S3).
    for release in RELEASES:
        try:
            con.execute(
                f"SELECT count(*) FROM read_parquet("
                f"'s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*', "
                f"hive_partitioning=1) WHERE false"
            )
            return release
        except Exception as e:  # noqa: BLE001
            print(f"[overture] release {release} unavailable ({str(e)[:80]}…)")
    raise SystemExit("[overture] no available release found — update RELEASES list")


def to_phone(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if isinstance(value, dict):
        value = next(iter(value.values()), None)
    return normalize_phone(str(value)) if value else None


def rows_to_records(batch, country: Country, release: str):
    """pyarrow batch → validated records + counters."""
    cols = {name: batch.column(name).to_pylist() for name in batch.schema.names}
    records: list[LocalBusinessRecord] = []
    invalid = 0
    iso = country.iso2
    for i in range(batch.num_rows):
        name = (cols["name"][i] or "").strip()
        row_country = (cols["country"][i] or "").strip().upper()
        # Post-filter: drop rows whose Overture address puts them in another
        # country (rough country bboxes overlap neighbours/sea). Null-country
        # rows inside the bbox are kept — coverage over precision.
        if row_country and row_country != iso:
            continue
        if not name:
            invalid += 1
            continue
        freeform = cols["freeform"][i]
        locality = cols["locality"][i]
        region = cols["region"][i]
        postcode = cols["postcode"][i]
        addr_raw = ", ".join(x for x in [freeform, locality, region, postcode] if x) or None
        websites = cols["websites"][i]
        website = websites[0] if websites else None
        conf = cols["confidence"][i]
        try:
            records.append(
                LocalBusinessRecord(
                    source="overture",
                    registry_id=str(cols["id"][i]),
                    name=name,
                    category=(cols["category"][i] or "").lower() or None,
                    categories=[(c or "").lower() for c in (cols["alt_categories"][i] or [])][:6],
                    address_raw=addr_raw,
                    address_normalized=normalize_address(addr_raw) if addr_raw else None,
                    postal_code=postcode,
                    locality=locality,
                    region=region,
                    country=row_country or iso,
                    latitude=(cols["ymin"][i] + cols["ymax"][i]) / 2 if cols["ymin"][i] is not None else None,
                    longitude=(cols["xmin"][i] + cols["xmax"][i]) / 2 if cols["xmin"][i] is not None else None,
                    phone=to_phone(cols["phones"][i]),
                    website=website,
                    domain=normalize_domain(website) if website else None,
                    confidence=round(float(conf or 0), 3),
                    confidence_score=score_confidence(
                        "maps",
                        has_website=bool(website),
                        has_phone=bool(cols["phones"][i]),
                        address_complete=bool(freeform),
                        source_native_confidence=conf,
                    ),
                    evidence=[f"overture:{release}"],
                )
            )
        except Exception:
            invalid += 1
    return records, invalid


def tiles_for(country: Country, tile_deg: float = 2.0) -> list[tuple[float, float, float, float, int]]:
    """2°-tile grid over the country bbox — forces geographic spread on capped
    countries (a single-bbox LIMIT scan returns "first rows read", which
    clustered the entire US cap into one corner). Empty tiles prune to ~seconds."""
    import math

    xmin, ymin, xmax, ymax = country.bbox
    nx = max(1, math.ceil((xmax - xmin) / tile_deg))
    ny = max(1, math.ceil((ymax - ymin) / tile_deg))
    per_tile = max(500, math.ceil(country.cap / (nx * ny)))
    tiles: list[tuple[float, float, float, float, int]] = []
    for i in range(nx):
        for j in range(ny):
            tx0 = xmin + i * tile_deg
            ty0 = ymin + j * tile_deg
            tx1 = min(tx0 + tile_deg, xmax)
            ty1 = min(ty0 + tile_deg, ymax)
            if tx1 > tx0 and ty1 > ty0:
                tiles.append((tx0, ty0, tx1, ty1, per_tile))
    return tiles


def extract_country(country: Country, min_conf: float, max_rows: int, bbox_override=None) -> tuple[Path, int, str, float]:
    out = DATA_DIR / f"local_businesses_{country.file_stem}.jsonl"
    xmin, ymin, xmax, ymax = bbox_override or country.bbox

    if bbox_override:
        tiles = [(xmin, ymin, xmax, ymax, max_rows)]
    else:
        tiles = tiles_for(country)
        max_rows = country.cap

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    release = pick_release(con, country, min_conf)

    tmp = out.with_suffix(out.suffix + ".tmp")
    total = 0
    invalid = 0
    sha = hashlib.sha256()
    t0 = time.time()
    print(
        f"[overture:{country.iso2}] {len(tiles)} tiles "
        f"(per-tile cap {tiles[0][4]:,}, country cap {max_rows:,}) …"
    )
    with tmp.open("w", encoding="utf-8") as f:
        for t_i, (tx0, ty0, tx1, ty1, tile_cap) in enumerate(tiles, 1):
            if total >= max_rows:
                break
            query = QUERY.format(
                release=release,
                xmin=tx0, ymin=ty0, xmax=tx1, ymax=ty1,
                min_conf=min_conf,
                max_rows=min(tile_cap, max_rows - total),
            )
            try:
                cur = con.execute(query)
                reader = cur.fetch_record_batch(20_000)
                while True:
                    try:
                        batch = reader.read_next_batch()
                    except StopIteration:
                        break
                    records, bad = rows_to_records(batch, country, release)
                    invalid += bad
                    for rec in records:
                        if total >= max_rows:
                            break
                        line = json.dumps(rec.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
                        f.write(line + "\n")
                        sha.update(line.encode("utf-8"))
                        total += 1
                    if total >= max_rows:
                        break
            except Exception as e:  # noqa: BLE001 — one tile failing never kills the country
                print(f"[overture:{country.iso2}] tile {t_i} failed: {str(e)[:120]}")
                continue
            if t_i % 20 == 0:
                print(f"[overture:{country.iso2}] tile {t_i}/{len(tiles)} — {total:,} rows")

    tmp.replace(out)
    elapsed = time.time() - t0
    print(
        f"[overture:{country.iso2}] wrote {total:,} rows "
        f"({out.stat().st_size / 1024 / 1024:.1f} MiB, dropped {invalid}, {elapsed / 60:.1f} min)"
    )
    return out, total, sha.hexdigest(), elapsed


def track(country: Country, total: int, sha: str, elapsed: float) -> None:
    store = DuckStore()
    store.con.execute(
        """
        CREATE TABLE IF NOT EXISTS local_files (
            country VARCHAR PRIMARY KEY,
            rows BIGINT,
            content_sha VARCHAR,
            extracted_minutes DOUBLE,
            last_seen TIMESTAMP
        )
        """
    )
    store.con.execute(
        "DELETE FROM local_files WHERE country = ?",
        [country.iso2],
    )
    store.con.execute(
        "INSERT INTO local_files VALUES (?, ?, ?, ?, ?)",
        [country.iso2, total, sha, round(elapsed / 60, 1), datetime.now(timezone.utc).replace(tzinfo=None)],
    )


def export_regions_manifest() -> None:
    """Shared with the TS file source: file stem → country identity/aliases."""
    manifest = [
        {
            "file_stem": c.file_stem,
            "iso2": c.iso2,
            "name": c.name,
            "region": c.region,
            "aliases": [c.name.lower(), *c.aliases],
        }
        for c in COUNTRIES
    ]
    out = DATA_DIR / "regions_manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[overture] regions manifest → {out} ({len(manifest)} countries)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", help="ISO2 from the manifest (e.g. GB, IN, BR)")
    ap.add_argument("--bbox", help="override: xmin,ymin,xmax,ymax (city-level extract)")
    ap.add_argument("--min-conf", type=float, default=0.6)
    ap.add_argument("--max-rows", type=int, default=None, help="override the tier cap")
    args = ap.parse_args()

    country = by_iso(args.country or "")
    if country is None:
        raise SystemExit(f"[overture] unknown country {args.country!r} — see countries.py")

    if shutil.disk_usage(DATA_DIR).free / 1024**3 < 2.0:
        raise SystemExit("[overture] <2 GB free disk — refusing to extract")

    cap = args.max_rows or country.cap
    bbox = tuple(float(x) for x in args.bbox.split(",")) if args.bbox else None
    out, total, sha, elapsed = extract_country(country, args.min_conf, cap, bbox)
    track(country, total, sha, elapsed)
    export_regions_manifest()


if __name__ == "__main__":
    main()
