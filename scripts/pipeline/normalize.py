"""Deterministic normalizers — name, address, phone, domain.

Pure functions, no I/O. Shared by every source module so records from
different registries land in comparable shape (prerequisite for entity
resolution).
"""
from __future__ import annotations

import re
import unicodedata

# Legal/corporate suffixes stripped for name matching (kept on display).
LEGAL_SUFFIXES = [
    "incorporated", "corporation", "company limited", "limited liability company",
    "limited company", "public limited company", "gemeinschaft mit beschränkter haftung",
    "societas europaea", "aktiengesellschaft", "gesellschaft mbh", "sarl", "bv", "nv",
    "inc", "llc", "llp", "ltd", "plc", "gmbh", "ag", "sa", "sas", "srl", "pty",
    "co", "corp", "group", "holdings",
]

ADDRESS_ABBREV = [
    (r"\bstreet\b", "st"),
    (r"\broad\b", "rd"),
    (r"\bavenue\b", "ave"),
    (r"\bboulevard\b", "blvd"),
    (r"\bdrive\b", "dr"),
    (r"\blane\b", "ln"),
    (r"\bsuite\b", "ste"),
    (r"\bfloor\b", "fl"),
    (r"\bnorth\b", "n"),
    (r"\bsouth\b", "s"),
    (r"\beast\b", "e"),
    (r"\bwest\b", "w"),
]


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def collapse(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def normalize_company_name(name: str) -> str:
    """Lowercase, de-accented, punctuation-light, legal suffixes stripped —
    the join key for entity resolution across sources."""
    s = strip_accents(collapse(name)).lower()
    s = re.sub(r"[^\w\s-]", " ", s)
    s = collapse(re.sub(r"[_-]", " ", s))
    # Repeatedly strip suffixes ("foo co group ltd").
    changed = True
    while changed:
        changed = False
        for suffix in LEGAL_SUFFIXES:
            if s.endswith(" " + suffix):
                s = s[: -(len(suffix) + 1)].strip()
                changed = True
    return s


def normalize_person_name(name: str) -> str:
    s = strip_accents(collapse(name)).lower()
    return re.sub(r"[^\w\s-]", "", s)


def normalize_address(address: str) -> str:
    s = strip_accents(collapse(address))
    for pattern, repl in ADDRESS_ABBREV:
        s = re.sub(pattern, repl, s, flags=re.IGNORECASE)
    s = re.sub(r"[^\w\s,/-]", " ", s)
    return collapse(s).lower().strip(" ,")


def normalize_phone(phone: str, default_country: str = "US") -> Optional[str]:
    """Best-effort E.164 without dependencies; None when clearly not a phone."""
    digits = re.sub(r"[^\d+]", "", phone or "")
    if not digits:
        return None
    if digits.startswith("+"):
        return digits if 8 <= len(digits) <= 15 else None
    # Rough libphonenumber-lite: strip trunk prefix, assume US when 10 digits.
    d = digits.lstrip("0")
    if default_country == "US" and len(d) == 10:
        return f"+1{d}"
    if 8 <= len(d) <= 15:
        return f"+{d}" if default_country != "US" else None
    return None


def normalize_domain(url_or_domain: str) -> Optional[str]:
    s = (url_or_domain or "").strip().lower()
    if not s:
        return None
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = s.split("/")[0].split("?")[0].split(":")[0]
    if not re.match(r"^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$", s):
        return None
    return s
