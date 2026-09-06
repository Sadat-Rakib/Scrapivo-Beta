"""Confidence scoring — source quality × validation outcomes.

Deterministic, explainable; every point traces to a real signal. The tier
vocabulary mirrors the openleads-style safe/risky/bad ladder at the consumer
side (Scrapivo maps score → tier server-side).
"""
from __future__ import annotations

TIER_BASE = {
    "registry": 70,  # official registries (EDGAR, Companies House, GLEIF)
    "maps": 60,      # Overture / OSM / gosom places
    "directory": 55, # curated public directories (YC, startups.gallery)
    "scrape": 40,    # web/profile scrapes
}


def score_confidence(
    source_tier: str,
    *,
    has_website: bool = False,
    has_email: bool = False,
    has_phone: bool = False,
    email_verified: bool = False,
    website_live: bool | None = None,
    address_complete: bool = False,
    source_native_confidence: float | None = None,
) -> int:
    score = TIER_BASE.get(source_tier, 40)
    if has_website:
        score += 6
    if has_email:
        score += 4
    if has_phone:
        score += 4
    if email_verified:
        score += 10
    if website_live is True:
        score += 6
    elif website_live is False:
        score -= 12
    if address_complete:
        score += 4
    if source_native_confidence is not None:
        # Overture-style 0-1 community confidence folded in (±10).
        score += round(max(0.0, min(1.0, source_native_confidence)) * 20) - 10
    return max(1, min(100, score))
