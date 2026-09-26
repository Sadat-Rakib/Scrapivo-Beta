/**
 * M8 — Execute enrichment plan before qualification.
 *
 * candidate → missing requirements → enrich → merge → (caller) qualify().
 * AbortSignal propagated to every provider call.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { throwIfAborted } from "@/lib/search/search-run";
import {
  buildEnrichmentPlan,
  deriveEnrichmentRequirements,
  needsEnrichmentBeforeQualify,
  type EnrichmentPlan,
  type EnrichmentProviderId,
  type EnrichmentRequirements,
} from "@/lib/search/enrichment-plan";
import {
  mergeEnrichmentIntoRow,
  preserveNoWebsiteOpportunity,
  type EnrichmentAdapterResult,
  type FieldProvenance,
} from "@/lib/search/enrichment-merge";

export type EnrichmentAdapter = (ctx: {
  spec: SearchSpec;
  candidate: SpecRow;
  fields: string[];
  signal?: AbortSignal | null;
}) => Promise<EnrichmentAdapterResult>;

export type EnrichmentDiagnostic = {
  provider: EnrichmentProviderId | string;
  attempted: boolean;
  succeeded: boolean;
  fieldsApplied: string[];
  error?: string | null;
};

export type EnrichCandidateResult = {
  row: SpecRow;
  plan: EnrichmentPlan;
  diagnostics: EnrichmentDiagnostic[];
  requirements: EnrichmentRequirements;
};

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

/** Default free adapters — never invent; never launder claims from websites. */
export function defaultEnrichmentAdapters(): Partial<
  Record<EnrichmentProviderId, EnrichmentAdapter>
> {
  return {
    "no-website-verify": async ({ candidate, fields }) => {
      if (!fields.includes("no_website")) return { fields: [] };
      const hasClaim = candidate.evidence?.some((e) => e.evidence_type === "no_website");
      if (hasClaim) return { fields: [] };
      if (candidate.url) {
        return {
          fields: [],
          error: "has_website_cannot_verify_absence",
        };
      }
      return {
        fields: [],
        error: "website_status_requires_live_investigation",
      };
    },
    "salary-extract": async ({ candidate, fields }) => {
      if (!fields.includes("salary")) return { fields: [] };
      const r = candidate as SpecRow & { salary?: string | number | null };
      if (r.salary != null && String(r.salary).trim()) return { fields: [] };
      const hay = `${candidate.title} ${candidate.detail ?? ""}`;
      const kMatch = /\$\s*([\d,]+)\s*k\+?\b/i.exec(hay);
      if (kMatch) {
        const n = Number(kMatch[1].replace(/,/g, ""));
        if (!Number.isFinite(n)) return { fields: [] };
        return {
          fields: [
            {
              field: "salary",
              value: n * 1000,
              source: "salary-extract",
              source_url: candidate.url ?? null,
              confidence: 0.7,
            },
          ],
        };
      }
      const full = /\$\s*([\d,]+)(?!\s*k)/i.exec(hay);
      if (!full) return { fields: [] };
      const n = Number(full[1].replace(/,/g, ""));
      if (!Number.isFinite(n)) return { fields: [] };
      return {
        fields: [
          {
            field: "salary",
            value: n,
            source: "salary-extract",
            source_url: candidate.url ?? null,
            confidence: 0.7,
          },
        ],
      };
    },
    "contact-harvest": async ({ candidate, fields, signal }) => {
      throwIfAborted(signal);
      // Identity-only: may fill email/phone/url from site — never invent claims.
      const wantEmail = fields.includes("email");
      const wantPhone = fields.includes("phone");
      const wantUrl = fields.includes("url") || fields.includes("website");
      if (!wantEmail && !wantPhone && !wantUrl) return { fields: [] };
      if (!candidate.url) return { fields: [], error: "no_site_to_harvest" };
      try {
        const { enrichSpecRowFromSite } = await import("@/lib/search/enrich-incomplete");
        throwIfAborted(signal);
        const enriched = await enrichSpecRowFromSite(candidate, signal);
        const out: EnrichmentAdapterResult = { fields: [] };
        if (wantEmail && enriched.email && enriched.email !== candidate.email) {
          out.fields!.push({
            field: "email",
            value: enriched.email,
            source: "contact-harvest",
            source_url: candidate.url,
            confidence: 0.65,
          });
        }
        if (wantPhone && enriched.phone && enriched.phone !== candidate.phone) {
          out.fields!.push({
            field: "phone",
            value: enriched.phone,
            source: "contact-harvest",
            source_url: candidate.url,
            confidence: 0.6,
          });
        }
        // Deliberately do NOT emit hiring/service_request from a website find.
        return out;
      } catch (e) {
        if (e instanceof Error && e.message === "SEARCH_CANCELLED") throw e;
        return {
          fields: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    "registry-identity": async ({ candidate, fields }) => {
      // Thin: only confirm domain/location already known — no fabrication.
      const out: EnrichmentAdapterResult = { fields: [] };
      if (fields.includes("location") && candidate.location) {
        out.fields!.push({
          field: "location",
          value: candidate.location,
          source: "registry-identity",
          confidence: 0.5,
        });
      }
      return out;
    },
  };
}

/**
 * Enrich one candidate per Spec plan. Does not call qualify().
 */
export async function enrichCandidateForSpec(
  candidate: SpecRow,
  spec: SearchSpec,
  opts?: {
    adapters?: Partial<Record<EnrichmentProviderId, EnrichmentAdapter>>;
    signal?: AbortSignal | null;
    budget?: {
      maxPaidCalls?: number;
      maxContactHarvest?: number;
      maxSteps?: number;
    };
  },
): Promise<EnrichCandidateResult> {
  throwIfAborted(opts?.signal);
  const requirements = deriveEnrichmentRequirements(spec, candidate);
  const plan = buildEnrichmentPlan(spec, candidate, { budget: opts?.budget });
  const adapters = { ...defaultEnrichmentAdapters(), ...opts?.adapters };
  const diagnostics: EnrichmentDiagnostic[] = [];
  let row = preserveNoWebsiteOpportunity(candidate, fieldOf(spec, "opportunity"));

  if (!plan.steps.length) {
    return { row, plan, diagnostics, requirements };
  }

  for (const step of plan.steps) {
    throwIfAborted(opts?.signal);
    const adapter = adapters[step.providerId];
    if (!adapter) {
      diagnostics.push({
        provider: step.providerId,
        attempted: false,
        succeeded: false,
        fieldsApplied: [],
        error: "adapter_not_wired",
      });
      continue;
    }
    try {
      const result = await adapter({
        spec,
        candidate: row,
        fields: step.fields,
        signal: opts?.signal,
      });
      if (result.unavailable) {
        diagnostics.push({
          provider: step.providerId,
          attempted: true,
          succeeded: false,
          fieldsApplied: [],
          error: result.error ?? "unavailable",
        });
        continue;
      }
      const merged = mergeEnrichmentIntoRow(row, result, {
        forbidFields: requirements.forbidFields,
        entityId: row.entity_id,
        allowedClaims: requirements.requestedClaims,
      });
      row = preserveNoWebsiteOpportunity(
        merged.row,
        fieldOf(spec, "opportunity"),
      );
      diagnostics.push({
        provider: step.providerId,
        attempted: true,
        succeeded: !result.error || merged.applied.length > 0,
        fieldsApplied: merged.applied,
        error: result.error ?? null,
      });
    } catch (e) {
      if (e instanceof Error && e.message === "SEARCH_CANCELLED") throw e;
      diagnostics.push({
        provider: step.providerId,
        attempted: true,
        succeeded: false,
        fieldsApplied: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    row,
    plan,
    diagnostics,
    requirements: deriveEnrichmentRequirements(spec, row),
  };
}

/**
 * Batch enrich before qualification. Caps expensive work across the page.
 * 100 candidates → do not blindly call every paid provider.
 */
export async function enrichCandidatesForSpec(
  rows: SpecRow[],
  spec: SearchSpec,
  opts?: {
    adapters?: Partial<Record<EnrichmentProviderId, EnrichmentAdapter>>;
    signal?: AbortSignal | null;
    /** Max candidates that may invoke contact-harvest (default 8). */
    maxContactCandidates?: number;
    maxPaidCalls?: number;
    /** Shared contact budget; optional metadata must not hold up search completion. */
    contactBudgetMs?: number;
  },
): Promise<{ rows: SpecRow[]; diagnostics: EnrichmentDiagnostic[] }> {
  throwIfAborted(opts?.signal);
  const maxContact = opts?.maxContactCandidates ?? 8;
  const out: SpecRow[] = [];
  const diagnostics: EnrichmentDiagnostic[] = [];
  let contactUsed = 0;
  let paidUsed = 0;
  const contactDeadline = Date.now() + (opts?.contactBudgetMs ?? 20_000);

  for (const row of rows) {
    throwIfAborted(opts?.signal);
    // Never enrich unresolved / provisional sources — they cannot qualify yet,
    // and spending budget on list/article pages is waste (and a 100× trap).
    if (row.entity_resolved !== true) {
      out.push(preserveNoWebsiteOpportunity(row, fieldOf(spec, "opportunity")));
      continue;
    }
    if (!needsEnrichmentBeforeQualify(spec, row)) {
      out.push(preserveNoWebsiteOpportunity(row, fieldOf(spec, "opportunity")));
      continue;
    }
    const allowContact = contactUsed < maxContact && Date.now() < contactDeadline;
    const allowPaid = paidUsed < (opts?.maxPaidCalls ?? 0);
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: opts?.adapters,
      signal: opts?.signal,
      budget: {
        maxContactHarvest: allowContact ? 1 : 0,
        maxPaidCalls: allowPaid ? 1 : 0,
        maxSteps: 4,
      },
    });
    if (res.diagnostics.some((d) => d.provider === "contact-harvest" && d.attempted)) {
      contactUsed += 1;
    }
    if (res.diagnostics.some((d) => d.provider === "paid-enrichment" && d.attempted)) {
      paidUsed += 1;
    }
    diagnostics.push(...res.diagnostics);
    out.push(res.row);
  }

  return { rows: out, diagnostics };
}

/** Test helper: adapter returning fixed patches. */
export function enrichmentAdapter(
  result: EnrichmentAdapterResult | ((fields: string[]) => EnrichmentAdapterResult),
): EnrichmentAdapter {
  return async ({ fields }) =>
    typeof result === "function" ? result(fields) : result;
}

export type { FieldProvenance };
