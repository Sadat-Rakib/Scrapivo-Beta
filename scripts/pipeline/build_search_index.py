"""Build immutable compact stored-search indexes from canonical S3 Parquet.

No AI imports or calls. Canonical objects are read-only. Output writes are
restricted to derived/search-index/versions/<version>/ and active.json is
updated only after a complete manifest passes reconciliation.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import struct
import sys
import time
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

import boto3
import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import ClientError
from botocore.config import Config
from botocore.exceptions import BotoCoreError

from store import (
    S3_BUCKET_DEFAULT,
    company_location_country,
    norm_country_iso,
    norm_lookup_city,
    norm_role,
)

SCHEMA_VERSION = 1
NORMALIZER_VERSION = "gate2b-final-v1"
DEFAULT_PREFIX = "derived/search-index"
ENTITY_PREFIXES = {
    "business": "processed/local-businesses/by_country/",
    "company": "processed/companies_by_initial/",
    "person": "processed/people_by_country/",
    "investor": "processed/investors/",
}
ENTITY_COLUMNS = {
    "business": ["registry_id", "name", "category", "category_raw", "locality", "region",
                 "country", "phone", "email", "website", "quality_score", "junk_flag",
                 "latitude", "longitude"],
    "company": ["company_name", "website", "location", "category", "email", "phone",
                "linkedin", "description", "quality_score", "funding"],
    "person": ["name", "title", "company_name", "website", "email", "phone",
               "personal_linkedin", "company_linkedin", "country", "city", "industry",
               "quality_score"],
    "investor": ["id", "name", "kind", "firm", "role", "location_raw", "location_city",
                 "location_country", "email", "linkedin", "website", "quality_score",
                 "sectors", "stages", "check_min_usd", "check_max_usd"],
}

DOCUMENT_SCHEMA = pa.schema([
    ("doc_id", pa.int64()), ("entity", pa.string()), ("registry_key", pa.string()),
    ("name", pa.string()), ("title", pa.string()), ("role_norm", pa.string()),
    ("employer", pa.string()), ("category", pa.string()), ("industry", pa.string()),
    ("country", pa.string()), ("city", pa.string()), ("coarse_location", pa.string()),
    ("domain", pa.string()), ("website", pa.string()), ("email", pa.string()),
    ("phone", pa.string()), ("linkedin", pa.string()), ("sector", pa.string()),
    ("stage", pa.string()), ("kind", pa.string()), ("check_min_usd", pa.float64()),
    ("check_max_usd", pa.float64()), ("latitude", pa.float64()), ("longitude", pa.float64()),
    ("quality_score", pa.int16()), ("source_object", pa.string()), ("source_row", pa.int64()),
    ("accounting_status", pa.string()), ("accounting_reason", pa.string()),
])

POSTING_SCHEMA = pa.schema([
    ("entity", pa.string()), ("dimension", pa.string()), ("bucket", pa.string()),
    ("term", pa.string()), ("doc_id", pa.int64()), ("quality", pa.uint8()),
    ("flags", pa.uint8()),
])


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return None if not text or text.lower() in {"null", "none", "unknown", "n/a", "-"} else text


def norm_text(value: Any) -> str | None:
    text = clean(value)
    if not text:
        return None
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    text = re.sub(r"[^\w]+", " ", text.lower(), flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip() or None


def host(value: Any) -> str | None:
    text = clean(value)
    if not text:
        return None
    match = re.search(r"^(?:https?://)?(?:www\.)?([^/:?#]+)", text.lower())
    return match.group(1) if match else None


def score(value: Any) -> int:
    try:
        return max(0, min(100, round(float(value or 0))))
    except (TypeError, ValueError):
        return 0


def flags(document: dict[str, Any]) -> int:
    return (1 if document.get("website") else 0) | (2 if document.get("email") else 0) | \
        (4 if document.get("phone") else 0)


def bucket(term: str, chars: int) -> str:
    return hashlib.sha256(term.encode("utf-8")).hexdigest()[:chars]


def phrase_terms(value: Any, max_words: int = 3) -> set[str]:
    normalized = norm_text(value)
    if not normalized:
        return set()
    words = normalized.split()
    terms = {normalized}
    for width in range(1, min(max_words, len(words)) + 1):
        terms.update(" ".join(words[i:i + width]) for i in range(len(words) - width + 1))
    return {term for term in terms if len(term) > 1 and term != "ai"}


def list_terms(value: Any) -> set[str]:
    values = value if isinstance(value, list) else [value]
    return {term for item in values for term in phrase_terms(item) if term}


def canonical_business_category(value: Any) -> str | None:
    term = norm_text(value)
    return term.replace(" ", "_") if term else None


def business_category_terms(value: str | None) -> set[str]:
    if not value: return set()
    terms = {value}
    if value.endswith("_restaurant"): terms.add("restaurant")
    if value.startswith("hvac_"): terms.add("hvac")
    if value in {"general_dentistry", "cosmetic_dentist"}: terms.add("dentist")
    if value in {"real_estate_service", "real_estate_agent"}: terms.add("real_estate")
    return terms


def normalize_row(entity: str, raw: dict[str, Any], key: str, row_number: int,
                  doc_id: int) -> tuple[dict[str, Any], dict[str, set[str]]]:
    dimensions: dict[str, set[str]] = defaultdict(set)
    document: dict[str, Any] = {name: None for name in DOCUMENT_SCHEMA.names}
    document.update({
        "doc_id": doc_id, "entity": entity, "quality_score": score(raw.get("quality_score")),
        "source_object": key, "source_row": row_number,
        "accounting_status": "SEARCHABLE", "accounting_reason": "eligible",
    })

    if entity == "business":
        registry = clean(raw.get("registry_id"))
        name = clean(raw.get("name"))
        country = norm_country_iso(raw.get("country"))
        category = canonical_business_category(raw.get("category"))
        city = clean(raw.get("locality"))
        city_norm = norm_lookup_city(city)
        document.update({
            "registry_key": f"business:{registry}" if registry else "",
            "name": name or "", "category": category, "country": country, "city": city,
            "coarse_location": clean(raw.get("region")), "website": clean(raw.get("website")),
            "email": clean(raw.get("email")), "phone": clean(raw.get("phone")),
            "domain": host(raw.get("website")), "latitude": raw.get("latitude"),
            "longitude": raw.get("longitude"),
        })
        if int(raw.get("junk_flag") or 0) != 0:
            document.update(accounting_status="QUARANTINED", accounting_reason="source_junk_flag")
        elif not registry or not name or not country:
            document.update(accounting_status="UNINDEXABLE", accounting_reason="missing_identity_or_country")
        else:
            dimensions["country"].add(country)
            if city_norm: dimensions["city"].add(city_norm)
            category_terms = business_category_terms(category)
            dimensions["category"].update(category_terms)
            if city_norm:
                dimensions["city_category"].update(f"{city_norm}\0{term}" for term in category_terms)
            if norm_text(name): dimensions["name"].add(norm_text(name) or "")
            if document["domain"]: dimensions["domain"].add(document["domain"])

    elif entity == "person":
        name = clean(raw.get("name"))
        title, role_norm = norm_role(raw.get("title"))
        country = norm_country_iso(raw.get("country"))
        city = clean(raw.get("city"))
        city_norm = norm_lookup_city(city)
        # No source person id exists. Content-field identity incorrectly merged
        # 2,710 Canada rows in the subset. Keep uncertain people separate and
        # stable by immutable canonical object + physical row locator.
        registry = "s3people:" + hashlib.sha1(f"{key}:{row_number}".encode()).hexdigest()[:32]
        document.update({
            "registry_key": registry, "name": name or "", "title": title,
            "role_norm": role_norm, "employer": clean(raw.get("company_name")),
            "industry": clean(raw.get("industry")), "country": country, "city": city,
            "website": clean(raw.get("website")), "email": clean(raw.get("email")),
            "phone": clean(raw.get("phone")),
            "linkedin": clean(raw.get("personal_linkedin")) or clean(raw.get("company_linkedin")),
            "domain": host(raw.get("website")),
        })
        if not name or not country:
            document.update(accounting_status="UNINDEXABLE", accounting_reason="missing_name_or_country")
        else:
            dimensions["country"].add(country)
            if city_norm: dimensions["city"].add(city_norm)
            role_terms = phrase_terms(role_norm)
            if role_terms: dimensions["role"].update(role_terms)
            if norm_text(title): dimensions["title"].add(norm_text(title) or "")
            dimensions["industry"].update(phrase_terms(raw.get("industry")))
            dimensions["employer"].update(phrase_terms(raw.get("company_name")))
            if norm_text(name): dimensions["name"].add(norm_text(name) or "")

    elif entity == "company":
        name = clean(raw.get("company_name"))
        location = clean(raw.get("location"))
        location_norm = norm_text(location)
        country = company_location_country(location)
        # Same rule as people: source has no trustworthy unique id. A physical
        # locator is deterministic and never hallucinates a cross-row merge.
        registry = "s3company:" + hashlib.sha1(f"{key}:{row_number}".encode()).hexdigest()[:32]
        document.update({
            "registry_key": registry, "name": name or "", "category": clean(raw.get("category")),
            "country": country, "coarse_location": location, "website": clean(raw.get("website")),
            "email": clean(raw.get("email")), "phone": clean(raw.get("phone")),
            "linkedin": clean(raw.get("linkedin")), "domain": host(raw.get("website")),
        })
        if not name:
            document.update(accounting_status="UNINDEXABLE", accounting_reason="missing_name")
        else:
            category_terms = phrase_terms(raw.get("category"))
            dimensions["category"].update(category_terms)
            if country: dimensions["country"].add(country)
            if location_norm: dimensions["coarse_location"].add(location_norm)
            if norm_text(name): dimensions["name"].add(norm_text(name) or "")
            if document["domain"]: dimensions["domain"].add(document["domain"])

    else:
        name = clean(raw.get("name"))
        registry = f"investor:{clean(raw.get('id'))}" if clean(raw.get("id")) else ""
        sectors = list_terms(raw.get("sectors"))
        stages = list_terms(raw.get("stages"))
        country = norm_country_iso(raw.get("location_country"))
        city = clean(raw.get("location_city"))
        document.update({
            "registry_key": registry, "name": name or "", "employer": clean(raw.get("firm")),
            "country": country, "city": city, "coarse_location": clean(raw.get("location_raw")),
            "website": clean(raw.get("website")), "email": clean(raw.get("email")),
            "linkedin": clean(raw.get("linkedin")), "domain": host(raw.get("website")),
            "sector": ", ".join(sorted(sectors)) or None, "stage": ", ".join(sorted(stages)) or None,
            "kind": norm_text(raw.get("kind")), "check_min_usd": raw.get("check_min_usd"),
            "check_max_usd": raw.get("check_max_usd"),
        })
        if not registry or not name:
            document.update(accounting_status="UNINDEXABLE", accounting_reason="missing_id_or_name")
        else:
            dimensions["sector"].update(sectors)
            dimensions["stage"].update(stages)
            if country: dimensions["country"].add(country)
            if norm_lookup_city(city): dimensions["location"].add(norm_lookup_city(city) or "")
            if norm_text(raw.get("location_raw")): dimensions["location"].add(norm_text(raw.get("location_raw")) or "")
            if document["kind"]: dimensions["kind"].add(document["kind"])
            if norm_text(name): dimensions["name"].add(norm_text(name) or "")
    return document, dimensions


def encode_varint(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7f) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def zigzag(value: int) -> int:
    return value * 2 if value >= 0 else -value * 2 - 1


class PostingObjectWriter:
    def __init__(self, target: Path, entity: str, dimension: str):
        self.target = target
        self.entity = entity
        self.dimension = dimension
        self.body = target.with_suffix(".body.partial")
        self.body.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.body.open("wb")
        self.entries: list[list[Any]] = []
        self.offset = 0
        self.term: str | None = None
        self.term_start = 0
        self.term_count = 0
        self.previous = 0

    def _close_term(self) -> None:
        if self.term is not None:
            self.entries.append([self.term, self.term_start, self.offset - self.term_start, self.term_count])

    def add(self, term: str, doc_id: int, quality: int, row_flags: int) -> None:
        if term != self.term:
            self._close_term()
            self.term, self.term_start, self.term_count, self.previous = term, self.offset, 0, 0
        payload = encode_varint(zigzag(doc_id - self.previous)) + bytes((quality, row_flags))
        self.stream.write(payload)
        self.offset += len(payload)
        self.term_count += 1
        self.previous = doc_id

    def finish(self) -> dict[str, Any]:
        self._close_term()
        self.stream.close()
        header = json.dumps({"schemaVersion": 1, "entity": self.entity,
                             "dimension": self.dimension, "entries": self.entries},
                            ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        partial = self.target.with_suffix(self.target.suffix + ".partial")
        digest = hashlib.sha256()
        with partial.open("wb") as out:
            prefix = b"SPI1" + struct.pack("<I", len(header))
            out.write(prefix); out.write(header); digest.update(prefix); digest.update(header)
            with self.body.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    out.write(chunk); digest.update(chunk)
        self.body.unlink()
        partial.replace(self.target)
        return {"key": "", "bytes": self.target.stat().st_size, "sha256": digest.hexdigest(),
                "rows": sum(entry[3] for entry in self.entries)}


@dataclass
class BuildStats:
    physical: int = 0
    searchable: int = 0
    duplicate: int = 0
    quarantined: int = 0
    unindexable: int = 0
    failed: int = 0


class LowDiskSpace(RuntimeError):
    """A resumable stop: completed partitions are checkpointed; no manifest is activated."""


class Builder:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.started = time.perf_counter()
        self.root = Path(args.output_dir).resolve() / args.version
        self.state_root = (Path(args.checkpoint_dir).resolve() / args.version) if args.checkpoint_dir else self.root
        self.db_path = self.state_root / "build.duckdb"
        self.checkpoint_path = self.state_root / "checkpoint.json"
        self.db = None
        self.checkpoint = self._new_checkpoint()
        if not args.dry_run:
            if self.root.exists() and any(self.root.iterdir()) and not args.resume:
                raise RuntimeError(f"build version already exists; use --resume or a new --version: {self.root}")
            self.root.mkdir(parents=True, exist_ok=True)
            self.state_root.mkdir(parents=True, exist_ok=True)
            self.db = duckdb.connect(str(self.db_path))
            self.db.execute("create table if not exists postings(entity varchar, dimension varchar, bucket varchar, term varchar, doc_id bigint, quality utinyint, flags utinyint)")
            self.db.execute("create table if not exists identities(entity varchar, registry_key varchar, canonical_doc_id bigint, primary key(entity, registry_key))")
            self.checkpoint = self._load_checkpoint()
        self.session = boto3.Session(profile_name=args.s3_profile, region_name=args.region) \
            if args.s3_profile else boto3.Session(region_name=args.region)
        self.s3 = self.session.client(
            "s3",
            endpoint_url=args.endpoint,
            config=Config(connect_timeout=10, read_timeout=120,
                          retries={"max_attempts": 10, "mode": "standard"}),
        )
        self.source_objects: list[dict[str, Any]] = []
        self.posting_objects: list[dict[str, Any]] = []
        self.document_objects: list[dict[str, Any]] = []
        self.stats = {entity: BuildStats() for entity in ENTITY_PREFIXES}

    def _require_disk_headroom(self) -> None:
        """Stop before a partial partition can consume the configured safety reserve."""
        free = shutil.disk_usage(self.root).free
        minimum = self.args.min_free_gb * 1024 ** 3
        if free < minimum:
            raise LowDiskSpace(
                f"free space {free / 1024 ** 3:.2f} GiB is below --min-free-gb "
                f"{self.args.min_free_gb}; completed partitions are checkpointed; rerun with --resume"
            )

    def _load_checkpoint(self) -> dict[str, Any]:
        if self.checkpoint_path.exists() and self.args.resume:
            return json.loads(self.checkpoint_path.read_text("utf-8"))
        return self._new_checkpoint()

    @staticmethod
    def _new_checkpoint() -> dict[str, Any]:
        return {"createdAt": datetime.now(timezone.utc).isoformat(), "completed": {}, "documents": [], "stats": {}}

    def _save_checkpoint(self) -> None:
        self.checkpoint["documents"] = self.document_objects
        self.checkpoint["stats"] = {key: vars(value) for key, value in self.stats.items()}
        partial = self.checkpoint_path.with_suffix(".partial")
        partial.write_text(json.dumps(self.checkpoint, indent=2), "utf-8")
        partial.replace(self.checkpoint_path)

    def list_sources(self) -> list[tuple[str, str, int, str | None, str | None]]:
        selected = set(self.args.entity or ENTITY_PREFIXES)
        sources: list[tuple[str, str, int, str | None, str | None]] = []
        for entity, prefix in ENTITY_PREFIXES.items():
            if entity not in selected: continue
            token = None
            while True:
                page = self.s3.list_objects_v2(Bucket=self.args.bucket, Prefix=prefix,
                                               ContinuationToken=token) if token else \
                    self.s3.list_objects_v2(Bucket=self.args.bucket, Prefix=prefix)
                for item in page.get("Contents", []):
                    key = item.get("Key", "")
                    if key.endswith(".parquet"):
                        modified = item.get("LastModified")
                        sources.append((entity, key, int(item.get("Size", 0)),
                                        str(item.get("ETag", "")).strip('"') or None,
                                        modified.isoformat() if modified else None))
                token = page.get("NextContinuationToken")
                if not token: break
        return sorted(sources)

    class _S3RangeReader(io.RawIOBase):
        def __init__(self, s3, bucket_name: str, object_key: str, size: int):
            self.s3, self.bucket_name, self.object_key, self.size = s3, bucket_name, object_key, size
            self.position = 0

        def readable(self) -> bool: return True
        def seekable(self) -> bool: return True
        def tell(self) -> int: return self.position
        def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
            if whence == io.SEEK_SET: self.position = offset
            elif whence == io.SEEK_CUR: self.position += offset
            elif whence == io.SEEK_END: self.position = self.size + offset
            else: raise ValueError(f"unsupported whence: {whence}")
            return self.position

        def read(self, size: int = -1) -> bytes:
            if self.position >= self.size: return b""
            end = self.size - 1 if size is None or size < 0 else min(self.size - 1, self.position + size - 1)
            if end < self.position: return b""
            body = None
            for attempt in range(5):
                try:
                    body = self.s3.get_object(Bucket=self.bucket_name, Key=self.object_key,
                                              Range=f"bytes={self.position}-{end}")["Body"].read()
                    break
                except (BotoCoreError, ClientError, OSError):
                    if attempt == 4: raise
                    time.sleep(min(8, 0.5 * 2 ** attempt))
            assert body is not None
            self.position += len(body)
            return body

    def read_source(self, key: str, byte_size: int) -> pq.ParquetFile:
        reader = self._S3RangeReader(self.s3, self.args.bucket, key, byte_size)
        return pq.ParquetFile(reader)

    def _load_prior(self) -> None:
        self.document_objects = list(self.checkpoint.get("documents", []))
        for entity, raw in self.checkpoint.get("stats", {}).items():
            if entity in self.stats: self.stats[entity] = BuildStats(**raw)

    def build(self) -> dict[str, Any]:
        self._load_prior()
        if not self.args.dry_run:
            self._require_disk_headroom()
        sources = self.list_sources()
        base = 0
        source_plan: list[tuple[str, str, int, int, int]] = []
        for entity, key, byte_size, etag, last_modified in sources:
            if self.args.partition and not any(token.lower() in key.lower() for token in self.args.partition):
                continue
            parquet = self.read_source(key, byte_size)
            rows = parquet.metadata.num_rows
            self.source_objects.append({"key": key, "bytes": byte_size, "rows": rows,
                                        "etag": etag, "lastModified": last_modified})
            source_plan.append((entity, key, byte_size, rows, base))
            base += rows
        if self.args.dry_run:
            return {"dryRun": True, "version": self.args.version, "objects": len(source_plan),
                    "rows": sum(item[3] for item in source_plan), "writes": 0, "aiCalls": 0}
        for entity, key, byte_size, physical_rows, base_id in source_plan:
            self._require_disk_headroom()
            marker = f"{entity}:{key}"
            if marker in self.checkpoint["completed"]: continue
            self._build_partition(entity, key, byte_size, physical_rows, base_id)
        self._finalize_postings()
        return self._write_manifest(len(source_plan))

    def _build_partition(self, entity: str, key: str, byte_size: int, physical_rows: int,
                         base_id: int) -> None:
        self._require_disk_headroom()
        parquet = self.read_source(key, byte_size)
        safe_name = hashlib.sha256(key.encode()).hexdigest()[:16]
        relative = Path("documents") / entity / f"{safe_name}.parquet"
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".parquet.partial")
        if partial.exists(): partial.unlink()
        writer = pq.ParquetWriter(partial, DOCUMENT_SCHEMA, compression="zstd",
                                  use_dictionary=True, write_statistics=True)
        partition_stats = BuildStats()
        self.db.execute("begin transaction")
        try:
            processed = 0
            columns = [column for column in ENTITY_COLUMNS[entity] if column in parquet.schema.names]
            for batch in parquet.iter_batches(batch_size=self.args.batch_size, columns=columns):
                self._require_disk_headroom()
                raw_rows = batch.to_pylist()
                documents: list[dict[str, Any]] = []
                dimensions_by_doc: list[dict[str, set[str]]] = []
                identity_rows: list[dict[str, Any]] = []
                for offset, raw in enumerate(raw_rows):
                    source_row = processed + offset
                    document, dimensions = normalize_row(entity, raw, key, source_row, base_id + source_row)
                    documents.append(document); dimensions_by_doc.append(dimensions)
                    identity_rows.append({"entity": entity, "registry_key": document["registry_key"],
                                          "canonical_doc_id": document["doc_id"]})
                identities = pa.Table.from_pylist(identity_rows)
                self.db.register("identity_batch", identities)
                self.db.execute("insert or ignore into identities select * from identity_batch where registry_key <> ''")
                canonical = dict(self.db.execute("select b.canonical_doc_id, i.canonical_doc_id from identity_batch b join identities i using(entity,registry_key)").fetchall())
                self.db.unregister("identity_batch")
                posting_rows: list[dict[str, Any]] = []
                for document, dimensions in zip(documents, dimensions_by_doc):
                    partition_stats.physical += 1
                    status = document["accounting_status"]
                    if status == "SEARCHABLE" and canonical.get(document["doc_id"]) != document["doc_id"]:
                        document["accounting_status"] = "DUPLICATE"
                        document["accounting_reason"] = f"duplicate_of:{canonical[document['doc_id']]}"
                        status = "DUPLICATE"
                    if status == "SEARCHABLE": partition_stats.searchable += 1
                    elif status == "DUPLICATE": partition_stats.duplicate += 1
                    elif status == "QUARANTINED": partition_stats.quarantined += 1
                    elif status == "UNINDEXABLE": partition_stats.unindexable += 1
                    else: partition_stats.failed += 1
                    if status != "SEARCHABLE": continue
                    row_flags = flags(document)
                    quality = int(document["quality_score"])
                    for dimension, terms in dimensions.items():
                        for term in terms:
                            if term:
                                posting_rows.append({"entity": entity, "dimension": dimension,
                                    "bucket": bucket(term, self.args.bucket_hex_chars), "term": term,
                                    "doc_id": document["doc_id"], "quality": quality, "flags": row_flags})
                writer.write_table(pa.Table.from_pylist(documents, schema=DOCUMENT_SCHEMA))
                if posting_rows:
                    table = pa.Table.from_pylist(posting_rows, schema=POSTING_SCHEMA)
                    self.db.register("posting_batch", table)
                    self.db.execute("insert into postings select * from posting_batch")
                    self.db.unregister("posting_batch")
                processed += len(raw_rows)
            writer.close()
            self.db.execute("commit")
            partial.replace(target)
        except Exception:
            writer.close()
            self.db.execute("rollback")
            if partial.exists(): partial.unlink()
            raise
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        rows_written = pq.ParquetFile(target).metadata.num_rows
        ref = {"key": str(Path(self.args.prefix) / "versions" / self.args.version / relative).replace("\\", "/"),
               "bytes": target.stat().st_size, "sha256": digest, "rows": rows_written,
               "entity": entity, "startId": base_id, "endId": base_id + rows_written,
               "sourceObject": key}
        self.document_objects.append(ref)
        current = self.stats[entity]
        for name in vars(current): setattr(current, name, getattr(current, name) + getattr(partition_stats, name))
        self.checkpoint["completed"][f"{entity}:{key}"] = {"rows": rows_written, "document": ref["key"]}
        self._save_checkpoint()

    def _finalize_postings(self) -> None:
        self._require_disk_headroom()
        cursor = self.db.execute("select entity, dimension, bucket, term, doc_id, quality, flags from postings order by entity, dimension, bucket, term, quality desc, doc_id")
        active: PostingObjectWriter | None = None
        active_group: tuple[str, str, str] | None = None
        while rows := cursor.fetchmany(50_000):
            self._require_disk_headroom()
            for entity, dimension, shard, term, doc_id, quality, row_flags in rows:
                group = (entity, dimension, shard)
                if group != active_group:
                    if active:
                        ref = active.finish(); ref["key"] = str(Path(self.args.prefix) / "versions" / self.args.version / active.target.relative_to(self.root)).replace("\\", "/")
                        self.posting_objects.append(ref)
                    target = self.root / "postings" / entity / dimension / f"{shard}.pidx"
                    active = PostingObjectWriter(target, entity, dimension)
                    active_group = group
                active.add(term, int(doc_id), int(quality), int(row_flags))
        if active:
            ref = active.finish(); ref["key"] = str(Path(self.args.prefix) / "versions" / self.args.version / active.target.relative_to(self.root)).replace("\\", "/")
            self.posting_objects.append(ref)

    def _write_manifest(self, total_partitions: int) -> dict[str, Any]:
        counts = {entity: vars(stats) for entity, stats in self.stats.items()}
        for entity, values in counts.items():
            if values["physical"] != sum(values[name] for name in ("searchable", "duplicate", "quarantined", "unindexable")) + values["failed"]:
                raise RuntimeError(f"reconciliation failed for {entity}: {values}")
        completed_partitions = len(self.checkpoint["completed"])
        if completed_partitions != total_partitions:
            raise RuntimeError(f"refusing complete manifest: {completed_partitions}/{total_partitions} partitions")
        manifest = {
            "version": self.args.version, "status": "complete",
            "createdAt": self.checkpoint.get("createdAt") or datetime.now(timezone.utc).isoformat(),
            "schemaVersion": SCHEMA_VERSION,
            "normalizerVersion": NORMALIZER_VERSION, "sourceBucket": self.args.bucket,
            "sourceObjects": self.source_objects, "counts": counts,
            "postingBucketHexChars": self.args.bucket_hex_chars,
            "postingObjects": self.posting_objects, "documentObjects": self.document_objects,
            "build": {"completedPartitions": completed_partitions,
                      "totalPartitions": total_partitions, "aiCalls": 0,
                      "elapsedMs": round((time.perf_counter() - self.started) * 1000)},
        }
        path = self.root / "manifest.json"
        path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8")
        if self.args.upload:
            self._upload(manifest, path)
        return manifest

    def _upload(self, manifest: dict[str, Any], manifest_path: Path) -> None:
        for ref in [*self.document_objects, *self.posting_objects]:
            relative = Path(ref["key"]).relative_to(Path(self.args.prefix) / "versions" / self.args.version)
            local = self.root / relative
            try:
                existing = self.s3.head_object(Bucket=self.args.bucket, Key=ref["key"])
                if existing.get("Metadata", {}).get("sha256") != ref["sha256"]:
                    raise RuntimeError(f"immutable index object already exists with different checksum: {ref['key']}")
            except ClientError as error:
                if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "NotFound"):
                    raise
                self.s3.upload_file(str(local), self.args.bucket, ref["key"],
                    ExtraArgs={"Metadata": {"sha256": ref["sha256"], "search-index-version": self.args.version}})
            remote = self.s3.head_object(Bucket=self.args.bucket, Key=ref["key"])
            if int(remote["ContentLength"]) != int(ref["bytes"]) or remote.get("Metadata", {}).get("sha256") != ref["sha256"]:
                raise RuntimeError(f"uploaded object verification failed: {ref['key']}")
        manifest_key = str(Path(self.args.prefix) / "versions" / self.args.version / "manifest.json").replace("\\", "/")
        manifest_body = manifest_path.read_bytes()
        manifest_sha = hashlib.sha256(manifest_body).hexdigest()
        try:
            existing = self.s3.head_object(Bucket=self.args.bucket, Key=manifest_key)
            if existing.get("Metadata", {}).get("sha256") != manifest_sha:
                raise RuntimeError(f"immutable manifest already exists with different checksum: {manifest_key}")
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "NotFound"):
                raise
            self.s3.put_object(Bucket=self.args.bucket, Key=manifest_key, Body=manifest_body,
                               ContentType="application/json",
                               Metadata={"sha256": manifest_sha, "search-index-version": self.args.version})
        if self.args.activate:
            previous = None
            try:
                previous = json.loads(self.s3.get_object(Bucket=self.args.bucket,
                    Key=f"{self.args.prefix}/active.json")["Body"].read()).get("version")
            except self.s3.exceptions.NoSuchKey:
                pass
            if self.args.expected_active_version != previous:
                raise RuntimeError(f"active version changed: expected {self.args.expected_active_version!r}, found {previous!r}")
            active = {"version": self.args.version, "manifestKey": manifest_key,
                      "activatedAt": datetime.now(timezone.utc).isoformat(),
                      "previousVersion": previous}
            self.s3.put_object(Bucket=self.args.bucket, Key=f"{self.args.prefix}/active.json",
                               Body=json.dumps(active).encode(), ContentType="application/json")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build compact deterministic S3 search index")
    parser.add_argument("--version", required=True, help="Immutable version, e.g. 2026-09-19-v1")
    parser.add_argument("--output-dir", default=".search-index-build")
    parser.add_argument("--checkpoint-dir", default=None, help="Persistent checkpoint/working DB root")
    parser.add_argument("--entity", action="append", choices=sorted(ENTITY_PREFIXES))
    parser.add_argument("--partition", action="append", help="Only source keys containing token")
    parser.add_argument("--batch-size", type=int, default=20_000)
    parser.add_argument("--min-free-gb", type=float, default=15.0,
                        help="stop safely below this free-space reserve (default: 15 GiB)")
    parser.add_argument("--bucket-hex-chars", type=int, default=3, choices=[2, 3, 4])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--expected-active-version", default=None,
                        help="Required active version observed before atomic pointer switch; omit only for first activation")
    parser.add_argument("--bucket", default=os.environ.get("SEARCH_INDEX_BUCKET") or os.environ.get("S3_BUCKET") or S3_BUCKET_DEFAULT)
    parser.add_argument("--prefix", default=os.environ.get("SEARCH_INDEX_PREFIX") or DEFAULT_PREFIX)
    parser.add_argument("--region", default=os.environ.get("SEARCH_INDEX_REGION") or os.environ.get("AWS_REGION") or "us-east-2")
    parser.add_argument("--endpoint", default=os.environ.get("SEARCH_INDEX_ENDPOINT"))
    parser.add_argument("--s3-profile", default=os.environ.get("AWS_PROFILE"))
    args = parser.parse_args(argv)
    if args.activate and not args.upload: parser.error("--activate requires --upload")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{2,63}", args.version): parser.error("unsafe --version")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    result = Builder(args).build()
    if result.get("dryRun"):
        summary = result
    else:
        counts = result["counts"]
        summary = {
            "version": result["version"], "status": result["status"],
            "physical": sum(row["physical"] for row in counts.values()),
            "searchable": sum(row["searchable"] for row in counts.values()),
            "postingObjects": len(result["postingObjects"]),
            "documentObjects": len(result["documentObjects"]),
            "partitions": result["build"]["completedPartitions"],
            "elapsedMs": result["build"]["elapsedMs"], "aiCalls": 0,
        }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
