/**
 * M8 — Field-level enrichment merge + provenance.
 *
 * Rules:
 * - Never fabricate values
 * - Never silently overwrite a verified/higher-confidence value with a conflict
 * - Website/contact enrichment is identity — never claim laundering
 * - no_website: refuse to attach a random website onto the opportunity
 */
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence, EvidenceType } from "@/lib/search/evidence";
import { makeEvidence } from "@/lib/search/evidence";

export type FieldProvenance = {
  value: string | number | boolean | null;
  source: string;
  source_url: string | null;
  observed_at: string;
  confidence: number;
};

export type EnrichmentFieldPatch = {
  field: string;
  value: string | number | boolean | null;
  source: string;
  source_url?: string | null;
  observed_at?: string;
  confidence?: number;
};

export type EnrichmentClaimPatch = {
  evidence_type: EvidenceType;
  excerpt: string;
  source_url: string;
  source_type?: Evidence["source_type"];
  supports?: Evidence["supports"];
  confidence?: number;
  subject?: string;
  event_at?: string | null;
  extraction_method?: string;
};

export type EnrichmentAdapterResult = {
  fields?: EnrichmentFieldPatch[];
  /** Claim evidence only — never silently converted from identity fields. */
  claims?: EnrichmentClaimPatch[];
  error?: string | null;
  unavailable?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0 && v.trim() !== "?";
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

function readField(row: SpecRow, field: string): unknown {
  const r = row as SpecRow & Record<string, unknown>;
  if (field === "website") return r.website_url ?? r.url;
  if (field === "name") return r.title;
  return r[field];
}

function writeField(row: SpecRow, field: string, value: unknown): SpecRow {
  const v = value as string | number | boolean | null | undefined;
  if (field === "website") {
    const website_url = v == null ? null : String(v);
    return { ...row, website_url, url: row.kind === "job" ? row.apply_url ?? row.url : row.kind === "person" ? row.profile_url ?? website_url : website_url };
  }
  if (field === "url" || field === "apply_or_source_url") {
    const url = v == null ? null : String(v);
    return row.kind === "job" ? { ...row, apply_url: url, url }
      : row.kind === "person" ? { ...row, profile_url: url, url }
      : { ...row, website_url: url, url };
  }
  if (field === "email") return { ...row, email: v == null ? null : String(v) };
  if (field === "phone") return { ...row, phone: v == null ? null : String(v) };
  if (field === "location") return { ...row, location: v == null ? null : String(v) };
  if (field === "salary") {
    return { ...row, salary: v as string | number | null } as SpecRow;
  }
  if (field === "employer") {
    return { ...row, employer: v == null ? null : String(v) } as SpecRow;
  }
  if (field === "associated_company" || field === "role" || field === "domain") {
    return { ...row, [field]: v } as SpecRow;
  }
  // no_website is claim-only — do not write a row field.
  if (field === "no_website") return row;
  return row;
}

/**
 * Identity-only fields: establishing them must not invent claim evidence.
 */
export const IDENTITY_ENRICHMENT_FIELDS = new Set([
  "url",
  "website",
  "email",
  "phone",
  "domain",
  "location",
  "associated_company",
  "name",
  "employer",
]);

export type MergeEnrichmentOptions = {
  /** Fields Spec forbids inventing (e.g. url under no_website). */
  forbidFields?: string[];
  /** Entity id for subject-binding claim patches. */
  entityId?: string | null;
  /**
   * Claim types the Spec actually requested. Claims outside this set from
   * enrichment are dropped (no laundering funding → hiring).
   */
  allowedClaims?: EvidenceType[];
};

export type MergeEnrichmentResult = {
  row: SpecRow;
  applied: string[];
  refused: { field?: string; claim?: string; reason: string }[];
  conflicts: { field: string; existing: unknown; incoming: unknown }[];
};

/**
 * Merge enrichment patches onto a candidate with field-level provenance.
 */
export function mergeEnrichmentIntoRow(
  row: SpecRow,
  patch: EnrichmentAdapterResult,
  opts?: MergeEnrichmentOptions,
): MergeEnrichmentResult {
  const forbid = new Set(opts?.forbidFields ?? []);
  const allowedClaims = opts?.allowedClaims;
  const applied: string[] = [];
  const refused: MergeEnrichmentResult["refused"] = [];
  const conflicts: MergeEnrichmentResult["conflicts"] = [];

  let next: SpecRow = { ...row };
  const provenance: Record<string, FieldProvenance> = {
    ...((row as SpecRow & { field_provenance?: Record<string, FieldProvenance> })
      .field_provenance ?? {}),
  };

  for (const f of patch.fields ?? []) {
    if (forbid.has(f.field) || (f.field === "website" && forbid.has("url"))) {
      refused.push({
        field: f.field,
        reason: "forbidden_by_spec_opportunity",
      });
      continue;
    }
    if (!hasValue(f.value)) {
      refused.push({ field: f.field, reason: "empty_value_not_fabricated" });
      continue;
    }

    const existing = readField(next, f.field);
    if (hasValue(existing)) {
      const same =
        String(existing).trim().toLowerCase() === String(f.value).trim().toLowerCase();
      if (!same) {
        const prevConf = provenance[f.field]?.confidence ?? 0.8;
        const incomingConf = f.confidence ?? 0.5;
        if (incomingConf <= prevConf) {
          conflicts.push({ field: f.field, existing, incoming: f.value });
          refused.push({
            field: f.field,
            reason: "conflict_kept_existing_provenance",
          });
          continue;
        }
        // Higher confidence may replace, but provenance must record the conflict.
        conflicts.push({ field: f.field, existing, incoming: f.value });
      } else {
        // Same value — refresh provenance only if stronger/equal source.
        provenance[f.field] = {
          value: f.value,
          source: f.source,
          source_url: f.source_url ?? null,
          observed_at: f.observed_at ?? nowIso(),
          confidence: Math.max(f.confidence ?? 0.5, provenance[f.field]?.confidence ?? 0),
        };
        applied.push(f.field);
        continue;
      }
    }

    next = writeField(next, f.field, f.value);
    provenance[f.field] = {
      value: f.value,
      source: f.source,
      source_url: f.source_url ?? null,
      observed_at: f.observed_at ?? nowIso(),
      confidence: f.confidence ?? 0.6,
    };
    applied.push(f.field);
  }

  const evidence = [...(next.evidence ?? [])];
  for (const c of patch.claims ?? []) {
    if (allowedClaims && allowedClaims.length && !allowedClaims.includes(c.evidence_type)) {
      refused.push({
        claim: c.evidence_type,
        reason: "claim_not_requested_no_laundering",
      });
      continue;
    }
    // Identity fields must not be re-labeled as claims here — claims arrive typed.
    const subject = c.subject ?? opts?.entityId ?? next.entity_id ?? undefined;
    evidence.push(
      makeEvidence({
        source_url: c.source_url,
        source_type: c.source_type ?? "other",
        excerpt: c.excerpt,
        evidence_type: c.evidence_type,
        supports:
          c.supports ??
          (c.evidence_type === "no_website"
            ? "opportunity"
            : c.evidence_type === "hiring"
              ? "requested_role"
              : c.evidence_type === "service_request"
                ? "requested_service"
                : "intent"),
        confidence: c.confidence ?? 0.7,
        subject,
        event_at: c.event_at,
        extraction_method: c.extraction_method ?? "enrichment",
      }),
    );
    applied.push(`claim:${c.evidence_type}`);
  }

  next = {
    ...next,
    evidence,
    field_provenance: provenance,
  } as SpecRow;

  return { row: next, applied, refused, conflicts };
}

/**
 * Keep a discovered website so qualification can reject the contradicted absence claim.
 */
export function preserveNoWebsiteOpportunity(row: SpecRow, opportunity: string | null): SpecRow {
  if (opportunity !== "no_website") return row;
  // A discovered website contradicts absence. Keep that observation for rejection.
  return { ...row, opportunity: "no_website" };
}
