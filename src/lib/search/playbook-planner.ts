/**
 * Playbook planner — formalizes clarifier/classifier detectors into an executable SearchPlan.
 * Patterns inspired by AI Outreach Engine playbooks; Scrapivo detectors remain the source of truth.
 */
import type { ClassifiedQuery } from "./query-classifier";
import type { SearchRefinement } from "./clarifier";
import { isFindInvestorHunt, isLocalBusinessHunt, isClientsBuyerHunt } from "./clarifier";

export type PlaybookId =
  | "CUSTOMER_DISCOVERY"
  | "INVESTOR_DISCOVERY"
  | "JOB_DISCOVERY"
  | "LOCAL_BUSINESS"
  | "GENERAL_PEOPLE"
  | "COMPANY_DISCOVERY"
  | "CUSTOM";

export type TargetEntity = "business" | "company" | "person" | "investor" | "job";

export type SearchPlan = {
  playbook: PlaybookId;
  targetEntity: TargetEntity;
  offer?: string;
  industry?: string;
  location?: string;
  criteria: Record<string, string | string[] | boolean | undefined>;
  /** Ordered source waterfall (hints for fan-out / enrichment). */
  sources: string[];
  enrichment: string[];
  qualification: string[];
  ranking: string;
  personalization: boolean;
};

export type ProjectContextLite = {
  service?: string | null;
  niche?: string | null;
  location?: string | null;
  audience?: string | null;
  goal?: string | null;
};

function pickPlaybook(classified: ClassifiedQuery, refinement: SearchRefinement): PlaybookId {
  if (refinement.findInvestors || isFindInvestorHunt(classified)) {
    return "INVESTOR_DISCOVERY";
  }
  if (isLocalBusinessHunt(classified) || classified.intentMode === "directory_smb") {
    return "LOCAL_BUSINESS";
  }
  if (classified.goal === "jobs" && classified.signalMode !== "buying_signal") {
    return "JOB_DISCOVERY";
  }
  if (
    isClientsBuyerHunt(classified) ||
    classified.goal === "clients" ||
    classified.signalMode === "buying_signal"
  ) {
    return "CUSTOMER_DISCOVERY";
  }
  if (classified.audience === "people") return "GENERAL_PEOPLE";
  if (classified.audience === "companies" || classified.audience === "agencies") {
    return "COMPANY_DISCOVERY";
  }
  return "CUSTOM";
}

function targetFor(playbook: PlaybookId): TargetEntity {
  switch (playbook) {
    case "INVESTOR_DISCOVERY":
      return "investor";
    case "JOB_DISCOVERY":
      return "job";
    case "LOCAL_BUSINESS":
      return "business";
    case "GENERAL_PEOPLE":
      return "person";
    case "CUSTOMER_DISCOVERY":
    case "COMPANY_DISCOVERY":
      return "company";
    default:
      return "company";
  }
}

function sourcesFor(playbook: PlaybookId, classified: ClassifiedQuery): string[] {
  switch (playbook) {
    case "INVESTOR_DISCOVERY":
      return ["investors_seed"];
    case "LOCAL_BUSINESS":
      return ["osm", "geoapify", "foursquare", "website", "contact"];
    case "JOB_DISCOVERY":
      return ["greenhouse", "lever", "ashby", "job_boards", "ats"];
    case "CUSTOMER_DISCOVERY":
      return classified.location
        ? ["places", "web", "social", "reddit", "ats", "contact"]
        : ["web", "social", "reddit", "hn", "ats", "contact"];
    case "GENERAL_PEOPLE":
      return ["social", "reddit", "github", "web", "profile"];
    case "COMPANY_DISCOVERY":
      return ["web", "producthunt", "ats", "news", "contact"];
    default:
      return ["web", "social", "reddit"];
  }
}

function enrichmentFor(playbook: PlaybookId): string[] {
  switch (playbook) {
    case "LOCAL_BUSINESS":
      return ["website", "seo_heuristic", "contact", "profile"];
    case "CUSTOMER_DISCOVERY":
    case "COMPANY_DISCOVERY":
      return ["website", "contact", "profile"];
    case "INVESTOR_DISCOVERY":
      return ["relevance", "profile"];
    case "JOB_DISCOVERY":
      return ["employer_domain"];
    case "GENERAL_PEOPLE":
      return ["profile", "contact"];
    default:
      return ["contact"];
  }
}

/**
 * Build an executable search plan from classifier + clarifier outputs.
 */
export function buildSearchPlan(
  classified: ClassifiedQuery,
  refinement: SearchRefinement,
  context?: ProjectContextLite | null,
): SearchPlan {
  const playbook = pickPlaybook(classified, refinement);
  const location = refinement.location || classified.location || context?.location || undefined;
  const offer = context?.service?.trim() || undefined;
  const industry = context?.niche?.trim() || classified.coreSkill || undefined;

  return {
    playbook,
    targetEntity: targetFor(playbook),
    offer,
    industry,
    location: location || undefined,
    criteria: {
      craft: refinement.craft || classified.coreSkill,
      audience: refinement.audience,
      goal: classified.goal,
      signalMode: classified.signalMode,
      intentMode: classified.intentMode,
      localOpportunity: refinement.localOpportunity,
      investorStage: refinement.investorStage,
      investorCheck: refinement.investorCheck,
      buyerTerms: refinement.buyerTerms,
      signalTerms: refinement.signalTerms,
    },
    sources: sourcesFor(playbook, classified),
    enrichment: enrichmentFor(playbook),
    qualification:
      playbook === "LOCAL_BUSINESS"
        ? ["website_status", "opportunity_tags", "contactable"]
        : playbook === "INVESTOR_DISCOVERY"
          ? ["stage", "geo", "check_band"]
          : ["relevance", "freshness", "alive_url"],
    ranking:
      playbook === "LOCAL_BUSINESS"
        ? "email_phone_then_score"
        : playbook === "INVESTOR_DISCOVERY"
          ? "geo_stage_relevance"
          : "score_diversify",
    personalization: playbook !== "JOB_DISCOVERY",
  };
}

/** Whether Discover should short-circuit to the investor seed path. */
export function planUsesInvestorSeed(plan: SearchPlan): boolean {
  return plan.playbook === "INVESTOR_DISCOVERY";
}

/** Whether enrichment should prefer places/website heuristics. */
export function planNeedsLocalEnrichment(plan: SearchPlan): boolean {
  return (
    plan.playbook === "LOCAL_BUSINESS" ||
    plan.enrichment.includes("seo_heuristic") ||
    plan.enrichment.includes("website")
  );
}

/**
 * Optional LLM assist when classifier confidence is low / playbook is CUSTOM.
 * Falls back to deterministic plan on any failure.
 */
export async function refineSearchPlanWithLlm(
  plan: SearchPlan,
  rawQuery: string,
): Promise<SearchPlan> {
  if (plan.playbook !== "CUSTOM") return plan;
  try {
    const { aiComplete, safeJsonParse } = await import("@/lib/ai/router.server");
    const raw = await aiComplete({
      task: "classify",
      system:
        "Classify outreach search intent. Reply JSON only with playbook one of: CUSTOMER_DISCOVERY, INVESTOR_DISCOVERY, JOB_DISCOVERY, LOCAL_BUSINESS, GENERAL_PEOPLE, COMPANY_DISCOVERY, CUSTOM.",
      user: `Query: ${rawQuery}\nCurrent playbook: ${plan.playbook}`,
      json: true,
      maxTokens: 120,
    });
    const parsed = safeJsonParse<{ playbook?: PlaybookId }>(raw);
    if (parsed?.playbook && parsed.playbook !== "CUSTOM") {
      return {
        ...plan,
        playbook: parsed.playbook,
        targetEntity:
          parsed.playbook === "INVESTOR_DISCOVERY"
            ? "investor"
            : parsed.playbook === "JOB_DISCOVERY"
              ? "job"
              : parsed.playbook === "LOCAL_BUSINESS"
                ? "business"
                : parsed.playbook === "GENERAL_PEOPLE"
                  ? "person"
                  : "company",
      };
    }
  } catch {
    /* keep deterministic */
  }
  return plan;
}
