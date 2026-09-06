"""UK Companies House bulk snapshot source — the largest free corporate
dataset anywhere (~5.19M live companies; free monthly ZIP, no API key).

SIZE WARNING: the ZIP is ~250 MB and the CSV inside ~2-3 GB uncompressed.
This runner refuses to start unless the target drive has enough free space
and streams the ZIP (never loads it whole into RAM). Do NOT run it on a
low-disk machine — the JSONL export alone for 5M companies is ~1.5 GB.

Usage:
  python -m scripts.pipeline.run_companies_house [--limit 50000]

--limit caps parsed rows (for a first ingest); omit for the full file.
"""
from __future__ import annotations

import argparse
import csv
import io
import shutil
import zipfile
from pathlib import Path

import httpx

from .confidence import score_confidence
from .models import CompanyRecord
from .normalize import normalize_address
from .store import DuckStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
LISTING_URL = "https://download.companieshouse.gov.uk/en_output.html"
MIN_FREE_GB = 3.0


def discover_zip_url(client: httpx.Client) -> str:
    """The product file is date-stamped (BasicCompanyDataAsOneFile-YYYY-MM-DD.zip)
    and changes monthly — discover the current name from the listing page."""
    res = client.get(LISTING_URL, timeout=30, follow_redirects=True)
    res.raise_for_status()
    import re

    m = re.search(r'href="(BasicCompanyDataAsOneFile-[^"]+\.zip)"', res.text)
    if not m:
        part = re.search(r'href="(BasicCompanyData-[^"]+-part1_\d+\.zip)"', res.text)
        if part:
            raise SystemExit(
                f"[companies_house] one-file product absent; split parts found "
                f"({part.group(1)}) — extend this module for multi-part ingest"
            )
        raise SystemExit("[companies_house] could not find a bulk ZIP on the listing page")
    return f"https://download.companieshouse.gov.uk/{m.group(1)}"


def free_gb(path: Path) -> float:
    return shutil.disk_usage(path).free / 1024**3


def stream_rows(zip_path: Path, limit: int | None):
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(name) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
            # CH headers carry stray spaces ("CompanyName, CompanyNumber, …").
            reader.fieldnames = [fn.strip() for fn in (reader.fieldnames or [])]
            for i, row in enumerate(reader):
                if limit is not None and i >= limit:
                    break
                yield row


def normalize_row(row: dict) -> CompanyRecord | None:
    name = (row.get("CompanyName") or "").strip()
    number = (row.get("CompanyNumber") or "").strip()
    if not name or not number:
        return None
    status = (row.get("CompanyStatus") or "").strip() or None
    incorporated = (row.get("IncorporationDate") or "").strip() or None
    lines = ", ".join(
        (row.get(f"RegAddress.AddressLine{i}") or "").strip()
        for i in (1, 2)
        if (row.get(f"RegAddress.AddressLine{i}") or "").strip()
    ) or None
    locality = (row.get("RegAddress.PostTown") or "").strip() or None
    postcode = (row.get("RegAddress.PostCode") or "").strip() or None
    sic = [s.strip() for s in (row.get("SICCode.SicText_1") or "").split(",") if s.strip() and s.strip() != "None Supplied"]
    conf = score_confidence("registry", address_complete=bool(lines and locality and postcode))
    return CompanyRecord(
        source="companies_house",
        registry_id=number,
        name=name,
        jurisdiction="GB",
        status=status,
        incorporated_date=incorporated,
        address_raw=", ".join(x for x in [lines, locality, postcode] if x) or None,
        address_normalized=normalize_address(
            ", ".join(x for x in [lines, locality, postcode] if x)
        ) if (lines or locality) else None,
        postal_code=postcode,
        locality=locality,
        country="GB",
        sic_codes=sic[:2],
        confidence=conf,
        evidence=["companies_house:bulk_snapshot"],
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="cap parsed rows for a first ingest")
    args = ap.parse_args()

    free = free_gb(DATA_DIR)
    if free < MIN_FREE_GB:
        raise SystemExit(
            f"[companies_house] only {free:.1f} GB free (need ≥{MIN_FREE_GB} GB). "
            "Free disk space first — see BUSINESS-DATA-PLAN.md Phase 1."
        )

    zip_path = DATA_DIR / "BasicCompanyDataAsOneFile.zip"
    if not zip_path.exists():
        with httpx.Client(timeout=None, follow_redirects=True) as client:
            zip_url = discover_zip_url(client)
            print(f"[companies_house] downloading {zip_url} …")
            with client.stream("GET", zip_url) as res:
                res.raise_for_status()
                with zip_path.open("wb") as f:
                    for chunk in res.iter_bytes(1024 * 1024):
                        f.write(chunk)
        print(f"[companies_house] downloaded {zip_path.stat().st_size / 1024 / 1024:.0f} MB")

    records = []
    for row in stream_rows(zip_path, args.limit):
        rec = normalize_row(row)
        if rec:
            records.append(rec)
        if len(records) % 100_000 == 0 and records:
            print(f"[companies_house] parsed {len(records)} …")
    print(f"[companies_house] validated {len(records)} CompanyRecords")

    store = DuckStore()
    store.ensure_table("companies", records[0] if records else None)
    stats = store.upsert("companies", records)
    print(
        f"[companies_house] upsert: seen={stats.seen} inserted={stats.inserted} "
        f"updated={stats.updated} touched={stats.touched}"
    )

    out = DATA_DIR / "companies_complete.jsonl"
    n = store.export_jsonl("companies", out)
    print(f"[companies_house] exported {n} total companies → {out}")


if __name__ == "__main__":
    main()
