/**
 * Real pipeline passRunner (data-asset pass). Bridges the WS1 engine to
 * runSpecSearchCore: one pass = one bounded search over the job's pre-compiled
 * spec. The pass persists nothing itself — the engine owns candidate/query
 * persistence and counts. Deterministic tests inject their own passRunner;
 * this module is only imported by worker.server.ts (never by client routes).
 */
import type {
  EnginePassContext,
  EnginePassResult,
} from "@/lib/jobs/job-engine.server";
import { SEARCH_DEADLINE_REASON } from "@/lib/search/search-run";

type TraceShape = {
  rawCandidates?: number;
  researchable?: number;
  complete?: number;
  qualified?: number;
};

export async function runPipelinePass(ctx: EnginePassContext): Promise<EnginePassResult> {
  const { runSpecSearchCore } = await import("@/lib/spec-search.functions");
  const { createReuseRun } = await import("@/lib/canonical/reuse-metrics.server");

  // Pass budget aborts with the DEADLINE reason so runSpecSearchCore finalizes
  // accumulated candidates instead of discarding them (its cancellation path
  // drops rows; the deadline path keeps verified work).
  const combined = new AbortController();
  const onOuterAbort = () => combined.abort(SEARCH_DEADLINE_REASON);
  ctx.signal.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => combined.abort(SEARCH_DEADLINE_REASON), Math.max(ctx.budgetMs, 1_000));
  timer.unref?.();

  const reuse = createReuseRun();
  try {
    const remaining = Math.max(ctx.job.target - ctx.job.qualified_count, 1);
    const limit = Math.min(remaining, 200);
    const result = await runSpecSearchCore(
      ctx.spec.raw_query,
      { signal: combined.signal, ownerId: ctx.job.user_id, reuse },
      limit,
      {},
      {
        spec: ctx.spec,
        jobContext: {
          poolTargetOverride: ctx.poolTarget,
          excludeCandidateKeys: ctx.excludeCandidateKeys,
        },
      },
    );
    const trace = (result as { retrievalTrace?: TraceShape }).retrievalTrace;
    const snapshot = reuse.snapshot();
    console.info(
      "[job-pass] " +
        JSON.stringify({
          jobId: ctx.job.id,
          pass: ctx.job.current_pass + 1,
          outcome: result.outcome,
          qualified: trace?.qualified ?? result.qualified_count,
          ...snapshot,
        }),
    );
    return {
      qualifiedCount: trace?.qualified ?? result.qualified_count,
      researchedCount: trace?.researchable ?? trace?.complete ?? 0,
      discoveredCount: trace?.rawCandidates ?? result.rows.length,
      newCandidates: result.rows.map((r) => ({
        candidate_key: r.entity_id ?? r.key ?? `${r.kind}:${r.url ?? r.title}`,
        entity_id: r.entity_id ?? null,
        state: "QUALIFIED",
        priority: 1,
        attempts: 1,
        data: {
          kind: r.kind,
          title: r.title,
          detail: r.detail,
          url: r.url ?? null,
          email: r.email ?? null,
          phone: r.phone ?? null,
          website_url: r.website_url ?? null,
        },
      })),
      newQueries: [
        {
          query_hash: `${ctx.job.id}:p${ctx.job.current_pass + 1}`,
          query: ctx.spec.raw_query,
          result_count: result.rows.length,
        },
      ],
    };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onOuterAbort);
  }
}
