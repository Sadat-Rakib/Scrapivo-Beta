"""User-supplied CSV importer — people (and their companies).

The user provides per-country CSVs (e.g. an Albania sample) with their own
headers. This module maps flexible headers onto PersonRecord, normalises,
dedupes by LinkedIn slug, and provenance-marks every row so nothing
untraceable enters the DB:

  source="csv_import", evidence=["csv:{filename}:{row_number}"]

Recognised header variants (case/space/punctuation-insensitive):
  name:        name, full name, fullname, contact name, person
  role:        role, title, job title, position, designation
  company:     company, company name, organization, organisation, employer
  email:       email, e-mail, email address, mail
  phone:       phone, phone number, telephone, mobile, tel
  linkedin:    linkedin, linkedin url, linkedin profile, linkedin link
  twitter:     twitter, x, x handle, twitter handle
  website:     website, web site, site, url, company website
  location:    location, city, country, address
  bio:         bio, about, summary, description

Usage:  python -m scripts.pipeline.run_csv_import --csv data/people_al.csv
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

from ..models import PersonRecord
from ..normalize import normalize_domain

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
LINKEDIN_IN_RE = re.compile(r"(?:[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9_%-]{3,})", re.I)

HEADER_MAP: dict[str, tuple[str, ...]] = {
    "name": ("name", "fullname", "full name", "contact name", "person", "contact"),
    "role": ("role", "title", "job title", "position", "designation", "jobtitle"),
    "company": ("company", "company name", "organization", "organisation", "employer", "firm"),
    "email": ("email", "e-mail", "email address", "mail", "e mail"),
    "phone": ("phone", "phone number", "telephone", "mobile", "tel", "phone no"),
    "linkedin": ("linkedin", "linkedin url", "linkedin profile", "linkedin link", "linkedinurl"),
    "twitter": ("twitter", "x", "x handle", "twitter handle", "twitter url"),
    "website": ("website", "web site", "site", "url", "company website", "web"),
    "location": ("location", "city", "country", "address", "place"),
    "bio": ("bio", "about", "summary", "description", "profile"),
}


def _norm_header(h: str) -> str:
    return re.sub(r"[\s_.-]+", " ", (h or "").strip().lower()).strip()


def map_headers(fieldnames: list[str]) -> dict[str, str]:
    """Canonical field -> actual CSV column. First match wins."""
    normed = {col: _norm_header(col) for col in (fieldnames or [])}
    out: dict[str, str] = {}
    for canon, variants in HEADER_MAP.items():
        for col, norm in normed.items():
            if norm in variants and canon not in out:
                out[canon] = col
                break
    return out


def linkedin_slug(url: str | None) -> str | None:
    if not url:
        return None
    m = LINKEDIN_IN_RE.search(url.strip())
    if not m or m.group(1).lower() in {"pub", "dir", "feed", "home"}:
        return None
    return m.group(1).lower().rstrip("/")


def clean_linkedin(url: str | None) -> str | None:
    if not url:
        return None
    u = url.strip()
    if not u:
        return None
    if not u.startswith("http"):
        u = "https://" + u.lstrip("/")
    return u if linkedin_slug(u) else None


def row_to_record(
    row: dict[str, str],
    mapping: dict[str, str],
    *,
    source_tag: str,
    row_number: int,
) -> PersonRecord | None:
    """One CSV row -> PersonRecord. Returns None when the row is unusable
    (no name, or a LinkedIn URL that isn't a real profile). Never invents."""
    get = lambda f: (row.get(mapping[f]) or "").strip() if f in mapping else ""
    name = get("name")
    if not name:
        return None
    linkedin = clean_linkedin(get("linkedin"))
    email = get("email") or None
    if email and not EMAIL_RE.match(email):
        email = None  # malformed addresses never enter the DB
    phone = get("phone") or None
    company = get("company") or None
    website = get("website") or None
    domain = normalize_domain(website) if website else None
    slug = linkedin_slug(linkedin)
    stem = slug or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return PersonRecord(
        source=source_tag,
        registry_id=f"csv:{stem}",
        name=name,
        role=get("role") or None,
        company=company,
        company_domain=domain,
        location=get("location") or None,
        linkedin=linkedin,
        twitter=(get("twitter") or None),
        website=website,
        email=email,  # only when present AND well-formed in the CSV
        phone=phone,
        bio=(get("bio") or None),
        confidence=60 if email else 50,
        source_tier="directory",
        evidence=[f"csv:{source_tag}:{row_number}"],
    )


def parse_csv(path: str | Path) -> tuple[list[PersonRecord], dict[str, int]]:
    """Parse a user CSV into deduped PersonRecords (dedupe by LinkedIn slug,
    else by normalized name+company). Returns (records, stats)."""
    path = Path(path)
    stats = {"rows": 0, "kept": 0, "dropped_no_name": 0, "dropped_bad_linkedin": 0, "deduped": 0}
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        mapping = map_headers(reader.fieldnames or [])
        if "name" not in mapping:
            raise ValueError(f"No name-like column in {path} (headers: {reader.fieldnames})")
        seen: dict[str, PersonRecord] = {}
        for i, row in enumerate(reader, start=2):
            stats["rows"] += 1
            has_li_col = "linkedin" in mapping and (row.get(mapping["linkedin"]) or "").strip()
            try:
                rec = row_to_record(row, mapping, source_tag=path.stem, row_number=i)
            except Exception:
                rec = None
            if rec is None:
                if has_li_col:
                    stats["dropped_bad_linkedin"] += 1
                else:
                    stats["dropped_no_name"] += 1
                continue
            key = f"li:{linkedin_slug(rec.linkedin)}" if rec.linkedin else f"nc:{rec.name_normalized}|{(rec.company or '').lower()}"
            prev = seen.get(key)
            if prev is None:
                seen[key] = rec
                stats["kept"] += 1
            else:
                # Merge: fill blanks from the later row, keep first evidence.
                merged = prev.model_copy(
                    update={
                        k: v
                        for k, v in {
                            "role": rec.role,
                            "email": rec.email,
                            "phone": rec.phone,
                            "twitter": rec.twitter,
                            "website": rec.website,
                            "location": rec.location,
                            "bio": rec.bio,
                        }.items()
                        if v and not getattr(prev, k, None)
                    }
                )
                merged.evidence = sorted(set(prev.evidence) | set(rec.evidence))
                seen[key] = merged
                stats["deduped"] += 1
    return list(seen.values()), stats
