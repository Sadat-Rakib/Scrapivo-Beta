"""Canonical schemas — every source normalizes into these via pydantic.

The JSONL exports Scrapivo ingests are exactly these models serialized:
data/companies_complete.jsonl, data/local_businesses_complete.jsonl,
data/people_complete.jsonl.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CompanyRecord(BaseModel):
    """A registered legal entity from a bulk registry (or curated dataset)."""

    source: str  # "sec_edgar" | "companies_house" | "gleif" | "yc" | ...
    registry_id: str  # unique within source (CIK, company_number, LEI, slug)
    name: str
    name_normalized: str = ""
    jurisdiction: Optional[str] = None  # ISO country code when known
    status: Optional[str] = None  # active / dissolved / unknown
    incorporated_date: Optional[str] = None  # ISO date when known
    address_raw: Optional[str] = None
    address_normalized: Optional[str] = None
    postal_code: Optional[str] = None
    locality: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    sic_codes: list[str] = Field(default_factory=list)
    tickers: list[str] = Field(default_factory=list)
    domain: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    industries: list[str] = Field(default_factory=list)
    one_liner: Optional[str] = None
    # Confidence scoring: source quality × validation outcomes (0-100).
    confidence: int = 50
    source_tier: str = "registry"  # registry | maps | scrape
    evidence: list[str] = Field(default_factory=list)
    last_seen: datetime = Field(default_factory=utcnow)
    content_hash: str = ""

    @field_validator("name")
    @classmethod
    def name_must_be_present(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("empty name")
        return v[:300]

    @field_validator("registry_id", "source")
    @classmethod
    def strip_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("required field empty")
        return v

    @model_validator(mode="after")
    def finalize(self) -> "CompanyRecord":
        if not self.name_normalized:
            # Avoid circular import; fall back to a local minimal normalizer.
            from .normalize import normalize_company_name

            self.name_normalized = normalize_company_name(self.name)
        if not self.content_hash:
            from .resolve import content_hash_of

            self.content_hash = content_hash_of(self)
        return self

    @property
    def registry_key(self) -> str:
        return f"{self.source}:{self.registry_id}"


class LocalBusinessRecord(BaseModel):
    """A physical business POI (Overture places / OSM / gosom)."""

    source: str  # "overture" | "osm" | "gosom" | ...
    registry_id: str  # source-native id (GERS id, osm id, place id)
    name: str
    name_normalized: str = ""
    category: Optional[str] = None  # primary category (normalized)
    categories: list[str] = Field(default_factory=list)
    address_raw: Optional[str] = None
    address_normalized: Optional[str] = None
    postal_code: Optional[str] = None
    locality: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    domain: Optional[str] = None
    confidence: float = 0.0  # source-native (Overture 0-1) → scaled 0-100 too
    confidence_score: int = 50
    source_tier: str = "maps"
    evidence: list[str] = Field(default_factory=list)
    last_seen: datetime = Field(default_factory=utcnow)
    content_hash: str = ""

    @field_validator("name")
    @classmethod
    def name_must_be_present(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("empty name")
        return v[:300]

    @field_validator("registry_id", "source")
    @classmethod
    def strip_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("required field empty")
        return v

    @model_validator(mode="after")
    def finalize(self) -> "LocalBusinessRecord":
        if not self.name_normalized:
            from .normalize import normalize_company_name

            self.name_normalized = normalize_company_name(self.name)
        if not self.domain and self.website:
            from .normalize import normalize_domain

            self.domain = normalize_domain(self.website)
        if not self.content_hash:
            from .resolve import content_hash_of

            self.content_hash = content_hash_of(self)
        return self

    @property
    def registry_key(self) -> str:
        return f"{self.source}:{self.registry_id}"


class PersonRecord(BaseModel):
    """A founder/executive from a public directory or profile harvest."""

    source: str  # "yc_directory" | "startups_gallery" | "wikidata" | ...
    registry_id: str  # unique within source
    name: str
    name_normalized: str = ""
    role: Optional[str] = None  # "Founder & CEO" / "Managing Partner"
    company: Optional[str] = None
    company_domain: Optional[str] = None
    location: Optional[str] = None
    linkedin: Optional[str] = None
    twitter: Optional[str] = None
    website: Optional[str] = None
    email: Optional[str] = None  # only when PUBLICLY published
    bio: Optional[str] = None
    confidence: int = 50
    source_tier: str = "directory"
    evidence: list[str] = Field(default_factory=list)
    last_seen: datetime = Field(default_factory=utcnow)
    content_hash: str = ""

    @field_validator("name")
    @classmethod
    def name_must_be_present(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("empty name")
        return v[:300]

    @field_validator("registry_id", "source")
    @classmethod
    def strip_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("required field empty")
        return v

    @model_validator(mode="after")
    def finalize(self) -> "PersonRecord":
        if not self.name_normalized:
            from .normalize import normalize_person_name

            self.name_normalized = normalize_person_name(self.name)
        if not self.content_hash:
            from .resolve import content_hash_of

            self.content_hash = content_hash_of(self)
        return self

    @property
    def registry_key(self) -> str:
        return f"{self.source}:{self.registry_id}"
