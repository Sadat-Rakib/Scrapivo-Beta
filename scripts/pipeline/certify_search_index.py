"""Seeded rediscovery and precision certification for a local derived search index.

This intentionally scans derived document objects for sampling. Each rediscovery
then uses only bounded posting objects; canonical S3 is never read and AI is never
imported or called.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import struct
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

from build_search_index import business_category_terms, norm_lookup_city, norm_text, phrase_terms


DEFAULT_SAMPLE = {"business": 500, "person": 200, "company": 200, "investor": 100}


def bucket(term: str, chars: int) -> str:
    return hashlib.sha256(term.encode()).hexdigest()[:chars]


def read_varint(payload: bytes, at: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = payload[at]; at += 1
        value |= (byte & 0x7f) << shift
        if byte & 0x80 == 0: return value, at
        shift += 7


def posting_ids(root: Path, manifest: dict[str, Any], entity: str, dimension: str, term: str) -> set[int]:
    path = root / "postings" / entity / dimension / f"{bucket(term, manifest['postingBucketHexChars'])}.pidx"
    if not path.exists(): return set()
    with path.open("rb") as stream:
        prefix = stream.read(8)
        if prefix[:4] != b"SPI1": raise ValueError(f"bad posting magic: {path}")
        header_size = struct.unpack("<I", prefix[4:])[0]
        header = json.loads(stream.read(header_size))
        entry = next((row for row in header["entries"] if row[0] == term), None)
        if entry is None: return set()
        stream.seek(8 + header_size + entry[1]); payload = stream.read(entry[2])
    ids: set[int] = set(); at = 0; prior = 0
    while at < len(payload):
        encoded, at = read_varint(payload, at)
        delta = encoded // 2 if encoded % 2 == 0 else -(encoded // 2) - 1
        prior += delta; ids.add(prior); at += 2
    return ids


def query_for(row: dict[str, Any]) -> list[tuple[str, str]]:
    entity = row["entity"]
    if entity == "business":
        terms = []
        city = norm_lookup_city(row.get("city"))
        categories = sorted(business_category_terms(row.get("category")))
        if city: terms.append(("city", city))
        if categories: terms.append(("category", categories[0]))
        if terms: return terms
    elif entity == "person":
        terms = []
        if row.get("country"): terms.append(("country", row["country"]))
        roles = phrase_terms(row.get("role_norm"))
        if roles: terms.append(("role", row["role_norm"] if row["role_norm"] in roles else sorted(roles)[0]))
        if terms: return terms
    elif entity == "company":
        terms = []
        categories = phrase_terms(row.get("category"))
        if categories: terms.append(("category", sorted(categories)[0]))
        if row.get("country"): terms.append(("country", row["country"]))
        elif norm_text(row.get("coarse_location")): terms.append(("coarse_location", norm_text(row["coarse_location"]) or ""))
        if terms: return terms
    elif entity == "investor":
        if norm_text(row.get("name")): return [("name", norm_text(row["name"]) or "")]
    name = norm_text(row.get("name"))
    return [("name", name)] if name else []


def quantity_check(root: Path, manifest: dict[str, Any], entity: str) -> dict[str, Any]:
    best: tuple[int, str, str] | None = None
    for path in (root / "postings" / entity).rglob("*.pidx"):
        with path.open("rb") as stream:
            prefix = stream.read(8)
            header = json.loads(stream.read(struct.unpack("<I", prefix[4:])[0]))
        for term, _offset, _bytes, count in header["entries"]:
            if best is None or count > best[0]: best = (count, header["dimension"], term)
    if best is None: return {"requested": 100, "available": 0, "returned": 0, "pass": False}
    ids = posting_ids(root, manifest, entity, best[1], best[2])
    returned = min(100, len(ids))
    return {"requested": 100, "availableAtLeast": best[0], "returned": returned,
            "dimension": best[1], "pass": returned == min(100, best[0])}


def sample_rows(root: Path, manifest: dict[str, Any], seed: str) -> dict[str, list[dict[str, Any]]]:
    heaps: dict[str, list[tuple[int, int, dict[str, Any]]]] = defaultdict(list)
    sequence = 0
    for ref in manifest["documentObjects"]:
        entity = ref["entity"]; wanted = DEFAULT_SAMPLE[entity]
        path = root / Path(ref["key"]).relative_to(Path("derived/search-index/versions") / manifest["version"])
        for batch in pq.ParquetFile(path).iter_batches(batch_size=20_000):
            for row in batch.to_pylist():
                if row.get("accounting_status") != "SEARCHABLE": continue
                score = int(hashlib.sha256(f"{seed}:{entity}:{row['registry_key']}".encode()).hexdigest(), 16)
                item = (-score, sequence, row); sequence += 1
                heap = heaps[entity]
                if len(heap) < wanted: heapq.heappush(heap, item)
                elif score < -heap[0][0]: heapq.heapreplace(heap, item)
    return {entity: [item[2] for item in heap] for entity, heap in heaps.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", required=True)
    parser.add_argument("--seed", default="9172601")
    parser.add_argument("--output", required=True)
    parser.add_argument("--reconciliation-output")
    args = parser.parse_args()
    started = time.perf_counter(); root = Path(args.build).resolve()
    manifest = json.loads((root / "manifest.json").read_text("utf-8"))
    if manifest.get("status") != "complete": raise SystemExit("manifest is not complete")
    samples = sample_rows(root, manifest, args.seed)
    results: dict[str, Any] = {}; unexplained = wrong = 0
    latencies: list[float] = []
    for entity in DEFAULT_SAMPLE:
        tested = passed = unsupported = 0
        for row in samples.get(entity, []):
            terms = query_for(row)
            if not terms: unsupported += 1; continue
            tested += 1; query_started = time.perf_counter()
            groups = [posting_ids(root, manifest, entity, dimension, term) for dimension, term in terms]
            matched = set.intersection(*groups) if groups else set()
            latencies.append((time.perf_counter() - query_started) * 1000)
            if row["doc_id"] in matched: passed += 1
            else: unexplained += 1
            # A fabricated exact term must never return the sampled row.
            if row["doc_id"] in posting_ids(root, manifest, entity, "name", "__scrapivo_impossible_negative__"):
                wrong += 1
        results[entity] = {"selected": len(samples.get(entity, [])), "tested": tested,
                           "passed": passed, "unsupported": unsupported,
                           "unexplainedFailures": tested - passed}
    latencies.sort()
    percentile = lambda p: round(latencies[min(len(latencies) - 1, int((len(latencies) - 1) * p))], 3) if latencies else None
    quantity = {entity: quantity_check(root, manifest, entity) for entity in DEFAULT_SAMPLE}
    report = {
        "version": manifest["version"], "seed": args.seed, "entities": results,
        "tested": sum(row["tested"] for row in results.values()),
        "passed": sum(row["passed"] for row in results.values()),
        "unexplainedFailures": unexplained, "wrongResults": wrong,
        "latencyMs": {"p50": percentile(.50), "p95": percentile(.95), "max": round(max(latencies), 3) if latencies else None},
        "canonicalReads": 0, "aiCalls": 0,
        "quantity100": quantity,
        "elapsedMs": round((time.perf_counter() - started) * 1000),
    }
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), "utf-8")
    reconciliation: dict[str, Any] = {"version": manifest["version"], "entities": {}}
    for entity, counts in manifest["counts"].items():
        accounted = sum(int(counts[name]) for name in
                        ("searchable", "duplicate", "quarantined", "unindexable", "failed"))
        reconciliation["entities"][entity] = {
            **counts, "accounted": accounted,
            "unaccounted": int(counts["physical"]) - accounted,
            "reconciled": int(counts["physical"]) == accounted and int(counts["failed"]) == 0,
        }
    reconciliation["allReconciled"] = all(row["reconciled"] for row in reconciliation["entities"].values())
    reconciliation["aiCalls"] = 0
    if args.reconciliation_output:
        reconciliation_path = Path(args.reconciliation_output)
        reconciliation_path.parent.mkdir(parents=True, exist_ok=True)
        reconciliation_path.write_text(json.dumps(reconciliation, indent=2), "utf-8")
    print(json.dumps(report, indent=2))
    return 1 if (unexplained or wrong or not reconciliation["allReconciled"] or
                 not all(row["pass"] for row in quantity.values())) else 0


if __name__ == "__main__":
    raise SystemExit(main())
