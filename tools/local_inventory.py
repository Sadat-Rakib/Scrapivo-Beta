"""Local dataset inventory (streaming, no full-file RAM load).

Walks data/ and records per file: path, size, extension, row estimate
(line count for JSONL via streaming, entry count for JSON manifests),
schema sample (keys of first record), git-ignore status, app-reference status.

Writes: reports/DATA_INVENTORY.csv + reports/DATA_INVENTORY.md
"""
import csv
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "data")
OUT_CSV = os.path.join(REPO, "reports", "DATA_INVENTORY.csv")
OUT_MD = os.path.join(REPO, "reports", "DATA_INVENTORY.md")

# Known app references from static audit (Phase 0). filename -> loader/caller
APP_REFS = {
    "investors_merged.json": "src/lib/investors/search.ts:6 static import; Investors page live path",
    "investors_complete.jsonl": "src/lib/investors/local-file-source.ts:33; unified discover only",
    "companies_complete.jsonl": "src/lib/companies/local-file-source.ts; hiring-only blend",
    "people_complete.jsonl": "NONE in src/ (pipeline scripts only)",
    "pipeline.duckdb": "NONE in src/ (scripts/pipeline/store.py only)",
    "BasicCompanyDataAsOneFile.zip": "NONE in src/ (pipeline input only)",
    "city_country_map.json": "src/lib/local/city-gazetteer.ts routing",
    "regions_manifest.json": "src/lib/local/businesses-file-source.ts routing",
}
LOCAL_BIZ_REF = "src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored)"


def git_ignored(path):
    try:
        r = subprocess.run(
            ["git", "check-ignore", "-q", path],
            cwd=REPO,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return "yes" if r.returncode == 0 else "no"
    except Exception:
        return "unknown"


def sample_jsonl_keys(path, max_lines=3):
    keys, n, examples = [], 0, []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                n += 1
                if len(examples) < max_lines:
                    try:
                        obj = json.loads(line)
                        if isinstance(obj, dict):
                            if not keys:
                                keys = list(obj.keys())
                            examples.append({k: str(v)[:60] for k, v in list(obj.items())[:6]})
                    except json.JSONDecodeError:
                        pass
    except OSError:
        return 0, "", ""
    return n, ";".join(keys[:24]), json.dumps(examples[:1], ensure_ascii=False)[:400]


def count_lines_streaming(path):
    n = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            n += chunk.count(b"\n")
    return n


def entity_of(name):
    n = name.lower()
    if n.startswith("investors"):
        return "investors"
    if n.startswith("companies"):
        return "companies"
    if n.startswith("local_businesses"):
        return "local-businesses"
    if n.startswith("people"):
        return "people"
    if n.endswith((".duckdb", ".zip")):
        return "companies-raw-infra"
    return "other"


def main():
    rows = []
    for fname in sorted(os.listdir(DATA_DIR)):
        fpath = os.path.join(DATA_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        size = os.path.getsize(fpath)
        ext = os.path.splitext(fname)[1].lower().lstrip(".")
        entity = entity_of(fname)
        ignored = git_ignored(os.path.join("data", fname))
        if fname in APP_REFS:
            ref = APP_REFS[fname]
        elif fname.startswith("local_businesses_"):
            ref = LOCAL_BIZ_REF
        else:
            ref = "NONE known"
        schema, example = "", ""
        row_est = ""
        if fname.endswith(".jsonl"):
            # line count = row estimate (streaming, exact for well-formed JSONL)
            row_est = str(count_lines_streaming(fpath))
            _, schema, example = sample_jsonl_keys(fpath)
        elif fname.endswith(".json"):
            try:
                with open(fpath, encoding="utf-8", errors="replace") as f:
                    obj = json.load(f)
                if isinstance(obj, dict):
                    schema = ";".join(list(obj.keys())[:24])
                    if isinstance(obj.get("investors"), list):
                        row_est = str(len(obj["investors"]))
                    elif isinstance(obj.get("entities"), list):
                        row_est = str(len(obj["entities"]))
            except Exception as e:
                schema = f"unparsed: {e}"[:200]
        rows.append(
            {
                "path": os.path.join("data", fname),
                "filename": fname,
                "extension": ext,
                "size_bytes": str(size),
                "size_mb": f"{size/1024/1024:.2f}",
                "row_estimate": row_est,
                "entity": entity,
                "schema_keys": schema,
                "gitignored": ignored,
                "app_reference": ref,
                "sample": example,
            }
        )
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "path", "filename", "extension", "size_bytes", "size_mb",
                "row_estimate", "entity", "schema_keys", "gitignored",
                "app_reference", "sample",
            ],
        )
        w.writeheader()
        w.writerows(rows)
    total = sum(int(r["size_bytes"]) for r in rows)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# DATA_INVENTORY (generated, streaming, read-only)\n\n")
        f.write(f"Files: {len(rows)} | Total bytes: {total} ({total/1024/1024/1024:.2f} GiB)\n\n")
        f.write("| file | MB | rows | entity | gitignored | app use |\n|---|---|---|---|---|---|\n")
        for r in rows:
            f.write(
                f"| {r['filename']} | {r['size_mb']} | {r['row_estimate']} | {r['entity']} "
                f"| {r['gitignored']} | {r['app_reference'][:80]} |\n"
            )
        f.write(
            "\nNotes: row_estimate = streaming newline count for JSONL; "
            "schema_keys = keys of first record; samples truncated.\n"
        )
    print(f"wrote {OUT_CSV} ({len(rows)} files, {total/1024/1024/1024:.2f} GiB)")


if __name__ == "__main__":
    sys.exit(main())
