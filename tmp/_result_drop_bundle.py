from __future__ import annotations

import pathlib
import shutil
import subprocess
import zipfile


root = pathlib.Path.cwd().resolve()
out = root / "reports" / "result-drop-audit"
source_dir = out / "scrapivo-result-drop-source"
source_files = [
    "src/routes/_authenticated/discover.tsx",
    "src/lib/spec-search.functions.ts",
    "src/lib/understanding/to-search-spec.ts",
    "src/lib/search/search-spec.ts",
    "src/lib/search/search-spec-extract.ts",
    "src/lib/search/live-gapfill.ts",
    "src/lib/search/source-plan.ts",
    "src/lib/search/source-capabilities.ts",
    "src/lib/search/osm-local-businesses.server.ts",
    "src/lib/search/place-disambiguate.server.ts",
    "src/lib/search/provider-ladder.ts",
    "src/lib/search/searxng.server.ts",
    "src/lib/indexed/search-index.server.ts",
    "src/lib/object-index/search.server.ts",
    "src/lib/canonical/read-parquet.server.ts",
    "src/lib/canonical/people.server.ts",
    "src/lib/canonical/companies.server.ts",
    "src/lib/canonical/businesses.server.ts",
    "src/lib/canonical/investors.server.ts",
    "src/lib/search/coverage-selector.ts",
    "src/lib/search/flag.ts",
    "src/lib/search/mode-gate.ts",
    "src/lib/search/clarifier.ts",
    "src/lib/search/offer-taxonomy.ts",
    "src/lib/search/phone-safety.ts",
    "src/lib/search/format-place.ts",
    "src/lib/search/browser-live.server.ts",
    "src/lib/search/browser-research.ts",
    "src/lib/research-agent/browser.ts",
    "src/lib/research-agent/agent-browser-cli.server.ts",
    "src/lib/search/page-classify.ts",
    "src/lib/search/candidate-merge.ts",
    "src/lib/search/canonical-contract.ts",
    "src/lib/search/entity-resolve.ts",
    "src/lib/search/site-url.ts",
    "src/lib/search/completeness.ts",
    "src/lib/search/enrich-incomplete.ts",
    "src/lib/search/enrichment-plan.ts",
    "src/lib/search/enrichment-run.ts",
    "src/lib/search/enrichment-merge.ts",
    "src/lib/contact/discover-contacts.server.ts",
    "src/lib/contact/harvest.server.ts",
    "src/lib/search/evidence.ts",
    "src/lib/search/claim-binding.ts",
    "src/lib/search/verification.ts",
    "src/lib/search/qualify.ts",
    "src/lib/search/person-qualify.ts",
    "src/lib/search/person-employment.ts",
    "src/lib/search/location-resolver.ts",
    "src/lib/search/social-qualify.ts",
    "src/lib/search/job-qualify.ts",
    "src/lib/search/qualified-lead.ts",
    "src/lib/search/qualified-lead-view.ts",
    "src/lib/search/lead-segments.ts",
    "src/lib/search/search-run-client.ts",
    "src/lib/search/search-run.server.ts",
    "src/lib/search/search-run.ts",
    "src/lib/search/search-run.functions.ts",
    "src/lib/search/search-browser-progress.server.ts",
    "src/lib/search/outcome-ui.ts",
    "src/components/discover/result-tabs.tsx",
    "src/components/discover/entity-detail-panel.tsx",
    "src/components/lead-card.tsx",
]
test_files = [
    "src/lib/search/browser-live.server.test.ts",
    "src/lib/search/browser-live-fallback.test.ts",
    "src/lib/search/__tests__/live-browser-integration.test.ts",
    "src/lib/search/__tests__/osm-no-website-seed.test.ts",
    "src/lib/search/__tests__/research-candidate-semantics.test.ts",
    "src/lib/search/__tests__/candidate-merge.test.ts",
    "src/lib/search/__tests__/pipeline-phases.test.ts",
    "src/lib/search/__tests__/m8-enrichment.test.ts",
    "src/lib/search/__tests__/m9-verification.test.ts",
    "src/lib/search/__tests__/milestone1-theorem.test.ts",
    "src/lib/search/__tests__/m12-people.test.ts",
    "src/lib/search/__tests__/m11-ui-run.test.ts",
]
required_docs = [
    "current-execution-map.md",
    "candidate-drop-ledger.md",
    "candidate-lifecycle.md",
    "early-gating-analysis.md",
    "enrichment-map.md",
    "field-requirement-map.md",
    "runtime-drop-evidence.md",
    "final-delivery-map.md",
    "test-intent-map.md",
]
for rel in source_files + test_files:
    if rel.startswith(".") or ".env" in rel or "node_modules" in rel or "secret" in rel.lower():
        raise RuntimeError(f"refusing path: {rel}")
    src = (root / rel).resolve()
    if not src.is_file() or not src.is_relative_to(root):
        raise RuntimeError(f"missing/outside source: {rel}")
    dst = source_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)

for doc in required_docs:
    if not (out / doc).is_file():
        raise RuntimeError(f"missing audit document: {doc}")

shutil.copyfile(root / "tmp/result-drop-status-capture.txt", out / "git-status.txt")
shutil.copyfile(root / "tmp/result-drop-diff-stat-capture.txt", out / "current-diff-stat.txt")
paths = source_files + test_files + ["LATER_WORK.md"]
diff = subprocess.run(["rtk", "proxy", "git", "diff", "--", *paths], cwd=root, capture_output=True, check=True)
(out / "relevant-working-tree.diff").write_bytes(diff.stdout)
shutil.copyfile(root / "LATER_WORK.md", out / "LATER_WORK.md")

archive = out / "scrapivo-result-drop-audit.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for doc in required_docs + ["git-status.txt", "current-diff-stat.txt", "relevant-working-tree.diff", "LATER_WORK.md"]:
        z.write(out / doc, doc)
    for rel in source_files + test_files:
        z.write(source_dir / rel, "scrapivo-result-drop-source/" + rel)

print(f"source_files={len(source_files)} test_files={len(test_files)} zip={archive} bytes={archive.stat().st_size}")
