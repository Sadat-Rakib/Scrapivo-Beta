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
import {
  makeEvidence,
  structuralNoWebsiteEvidence,
  whyMatchFromEvidence,
  type Evidence,
} from "./evidence";
import { applyQualificationGate } from "./qualify";
import { mintProvisionalEntityId } from "./canonical-contract";
import { applyPageClassificationToLiveRow } from "./page-classify";
import { applyEntityResolutionToRow } from "./entity-resolve";
import {
  buildSourcePlan,
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
function craftFromTag(tag: string, fallback: string): string {
  const t = (tag ?? "").trim().toLowerCase();
  if (!t) return fallback;
  if (/dental|dentist/.test(t)) return "dentist";
  if (/plumb/.test(t)) return "plumber";
  if (/caf[eé]|coffee|roaster/.test(t)) return "cafe";
  if (/yoga/.test(t)) return "yoga";
  if (/restaurant|fast_food|bistro/.test(t)) return "restaurant";
  return fallback;
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
      category: craftFromTag(tag, category),
      location,
      country: null,
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
  const roleBits = query.trim();
  const loc = location && !/^(worldwide|global|anywhere)$/i.test(location) ? location : "";
  const requested =
    (spec &&
      (fieldOf(spec, "requested_role") ||
        fieldOf(spec, "requested_service") ||
        fieldOf(spec, "requested_product"))) ||
    "";
  const funding = spec ? fieldOf(spec, "funding_status") : null;
  const q =
    entity === "person"
      ? [roleBits, requested, loc, "founder OR CEO OR CTO"].filter(Boolean).join(" ")
      : entity === "company"
        ? [
            roleBits,
            requested,
            funding ? "funded OR raised OR series" : null,
            loc,
            "company OR startup",
          ]
            .filter(Boolean)
            .join(" ")
        : [roleBits, loc].filter(Boolean).join(" ");
  if (!q.trim()) return [];
  const { results } = await discoverWebFreeFirst({
    queries: [q],
    maxQueries: 8,
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
      detail: [snippet, loc].filter(has).join(" · "),
      email: null,
      phone: null,
      url,
      location: loc || null,
      country: null,
      evidence,
      why_match: why,
      verification_status: "discovered" as const,
    };
    const classified = applyPageClassificationToLiveRow(base);
    return applyEntityResolutionToRow(classified);
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
    // Structural no_website only when we observed absence from a real source
    // (resolved entity with explicit empty site). Never from "SERP found nothing".
    if (opp === "no_website" && !withOpp.url) {
      const subject =
        withOpp.entity_id?.trim() ||
        withOpp.key?.trim() ||
        null;
      const fromOsm = (withOpp.key ?? "").startsWith("live-osm:");
      const resolved = withOpp.entity_resolved === true || fromOsm;
      if (subject && resolved) {
        const ev = [
          structuralNoWebsiteEvidence({
            source_url: fromOsm ? `osm:${withOpp.key}` : subject,
            source_type: fromOsm ? "osm" : "db",
            extraction_method: fromOsm ? "osm_tags" : "registry_no_website",
            observation: `No website on file for ${withOpp.title}`,
          }),
        ].map((e) => ({ ...e, subject }));
        return {
          ...withOpp,
          entity_id: withOpp.entity_id ?? subject,
          entity_resolved: true,
          page_type: withOpp.page_type ?? "entity_page",
          evidence: ev,
        };
      }
    }
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

/** Run live gapfill for thin DB or signal-required specs. */
export async function runLiveGapfill(
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
  const plan = buildSourcePlan(spec, requirements);
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
        const rows = await osm(spec.raw_query, location, category);
        record("osm-local", {
          attempted: true,
          succeeded: true,
          artifactsFound: rows.length,
          role: "primary",
          costTier: 1,
        });
        if (rows.length) {
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
        const reqRole = fieldOf(spec, "requested_role");
        const reqSvc = fieldOf(spec, "requested_service");
        const funding = fieldOf(spec, "funding_status");
        const parts = [
          role,
          model,
          category,
          location,
          reqRole,
          reqSvc,
          funding ? "funded startup" : null,
          spec.raw_query,
        ].filter(has);
        const q = [...new Set(parts)].join(" ");
        const entity =
          spec.entity === "business" ||
          spec.entity === "company" ||
          spec.entity === "person"
            ? spec.entity
            : "company";
        const rows = await web(q || spec.raw_query, location, entity, spec);
        record(step.providerId, {
          attempted: true,
          succeeded: true,
          artifactsFound: rows.length,
          role: "primary",
          costTier: step.costTier,
        });
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
