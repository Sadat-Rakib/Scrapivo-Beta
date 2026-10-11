/**
 * M7 — Canonical source pipeline.
 *
 * SearchSpec → plan → provider adapters → page classify → entity resolve →
 * claim bind → qualify(). Provider outputs are discovery artifacts, never leads.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchOutcomeCode } from "@/lib/search/canonical-contract";
import { mintProvisionalEntityId } from "@/lib/search/canonical-contract";
import { applyPageClassificationToLiveRow } from "@/lib/search/page-classify";
import { applyEntityResolutionToRow } from "@/lib/search/entity-resolve";
import { applyQualificationGate } from "@/lib/search/qualify";
import { mergeKnownWithRegistry } from "@/lib/search/entity-registry";
import type { Evidence } from "@/lib/search/evidence";
import { enrichCandidatesForSpec } from "@/lib/search/enrichment-run";
import type { EnrichmentAdapter } from "@/lib/search/enrichment-run";
import type { EnrichmentProviderId } from "@/lib/search/enrichment-plan";
import {
  buildSourcePlan,
  deriveCoverageRequirements,
  resolveSourcePlanOutcome,
  shouldInvokePaidSerp,
  type CoverageRequirements,
  type ProviderDiagnostic,
  type SourcePlan,
} from "@/lib/search/source-plan";
import type { SourceProviderId } from "@/lib/search/source-capabilities";
import { throwIfAborted } from "@/lib/search/search-run";
import { mergeDuplicateCandidates } from "./candidate-merge";

/** Raw discovery artifact — never a QualifiedLead. */
export type DiscoveryArtifact = {
  title: string;
  url?: string | null;
  snippet?: string | null;
  location?: string | null;
  phone?: string | null;
  email?: string | null;
  evidence?: Evidence[];
  /** Opaque provider key for SpecRow.key. */
  key?: string | null;
};

export type SourceAdapterResult = {
  artifacts: DiscoveryArtifact[];
  error?: string | null;
  unavailable?: boolean;
};

export type SourceAdapter = (ctx: {
  spec: SearchSpec;
  requirements: CoverageRequirements;
  signal?: AbortSignal | null;
}) => Promise<SourceAdapterResult>;

export type CanonicalPipelineResult = {
  plan: SourcePlan;
  diagnostics: ProviderDiagnostic[];
  /** All discovery rows after classify+resolve (not yet theorem-filtered). */
  artifacts: SpecRow[];
  /** Theorem survivors only. */
  qualified: SpecRow[];
  outcome: SearchOutcomeCode;
  coverageEstablished: boolean;
  /** Providers actually invoked (for free-first assertions). */
  invoked: SourceProviderId[];
};

function artifactToRow(a: DiscoveryArtifact, provider: string, index: number): SpecRow {
  const url = a.url ?? null;
  const title = (a.title || "").trim() || "Untitled";
  const key = a.key?.trim() || `${provider}:${index}:${(url ?? title).slice(0, 48)}`;
  const entity_id = mintProvisionalEntityId(key);
  const base: SpecRow = {
    kind: "company",
    key,
    entity_id,
    entity_resolved: false,
    page_type: "unknown",
    title,
    detail: a.snippet ?? "",
    email: a.email ?? null,
    phone: a.phone ?? null,
    url,
    location: a.location ?? null,
    country: null,
    evidence: a.evidence ?? [],
    verification_status: "discovered",
  };
  const classified = applyPageClassificationToLiveRow(base);
  const known = mergeKnownWithRegistry(undefined, classified.title, classified.url);
  return applyEntityResolutionToRow(classified, { known });
}

/**
 * Execute a capability plan through injected adapters. Missing adapters are
 * recorded as unattempted skips (not failures). Escalation (paid SERP) runs
 * only when shouldInvokePaidSerp says so.
 */
export async function runCanonicalSourcePipeline(args: {
  spec: SearchSpec;
  adapters: Partial<Record<SourceProviderId, SourceAdapter>>;
  signal?: AbortSignal | null;
  /** Max primary providers to attempt (default: all primaries). */
  maxPrimary?: number;
  desiredCount?: number;
  allowPaidEscalation?: boolean;
  /** M8: query-aware enrichment before qualify. */
  enrichmentAdapters?: Partial<Record<EnrichmentProviderId, EnrichmentAdapter>>;
  skipEnrichment?: boolean;
}): Promise<CanonicalPipelineResult> {
  throwIfAborted(args.signal);
  const requirements = deriveCoverageRequirements(args.spec);
  const plan = buildSourcePlan(args.spec, requirements, { desiredCount: args.desiredCount });
  const diagnostics: ProviderDiagnostic[] = [];
  const invoked: SourceProviderId[] = [];
  const rows: SpecRow[] = [];
  let entitiesResolved = 0;

  const tryStep = async (step: SourcePlan["steps"][number]): Promise<void> => {
    throwIfAborted(args.signal);
    const adapter = args.adapters[step.providerId];
    if (!adapter) {
      diagnostics.push({
        provider: step.providerId,
        attempted: false,
        succeeded: false,
        artifactsFound: 0,
        entitiesResolved: 0,
        qualified: 0,
        costTier: step.costTier,
        role: step.role,
        error: "adapter_not_wired",
        outcome: null,
      });
      return;
    }

    invoked.push(step.providerId);
    try {
      const res = await adapter({
        spec: args.spec,
        requirements,
        signal: args.signal,
      });
      if (res.unavailable) {
        diagnostics.push({
          provider: step.providerId,
          attempted: true,
          succeeded: false,
          artifactsFound: 0,
          entitiesResolved: 0,
          qualified: 0,
          costTier: step.costTier,
          role: step.role,
          error: res.error ?? "unavailable",
          outcome: "SOURCE_UNAVAILABLE",
        });
        return;
      }
      if (res.error && !res.artifacts.length) {
        diagnostics.push({
          provider: step.providerId,
          attempted: true,
          succeeded: false,
          artifactsFound: 0,
          entitiesResolved: 0,
          qualified: 0,
          costTier: step.costTier,
          role: step.role,
          error: res.error,
          outcome: "SOURCE_ERROR",
        });
        return;
      }

      let resolvedHere = 0;
      for (let i = 0; i < res.artifacts.length; i++) {
        const row = artifactToRow(res.artifacts[i]!, step.providerId, i);
        if (row.entity_resolved === true) resolvedHere += 1;
        rows.push(row);
      }
      entitiesResolved += resolvedHere;
      diagnostics.push({
        provider: step.providerId,
        attempted: true,
        succeeded: true,
        artifactsFound: res.artifacts.length,
        entitiesResolved: resolvedHere,
        qualified: 0, // filled after gate
        costTier: step.costTier,
        role: step.role,
        error: res.error ?? null,
        outcome: null,
      });
    } catch (e) {
      diagnostics.push({
        provider: step.providerId,
        attempted: true,
        succeeded: false,
        artifactsFound: 0,
        entitiesResolved: 0,
        qualified: 0,
        costTier: step.costTier,
        role: step.role,
        error: e instanceof Error ? e.message : String(e),
        outcome: "SOURCE_ERROR",
      });
    }
  };

  const primaries = plan.steps.filter((s) => s.role === "primary");
  const maxP = args.maxPrimary ?? primaries.length;
  const target = Math.max(
    1,
    Number(args.spec.criteria.find((c) => c.field === "requested_count")?.value) ||
      Number(args.spec.criteria.find((c) => c.field === "minimum_count")?.value) ||
      plan.researchPlan.desiredCount,
  );
  for (const step of primaries.slice(0, maxP)) {
    await tryStep(step);
    // Discovery artifacts are not leads. Only theorem-qualified unique rows
    // satisfy requested volume; otherwise exhaust the bounded primary plan.
    if (
      applyQualificationGate(mergeDuplicateCandidates(rows), args.spec, { keepPotential: false })
        .qualified.length >= target
    ) {
      break;
    }
  }

  const allowPaid = args.allowPaidEscalation === true;
  if (allowPaid && shouldInvokePaidSerp(plan, diagnostics)) {
    const paid = plan.steps.find((s) => s.providerId === "paid-serp");
    if (paid) await tryStep(paid);
  } else {
    // Record that paid was deliberately not invoked.
    const paid = plan.steps.find((s) => s.providerId === "paid-serp");
    if (paid && !invoked.includes("paid-serp")) {
      diagnostics.push({
        provider: "paid-serp",
        attempted: false,
        succeeded: false,
        artifactsFound: 0,
        entitiesResolved: 0,
        qualified: 0,
        costTier: 7,
        role: "escalation",
        error: "skipped_free_first",
        outcome: null,
      });
    }
  }

  let working = mergeDuplicateCandidates(rows);
  if (!args.skipEnrichment) {
    throwIfAborted(args.signal);
    const enriched = await enrichCandidatesForSpec(working, args.spec, {
      adapters: args.enrichmentAdapters,
      signal: args.signal,
      maxContactCandidates: 8,
      maxPaidCalls: 0,
    });
    working = enriched.rows;
  }

  const { qualified } = applyQualificationGate(working, args.spec, {
    keepPotential: false,
  });

  // Stamp qualified counts onto diagnostics (per-provider is approximate:
  // we attribute by key prefix provider:).
  for (const d of diagnostics) {
    d.qualified = qualified.filter((r) => (r.key ?? "").startsWith(`${d.provider}:`)).length;
  }

  const fin = resolveSourcePlanOutcome({
    diagnostics,
    qualifiedCount: qualified.length,
  });

  return {
    plan,
    diagnostics,
    artifacts: working,
    qualified,
    outcome: fin.outcome,
    coverageEstablished: fin.coverageEstablished,
    invoked,
  };
}

/** Test helper: empty adapter that reports unavailable. */
export function unavailableAdapter(error = "unavailable"): SourceAdapter {
  return async () => ({ artifacts: [], unavailable: true, error });
}

/** Test helper: adapter returning fixed artifacts. */
export function artifactsAdapter(artifacts: DiscoveryArtifact[]): SourceAdapter {
  return async () => ({ artifacts });
}
