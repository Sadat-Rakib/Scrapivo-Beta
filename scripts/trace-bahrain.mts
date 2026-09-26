/** Phase 1 trace: hotels in Bahrain, tier by tier. */
import { runSpecSearchCore } from "@/lib/spec-search.functions";

const t0 = Date.now();
const r = await runSpecSearchCore("hotels in Bahrain", {}, 25, { mode: "looking" });
console.log(
  JSON.stringify(
    {
      entity: r.spec.entity,
      criteria: r.spec.criteria,
      missing: r.spec.missing,
      clarify: r.clarify.map((q) => q.id),
      rows: r.rows.length,
      countries: [...new Set(r.rows.map((x) => x.country).filter(Boolean))],
      engines: r.dbMeta.map((m) => ({ e: m.engine, read: m.partitionsRead, n: m.rowsReturned })),
      live: r.liveDiscovery,
      ms: Date.now() - t0,
    },
    null,
    1,
  ),
);
