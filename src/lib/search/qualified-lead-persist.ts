/**
 * M10 — Persistence projection for QualifiedLead.
 *
 * Boundary: qualify() → QualifiedLead → serialize → store → hydrate → QualifiedLead
 * Persistence never qualifies. Round-trip preserves proof semantics.
 *
 * Smallest representation: structured JSON record + in-memory store.
 * Schema elegance is not the milestone — lossless fidelity is.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "@/lib/search/evidence";
import {
  evaluateQualifiedLeadTheorem,
} from "@/lib/search/canonical-contract";
import { theoremCandidateFromRow } from "@/lib/search/qualify";
import { mergeEvidencePreservingEventAt } from "@/lib/search/verification";
import { asClaimEvidence, type ClaimEvidence } from "@/lib/search/claim-binding";
import {
  canPersistAsQualifiedLead,
  leadKeyOf,
  projectQualifiedLead,
  qualifiedLeadKey,
  type PersistRejectCode,
  type QualifiedLead,
} from "@/lib/search/qualified-lead";
import type { SearchRunIds } from "@/lib/search/search-run";

/** Wire / DB JSON shape — no derived verified:true. */
export interface QualifiedLeadRecord {
  entity_id: string;
  entity_type: string;
  name: string;
  claim_type: string;
  disposition: "qualified";
  relevance_score: number;
  intent_score: number;
  why_match: string | null;
  spec: SearchSpec;
  search_run_id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  location: string | null;
  location_id: string | null;
  location_scope: string | null;
  location_parents: string | null;
  location_kind: string | null;
  location_country: string | null;
  fields: Record<string, string | number | boolean | null | undefined>;
  field_provenance: QualifiedLead["field_provenance"];
  evidence: ClaimEvidence[];
  identity_confidence: number;
  resolution_method: string | null;
  page_type: string | null;
  source_url: string | null;
  qualified_at: string;
  persisted_at: string;
  updated_at: string;
}

export type PersistOutcome =
  | { ok: true; key: string; lead: QualifiedLead; created: boolean }
  | { ok: false; reject_code: PersistRejectCode; reason: string };

function nowIso(nowMs?: number): string {
  return new Date(nowMs ?? Date.now()).toISOString();
}

/** Evidence identity for merge/dedup (not presentation text). */
function evidenceIdentity(e: ClaimEvidence): string {
  return [
    e.subject,
    e.claim_type,
    (e.evidence_url ?? "").trim(),
    e.event_at?.trim() || "",
  ].join("|");
}

/**
 * Merge incoming evidence into existing without rewriting historical event_at
 * or silently dropping conflicting observations.
 */
export function mergeClaimEvidence(
  existing: ClaimEvidence[],
  incoming: ClaimEvidence[],
): ClaimEvidence[] {
  const out = [...existing];
  const index = new Map(out.map((e, i) => [evidenceIdentity(e), i]));

  for (const raw of incoming) {
    const id = evidenceIdentity(raw);
    const prevIdx = index.get(id);
    if (prevIdx == null) {
      // Same URL+type+subject but different event_at → keep both (no silent drop).
      const sameUrl = out.findIndex(
        (e) =>
          e.subject === raw.subject &&
          e.claim_type === raw.claim_type &&
          (e.evidence_url ?? "").trim() === (raw.evidence_url ?? "").trim(),
      );
      if (sameUrl >= 0) {
        const prev = out[sameUrl];
        const asEv = (c: ClaimEvidence): Evidence => ({
          source_url: c.evidence_url,
          source_type: (c.evidence_source as Evidence["source_type"]) ?? "other",
          excerpt: c.evidence_text,
          observed_at: c.observed_at,
          evidence_type: c.claim_type,
          supports: "intent",
          confidence: c.confidence,
          subject: c.subject,
          event_at: c.event_at ?? null,
        });
        const merged = mergeEvidencePreservingEventAt(asEv(prev), asEv(raw));
        const claim = asClaimEvidence(merged, raw.subject);
        if (claim) {
          // Preserve prior freshness/parameters when merge kept event_at.
          out[sameUrl] = {
            ...claim,
            claim_parameters: claim.claim_parameters ?? prev.claim_parameters,
            freshness:
              claim.event_at === prev.event_at
                ? prev.freshness ?? claim.freshness
                : claim.freshness,
          };
        }
        continue;
      }
      index.set(id, out.length);
      out.push(raw);
      continue;
    }
    // Exact identity hit → refresh observed_at only via merge helper.
    const prev = out[prevIdx];
    const asEv = (c: ClaimEvidence): Evidence => ({
      source_url: c.evidence_url,
      source_type: (c.evidence_source as Evidence["source_type"]) ?? "other",
      excerpt: c.evidence_text,
      observed_at: c.observed_at,
      evidence_type: c.claim_type,
      supports: "intent",
      confidence: c.confidence,
      subject: c.subject,
      event_at: c.event_at ?? null,
    });
    const merged = mergeEvidencePreservingEventAt(asEv(prev), asEv(raw));
    const claim = asClaimEvidence(merged, raw.subject);
    if (claim) {
      out[prevIdx] = {
        ...claim,
        claim_parameters: prev.claim_parameters ?? claim.claim_parameters,
        freshness: prev.freshness ?? claim.freshness,
      };
    }
  }
  return out;
}

/** Serialize to a JSON-safe persistence record. */
export function serializeQualifiedLead(
  lead: QualifiedLead,
  nowMs?: number,
): QualifiedLeadRecord {
  const at = nowIso(nowMs);
  return {
    entity_id: lead.entity_id,
    entity_type: lead.entity_type,
    name: lead.name,
    claim_type: lead.claim_type,
    disposition: "qualified",
    relevance_score: lead.relevance_score,
    intent_score: lead.intent_score,
    why_match: lead.why_match,
    spec: structuredClone(lead.spec),
    search_run_id: lead.search_run_id,
    conversation_id: lead.conversation_id,
    turn_id: lead.turn_id,
    request_id: lead.request_id,
    location: lead.location,
    location_id: lead.location_id,
    location_scope: lead.location_scope,
    location_parents: lead.location_parents,
    location_kind: lead.location_kind,
    location_country: lead.location_country,
    fields: { ...lead.fields },
    field_provenance: structuredClone(lead.field_provenance),
    evidence: lead.evidence.map((e) => ({ ...e, claim_parameters: e.claim_parameters
      ? { ...e.claim_parameters }
      : undefined })),
    identity_confidence: lead.identity_confidence,
    resolution_method: lead.resolution_method,
    page_type: lead.page_type,
    source_url: lead.source_url,
    qualified_at: lead.qualified_at,
    persisted_at: lead.persisted_at ?? at,
    updated_at: at,
  };
}

/** Hydrate a record back into a QualifiedLead. Does not re-qualify. */
export function hydrateQualifiedLead(record: QualifiedLeadRecord): QualifiedLead {
  return {
    entity_id: record.entity_id,
    entity_type: record.entity_type,
    name: record.name,
    claim_type: record.claim_type as ClaimEvidence["claim_type"],
    disposition: "qualified",
    relevance_score: record.relevance_score,
    intent_score: record.intent_score,
    why_match: record.why_match,
    spec: structuredClone(record.spec),
    search_run_id: record.search_run_id,
    conversation_id: record.conversation_id,
    turn_id: record.turn_id,
    request_id: record.request_id,
    location: record.location,
    location_id: record.location_id,
    location_scope: record.location_scope,
    location_parents: record.location_parents,
    location_kind: record.location_kind,
    location_country: record.location_country,
    fields: { ...record.fields },
    field_provenance: structuredClone(record.field_provenance),
    evidence: record.evidence.map((e) => ({
      ...e,
      claim_parameters: e.claim_parameters ? { ...e.claim_parameters } : undefined,
    })),
    identity_confidence: record.identity_confidence,
    resolution_method: record.resolution_method,
    page_type: record.page_type,
    source_url: record.source_url,
    qualified_at: record.qualified_at,
    persisted_at: record.persisted_at,
    updated_at: record.updated_at,
  };
}

function stableJson(v: unknown): string {
  return JSON.stringify(v, (_, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return val;
  });
}

/**
 * Qualification-relevant semantic equality.
 * Ignores persisted_at / updated_at (store bookkeeping).
 * Never treats a boolean "verified" as a substitute for proof.
 */
export function semanticEqual(a: QualifiedLead, b: QualifiedLead): boolean {
  if (a.entity_id !== b.entity_id) return false;
  if (a.entity_type !== b.entity_type) return false;
  if (a.name !== b.name) return false;
  if (a.claim_type !== b.claim_type) return false;
  if (a.disposition !== b.disposition) return false;
  if (a.search_run_id !== b.search_run_id) return false;
  if (a.conversation_id !== b.conversation_id) return false;
  if (a.turn_id !== b.turn_id) return false;
  if (a.request_id !== b.request_id) return false;
  if (a.location !== b.location) return false;
  if (a.location_id !== b.location_id) return false;
  if (a.location_scope !== b.location_scope) return false;
  if (a.location_parents !== b.location_parents) return false;
  if (a.location_kind !== b.location_kind) return false;
  if (a.location_country !== b.location_country) return false;
  if (a.identity_confidence !== b.identity_confidence) return false;
  if (a.resolution_method !== b.resolution_method) return false;
  if (a.page_type !== b.page_type) return false;
  if (a.source_url !== b.source_url) return false;
  if (a.qualified_at !== b.qualified_at) return false;
  if (a.why_match !== b.why_match) return false;
  if (Math.abs(a.relevance_score - b.relevance_score) > 1e-9) return false;
  if (Math.abs(a.intent_score - b.intent_score) > 1e-9) return false;
  if (stableJson(a.spec) !== stableJson(b.spec)) return false;
  if (stableJson(a.fields) !== stableJson(b.fields)) return false;
  if (stableJson(a.field_provenance) !== stableJson(b.field_provenance)) return false;
  if (stableJson(a.evidence) !== stableJson(b.evidence)) return false;
  return true;
}

/** Reconstruct a SpecRow sufficient for theorem re-check from a lead. */
export function specRowFromQualifiedLead(lead: QualifiedLead): SpecRow {
  const evidence: Evidence[] = lead.evidence.map((c) => ({
    source_url: c.evidence_url,
    source_type: (c.evidence_source as Evidence["source_type"]) ?? "other",
    excerpt: c.evidence_text,
    observed_at: c.observed_at,
    evidence_type: c.claim_type,
    supports: "intent",
    confidence: c.confidence,
    subject: c.subject,
    event_at: c.event_at ?? null,
    claim_parameters: c.claim_parameters,
  })) as Evidence[];

  return {
    kind: lead.entity_type as SpecRow["kind"],
    title: lead.name,
    detail: "",
    location: lead.location,
    url: lead.source_url,
    email: (lead.fields.email as string | null) ?? null,
    phone: (lead.fields.phone as string | null) ?? null,
    category: (lead.fields.category as string | null) ?? null,
    industry: (lead.fields.industry as string | null) ?? null,
    entity_id: lead.entity_id,
    entity_resolved: true,
    page_type: lead.page_type as SpecRow["page_type"],
    identity_confidence: lead.identity_confidence,
    disposition: "qualified",
    evidence,
    salary: lead.fields.salary as string | number | null | undefined,
    employer: lead.fields.employer as string | null | undefined,
    field_provenance: lead.field_provenance,
  } as SpecRow;
}

/**
 * After hydrate: does this lead still satisfy the theorem for its Spec?
 * Persistence must not weaken this — a stored lead that no longer proves
 * itself must not be delivered as QualifiedLead.
 */
export function hydratedLeadStillPassesTheorem(lead: QualifiedLead): boolean {
  const row = specRowFromQualifiedLead(lead);
  const theorem = evaluateQualifiedLeadTheorem(
    theoremCandidateFromRow(row, row.evidence as Evidence[]),
    lead.spec,
  );
  return theorem.ok;
}

/**
 * In-memory QualifiedLead store — contract seam for tests and the production adapter.
 * Keys by entity_id::claim_type. Evidence merges; historical event_at is frozen.
 *
 * Production: {@link SupabaseQualifiedLeadStore} implements the same
 * {@link QualifiedLeadStore} interface without changing merge/theorem rules.
 */
export interface QualifiedLeadStore {
  persist(lead: QualifiedLead, nowMs?: number): PersistOutcome | Promise<PersistOutcome>;
  persistFromRow(args: {
    row: SpecRow;
    spec: SearchSpec;
    run?: Partial<SearchRunIds> | null;
    activeRunId?: string | null;
    cancelled?: boolean;
    nowMs?: number;
  }): PersistOutcome | Promise<PersistOutcome>;
  getRecord(key: string): QualifiedLeadRecord | null | Promise<QualifiedLeadRecord | null>;
  get(
    entityId: string,
    claimType: string,
  ): QualifiedLead | null | Promise<QualifiedLead | null>;
  getAsQualified(
    entityId: string,
    claimType: string,
  ): QualifiedLead | null | Promise<QualifiedLead | null>;
  keys(): string[] | Promise<string[]>;
  listQualified(): QualifiedLead[] | Promise<QualifiedLead[]>;
  clear(): void | Promise<void>;
  size(): number | Promise<number>;
}

/** Shared upsert body — used by InMemory and production adapters. */
export function upsertQualifiedLeadAgainstExisting(
  existing: QualifiedLeadRecord | null,
  lead: QualifiedLead,
  nowMs?: number,
): PersistOutcome & { record?: QualifiedLeadRecord } {
  const row = specRowFromQualifiedLead(lead);
  const gate = canPersistAsQualifiedLead({
    row,
    spec: lead.spec,
    run: {
      search_run_id: lead.search_run_id,
      conversation_id: lead.conversation_id,
      turn_id: lead.turn_id,
      request_id: lead.request_id,
    },
    nowMs,
  });
  if (!gate.ok) return gate;

  const key = leadKeyOf(lead);
  const at = nowIso(nowMs);

  if (!existing) {
    const record = serializeQualifiedLead(lead, nowMs);
    return {
      ok: true,
      key,
      lead: hydrateQualifiedLead(record),
      created: true,
      record,
    };
  }

  const prev = hydrateQualifiedLead(existing);
  const mergedEvidence = mergeClaimEvidence(prev.evidence, lead.evidence);
  const merged: QualifiedLead = {
    ...prev,
    name: lead.name || prev.name,
    why_match: lead.why_match ?? prev.why_match,
    relevance_score: lead.relevance_score,
    intent_score: lead.intent_score,
    fields: { ...prev.fields, ...lead.fields },
    field_provenance: { ...prev.field_provenance, ...lead.field_provenance },
    evidence: mergedEvidence,
    identity_confidence: Math.max(
      prev.identity_confidence,
      lead.identity_confidence,
    ),
    search_run_id: prev.search_run_id || lead.search_run_id,
    conversation_id: prev.conversation_id || lead.conversation_id,
    turn_id: prev.turn_id || lead.turn_id,
    request_id: lead.request_id || prev.request_id,
    qualified_at: prev.qualified_at,
    persisted_at: existing.persisted_at,
    updated_at: at,
    location: lead.location ?? prev.location,
    location_id: lead.location_id ?? prev.location_id,
    location_scope: lead.location_scope ?? prev.location_scope,
    location_parents: lead.location_parents ?? prev.location_parents,
    location_kind: lead.location_kind ?? prev.location_kind,
    location_country: lead.location_country ?? prev.location_country,
    source_url: lead.source_url ?? prev.source_url,
    resolution_method: lead.resolution_method ?? prev.resolution_method,
    page_type: lead.page_type ?? prev.page_type,
    spec: lead.spec,
  };

  if (!hydratedLeadStillPassesTheorem(merged)) {
    return {
      ok: false,
      reject_code: "THEOREM_FAILED",
      reason: "merged evidence no longer satisfies theorem — refuse write",
    };
  }

  const record = serializeQualifiedLead(merged, nowMs);
  record.persisted_at = existing.persisted_at;
  record.qualified_at = existing.qualified_at;
  record.updated_at = at;
  return {
    ok: true,
    key,
    lead: hydrateQualifiedLead(record),
    created: false,
    record,
  };
}

export class InMemoryQualifiedLeadStore implements QualifiedLeadStore {
  private records = new Map<string, QualifiedLeadRecord>();

  clear(): void {
    this.records.clear();
  }

  size(): number {
    return this.records.size;
  }

  /**
   * Persist only when the gate admits. Never writes a failing theorem as qualified.
   */
  persistFromRow(args: {
    row: SpecRow;
    spec: SearchSpec;
    run?: Partial<SearchRunIds> | null;
    activeRunId?: string | null;
    cancelled?: boolean;
    nowMs?: number;
  }): PersistOutcome {
    const projected = projectQualifiedLead(args);
    if (!projected.ok) return projected;
    return this.persist(projected.lead, args.nowMs);
  }

  persist(lead: QualifiedLead, nowMs?: number): PersistOutcome {
    const key = leadKeyOf(lead);
    const existing = this.records.get(key) ?? null;
    const out = upsertQualifiedLeadAgainstExisting(existing, lead, nowMs);
    if (!out.ok || !out.record) return out;
    this.records.set(key, out.record);
    return { ok: true, key: out.key, lead: out.lead, created: out.created };
  }

  /** Raw hydrate — no theorem check (for fidelity tests). */
  getRecord(key: string): QualifiedLeadRecord | null {
    return this.records.get(key) ?? null;
  }

  get(entityId: string, claimType: string): QualifiedLead | null {
    const rec = this.records.get(qualifiedLeadKey(entityId, claimType));
    return rec ? hydrateQualifiedLead(rec) : null;
  }

  /**
   * Retrieve only if still theorem-qualified.
   * Failures are impossible to surface as QualifiedLead.
   */
  getAsQualified(entityId: string, claimType: string): QualifiedLead | null {
    const lead = this.get(entityId, claimType);
    if (!lead) return null;
    if (!hydratedLeadStillPassesTheorem(lead)) return null;
    return lead;
  }

  /** All keys currently stored (including any that would fail re-theorem). */
  keys(): string[] {
    return [...this.records.keys()];
  }

  /** Only leads that still pass the theorem. */
  listQualified(): QualifiedLead[] {
    const out: QualifiedLead[] = [];
    for (const rec of this.records.values()) {
      const lead = hydrateQualifiedLead(rec);
      if (hydratedLeadStillPassesTheorem(lead)) out.push(lead);
    }
    return out;
  }
}

/** Convenience: project + persist in one call (sync or async store). */
export async function persistQualifiedLead(
  store: QualifiedLeadStore,
  args: {
    row: SpecRow;
    spec: SearchSpec;
    run?: Partial<SearchRunIds> | null;
    activeRunId?: string | null;
    cancelled?: boolean;
    nowMs?: number;
  },
): Promise<PersistOutcome> {
  return await store.persistFromRow(args);
}
