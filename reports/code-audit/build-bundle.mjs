import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'reports/code-audit');
const bundle = path.join(out, 'scrapivo-core-audit');
const source = [
  'package.json', 'vite.config.ts',
  'src/routes/_authenticated/discover.tsx',
  'src/components/discover/unified-composer.tsx',
  'src/components/discover/result-tabs.tsx',
  'src/components/discover/find-card.tsx',
  'src/components/discover/entity-detail-panel.tsx',
  'src/components/discover/thinking-steps.tsx',
  'src/components/discover/clarify-panel.tsx',
  'src/lib/spec-search.functions.ts',
  'src/lib/search.functions.ts',
  'src/lib/search/search-run.functions.ts',
  'src/lib/search/search-run.server.ts',
  'src/lib/search/search-run-client.ts',
  'src/lib/search/search-run.ts',
  'src/lib/search/search-browser-progress.server.ts',
  'src/lib/search/search-spec.ts',
  'src/lib/search/flag.ts',
  'src/lib/search/search-spec-extract.ts',
  'src/lib/search/mode-gate.ts',
  'src/lib/search/clarifier.ts',
  'src/lib/understanding/to-search-spec.ts',
  'src/lib/understanding/extract.server.ts',
  'src/lib/understanding/fallback.ts',
  'src/lib/understanding/frame.ts',
  'src/lib/understanding/validate.ts',
  'src/lib/canonical/people.server.ts',
  'src/lib/canonical/companies.server.ts',
  'src/lib/canonical/businesses.server.ts',
  'src/lib/canonical/investors.server.ts',
  'src/lib/canonical/read-parquet.server.ts',
  'src/lib/indexed/search-index.server.ts',
  'src/lib/object-index/search.server.ts',
  'src/lib/search/coverage-selector.ts',
  'src/lib/search/source-plan.ts',
  'src/lib/search/source-capabilities.ts',
  'src/lib/search/live-gapfill.ts',
  'src/lib/search/source-pipeline.ts',
  'src/lib/search/provider-ladder.ts',
  'src/lib/search/searxng.server.ts',
  'src/lib/search/serp-providers.server.ts',
  'src/lib/search/osm-local-businesses.server.ts',
  'src/lib/search/jobs-provider.ts',
  'src/lib/search/browser-live.server.ts',
  'src/lib/research-agent/browser.ts',
  'src/lib/research-agent/agent-browser-cli.server.ts',
  'src/lib/search/page-classify.ts',
  'src/lib/search/entity-resolve.ts',
  'src/lib/search/canonical-contract.ts',
  'src/lib/search/qualify.ts',
  'src/lib/search/person-qualify.ts',
  'src/lib/search/job-qualify.ts',
  'src/lib/search/social-qualify.ts',
  'src/lib/search/verification.ts',
  'src/lib/search/completeness.ts',
  'src/lib/search/enrichment-plan.ts',
  'src/lib/search/enrichment-run.ts',
  'src/lib/search/enrich-incomplete.ts',
  'src/lib/search/enrichment-merge.ts',
  'src/lib/contact/discover-contacts.server.ts',
  'src/lib/contact/contact-finder.server.ts',
  'src/lib/search/evidence.ts',
  'src/lib/search/candidate-merge.ts',
  'src/lib/search/format-place.ts',
  'src/lib/search/relevance.ts',
  'src/lib/search/outcome-ui.ts',
  'src/lib/search/qualified-lead-view.ts',
];
const tests = [
  'src/lib/search/browser-live.server.test.ts',
  'src/lib/search/__tests__/live-browser-integration.test.ts',
  'src/lib/search/__tests__/m9-verification.test.ts',
  'src/lib/search/__tests__/m8-enrichment.test.ts',
  'src/lib/search/__tests__/m12-people.test.ts',
  'src/lib/search/__tests__/m11-ui-run.test.ts',
  'src/lib/search/__tests__/phase1-acceptance.test.ts',
  'src/lib/search/__tests__/m1-m3-runtime.test.ts',
  'src/lib/understanding/understanding.test.ts',
  'src/lib/understanding/extract.server.test.ts',
  'src/lib/research-agent/research-agent.test.ts',
];
fs.mkdirSync(bundle, { recursive: true });
const expected = new Set([...source, ...tests].map((item) => item.replaceAll('\\', '/')));
const pruneStaleFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.resolve(directory, entry.name);
    if (!absolute.startsWith(path.resolve(bundle) + path.sep)) throw new Error(`Unsafe bundle path: ${absolute}`);
    if (entry.isDirectory()) pruneStaleFiles(absolute);
    else if (!expected.has(path.relative(bundle, absolute).replaceAll('\\', '/'))) fs.unlinkSync(absolute);
  }
};
pruneStaleFiles(bundle);
for (const relative of [...source, ...tests]) {
  const original = path.join(root, relative);
  if (!fs.existsSync(original)) throw new Error(`Missing curated file: ${relative}`);
  const target = path.join(bundle, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(original, target);
}
const names = new Set();
for (const relative of source) {
  const contents = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of contents.matchAll(/(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
}
fs.writeFileSync(path.join(out, 'env-names.txt'), '# Variable names referenced by bundled core source; values intentionally omitted.\n' + [...names].sort().join('\n') + '\n');
console.log(JSON.stringify({ sourceFiles: source.length, tests: tests.length, envNames: names.size, bundle }));
