"""GLEIF source — global LEI registry (CC0, no key, 60 req/min).

The public API paginates at 200 records/page. This module pulls a bounded
number of pages (default 10 = 2,000 records) as a sample; the full 3.4M-record
"Golden Copy" daily file is a separate bulk download — wire it here when disk
and schedule allow (the normalization path is identical).
"""
from __future__ import annotations

import httpx

from ..confidence import score_confidence
from ..models import CompanyRecord

GLEIF_URL = "https://api.gleif.org/api/v1/lei-records"


def fetch_gleif_companies(pages: int = 10, page_size: int = 200, client: httpx.Client | None = None) -> list[CompanyRecord]:
    own = client is None
    client = client or httpx.Client(timeout=60)
    records: list[CompanyRecord] = []
    try:
        for page in range(1, pages + 1):
            res = client.get(
                GLEIF_URL,
                params={"page[size]": page_size, "page[number]": page},
            )
            res.raise_for_status()
            data = res.json().get("data", [])
            if not data:
                break
            for entry in data:
                attrs = entry.get("attributes") or {}
                entity = attrs.get("entity") or {}
                lei = (attrs.get("lei") or "").strip()
                name = ((entity.get("legalName") or {}).get("name") or "").strip()
                if not lei or not name:
                    continue
                addr = entity.get("legalAddress") or {}
                country = (addr.get("country") or None)
                city = (addr.get("city") or None)
                postal = (addr.get("postalCode") or None)
                lines = ", ".join(x for x in (addr.get("addressLines") or []) if x) or None
                address_raw = ", ".join(x for x in [lines, city, addr.get("region"), postal, country] if x) or None
                conf = score_confidence("registry", has_email=False, address_complete=bool(lines and city and postal))
                records.append(
                    CompanyRecord(
                        source="gleif",
                        registry_id=lei,
                        name=name,
                        jurisdiction=country,
                        status=(entity.get("status") or None),
                        address_raw=address_raw,
                        address_normalized=None,
                        postal_code=postal,
                        locality=city,
                        country=country,
                        confidence=conf,
                        evidence=["gleif:api"],
                    )
                )
    finally:
        if own:
            client.close()

    by_key: dict[str, CompanyRecord] = {}
    for rec in records:
        existing = by_key.get(rec.registry_key)
        if existing is None or rec.confidence > existing.confidence:
            by_key[rec.registry_key] = rec
    return sorted(by_key.values(), key=lambda r: r.name)
