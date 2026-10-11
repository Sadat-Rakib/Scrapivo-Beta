import { expect, test, type Page, type Request, type Response } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fromCrossJSON, fromJSON } from "seroval";
import type { SpecRow } from "../src/lib/spec-search.functions";
import { fixMojibake } from "../src/lib/encoding";
import { enrichZeroNarrative, zeroResultsNarrative } from "../src/lib/search/outcome-ui";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";
const REPORT_DIR = process.env.S2_REPORT_DIR ?? join(tmpdir(), "scrapivo-stage2", "acceptance");
const SERVER_LOG = process.env.S2_SERVER_LOG ?? "";
mkdirSync(REPORT_DIR, { recursive: true });

type QueryCase = {
  id: string;
  query: string;
  kind: SpecRow["kind"][];
  category?: string[];
  roles?: string[];
  locations?: string[];
  fields?: string[];
  requireResults: boolean;
};

type RunRequest = {
  query: string;
  force: boolean;
  search_run_id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
};

type ProviderEvidence = {
  provider?: string;
  attempted: boolean;
  succeeded: boolean;
  queries?: number;
  queryFunnel?: Array<{
    query?: string;
    stage: string;
    serpEmpty: number;
    serpBlocked: number;
    serpErrors: number;
    linksObserved: number;
  }>;
};

type BackendResult = Omit<RunRequest, "query" | "force"> & {
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
    streamedNotReturned?: Array<{ title?: string; fate: string; reason?: string | null }>;
  };
  retrievalTrace?: {
    reason: string;
    returned: number;
    rawCandidates?: number;
    postSpecFilter?: number;
    complete?: number;
    pendingEnrichment?: number;
    qualificationRejected?: number;
    qualified?: number;
    sourceHealth?: { summary?: string | null };
    widening?: { outcome: string };
    providers?: ProviderEvidence[];
    timings?: unknown;
  };
  diagnostics?: unknown[];
  providerAttempts?: ProviderEvidence[];
  widening?: { outcome: string };
};

type PhaseReport = {
  id: string;
  query: string;
  round: number;
  phase: "initial" | "forced" | "cancel";
  status: "PASS" | "FAIL" | "BLOCKED";
  durationMs: number;
  request?: RunRequest;
  failure?: string;
  settled?: "results" | "zero" | "card";
  outcome?: string;
  providers?: ProviderEvidence[];
  funnel?: BackendResult["retrievalTrace"];
  accounting?: NonNullable<BackendResult["candidateLedger"]>["accounting"];
  rejects?: Record<string, number>;
  incomplete?: Record<string, number>;
  contacts?: Array<{ title: string; present: string[]; verified: string[]; missing: string[] }>;
  evidence?: Array<{ title: string; urls: string[] }>;
  rowIssues?: Array<{ title: string; issues: string[] }>;
  uiRows?: string[];
};

const CASES = JSON.parse(
  readFileSync("e2e/fixtures/stage2-acceptance-queries.json", "utf8"),
) as QueryCase[];
const IMPOSSIBLE: QueryCase = {
  id: "Q00",
  query: "Unicorn ranchers in Atlantis",
  kind: ["business"],
  category: ["unicorn", "rancher"],
  locations: ["Atlantis"],
  requireResults: false,
};

async function login(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("scrapivo:onboarding-skipped", "1");
    localStorage.setItem("scrapivo:guided-tour-seen", "1");
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

async function startFreshChat(page: Page) {
  await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden();
  const newChat = page.getByRole("button", { name: "New chat", exact: true }).first();
  if (await newChat.isVisible().catch(() => false)) await newChat.click();
  await expect(page.getByRole("textbox").first()).toBeEnabled({ timeout: 30_000 });
}

async function submitQuery(page: Page, q: string) {
  await page.getByRole("textbox").first().fill(q);
  await page.getByRole("textbox").first().press("Enter");
}

function searchRequest(request: Request, q: string, forced: boolean): RunRequest | undefined {
  if (request.method() !== "POST") return;
  const body = request.postData() ?? "";
  if (!body.includes("search_run_id") || !body.includes("query")) return;
  if (!body.includes(JSON.stringify(q)) && !body.includes(q)) return;
  const payload = fromJSON(JSON.parse(body), { plugins: [] }) as { data?: RunRequest };
  const data = payload.data;
  if (data?.query !== q || data.force !== forced) return;
  if (
    ![data.search_run_id, data.conversation_id, data.turn_id, data.request_id].every(
      (id) => typeof id === "string" && id.length > 0,
    )
  )
    return;
  return data;
}

function subjectBoundEvidence(row: SpecRow) {
  const subject = row.entity_id ?? row.key ?? "";
  return (row.evidence ?? []).filter(
    (evidence) =>
      !!evidence.source_url &&
      !!evidence.excerpt &&
      (!subject || evidence.subject === subject),
  );
}

function verifiedField(row: SpecRow, field: string) {
  const provenance = row.field_provenance?.[field];
  return (
    !!provenance?.source_url &&
    provenance.verification_status === "verified" &&
    Number(provenance.confidence ?? 0) >= 0.7
  );
}

function fieldOrEvidenceMatches(row: SpecRow, fields: string[], terms: string[] | undefined) {
  if (!terms?.length) return true;
  const text = [
    ...fields.map((field) => row[field as keyof SpecRow]),
    ...Object.entries(row.field_provenance ?? {})
      .filter(([field, provenance]) => fields.includes(field) && provenance.verification_status === "verified")
      .map(([, provenance]) => `${provenance.value} ${provenance.source_url}`),
    ...subjectBoundEvidence(row).map(
      (evidence) =>
        `${evidence.evidence_type} ${evidence.supports} ${evidence.excerpt} ${JSON.stringify(evidence.claim_parameters ?? {})}`,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function rowEvidenceUrls(row: SpecRow) {
  return [
    ...Object.values(row.field_provenance ?? {})
      .filter((field) => field.verification_status === "verified")
      .map((field) => field.source_url),
    ...subjectBoundEvidence(row).map((evidence) => evidence.source_url),
  ].filter((url): url is string => !!url);
}

function contactReport(row: SpecRow) {
  const contactFields = [
    "email",
    "phone",
    "website_url",
    "contact_page_url",
    "profile_url",
    "apply_url",
  ];
  const present = contactFields.filter((field) => !!row[field as keyof SpecRow]);
  const subject = row.entity_id ?? row.key ?? "";
  const contactEvidence = subjectBoundEvidence(row).filter(
    (evidence) =>
      evidence.evidence_type === "contact" &&
      (!subject || evidence.subject === subject) &&
      Number(evidence.confidence ?? 0) >= 0.7,
  );
  const verified = present.filter(
    (field) =>
      verifiedField(row, field) ||
      (["email", "phone", "contact_page_url"].includes(field) && contactEvidence.length > 0),
  );
  return {
    title: row.title,
    present,
    verified,
    missing: contactFields.filter((field) => !present.includes(field)),
  };
}

function deliveredRowIssues(row: SpecRow, query: QueryCase) {
  const issues: string[] = [];
  if (!query.kind.includes(row.kind)) issues.push(`wrong kind: ${row.kind}`);
  if (!row.title.trim()) issues.push("missing entity name");
  if (row.entity_resolved !== true) issues.push("unresolved entity");
  if ((row.entity_id ?? row.key ?? "").startsWith("provisional:"))
    issues.push("provisional identity");
  if (
    ["list", "directory", "aggregator", "job_board", "article", "institute"].includes(
      row.page_type ?? "",
    )
  )
    issues.push("non-entity page");
  if (row.disposition !== "qualified") issues.push("unqualified disposition");
  if (row.verification_status === "rejected") issues.push("rejected verification");
  if (!rowEvidenceUrls(row).length) issues.push("missing observed provenance");
  if (!fieldOrEvidenceMatches(row, ["category", "industry", "sector", "detail"], query.category))
    issues.push("category not evidenced");
  if (!fieldOrEvidenceMatches(row, ["role", "title", "detail", "employer", "company"], query.roles))
    issues.push("role not evidenced");
  if (!fieldOrEvidenceMatches(row, ["location", "country", "detail"], query.locations))
    issues.push("location not evidenced");
  for (const field of query.fields ?? [])
    if (!row[field as keyof SpecRow]) issues.push(`missing field: ${field}`);
  return issues;
}

function reportFromResult(
  base: Omit<PhaseReport, "status" | "durationMs">,
  result: BackendResult | undefined,
  durationMs: number,
  status: PhaseReport["status"],
  failure?: string,
): PhaseReport {
  const rows = result?.rows ?? [];
  return {
    ...base,
    status,
    durationMs,
    failure,
    outcome: result?.outcome,
    providers: result?.providerAttempts ?? result?.retrievalTrace?.providers ?? [],
    funnel: result?.retrievalTrace,
    accounting: result?.candidateLedger?.accounting,
    rejects: result?.candidateLedger?.rejectReasons,
    incomplete: result?.candidateLedger?.incompleteReasons,
    contacts: rows.map(contactReport),
    evidence: rows.map((row) => ({ title: row.title, urls: rowEvidenceUrls(row) })),
  };
}

function writeReport(report: PhaseReport) {
  const file = join(REPORT_DIR, `${report.id}-round${report.round}-${report.phase}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
}

function parseRunLog(searchRunId: string) {
  if (!SERVER_LOG) return [];
  const lines = readFileSync(SERVER_LOG, "utf8").split(/\r?\n/);
  return lines
    .filter((line) => line.includes(searchRunId))
    .map((line) => {
      const jsonStart = line.indexOf("{");
      const data =
        jsonStart === -1
          ? undefined
          : (() => {
              try {
                return JSON.parse(line.slice(jsonStart));
              } catch {
                return undefined;
              }
            })();
      return { line, data };
    });
}

function hasCoreStarted(searchRunId: string) {
  return parseRunLog(searchRunId).some(
    (entry) =>
      entry.line.includes("[spec-run]") &&
      /core started/i.test(entry.line) &&
      entry.data?.search_run_id === searchRunId,
  );
}

function cancellationLogProof(searchRunId: string) {
  const entries = parseRunLog(searchRunId);
  const terminal = entries.find(
    (entry) =>
      entry.line.includes("[spec-run]") &&
      /core returned/i.test(entry.line) &&
      /SEARCH_CANCELLED|CANCELLED|SEARCH_STALE_RUN/.test(entry.line),
  );
  const funnel = entries.find((entry) => entry.line.includes("[stage2-funnel]"));
  const accounting = funnel?.data?.accounting;
  const returned = funnel?.data?.returned ?? funnel?.data?.funnel?.returned;
  const lateRows = entries.filter(
    (entry) => /QUALIFIED_RESULTS|delivered/i.test(entry.line) && !/SEARCH_CANCELLED|CANCELLED|SEARCH_STALE_RUN/.test(entry.line),
  );
  return {
    terminal: !!terminal,
    funnel: !!funnel,
    accountingOk: accounting?.ok === true,
    unaccountedZero: accounting?.unaccounted === 0,
    returnedZero: returned === 0,
    noLateRows: lateRows.length === 0,
  };
}

function assertBackend(
  result: BackendResult,
  request: RunRequest,
  query: QueryCase,
  allowCard: boolean,
) {
  for (const id of ["search_run_id", "conversation_id", "turn_id", "request_id"] as const) {
    expect(result[id], `Response ${id} must belong to this submission`).toBe(request[id]);
  }
  const accounting = result.candidateLedger?.accounting;
  expect(accounting, "Backend candidate accounting is required").toBeDefined();
  expect(accounting?.ok, "Backend candidate accounting must reconcile").toBe(true);
  expect(accounting?.unaccounted).toBe(0);
  expect(accounting?.retrieved).toBe(accounting?.fated);
  expect(result.qualified_count).toBe(result.rows.length);
  if (result.outcome === undefined) {
    expect(allowCard, "Forced clarification must reach terminal search").toBe(true);
    expect(
      result.stage === "clarify" ||
        result.stage === "confirm" ||
        result.spec.status === "needs_clarification",
    ).toBe(true);
    return "card" as const;
  }
  expect(
    ["QUALIFIED_RESULTS", "NO_QUALIFIED_RESULTS"],
    "Backend failures/cancellation are not successful settlement",
  ).toContain(result.outcome);
  expect(result.retrievalTrace, "Completed search must include retrieval trace").toBeDefined();
  expect(result.retrievalTrace?.returned).toBe(result.rows.length);
  if (result.outcome === "QUALIFIED_RESULTS") {
    expect(result.rows.length, "QUALIFIED_RESULTS must deliver at least one row").toBeGreaterThan(0);
    const rowIssues = result.rows
      .map((row) => ({ title: row.title, issues: deliveredRowIssues(row, query) }))
      .filter((item) => item.issues.length);
    expect(
      rowIssues,
      "Delivered rows must match requested entity/role/category/location/evidence",
    ).toEqual([]);
    return "results" as const;
  }
  const providers = (result.providerAttempts ?? result.retrievalTrace?.providers ?? []).filter(
    (provider) => provider.attempted,
  );
  expect(providers.length, "Zero requires attempted sources").toBeGreaterThan(0);
  expect(
    providers.every((provider) => provider.succeeded),
    "Unavailable sources cannot certify zero",
  ).toBe(true);
  expect(
    result.retrievalTrace?.sourceHealth?.summary,
    "Source-health warning blocks honest zero",
  ).toBeFalsy();
  expect(
    result.retrievalTrace?.pendingEnrichment ?? 0,
    "Unfinished enrichment blocks honest zero",
  ).toBe(0);
  if (query.requireResults) throw new Error("Known-positive query returned zero verified rows");
  return "zero" as const;
}

async function waitForSettlement(
  page: Page,
  query: QueryCase,
  round: number,
  action: () => Promise<unknown>,
  forced = false,
) {
  const phase = forced ? "forced" : "initial";
  const startedAt = Date.now();
  let request: Request | undefined;
  let data: RunRequest | undefined;
  let response: Response | undefined;
  let result: BackendResult | undefined;
  let rawBody: string | undefined;
  let failure: string | undefined;
  let settled: PhaseReport["settled"];
  const turn = page
    .locator("div.space-y-4")
    .filter({ has: page.getByText(query.query, { exact: true }) });
  const rowTitles = turn.locator(
    ".lead-card-hover > .font-medium, div.bg-card > button.text-left.w-full .font-medium, table tbody tr > td:first-child, button > span > span.block.font-medium",
  );
  let resolveResponse!: () => void;
  let rejectResponse!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const requestTimer = setTimeout(
    () => rejectResponse(new Error(`No runSpecSearch POST observed for ${query.id}`)),
    30_000,
  );
  const timer = setTimeout(
    () => rejectResponse(new Error(`Backend response timeout for ${query.id}`)),
    660_000,
  );
  const onRequest = (candidate: Request) => {
    try {
      const candidateData = searchRequest(candidate, query.query, forced);
      if (!candidateData) return;
      if (request) {
        rejectResponse(new Error(`Duplicate search submission: ${query.id}`));
        return;
      }
      request = candidate;
      data = candidateData;
      clearTimeout(requestTimer);
    } catch (error) {
      rejectResponse(error as Error);
    }
  };
  const onResponse = (candidate: Response) => {
    if (candidate.request() !== request) return;
    response = candidate;
    void candidate
      .finished()
      .then((error) => (error ? rejectResponse(error) : resolveResponse()), rejectResponse);
  };
  const onFailed = (candidate: Request) => {
    if (candidate === request)
      rejectResponse(new Error(`Search request failed: ${candidate.failure()?.errorText}`));
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  try {
    await Promise.all([completed, action()]);
    rawBody = await response!.text();
    expect(response?.ok(), "Search HTTP response must succeed").toBe(true);
    const wire = JSON.parse(rawBody);
    const envelope = (typeof wire.t === "number" ? fromCrossJSON(wire, { plugins: [] }) : wire) as {
      result?: BackendResult;
      error?: unknown;
    };
    expect(envelope.error, "Server function returned error").toBeUndefined();
    result = envelope.result;
    expect(result).toBeDefined();
    const preReport = reportFromResult(
      { id: query.id, query: query.query, round, phase, request: data },
      result,
      Date.now() - startedAt,
      "FAIL",
    );
    preReport.rowIssues =
      result?.rows.map((row) => ({ title: row.title, issues: deliveredRowIssues(row, query) })) ??
      [];
    writeReport(preReport);
    settled = assertBackend(result!, data!, query, !forced);
    await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden({
      timeout: 30_000,
    });
    await expect(turn, "UI must render this query turn").toHaveCount(1);
    if (settled === "card") {
      await expect(
        page.getByText(/Narrow this down|Here is what I understood/).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(rowTitles).toHaveCount(0);
    } else {
      await expect(
        page.getByText(/Narrow this down|Here is what I understood/).first(),
      ).toBeHidden();
      await expect(rowTitles).toHaveCount(result!.rows.length, { timeout: 30_000 });
      expect((await rowTitles.allTextContents()).map((title) => title.trim()).sort()).toEqual(
        result!.rows.map((row) => fixMojibake(row.title.trim())).sort(),
      );
      if (settled === "zero") {
        const narrative = enrichZeroNarrative(
          zeroResultsNarrative(result!.retrievalTrace),
          result!.candidateLedger,
        );
        if (narrative) await expect(turn.getByText(narrative, { exact: true })).toBeVisible();
        else await expect(turn.getByText(/No verified matches/).first()).toBeVisible();
      } else {
        await expect(
          turn.getByRole("button", {
            name: new RegExp(`^Fold \\(${result!.rows.length} results?\\)$`),
          }),
        ).toBeVisible();
      }
    }
    writeReport({
      ...reportFromResult(
        { id: query.id, query: query.query, round, phase, request: data, settled },
        result,
        Date.now() - startedAt,
        "PASS",
      ),
      uiRows: await rowTitles.allTextContents().catch(() => []),
    });
    return settled;
  } catch (error) {
    failure = String(error);
    writeReport({
      ...reportFromResult(
        { id: query.id, query: query.query, round, phase, request: data },
        result,
        Date.now() - startedAt,
        "FAIL",
        failure,
      ),
      settled,
    });
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(requestTimer);
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
    if (rawBody && !result)
      writeReport({
        id: query.id,
        query: query.query,
        round,
        phase,
        status: "FAIL",
        durationMs: Date.now() - startedAt,
        request: data,
        failure,
        outcome: undefined,
      });
  }
}

async function forceTerminal(page: Page, query: QueryCase, round: number) {
  const force = page.getByRole("button", { name: /Search with defaults|Confirm & search/ }).first();
  const skip = page.getByRole("button", { name: "Skip", exact: true }).first();
  const deadline = Date.now() + 30_000;
  while (
    !(await force.isVisible().catch(() => false)) &&
    (await skip.isVisible().catch(() => false))
  ) {
    expect(Date.now(), `Clarification steps did not advance: ${query.id}`).toBeLessThan(deadline);
    await skip.click();
  }
  expect(
    await force.isVisible().catch(() => false),
    "Clarification must expose a force/confirm search action",
  ).toBe(true);
  await expect(force).toBeEnabled();
  return await waitForSettlement(page, query, round, () => force.click(), true);
}

for (const round of [1, 2]) {
  for (const query of CASES) {
    test(`stage2 acceptance ${query.id} round ${round} - ${query.query}`, async ({ page }) => {
      test.setTimeout(1_400_000);
      await login(page);
      await startFreshChat(page);
      const settled = await waitForSettlement(page, query, round, () =>
        submitQuery(page, query.query),
      );
      if (settled === "card") {
        const forced = await forceTerminal(page, query, round);
        expect(forced, "Clarification must force a terminal result or honest zero").not.toBe(
          "card",
        );
      }
    });
  }
  test(`stage2 impossible honest zero round ${round}`, async ({ page }) => {
    test.setTimeout(1_400_000);
    await login(page);
    await startFreshChat(page);
    const settled = await waitForSettlement(page, IMPOSSIBLE, round, () =>
      submitQuery(page, IMPOSSIBLE.query),
    );
    if (settled === "card") {
      const forced = await forceTerminal(page, IMPOSSIBLE, round);
      expect(forced).toBe("zero");
    } else {
      expect(settled).toBe("zero");
    }
    await expect(page.getByText(/\([1-9]\d* results?\)/i)).toHaveCount(0);
  });
}

test("stage2 acceptance selection is exact", () => {
  expect(CASES.map((item) => item.query)).toEqual([
    "Solar installers in Windhoek",
    "Freight forwarders in Tbilisi",
    "Photographers in Cebu",
    "AI startup founders in Toronto",
    "CTOs at SaaS startups in Berlin",
    "Remote frontend developer jobs in Canada",
    "Data analyst jobs in Dhaka",
    "Climate-tech investors in Europe",
    "Fintech angel investors in India",
    "Founders or CTOs of AI startups in Toronto and Vancouver",
  ]);
});

test("stage2 cancellation requires backend cancellation proof", async ({ page }) => {
  test.setTimeout(240_000);
  if (!SERVER_LOG) {
    writeReport({
      id: "CANCEL",
      query: "find 25 marketing agencies in London with email addresses",
      round: 1,
      phase: "cancel",
      status: "BLOCKED",
      durationMs: 0,
      failure: "S2_SERVER_LOG not provided",
    });
    test.skip(true, "S2_SERVER_LOG required for backend cancellation proof");
  }
  await login(page);
  await startFreshChat(page);
  const q = "find 25 marketing agencies in London with email addresses";
  const startedAt = Date.now();
  const requestPromise = page.waitForRequest((request) => !!searchRequest(request, q, false), {
    timeout: 30_000,
  });
  const [request] = await Promise.all([requestPromise, submitQuery(page, q)]);
  const data = searchRequest(request, q, false)!;
  const stop = page.getByRole("button", { name: "Stop search", exact: true });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => hasCoreStarted(data.search_run_id), {
      message: "Cancellation needs backend/core [spec-run] core started proof before Stop",
      timeout: 60_000,
    })
    .toBe(true);
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (failed) => failed === request,
    timeout: 30_000,
  });
  await Promise.all([aborted, stop.click()]);
  await expect(stop).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  const proof = await expect
    .poll(() => cancellationLogProof(data.search_run_id), {
      message: "Cancellation needs terminal core returned + stage2 funnel accounting",
      timeout: 60_000,
    })
    .toMatchObject({
      terminal: true,
      funnel: true,
      accountingOk: true,
      unaccountedZero: true,
      returnedZero: true,
      noLateRows: true,
    })
    .then(() => cancellationLogProof(data.search_run_id));
  const status: PhaseReport["status"] =
    proof.terminal &&
    proof.funnel &&
    proof.accountingOk &&
    proof.unaccountedZero &&
    proof.returnedZero &&
    proof.noLateRows
      ? "PASS"
      : "BLOCKED";
  writeReport({
    id: "CANCEL",
    query: q,
    round: 1,
    phase: "cancel",
    status,
    durationMs: Date.now() - startedAt,
    request: data,
    failure:
      status === "BLOCKED"
        ? `Missing cancellation proof: ${JSON.stringify(proof)}`
        : undefined,
  });
  expect(status, `Cancellation proof failed: ${JSON.stringify(proof)}`).toBe("PASS");
});
