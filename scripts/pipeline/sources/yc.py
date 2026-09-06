"""Y Combinator directory source — startup companies (free public JSON).

6.2k YC companies with website, one-liner, batch, industries, hiring flag and
team size. No founder names in this feed (people records come from the
profile-harvest pipeline, not here — never invented).

Usage:  python -m scripts.pipeline.run_yc
"""
from __future__ import annotations

import httpx

from ..confidence import score_confidence
from ..models import CompanyRecord
from ..normalize import normalize_domain

YC_ALL_URL = "https://yc-oss.github.io/api/companies/all.json"


def fetch_yc_companies(client: httpx.Client | None = None) -> list[CompanyRecord]:
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        res = client.get(YC_ALL_URL)
        res.raise_for_status()
        raw = res.json()
    finally:
        if own:
            client.close()

    records: list[CompanyRecord] = []
    for entry in raw:
        name = (entry.get("name") or "").strip()
        slug = (entry.get("slug") or "").strip()
        website = (entry.get("website") or "").strip() or None
        if not name or not slug:
            continue
        domain = normalize_domain(website) if website else None
        location = (entry.get("all_locations") or "").strip() or None
        conf = score_confidence("directory", has_website=bool(website))
        records.append(
            CompanyRecord(
                source="yc",
                registry_id=slug,
                name=name,
                jurisdiction=(location.split(",")[-1].strip() or None) if location else None,
                status=(entry.get("status") or None),
                address_raw=location,
                locality=(location.split(",")[0].strip() or None) if location else None,
                domain=domain,
                website=website,
                industries=[str(i) for i in (entry.get("industries") or [])][:8],
                one_liner=(entry.get("one_liner") or None),
                confidence=conf,
                source_tier="directory",
                evidence=[
                    f"yc_batch:{entry.get('batch')}",
                    f"team_size:{entry.get('team_size')}",
                    *( ["yc_hiring"] if entry.get("isHiring") else [] ),
                ],
            )
        )
    by_key: dict[str, CompanyRecord] = {}
    for rec in records:
        existing = by_key.get(rec.registry_key)
        if existing is None or rec.confidence > existing.confidence:
            by_key[rec.registry_key] = rec
    return sorted(by_key.values(), key=lambda r: r.name)
