"""Deterministic-first entity resolution + change tracking.

Resolution ladder (cheap → expensive, per BUSINESS-DATA-PLAN.md):
  1. registry_key  (source + registry_id) — exact, always applies
  2. domain        (normalized domain equality) — cross-source link when known
  3. name_key      (normalized name + country) — cross-source fallback
Splink (probabilistic) is deliberately deferred until volume demands it.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .normalize import normalize_domain


def content_hash_of(model: Any) -> str:
    """SHA-1 of the record minus volatile fields — drives incremental updates."""
    payload = model.model_dump(mode="json")
    payload.pop("last_seen", None)
    payload.pop("content_hash", None)
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def domain_of(model: Any) -> str | None:
    """Cross-source join key when a website/domain is present."""
    for field in ("domain", "website", "company_domain"):
        value = getattr(model, field, None)
        if value:
            d = normalize_domain(value)
            if d:
                return d
    return None


def entity_keys(model: Any) -> list[str]:
    """All deterministic keys this record matches on (deduped)."""
    keys = [f"reg:{model.registry_key}"]
    d = domain_of(model)
    if d:
        keys.append(f"domain:{d}")
    name = getattr(model, "name_normalized", "")
    country = getattr(model, "country", None) or getattr(model, "jurisdiction", None)
    if name:
        keys.append(f"name:{name}|{country or '?'}")
    return keys


def merge_records(primary: Any, secondary: Any) -> Any:
    """Keep the higher-confidence record; fill empty fields from the other.

    Provenance is never invented: the winner keeps its source/evidence, and
    the loser's source is appended to evidence as a corroboration.
    """
    winner, loser = (
        (primary, secondary)
        if (primary.confidence or 0) >= (secondary.confidence or 0)
        else (secondary, primary)
    )
    loser_evidence = f"corroborated_by:{loser.source}"
    for field in winner.model_fields:
        if field in ("source", "registry_id", "registry_key", "last_seen", "content_hash"):
            continue
        mine = getattr(winner, field)
        theirs = getattr(loser, field, None)
        if (mine is None or mine == "" or mine == []) and theirs:
            setattr(winner, field, theirs)
    if loser_evidence not in winner.evidence:
        winner.evidence = [*winner.evidence, loser_evidence]
    return winner
