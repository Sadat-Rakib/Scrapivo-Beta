"""DuckDB store — upsert with content-hash change detection + JSONL export.

Tables are per-collection (companies / local_businesses / people); each row
keeps last_seen and content_hash so incremental runs can:
  - update rows whose content changed (content_hash differs)
  - touch rows seen again (last_seen only)
  - flag stale rows (not seen in N runs — removal is a separate explicit step)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata


def _print_report(report: dict) -> None:
    """Stdout is cp1252 on Win consoles: prefer UTF-8, fall back to ASCII
    escapes rather than dying after a multi-hour load (Gate-5 lesson)."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except UnicodeEncodeError:
        print(json.dumps(report, ensure_ascii=True, indent=2))
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import duckdb

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "pipeline.duckdb"


@dataclass
class UpsertStats:
    table: str
    seen: int
    inserted: int
    updated: int
    touched: int
    invalid: int


class DuckStore:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(str(db_path))

    def ensure_table(self, table: str, model: Any) -> None:
        self.con.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table} (
                registry_key VARCHAR PRIMARY KEY,
                content_hash VARCHAR,
                last_seen TIMESTAMP,
                payload JSON
            )
            """
        )

    def upsert(self, table: str, records: Iterable[Any]) -> UpsertStats:
        records = list(records)
        stats = UpsertStats(table=table, seen=0, inserted=0, updated=0, touched=0, invalid=0)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for rec in records:
            stats.seen += 1
            key = rec.registry_key
            row = self.con.execute(
                "SELECT content_hash FROM " + table + " WHERE registry_key = ?", [key]
            ).fetchone()
            payload = json.dumps(rec.model_dump(mode="json"), ensure_ascii=False, default=str)
            if row is None:
                self.con.execute(
                    f"INSERT INTO {table} VALUES (?, ?, ?, ?)",
                    [key, rec.content_hash, now, payload],
                )
                stats.inserted += 1
            elif row[0] != rec.content_hash:
                self.con.execute(
                    f"UPDATE {table} SET content_hash = ?, last_seen = ?, payload = ? WHERE registry_key = ?",
                    [rec.content_hash, now, payload, key],
                )
                stats.updated += 1
            else:
                self.con.execute(
                    f"UPDATE {table} SET last_seen = ? WHERE registry_key = ?",
                    [now, key],
                )
                stats.touched += 1
        return stats

    def export_jsonl(self, table: str, out_path: Path) -> int:
        """Deterministic export: sorted by name, one JSON object per line —
        the exact file shape Scrapivo's *-file-source modules read."""
        rows = self.con.execute(
            f"SELECT payload FROM {table} ORDER BY json_extract_string(payload, '$.name')"
        ).fetchall()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        tmp = out_path.with_suffix(out_path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for (payload,) in rows:
                f.write(json.dumps(json.loads(payload), ensure_ascii=False, sort_keys=True) + "\n")
                count += 1
        tmp.replace(out_path)
        return count

    def count(self, table: str) -> int:
        return self.con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def mark_stale(self, table: str, older_than_days: int) -> int:
        """Flag-only: returns rows not seen in N days. Removal stays explicit."""
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None).timestamp() - older_than_days * 86_400
        cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc).replace(tzinfo=None)
        n = self.con.execute(
            f"SELECT COUNT(*) FROM {table} WHERE last_seen < ?",
            [cutoff_dt],
        ).fetchone()[0]
        return n


# ============================================================================
# Postgres index sink (Gate 2) — OPTIONAL, behind --pg. Read-only until then.
#
# * S3 is read-only and opt-in (--people-s3 / --company-s3); default sources are
#   local canonical JSONL files. No S3 mutation operation exists in this module.
#   (data/local_businesses_{stem}.jsonl, data/companies_complete.jsonl,
#   data/people_complete.jsonl), the same files tools/normalize_business.py
#   reads. No boto3/S3 imports anywhere in this module.
# * Idempotent: registry_key PK + content_hash comparison. Re-runs only
#   touch rows whose content changed (UPDATE) or refresh last_seen.
# * --dry-run performs ZERO writes (read-only SELECTs for the
#   insert/update/unchanged diff, or pure validation when no DSN given).
# * Normalization mirrors the existing pipeline + query side:
#     country  <- upper(strip) via COUNTRY_NAME_TO_ISO for free-text locations
#                 (mirrors TS COUNTRY_ISO in search-spec-extract.ts)
#     city_norm <- lower + alias map (mirrors TS GEO_ALIAS canonical-lower)
#     role_norm <- founder-variant map, original role kept for display
#     category <- CRAFT union map (tools/normalize_business.py CRAFT plus the
#                 TS CRAFT_QUERY extras: clinic(s), barber, bakery, spa,
#                 mechanic->automotive_repair, hvac)
#   NOTE (Gate-3 audit): TS normPlace does NOT strip accents while this loader
#   does (unicodedata NFKD). Outputs agree on all-ASCII cities (the Gate-1
#   scope); accented localities need a parity pass before the 90-country load.
# ============================================================================

CITY_ALIASES = {
    # Colonial / variant spellings -> canonical display-lower (TS GEO_ALIAS).
    "bombay": "mumbai",
    "poona": "pune",
    "calcutta": "kolkata",
    "madras": "chennai",
    "bengaluru": "bangalore",
    "new delhi": "delhi",
    "dacca": "dhaka",
    "chittagong": "chattogram",
    "gurgaon": "gurugram",
    "mysore": "mysuru",
    "pondicherry": "puducherry",
    # Short codes / metros used by the parser.
    "ny": "new york",
    "nyc": "new york",
    "new york city": "new york",
    "la": "los angeles",
    "sf": "san francisco",
}

COUNTRY_NAME_TO_ISO = {
    "india": "IN",
    "united states": "US",
    "united states of america": "US",
    "america": "US",
    "usa": "US",
    "united kingdom": "GB",
    "britain": "GB",
    "england": "GB",
    "uk": "GB",
    "canada": "CA",
    "france": "FR",
    "mexico": "MX",
    "germany": "DE",
    "nigeria": "NG",
    "singapore": "SG",
}

# Minimal city->country backstop for the company geo backfill (mirrors the
# ABBREV_SEED precedent in canonical/companies.server.ts). Used ONLY when
# both country and jurisdiction are blank; anything unlisted stays NULL
# rather than guessed.
CITY_TO_ISO_BACKFILL = {
    "san francisco": "US",
    "new york city": "US",
    "los angeles": "US",
    "boston": "US",
    "seattle": "US",
    "austin": "US",
    "chicago": "US",
    "london": "GB",
    "toronto": "CA",
    "bengaluru": "IN",
    "bangalore": "IN",
    "mumbai": "IN",
    "delhi": "IN",
    "paris": "FR",
}


def first_jurisdiction_iso(raw: Any) -> str | None:
    """First ';'-separated jurisdiction token -> ISO2 ('USA; Remote' -> US)."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    toks = [t.strip() for t in raw.split(";") if t.strip()]
    if not toks:
        return None
    t = toks[0]
    if re.fullmatch(r"[A-Za-z]{2}", t):
        return t.upper()
    return COUNTRY_NAME_TO_ISO.get(t.lower())

CRAFT_UNION = {
    # tools/normalize_business.py CRAFT ...
    "plumber": "plumber", "plumbing": "plumber",
    "dentist": "dentist", "dental": "dentist",
    "restaurant": "restaurant", "cafe": "cafe", "coffee_shop": "cafe",
    "gym": "gym", "salon": "salon", "barber": "barber",
    "lawyer": "lawyer", "attorney": "lawyer",
    "electrician": "electrician",
    "roofer": "roofer", "roofing": "roofer",
    "hotel": "hotel", "bakery": "bakery", "florist": "florist", "spa": "spa",
    # ... plus TS CRAFT_QUERY extras (canonical/businesses.server.ts).
    "clinics": "dentist", "clinic": "dentist",
    "bakeries": "bakery",
    "spas": "spa",
    "mechanics": "automotive_repair", "mechanic": "automotive_repair",
    "locksmiths": "locksmith",
    "hvac": "hvac",
}

JUNK_CATEGORIES = {
    "landmark_and_historical_building", "park", "national_park", "monument",
    "museum", "church", "school", "parking",
}

FOUNDER_ROLE_NORMS = {
    "founder", "founders",
    "co-founder", "cofounder", "co founder", "co-founders", "cofounders",
    "founding partner",
}

# Substring rule (locked with the query side): any title containing a
# founder token normalizes to 'founder'. Exact-set matching missed
# 'Co-founder & CEO' / 'Director & Co-Founder' (39 Mumbai rows in S3).
# Query parity: TS person validation uses like(title, 'founder'), which
# matches the same set; 'founding partner' (no 'founder' substring) stays
# generic on both sides.
FOUNDER_RE = re.compile(r"co[-\s]?founders?|founders?")

NULL_LIKE_PG = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "#n/a", "?"}

PG_TABLES = {
    "business": (
        "public.idx_businesses",
        ["registry_key", "source", "name", "name_normalized", "category",
         "category_raw", "city", "city_norm", "region", "country", "postal_code",
         "address", "latitude", "longitude", "phone", "email", "website",
         "domain", "quality_score", "confidence", "junk_flag", "content_hash",
         "source_file"],
    ),
    "company": (
        "public.idx_companies",
        ["registry_key", "source", "name", "name_normalized", "country", "city",
         "city_norm", "region", "category", "website", "domain", "email",
         "phone", "linkedin", "description", "quality_score", "content_hash"],
    ),
    "person": (
        "public.idx_people",
        ["registry_key", "source", "name", "name_normalized", "role",
         "role_norm", "company", "company_domain", "city", "city_norm",
         "country", "industry", "email", "phone", "linkedin", "quality_score",
         "content_hash"],
    ),
}

CHUNK_KEYS = 10_000  # registry_keys per read-only diff SELECT


class ValidationError(Exception):
    """Record can never satisfy the index contract (missing/bad required)."""


class OutOfScope(Exception):
    """Valid record outside the requested --scope countries (not a failure)."""

    def __init__(self, country: str | None):
        super().__init__(f"out of scope: {country}")
        self.country = country


def _collapse(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _clean(v: Any) -> str | None:
    v = _collapse(v if isinstance(v, str) else "" if v is None else str(v))
    if not v or v.lower() in NULL_LIKE_PG:
        return None
    return v


def norm_country_iso(raw: Any) -> str | None:
    """Deterministic ISO2 upper ('in'/'IN' -> 'IN'); None when unmappable."""
    s = _collapse(raw if isinstance(raw, str) else "")
    if not s:
        return None
    up = s.upper()
    if re.fullmatch(r"[A-Z]{2}", up):
        return up
    return COUNTRY_NAME_TO_ISO.get(s.lower())


def norm_lookup_city(raw: Any) -> str | None:
    """Display-lower + alias-resolved lookup value ('Bombay' -> 'mumbai')."""
    if raw is None:
        return None
    s = _collapse(_strip_accents(raw)).lower()
    s = _collapse(re.sub(r"[^a-z0-9 ]+", " ", s))
    if not s:
        return None
    return CITY_ALIASES.get(s, s)


def norm_role(raw: Any) -> tuple[str | None, str | None]:
    """(display, lookup). Any founder-token title collapses to 'founder'."""
    disp = _clean(raw)
    if not disp:
        return None, None
    n = _collapse(re.sub(r"[^a-z0-9 +&/-]+", " ", disp.lower()))
    if FOUNDER_RE.search(n):
        return disp, "founder"
    return disp, (n or None)


def canon_category(cat: Any, cats: Any) -> str | None:
    """Mirror tools/normalize_business.canon_cat over the CRAFT union map."""
    seen: list[str] = []
    if isinstance(cat, str):
        seen.append(cat)
    if isinstance(cats, list):
        seen.extend(c for c in cats if isinstance(c, str))
    for c in seen:
        if c.lower() in CRAFT_UNION:
            return CRAFT_UNION[c.lower()]
    base = _clean(cat)
    return base.lower() if base else None


def _host_of(url: Any) -> str | None:
    if not url or not isinstance(url, str):
        return None
    m = re.search(r"^(?:https?://)?(?:www\.)?([^/]+)", url.lower())
    return m.group(1) if m else None


def _biz_quality(o: dict) -> int:
    """Mirror tools/normalize_business.py: 6 phone + 6 web + 25 dotted-web."""
    phone, web = o.get("phone"), o.get("website")
    q = (6 if phone else 0) + (6 if web else 0)
    q += 25 if web and "." in web else 0
    return q


def _biz_confidence(o: dict) -> float:
    cs = o.get("confidence_score")
    if isinstance(cs, (int, float)):
        return float(cs)
    c = o.get("confidence")
    if isinstance(c, (int, float)):
        return float(c) * 100.0 if c <= 1 else float(c)
    return 0.0


def _require(o: dict, *names: str) -> str:
    for n in names:
        v = _clean(o.get(n))
        if v:
            return v
    raise ValidationError(f"missing required field: {'/'.join(names)}")


def to_pg_row(entity: str, o: dict, scope: set[str]) -> tuple[str, dict]:
    """Validate + normalize one canonical JSONL object.

    Returns (pg_table, row_dict). Raises ValidationError (counts as failed)
    or OutOfScope (counts as skipped_out_of_scope, never a failure).
    """
    source = _require(o, "source")
    registry_id = _require(o, "registry_id")
    name = _require(o, "name")
    key = f"{source}:{registry_id}"

    if entity == "business":
        country = norm_country_iso(o.get("country"))
        if not country:
            raise ValidationError("bad/missing country (need ISO2)")
        if country not in scope:
            raise OutOfScope(country)
        cat = o.get("category")
        row = {
            "registry_key": key,
            "source": source,
            "name": name[:300],
            "name_normalized": (_clean(o.get("name_normalized")) or name.lower()),
            "category": canon_category(cat, o.get("categories")),
            "category_raw": _clean(cat),
            "city": _clean(o.get("locality")),
            "city_norm": norm_lookup_city(o.get("locality")),
            "region": _clean(o.get("region")),
            "country": country,
            "postal_code": _clean(o.get("postal_code")),
            "address": _clean(o.get("address_normalized")) or _clean(o.get("address_raw")),
            "latitude": o.get("latitude"),
            "longitude": o.get("longitude"),
            "phone": _clean(o.get("phone")),
            "email": _clean(o.get("email")),
            "website": _clean(o.get("website")),
            "domain": _clean(o.get("domain")) or _host_of(o.get("website")),
            "quality_score": _biz_quality(o),
            "confidence": _biz_confidence(o),
            "junk_flag": 1 if str(cat or "").lower() in JUNK_CATEGORIES else 0,
            "content_hash": _clean(o.get("content_hash")) or "",
            "source_file": _clean(o.get("source_file")),
        }
        return PG_TABLES["business"][0], row

    if entity == "company":
        # Jurisdiction fallback (one line): 14k Companies House rows carry no
        # country but name one in jurisdiction ('USA; Remote', 'India', ...).
        country = norm_country_iso(o.get("country")) or \
            first_jurisdiction_iso(o.get("jurisdiction"))
        if country is not None and country not in scope:
            raise OutOfScope(country)
        if country is None:
            # No country to prove: cannot satisfy country-gated retrieval.
            raise OutOfScope(None)
        industries = o.get("industries")
        cat = industries[0] if isinstance(industries, list) and industries else None
        row = {
            "registry_key": key,
            "source": source,
            "name": name[:300],
            "name_normalized": (_clean(o.get("name_normalized")) or name.lower()),
            "country": country,
            "city": _clean(o.get("locality")),
            "city_norm": norm_lookup_city(o.get("locality")),
            "region": _clean(o.get("region")),
            "category": _clean(cat),
            "website": _clean(o.get("website")),
            "domain": _host_of(o.get("website")),
            "email": None,
            "phone": None,
            "linkedin": None,
            "description": (_clean(o.get("one_liner")) or "")[:2000] or None,
            "quality_score": int(o.get("confidence") or 0),
            "content_hash": _clean(o.get("content_hash")) or "",
        }
        return PG_TABLES["company"][0], row

    if entity == "person":
        # PersonRecord carries free-text location only; derive city/country.
        loc = _clean(o.get("location"))
        city_norm: str | None = None
        country: str | None = None
        city: str | None = None
        if loc:
            parts = [p.strip() for p in re.split(r"[,|/]", loc) if p.strip()]
            if parts:
                city = parts[0]
                city_norm = norm_lookup_city(city)
            if len(parts) > 1:
                country = norm_country_iso(parts[-1])
        if country is None or country not in scope:
            raise OutOfScope(country)
        role, role_norm = norm_role(o.get("role"))
        row = {
            "registry_key": key,
            "source": source,
            "name": name[:300],
            "name_normalized": (_clean(o.get("name_normalized")) or name.lower()),
            "role": role,
            "role_norm": role_norm,
            "company": _clean(o.get("company")),
            "company_domain": _clean(o.get("company_domain")),
            "city": city,
            "city_norm": city_norm,
            "country": country,
            "industry": None,
            "email": _clean(o.get("email")),
            "phone": _clean(o.get("phone")),
            "linkedin": _clean(o.get("linkedin")),
            "quality_score": int(o.get("confidence") or 0),
            "content_hash": _clean(o.get("content_hash")) or "",
        }
        return PG_TABLES["person"][0], row

    raise ValidationError(f"unknown entity: {entity}")


@dataclass
class PgCountryStats:
    country: str
    seen: int = 0
    valid: int = 0
    inserted: int = 0       # dry-run: would insert
    updated: int = 0        # dry-run: would update (hash differs)
    unchanged: int = 0      # dry-run: key+hash already present
    failed: int = 0
    skipped_out_of_scope: int = 0
    elapsedMs: int = 0  # filled from elapsed_f at report time
    elapsed_f: float = field(default=0.0, repr=False)
    diff_estimated: bool = False  # True when no DSN: no read-only diff possible
    failures: list = field(default_factory=list)  # capped [(registry_key, reason)]

    def as_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items()
             if k not in ("failures", "elapsed_f")}
        d["elapsedMs"] = int(self.elapsed_f)
        d["failure_samples"] = self.failures[:10]
        return d


def _pg_connect(dsn: str):
    import psycopg2  # lazy: existing DuckDB-only runners never pay for this

    conn = psycopg2.connect(dsn)
    # Bulk-load-only pragmas (loader connection only; never app code).
    # Crash-safe: every chunk is content-hashed + idempotent, so a replay
    # after a crash converges instead of duplicating. Committed at once so
    # callers can freely set autocommit afterwards.
    with conn.cursor() as cur:
        cur.execute("SET synchronous_commit = off")
    conn.commit()
    return conn


def fetch_existing_hashes(conn, table: str, keys: list[str]) -> dict[str, str]:
    """Read-only diff helper: registry_key -> content_hash for one chunk."""
    out: dict[str, str] = {}
    for i in range(0, len(keys), CHUNK_KEYS):
        chunk = keys[i:i + CHUNK_KEYS]
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT registry_key, content_hash FROM {table} "
                f"WHERE registry_key = ANY(%s)",
                (chunk,),
            )
            for k, h in cur.fetchall():
                out[k] = h or ""
    return out


def pg_upsert_chunk(conn, table: str, cols: list[str],
                    to_insert: list[dict], to_update: list[dict]) -> None:
    """Real-write path (never called with --dry-run). Set-based + idempotent."""
    from psycopg2.extras import execute_values

    if to_insert:
        tpl = "(" + ",".join(["%s"] * len(cols)) + ")"
        vals = [tuple(r.get(c) for c in cols) for r in to_insert]
        with conn.cursor() as cur:
            execute_values(
                cur,
                f"INSERT INTO {table} ({','.join(cols)}) VALUES %s "
                f"ON CONFLICT (registry_key) DO NOTHING",
                vals, template=tpl, page_size=1000,
            )
    if to_update:
        set_cols = [c for c in cols if c != "registry_key"]
        tpl = "(" + ",".join(["%s"] * (len(cols) + 1)) + ")"
        vals = [tuple(r.get(c) for c in cols) + (r["content_hash"],)
                for r in to_update]
        set_list = ",".join(f"{c} = v.{c}" for c in set_cols)
        with conn.cursor() as cur:
            execute_values(
                cur,
                f"UPDATE {table} AS t SET {set_list}, last_seen = NOW() "
                f"FROM (VALUES %s) AS v({','.join(cols)}, old_hash) "
                f"WHERE t.registry_key = v.registry_key "
                f"AND t.content_hash IS DISTINCT FROM v.old_hash",
                vals, template=tpl, page_size=1000,
            )


class _LoadCtx:
    """Shared chunked load engine: local JSONL files and S3 parquet feed it.

    Identical counting / billing / diff / write semantics for every source.
    `mapper(o, scope)` converts one raw dict -> (pg_table, row_dict);
    JSONL uses to_pg_row(entity, ...), S3 people use to_pg_person_parquet.
    Memory-bounded: only one 20k-row chunk is held at a time.
    """

    def __init__(self, entity: str, scope: set[str], conn, dry_run: bool,
                 samples: dict[str, list], mapper=None):
        self.entity = entity
        self.scope = scope
        self.conn = conn
        self.dry_run = dry_run
        self.samples = samples
        self.mapper = mapper
        self.stats: dict[str, PgCountryStats] = {}
        self.pending: dict[str, list[dict]] = {}
        self.pending_keys: dict[str, list[str]] = {}
        self.t0 = time.perf_counter()

    def st(self, country: str) -> PgCountryStats:
        s = self.stats.get(country)
        if s is None:
            s = self.stats[country] = PgCountryStats(country=country)
        return s

    def bill(self, country: str, t_line: float) -> None:
        self.st(country).elapsed_f += (time.perf_counter() - t_line) * 1000.0

    def flush(self, table: str) -> None:
        rows = self.pending.get(table, [])
        if not rows:
            return
        # Intra-chunk dedupe (last occurrence wins): Overture tile overlaps
        # repeat keys within one file. Without this, duplicate occurrences are
        # each counted as inserted while ON CONFLICT collapses them in the DB,
        # so stats would exceed distinct rows by the dup count (~60 in 5.2M).
        if len({r["registry_key"] for r in rows}) != len(rows):
            seen_keys: set[str] = set()
            deduped: list[dict] = []
            for r in reversed(rows):
                if r["registry_key"] not in seen_keys:
                    seen_keys.add(r["registry_key"])
                    deduped.append(r)
            rows = deduped[::-1]
            self.pending[table] = rows
            self.pending_keys[table] = [r["registry_key"] for r in rows]
        t_flush = time.perf_counter()
        keys = self.pending_keys[table]
        existing = fetch_existing_hashes(self.conn, table, keys) if self.conn else {}
        inserts = [r for r in rows if r["registry_key"] not in existing]
        updates = [r for r in rows
                   if r["registry_key"] in existing
                   and (existing[r["registry_key"]] or "") != (r["content_hash"] or "")]
        for r in inserts:
            self.st(r["_country"]).inserted += 1
        for r in updates:
            self.st(r["_country"]).updated += 1
        for r in rows:
            s = self.st(r["_country"])
            if r["registry_key"] in existing and \
                    (existing[r["registry_key"]] or "") == (r["content_hash"] or ""):
                s.unchanged += 1
        if not self.dry_run and self.conn:
            cols = next(c for t, c in PG_TABLES.values() if t == table)
            pg_upsert_chunk(self.conn, table, cols, inserts, updates)
            self.conn.commit()
        # Attribute flush/diff time to the chunk's countries by row share.
        flush_ms = (time.perf_counter() - t_flush) * 1000.0
        per_country: dict[str, int] = {}
        for r in rows:
            per_country[r["_country"]] = per_country.get(r["_country"], 0) + 1
        total = len(rows) or 1
        for c, n in per_country.items():
            self.st(c).elapsed_f += flush_ms * n / total
        self.pending[table] = []
        self.pending_keys[table] = []

    def note_bad(self, ref: str, reason: str, sample: bool) -> None:
        """Unparseable line / non-dict row: counted failed, never stops."""
        s = self.st("__unparsed__")
        s.seen += 1
        s.failed += 1
        if sample and len(s.failures) < 10:
            s.failures.append([ref, reason])

    def submit(self, o: dict) -> None:
        """Classify one parsed dict: scope/validate/sample/buffer/flush."""
        t_line = time.perf_counter()
        mapper = self.mapper or (lambda d, s: to_pg_row(self.entity, d, s))
        try:
            table, row = mapper(o, self.scope)
        except OutOfScope as e:
            c = e.country or "__no_country__"
            s = self.st(c)
            s.seen += 1
            s.skipped_out_of_scope += 1
            self.bill(c, t_line)
            return
        except ValidationError as e:
            key = "?:?"
            try:
                key = f"{o.get('source')}:{o.get('registry_id')}"
            except Exception:
                pass
            s = self.st("__invalid__")
            s.seen += 1
            s.failed += 1
            if len(s.failures) < 10:
                s.failures.append([key, str(e)])
            self.bill("__invalid__", t_line)
            return
        # Valid + in scope.
        country = row.get("country") or "__unknown__"
        s = self.st(country)
        s.seen += 1
        s.valid += 1
        row["_country"] = country
        if self.entity in self.samples and len(self.samples[self.entity]) < 2:
            self.samples[self.entity].append(
                {k: row[k] for k in
                 ("registry_key", "name", "country", "city", "city_norm",
                  "category", "role", "role_norm", "quality_score")
                 if k in row and row[k] is not None})
        self.pending.setdefault(table, []).append(row)
        self.pending_keys.setdefault(table, []).append(row["registry_key"])
        self.bill(country, t_line)
        if sum(len(v) for v in self.pending.values()) >= 20_000:
            for t in list(self.pending):
                self.flush(t)

    def finish(self) -> tuple[dict[str, PgCountryStats], int]:
        for t in list(self.pending):
            self.flush(t)
        return self.stats, int((time.perf_counter() - self.t0) * 1000)


def load_entity_file(path: Path, entity: str, scope: set[str],
                     conn, dry_run: bool, limit: int | None,
                     samples: dict[str, list]) -> dict[str, PgCountryStats]:
    """Stream one JSONL file in chunks; returns per-country stats.

    Memory-bounded: only one chunk of normalized rows is held at a time.
    A failing line is counted and skipped — it never stops the job.
    """
    ctx = _LoadCtx(entity, scope, conn, dry_run, samples)
    seen_total = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if limit is not None and seen_total >= limit:
                break
            line = line.strip()
            if not line:
                continue
            seen_total += 1
            try:
                o = json.loads(line)
            except json.JSONDecodeError as e:
                ctx.note_bad(f"line:{seen_total}", f"json: {e}", sample=True)
                continue
            if not isinstance(o, dict):
                ctx.note_bad(f"line:{seen_total}", "non-dict row", sample=False)
                continue
            ctx.submit(o)
    return ctx.finish()


S3_BUCKET_DEFAULT = "scrapivo-raw-data-2026-523220341033-us-east-2-an"  # mirrors canonical readers
S3_PEOPLE_PREFIX = "processed/people_by_country/"
S3_COMPANY_PREFIX = "processed/companies_by_initial/"
# Scope ISO -> people partition slugs (S3 uses full names, not ISO codes:
# 'united-states', never 'us' — the per-record country gate is authoritative).
SCOPE_PEOPLE_SLUGS = {
    "IN": ["india"],
    "GB": ["united-kingdom"],
    "US": ["united-states"],
    "CA": ["canada"],
}

PERSON_KEY_SOURCE = "s3people"  # locked registry_key namespace (no registry_id in S3)


def person_parquet_key(o: dict) -> str:
    """Deterministic stable key (locked): S3 people rows carry no registry_id."""
    base = "|".join([
        str(o.get("source_file") or ""),
        str(o.get("name") or ""),
        str(o.get("company_name") or ""),
        str(o.get("title") or ""),
        str(o.get("city") or ""),
    ])
    return PERSON_KEY_SOURCE + ":" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:32]


def to_pg_person_parquet(o: dict, scope: set[str]) -> tuple[str, dict]:
    """Validate + normalize one S3 people-parquet row (column layout differs
    from the JSONL PersonRecord: separate country/city/title columns, no
    free-text location, no registry_id). Raises ValidationError / OutOfScope
    exactly like to_pg_row."""
    name = _require(o, "name")
    country = norm_country_iso(o.get("country"))
    if country is None or country not in scope:
        raise OutOfScope(country)
    role, role_norm = norm_role(o.get("title"))
    key = person_parquet_key(o)
    row = {
        "registry_key": key,
        "source": PERSON_KEY_SOURCE,
        "name": name[:300],
        "name_normalized": (_clean(o.get("name")) or "").lower(),
        "role": role,
        "role_norm": role_norm,
        "company": _clean(o.get("company_name")),
        "company_domain": None,
        "city": _clean(o.get("city")),
        "city_norm": norm_lookup_city(o.get("city")),
        "country": country,
        "industry": _clean(o.get("industry")),
        "email": _clean(o.get("email")),
        "phone": _clean(o.get("phone")),
        "linkedin": _clean(o.get("personal_linkedin")) or _clean(o.get("company_linkedin")),
        "quality_score": int(o.get("quality_score") or 0),
        "content_hash": "",
    }
    row["content_hash"] = hashlib.sha1(
        json.dumps(row, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    ).hexdigest()
    return PG_TABLES["person"][0], row


def s3_list(s3, bucket: str, prefix: str) -> list[tuple[str, int]]:
    """Read-only LIST (paginated): (key, size). Never writes/deletes."""
    out: list[tuple[str, int]] = []
    tok = None
    while True:
        kw: dict = {"Bucket": bucket, "Prefix": prefix}
        if tok:
            kw["ContinuationToken"] = tok
        page = s3.list_objects_v2(**kw)
        for it in page.get("Contents", []):
            out.append((it["Key"], it.get("Size", 0)))
        tok = page.get("NextContinuationToken")
        if not tok:
            break
    return out


def load_s3_people(bucket: str, scope: set[str], conn, dry_run: bool,
                   samples: dict[str, list], profile: str | None,
                   region: str,
                   load_all_partitions: bool = False) -> tuple[dict[str, PgCountryStats], list[dict], int]:
    """Read-only S3 people discovery + load.

    Downloads each object fully into memory one at a time (whole prefix is
    ~62MB) and parses locally. ONLY GET/LIST calls — no PUT/DELETE ever.
    Returns (stats, partition_report, elapsedMs). partition_report covers
    every partition's footer row count so empty/out-of-scope partitions are
    visible, not silently skipped.
    """
    import boto3  # lazy: JSONL-only runs never pay for this
    import io as _io

    import pyarrow.parquet as pq  # lazy

    t0 = time.perf_counter()
    sess = boto3.Session(profile_name=profile, region_name=region) if profile \
        else boto3.Session(region_name=region)
    s3 = sess.client("s3")
    files = s3_list(s3, bucket, S3_PEOPLE_PREFIX)
    wanted = {s for iso in scope for s in SCOPE_PEOPLE_SLUGS.get(iso, [])}
    load_all = load_all_partitions
    # 90-country expansion: whole prefix is ~62MB; per-record country
    # gate stays authoritative, slug pre-filter is skipped.
    def slug_wanted(slug: str) -> bool:
        return True if load_all_partitions else slug in wanted
    ctx = _LoadCtx("person", scope, conn, dry_run, samples,
                   mapper=to_pg_person_parquet)
    partition_report: list[dict] = []
    for key, size in sorted(files):
        m = re.search(r"_part=([^/]+)/", key)
        slug = m.group(1) if m else "?"
        obj = s3.get_object(Bucket=bucket, Key=key)
        pf = pq.ParquetFile(_io.BytesIO(obj["Body"].read()))
        n_rows = pf.metadata.num_rows
        in_scope = slug_wanted(slug)
        partition_report.append({"partition": slug, "key": key,
                                 "bytes": size, "rows": n_rows,
                                 "loaded": in_scope})
        if not in_scope:
            continue
        for batch in pf.iter_batches(batch_size=20_000):
            for o in batch.to_pylist():
                ctx.submit(o if isinstance(o, dict) else {})
    stats, _ = ctx.finish()
    return stats, partition_report, int((time.perf_counter() - t0) * 1000)


COMPANY_LOCATION_ISO = {
    "london": "GB", "toronto": "CA", "calgary": "CA", "vancouver": "CA",
    "pune": "IN", "mumbai": "IN", "delhi": "IN", "bangalore": "IN",
    "bengaluru": "IN", "san francisco": "US", "new york": "US",
    "los angeles": "US", "dallas": "US", "chicago": "US", "austin": "US",
}


def company_location_country(raw: Any) -> str | None:
    """Infer country only from explicit US tokens or unambiguous known cities.
    Macro regions such as EMEA/APAC remain NULL; the loader never guesses."""
    loc = _clean(raw)
    if not loc:
        return None
    low = norm_lookup_city(loc) or ""
    if re.search(r"\b(?:us|u\.s\.|united states)\b", loc, re.I):
        return "US"
    for city, iso in COMPANY_LOCATION_ISO.items():
        if re.search(rf"\b{re.escape(city)}\b", low):
            return iso
    return None


def company_parquet_key(o: dict) -> str:
    base = "|".join(str(o.get(k) or "") for k in
                    ("company_name", "website", "location", "category"))
    return "s3company:" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:32]


def to_pg_company_parquet(o: dict, scope: set[str]) -> tuple[str, dict]:
    name = _require(o, "company_name")
    location = _clean(o.get("location"))
    country = company_location_country(location)
    if country is not None and country not in scope:
        raise OutOfScope(country)
    row = {
        "registry_key": company_parquet_key(o),
        "source": "s3company",
        "name": name[:300],
        "name_normalized": name.lower(),
        "country": country,
        # The physical corpus has 69 coarse location strings, not true city
        # columns. Preserve that grain; retrieval must not claim a narrower city.
        "city": location,
        "city_norm": norm_lookup_city(location),
        "region": location,
        "category": _clean(o.get("category")),
        "website": _clean(o.get("website")),
        "domain": _host_of(o.get("website")),
        "email": _clean(o.get("email")),
        "phone": _clean(o.get("phone")),
        "linkedin": _clean(o.get("linkedin")),
        "description": (_clean(o.get("description")) or "")[:2000] or None,
        "quality_score": int(o.get("quality_score") or 0),
        "content_hash": "",
    }
    row["content_hash"] = hashlib.sha1(
        json.dumps(row, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    ).hexdigest()
    return PG_TABLES["company"][0], row


def load_s3_companies(bucket: str, scope: set[str], conn, dry_run: bool,
                      samples: dict[str, list], profile: str | None,
                      region: str, limit: int | None = None
                      ) -> tuple[dict[str, PgCountryStats], list[dict], int]:
    """Read-only LIST/GET loader for the 1.6m-row canonical company corpus."""
    import boto3
    import io as _io
    import pyarrow.parquet as pq

    t0 = time.perf_counter()
    sess = boto3.Session(profile_name=profile, region_name=region) if profile \
        else boto3.Session(region_name=region)
    s3 = sess.client("s3")
    files = s3_list(s3, bucket, S3_COMPANY_PREFIX)
    ctx = _LoadCtx("company", scope, conn, dry_run, samples,
                   mapper=to_pg_company_parquet)
    partition_report: list[dict] = []
    seen = 0
    for key, size in sorted(files, key=lambda x: x[1], reverse=True):
        if limit is not None and seen >= limit:
            break
        obj = s3.get_object(Bucket=bucket, Key=key)
        pf = pq.ParquetFile(_io.BytesIO(obj["Body"].read()))
        partition_report.append({"key": key, "bytes": size,
                                 "rows": pf.metadata.num_rows, "loaded": True})
        for batch in pf.iter_batches(batch_size=20_000):
            for o in batch.to_pylist():
                if limit is not None and seen >= limit:
                    break
                seen += 1
                ctx.submit(o if isinstance(o, dict) else {})
            if limit is not None and seen >= limit:
                break
    stats, _ = ctx.finish()
    return stats, partition_report, int((time.perf_counter() - t0) * 1000)


def backfill_company_geo_main(conn, args, data_dir: Path) -> dict:
    """One-off geo backfill for null-country idx_companies rows.

    Source of truth stays the JSONL (re-read per row); only rows with
    country IS NULL are touched, matched by registry_key. content_hash is
    intentionally left unchanged (hash covers source fields; the derived
    country is covered by future loader runs via the jurisdiction fallback
    in to_pg_row, which recomputes the same value -> unchanged, stable).
    --dry-run reports would-update counts with zero writes.
    """
    if conn is None and not args.dry_run:
        raise RuntimeError("backfill needs --pg-dsn (or use --dry-run)")
    t0 = time.perf_counter()
    path = data_dir / "companies_complete.jsonl"
    per_iso: dict[str, int] = {}
    residual = 0
    scanned = 0
    batch: list[tuple[str, str]] = []  # (iso, registry_key)
    updated_total = 0

    def flush_batch() -> None:
        nonlocal updated_total
        if not batch or conn is None:
            return
        by_iso: dict[str, list[str]] = {}
        for iso, key in batch:
            by_iso.setdefault(iso, []).append(key)
        with conn.cursor() as cur:
            for iso, keys in by_iso.items():
                cur.execute(
                    "UPDATE public.idx_companies SET country = %s, "
                    "last_seen = NOW() WHERE country IS NULL "
                    "AND registry_key = ANY(%s)",
                    (iso, keys),
                )
                updated_total += cur.rowcount or 0
        conn.commit()
        batch.clear()

    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (o.get("country") or "").strip():
                continue  # only null-country rows are candidates
            scanned += 1
            iso = first_jurisdiction_iso(o.get("jurisdiction"))
            if iso is None:
                loc = (o.get("locality") or "").strip().lower()
                iso = CITY_TO_ISO_BACKFILL.get(loc)
            if iso is None:
                residual += 1
                continue
            per_iso[iso] = per_iso.get(iso, 0) + 1
            if not args.dry_run:
                src = _clean(o.get("source")) or "?"
                rid = _clean(o.get("registry_id")) or "?"
                batch.append((iso, f"{src}:{rid}"))
                if len(batch) >= 5000:
                    flush_batch()
    if not args.dry_run:
        flush_batch()
    else:
        # dry run: conn (if any) only ever SELECTed; roll back defensively
        if conn:
            conn.rollback()
            conn.close()
    report = {
        "dry_run": args.dry_run,
        "writes": (not args.dry_run),
        "null_country_scanned": scanned,
        "would_resolve" if args.dry_run else "resolved": per_iso,
        "residual_null": residual,
        "rows_updated": 0 if args.dry_run else updated_total,
        "elapsedMs": int((time.perf_counter() - t0) * 1000),
    }
    _print_report(report)
    return report


def pg_load_main(argv: list[str] | None = None) -> dict:
    """CLI: --pg --scope IN,GB,US,CA [--dry-run] [--limit N] [--data-dir DIR]."""
    ap = argparse.ArgumentParser(
        description="Postgres index sink (Gate 2). DuckDB behavior untouched; "
                    "S3 access is opt-in and read-only.")
    ap.add_argument("--pg", action="store_true",
                    help="Enable the Postgres sink (required for any PG work).")
    ap.add_argument("--pg-dsn", default=None,
                    help="Postgres DSN (else $PG_DSN or $DATABASE_URL).")
    ap.add_argument("--scope", default="IN,GB,US,CA",
                    help="Comma-separated ISO2 countries, e.g. IN,GB,US,CA.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Zero writes: validate + read-only diff only.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap lines read per file (smoke tests).")
    ap.add_argument("--data-dir", default=None,
                    help="Defaults to <repo>/data.")
    ap.add_argument("--people-s3", action="store_true",
                    help="Also load S3 people parquet (read-only GET/LIST; "
                         "never PUT/DELETE). Scope-matched partitions only.")
    ap.add_argument("--company-s3", action="store_true",
                    help="Also load canonical S3 company parquet via read-only "
                         "GET/LIST; coarse location grain is preserved.")
    ap.add_argument("--s3-bucket", default=None,
                    help="S3 bucket (else $S3_BUCKET or canonical default).")
    ap.add_argument("--s3-profile", default=None,
                    help="AWS profile (else default credential chain).")
    ap.add_argument("--s3-region", default="us-east-2",
                    help="AWS region for S3 reads.")
    ap.add_argument("--only", default=None,
                    choices=["business", "company", "person", "person-s3", "company-s3"],
                    help="Run a single source only (staged verification).")
    ap.add_argument("--people-all", action="store_true",
                    help="Load every S3 people partition (whole prefix ~62MB); "
                         "per-record country gate stays authoritative.")
    ap.add_argument("--backfill-company-geo", action="store_true",
                    help="One-off: set country on null-country idx_companies "
                         "rows from jurisdiction/city (14k Companies House "
                         "rows). Touches ONLY country-IS-NULL rows.")
    args = ap.parse_args(argv)

    if not args.pg:
        ap.error("--pg is required to run the Postgres sink.")
    scope = {c.strip().upper() for c in args.scope.split(",") if c.strip()}
    if not scope:
        ap.error("--scope is empty.")
    dsn = args.pg_dsn or os.environ.get("PG_DSN") or os.environ.get("DATABASE_URL")
    data_dir = Path(args.data_dir) if args.data_dir else \
        Path(__file__).resolve().parents[2] / "data"

    t_all = time.perf_counter()
    conn = None
    if dsn:
        conn = _pg_connect(dsn)
        conn.autocommit = False
    elif not args.dry_run:
        ap.error("No DSN: set --pg-dsn, $PG_DSN or $DATABASE_URL for real writes.")

    # Source plan: country-stem business files + whole-corpus company/people
    # files filtered per record. Investors deferred (no Gate-1 table).
    # City/region extracts (e.g. local_businesses_austin.jsonl, whose stem is
    # not an ISO2 code) are ALSO read: records are scoped per-record by their
    # normalized country, so the 201 Austin plumbing rows (absent from
    # us.jsonl) load under scope US without any new dataset.
    plan: list[tuple[str, Path]] = []
    for stem in sorted(s.lower() for s in scope):
        p = data_dir / f"local_businesses_{stem}.jsonl"
        if p.exists() and len(stem) == 2:
            plan.append(("business", p))
    for p in sorted(data_dir.glob("local_businesses_*.jsonl")):
        stem = p.name[len("local_businesses_"):-len(".jsonl")]
        if len(stem) == 2:
            continue  # ISO2 stems handled above (in-scope ones only)
        plan.append(("business", p))
    for fname, entity in (("companies_complete.jsonl", "company"),
                          ("people_complete.jsonl", "person")):
        p = data_dir / fname
        if p.exists():
            plan.append((entity, p))

    if args.backfill_company_geo:
        return backfill_company_geo_main(conn, args, data_dir)

    per_country: dict[str, PgCountryStats] = {}
    samples: dict[str, list] = {"business": [], "company": [], "person": []}
    files_done: list[dict] = []

    def merge(dst: dict[str, PgCountryStats], src: dict[str, PgCountryStats]) -> None:
        for k, v in src.items():
            d = per_country.get(k)
            if d is None:
                per_country[k] = v
            else:
                for f_name in ("seen", "valid", "inserted", "updated",
                               "unchanged", "failed", "skipped_out_of_scope"):
                    setattr(d, f_name, getattr(d, f_name) + getattr(v, f_name))
                d.failures.extend(v.failures[: max(0, 10 - len(d.failures))])

    for entity, path in plan:
        if args.only and args.only != entity:
            continue
        fstats, fms = load_entity_file(path, entity, scope, conn,
                                       args.dry_run, args.limit, samples)
        merge(per_country, fstats)
        files_done.append({"entity": entity, "file": path.name,
                           "elapsedMs": fms})

    partitions: list[dict] = []
    if args.people_s3 and (not args.only or args.only == "person-s3"):
        bucket = args.s3_bucket or os.environ.get("S3_BUCKET") or S3_BUCKET_DEFAULT
        pstats, partitions, pms = load_s3_people(
            bucket, scope, conn, args.dry_run, samples,
            args.s3_profile, args.s3_region,
            load_all_partitions=args.people_all)
        merge(per_country, pstats)
        files_done.append({"entity": "person[s3]", "file": S3_PEOPLE_PREFIX,
                           "elapsedMs": pms})

    if args.company_s3 and (not args.only or args.only == "company-s3"):
        bucket = args.s3_bucket or os.environ.get("S3_BUCKET") or S3_BUCKET_DEFAULT
        cstats, cparts, cms = load_s3_companies(
            bucket, scope, conn, args.dry_run, samples,
            args.s3_profile, args.s3_region, args.limit)
        merge(per_country, cstats)
        partitions.extend(cparts)
        files_done.append({"entity": "company[s3]", "file": S3_COMPANY_PREFIX,
                           "elapsedMs": cms})

    if conn:
        if args.dry_run:
            conn.rollback()  # belt-and-braces: dry run leaves nothing behind
        conn.close()

    overall = {"seen": 0, "valid": 0, "inserted": 0, "updated": 0,
               "unchanged": 0, "failed": 0, "skipped_out_of_scope": 0}
    by_country = {}
    for k in sorted(per_country):
        d = per_country[k].as_dict()
        if conn is None:
            d["diff_estimated"] = True
        by_country[k] = d
        for f_name in overall:
            overall[f_name] += d[f_name]
    report = {
        "dry_run": args.dry_run,
        "writes": (not args.dry_run),
        "scope": sorted(scope),
        "data_dir": str(data_dir),
        "s3_touched": bool(args.people_s3 or args.company_s3),
        "duckdb_touched": False,
        "overall_elapsedMs": int((time.perf_counter() - t_all) * 1000),
        "overall": overall,
        "by_country": by_country,
        "files": files_done,
        "samples": samples,
        "s3_partitions": partitions,
    }
    _print_report(report)
    return report


if __name__ == "__main__":
    pg_load_main()
