/**
 * Production QualifiedLead persistence — live DB round-trip.
 *
 * Skips when MY_SUPABASE_* unset or table missing (migration not applied).
 * Proves: project → upsert → hydrate → semanticEqual / theorem, including
 * idempotency, multi-claim, event_at freeze, run lineage.
 */
import { readFileSync } from "node:fs";

// Same loader as scripts/_env.mts — Vitest does not hydrate .env.
try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
} catch {
  /* no .env */
}

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { createSearchRun } from "../search-run";
import {
  hydrateQualifiedLead,
  hydratedLeadStillPassesTheorem,
  persistQualifiedLead,
  semanticEqual,
} from "../qualified-lead-persist";
import { leadKeyOf } from "../qualified-lead";
import {
  SupabaseQualifiedLeadStore,
  tryOpenSupabaseQualifiedLeadStore,
} from "../qualified-lead-store.server";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "../evidence";

const NOW = Date.now();
const PREFIX = `test:ql:${NOW}`;

function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString();
}

function hiringRow(over: Partial<SpecRow> = {}): SpecRow {
  const entity_id =
    (typeof over.entity_id === "string" && over.entity_id) ||
    `${PREFIX}:company:acme`;
  const evidence: Evidence[] = [
    {
      source_url: "https://acme.example/jobs/react",
      source_type: "job_posting",
      excerpt: "Hiring senior React developers in Austin",
      observed_at: new Date(NOW).toISOString(),
      evidence_type: "hiring",
      supports: "intent",
      confidence: 0.9,
      subject: entity_id,
      event_at: daysAgo(2),
      claim_parameters: { technology: "React", role: "developer" },
    },
  ];
  return {
    kind: "company",
    title: "Acme",
    url: "https://acme.example",
    location: "Austin",
    country: "US",
    disposition: "qualified",
    entity_resolved: true,
    email: "jobs@acme.example",
    field_provenance: {
      email: { value: "jobs@acme.example", source: "page", confidence: 0.9 },
    },
    ...over,
    // Keep identity + evidence subject aligned when caller overrides entity_id.
    entity_id,
    key: (typeof over.key === "string" && over.key) || entity_id,
    evidence: over.evidence ?? evidence,
  } as SpecRow;
}

function fundingRow(entity_id: string): SpecRow {
  return {
    key: entity_id,
    entity_id,
    kind: "company",
    title: "Acme",
    url: "https://acme.example",
    location: "Berlin",
    country: "DE",
    disposition: "qualified",
    entity_resolved: true,
    evidence: [
      {
        source_url: "https://news.example/acme-series-a",
        source_type: "news",
        excerpt: "Acme raises Series A in Berlin",
        observed_at: new Date(NOW).toISOString(),
        evidence_type: "funding",
        supports: "intent",
        confidence: 0.9,
        subject: entity_id,
        event_at: daysAgo(5),
      },
    ],
  } as SpecRow;
}

// Live DB round-trip writes (and then deletes) test:ql:* rows in whatever
// Supabase project `.env` points at — a production-backed project here. It
// must never run by default: opt in explicitly, and never while the local
// no-persist guard is active (MVP RC pass, test-contract fix).
const hasEnv =
  process.env.SCRAPIVO_ALLOW_LIVE_DB_TESTS === "true" &&
  process.env.SCRAPIVO_LOCAL_NO_PERSIST !== "true" &&
  !!process.env.MY_SUPABASE_URL?.trim() &&
  !!process.env.MY_SUPABASE_SERVICE_ROLE_KEY?.trim();

describe.skipIf(!hasEnv)("M10 production — SupabaseQualifiedLeadStore", () => {
  let store: SupabaseQualifiedLeadStore;
  let tableReady = false;

  beforeAll(async () => {
    const opened = tryOpenSupabaseQualifiedLeadStore();
    expect(opened).not.toBeNull();
    store = opened!;
    // Probe table existence
    try {
      await store.size();
      tableReady = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/relation|does not exist|Could not find|PGRST/i.test(msg)) {
        console.warn(
          "[m10-production] qualified_leads table missing — apply migration 20260916000000_qualified_leads.sql",
          msg,
        );
        tableReady = false;
      } else {
        throw e;
      }
    }
  });

  afterAll(async () => {
    if (!tableReady) return;
    // Delete only this run's test keys
    const keys = await store.keys();
    for (const k of keys) {
      if (!k.includes(PREFIX)) continue;
      const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
      await getAdmin().from("qualified_leads").delete().eq("lead_key", k);
    }
  });

  it("QualifiedLead → DB → hydrate → semanticEqual + theorem", async () => {
    if (!tableReady) return;
    const entity_id = `${PREFIX}:company:roundtrip`;
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const run = createSearchRun({
      search_run_id: `run_${PREFIX}`,
      conversation_id: `conv_${PREFIX}`,
    });
    const out = await persistQualifiedLead(store, {
      row: hiringRow({ entity_id, key: entity_id }),
      spec,
      run,
      nowMs: NOW,
    });
    if (!out.ok) {
      expect.fail(`persist rejected: ${out.reject_code} — ${out.reason}`);
    }
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = await store.getRecord(leadKeyOf(out.lead));
    expect(rec).not.toBeNull();
    const hydrated = hydrateQualifiedLead(rec!);
    expect(
      semanticEqual(out.lead, {
        ...hydrated,
        persisted_at: out.lead.persisted_at,
        updated_at: out.lead.updated_at,
      }),
    ).toBe(true);
    expect(hydratedLeadStillPassesTheorem(hydrated)).toBe(true);
    expect(hydrated.evidence[0].event_at).toBe(daysAgo(2));
    expect(hydrated.search_run_id).toBe(`run_${PREFIX}`);
  });

  it("idempotent retry does not duplicate", async () => {
    if (!tableReady) return;
    const entity_id = `${PREFIX}:company:idem`;
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const row = hiringRow({ entity_id, key: entity_id });
    const a = await persistQualifiedLead(store, {
      row,
      spec,
      run: createSearchRun({ search_run_id: `run_a_${PREFIX}` }),
      nowMs: NOW,
    });
    const b = await persistQualifiedLead(store, {
      row,
      spec,
      run: createSearchRun({ search_run_id: `run_b_${PREFIX}` }),
      nowMs: NOW + 1000,
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.lead.search_run_id).toBe(a.lead.search_run_id);
      expect(b.lead.evidence).toHaveLength(1);
    }
  });

  it("multiple claims per entity coexist", async () => {
    if (!tableReady) return;
    const entity_id = `${PREFIX}:company:multi`;
    const hireSpec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const fundSpec = extractSearchSpec("recently funded startups in Berlin");
    const h = await persistQualifiedLead(store, {
      row: hiringRow({ entity_id, key: entity_id }),
      spec: hireSpec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    const f = await persistQualifiedLead(store, {
      row: fundingRow(entity_id),
      spec: fundSpec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(h.ok && f.ok).toBe(true);
    expect(await store.getAsQualified(entity_id, "hiring")).not.toBeNull();
    expect(await store.getAsQualified(entity_id, "funding")).not.toBeNull();
  });

  it("re-crawl preserves historical event_at", async () => {
    if (!tableReady) return;
    const entity_id = `${PREFIX}:company:freeze`;
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const event_at = daysAgo(10);
    const first = await persistQualifiedLead(store, {
      row: hiringRow({
        entity_id,
        key: entity_id,
        evidence: [
          {
            source_url: "https://acme.example/jobs/react",
            source_type: "job_posting",
            excerpt: "Hiring senior React developers in Austin",
            observed_at: new Date(NOW).toISOString(),
            evidence_type: "hiring",
            supports: "intent",
            confidence: 0.9,
            subject: entity_id,
            event_at,
            claim_parameters: { technology: "React", role: "developer" },
          },
        ],
      }),
      spec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    if (!first.ok) {
      expect.fail(`first persist rejected: ${first.reject_code} — ${first.reason}`);
    }
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = await persistQualifiedLead(store, {
      row: hiringRow({
        entity_id,
        key: entity_id,
        evidence: [
          {
            source_url: "https://acme.example/jobs/react",
            source_type: "job_posting",
            excerpt: "Hiring senior React developers in Austin (recrawl)",
            observed_at: new Date(NOW + 60_000).toISOString(),
            evidence_type: "hiring",
            supports: "intent",
            confidence: 0.95,
            subject: entity_id,
            event_at: daysAgo(1), // newer observation — must not overwrite historical
            claim_parameters: { technology: "React", role: "developer" },
          },
        ],
      }),
      spec,
      run: createSearchRun(),
      nowMs: NOW + 60_000,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.lead.evidence[0].event_at).toBe(event_at);
  });
});
