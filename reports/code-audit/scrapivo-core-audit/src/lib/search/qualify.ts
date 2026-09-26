/**
 * Lead qualification — enforces the QualifiedLead theorem.
 *
 * Milestone 1: make it impossible for invalid leads to pass.
 * Prefer 0 correct QualifiedLeads over N false/incomplete.
 *
 * @see reports/universal-audit/11-canonical-contract.md
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import {
  hasQualifyingEvidence,
  whyMatchFromEvidence,
  type Evidence,
} from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import {
  evaluateQualifiedLeadTheorem,
  mintProvisionalEntityId,
  type PageType,
  type QualificationRejectCode,
  type TheoremCandidate,
} from "@/lib/search/canonical-contract";
import { locationSatisfies } from "@/lib/search/location-resolver";
import { evaluatePersonGates } from "@/lib/search/person-qualify";
import { evaluateJobGates } from "@/lib/search/job-qualify";
import { evaluateSocialGates } from "@/lib/search/social-qualify";

export type LeadDisposition = "qualified" | "potential_match" | "dropped";

export interface Qualification {
  disposition: LeadDisposition;
  relevance_score: number;
  intent_score: number;
  why_match: string | null;
  label?: string;
  reject_code?: QualificationRejectCode;
}

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

/**
 * Request↔entity fit (not buying intensity).
 * Heuristic, deterministic, no LLM.
 */
export function scoreRelevance(row: SpecRow, spec: SearchSpec): number {
  let score = 0.4;
  const loc = fieldOf(spec, "location");
  const cat = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
  const role = fieldOf(spec, "role");
  const model = fieldOf(spec, "business_model");
  const hay = `${row.title ?? ""} ${row.detail ?? ""} ${row.location ?? ""} ${row.category ?? ""} ${row.industry ?? ""}`.toLowerCase();

  if (loc && locationSatisfies(row.location, loc)) {
    score += 0.25;
  }
  if (cat) {
    const c = cat.toLowerCase();
    if (
      hay.includes(c) ||
      row.category?.toLowerCase().includes(c) ||
      row.industry?.toLowerCase().includes(c)
    ) {
      score += 0.2;
    }
  }
  if (role && hay.includes(role.toLowerCase())) score += 0.1;
  if (model && hay.includes(model.toLowerCase())) score += 0.05;
  if (row.kind === spec.entity) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

/** Seeking intensity from evidence (0 when none). */
export function scoreIntent(evidence: Evidence[] | null | undefined): number {
  if (!hasQualifyingEvidence(evidence)) return 0;
  const types = new Set((evidence ?? []).map((e) => e.evidence_type));
  let s = 0.5;
  if (types.has("hiring") || types.has("social_ask")) s += 0.3;
  if (types.has("service_request") || types.has("funding")) s += 0.2;
  if (types.has("no_website")) s += 0.15;
  return Math.max(0, Math.min(1, s));
}

type SpecRowContract = SpecRow & {
  entity_id?: string | null;
  entity_resolved?: boolean | null;
  page_type?: PageType | null;
  identity_confidence?: number | null;
  salary?: string | number | null;
  employer?: string | null;
};

/** Map a SpecRow into the theorem candidate shape. */
export function theoremCandidateFromRow(
  row: SpecRow,
  evidence: Evidence[] | null | undefined,
): TheoremCandidate {
  const r = row as SpecRowContract;
  const entity_id =
    r.entity_id?.trim() ||
    (r.key?.trim() ? r.key.trim() : null) ||
    (r.url?.trim() ? `url:${r.url.trim()}` : null) ||
    mintProvisionalEntityId(`${r.kind}:${r.title}`);

  return {
    entity_id,
    entity_resolved: r.entity_resolved === true,
    entity_resolution: r.entity_resolved === true ? "resolved" : "unresolved",
    entity_type: r.kind,
    name: r.title,
    source_url: r.url ?? null,
    identity_confidence: r.identity_confidence ?? null,
    page_type: r.page_type ?? "unknown",
    fields: {
      location: r.location ?? null,
      country: r.country ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      salary: r.salary ?? null,
      employer: r.employer ?? (r.kind === "job" ? null : r.detail) ?? null,
      company: r.detail ?? null,
      apply_url: r.url ?? null,
    },
    evidence: evidence ?? r.evidence ?? [],
  };
}

export function qualifyLead(
  row: SpecRow,
  spec: SearchSpec,
  evidence: Evidence[] | null | undefined,
): Qualification {
  const relevance_score = scoreRelevance(row, spec);
  const intent_score = scoreIntent(evidence);
  const fromEvidence = whyMatchFromEvidence(evidence);
  const ev = evidence ?? row.evidence ?? [];
  if (fieldOf(spec, "opportunity") === "no_website" && row.url && (row.kind === "business" || row.kind === "company")) return {
    disposition: "dropped", relevance_score, intent_score, why_match: null,
    reject_code: "CLAIM_PARAMETER_MISMATCH", label: "Observed website contradicts the requested website absence",
  };
  if (fieldOf(spec, "opportunity") === "no_website" &&
      !ev.some((item) => item.evidence_type === "no_website" &&
        item.subject === row.entity_id && item.source_url && item.excerpt)) return {
    disposition: "potential_match", relevance_score, intent_score, why_match: null,
    reject_code: "NO_CLAIM_EVIDENCE", label: "Website absence has not been verified for this business",
  };
  const topics = (fieldOf(spec, "content_topic") ?? "").split(/\s+or\s+|\|/i).map((topic) => topic.trim().toLowerCase()).filter(Boolean);
  const topicEvidence = topics.length ? ev.find((item) =>
    item.subject === row.entity_id && !!item.source_url && !!item.observed_at &&
    item.extraction_method === "browser_observed_subject_topic" &&
    topics.some((topic) => item.excerpt?.toLowerCase().includes(topic)),
  ) : undefined;
  if (topics.length && !topicEvidence) return {
    disposition: "potential_match", relevance_score, intent_score, why_match: null,
    reject_code: "NO_CLAIM_EVIDENCE", label: "No observed discussion of the requested topic bound to this person",
  };
  const theorem = evaluateQualifiedLeadTheorem(
    theoremCandidateFromRow(row, ev),
    spec,
  );

  if (theorem.ok) {
    // M12: person Specs need employment/currentness/need-binding gates.
    if (spec.entity === "person") {
      const personGate = evaluatePersonGates({
        row,
        spec,
        evidence: ev as Evidence[],
      });
      if (!personGate.ok) {
        const soft =
          personGate.reject_code === "EMPLOYMENT_UNPROVEN" ||
          personGate.reject_code === "CURRENTNESS_MISMATCH" ||
          personGate.reject_code === "CLAIM_NOT_SUBJECT_BOUND" ||
          personGate.reject_code === "CLAIM_PARAMETER_MISMATCH" ||
          personGate.reject_code === "NO_CLAIM_EVIDENCE" ||
          personGate.reject_code === "ASSOCIATED_COMPANY_UNRESOLVED" ||
          personGate.reject_code === "IDENTITY_AMBIGUOUS" ||
          personGate.reject_code === "ENTITY_UNRESOLVED" ||
          personGate.reject_code === "PROVISIONAL_ENTITY";
        return {
          disposition: soft ? "potential_match" : "dropped",
          relevance_score,
          intent_score,
          why_match: null,
          label: `${personGate.reject_code} — ${personGate.reason}`,
          reject_code: personGate.reject_code,
        };
      }
    }
    // M13: job Specs need employer binding + posting currentness.
    if (spec.entity === "job") {
      const jobGate = evaluateJobGates({
        row,
        spec,
        evidence: ev as Evidence[],
      });
      if (!jobGate.ok) {
        const soft =
          jobGate.reject_code === "EMPLOYMENT_UNPROVEN" ||
          jobGate.reject_code === "CURRENTNESS_MISMATCH" ||
          jobGate.reject_code === "CLAIM_NOT_SUBJECT_BOUND" ||
          jobGate.reject_code === "CLAIM_PARAMETER_MISMATCH" ||
          jobGate.reject_code === "ASSOCIATED_COMPANY_UNRESOLVED" ||
          jobGate.reject_code === "IDENTITY_AMBIGUOUS" ||
          jobGate.reject_code === "ENTITY_UNRESOLVED" ||
          jobGate.reject_code === "PROVISIONAL_ENTITY" ||
          jobGate.reject_code === "LIST_PAGE_AS_ENTITY" ||
          jobGate.reject_code === "MISSING_QUERY_REQUIRED";
        return {
          disposition: soft ? "potential_match" : "dropped",
          relevance_score,
          intent_score,
          why_match: null,
          label: `${jobGate.reject_code} — ${jobGate.reason}`,
          reject_code: jobGate.reject_code,
        };
      }
    }
    // M14: social posts — POST≠AUTHOR≠COMPANY; platform≠real person; subreddit≠location.
    {
      const socialGate = evaluateSocialGates({
        row,
        spec,
        evidence: ev as Evidence[],
      });
      if (!socialGate.ok) {
        const soft =
          socialGate.reject_code === "CLAIM_NOT_SUBJECT_BOUND" ||
          socialGate.reject_code === "CLAIM_TYPE_MISMATCH" ||
          socialGate.reject_code === "MISSING_QUERY_REQUIRED" ||
          socialGate.reject_code === "LOCATION_MISMATCH" ||
          socialGate.reject_code === "PROVISIONAL_ENTITY" ||
          socialGate.reject_code === "ENTITY_UNRESOLVED" ||
          socialGate.reject_code === "ENTITY_TYPE_MISMATCH" ||
          socialGate.reject_code === "SOURCE_IS_LEAD" ||
          socialGate.reject_code === "NO_CLAIM_EVIDENCE";
        return {
          disposition: soft ? "potential_match" : "dropped",
          relevance_score,
          intent_score,
          why_match: null,
          label: `${socialGate.reject_code} — ${socialGate.reason}`,
          reject_code: socialGate.reject_code,
        };
      }
    }
    return {
      disposition: "qualified",
      relevance_score,
      intent_score,
      why_match: spec.signal_required
        ? fromEvidence
        : (topicEvidence?.excerpt ?? fromEvidence ?? row.why_match ?? null),
    };
  }

  // Directory contamination / theorem failure: not a qualified lead.
  const soft =
    theorem.reject_code === "NO_CLAIM_EVIDENCE" ||
    theorem.reject_code === "CLAIM_TYPE_MISMATCH" ||
    theorem.reject_code === "CLAIM_PARAMETER_MISMATCH" ||
    theorem.reject_code === "CLAIM_NOT_SUBJECT_BOUND" ||
    theorem.reject_code === "MISSING_QUERY_REQUIRED" ||
    theorem.reject_code === "SALARY_BELOW_THRESHOLD" ||
    theorem.reject_code === "TEMPORAL_STALE" ||
    theorem.reject_code === "TEMPORAL_UNKNOWN" ||
    theorem.reject_code === "PROVENANCE_INCOMPLETE" ||
    theorem.reject_code === "CURRENTNESS_MISMATCH" ||
    theorem.reject_code === "EMPLOYMENT_UNPROVEN" ||
    theorem.reject_code === "IDENTITY_AMBIGUOUS" ||
    theorem.reject_code === "ASSOCIATED_COMPANY_UNRESOLVED" ||
    theorem.reject_code === "PROVISIONAL_ENTITY" ||
    theorem.reject_code === "ENTITY_UNRESOLVED";

  return {
    disposition: soft ? "potential_match" : "dropped",
    relevance_score,
    intent_score,
    why_match: null,
    label: `${theorem.reject_code ?? "rejected"} — ${theorem.reason ?? "theorem"}`,
    reject_code: theorem.reject_code,
  };
}

/**
 * Apply qualification to a page of rows.
 * Default: potential_match / dropped are excluded from the qualified grid.
 * Pass keepPotential=true to surface them with an explicit label.
 */
export function applyQualificationGate(
  rows: SpecRow[],
  spec: SearchSpec,
  opts?: { keepPotential?: boolean },
): { qualified: SpecRow[]; potential: SpecRow[]; dropped: number } {
  const qualified: SpecRow[] = [];
  const potential: SpecRow[] = [];
  let dropped = 0;
  for (const r of rows) {
    const ev = (r as SpecRow & { evidence?: Evidence[] }).evidence;
    const q = qualifyLead(r, spec, ev);
    const next: SpecRow = {
      ...r,
      why_match: q.why_match,
      relevance_score: q.relevance_score,
      intent_score: q.intent_score,
      disposition: q.disposition,
      disposition_label: q.label ?? null,
    };
    if (q.disposition === "qualified") qualified.push(next);
    else if (q.disposition === "potential_match") {
      if (opts?.keepPotential) potential.push(next);
      else dropped += 1;
    } else dropped += 1;
  }
  return { qualified, potential, dropped };
}
