import { afterEach, expect, it, vi } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";
import type { SearchSpec } from "../search/search-spec";

afterEach(() => vi.unstubAllEnvs());

const spec: SearchSpec = { entity: "company", criteria: [
  { field: "industry", value: "cybersecurity company", stated: true, confidence: 1 },
  { field: "location", value: "USA", stated: true, confidence: 1 },
  { field: "location_id", value: "geo:country:us", stated: true, confidence: 1 },
  { field: "location_kind", value: "country", stated: true, confidence: 1 },
], missing: [], signal_required: false, signal_types: [], signal_recency: null,
  status: "ready_to_search", raw_query: "cybersecurity companies in USA" };

it("passes the tier budget and projects observed regional country before strict qualification", async () => {
  vi.stubEnv("USE_COVERAGE_SELECTOR", "true");
  const companies = vi.fn(async (_query: unknown) => ({ rows: [{
    company_name: "Security Product", category: "Cyber Security, Software",
    location: "New England, Northeastern US", website: "https://security.example",
    email: null, phone: null, linkedin: null, facebook: null, twitter: null,
    description: null, employees: null, quality_score: 90,
  }], meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["source.parquet"], rowsScanned: 1, rowsReturned: 1 } }));
  const result = await runSpecSearchCore(spec.raw_query, { companies, index: null }, 1, { mode: "looking" }, { spec });
  expect(companies).toHaveBeenCalledOnce();
  const query = companies.mock.calls[0]?.[0] as unknown as { signal: AbortSignal; deadline: number };
  expect(query.signal).toBeInstanceOf(AbortSignal);
  expect(query.deadline).toBeGreaterThan(Date.now());
  expect(result.rows, JSON.stringify({ ledger: result.candidateLedger, trace: result.retrievalTrace, diagnostics: result.diagnostics })).toHaveLength(1);
  expect(result.rows[0].country).toBe("US");
  expect(result.outcome).toBe("QUALIFIED_RESULTS");
});

it("cancels the underlying company scan when its search is cancelled", async () => {
  vi.stubEnv("USE_COVERAGE_SELECTOR", "true");
  const controller = new AbortController();
  let scanAborted = false;
  const companies = vi.fn((query: { signal?: AbortSignal | null }) => new Promise<never>((_resolve, reject) => {
    query.signal?.addEventListener("abort", () => {
      scanAborted = true;
      reject(new Error("SEARCH_CANCELLED"));
    }, { once: true });
    controller.abort();
  }));
  const result = await runSpecSearchCore(spec.raw_query, { companies, index: null, signal: controller.signal }, 1, { mode: "looking" }, { spec });
  expect(scanAborted).toBe(true);
  expect(result.outcome).toBe("SEARCH_CANCELLED");
  expect(result.rows).toEqual([]);
});
