import type { Evidence } from "@/lib/search/evidence";
import { whyMatchFromEvidence } from "@/lib/search/evidence";
import type { SearchSpec } from "@/lib/search/search-spec";
import { rowSatisfiesSpec, type SpecRow } from "@/lib/spec-search.functions";
import { detectOperationalStatus } from "./operational-status";
import { researchEvent } from "./events";
import type {
  FieldEvidence,
  ResearchBudgets,
  ResearchCandidate,
  ResearchEvent,
  ResearchMetrics,
  ResearchResult,
  RetrievalPlan,
  SignalEvidence,
  SignalType,
} from "./types";
import { DEFAULT_RESEARCH_BUDGETS } from "./types";

export interface StoredResearchResult {
  rows: SpecRow[];
  hasMore: boolean;
  source: string;
}

export interface LiveResearchResult {
  rows: SpecRow[];
  exhausted: boolean;
  source: string;
}

export interface BrowserResearchProviderResult {
  candidates: ResearchCandidate[];
  events?: ResearchEvent[];
  pages: number;
  actions: number;
  screenshots: number;
  reasoningCalls: number;
}

export interface ResearchOrchestratorDeps {
  storedSearch?: (
    plan: RetrievalPlan,
    args: { limit: number; offset: number; signal?: AbortSignal | null },
  ) => Promise<StoredResearchResult>;
  enrich?: (
    row: SpecRow,
    plan: RetrievalPlan,
    args: { signal?: AbortSignal | null; missingFields: string[] },
  ) => Promise<SpecRow>;
  liveSearch?: (
    plan: RetrievalPlan,
    args: { limit: number; signal?: AbortSignal | null },
  ) => Promise<LiveResearchResult>;
  browserResearch?: (
    plan: RetrievalPlan,
    candidates: ResearchCandidate[],
    args: { sessionId: string; signal?: AbortSignal | null; onEvent?: (event: ResearchEvent) => void },
  ) => Promise<BrowserResearchProviderResult>;
  now?: () => Date;
}

type Continuation = {
  version: 1;
  offset: number;
  returnedIds: string[];
  attemptedQueries: string[];
  exhaustedSources: string[];
};

function continuation(token: string | null | undefined): Continuation {
  if (!token) return { version: 1, offset: 0, returnedIds: [], attemptedQueries: [], exhaustedSources: [] };
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Continuation;
    if (parsed.version !== 1 || !Array.isArray(parsed.returnedIds)) throw new Error("bad token");
    return parsed;
  } catch {
    throw new Error("INVALID_RESEARCH_CONTINUATION");
  }
}

function encodeContinuation(value: Continuation): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function candidateId(row: SpecRow): string {
  return row.entity_id?.trim() || row.key?.trim() || row.url?.trim() ||
    `${row.kind}:${normalized(row.title)}:${normalized(row.location ?? row.country ?? row.detail)}`;
}

function identityKey(candidate: ResearchCandidate): string {
  const row = candidate.row;
  if (row.entity_id && !row.entity_id.startsWith("provisional:")) return `id:${row.entity_id}`;
  if (row.key) return `key:${row.key}`;
  if (row.url) {
    try {
      const url = new URL(row.url);
      return `url:${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
    } catch { /* fall through */ }
  }
  if (row.phone) return `phone:${row.phone.replace(/\D/g, "")}`;
  return `exact:${row.kind}:${normalized(row.title)}:${normalized(row.location ?? row.country ?? "")}`;
}

function sourceLocator(row: SpecRow): string {
  return row.url ?? `urn:scrapivo:stored:${encodeURIComponent(candidateId(row))}`;
}

function fieldEvidenceForRow(row: SpecRow, observedAt: string): FieldEvidence[] {
  const sourceUrl = sourceLocator(row);
  const values: Array<[string, string | number | boolean | null | undefined]> = [
    ["identity", row.title], ["location", row.location], ["country", row.country],
    ["category", row.category], ["industry", row.industry], ["sector", row.sector],
    ["stage", row.stage], ["email", row.email], ["phone", row.phone], ["website", row.url],
    ["employer", row.employer], ["salary", row.salary],
  ];
  return values.filter((entry): entry is [string, string | number | boolean] =>
    entry[1] !== null && entry[1] !== undefined && String(entry[1]).trim().length > 0)
    .map(([field, value]) => ({
      field,
      value,
      sourceUrl,
      sourceType: row.url ? "public-page" : "canonical-stored-corpus",
      observedAt,
      evidenceGrade: row.url ? "A" : "B",
      confidence: row.identity_confidence ?? 0.85,
      note: row.url ? "Published source field." : "Canonical stored source value.",
    }));
}

function signalType(evidence: Evidence): SignalType | null {
  if (evidence.evidence_type === "hiring") return "HIRING";
  if (evidence.evidence_type === "service_request") return "SEEKING_SERVICE";
  if (evidence.evidence_type === "funding") return "RECENTLY_FUNDED";
  if (evidence.evidence_type === "no_website") return "NO_WEBSITE";
  if (evidence.evidence_type === "social_ask") return "SEEKING_JOB";
  return null;
}

function signalsForRow(row: SpecRow, now: Date): SignalEvidence[] {
  return (row.evidence ?? []).flatMap((evidence) => {
    const type = signalType(evidence);
    if (!type) return [];
    const eventMs = evidence.event_at ? Date.parse(evidence.event_at) : NaN;
    const age = Number.isFinite(eventMs) ? now.getTime() - eventMs : Infinity;
    return [{
      type,
      claim: evidence.excerpt ?? evidence.evidence_type,
      sourceUrl: evidence.source_url,
      sourceType: evidence.source_type,
      observedAt: evidence.observed_at,
      eventAt: evidence.event_at,
      freshness: age <= 7 * 86_400_000 ? "CURRENT" : age <= 90 * 86_400_000 ? "RECENT" : Number.isFinite(age) ? "STALE" : "UNKNOWN",
      confidence: evidence.confidence,
      evidenceGrade: evidence.source_type === "registry" || evidence.source_type === "job" ? "A" : evidence.source_type === "web" || evidence.source_type === "news" ? "B" : "C",
      snippetOrObservation: evidence.excerpt ?? evidence.evidence_type,
    } satisfies SignalEvidence];
  });
}

function requiredValue(row: SpecRow, field: string): boolean {
  const value = field.toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "email") return !!row.email;
  if (value === "phone" || value === "phone_number") return !!row.phone;
  if (value === "website" || value === "url") return !!row.url;
  if (value === "contact" || value === "public_contact" || value === "contact_channel") return !!(row.email || row.phone || row.url);
  if (value === "location" || value === "geography") return !!(row.location || row.country);
  if (value === "role" || value === "title") return !!(row.title && row.detail);
  if (value === "company" || value === "employer") return !!(row.employer || row.detail);
  if (value === "category") return !!row.category;
  if (value === "industry") return !!(row.industry || row.category);
  if (value === "signal") return !!row.evidence?.some((item) => signalType(item));
  return true;
}

function missingFields(row: SpecRow, plan: RetrievalPlan): string[] {
  const missing = plan.requiredFields.filter((field) => !requiredValue(row, field));
  if (!row.title?.trim()) missing.push("identity");
  if (row.kind === "job" && !row.url) missing.push("url");
  return [...new Set(missing)];
}

function candidateFromRow(row: SpecRow, origin: ResearchCandidate["origin"], now: Date): ResearchCandidate {
  const evidence = row.evidence ?? [];
  const status = row.kind === "business"
    ? detectOperationalStatus([row.detail, ...evidence.map((item) => item.excerpt ?? "")])
    : "UNKNOWN";
  return {
    id: candidateId(row),
    row,
    state: "MATCHED",
    origin,
    evidence,
    fieldEvidence: fieldEvidenceForRow(row, now.toISOString()),
    signals: signalsForRow(row, now),
    operationalStatus: status,
    operationalStatusEvidence: [],
    missingFields: [],
    rejectionReason: null,
    whyMatch: row.why_match ?? whyMatchFromEvidence(evidence),
  };
}

function hasRequiredSignal(candidate: ResearchCandidate, plan: RetrievalPlan): boolean {
  if (!plan.signalRequired && !plan.freshnessRequired) return true;
  const window = plan.temporal?.match(/^(\d+)([dwm])$/i);
  const windowMs = window
    ? Number(window[1]) * ({ d: 86_400_000, w: 7 * 86_400_000, m: 30 * 86_400_000 }[window[2]!.toLowerCase()] ?? 0)
    : null;
  return candidate.signals.some((signal) =>
    (!plan.signalTypes.length || plan.signalTypes.includes(signal.type)) &&
    (!plan.freshnessRequired || (
      windowMs !== null && signal.eventAt
        ? Date.now() - Date.parse(signal.eventAt) <= windowMs
        : signal.freshness === "CURRENT" || (!windowMs && signal.freshness === "RECENT")
    )));
}

function needsBrowser(candidate: ResearchCandidate, plan: RetrievalPlan): boolean {
  if (plan.signalRequired || plan.freshnessRequired) return !hasRequiredSignal(candidate, plan);
  if (candidate.row.kind === "business") return candidate.operationalStatus === "UNKNOWN";
  if (plan.signalTypes.includes("NO_WEBSITE")) return true;
  return candidate.missingFields.length > 0 && !!candidate.row.url;
}

function matchesPlan(candidate: ResearchCandidate, plan: RetrievalPlan): boolean {
  if (!rowSatisfiesSpec(plan.spec, candidate.row)) return false;
  const location = normalized([
    candidate.row.location,
    candidate.row.country,
    candidate.row.detail,
  ].filter(Boolean).join(" "));
  return !plan.excludedLocations.some((excluded) => location.includes(normalized(excluded)));
}

function whyMatch(candidate: ResearchCandidate, plan: RetrievalPlan): string | null {
  if (candidate.signals.length) {
    const signal = candidate.signals[0]!;
    return `${signal.claim}. Evidence: ${signal.sourceUrl}`;
  }
  if (candidate.whyMatch) return candidate.whyMatch;
  const clauses: string[] = [];
  if (plan.role && normalized(candidate.row.title).includes(normalized(plan.role))) clauses.push(`role matches ${plan.role}`);
  if (plan.category && normalized(candidate.row.category).includes(normalized(plan.category))) clauses.push(`category matches ${plan.category}`);
  if (plan.industry && normalized(candidate.row.industry ?? candidate.row.category).includes(normalized(plan.industry))) clauses.push(`industry matches ${plan.industry}`);
  if (plan.location && normalized([candidate.row.location, candidate.row.country, candidate.row.detail].filter(Boolean).join(" ")).includes(normalized(plan.location))) clauses.push(`location matches ${plan.location}`);
  if (!clauses.length && candidate.fieldEvidence.length) clauses.push("identity and requested fields are supported by source evidence");
  return clauses.length ? clauses.join("; ") : null;
}

function score(candidate: ResearchCandidate, plan: RetrievalPlan): number {
  const required = plan.requiredFields.length || 1;
  const satisfied = plan.requiredFields.filter((field) => requiredValue(candidate.row, field)).length;
  const evidence = candidate.fieldEvidence.reduce((sum, item) => sum + ({ A: 4, B: 3, C: 2, D: 0 }[item.evidenceGrade]), 0);
  const signal = candidate.signals.some((item) => item.freshness === "CURRENT") ? 20 : candidate.signals.length ? 10 : 0;
  const reachability = candidate.row.email || candidate.row.phone ? 10 : candidate.row.url ? 5 : 0;
  return (satisfied / required) * 40 + Math.min(20, evidence) + signal + reachability + (candidate.row.relevance_score ?? 0) * 10;
}

function dedupe(candidates: ResearchCandidate[]): { rows: ResearchCandidate[]; duplicates: number } {
  const seen = new Map<string, ResearchCandidate>();
  let duplicates = 0;
  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, candidate);
      continue;
    }
    duplicates += 1;
    const stronger = prior.fieldEvidence.length + prior.evidence.length >= candidate.fieldEvidence.length + candidate.evidence.length ? prior : candidate;
    const weaker = stronger === prior ? candidate : prior;
    seen.set(key, {
      ...stronger,
      evidence: [...stronger.evidence, ...weaker.evidence],
      fieldEvidence: [...stronger.fieldEvidence, ...weaker.fieldEvidence],
      signals: [...stronger.signals, ...weaker.signals],
    });
  }
  return { rows: [...seen.values()], duplicates };
}

async function defaultStoredSearch(
  plan: RetrievalPlan,
  args: { limit: number; offset: number; signal?: AbortSignal | null },
): Promise<StoredResearchResult> {
  const { runSpecSearchCore } = await import("@/lib/spec-search.functions");
  const answers = Object.fromEntries(plan.spec.criteria.map((item) => [item.field, item.value]));
  const result = await runSpecSearchCore(
    plan.spec.raw_query,
    { liveGapfill: null, providerBusinesses: null, providerJobs: null, enrichFn: null, signal: args.signal },
    args.limit,
    answers,
    { force: true, offset: args.offset },
  );
  return { rows: result.rows, hasMore: result.hasMore, source: result.dbMeta.map((item) => item.engine).join(",") || "known-sources" };
}

async function defaultEnrich(
  row: SpecRow,
  plan: RetrievalPlan,
  args: { signal?: AbortSignal | null },
): Promise<SpecRow> {
  const { enrichCandidateForSpec } = await import("@/lib/search/enrichment-run");
  return (await enrichCandidateForSpec(row, plan.spec, {
    signal: args.signal,
    budget: { maxPaidCalls: 0, maxContactHarvest: 1, maxSteps: 4 },
  })).row;
}

async function defaultLiveSearch(
  plan: RetrievalPlan,
  args: { limit: number; signal?: AbortSignal | null },
): Promise<LiveResearchResult> {
  const { runLiveGapfill } = await import("@/lib/search/live-gapfill");
  const result = await runLiveGapfill(plan.spec, { signal: args.signal });
  return { rows: result.rows.slice(0, args.limit), exhausted: result.rows.length < args.limit, source: result.engine };
}

async function defaultBrowserResearch(
  plan: RetrievalPlan,
  candidates: ResearchCandidate[],
  args: { sessionId: string; signal?: AbortSignal | null; onEvent?: (event: ResearchEvent) => void },
): Promise<BrowserResearchProviderResult> {
  const [{ AgentBrowserCliAdapter }, { researchCandidatesWithBrowser }] = await Promise.all([
    import("./agent-browser-cli.server"),
    import("./browser-research.server"),
  ]);
  return researchCandidatesWithBrowser({
    browser: new AgentBrowserCliAdapter(undefined, args.signal),
    sessionId: `${args.sessionId}-browser`,
    plan,
    candidates,
    visible: process.env.RESEARCH_BROWSER_VISIBLE?.toLowerCase() !== "false",
    onEvent: args.onEvent,
    signal: args.signal,
  });
}

function emptyMetrics(): ResearchMetrics {
  return {
    storedCandidates: 0, storedReady: 0, enriched: 0, liveDiscovered: 0,
    browserDiscovered: 0, browserVerified: 0, rejected: 0, duplicates: 0,
    finalDelivered: 0, timeToFirstVerifiedMs: null, totalLatencyMs: 0,
    providerCalls: 0, browserActions: 0, pages: 0, screenshots: 0,
    aiCalls: { understanding: 0, stored: 0, providers: 0, enrichment: 0, browserReasoning: 0 },
  };
}

export class ResearchOrchestrator {
  constructor(private readonly deps: ResearchOrchestratorDeps = {}) {}

  async run(args: {
    plan: RetrievalPlan;
    sessionId?: string;
    continuationToken?: string | null;
    signal?: AbortSignal | null;
    budgets?: Partial<ResearchBudgets>;
    onEvent?: (event: ResearchEvent) => void;
  }): Promise<ResearchResult> {
    const sessionId = args.sessionId ?? `research-${crypto.randomUUID()}`;
    const started = Date.now();
    const now = this.deps.now ?? (() => new Date());
    const budgets = { ...DEFAULT_RESEARCH_BUDGETS, ...args.budgets };
    const prior = continuation(args.continuationToken);
    const priorIds = new Set(prior.returnedIds);
    const events: ResearchEvent[] = [];
    const metrics = emptyMetrics();
    let cancelled = false;
    let liveExhausted = false;
    let storedHasMore = false;
    const emit = (event: ResearchEvent) => {
      events.push(event);
      args.onEvent?.(event);
    };
    const ensureActive = () => {
      if (args.signal?.aborted) throw new Error("SEARCH_CANCELLED");
      if (Date.now() - started > budgets.maxWallTimeMs) throw new Error("RESEARCH_TIME_BUDGET_EXHAUSTED");
    };

    emit(researchEvent({ sessionId, type: "UNDERSTANDING_READY", phase: "UNDERSTANDING", internal: { entity: args.plan.entity, targetQuantity: args.plan.targetQuantity } }));
    emit(researchEvent({ sessionId, type: "RESEARCH_STARTED", phase: "KNOWN_SOURCES", internal: { continuation: !!args.continuationToken } }));
    emit(researchEvent({ sessionId, type: "KNOWN_SOURCE_SEARCH_STARTED", phase: "KNOWN_SOURCES" }));

    const storedSearch = this.deps.storedSearch ?? defaultStoredSearch;
    const liveSearch = this.deps.liveSearch ?? defaultLiveSearch;
    const enrich = this.deps.enrich ?? defaultEnrich;
    const browserResearch = this.deps.browserResearch ?? defaultBrowserResearch;
    const currentResearchRequired = args.plan.signalRequired || args.plan.freshnessRequired || args.plan.entity === "job";
    const collectionTarget = Math.min(budgets.maxCandidates, Math.max(args.plan.targetQuantity * 2, args.plan.targetQuantity + 10));
    const livePromise = currentResearchRequired
      ? (metrics.providerCalls++, liveSearch(args.plan, { limit: collectionTarget, signal: args.signal }))
      : null;

    let candidates: ResearchCandidate[] = [];
    try {
      ensureActive();
      const stored = args.plan.entity === "job"
        ? { rows: [], hasMore: false, source: "no-stored-job-corpus" }
        : await storedSearch(args.plan, { limit: collectionTarget, offset: prior.offset, signal: args.signal });
      storedHasMore = stored.hasMore;
      metrics.storedCandidates = stored.rows.length;
      candidates = stored.rows.map((row) => candidateFromRow(row, "stored", now()));
      for (const candidate of candidates) candidate.missingFields = missingFields(candidate.row, args.plan);
      metrics.storedReady = candidates.filter((candidate) => !candidate.missingFields.length).length;
      emit(researchEvent({ sessionId, type: "KNOWN_SOURCE_RESULTS", phase: "KNOWN_SOURCES", internal: { source: stored.source, count: candidates.length }, candidateCount: candidates.length }));

      const incomplete = candidates.filter((candidate) => candidate.missingFields.length);
      if (incomplete.length) {
        emit(researchEvent({ sessionId, type: "ENRICHMENT_STARTED", phase: "ENRICHMENT", internal: { count: incomplete.length } }));
        for (const candidate of incomplete.slice(0, budgets.maxCandidates)) {
          ensureActive();
          candidate.state = "ENRICHING";
          emit(researchEvent({ sessionId, type: "FIELD_LOOKUP", phase: "ENRICHMENT", internal: { candidateId: candidate.id, fields: candidate.missingFields } }));
          let enriched: SpecRow;
          try {
            enriched = await enrich(candidate.row, args.plan, { signal: args.signal, missingFields: candidate.missingFields });
          } catch (error) {
            if (args.signal?.aborted || (error instanceof Error && error.message === "SEARCH_CANCELLED")) throw error;
            candidate.state = "NEEDS_ENRICHMENT";
            emit(researchEvent({ sessionId, type: "SOURCE_FAILED", phase: "ENRICHMENT", internal: { candidateId: candidate.id, error: error instanceof Error ? error.message : String(error) } }));
            continue;
          }
          candidate.row = enriched;
          candidate.missingFields = missingFields(enriched, args.plan);
          candidate.state = candidate.missingFields.length ? "NEEDS_ENRICHMENT" : "READY_FOR_VERIFICATION";
          candidate.fieldEvidence = fieldEvidenceForRow(enriched, now().toISOString());
          candidate.evidence = enriched.evidence ?? candidate.evidence;
          candidate.signals = signalsForRow(enriched, now());
          metrics.enriched += 1;
        }
      }

      const readyBeforeLive = candidates.filter((candidate) => !candidate.missingFields.length).length;
      if (currentResearchRequired || readyBeforeLive < args.plan.targetQuantity) {
        emit(researchEvent({ sessionId, type: "LIVE_SEARCH_STARTED", phase: "LIVE_SEARCH", internal: { reason: currentResearchRequired ? "freshness_or_signal" : "quantity_shortfall" } }));
        const live = livePromise ?? (metrics.providerCalls++, liveSearch(args.plan, { limit: collectionTarget, signal: args.signal }));
        let liveResult: LiveResearchResult;
        try {
          liveResult = await live;
        } catch (error) {
          if (args.signal?.aborted || (error instanceof Error && error.message === "SEARCH_CANCELLED")) throw error;
          liveResult = { rows: [], exhausted: true, source: "unavailable" };
          emit(researchEvent({ sessionId, type: "SOURCE_FAILED", phase: "LIVE_SEARCH", internal: { error: error instanceof Error ? error.message : String(error) } }));
        }
        liveExhausted = liveResult.exhausted;
        metrics.liveDiscovered = liveResult.rows.length;
        emit(researchEvent({ sessionId, type: "SOURCE_SELECTED", phase: "LIVE_SEARCH", internal: { source: liveResult.source, count: liveResult.rows.length }, candidateCount: liveResult.rows.length }));
        candidates.push(...liveResult.rows.map((row) => candidateFromRow(row, "live", now())));
      }

      const deduped = dedupe(candidates.filter((candidate) => !priorIds.has(candidate.id)));
      metrics.duplicates = deduped.duplicates;
      candidates = deduped.rows;
      for (const candidate of candidates) {
        candidate.missingFields = missingFields(candidate.row, args.plan);
        if (!matchesPlan(candidate, args.plan)) {
          candidate.state = "REJECTED";
          candidate.rejectionReason = "query_mismatch";
          emit(researchEvent({ sessionId, type: "CANDIDATE_REJECTED", phase: "VERIFICATION", internal: { candidateId: candidate.id, reason: "query_mismatch" } }));
        }
      }

      const browserTargets = candidates.filter((candidate) => candidate.state !== "REJECTED" && needsBrowser(candidate, args.plan));
      if (browserTargets.length) {
        try {
          const researched = await browserResearch(args.plan, browserTargets, {
            sessionId,
            signal: args.signal,
            onEvent: (event) => {
              if (!events.some((known) => known.timestamp === event.timestamp && known.type === event.type && known.internal.candidateId === event.internal.candidateId)) emit(event);
            },
          });
          const byId = new Map(researched.candidates.map((candidate) => [candidate.id, candidate]));
          candidates = candidates.map((candidate) => byId.get(candidate.id) ?? candidate);
          metrics.browserVerified = researched.candidates.filter((candidate) => candidate.state === "VERIFIED").length;
          metrics.browserActions = researched.actions;
          metrics.pages = researched.pages;
          metrics.screenshots = researched.screenshots;
          metrics.aiCalls.browserReasoning = researched.reasoningCalls;
        } catch (error) {
          if (args.signal?.aborted || (error instanceof Error && error.message === "SEARCH_CANCELLED")) throw error;
          emit(researchEvent({ sessionId, type: "SOURCE_FAILED", phase: "BROWSER", internal: { error: error instanceof Error ? error.message : String(error) } }));
        }
      }

      for (const candidate of candidates) {
        candidate.missingFields = missingFields(candidate.row, args.plan);
        if (candidate.state === "REJECTED") continue;
        if (candidate.missingFields.length) {
          candidate.state = "UNRESOLVED";
          candidate.rejectionReason = `missing_required:${candidate.missingFields.join(",")}`;
          continue;
        }
        if (!hasRequiredSignal(candidate, args.plan)) {
          candidate.state = "REJECTED";
          candidate.rejectionReason = "signal_not_verified";
          continue;
        }
        if (candidate.row.kind === "business" && candidate.operationalStatus !== "ACTIVE") {
          candidate.state = candidate.operationalStatus === "UNKNOWN" ? "UNRESOLVED" : "REJECTED";
          candidate.rejectionReason = `operational_status:${candidate.operationalStatus}`;
          continue;
        }
        candidate.state = "QUALIFIED";
        candidate.whyMatch = whyMatch(candidate, args.plan);
        if (!candidate.whyMatch) {
          candidate.state = "UNRESOLVED";
          candidate.rejectionReason = "no_evidence_backed_why_match";
        } else {
          emit(researchEvent({ sessionId, type: "CANDIDATE_ACCEPTED", phase: "DELIVERY", internal: { candidateId: candidate.id } }));
        }
      }
    } catch (error) {
      if (args.signal?.aborted || (error instanceof Error && error.message === "SEARCH_CANCELLED")) {
        cancelled = true;
        emit(researchEvent({ sessionId, type: "CANCELLED", phase: "DELIVERY" }));
      } else {
        emit(researchEvent({ sessionId, type: "SOURCE_FAILED", phase: "LIVE_SEARCH", internal: { error: error instanceof Error ? error.message : String(error) } }));
        throw error;
      }
    }

    // Cancellation stops new work, but already-ready candidates remain deliverable.
    if (cancelled) {
      for (const candidate of candidates) {
        if (candidate.state === "REJECTED" || candidate.state === "UNRESOLVED") continue;
        candidate.missingFields = missingFields(candidate.row, args.plan);
        if (!candidate.missingFields.length && hasRequiredSignal(candidate, args.plan) &&
          (candidate.row.kind !== "business" || candidate.operationalStatus === "ACTIVE")) {
          candidate.state = "QUALIFIED";
          candidate.whyMatch = whyMatch(candidate, args.plan);
        }
      }
    }

    const ranked = candidates.filter((candidate) => candidate.state === "QUALIFIED")
      .sort((a, b) => score(b, args.plan) - score(a, args.plan));
    const delivered = ranked.slice(0, args.plan.targetQuantity);
    metrics.rejected = candidates.filter((candidate) => candidate.state === "REJECTED" || candidate.state === "UNRESOLVED").length;
    metrics.finalDelivered = delivered.length;
    metrics.timeToFirstVerifiedMs = delivered.length ? Date.now() - started : null;
    metrics.totalLatencyMs = Date.now() - started;
    if (delivered.length) emit(researchEvent({ sessionId, type: "RESULTS_READY", phase: "DELIVERY", candidateCount: delivered.length }));
    emit(researchEvent({ sessionId, type: "DONE", phase: "DELIVERY", internal: { delivered: delivered.length, cancelled } }));

    const needsMore = !cancelled && !args.plan.explicitQuantity &&
      (ranked.length > delivered.length || storedHasMore || !liveExhausted);
    const next: Continuation = {
      version: 1,
      offset: prior.offset + (delivered.length || metrics.storedCandidates),
      returnedIds: [...prior.returnedIds, ...delivered.map((candidate) => candidate.id)].slice(-2_000),
      attemptedQueries: [...new Set([...prior.attemptedQueries, args.plan.spec.raw_query])],
      exhaustedSources: [...new Set([...prior.exhaustedSources, ...(liveExhausted ? ["live"] : []), ...(!storedHasMore ? ["stored"] : [])])],
    };
    return {
      sessionId,
      plan: args.plan,
      candidates: delivered,
      events,
      needsMore,
      exhausted: !storedHasMore && liveExhausted && delivered.length < args.plan.targetQuantity,
      cancelled,
      continuationToken: needsMore || delivered.length < args.plan.targetQuantity ? encodeContinuation(next) : null,
      metrics,
    };
  }
}

export function assertStoredPathUsesNoAI(metrics: ResearchMetrics): void {
  if (metrics.aiCalls.stored !== 0 || metrics.aiCalls.providers !== 0) {
    throw new Error(`stored/provider AI calls must be zero: ${JSON.stringify(metrics.aiCalls)}`);
  }
}

export function searchSpecForPlan(plan: RetrievalPlan): SearchSpec {
  return plan.spec;
}
