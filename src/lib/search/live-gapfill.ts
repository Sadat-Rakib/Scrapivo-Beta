/**
 * Live gapfill + evidence + why-match (Phase 1B/C).
 *
 * When the DB is thin or the spec requires a signal, fan out to free public
 * sources (OSM for businesses, jobs fleet for jobs, SearXNG web for
 * company/person). Attach evidence[]. Qualified why_match comes from evidence
 * only when signal_required.
 *
 * M7: provider order comes from buildSourcePlan (capability-based free-first).
 * Paid SERP is never invoked from this path.
 */
import type { SearchSpec } from "./search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { resolveCanonicalLocation } from "./location-resolver";
import {
  makeEvidence,
  whyMatchFromEvidence,
  type Evidence,
} from "./evidence";
import { applyQualificationGate } from "./qualify";
import { mintProvisionalEntityId } from "./canonical-contract";
import { applyPageClassificationToLiveRow } from "./page-classify";
import { applyEntityResolutionToRow } from "./entity-resolve";
import { mergeDuplicateCandidates } from "./candidate-merge";
import {
  buildSourcePlan,
  buildResearchPlan,
  deriveCoverageRequirements,
  type ProviderDiagnostic,
  type SourcePlan,
} from "./source-plan";
import type { SourceProviderId } from "./source-capabilities";

export type LiveGapfillResult = {
  rows: SpecRow[];
  engine: string;
  scanned: number;
  /** M7 capability plan used for this gapfill. */
  plan?: SourcePlan;
  /** M7 per-provider coverage diagnostics. */
  diagnostics?: ProviderDiagnostic[];
};

export type LiveGapfillDeps = {
  /** Injectable browser discovery; production always uses the browser adapter. */
  browser?: ((spec: SearchSpec, options: { searchRunId?: string; signal?: AbortSignal | null; onProgress?: (event: { action: string; source?: string; detail?: string }) => void; researchPlan?: ReturnType<typeof buildResearchPlan>; initialCandidates?: SpecRow[]; desiredCount?: number; isVerified?: (row: SpecRow) => boolean; timeoutMs?: number; onTrace?: (event: import("./browser-live.server").BrowserTraceEvent) => void }) => Promise<SpecRow[]>) | null;
  searchRunId?: string;
  ownerId?: string;
  onBrowserProgress?: (event: { action: string; source?: string; detail?: string; count?: number | string; row?: import("@/lib/search/search-browser-progress.server").StreamedLead }) => void;
  /** Diagnostic browser lifecycle trace (harnesses only); never changes behavior. */
  onBrowserTrace?: (event: import("./browser-live.server").BrowserTraceEvent) => void;
  desiredCount?: number;
  initialCandidates?: SpecRow[];
  isVerified?: (row: SpecRow) => boolean;
  /** OSM / local businesses live search. Null skips. */
  osm?: ((query: string, location: string, category: string) => Promise<SpecRow[]>) | null;
  /** Jobs fleet. Null skips. */
  jobs?: ((query: string, location?: string) => Promise<SpecRow[]>) | null;
  /** Web/SERP directory discovery for company/person (and business fallback). */
  web?:
    | ((
        query: string,
        location: string | null,
        entity: string,
        spec?: SearchSpec,
      ) => Promise<SpecRow[]>)
    | null;
  /** M3: abort in-flight provider work when signalled. */
  signal?: AbortSignal | null;
};

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c ? c.value : null;
}

function has(v: unknown) {
  return typeof v === "string" && v.trim().length > 0;
}

/** Lightweight craft normalise — avoids importing spec-search (cycle). */
export function craftFromTag(tag: string, fallback: string, name = ""): string {
  const t = (tag ?? "").trim().toLowerCase();
  if (!t) return fallback;
  if (/dental|dentist/.test(t)) return "dentist";
  // A general medical tag (amenity=clinic) stays a clinic unless the
  // business's own name says it is a dental practice.
  if (/^(?:clinic|doctors?|healthcare)$/.test(t) && /\b(?:dental|dentist\w*|orthodont\w*|endodont\w*|periodont\w*)\b/i.test(name)) return "dentist";
  if (/plumb/.test(t)) return "plumber";
  if (/caf[eé]|coffee|roaster/.test(t)) return "cafe";
  if (/yoga/.test(t)) return "yoga";
  if (/restaurant|fast_food|bistro/.test(t)) return "restaurant";
  if (/hvac|heating|cooling|air.condition|refrigerat|furnace/.test(t)) return "HVAC";
  // A broad OSM tag must not be relabelled as the user's requested trade.
  return tag;
}

/** Default OSM adapter — wraps searchOsmLocalBusinesses into SpecRows. */
async function defaultOsm(
  query: string,
  location: string,
  category: string,
): Promise<SpecRow[]> {
  const { searchOsmLocalBusinesses } = await import("./osm-local-businesses.server");
  const { checkPhone } = await import("./phone-safety");
  const leads = await searchOsmLocalBusinesses(
    {
      raw: query,
      skill: category,
      role: "",
      queryType: "skill",
      relatedSkills: [],
      buyerIntentQueries: [],
      buyerPhrases: [],
      jobBoardQueries: [],
      jobBoardTerms: [],
      socialQueries: [],
      redditBuyerQueries: [],
      booleanWebQueries: [],
      customerPhrases: [],
      subreddits: [],
      negativePhrases: [],
      negativeSignals: [],
    },
    location,
  );
  return leads.map((l, i) => {
    const tag = (l.match_reasons?.[0] ?? "").split(" near ")[0] || category;
    const slug =
      `${l.title ?? "?"}|${l.address ?? ""}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 48) || `row-${i}`;
    const contact = l as unknown as { phones?: string[]; emails?: string[] };
    const phone = checkPhone(contact.phones?.[0], "");
    const why =
      l.match_reasons?.[0] ||
      (l.full_post_url ? `Listed on OpenStreetMap near ${location}` : null);
    const entity_id = `live-osm:${slug}`;
    return {
      kind: "business" as const,
      key: entity_id,
      entity_id,
      entity_resolved: true,
      identity_confidence: 0.92,
      page_type: "entity_page" as const,
      resolution_method: "osm_poi",
      title: l.title ?? "?",
      detail: [l.address, location].filter(has).join(", "),
      email: contact.emails?.[0] ?? null,
      phone: phone.phone,
      phoneStatus: phone.status,
      url: l.full_post_url ?? null,
      website_url: l.full_post_url ?? null,
      source_url: (l as typeof l & { source_record_url?: string }).source_record_url ?? null,
      no_website_verification: {
        structured_source_url: (l as typeof l & { source_record_url?: string }).source_record_url ?? null,
        structured_absence: (l as typeof l & { structured_website_absent?: boolean }).structured_website_absent === true,
        exact_queries: [],
      },
      category: craftFromTag(tag, category, l.title ?? ""),
      location,
      country: null,
      // The actual OSM record supports identity/contact facts, never website absence.
      evidence: [{
        source_url: (l as typeof l & { source_record_url?: string }).source_record_url ?? `osm:${entity_id}`,
        source_type: "osm" as const,
        excerpt: [l.title, tag, location, phone.phone ? `phone ${phone.phone}` : null].filter(Boolean).join(" · "),
        observed_at: new Date().toISOString(),
        evidence_type: "identity" as const,
        supports: "identity" as const,
        confidence: 0.8,
        extraction_method: "osm_tags",
        subject: entity_id,
      }],
      why_match: why,
    };
  });
}

async function defaultJobs(query: string, location?: string): Promise<SpecRow[]> {
  const { fetchSpecJobs, jobPostingToSpecRow } = await import("./jobs-provider");
  const j = await fetchSpecJobs({
    query,
    location,
    limit: 25,
  });
  let extra: SpecRow[] = [];
  try {
    const { fetchJobSpyJobs } = await import("@/lib/jobs/jobspy-adapter");
    const js = await fetchJobSpyJobs({ query, location, limit: 10 });
    extra = js.map((p) => jobPostingToSpecRow(p, "live-jobspy"));
  } catch {
    // optional adapter
  }
  const fromFleet = j.jobs.map((p) => jobPostingToSpecRow(p, "live-job"));
  return [...fromFleet, ...extra];
}

/**
 * Directory/web discovery via SearXNG — free-first. Evidence is attached from
 * snippet text when it supports the query claim; title alone is never VERIFIED.
 */
async function defaultWeb(
  query: string,
  location: string | null,
  entity: string,
  spec?: SearchSpec,
): Promise<SpecRow[]> {
  const { discoverWebFreeFirst } = await import("./provider-ladder");
  const plan = spec ? buildResearchPlan(spec, { desiredCount: 10 }) : null;
  const queries = plan?.discoveryQueries.length ? plan.discoveryQueries : [query.trim()].filter(Boolean);
  if (!queries.length) return [];
  const { results } = await discoverWebFreeFirst({
    queries,
    maxQueries: plan?.stoppingRules.maxQueries ?? 8,
    timeRange: "year",
    sourceKey: `live-${entity}`,
    operation: `live-gapfill:${entity}`,
  });
  // Kind starts neutral — M4 resolution sets entity type from the page,
  // never from Spec.entity / query-kind inheritance.
  return results.slice(0, 15).map((r, i) => {
    const title = (r.title || "").trim() || "Web result";
    const url = r.url || null;
    const snippet = (r.content || "").slice(0, 180);
    const entity_id = mintProvisionalEntityId(`live-web:${i}:${(url ?? title).slice(0, 48)}`);
    const evidence =
      url && spec ? evidenceFromWebHit({ title, snippet, url, spec }) : [];
    const why = evidence.length ? whyMatchFromEvidence(evidence) : null;
    const base = {
      kind: "company" as SpecRow["kind"],
      key: `live-web:${i}:${(url ?? title).slice(0, 48)}`,
      entity_id,
      entity_resolved: false as const,
      page_type: "unknown" as const,
      title,
      detail: snippet,
      email: null,
      phone: null,
      url,
      source_url: url,
      location: null,
      country: null,
      evidence,
      why_match: why,
      verification_status: "discovered" as const,
    };
    const classified = applyPageClassificationToLiveRow(base);
    const resolved = applyEntityResolutionToRow(classified);
    // A search hit is provenance, not an independently verified entity destination.
    // Browser research may later promote an official site or profile URL.
    return { ...resolved, url: null };
  });
}

/**
 * Infer claim evidence from a live web hit. Title/snippet alone never verify
 * identity; they may support hiring/need/funding when the text actually says so.
 */
export function evidenceFromWebHit(args: {
  title: string;
  snippet: string;
  url: string;
  spec: SearchSpec;
}): Evidence[] {
  const hay = `${args.title} ${args.snippet}`.toLowerCase();
  const out: Evidence[] = [];
  const role = fieldOf(args.spec, "requested_role");
  const service = fieldOf(args.spec, "requested_service");
  const product = fieldOf(args.spec, "requested_product");
  const funding = fieldOf(args.spec, "funding_status");

  const looksHiring =
    /\b(hiring|we're hiring|we are hiring|looking for a|join our team|open role|job opening)\b/i.test(
      hay,
    );
  const looksNeed =
    /\b(need(?:s|ing)?|looking for|asking for|help with)\b/i.test(hay);
  const looksFunding =
    /\b(funded|raises?|raised|series\s+[a-d]|seed round|venture)\b/i.test(hay);

  if (looksHiring || (role && hay.includes(role.toLowerCase()) && /\bhiring|looking for\b/i.test(hay))) {
    out.push(
      makeEvidence({
        source_url: args.url,
        source_type: "web",
        excerpt: (args.snippet || args.title).slice(0, 180),
        evidence_type: "hiring",
        supports: "requested_role",
        extraction_method: "searxng_snippet",
        confidence: looksHiring ? 0.75 : 0.55,
      }),
    );
  } else if (
    looksNeed &&
    ((service && hay.includes(service.toLowerCase())) ||
      (product && hay.includes(product.toLowerCase())) ||
      /\b(website|seo|marketing|developer)\b/i.test(hay))
  ) {
    out.push(
      makeEvidence({
        source_url: args.url,
        source_type: "web",
        excerpt: (args.snippet || args.title).slice(0, 180),
        evidence_type: "service_request",
        supports: service ? "requested_service" : product ? "requested_product" : "intent",
        extraction_method: "searxng_snippet",
        confidence: 0.6,
      }),
    );
  } else if (looksFunding && funding) {
    // Emit funding evidence ONLY when Spec requests funding AND text supports it.
    // Forbidden: funding snippet qualifying a developer/marketing need (claim mismatch).
    out.push(
      makeEvidence({
        source_url: args.url,
        source_type: "news",
        excerpt: (args.snippet || args.title).slice(0, 180),
        evidence_type: "funding",
        supports: "intent",
        extraction_method: "searxng_snippet",
        confidence: 0.7,
      }),
    );
  }
  return out;
}

/**
 * Directory why-match from evidence when present; else legacy templates for
 * non-signal browsing only. Never invent signal proof from host alone.
 */
export function deriveWhyMatch(row: SpecRow, spec: SearchSpec): string | null {
  if (row.evidence?.length) {
    const fromEv = whyMatchFromEvidence(row.evidence);
    if (fromEv) return fromEv;
  }
  if (row.why_match && row.why_match.trim() && !/^Live web result/i.test(row.why_match)) {
    return row.why_match.trim();
  }
  // Host-only live templates are not proof under signal_required.
  if (spec.signal_required) return null;

  const location = fieldOf(spec, "location") ?? row.location;
  const category = fieldOf(spec, "category") ?? fieldOf(spec, "industry") ?? row.category;
  const role = fieldOf(spec, "role");
  const model = fieldOf(spec, "business_model");
  const opp = fieldOf(spec, "opportunity");

  if (row.kind === "business") {
    if (opp === "no_website" && !row.url) {
      return `No website listed${location ? ` in ${location}` : ""}${category ? ` · ${category}` : ""}`;
    }
    if (row.phone || row.email) {
      return [
        category ? `${category}` : "Local business",
        location ? `in ${location}` : null,
        row.phone ? "public phone on file" : null,
        row.email ? "email on file" : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (row.url) {
      return [category ?? "Local business", location ? `in ${location}` : null, "listed site"]
        .filter(Boolean)
        .join(" · ");
    }
    if (category || location) {
      return [category ?? "Local business", location ? `in ${location}` : null]
        .filter(Boolean)
        .join(" · ");
    }
  }
  if (row.kind === "company") {
    const bits = [
      model ? model.toUpperCase() : null,
      category,
      location ? `in ${location}` : null,
      row.url ? "public site" : null,
    ].filter(Boolean);
    if (bits.length) return bits.join(" · ");
  }
  if (row.kind === "person") {
    const bits = [role, category, location ? `in ${location}` : null].filter(Boolean);
    if (bits.length >= 1) return bits.join(" · ");
    if (row.email || row.url) return "Directory match with contact";
  }
  if (row.kind === "job" && (row.url || row.title)) {
    const titleHint = row.title?.split("@")[0]?.trim();
    return [titleHint && titleHint !== "?" ? titleHint : "Open role", location ? location : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (row.kind === "investor") {
    const bits = [
      fieldOf(spec, "investor_stage"),
      fieldOf(spec, "investor_sector") ?? category,
      location,
    ].filter(Boolean);
    if (bits.length) return bits.join(" · ");
  }
  return null;
}

/**
 * Attach why_match via qualification gate (Phase 1C).
 * When signal_required, directory-only rows become potential_match / dropped.
 */
export function applyWhyMatchGate(
  rows: SpecRow[],
  spec: SearchSpec,
  requireSignal: boolean,
): { kept: SpecRow[]; dropped: number } {
  // Tag opportunity onto rows for completeness/why when hunting no_website.
  const opp = fieldOf(spec, "opportunity");
  const prepared = rows.map((r) => {
    const withOpp = opp ? { ...r, opportunity: r.opportunity ?? opp } : r;
    if (withOpp.evidence?.length) return withOpp;
    return withOpp;
  });

  // Always run the theorem gate — directory hunts still need resolved identity.
  const { qualified, dropped } = applyQualificationGate(prepared, spec, {
    keepPotential: false,
  });
  // Non-signal path: attach directory why_match templates onto theorem survivors.
  if (!requireSignal) {
    const kept = qualified.map((r) => {
      const why = r.why_match ?? deriveWhyMatch(r, spec);
      return why ? { ...r, why_match: why } : r;
    });
    return { kept, dropped };
  }
  return { kept: qualified, dropped };
}

/** Run the structured source plan. Browser discovery runs independently below. */
async function runSourceGapfill(
  spec: SearchSpec,
  deps: LiveGapfillDeps = {},
): Promise<LiveGapfillResult> {
  const { throwIfAborted: checkAbort } = await import("./search-run");
  checkAbort(deps.signal);
  const location = fieldOf(spec, "location");
  const category = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
  const role = fieldOf(spec, "role");
  const model = fieldOf(spec, "business_model");
  const web = deps.web === null ? null : (deps.web ?? defaultWeb);

  const requirements = deriveCoverageRequirements(spec);
  const plan = buildSourcePlan(spec, requirements, { desiredCount: deps.desiredCount });
  const diagnostics: ProviderDiagnostic[] = [];

  const record = (
    provider: SourceProviderId | string,
    args: Partial<ProviderDiagnostic> & {
      attempted: boolean;
      succeeded: boolean;
      artifactsFound: number;
    },
  ) => {
    diagnostics.push({
      provider,
      entitiesResolved: 0,
      qualified: 0,
      ...args,
    });
  };

  // Walk primary plan steps; map known live adapters. Paid never runs here.
  for (const step of plan.steps.filter((s) => s.role === "primary")) {
    checkAbort(deps.signal);

    if (step.providerId === "osm-local") {
      if (spec.entity !== "business" || !location || !category) {
        record("osm-local", {
          attempted: false,
          succeeded: false,
          artifactsFound: 0,
          error: "spec_not_applicable",
          role: "primary",
          costTier: 1,
        });
        continue;
      }
      const osm = deps.osm === null ? null : (deps.osm ?? defaultOsm);
      if (!osm) {
        record("osm-local", {
          attempted: false,
          succeeded: false,
          artifactsFound: 0,
          error: "adapter_not_wired",
          role: "primary",
          costTier: 1,
        });
        continue;
      }
      try {
        const geo = resolveCanonicalLocation(location);
        const osmLocation = geo?.kind === "metro"
          ? geo.member_ids.find((id) => id.startsWith("geo:city:"))?.slice("geo:city:".length) ?? location
          : location;
        const rows = await osm(spec.raw_query, osmLocation, category);
        record("osm-local", {
          attempted: true,
          succeeded: true,
          artifactsFound: rows.length,
          role: "primary",
          costTier: 1,
        });
        deps.onBrowserProgress?.({ action: "Searching OpenStreetMap", source: "osm", detail: osmLocation });
        if (rows.length) {
          deps.onBrowserProgress?.({ action: "Found local businesses", source: "osm", count: rows.length });
          return {
            rows,
            engine: "live-osm",
            scanned: rows.length,
            plan,
            diagnostics,
          };
        }
      } catch (e) {
        record("osm-local", {
          attempted: true,
          succeeded: false,
          artifactsFound: 0,
          error: e instanceof Error ? e.message : String(e),
          outcome: "SOURCE_ERROR",
          role: "primary",
          costTier: 1,
        });
        console.warn("[live-gapfill] osm failed", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (step.providerId === "jobs-fleet") {
      if (spec.entity !== "job") continue;
      const jobs = deps.jobs === null ? null : (deps.jobs ?? defaultJobs);
      if (!jobs) {
        record("jobs-fleet", {
          attempted: false,
          succeeded: false,
          artifactsFound: 0,
          error: "adapter_not_wired",
          role: "primary",
          costTier: 1,
        });
        continue;
      }
      try {
        const rows = await jobs(role ?? category ?? spec.raw_query, location ?? undefined);
        record("jobs-fleet", {
          attempted: true,
          succeeded: true,
          artifactsFound: rows.length,
          role: "primary",
          costTier: 1,
        });
        deps.onBrowserProgress?.({ action: "Found job postings", source: "jobs", count: rows.length });
        return {
          rows,
          engine: "live-jobs",
          scanned: rows.length,
          plan,
          diagnostics,
        };
      } catch (e) {
        record("jobs-fleet", {
          attempted: true,
          succeeded: false,
          artifactsFound: 0,
          error: e instanceof Error ? e.message : String(e),
          outcome: "SOURCE_ERROR",
          role: "primary",
          costTier: 1,
        });
        console.warn("[live-gapfill] jobs failed", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (step.providerId === "searxng" || step.providerId === "direct-http") {
      if (!web) {
        record(step.providerId, {
          attempted: false,
          succeeded: false,
          artifactsFound: 0,
          error: "adapter_not_wired",
          role: "primary",
          costTier: step.costTier,
        });
        continue;
      }
      if (
        spec.entity !== "company" &&
        spec.entity !== "person" &&
        !(spec.entity === "business" && location && category)
      ) {
        continue;
      }
      try {
        const webPlan = buildResearchPlan(spec, { desiredCount: deps.desiredCount });
        // E2E-C8 observability: the exact query variants gapfill will spend
        // live-browser budget on, for post-run debugging.
        if (typeof console !== "undefined") {
          console.info("[gapfill-queries]", JSON.stringify(webPlan.discoveryQueries.slice(0, 6)));
        }
        const q = webPlan.discoveryQueries[0] ?? "";
        const entity =
          spec.entity === "business" ||
          spec.entity === "company" ||
          spec.entity === "person"
            ? spec.entity
            : "company";
        const rows = await web(q, location, entity, spec);
        record(step.providerId, {
          attempted: true,
          succeeded: true,
          artifactsFound: rows.length,
          role: "primary",
          costTier: step.costTier,
        });
        deps.onBrowserProgress?.({ action: "Found web candidates", source: "web", count: rows.length });
        if (rows.length) {
          return {
            rows,
            engine: "live-web",
            scanned: rows.length,
            plan,
            diagnostics,
          };
        }
      } catch (e) {
        const code =
          e instanceof Error &&
          (e as Error & { code?: string }).code === "SOURCE_UNAVAILABLE"
            ? "SOURCE_UNAVAILABLE"
            : "SOURCE_ERROR";
        record(step.providerId, {
          attempted: true,
          succeeded: false,
          artifactsFound: 0,
          error: e instanceof Error ? e.message : String(e),
          outcome: code,
          role: "primary",
          costTier: step.costTier,
        });
        console.warn("[live-gapfill] web failed", e instanceof Error ? e.message : e);
      }
      continue;
    }

    // indexed-db / company-registry / html-parser etc. are owned by other paths;
    // record as not attempted here so diagnostics stay honest.
    if (
      step.providerId === "indexed-db" ||
      step.providerId === "company-registry" ||
      step.providerId === "html-parser" ||
      step.providerId === "sitemap-jsonld"
    ) {
      record(step.providerId, {
        attempted: false,
        succeeded: false,
        artifactsFound: 0,
        error: "handled_outside_live_gapfill",
        role: "primary",
        costTier: step.costTier,
      });
    }
  }

  // Never invoke paid-serp from live-gapfill (free-first invariant).
  record("paid-serp", {
    attempted: false,
    succeeded: false,
    artifactsFound: 0,
    error: "skipped_free_first",
    role: "escalation",
    costTier: 7,
  });

  return { rows: [], engine: "live-none", scanned: 0, plan, diagnostics };
}

/** Run both free source discovery and browser discovery for every live request. */
export async function runLiveGapfill(
  spec: SearchSpec,
  deps: LiveGapfillDeps = {},
): Promise<LiveGapfillResult> {
  const { throwIfAborted, isDeadlineAbort } = await import("./search-run");
  throwIfAborted(deps.signal);
  const browser = deps.browser === null ? null : (deps.browser ?? (process.env.VITEST ? async () => [] as SpecRow[] : async (query: SearchSpec, options: { searchRunId?: string; signal?: AbortSignal | null; onProgress?: (event: { action: string; source?: string; detail?: string }) => void; onTrace?: (event: import("./browser-live.server").BrowserTraceEvent) => void }) => {
    const { discoverWithBrowser } = await import("./browser-live.server");
    return discoverWithBrowser(query, options);
  }));
  const sourceResult = await Promise.resolve(runSourceGapfill(spec, deps)).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
  throwIfAborted(deps.signal);
  if (sourceResult.status === "rejected" && sourceResult.reason instanceof Error && sourceResult.reason.message === "SEARCH_CANCELLED") {
    throw sourceResult.reason;
  }

  const source = sourceResult.status === "fulfilled" ? sourceResult.value : null;
  const initialCandidates = [...(deps.initialCandidates ?? []), ...(source?.rows ?? [])];
  const desiredCount = Math.max(1, deps.desiredCount ?? 10);
  const isVerified = deps.isVerified ?? ((row: SpecRow) => row.disposition === "qualified" || row.verification_status === "verified");
  const verifiedCount = initialCandidates.filter(isVerified).length;
  const shouldBrowse = !!browser && verifiedCount < desiredCount;
  const matchSeed = fieldOf(spec, "opportunity") === "no_website"
    ? (await import("@/lib/spec-search.functions")).rowSatisfiesSpec
    : null;
  // Browser research is the scarce budget. A seed whose known category, role
  // or location already contradicts the request (a structured source's
  // generic "company" office for "marketing agencies") is never researched.
  const specGate = !matchSeed && initialCandidates.length ? await import("@/lib/spec-search.functions") : null;
  const researchable = (row: SpecRow) => !specGate || specGate.rowCouldSatisfySpec(spec, specGate.sanitizeSpecRow(row, spec));
  const browserSeeds = matchSeed
    ? initialCandidates
        .filter((row) => !row.website_url && row.no_website_verification?.structured_absence === true &&
          !!row.no_website_verification.structured_source_url && matchSeed(spec, row))
        .sort((a, b) => {
          const strength = (row: SpecRow) =>
            Number(!!row.phone) * 4 + Number(!!row.email) * 3 +
            Number(!!row.detail && row.detail !== row.location) * 2 +
            Number(!!row.category) + Number(!!row.entity_resolved);
          return strength(b) - strength(a);
        })
        .slice(0, Math.min(20, Math.max(15, desiredCount * 2)))
    : initialCandidates.filter(researchable).slice(0, 6);
  const researchPlan = buildResearchPlan(spec, { desiredCount });
  const browserOptions = {
    ...(deps.searchRunId ? { searchRunId: deps.searchRunId } : {}),
    ...(deps.ownerId ? { ownerId: deps.ownerId } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.onBrowserProgress ? { onProgress: deps.onBrowserProgress } : {}),
    ...(deps.onBrowserTrace ? { onTrace: deps.onBrowserTrace } : {}),
    researchPlan,
    initialCandidates: browserSeeds,
    desiredCount,
    isVerified,
    // Leave time for final enrichment/qualification before the 120s run abort.
    timeoutMs: spec.entity === "company" ? 75_000 : 90_000,
  };
  const browserResult = shouldBrowse
    ? await Promise.resolve(browser(spec, browserOptions)).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      )
    : ({ status: "fulfilled" as const, value: [] as SpecRow[] });
  // Keep browser rows on the hard deadline: the research is already paid
  // for, and the caller finalizes whatever qualifies. Only a real
  // cancellation stops delivery here.
  if (deps.signal?.aborted && !isDeadlineAbort(deps.signal)) throwIfAborted(deps.signal);
  if (browserResult.status === "rejected" && browserResult.reason instanceof Error && browserResult.reason.message === "SEARCH_CANCELLED") {
    throw browserResult.reason;
  }

  const browserRows = browserResult.status === "fulfilled" ? browserResult.value : [];
  const diagnostics: ProviderDiagnostic[] = [...(source?.diagnostics ?? [])];
  if (sourceResult.status === "rejected") {
    diagnostics.push({
      provider: "structured-live",
      attempted: true,
      succeeded: false,
      artifactsFound: 0,
      entitiesResolved: 0,
      qualified: 0,
      outcome: "SOURCE_ERROR",
      error: sourceResult.reason instanceof Error ? sourceResult.reason.message : String(sourceResult.reason),
    });
  }
  diagnostics.push({
    provider: "browser-live",
    attempted: shouldBrowse,
    succeeded: browserResult.status === "fulfilled",
    artifactsFound: browserRows.length,
    entitiesResolved: 0,
    qualified: 0,
    ...(browserResult.status === "rejected" ? {
      outcome: "SOURCE_ERROR" as const,
      error: browserResult.reason instanceof Error ? browserResult.reason.message : String(browserResult.reason),
    } : {}),
  });

  const rows = mergeDuplicateCandidates([...(source?.rows ?? []), ...browserRows]);
  return {
    rows,
    engine: browserRows.length ? (source?.rows.length ? `${source.engine}+browser` : "live-browser") : (source?.engine ?? "live-none"),
    scanned: (source?.scanned ?? 0) + browserRows.length,
    plan: source?.plan,
    diagnostics,
  };
}
