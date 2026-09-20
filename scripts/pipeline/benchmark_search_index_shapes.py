"""Compare compact row shards with binary postings on an existing subset build."""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import struct
import time
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from build_search_index import business_category_terms, norm_lookup_city


def bucket(term: str, chars: int) -> str:
    return hashlib.sha256(term.encode()).hexdigest()[:chars]


def read_varint(payload: bytes, at: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = payload[at]; at += 1
        value += (byte & 0x7f) << shift
        if byte & 0x80 == 0: return value, at
        shift += 7


def lookup_posting(path: Path, term: str) -> tuple[int, int]:
    with path.open("rb") as stream:
        prefix = stream.read(8)
        if prefix[:4] != b"SPI1": raise ValueError("bad posting magic")
        header_size = struct.unpack("<I", prefix[4:])[0]
        header = json.loads(stream.read(header_size))
        entry = next((row for row in header["entries"] if row[0] == term), None)
        if entry is None:
            raise ValueError(f"term absent from expected posting bucket: {term!r}; sample={header['entries'][:3]!r}")
        stream.seek(8 + header_size + entry[1])
        payload = stream.read(entry[2])
    at = count = 0
    while at < len(payload):
        _, at = read_varint(payload, at); at += 2; count += 1
    return count, 8 + header_size + len(payload)


def timed(callable_, runs: int = 8) -> tuple[float, float]:
    values = []
    for _ in range(runs):
        start = time.perf_counter(); callable_(); values.append((time.perf_counter() - start) * 1000)
    return values[0], statistics.median(values[1:])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", required=True)
    parser.add_argument("--bucket-hex-chars", type=int, default=3)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.build).resolve()
    documents = sorted((root / "documents" / "business").glob("*.parquet"))
    if not documents: raise SystemExit("business documents missing")
    rows = [row for path in documents for row in pq.read_table(path).to_pylist()
            if row["accounting_status"] == "SEARCHABLE" and row.get("city") and row.get("category")]
    terms: Counter[str] = Counter()
    for row in rows:
        city_norm = norm_lookup_city(row["city"])
        if city_norm:
            terms.update(f"{city_norm}\0{category}" for category in business_category_terms(row["category"]))
    term, candidate_count = sorted(terms.items(), key=lambda item: (-item[1], item[0]))[0]

    row_root = root / f"benchmark-row-shards-{Path(args.output).stem}"
    if row_root.exists(): raise SystemExit(f"benchmark output already exists: {row_root}")
    row_root.mkdir(parents=True)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        city_norm = norm_lookup_city(row["city"])
        if not city_norm:
            continue
        for category in business_category_terms(row["category"]):
            indexed_row = {**row, "lookup_term": f"{city_norm}\0{category}"}
            grouped[bucket(indexed_row["lookup_term"], args.bucket_hex_chars)].append(indexed_row)
    for shard, shard_rows in grouped.items():
        pq.write_table(pa.Table.from_pylist(shard_rows), row_root / f"{shard}.parquet",
                       compression="zstd", use_dictionary=True)
    row_path = row_root / f"{bucket(term, args.bucket_hex_chars)}.parquet"
    row_query = lambda: [row for row in pq.read_table(row_path, columns=["lookup_term", "doc_id"]).to_pylist()
                         if row["lookup_term"] == term]
    row_cold, row_warm = timed(row_query)

    posting_path = root / "postings" / "business" / "city_category" / f"{bucket(term, args.bucket_hex_chars)}.pidx"
    posting_query = lambda: lookup_posting(posting_path, term)
    posting_cold, posting_warm = timed(posting_query)
    posting_count, posting_bytes_read = posting_query()
    business_posting_bytes = sum(path.stat().st_size for path in (root / "postings" / "business").rglob("*.pidx"))
    document_bytes = sum(path.stat().st_size for path in documents)
    result = {
        "subsetRows": len(rows), "term": term.replace("\0", "|"), "candidateCount": candidate_count,
        "compactRowShards": {
            "bytes": sum(path.stat().st_size for path in row_root.glob("*.parquet")),
            "bytesPerRecord": sum(path.stat().st_size for path in row_root.glob("*.parquet")) / len(rows),
            "objects": len(grouped), "queryObjectBytes": row_path.stat().st_size,
            "coldMs": round(row_cold, 3), "warmMedianMs": round(row_warm, 3),
        },
        "binaryPostingsPlusDocuments": {
            "bytes": business_posting_bytes + document_bytes,
            "bytesPerRecord": (business_posting_bytes + document_bytes) / len(rows),
            "objects": len(list((root / "postings" / "business").rglob("*.pidx"))) + len(documents),
            "postingBytesRead": posting_bytes_read, "postingCount": posting_count,
            "coldMs": round(posting_cold, 3), "warmMedianMs": round(posting_warm, 3),
        },
        "decision": "binary_postings_plus_parquet_documents",
        "reason": "bounded exact lookup, multi-dimension intersection, one document copy, native range reads",
    }
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), "utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
