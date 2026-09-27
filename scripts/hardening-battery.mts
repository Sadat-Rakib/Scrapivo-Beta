/** Generalized hardening battery — routing/clarification/state classes (Part 22). */
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const { runSpecSearchCore } = await import("../src/lib/spec-search.functions");
const { SEARCH_DEADLINE_REASON } = await import("../src/lib/search/search-run");

type Check = { id: string; query: string; limit: number; expect: string };
const checks: Check[] = [
  { id: "H1", query: "find me investors", limit: 10, expect: "clarify (focus question), never buyer-intent zero" },
  { id: "H2", query: "find me pre-seed AI investors", limit: 10, expect: "search or geography question" },
  { id: "H3", query: "find investors backing pre-seed AI startups in North America", limit: 10, expect: "search" },
  { id: "H4", query: "find me remote frontend jobs", limit: 10, expect: "results or narrowing question — never silence" },
  { id: "H5", query: "find senior React jobs remote in Canada", limit: 10, expect: "direct search" },
  { id: "H6", query: "find me SaaS founders", limit: 10, expect: "clarify (kind) — no premature zero" },
  { id: "H7", query: "find 20 SaaS founders in the US", limit: 20, expect: "volume search" },
  { id: "H8", query: "find founders who posted about needing automation help recently", limit: 10, expect: "signal search" },
  { id: "H9", query: "find plumbers", limit: 10, expect: "location clarify" },
  { id: "H10", query: "find 30 plumbers in Austin", limit: 30, expect: "fast broad path" },
  { id: "H11", query: "find companies", limit: 10, expect: "industry/location clarify" },
  { id: "H12", query: "find AI startups in Toronto", limit: 10, expect: "search" },
  { id: "H13", query: "find me investors who write $100k-$500k checks into fintech seed rounds", limit: 10, expect: "investment filters parsed" },
  { id: "H14", query: "find HVAC businesses in GTA without websites", limit: 10, expect: "no-website pipeline" },
  { id: "H15", query: "asdfgh", limit: 10, expect: "entity clarify" },
  { id: "H16", query: "weather in Paris", limit: 10, expect: "off-topic, no pipeline" },
];

const only = process.argv.slice(2).map((a) => a.toUpperCase());
for (const check of checks.filter((c) => !only.length || only.includes(c.id))) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(SEARCH_DEADLINE_REASON), 150_000);
  try {
    const res = await runSpecSearchCore(
      check.query,
      { signal: controller.signal, browserProgress: () => undefined },
      check.limit,
      { mode: "looking" },
    );
    console.log(JSON.stringify({
      id: check.id,
      expect: check.expect,
      ms: Date.now() - started,
      outcome: res.outcome,
      entity: res.spec.entity,
      signal_required: res.spec.signal_required,
      clarify: res.clarify.map((q) => q.id),
      questions: res.questions.length,
      returned: res.rows.length,
      qualified: res.retrievalTrace?.qualified ?? 0,
      discovered: res.retrievalTrace?.rawCandidates ?? 0,
      reason: res.retrievalTrace?.reason ?? null,
      timings: res.retrievalTrace?.timings ?? null,
    }));
  } catch (error) {
    console.log(JSON.stringify({ id: check.id, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    clearTimeout(timeout);
  }
}
process.exit(0);
