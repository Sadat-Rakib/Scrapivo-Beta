/**
 * SpecRow → intent candidates (Phase D): people/company rows from the spec
 * path feed evidence enrichment exactly like business rows. Round-robin
 * across kinds preserves the T4 anti-starvation rule. Rows without a stable
 * key are skipped (badges key off registry keys, never titles).
 */
import type { IntentCandidate } from "./discover.server";
import type { SpecRow } from "@/lib/spec-search.functions";

const ENRICHABLE = new Set(["person", "company", "business", "investor"]);

export function specRowsToCandidates(rows: SpecRow[], limit = 20): IntentCandidate[] {
  const pools = new Map<string, IntentCandidate[]>();
  for (const r of rows) {
    if (!ENRICHABLE.has(r.kind)) continue;
    if (!r.key) continue;
    const c: IntentCandidate = {
      key: r.key,
      name: r.title,
      company: r.kind === "business" || r.kind === "company" ? r.title : null,
      city: r.location ?? null,
      country: r.country ?? null,
    };
    const pool = pools.get(r.kind) ?? [];
    pool.push(c);
    pools.set(r.kind, pool);
  }
  const lists = [...pools.values()];
  const out: IntentCandidate[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const pool of lists) {
      if (pool[i]) {
        out.push(pool[i]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}
