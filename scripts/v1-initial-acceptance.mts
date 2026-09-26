/** Run the three initial-product searches through the same core as /discover. */
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const { runSpecSearchCore } = await import("../src/lib/spec-search.functions");
const { SEARCH_DEADLINE_REASON } = await import("../src/lib/search/search-run");

const checks = [
  ["A", "Find 10 plumbers in Austin with no website. Include their public phone numbers and emails when available."],
  ["B", "Find 10 SaaS founders globally who may need help with AI automation."],
  ["C", "Find 10 SaaS companies in Toronto and give me their public contact details."],
] as const;

for (const [id, query] of checks.filter(([id]) => !process.argv[2] || process.argv[2].toUpperCase() === id)) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(SEARCH_DEADLINE_REASON), 120_000);
  const actions: Record<string, number> = {};
  try {
    const result = await runSpecSearchCore(query, {
      signal: controller.signal,
      browserProgress: (event) => { actions[event.action] = (actions[event.action] ?? 0) + 1; },
    }, 10, { mode: "looking" });
    console.log(JSON.stringify({
      acceptance: id,
      ms: Date.now() - started,
      spec: { entity: result.spec.entity, criteria: result.spec.criteria, signal_required: result.spec.signal_required },
      db: result.dbMeta.map((meta) => ({ engine: meta.engine, scanned: meta.scanned, matched: meta.matched })),
      live: result.liveDiscovery,
      providers: result.providerAttempts?.map((attempt) => ({ provider: attempt.provider, found: attempt.artifactsFound, qualified: attempt.qualified, outcome: attempt.outcome, error: attempt.error })),
      trace: result.retrievalTrace,
      verified: result.qualified_count,
      returned: result.rows.length,
      rows: result.rows.map((row) => ({ title: row.title, url: row.url, source_url: row.source_url, website_url: row.website_url, profile_url: row.profile_url, phone: row.phone, email: row.email, why_match: row.why_match })),
      outcome: result.outcome,
      diagnostics: result.diagnostics,
      actions,
    }));
  } catch (error) {
    console.log(JSON.stringify({ acceptance: id, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    clearTimeout(timeout);
  }
}
process.exit(0);
