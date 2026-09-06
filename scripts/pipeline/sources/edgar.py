"""SEC EDGAR bulk source — the US registry slice (free, 10 req/s, UA required).

company_tickers.json (~10.4k SEC-registered tickers) proves the pipeline
end-to-end. Address-level enrichment arrives via the submissions API later
(paginated, still free) — the schema already carries the fields.
"""
from __future__ import annotations

import httpx

from ..confidence import score_confidence
from ..models import CompanyRecord
from ..normalize import normalize_domain

EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
UA = "Scrapivo Data Pipeline (business data ingestion; contact: mirsadat@scrapivo.com)"


def fetch_edgar_companies(client: httpx.Client | None = None) -> list[CompanyRecord]:
    own = client is None
    client = client or httpx.Client(timeout=60, headers={"User-Agent": UA})
    try:
        res = client.get(EDGAR_TICKERS_URL)
        res.raise_for_status()
        raw = res.json()
    finally:
        if own:
            client.close()

    records: list[CompanyRecord] = []
    for entry in raw.values():
        name = (entry.get("title") or "").strip()
        cik = entry.get("cik_str")
        ticker = (entry.get("ticker") or "").strip().upper()
        if not name or not cik:
            continue
        conf = score_confidence("registry", has_website=False, address_complete=False)
        records.append(
            CompanyRecord(
                source="sec_edgar",
                registry_id=str(int(cik)).zfill(10),
                name=name,
                jurisdiction="US",
                status="active",
                tickers=[ticker] if ticker else [],
                confidence=conf,
                evidence=["sec_edgar:company_tickers.json"],
            )
        )
    # Dedupe by registry_key (deterministic ER rung 1) — keep highest confidence.
    by_key: dict[str, CompanyRecord] = {}
    for rec in records:
        existing = by_key.get(rec.registry_key)
        if existing is None or rec.confidence > existing.confidence:
            by_key[rec.registry_key] = rec
    return sorted(by_key.values(), key=lambda r: r.name)
