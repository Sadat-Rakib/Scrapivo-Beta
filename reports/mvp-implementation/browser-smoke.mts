import { loadEnvFile } from "node:process";
import { writeFile } from "node:fs/promises";

loadEnvFile(".env");
const { buildSpec, stated } = await import("../../src/lib/search/search-spec");
const { discoverWithBrowser } = await import("../../src/lib/search/browser-live.server");
const { beginSearchBrowserProgress, publishSearchBrowserProgress, readSearchBrowserProgress, finishSearchBrowserProgress } =
  await import("../../src/lib/search/search-browser-progress.server");
const { readScrapyBrowserState } = await import("../../src/lib/search/scrapy-browser.server");

const runId = `mvp-local-browser-${Date.now()}`;
const ownerId = "local-mvp-smoke";
const spec = buildSpec({
  entity: "business",
  raw_query: "Restaurants in Calgary, Alberta with official websites",
  criteria: [stated("category", "restaurant"), stated("location", "Calgary"), stated("website", "true")],
});
beginSearchBrowserProgress(runId, ownerId);
const startedAt = Date.now();
let error: string | null = null;
let rows: Awaited<ReturnType<typeof discoverWithBrowser>> = [];
try {
  rows = await discoverWithBrowser(spec, {
    searchRunId: runId,
    ownerId,
    visible: false,
    maxPages: 4,
    maxCandidates: 3,
    timeoutMs: 75_000,
    onProgress: (event) => publishSearchBrowserProgress(runId, ownerId, event),
  });
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  finishSearchBrowserProgress(runId, ownerId);
}
const state = readScrapyBrowserState(runId, ownerId);
const progress = readSearchBrowserProgress(runId, ownerId, 0);
const result = {
  runId,
  query: spec.raw_query,
  durationMs: Date.now() - startedAt,
  error,
  browser: state && {
    adapter: state.adapter,
    status: state.status,
    pagesVisited: state.pagesVisited,
    currentUrl: state.currentUrl,
    screenshotPath: state.lastScreenshotPath,
  },
  progressEvents: progress.events.length,
  streamedRows: progress.events.filter((event) => event.row).length,
  candidateRowsReturned: rows.length,
  verifiedRows: progress.events.filter((event) => event.action === "Candidate verified" && event.row).length,
};
await writeFile("reports/mvp-implementation/BROWSER_SMOKE_BUSINESSES.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (error || !state || state.pagesVisited === 0) process.exitCode = 1;
