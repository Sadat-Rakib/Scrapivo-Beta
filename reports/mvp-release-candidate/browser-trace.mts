/**
 * Browser lifecycle trace harness (Task 3). Local only; never persists.
 *
 *   npx tsx reports/mvp-release-candidate/browser-trace.mts <founders|businesses> <smoke|product>
 *
 * smoke   = parity with reports/mvp-implementation/browser-smoke.mts (no seeds,
 *           maxPages 4, maxCandidates 3, default isVerified).
 * product = the same server core Discover calls (runSpecSearchCore) with
 *           force=true (the "Search with defaults" path) and live discovery
 *           forced, so structured seeding, research budgets and the product
 *           isVerified all apply.
 */
import { loadEnvFile } from "node:process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

process.env.SCRAPIVO_LOCAL_NO_PERSIST = "true";
// Third arg "headed" matches the local product default (visible Chromium).
const HEADED = process.argv[4] === "headed";
process.env.RESEARCH_BROWSER_VISIBLE = HEADED ? "true" : "false";
loadEnvFile(".env");
process.env.SCRAPIVO_LOCAL_NO_PERSIST = "true";
process.env.FORCE_LIVE_DISCOVERY = "true";

const { localNoPersistActive, drainSkippedPersistence } = await import("../../src/lib/persistence-policy.server");
if (!localNoPersistActive()) throw new Error("ABORT: local no-persist guard is not active");

const [which = "businesses", mode = "product"] = process.argv.slice(2);
const QUERIES = {
  founders: "SaaS founders with recent hiring evidence and public contact details",
  businesses: "Restaurants in Calgary, Alberta with official websites",
} as const;
// "custom" reads TRACE_QUERY (product mode only).
const query = which === "custom" ? process.env.TRACE_QUERY ?? "" : QUERIES[which as keyof typeof QUERIES];
if (!query) throw new Error(`unknown query set ${which}`);
if (which === "custom" && mode !== "product") throw new Error("custom queries run in product mode");

const { discoverWithBrowser, extractEntities } = await import("../../src/lib/search/browser-live.server");
type TraceEvent = import("../../src/lib/search/browser-live.server").BrowserTraceEvent;
type ObservedPage = import("../../src/lib/search/browser-live.server").BrowserObservedPage;
const progressStore = await import("../../src/lib/search/search-browser-progress.server");
const { readScrapyBrowserState } = await import("../../src/lib/search/scrapy-browser.server");

const runId = `trace-${which}-${mode}-${Date.now()}`;
const ownerId = "local-mvp-trace";
const events: TraceEvent[] = [];
const onTrace = (event: TraceEvent) => { events.push(event); };
const captureDir = "reports/mvp-release-candidate/captures";
mkdirSync(captureDir, { recursive: true });
const captured = new Map<string, string>();
const capture = (pages: ObservedPage[]) => {
  for (const page of pages) {
    const id = createHash("sha256").update(page.url).digest("hex").slice(0, 12);
    if (captured.has(page.url)) continue;
    captured.set(page.url, `${id}.json`);
    writeFileSync(`${captureDir}/${id}.json`, JSON.stringify({ url: page.url, title: page.title, text: page.text.slice(0, 18_000), structured: page.structured ?? null, captured_at: new Date().toISOString() }, null, 2));
  }
};
const wrappedExtract: typeof extractEntities = async (pages, spec, trace) => { capture(pages); return extractEntities(pages, spec, trace); };

progressStore.beginSearchBrowserProgress(runId, ownerId);
const startedAt = Date.now();
let error: string | null = null;
let result: Record<string, unknown> = {};
try {
  if (mode === "smoke") {
    const { buildSpec, stated } = await import("../../src/lib/search/search-spec");
    const spec = which === "founders"
      ? buildSpec({ entity: "person", raw_query: query, criteria: [stated("role", "founder"), stated("industry", "SaaS")] })
      : buildSpec({ entity: "business", raw_query: query, criteria: [stated("category", "restaurant"), stated("location", "Calgary"), stated("website", "true")] });
    const rows = await discoverWithBrowser(spec, {
      searchRunId: runId, ownerId, visible: HEADED, maxPages: 4, maxCandidates: 3, timeoutMs: 75_000,
      onProgress: (event) => progressStore.publishSearchBrowserProgress(runId, ownerId, event),
      onTrace, extractEntities: wrappedExtract,
    });
    result = { mode, rowsReturned: rows.length, rows: rows.map((row) => ({ title: row.title, kind: row.kind, role: row.role, company: row.company, location: row.location, website_url: row.website_url, source_url: row.source_url, verification_status: row.verification_status })) };
  } else {
    const { runSpecSearchCore } = await import("../../src/lib/spec-search.functions");
    const { beginRegisteredSearchRun } = await import("../../src/lib/search/search-run.server");
    const registered = beginRegisteredSearchRun({ ownerId, runId, maxRunMs: 120_000 + 10 * 20_000 });
    // TRACE_CANCEL_MS: cancel through the product's own cancel path (Stop search).
    const cancelMs = Number(process.env.TRACE_CANCEL_MS ?? 0);
    const { cancelRegisteredSearchRun } = await import("../../src/lib/search/search-run.server");
    const cancelTimer = cancelMs > 0 ? setTimeout(() => { (result as Record<string, unknown>).cancelledAtMs = Date.now() - startedAt; cancelRegisteredSearchRun(ownerId, runId); }, cancelMs) : null;
    try {
      const out = await runSpecSearchCore(query, {
        signal: registered.signal,
        ownerId,
        browserProgress: (event) => progressStore.publishSearchBrowserProgress(runId, ownerId, event),
        liveGapfill: {
          onBrowserTrace: onTrace,
          browser: (spec, options) => discoverWithBrowser(spec, { ...options, ownerId, extractEntities: wrappedExtract }),
        },
      }, 10, {}, { force: true, search_run_id: runId });
      const o = out as unknown as Record<string, any>;
      result = {
        mode, outcome: o.outcome, status: o.spec?.status, entity: o.spec?.entity,
        criteria: (o.spec?.criteria ?? []).map((c: { field: string; value: string }) => `${c.field}=${c.value}`),
        clarify: (o.clarify ?? []).map((q: { id: string }) => q.id),
        liveDiscovery: o.liveDiscovery, retrievalTrace: o.retrievalTrace, rowsReturned: (o.rows ?? []).length,
        rows: (o.rows ?? []).slice(0, 12).map((row: Record<string, any>) => ({ title: row.title, kind: row.kind, role: row.role, company: row.company, location: row.location, website_url: row.website_url, source_url: row.source_url, disposition: row.disposition, why: row.why_match,
          email: row.email ?? null, phone: row.phone ?? null, contact_page_url: row.contact_page_url ?? null, profile_url: row.profile_url ?? null,
          evidence: (row.evidence ?? []).map((item: Record<string, any>) => ({ type: item.evidence_type, method: item.extraction_method, url: item.source_url, excerpt: String(item.excerpt ?? "").slice(0, 160),
            id: item.id ?? null, acquisition: item.provenance?.acquisition ?? null, requested: item.provenance?.requested_url ?? null, session: item.provenance?.browser_session_id ?? null })),
          provenance: Object.fromEntries(Object.entries(row.field_provenance ?? {}).map(([key, value]: [string, any]) => [key, `${value?.source}@${value?.source_url}`])) })),
        diagnostics: o.routeDiagnostics ?? o.diagnostics ?? null,
        cancelledAtMs: (result as Record<string, unknown>).cancelledAtMs ?? null,
        returnedAtMs: Date.now() - startedAt,
        candidateLedger: o.candidateLedger ?? null,
      };
    } finally { if (cancelTimer) clearTimeout(cancelTimer); registered.finish(); }
  }
} catch (caught) {
  error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
} finally {
  progressStore.finishSearchBrowserProgress(runId, ownerId);
}
const progress = progressStore.readSearchBrowserProgress(runId, ownerId, 0);
const state = readScrapyBrowserState(runId, ownerId);

// Per-page summary: URL, page type, target entity, observed data, candidate produced, why not.
const pageRows = events.filter((event): event is Extract<TraceEvent, { kind: "page" }> => event.kind === "page");
const entityEvents = events.filter((event): event is Extract<TraceEvent, { kind: "entity" }> => event.kind === "entity");
const extractEvents = events.filter((event): event is Extract<TraceEvent, { kind: "extract" }> => event.kind === "extract");
const summary = pageRows.map((page) => {
  const url = page.finalUrl ?? page.requestedUrl;
  const entityHere = entityEvents.filter((event) => event.pageUrl === url || event.pageUrl === page.requestedUrl);
  const extractHere = extractEvents.filter((event) => event.pages.includes(url) || event.pages.includes(page.requestedUrl));
  const produced = entityHere.filter((event) => event.outcome === "row").map((event) => event.name);
  const why = page.outcome !== "read" && page.outcome !== "http_read" ? `${page.outcome}${page.reason ? `: ${page.reason}` : ""}`
    : !extractHere.length ? "not sent to extractor"
    : produced.length ? ""
    : extractHere.every((event) => event.entities === 0) ? `extractor empty (${extractHere.map((event) => `${event.extractor}/${event.llm}${event.detail ? ` ${event.detail}` : ""}`).join("; ")})`
    : `entities rejected: ${[...new Set(entityHere.filter((event) => event.outcome === "rejected").map((event) => `${event.reason}/${event.detail}`))].join(", ")}`;
  return { origin: page.origin, url, pageType: page.pageType ?? null, title: page.title ?? null, outcome: page.outcome, textChars: page.textChars ?? 0,
    structured: page.structured ?? null, candidateProduced: produced.length ? "YES" : "NO", produced, why, capture: captured.get(url) ?? captured.get(page.requestedUrl) ?? null };
});
// Evidence audit: every excerpt of every final row must re-validate against
// the text captured from its source page (segments split on card/line breaks).
const { readFileSync, existsSync } = await import("node:fs");
const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const capturedText = (url: string) => {
  const file = captured.get(url);
  if (!file || !existsSync(`${captureDir}/${file}`)) return null;
  const page = JSON.parse(readFileSync(`${captureDir}/${file}`, "utf8"));
  return `${page.title}\n${page.text}\n${JSON.stringify(page.structured ?? {})}`;
};
const audit = ((result.rows as Array<Record<string, any>> | undefined) ?? []).map((row) => {
  const checks = (row.evidence ?? []).map((item: Record<string, any>) => {
    const text = capturedText(item.url);
    if (!text) return { method: item.method, url: item.url, status: "no_capture" };
    const segments = String(item.excerpt ?? "").split(/\n|: | — /).map((part: string) => part.trim()).filter((part: string) => part.length >= 3 && !/structured listing|lists /i.test(part));
    const missing = segments.filter((part: string) => !norm(text).includes(norm(part.replace(/\(structured listing\)$/, ""))));
    return { method: item.method, url: item.url, status: missing.length ? "MISMATCH" : "ok", missing };
  });
  const contactPage = row.contact_page_url ? (capturedText(row.contact_page_url) ? "captured" : "not_captured") : null;
  return { title: row.title, checks, contactPage, email: row.email, phone: row.phone };
});
const out = {
  runId, query, which, mode, durationMs: Date.now() - startedAt, error, audit,
  browser: state && { adapter: state.adapter, status: state.status, pagesVisited: state.pagesVisited, currentUrl: state.currentUrl, retained: state.retained, controller: state.controller, sessionId: state.sessionId, frame: !!state.lastScreenshotData },
  runtime: events.filter((event) => event.kind === "runtime"),
  progressEvents: progress.events.length,
  streamedRows: progress.events.filter((event) => event.row).map((event) => event.row?.title),
  streamedAfterCancel: typeof (result as Record<string, unknown>).cancelledAtMs === "number"
    ? progress.events.filter((event) => event.row && Date.parse(event.at) > startedAt + Number((result as Record<string, unknown>).cancelledAtMs)).map((event) => event.row?.title)
    : null,
  eventsAfterCancel: typeof (result as Record<string, unknown>).cancelledAtMs === "number"
    ? progress.events.filter((event) => Date.parse(event.at) > startedAt + Number((result as Record<string, unknown>).cancelledAtMs) + 1_000).map((event) => event.action)
    : null,
  searches: events.filter((event) => event.kind === "search"),
  pages: summary,
  extracts: extractEvents,
  entityOutcomes: entityEvents.map((event) => ({ page: event.pageUrl, name: event.name, kind: event.entityKind, outcome: event.outcome, reason: event.reason ?? null, detail: event.detail ?? null, dropped: event.droppedFields ?? [] })),
  remember: events.filter((event) => event.kind === "remember"),
  candidates: events.filter((event) => event.kind === "candidate"),
  done: events.filter((event) => event.kind === "done"),
  persistenceSkipped: drainSkippedPersistence(),
  result,
};
const tag = process.env.TRACE_TAG ? `_${process.env.TRACE_TAG.replace(/[^A-Za-z0-9_-]/g, "")}` : "";
const file = `reports/mvp-release-candidate/BROWSER_TRACE_${which.toUpperCase()}_${mode.toUpperCase()}${HEADED ? "_HEADED" : ""}${tag}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ file, durationMs: out.durationMs, error, pages: summary.length, pagesRead: summary.filter((row) => /read/.test(row.outcome)).length,
  produced: summary.filter((row) => row.candidateProduced === "YES").length, remembered: out.remember.filter((event) => event.outcome === "accepted").length,
  candidates: out.candidates.length, streamed: out.streamedRows.length, rowsReturned: result.rowsReturned ?? null, outcome: result.outcome ?? null }));
process.exit(0);
