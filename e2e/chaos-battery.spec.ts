import { expect, test, type Page, type Request, type Response } from "@playwright/test";
import { fromCrossJSON, fromJSON } from "seroval";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpecRow } from "../src/lib/spec-search.functions";
import { fixMojibake } from "../src/lib/encoding";
import { enrichZeroNarrative, zeroResultsNarrative } from "../src/lib/search/outcome-ui";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";

const QUERIES: Array<{ id: string; q: string }> = JSON.parse(readFileSync("e2e/fixtures/chaos-queries.json", "utf8"));
const SELECTED = process.env.CHAOS_IDS ? QUERIES.filter(item => process.env.CHAOS_IDS!.split(",").includes(item.id)) : QUERIES;
const ARTIFACT_DIR = process.env.CHAOS_REPORT_DIR ?? join(tmpdir(), "scrapivo-chaos", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(ARTIFACT_DIR, { recursive: true });
const runIds = new Set<string>();

async function login(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("scrapivo:onboarding-skipped", "1");
      localStorage.setItem("scrapivo:guided-tour-seen", "1");
    } catch { /* ignore */ }
  });
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/discover|home|\/$/, { timeout: 30_000 });
  await page.goto("/discover");
  const skip = page.locator("text=Skip for now").first();
  if (await skip.isVisible({ timeout: 10_000 }).catch(() => false)) await skip.click();
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
}

async function submitQuery(page: Page, q: string) {
  await page.getByRole("textbox").first().fill(q);
  await page.getByRole("textbox").first().press("Enter");
}

type RunRequest = {
  query: string;
  force: boolean;
  search_run_id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
};
type BackendResult = Omit<RunRequest, "query" | "force"> & {
  [key: string]: unknown;
  outcome?: string;
  stage?: string;
  spec: { status?: string };
  clarify: unknown[];
  rows: SpecRow[];
  qualified_count: number;
  candidateLedger?: {
    accounting?: { ok: boolean; retrieved: number; fated: number; unaccounted: number };
    counts?: Record<string, number>;
    rejectReasons?: Record<string, number>;
    incompleteReasons?: Record<string, number>;
    streamedNotReturned?: Array<{ fate: string; reason?: string | null }>;
  };
  retrievalTrace?: {
    reason: string;
    returned: number;
    rawCandidates?: number;
    postSpecFilter?: number;
    complete?: number;
    pendingEnrichment?: number;
    qualificationRejected?: number;
    sourceHealth?: { summary?: string | null };
    widening?: { outcome: string };
    providers?: ProviderEvidence[];
    [key: string]: unknown;
  };
  diagnostics?: unknown[];
  providerAttempts?: ProviderEvidence[];
  widening?: { outcome: string };
};
type ProviderEvidence = {
  attempted: boolean;
  succeeded: boolean;
  queries?: number;
  queryFunnel?: Array<{ stage: string; serpEmpty: number; serpBlocked: number; serpErrors: number; linksObserved: number }>;
};

function searchRequest(request: Request, q: string, forced: boolean): RunRequest | undefined {
  if (request.method() !== "POST") return;
  const body = request.postData() ?? "";
  if (!body.includes("search_run_id") || !body.includes("query")) return;
  // Ignore malformed unrelated POSTs. Only this query's spec-shaped payload
  // may fail decoding and fail this acceptance attempt.
  if (!body.includes(JSON.stringify(q)) && !body.includes(q)) return;
  // Start POSTs use toJSONAsync; responses use the cross-reference graph.
  const payload = fromJSON(JSON.parse(body), { plugins: [] }) as { data?: RunRequest };
  const data = payload.data;
  if (data?.query !== q || data.force !== forced) return;
  if (![data.search_run_id, data.conversation_id, data.turn_id, data.request_id].every(id => typeof id === "string" && id.length > 0)) return;
  return data;
}

function deliveredRowIssues(row: SpecRow): string[] {
  const issues: string[] = [];
  if (!row.title.trim()) issues.push("missing entity name");
  if (row.entity_resolved !== true) issues.push("unresolved entity");
  if ((row.entity_id ?? row.key ?? "").startsWith("provisional:")) issues.push("provisional identity");
  if (["list", "directory", "aggregator", "job_board", "article", "institute"].includes(row.page_type ?? "")) issues.push("non-entity page");
  if (row.disposition !== "qualified") issues.push("unqualified disposition");
  if (row.verification_status === "rejected") issues.push("rejected verification");
  const sourceUrls = [row.source_url, ...Object.values(row.field_provenance ?? {}).map(field => field.source_url),
    ...(row.evidence ?? []).map(evidence => evidence.source_url)].filter((source): source is string => !!source);
  if (!sourceUrls.length) issues.push("missing observed provenance");
  for (const source of sourceUrls) {
    if (/^https?:\/\//.test(source)) continue;
    const authorityScheme = /^(?:db|osm|registry):\/\//.test(source) || /^overture:/.test(source);
    const boundAuthority = !!row.entity_id && (row.evidence ?? []).some(evidence =>
      ["db", "osm", "registry"].includes(evidence.source_type) && evidence.subject === row.entity_id &&
      evidence.source_url === source && evidence.evidence_type === "identity" && evidence.supports === "identity");
    if (!authorityScheme || !boundAuthority) issues.push(`unbound or invalid evidence URL: ${source}`);
  }
  return issues;
}

test("chaos provenance proof — authority rows survive without contacts; unbound and provisional rows fail", () => {
  for (const sourceType of ["db", "osm", "registry"] as const) {
    const source = `${sourceType}://entity/42`;
    const row: SpecRow = { kind: "business", title: "Observed business", detail: "Retrieved authority record",
      entity_id: source, entity_resolved: true, disposition: "qualified", page_type: "business",
      source_url: source, evidence: [{ source_type: sourceType, source_url: source, subject: source,
        evidence_type: "identity", supports: "identity", excerpt: "Observed business", observed_at: "2026-10-07T00:00:00Z", confidence: 1 }] };
    expect(deliveredRowIssues(row)).toEqual([]);
    expect(deliveredRowIssues({ ...row, evidence: row.evidence!.map(evidence => ({ ...evidence, subject: "other-entity" })) })).toContain(`unbound or invalid evidence URL: ${source}`);
    expect(deliveredRowIssues({ ...row, entity_id: "provisional:42" })).toContain("provisional identity");
    expect(deliveredRowIssues({ ...row, disposition: "potential_match" })).toContain("unqualified disposition");
    expect(deliveredRowIssues({ ...row, source_url: null, evidence: [], key: "random-key" })).toContain("missing observed provenance");
    expect(deliveredRowIssues({ ...row, evidence: row.evidence!.map(evidence => ({ ...evidence, source_type: "web" })) })).toContain(`unbound or invalid evidence URL: ${source}`);
  }
});

function assertBackend(result: BackendResult, request: RunRequest, allowCard: boolean, impossible = false) {
  for (const id of ["search_run_id", "conversation_id", "turn_id", "request_id"] as const) {
    expect(result[id], `Response ${id} must belong to this submission`).toBe(request[id]);
  }
  const accounting = result.candidateLedger?.accounting;
  expect(accounting, "Backend candidate accounting is required").toBeDefined();
  expect(accounting?.ok, "Backend candidate accounting must reconcile").toBe(true);
  expect(accounting?.unaccounted).toBe(0);
  expect(accounting?.retrieved).toBe(accounting?.fated);
  expect(["SOURCE_UNAVAILABLE", "TIMEOUT"]).not.toContain(result.retrievalTrace?.reason);
  expect(result.qualified_count).toBe(result.rows.length);
  expect(result.spec, "Response must preserve the parsed search specification").toBeDefined();
  if (result.outcome === undefined) {
    expect(allowCard, "Forced search must have a terminal backend outcome").toBe(true);
    expect(result.stage === "clarify" || result.stage === "confirm" || result.spec.status === "needs_clarification").toBe(true);
    expect(result.rows).toHaveLength(0);
    return "card";
  }
  expect(["QUALIFIED_RESULTS", "NO_QUALIFIED_RESULTS"], "Backend failures/cancellation are not successful settlement").toContain(result.outcome);
  expect(result.retrievalTrace, "Completed search must include its retrieval trace").toBeDefined();
  expect(result.retrievalTrace?.returned).toBe(result.rows.length);
  if (result.outcome === "QUALIFIED_RESULTS") {
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(deliveredRowIssues(row), `Delivered entity/provenance contract: ${row.title}`).toEqual([]);
    }
    return "results";
  }
  expect(result.rows).toHaveLength(0);
  const providers = (result.providerAttempts ?? result.retrievalTrace?.providers ?? []).filter(provider => provider.attempted);
  expect(providers.length, "Zero requires attempted live sources, not just a DB miss").toBeGreaterThan(0);
  expect(providers.every(provider => provider.succeeded), "Unavailable or failed sources cannot certify an honest zero").toBe(true);
  expect(result.retrievalTrace?.sourceHealth?.summary, "Source-health warnings invalidate coverage exhaustion").toBeFalsy();
  expect(result.retrievalTrace?.pendingEnrichment ?? 0, "Unfinished enrichment cannot certify an honest zero").toBe(0);
  expect(result.candidateLedger?.counts?.unaccounted ?? 0).toBe(0);
  if ((accounting?.retrieved ?? 0) > 0) {
    const gates = { ...result.candidateLedger?.rejectReasons, ...result.candidateLedger?.incompleteReasons };
    expect(Object.keys(gates).length, "Discovered candidates vanished: zero must identify the rejection or required-field gate").toBeGreaterThan(0);
  } else {
    expect((result.widening ?? result.retrievalTrace?.widening)?.outcome,
      "Empty acquisition requires completed alternate-query coverage").toBe("COVERAGE_EXHAUSTED");
    expect(providers.every(provider => (provider.queryFunnel?.length ?? 0) > 0 &&
      provider.queries === provider.queryFunnel!.length && provider.queryFunnel!.every(funnel =>
        funnel.stage === "SEARCH_EMPTY" && funnel.serpEmpty > 0 && funnel.serpBlocked === 0 &&
        funnel.serpErrors === 0 && funnel.linksObserved === 0)),
      "No candidates is not an honest zero unless every attempted query genuinely searched and returned no links").toBe(true);
  }
  if (result.retrievalTrace?.reason === "NO_CATEGORY_MATCH" && !impossible) {
    const providers = (result.providerAttempts ?? result.retrievalTrace.providers ?? []).filter(provider => provider.attempted);
    // Empty extraction/parser output is acquisition failure, even when the
    // widening loop labels repeated empty passes COVERAGE_EXHAUSTED.
    const coverageProven = (result.widening ?? result.retrievalTrace.widening)?.outcome === "COVERAGE_EXHAUSTED" &&
      providers.length > 0 && providers.every(provider => provider.succeeded &&
        (provider.queryFunnel?.length ?? 0) > 0 && provider.queries === provider.queryFunnel!.length &&
        provider.queryFunnel!.every(funnel => funnel.stage === "SEARCH_EMPTY" && funnel.serpEmpty > 0 &&
          funnel.serpBlocked === 0 && funnel.serpErrors === 0 && funnel.linksObserved === 0));
    expect(coverageProven, "Normal-query NO_CATEGORY_MATCH is acquisition failure without complete, successful empty-search coverage proof").toBe(true);
  }
  if (allowCard && (result.clarify.length > 0 || result.stage === "confirm")) return "card";
  return "zero";
}

async function waitForSettlement(page: Page, id: string, q: string, action: () => Promise<unknown>, forced = false, impossible = false) {
  const phase = forced ? "forced" : "initial";
  let request: Request | undefined;
  let data: RunRequest | undefined;
  let response: Response | undefined;
  let result: BackendResult | undefined;
  let rawBody: string | undefined;
  let failure: string | undefined;
  let evidenceFailure: unknown;
  let settled: "card" | "zero" | "results" | undefined;
  const activity: Array<{ elapsedMs: number; text: string[] }> = [];
  const startedAt = Date.now();
  let sampling = false;
  const turn = page.locator("div.space-y-4").filter({ has: page.getByText(q, { exact: true }) });
  const rowTitles = turn.locator(".lead-card-hover > .font-medium, div.bg-card > button.text-left.w-full .font-medium, table tbody tr > td:first-child, button > span > span.block.font-medium");
  let resolveResponse!: () => void;
  let rejectResponse!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const onRequest = (candidate: Request) => {
    try {
      const candidateData = searchRequest(candidate, q, forced);
      if (!candidateData) return;
      if (request) { rejectResponse(new Error(`Duplicate search submission: ${q}`)); return; }
      request = candidate;
      data = candidateData;
      if (runIds.has(data.search_run_id)) { rejectResponse(new Error("Search reused a previous run ID")); return; }
      runIds.add(data.search_run_id);
      clearTimeout(requestTimer);
    } catch (error) { rejectResponse(error as Error); }
  };
  const onResponse = (candidate: Response) => {
    if (candidate.request() !== request) return;
    response = candidate;
    // Headers alone are not completion. Wait for the entire response body.
    void candidate.finished().then(error => {
      if (error) rejectResponse(error); else resolveResponse();
    }, rejectResponse);
  };
  const onFailed = (candidate: Request) => {
    if (candidate === request) rejectResponse(new Error(`Search request failed: ${candidate.failure()?.errorText}`));
  };
  const timer = setTimeout(() => rejectResponse(new Error(`Backend response timeout: ${q}`)), 660_000);
  const requestTimer = setTimeout(() => rejectResponse(new Error(`No runSpecSearch POST observed for query: ${q}`)), 30_000);
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  const activityTimer = setInterval(() => {
    if (sampling) return;
    sampling = true;
    void page.locator('[aria-live="polite"]').evaluateAll(nodes => nodes
      .filter(node => node.getClientRects().length > 0)
      .map(node => node.textContent ?? "")).then(text => {
      const visible = text.map(line => line.trim()).filter(Boolean);
      if (visible.length && JSON.stringify(activity.at(-1)?.text) !== JSON.stringify(visible)) {
        activity.push({ elapsedMs: Date.now() - startedAt, text: visible });
      }
    }).catch(() => undefined).finally(() => { sampling = false; });
  }, 1_000);
  try {
    await Promise.all([completed, action()]);
    expect(request, "This query must submit an actual runSpecSearch POST").toBeDefined();
    rawBody = await response!.text();
    expect(response?.ok(), "Search HTTP response must succeed").toBe(true);
    const wire = JSON.parse(rawBody);
    const envelope = (typeof wire.t === "number" ? fromCrossJSON(wire, { plugins: [] }) : wire) as { result?: BackendResult; error?: unknown };
    expect(envelope.error, "Server function returned an error").toBeUndefined();
    expect(envelope.result).toBeDefined();
    result = envelope.result!;
    settled = assertBackend(result, data!, !forced, impossible);
    if (settled !== "card" && Date.now() - startedAt > 5_000) {
      expect(activity.length, "A running search must show progress activity before settlement").toBeGreaterThan(0);
    }
    await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden({ timeout: 30_000 });
    await expect(turn, "UI must render this query's own turn").toHaveCount(1);
    if (settled === "card") {
      await expect(page.getByText(/Narrow this down|Here is what I understood/).first()).toBeVisible({ timeout: 30_000 });
      await expect(rowTitles).toHaveCount(0);
    } else {
      await expect(page.getByText(/Narrow this down|Here is what I understood/).first()).toBeHidden();
      await expect(rowTitles).toHaveCount(result.rows.length, { timeout: 30_000 });
      expect((await rowTitles.allTextContents()).map(title => title.trim()).sort()).toEqual(result.rows.map(row => fixMojibake(row.title.trim())).sort());
      if (settled === "zero") {
        const narrative = enrichZeroNarrative(zeroResultsNarrative(result.retrievalTrace), result.candidateLedger);
        // Exact product-owned copy, after backend zero/accounting validation.
        if (narrative) await expect(turn.getByText(narrative, { exact: true })).toBeVisible();
        else await expect(turn.getByText(/No verified matches/).first()).toBeVisible();
      }
      else await expect(turn.getByRole("button", { name: new RegExp(`^Fold \\(${result.rows.length} results?\\)$`) })).toBeVisible();
    }
    console.log("CHAOS:", JSON.stringify({ id, phase, settled, run: data!.search_run_id, rows: result.rows.length, accounting: result.candidateLedger?.accounting }));
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(requestTimer);
    clearInterval(activityTimer);
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
    const label = `CHAOS-${id}-${phase}`;
    try {
      const artifact = { id, q, phase, request: data, result, rawBody, activity, status: response?.status(), failure,
        uiText: await turn.allTextContents().catch(() => []),
        uiRowTitles: await rowTitles.allTextContents().catch(() => []),
        uiLinks: await turn.locator("a[href]").evaluateAll(links => links.map(link => ({ text: link.textContent, href: link.getAttribute("href") }))).catch(() => []) };
      writeFileSync(join(ARTIFACT_DIR, `${id}-${phase}.json`), JSON.stringify(artifact, null, 2));
      await test.info().attach(`${label}-backend-ui`, {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({
          id, q, phase, request: data, rawBody, result, status: response?.status(), failure,
          outcome: result?.outcome, stage: result?.stage, qualified_count: result?.qualified_count,
          rows: result?.rows,
          diagnostics: result?.diagnostics, retrievalTrace: result?.retrievalTrace, candidateLedger: result?.candidateLedger,
          uiRowTitles: await rowTitles.allTextContents().catch(() => []),
          uiLinks: await turn.locator("a[href]").evaluateAll(links => links.map(link => ({ text: link.textContent, href: link.getAttribute("href") }))).catch(() => []),
          uiText: await turn.allTextContents().catch(() => []),
          ...(result ? {} : { rawBody }),
        })),
      });
      await test.info().attach(`${label}-screenshot`, { body: await page.screenshot(), contentType: "image/png" });
    } catch (error) {
      // A closed page must not replace the backend failure that caused it.
      evidenceFailure = error;
      console.warn("CHAOS-EVIDENCE:", JSON.stringify({ id, phase, error: String(error) }));
    }
  }
  if (evidenceFailure) throw evidenceFailure;
  return settled!;
}

test("chaos cancellation — Stop aborts and a new conversation can search", async ({ page }) => {
  test.setTimeout(1_000_000);
  await login(page);
  const q = "find 25 marketing agencies in London with email addresses";
  const finished = new Set<Request>();
  const record = (request: Request) => { finished.add(request); };
  page.on("requestfinished", record);
  page.on("requestfailed", record);
  let data: RunRequest | undefined;
  try {
    const started = page.waitForRequest(request => !!searchRequest(request, q, false), { timeout: 30_000 });
    const [request] = await Promise.all([started, (async () => {
      await page.getByRole("textbox").first().fill(q);
      await page.getByRole("textbox").first().press("Enter");
    })()]);
    data = searchRequest(request, q, false)!;
    const stop = page.getByRole("button", { name: "Stop search", exact: true });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    expect(finished.has(request), "Stop must be exercised on a live request").toBe(false);
    const aborted = page.waitForEvent("requestfailed", { predicate: failed => failed === request, timeout: 30_000 });
    await Promise.all([aborted, stop.click()]);
    expect(request.failure()?.errorText).toMatch(/abort|cancel/i);
    await expect(stop).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    writeFileSync(join(ARTIFACT_DIR, "cancellation.json"), JSON.stringify({ request: data, aborted: request.failure(), uiText: await page.locator("body").innerText() }, null, 2));
    const newChat = page.getByRole("button", { name: "New chat" }).first();
    await expect(newChat).toBeVisible();
    await newChat.click();
    const next = "find plumbers in Austin";
    const settled = await waitForSettlement(page, "post-cancel", next, async () => {
      await page.getByRole("textbox").first().fill(next);
      await page.getByRole("textbox").first().press("Enter");
    });
    if (settled === "card") expect(await forceIfAvailable(page, "post-cancel", next)).toBeTruthy();
    const nextArtifact = JSON.parse(readFileSync(join(ARTIFACT_DIR, "post-cancel-initial.json"), "utf8"));
    expect(nextArtifact.request.search_run_id).not.toBe(data.search_run_id);
    expect(nextArtifact.request.conversation_id).not.toBe(data.conversation_id);
  } finally {
    page.off("requestfinished", record);
    page.off("requestfailed", record);
  }
});

async function forceIfAvailable(page: Page, id: string, q: string, impossible = false) {
  const force = page.getByRole("button", { name: /Search with defaults|Confirm & search/ }).first();
  // Multi-question cards expose defaults only after their Skip steps.
  const skip = page.getByRole("button", { name: "Skip", exact: true }).first();
  const deadline = Date.now() + 30_000;
  while (!await force.isVisible() && await skip.isVisible()) {
    expect(Date.now(), `Clarification steps did not advance: ${q}`).toBeLessThan(deadline);
    await skip.click();
  }
  if (!await force.isVisible()) return false;
  await expect(force).toBeEnabled();
  // Observe the forced POST before clicking; never resubmit the textbox.
  return await waitForSettlement(page, id, q, () => force.click(), true, impossible);
}

test("chaos selection is valid", () => {
  expect(SELECTED.length).toBeGreaterThan(0);
  if (process.env.CHAOS_IDS) expect(SELECTED.map(item => item.id).sort()).toEqual(process.env.CHAOS_IDS.split(",").sort());
});

for (const { id, q } of SELECTED) {
  test(`chaos ${id} — ${q}`, async ({ page }) => {
    test.setTimeout(1_400_000);
    await login(page);
    await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden();
    const newChat = page.getByRole("button", { name: "New chat" }).first();
    if (await newChat.isVisible()) await newChat.click();
    const settled = await waitForSettlement(page, id, q, async () => {
      await page.getByRole("textbox").first().fill(q);
      await page.getByRole("textbox").first().press("Enter");
    });
    if (settled === "card") {
      expect(await forceIfAvailable(page, id, q), "Each chaos prompt must reach a real search, beyond clarification").toBeTruthy();
    }
  });
}
