/** Full initial-product acceptance battery (A–L) through the same core as /discover. */
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const { runSpecSearchCore } = await import("../src/lib/spec-search.functions");
const { SEARCH_DEADLINE_REASON } = await import("../src/lib/search/search-run");

type Check = {
  id: string;
  query: string;
  limit: number;
  answers?: Record<string, string>;
};

const checks: Check[] = [
  { id: "A", query: "Find 50 plumbers in Austin.", limit: 50 },
  { id: "B", query: "Find 10 plumbers in Austin with no website. Include their public phone numbers and emails when available.", limit: 10 },
  { id: "C", query: "Find 10 SaaS founders globally who may need help with AI automation.", limit: 10 },
  { id: "D", query: "Find founders who recently posted about struggling with manual operations or workflow automation.", limit: 10 },
  { id: "E", query: "Find 20 SaaS companies in Toronto and their public contact details.", limit: 20 },
  { id: "F", query: "Find 25 HVAC companies in the Greater Toronto Area.", limit: 25 },
  { id: "G", query: "Find React developer jobs in Toronto.", limit: 10 },
  { id: "H", query: "Find remote machine learning engineer jobs in Canada.", limit: 10 },
  { id: "I", query: "Find investors who focus on AI infrastructure startups.", limit: 10, answers: { investor_stage: "any", investor_check: "any" } },
  { id: "J", query: "help me find founders", limit: 10 },
  { id: "K", query: "asdfgh", limit: 10 },
  { id: "L", query: "what's the weather in Paris", limit: 10 },
];

const only = process.argv.slice(2).map((a) => a.toUpperCase());
for (const check of checks.filter((c) => !only.length || only.includes(c.id))) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(SEARCH_DEADLINE_REASON), 150_000);
  const actions: Record<string, number> = {};
  try {
    const result = await runSpecSearchCore(
      check.query,
      {
        signal: controller.signal,
        browserProgress: (event) => {
          actions[event.action] = (actions[event.action] ?? 0) + 1;
        },
      },
      check.limit,
      { mode: "looking", ...(check.answers ?? {}) },
    );
    const trace = result.retrievalTrace;
    const contacts = result.rows.filter((r) => r.email || r.phone).length;
    const sites = result.rows.filter((r) => r.website_url || r.profile_url || r.apply_url).length;
    console.log(JSON.stringify({
      acceptance: check.id,
      ms: Date.now() - started,
      outcome: result.outcome,
      live: result.liveDiscovery,
      requested: check.limit,
      discovered: trace?.rawCandidates ?? result.dbMeta.reduce((sum, m) => sum + m.rowsReturned, 0),
      postSpecFilter: trace?.postSpecFilter,
      researchable: trace?.researchable,
      researched: trace?.researched,
      complete: trace?.complete,
      pendingEnrichment: trace?.pendingEnrichment,
      qualificationRejected: trace?.qualificationRejected,
      qualified: trace?.qualified,
      returned: result.rows.length,
      contacts,
      sites,
      reason: trace?.reason ?? null,
      clarify: result.clarify.length,
      questions: result.questions.length,
      topRows: result.rows.slice(0, 5).map((r) => ({ title: r.title, kind: r.kind, url: r.url ?? null, phone: r.phone ?? null, email: r.email ?? null })),
      actions,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      acceptance: check.id,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }));
  } finally {
    clearTimeout(timeout);
  }
}
process.exit(0);
