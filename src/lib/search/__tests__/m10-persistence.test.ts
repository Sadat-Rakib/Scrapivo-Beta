/**
 * M10 — Persistence contract battery.
 *
 * Status target: TESTED (not VERIFIED).
 * Persistence must not qualify; round-trip must preserve M9 proof.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { createSearchRun } from "../search-run";
import {
  canPersistAsQualifiedLead,
  projectQualifiedLead,
  qualifiedLeadKey,
} from "../qualified-lead";
import {
  InMemoryQualifiedLeadStore,
  hydrateQualifiedLead,
  serializeQualifiedLead,
  semanticEqual,
  mergeClaimEvidence,
  hydratedLeadStillPassesTheorem,
  persistQualifiedLead,
  specRowFromQualifiedLead,
} from "../qualified-lead-persist";
import { evaluateQualifiedLeadTheorem } from "../canonical-contract";
import { theoremCandidateFromRow } from "../qualify";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "../evidence";
import type { ClaimEvidence } from "../claim-binding";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString();
}

function yearsAgo(n: number): string {
  return new Date(NOW - n * 365.25 * 86_400_000).toISOString();
}

function hiringRow(partial?: Partial<SpecRow> & { entity_id?: string }): SpecRow {
  const entity_id = partial?.entity_id ?? "company:acme";
  const ev = makeEvidence({
    source_url: "https://acme.example/careers/senior-react",
    source_type: "job",
    excerpt: "Senior React developer — Austin",
    evidence_type: "hiring",
    supports: "requested_role",
    subject: entity_id,
    observed_at: new Date(NOW).toISOString(),
    claim_parameters: {
      role: "developer",
      technology: "React",
      seniority: "senior",
    },
  } as Evidence & { claim_parameters: Record<string, string> });
  return {
    kind: "company",
    title: "Acme",
    detail: "Austin",
    location: "Austin",
    url: "https://acme.example",
    entity_id,
    entity_resolved: true,
    page_type: "company_page",
    identity_confidence: 0.92,
    disposition: "qualified",
    evidence: [ev],
    field_provenance: {
      email: {
        value: "jobs@acme.example",
        source: "contact-harvest",
        source_url: "https://acme.example/contact",
        observed_at: new Date(NOW).toISOString(),
        confidence: 0.8,
      },
    },
    email: "jobs@acme.example",
    ...partial,
  };
}

function fundingRow(args: {
  entity_id?: string;
  event_at: string | null;
  observed_at?: string;
  disposition?: SpecRow["disposition"];
}): SpecRow {
  const entity_id = args.entity_id ?? "company:acme";
  const ev = makeEvidence({
    source_url: "https://techcrunch.example/acme-raises",
    source_type: "news",
    excerpt: "Acme raises Series A in Berlin",
    evidence_type: "funding",
    supports: "intent",
    subject: entity_id,
    observed_at: args.observed_at ?? new Date(NOW).toISOString(),
    event_at: args.event_at,
  });
  return {
    kind: "company",
    title: "Acme",
    detail: "Berlin",
    location: "Berlin",
    url: "https://acme.example",
    entity_id,
    entity_resolved: true,
    page_type: "company_page",
    identity_confidence: 0.9,
    disposition: args.disposition ?? "qualified",
    evidence: [ev],
  };
}

describe("M10 — persistence gate (only qualified enters)", () => {
  const spec = () =>
    extractSearchSpec("companies hiring senior React developers in Austin");

  it("qualified lead may project", async () => {
    const row = hiringRow();
    const r = projectQualifiedLead({ row, spec: spec(), nowMs: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.disposition).toBe("qualified");
      expect(r.lead.entity_id).toBe("company:acme");
      expect(r.lead.evidence[0].claim_type).toBe("hiring");
      expect(r.lead.evidence[0]).not.toHaveProperty("verified");
    }
  });

  it("unresolved candidate cannot persist as qualified", async () => {
    const row = hiringRow({ entity_resolved: false, disposition: "potential_match" });
    const g = canPersistAsQualifiedLead({ row, spec: spec() });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reject_code).toMatch(/UNRESOLVED|NOT_QUALIFIED/);
  });

  it("provisional entity_id rejected", async () => {
    const row = hiringRow({
      entity_id: "provisional:serp:1",
      disposition: "qualified",
    });
    // evidence subject must match for theorem — still provisional gate first
    const g = canPersistAsQualifiedLead({ row, spec: spec() });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reject_code).toBe("PROVISIONAL_ENTITY");
  });

  it("failed theorem candidate cannot persist as qualified", async () => {
    const row = fundingRow({
      event_at: daysAgo(1),
      disposition: "qualified", // stamped wrongly
    });
    // funding claim vs hiring Spec
    const g = canPersistAsQualifiedLead({ row, spec: spec() });
    expect(g.ok).toBe(false);
  });

  it("stale temporal claim never written as qualified", async () => {
    const funded = extractSearchSpec("recently funded startups in Berlin");
    const row = fundingRow({
      event_at: yearsAgo(2),
      observed_at: new Date(NOW).toISOString(),
      disposition: "qualified",
    });
    const store = new InMemoryQualifiedLeadStore();
    const out = await persistQualifiedLead(store, {
      row,
      spec: funded,
      nowMs: NOW,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reject_code).toMatch(/STALE|TEMPORAL|UNVERIFIED/);
    expect(store.size()).toBe(0);
  });

  it("cancelled run cannot incorrectly become delivered state", async () => {
    const row = hiringRow();
    const run = createSearchRun();
    const g = canPersistAsQualifiedLead({
      row,
      spec: spec(),
      run,
      cancelled: true,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reject_code).toBe("CANCELLED_RUN");
  });

  it("stale run id cannot persist when activeRunId differs", async () => {
    const row = hiringRow();
    const run = createSearchRun({ search_run_id: "run_old" });
    const g = canPersistAsQualifiedLead({
      row,
      spec: spec(),
      run,
      activeRunId: "run_new",
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reject_code).toBe("STALE_RUN");
  });
});

describe("M10 — round-trip fidelity", () => {
  it("QualifiedLead → serialize → hydrate → semanticEqual", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const run = createSearchRun({
      search_run_id: "run_m10",
      conversation_id: "conv_m10",
      turn_id: "turn_m10",
      request_id: "req_m10",
    });
    const projected = projectQualifiedLead({
      row: hiringRow(),
      spec,
      run,
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;

    const record = serializeQualifiedLead(projected.lead, NOW);
    const hydrated = hydrateQualifiedLead(record);
    expect(semanticEqual(projected.lead, {
      ...hydrated,
      // serialize stamps persisted_at; compare by clearing bookkeeping asymmetry
      persisted_at: projected.lead.persisted_at,
      updated_at: projected.lead.updated_at,
    })).toBe(true);

    // Proof fields survive
    expect(hydrated.evidence[0].event_at ?? null).toBe(
      projected.lead.evidence[0].event_at ?? null,
    );
    expect(hydrated.evidence[0].observed_at).toBe(
      projected.lead.evidence[0].observed_at,
    );
    expect(hydrated.evidence[0].subject).toBe("company:acme");
    expect(hydrated.evidence[0].claim_parameters?.technology).toBe("React");
    expect(hydrated.field_provenance.email?.value).toBe("jobs@acme.example");
    expect(hydrated.location_id).toBeTruthy();
    expect(hydrated.search_run_id).toBe("run_m10");
    expect(hydrated).not.toHaveProperty("verified");
  });

  it("event_at and observed_at round-trip distinct and unchanged", async () => {
    const funded = extractSearchSpec("recently funded startups in Berlin");
    const event_at = daysAgo(3);
    const observed_at = new Date(NOW).toISOString();
    const row = fundingRow({ event_at, observed_at });
    const projected = projectQualifiedLead({
      row,
      spec: funded,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const again = hydrateQualifiedLead(
      serializeQualifiedLead(projected.lead, NOW + 60_000),
    );
    expect(again.evidence[0].event_at).toBe(event_at);
    expect(again.evidence[0].observed_at).toBe(observed_at);
    expect(again.evidence[0].event_at).not.toBe(again.evidence[0].observed_at);
    expect(again.evidence[0].freshness).toBe("fresh");
  });

  it("hydrate(persist(qualifiedLead)) still passes theorem", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const store = new InMemoryQualifiedLeadStore();
    const out = await persistQualifiedLead(store, {
      row: hiringRow(),
      spec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const got = store.getAsQualified("company:acme", "hiring");
    expect(got).not.toBeNull();
    expect(hydratedLeadStillPassesTheorem(got!)).toBe(true);
    const th = evaluateQualifiedLeadTheorem(
      theoremCandidateFromRow(
        specRowFromQualifiedLead(got!),
        got!.evidence as unknown as Evidence[],
      ),
      spec,
    );
    expect(th.ok).toBe(true);
  });

  it("persist(candidateThatFailsTheorem) → impossible to retrieve as QualifiedLead", async () => {
    const funded = extractSearchSpec("recently funded startups in Berlin");
    const store = new InMemoryQualifiedLeadStore();
    const bad = fundingRow({
      event_at: yearsAgo(2),
      disposition: "qualified",
    });
    const out = await persistQualifiedLead(store, {
      row: bad,
      spec: funded,
      nowMs: NOW,
    });
    expect(out.ok).toBe(false);
    expect(store.getAsQualified("company:acme", "funding")).toBeNull();
    expect(store.listQualified()).toHaveLength(0);
  });
});

describe("M10 — dedup, claims, re-crawl", () => {
  let store: InMemoryQualifiedLeadStore;

  beforeEach(() => {
    store = new InMemoryQualifiedLeadStore();
  });

  it("same entity + same evidence → dedup / idempotent", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const run = createSearchRun({ search_run_id: "run_a" });
    const row = hiringRow();
    const a = await persistQualifiedLead(store, { row, spec, run, nowMs: NOW });
    const b = await persistQualifiedLead(store, {
      row,
      spec,
      run,
      nowMs: NOW + 1000,
    });
    expect(a.ok && b.ok).toBe(true);
    expect(store.size()).toBe(1);
    if (a.ok && b.ok) {
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.lead.qualified_at).toBe(a.lead.qualified_at);
    }
  });

  it("same entity + different legitimate claim → don't destroy either", async () => {
    const hiring = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const funded = extractSearchSpec("recently funded startups in Berlin");
    const entity_id = "company:acme";

    const h = await persistQualifiedLead(store, {
      row: hiringRow({ entity_id, location: "Austin" }),
      spec: hiring,
      run: createSearchRun({ search_run_id: "run_h" }),
      nowMs: NOW,
    });
    const f = await persistQualifiedLead(store, {
      row: fundingRow({
        entity_id,
        event_at: daysAgo(2),
      }),
      spec: funded,
      run: createSearchRun({ search_run_id: "run_f" }),
      nowMs: NOW,
    });
    expect(h.ok && f.ok).toBe(true);
    expect(store.size()).toBe(2);
    expect(store.getAsQualified(entity_id, "hiring")).not.toBeNull();
    expect(store.getAsQualified(entity_id, "funding")).not.toBeNull();
    expect(qualifiedLeadKey(entity_id, "hiring")).not.toBe(
      qualifiedLeadKey(entity_id, "funding"),
    );
  });

  it("re-crawl preserves historical event_at", async () => {
    const funded = extractSearchSpec("recently funded startups in Berlin");
    const entity_id = "company:acme";
    const event_at = daysAgo(5);
    const first = fundingRow({
      entity_id,
      event_at,
      observed_at: daysAgo(4),
    });
    const a = await persistQualifiedLead(store, {
      row: first,
      spec: funded,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    // Re-crawl offers a convenient "today" event_at — merge must freeze history.
    const mergedEv = mergeClaimEvidence(a.lead.evidence, [
      {
        subject: entity_id,
        claim: "Acme raises Series A in Berlin",
        claim_type: "funding",
        evidence_url: "https://techcrunch.example/acme-raises",
        evidence_text: "Acme raises Series A in Berlin",
        observed_at: new Date(NOW).toISOString(),
        event_at: new Date(NOW).toISOString(),
        confidence: 0.8,
        freshness: "fresh",
      },
    ]);
    expect(mergedEv[0].event_at).toBe(event_at);
    expect(mergedEv[0].observed_at).toBe(new Date(NOW).toISOString());

    // Store upsert with merged evidence still retrieves May/historical event_at
    const updated: typeof a.lead = {
      ...a.lead,
      evidence: mergedEv,
      updated_at: new Date(NOW).toISOString(),
    };
    const saved = store.persist(updated, NOW);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.lead.evidence[0].event_at).toBe(event_at);
  });

  it("conflicting evidence → no silent destructive overwrite (both retained or event frozen)", async () => {
    const a: ClaimEvidence = {
      subject: "company:acme",
      claim: "funded",
      claim_type: "funding",
      evidence_url: "https://news.example/a",
      evidence_text: "funded",
      observed_at: "2024-01-01T00:00:00.000Z",
      event_at: "2023-06-01T00:00:00.000Z",
      confidence: 0.8,
    };
    const b: ClaimEvidence = {
      ...a,
      observed_at: "2026-09-15T00:00:00.000Z",
      event_at: "2026-09-14T00:00:00.000Z",
    };
    const merged = mergeClaimEvidence([a], [b]);
    expect(merged.some((e) => e.event_at === "2023-06-01T00:00:00.000Z")).toBe(
      true,
    );
    // Must not silently replace with the convenient September date alone
    expect(merged.every((e) => e.event_at === "2026-09-14T00:00:00.000Z")).toBe(
      false,
    );
  });

  it("persistence retry → no duplicate qualified lead", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const row = hiringRow();
    const run = createSearchRun();
    for (let i = 0; i < 5; i++) {
      const out = await persistQualifiedLead(store, {
        row,
        spec,
        run,
        nowMs: NOW + i,
      });
      expect(out.ok).toBe(true);
    }
    expect(store.size()).toBe(1);
    expect(store.listQualified()).toHaveLength(1);
  });

  it("GeoEntity hierarchy/scope preserved on round trip", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    expect(spec.criteria.some((c) => c.field === "location_id")).toBe(true);
    const projected = projectQualifiedLead({
      row: hiringRow(),
      spec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const h = hydrateQualifiedLead(serializeQualifiedLead(projected.lead, NOW));
    expect(h.location_id).toBe(projected.lead.location_id);
    expect(h.location_scope).toBe(projected.lead.location_scope);
    expect(h.location_parents).toBe(projected.lead.location_parents);
    expect(h.location_country).toBe(projected.lead.location_country);
  });

  it("subject binding + claim parameters + freshness preserved", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const out = await persistQualifiedLead(store, {
      row: hiringRow(),
      spec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const e = out.lead.evidence[0];
    expect(e.subject).toBe("company:acme");
    expect(e.claim_parameters?.seniority).toBe("senior");
    expect(e.claim_parameters?.technology).toBe("React");
    expect(e.evidence_url).toContain("acme.example");
  });
});
