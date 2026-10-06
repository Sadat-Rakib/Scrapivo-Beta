/**
 * STAGE 2 REAL-UI ACCEPTANCE — the 10 mandated queries + cancellation +
 * impossible-search coverage exhaustion. Every run's funnel lands in the
 * server log as [stage2-funnel]. UI assertions: a run either delivers
 * candidate/results, reaches an honest zero AFTER a real run, or asks a
 * Stage-1 card — never hangs, never fabricates.
 */
import { expect, test, type Page, type Request, type Response } from "@playwright/test";
import { fromCrossJSON, fromJSON } from "seroval";
import { fixMojibake } from "../src/lib/encoding";
import { enrichZeroNarrative, zeroResultsNarrative } from "../src/lib/search/outcome-ui";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";

const QUERIES = process.env.S2_QUERIES
  ? process.env.S2_QUERIES.split("|")
  : [
      "find plumbers in Austin",
      "yo need like 7 hvac guys gta sites + nums",
      "solar installers in Windhoek",
      "wedding photographers in Cebu",
      "freight forwarders in Tbilisi",
      "construction companies in Banja Luka",
      "find SaaS founders globally",
      "find copywriters in Toronto",
      "React developer jobs in Calgary",
      "seed investors for AI startups in Canada",
    ];

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
  outcome?: string;
  stage?: string;
  spec: { status?: string };
  clarify: unknown[];
  rows: Array<{ title: string; [key: string]: unknown }>;
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
    return "results";
  }
  expect(result.rows).toHaveLength(0);
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

async function waitForSettlement(page: Page, q: string, action: () => Promise<unknown>, forced = false, impossible = false) {
  const phase = forced ? "forced" : "initial";
  let request: Request | undefined;
  let data: RunRequest | undefined;
  let response: Response | undefined;
  let result: BackendResult | undefined;
  let rawBody: string | undefined;
  let failure: string | undefined;
  let evidenceFailure: unknown;
  let settled: "card" | "zero" | "results" | undefined;
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
    console.log("S2-UI:", JSON.stringify({ q, phase, settled, run: data!.search_run_id, rows: result.rows.length, accounting: result.candidateLedger?.accounting }));
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(requestTimer);
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
    const label = `S2-${q.replace(/[^a-z0-9]+/gi, "-").slice(0, 65)}-${phase}`;
    try {
      await test.info().attach(`${label}-backend-ui`, {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({
          q, phase, request: data, status: response?.status(), failure,
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
      console.warn("S2-EVIDENCE:", JSON.stringify({ q, phase, error: String(error) }));
    }
  }
  if (evidenceFailure) throw evidenceFailure;
  return settled!;
}

async function forceIfAvailable(page: Page, q: string, impossible = false) {
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
  return await waitForSettlement(page, q, () => force.click(), true, impossible);
}

for (const q of QUERIES) {
test(`stage2 acceptance query — ${q}`, async ({ page }) => {
  test.setTimeout(1_400_000);
  await login(page);
  // Rotating the conversation aborts in-flight runs — only rotate when the
  // previous run has settled (or after Stop), never mid-run.
  await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden();
  const newChat = page.getByRole("button", { name: "New chat" }).first();
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
    await page.waitForTimeout(2000);
  }
  const settled = await waitForSettlement(page, q, () => submitQuery(page, q));
  if (settled === "card") {
    await forceIfAvailable(page, q);
  }
});
}

test("stage2 acceptance — selected queries attempted", async () => {
  expect(QUERIES.length).toBeGreaterThan(0);
});

test("stage2 acceptance — cancellation stops the run", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const q = "find 25 marketing agencies in London with email addresses";
  const completed = new Set<Request>();
  const recordCompletion = (request: Request) => { completed.add(request); };
  page.on("requestfinished", recordCompletion);
  page.on("requestfailed", recordCompletion);
  try {
    const started = page.waitForRequest(request =>
      request.method() === "POST" &&
      (request.postData() ?? "").includes(q) &&
      (request.postData() ?? "").includes("search_run_id"),
      { timeout: 30_000 },
    );
    const [request] = await Promise.all([started, submitQuery(page, q)]);
    const stop = page.getByRole("button", { name: "Stop search", exact: true });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    expect(completed.has(request), "Search request must still be in flight before Stop").toBe(false);
    const aborted = page.waitForEvent("requestfailed", {
      predicate: failed => failed === request,
      timeout: 30_000,
    });
    await Promise.all([aborted, stop.click()]);
    expect(request.failure()?.errorText).toMatch(/abort|cancel/i);
    await expect(stop).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    console.log("S2-CANCEL:", JSON.stringify({ started: true, aborted: true, settled: true }));
  } finally {
    page.off("requestfinished", recordCompletion);
    page.off("requestfailed", recordCompletion);
  }
});

test("stage2 acceptance — impossible search exhausts honestly", async ({ page }) => {
  test.setTimeout(1_400_000);
  await login(page);
  const q = "find unicorn ranchers in Atlantis";
  const settled = await waitForSettlement(page, q, () => submitQuery(page, q), false, true);
  const forced = settled === "card" && await forceIfAvailable(page, q, true);
  if (settled === "card" && !forced) {
    await expect(page.getByText(/Narrow this down|Here is what I understood/).first()).toBeVisible();
    console.log("S2-IMPOSSIBLE:", JSON.stringify({ settled: "card", forced: false }));
  } else {
    expect(forced || settled).toBe("zero");
    console.log("S2-IMPOSSIBLE:", JSON.stringify({ settled: "zero", forced }));
  }
  await expect(page.getByText(/\([1-9]\d* results?\)/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden();
});
