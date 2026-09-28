import type { Evidence } from "@/lib/search/evidence";
import { makeEvidence } from "@/lib/search/evidence";
import {
  verifyWebsiteAbsence,
  WEBSITE_NOT_FOUND_AFTER_VERIFICATION,
} from "@/lib/search/absence-verification";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { AgentBrowser, BrowserObservation, BrowserSession, PageSnapshot } from "./browser";
import {
  fetchStaticPage,
  registrableDomainOf,
  researchConcurrency,
  requiresRendering,
  runCandidateTasks,
  staticPageToSnapshot,
  type StaticFetch,
  type StaticPageRead,
} from "./candidate-acquisition.server";
import { detectOperationalStatus, operationalStatusAccepted, statusEvidence } from "./operational-status";
import {
  classifyPageRelevance,
  PAGE_LEVEL_STOP_VERDICTS,
} from "@/lib/search/page-relevance";
import {
  acquireHostSlot,
  hostBlockedUntil,
  HostPaceError,
  isLoopbackHost,
  noteBrowserAction,
  noteHostResponse,
  releaseHostSlot,
} from "@/lib/search/domain-pacer.server";
import { canonicalJobUrl, recognizeUrl } from "@/lib/sources/recognize";
import { isNeverContactHost } from "@/lib/sources/registry";
import { resilientFetch } from "@/lib/search/http-fetch.server";
import { researchEvent } from "./events";
import type {
  FieldEvidence,
  ResearchCandidate,
  ResearchEvent,
  RetrievalPlan,
  SignalEvidence,
  SignalType,
} from "./types";

export interface BrowserResearchResult {
  candidates: ResearchCandidate[];
  events: ResearchEvent[];
  pages: number;
  actions: number;
  screenshots: number;
  reasoningCalls: 0;
}

function firstEmail(text: string): string | null {
  return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
}

function firstPhone(text: string): string | null {
  return text.match(/(?:\+?\d[\d .()/-]{7,}\d)/)?.[0]?.trim() ?? null;
}

function observedEventAt(text: string, now: Date): string | null {
  const days = text.match(/\b(\d{1,3})\s+days?\s+ago\b/i);
  if (days) return new Date(now.getTime() - Number(days[1]) * 86_400_000).toISOString();
  const hours = text.match(/\b(\d{1,3})\s+hours?\s+ago\b/i);
  if (hours) return new Date(now.getTime() - Number(hours[1]) * 3_600_000).toISOString();
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso ? new Date(`${iso[1]}T00:00:00.000Z`).toISOString() : null;
}

const SIGNAL_PATTERNS: Array<{ type: SignalType; pattern: RegExp; claim: string }> = [
  { type: "HIRING", pattern: /\b(we(?:'re| are) hiring|now hiring|open roles?|join our team|apply now)\b/i, claim: "Current hiring activity" },
  { type: "SEEKING_JOB", pattern: /\b(open to work|looking for (?:a )?(?:new )?(?:role|job|work)|available for hire)\b/i, claim: "Publicly seeking work" },
  { type: "SEEKING_SERVICE", pattern: /\b(looking for|seeking|need(?:ing)?)\b.{0,80}\b(agency|consultant|freelancer|provider|help)\b/i, claim: "Publicly seeking a service" },
  { type: "FUNDRAISING", pattern: /\b(raising|fundraising|seeking investors?)\b/i, claim: "Fundraising activity" },
  { type: "RECENTLY_FUNDED", pattern: /\b(raised|funding round|seed round|series [a-e])\b/i, claim: "Funding event" },
  { type: "EXPANDING", pattern: /\b(expanding|new office|new location|growing our team)\b/i, claim: "Expansion activity" },
  { type: "PRODUCT_LAUNCH", pattern: /\b(launched|introducing|now available|product launch)\b/i, claim: "Product launch" },
  { type: "ROLE_CHANGE", pattern: /\b(joined as|appointed|promoted to|new role)\b/i, claim: "Role change" },
];

function signalsFromSnapshot(snapshot: PageSnapshot, requested: SignalType[], now: Date): SignalEvidence[] {
  const wanted = new Set(requested);
  const eventAt = observedEventAt(snapshot.visibleRelevantText, now);
  return SIGNAL_PATTERNS
    .filter((item) => (!wanted.size || wanted.has(item.type)) && item.pattern.test(snapshot.visibleRelevantText))
    .map((item) => {
      const snippet = snapshot.visibleRelevantText.match(item.pattern)?.[0] ?? item.claim;
      const currentLanguage = /\b(now|current|open|today|this week|we(?:'re| are))\b/i.test(snippet);
      return {
        type: item.type,
        claim: item.claim,
        sourceUrl: snapshot.url,
        sourceType: "company-controlled-web",
        observedAt: now.toISOString(),
        eventAt,
        freshness: eventAt || currentLanguage ? "CURRENT" : "UNKNOWN",
        confidence: 0.82,
        evidenceGrade: "A",
        snippetOrObservation: snippet.slice(0, 240),
      } satisfies SignalEvidence;
    });
}

function contactEvidence(field: "email" | "phone", value: string, snapshot: PageSnapshot, now: Date): FieldEvidence {
  return {
    field,
    value,
    sourceUrl: snapshot.url,
    sourceType: "company-controlled-web",
    observedAt: now.toISOString(),
    evidenceGrade: "A",
    confidence: 0.9,
    note: "Published on the opened public page.",
  };
}

function signalAsLegacyEvidence(signal: SignalEvidence, subject: string): Evidence {
  const evidenceType = signal.type === "HIRING" ? "hiring" :
    signal.type === "SEEKING_SERVICE" ? "service_request" :
    signal.type === "RECENTLY_FUNDED" || signal.type === "FUNDRAISING" ? "funding" : "other";
  return {
    source_url: signal.sourceUrl,
    source_type: "web",
    excerpt: signal.snippetOrObservation,
    observed_at: signal.observedAt,
    event_at: signal.eventAt,
    evidence_type: evidenceType,
    supports: signal.type === "SEEKING_SERVICE" ? "intent" : "other",
    confidence: signal.confidence,
    extraction_method: "deterministic-page-pattern",
    subject,
  };
}

function withRowContact(row: SpecRow, email: string | null, phone: string | null): SpecRow {
  return { ...row, email: row.email ?? email, phone: row.phone ?? phone };
}

/**
 * A browser page read failed when the navigation threw, the snapshot reports
 * an error loading state, or the page is completely empty (no title, no text,
 * no links) — the zero-result failure mode behind past "Read page" failures.
 */
function pageReadFailed(snapshot: PageSnapshot): boolean {
  return snapshot.loadingState === "error" ||
    (!snapshot.title.trim() && !snapshot.visibleRelevantText.trim() && snapshot.links.length === 0);
}

/** Rejection reasons that mean the whole host is degraded (never re-attempted). */
const HOST_LEVEL_REJECTIONS = /^(captcha|access_restricted|page_login_required|page_challenge|page_rate_limited|page_blocked)$/;

/** Outcome of one contact with a host, recorded against its pacing state. */
type HostOutcome = "ok" | "blocked" | "rate_limited" | "challenge" | "error";

/** Host-level outcomes map onto browser friction markers the pacer understands. */
const OUTCOME_FRICTION: Record<Exclude<HostOutcome, "ok" | "error">, string[]> = {
  blocked: ["ACCESS_BLOCK"],
  challenge: ["CAPTCHA"],
  rate_limited: ["RATE_LIMIT"],
};

/** Record a response/verdict against the host's pacing state (no-op for loopback). */
function noteHostOutcome(
  host: string | null,
  outcome: HostOutcome,
  extra: { status?: number; retryAfterHeader?: string | null } = {},
): void {
  if (!host || isLoopbackHost(host)) return;
  if (outcome === "error") {
    noteHostResponse(host, { networkError: true });
    return;
  }
  noteHostResponse(host, {
    status: outcome === "ok" ? (extra.status ?? 200) : undefined,
    friction: outcome === "ok" ? [] : OUTCOME_FRICTION[outcome],
    retryAfterHeader: extra.retryAfterHeader ?? null,
  });
}

/** True when the host asked us to wait (Retry-After) or blocked/challenged us. */
function hostCoolingDown(url: string): boolean {
  const host = safeHost(url);
  return !!host && !isLoopbackHost(host) && hostBlockedUntil(host) > Date.now();
}

/**
 * Paced HTTP fetch for candidate pages: one request in flight per host with
 * polite spacing; 429/503 responses (and their Retry-After) plus network
 * failures are recorded so the rest of the run backs the host off. Throws
 * HostPaceError when the host must not be contacted right now — callers
 * degrade the source and move on instead of retrying it.
 */
function pacedStaticFetch(inner?: StaticFetch): StaticFetch {
  return async (url, init) => {
    const doFetch = inner ?? ((u, i) => resilientFetch(u, { signal: i?.signal ?? undefined, retries: 1, retryDelayMs: 250 }));
    const host = safeHost(url);
    if (!host || isLoopbackHost(host)) return doFetch(url, init);
    await acquireHostSlot(host, { maxConcurrent: 1 });
    try {
      const res = await doFetch(url, init);
      noteHostResponse(host, { status: res.status, retryAfterHeader: res.headers.get("retry-after") });
      return res;
    } catch (error) {
      if (!(error instanceof HostPaceError)) noteHostResponse(host, { networkError: true });
      throw error;
    } finally {
      releaseHostSlot(host);
    }
  };
}

function structuredAbsenceEvidence(candidate: ResearchCandidate): Evidence[] {
  const verification = candidate.row.no_website_verification;
  const fromVerification = verification?.structured_absence === true
    ? [makeEvidence({
        source_url: verification.structured_source_url || `entity:${candidate.id}`,
        source_type: verification.structured_source_url?.startsWith("overture:") ? "db" : "osm",
        excerpt: "Structured listing has no website field.",
        evidence_type: "no_website",
        supports: "opportunity",
        subject: candidate.id,
        confidence: 0.8,
        extraction_method: "structured_listing_website_absent",
        observed_at: new Date().toISOString(),
      })]
    : [];
  const fromEvidence = candidate.evidence.filter((e) =>
    e.evidence_type === "no_website" &&
    e.subject === candidate.id &&
    ["osm_absence_plus_exact_web_check", "structured_absence_plus_exact_web_check", "structured_listing_website_absent"].includes(e.extraction_method ?? ""));
  return [...fromVerification, ...fromEvidence];
}

function searchCheckEvidence(args: {
  query: string;
  snapshot: PageSnapshot;
  kind: "exact_identity_search_check" | "official_domain_search_check";
  subject: string;
}): Evidence {
  return makeEvidence({
    source_url: args.snapshot.url,
    source_type: "web",
    excerpt: `${args.kind === "exact_identity_search_check" ? "Exact identity search" : "Official-domain search"} performed: ${args.query}`,
    evidence_type: "no_website",
    supports: "opportunity",
    subject: args.subject,
    confidence: 0.7,
    extraction_method: args.kind,
    observed_at: new Date().toISOString(),
  });
}

/**
 * H14 absence verification for no_website candidates: the NO_WEBSITE signal is
 * minted ONLY when all four components hold — structured listing(s) without a
 * website field, exact identity search, official-domain search, and no
 * credible first-party site discovered. Exact claim wording is preserved by
 * verifyWebsiteAbsence (never simplified).
 */
async function verifyNoWebsite(
  browser: AgentBrowser,
  session: BrowserSession,
  candidate: ResearchCandidate,
  plan: RetrievalPlan,
  args: { emit: (event: ResearchEvent) => void; sessionId: string },
): Promise<{ signal: SignalEvidence | null; snapshot: PageSnapshot; claimEvidence: Evidence | null }> {
  const name = candidate.row.title;
  const location = candidate.row.location ?? plan.location ?? "";
  const officialQuery = `"${name}" "${location}" official website`;
  const contactQuery = `"${name}" "${location}" contact`;
  const first = await browser.search(session, officialQuery);
  const second = await browser.search(session, contactQuery);
  if ([...first.snapshot.friction, ...second.snapshot.friction]
    .some((item) => item === "CAPTCHA" || item === "ACCESS_BLOCK" || item === "RATE_LIMIT")) {
    return { signal: null, snapshot: second.snapshot, claimEvidence: null };
  }
  const ignored = /facebook|instagram|linkedin|yelp|yellowpages|map|directory|tripadvisor/i;
  const links = [...first.snapshot.links, ...second.snapshot.links];
  const hasOwned = links.some((link) => link.url && !ignored.test(link.url));

  const subject = candidate.id;
  const components = {
    structured_listing_absence: structuredAbsenceEvidence(candidate),
    exact_identity_search: [
      searchCheckEvidence({ query: officialQuery, snapshot: first.snapshot, kind: "exact_identity_search_check", subject }),
      searchCheckEvidence({ query: contactQuery, snapshot: second.snapshot, kind: "exact_identity_search_check", subject }),
    ],
    official_domain_search: [
      searchCheckEvidence({ query: officialQuery, snapshot: first.snapshot, kind: "official_domain_search_check", subject }),
    ],
    no_first_party_site: hasOwned || links.length === 0 ? [] : [makeEvidence({
      source_url: second.snapshot.url,
      source_type: "web",
      excerpt: "Exact-name searches returned only directory/social results; no credible first-party site discovered.",
      evidence_type: "no_website",
      supports: "opportunity",
      subject,
      confidence: 0.7,
      extraction_method: "no_first_party_site_check",
      observed_at: new Date().toISOString(),
    })],
  };

  const verdict = verifyWebsiteAbsence(components, { subject, observedAt: new Date().toISOString() });
  args.emit(researchEvent({
    sessionId: args.sessionId,
    type: "ACQUISITION_DECIDED",
    phase: "BROWSER",
    internal: {
      candidateId: candidate.id,
      decision: verdict.ok ? "absence_verified" : "absence_unverified",
      missing: verdict.missing,
    },
  }));
  if (!verdict.ok || !verdict.claim) return { signal: null, snapshot: second.snapshot, claimEvidence: null };
  const observedAt = new Date().toISOString();
  return {
    signal: {
      type: "NO_WEBSITE",
      claim: WEBSITE_NOT_FOUND_AFTER_VERIFICATION,
      sourceUrl: verdict.claim.source_url,
      sourceType: "search-presence-check",
      observedAt,
      eventAt: null,
      freshness: "CURRENT",
      confidence: 0.76,
      evidenceGrade: "B",
      snippetOrObservation: "website not found after verification: structured listing lacks a website field; exact identity and official-domain searches performed; no first-party site found.",
    },
    snapshot: second.snapshot,
    claimEvidence: verdict.claim,
  };
}

/**
 * Shared evidence pipeline for one successfully read page (browser snapshot or
 * HTTP static snapshot) — contacts, operational status, required signals.
 */
function verifyCandidateFromSnapshot(args: {
  candidate: ResearchCandidate;
  snapshot: PageSnapshot;
  plan: RetrievalPlan;
  now: Date;
  screenshotRef?: string | null;
  emit: (event: ResearchEvent) => void;
  sessionId: string;
}): ResearchCandidate {
  const { candidate: current, snapshot, plan, now, emit, sessionId } = args;
  const friction = snapshot.friction;
  if (friction.includes("CAPTCHA")) {
    emit(researchEvent({ sessionId, type: "CAPTCHA_DETECTED", phase: "BROWSER", internal: { candidateId: current.id } }));
    emit(researchEvent({ sessionId, type: "HUMAN_ACTION_REQUIRED", phase: "BROWSER", internal: { candidateId: current.id } }));
    return { ...current, state: "UNRESOLVED", rejectionReason: "captcha" };
  }
  if (friction.includes("LOGIN_WALL") || friction.includes("ACCESS_BLOCK") || friction.includes("RATE_LIMIT")) {
    emit(researchEvent({ sessionId, type: "ACCESS_RESTRICTED", phase: "BROWSER", internal: { candidateId: current.id, friction } }));
    return { ...current, state: "UNRESOLVED", rejectionReason: "access_restricted" };
  }

  // Goal-conditioned relevance gate (§23-32): before extracting anything,
  // refuse pages that are legal/boilerplate furniture, a login/challenge
  // shell, or otherwise un-usable. THIN is left to the read ladders (short
  // contact pages can legitimately carry an email/phone); entity-name
  // matching stays with the qualification layer. Friction verdicts
  // (challenge/login/rate-limit/blocked) are NOT stopped here — the
  // pre-existing friction handling above owns them and their Take-Control
  // handoff (captcha reason + CAPTCHA_DETECTED / HUMAN_ACTION_REQUIRED).
  const relevance = classifyPageRelevance({
    url: snapshot.url,
    title: snapshot.title,
    text: snapshot.visibleRelevantText,
    friction: snapshot.friction,
    entityName: current.row.title ?? undefined,
  });
  const frictionDriven = relevance.reason.startsWith("friction:");
  if (!relevance.keepExtracting && !frictionDriven && PAGE_LEVEL_STOP_VERDICTS.has(relevance.verdict)) {
    emit(researchEvent({
      sessionId, type: "SOURCE_FAILED", phase: "BROWSER",
      internal: { candidateId: current.id, verdict: relevance.verdict, reason: relevance.reason, url: snapshot.url },
      domain: safeHost(snapshot.url),
    }));
    return { ...current, state: "UNRESOLVED", rejectionReason: `page_${relevance.verdict.toLowerCase()}` };
  }

  emit(researchEvent({ sessionId, type: "INSPECTING_PAGE", phase: "BROWSER", internal: { candidateId: current.id } }));
  const screenshotRef = args.screenshotRef ?? null;
  const email = firstEmail(snapshot.visibleRelevantText);
  const phone = firstPhone(snapshot.visibleRelevantText);
  const fields = [
    ...(email && !current.row.email ? [contactEvidence("email", email, snapshot, now)] : []),
    ...(phone && !current.row.phone ? [contactEvidence("phone", phone, snapshot, now)] : []),
  ];
  if (fields.length) emit(researchEvent({ sessionId, type: "CONTACT_FOUND", phase: "BROWSER", internal: { candidateId: current.id, fields: fields.map((item) => item.field) }, screenshotRef }));

  emit(researchEvent({ sessionId, type: "CHECKING_STATUS", phase: "BROWSER", internal: { candidateId: current.id } }));
  const operationalStatus = detectOperationalStatus([snapshot.visibleRelevantText]);
  const statusProof = statusEvidence({
    status: operationalStatus,
    sourceUrl: snapshot.url,
    observation: operationalStatus === "UNKNOWN" ? "No explicit operational status found." : `Page states ${operationalStatus}.`,
    observedAt: now.toISOString(),
  });
  if (!operationalStatusAccepted(operationalStatus)) {
    emit(researchEvent({ sessionId, type: "CANDIDATE_REJECTED", phase: "VERIFICATION", internal: { candidateId: current.id, reason: `operational_status:${operationalStatus}` } }));
    return {
      ...current,
      state: "REJECTED",
      operationalStatus,
      operationalStatusEvidence: [...current.operationalStatusEvidence, statusProof],
      rejectionReason: `operational_status:${operationalStatus}`,
    };
  }

  const signals = plan.signalRequired || plan.freshnessRequired
    ? signalsFromSnapshot(snapshot, plan.signalTypes, now)
    : [];
  if (signals.length) emit(researchEvent({ sessionId, type: "SIGNAL_FOUND", phase: "BROWSER", internal: { candidateId: current.id, signalTypes: signals.map((item) => item.type) }, screenshotRef }));
  const legacyEvidence = signals.map((signal) => signalAsLegacyEvidence(signal, current.id));
  return {
    ...current,
    row: withRowContact(current.row, email, phone),
    state: "VERIFIED",
    fieldEvidence: [...current.fieldEvidence, ...fields],
    signals: [...current.signals, ...signals],
    evidence: [...current.evidence, ...legacyEvidence],
    operationalStatus,
    operationalStatusEvidence: [...current.operationalStatusEvidence, statusProof],
    rejectionReason: null,
  };
}

/**
 * HTTP-first sufficiency: mirror of the orchestrator's needsBrowser() triggers.
 * Static acquisition is sufficient only when every trigger that sent this
 * candidate to browser research is resolved by the fetched page.
 */
function staticResolvesTriggers(read: StaticPageRead, candidate: ResearchCandidate, plan: RetrievalPlan): boolean {
  if (plan.signalRequired || plan.freshnessRequired) {
    if (!signalsFromSnapshot(staticPageToSnapshot(read), plan.signalTypes, new Date()).length) return false;
  }
  if (candidate.row.kind === "business" && candidate.operationalStatus === "UNKNOWN") {
    if (detectOperationalStatus([read.text]) === "UNKNOWN") return false;
  }
  const contactFields = new Set(["email", "phone", "phone_number", "contact", "public_contact", "contact_channel"]);
  if (candidate.missingFields.some((field) => !contactFields.has(field))) return false;
  const needsContact = candidate.missingFields.filter((field) => contactFields.has(field));
  if (needsContact.length) {
    const needEmail = needsContact.some((f) => f === "email" || f.includes("contact"));
    const needPhone = needsContact.some((f) => f.startsWith("phone") || f.includes("contact"));
    if ((needEmail && !read.emails.length) || (needPhone && !read.phones.length)) return false;
  }
  return true;
}

/**
 * HTTP-first acquisition policy: candidate research pages (official sites,
 * team pages, contact pages) are fetched + extracted over HTTP first; the
 * browser is used only when HTTP is insufficient or the page class requires
 * rendering. needsBrowser() routing in the orchestrator is unchanged.
 */
async function acquireStatically(
  candidate: ResearchCandidate,
  args: { plan: RetrievalPlan; signal?: AbortSignal | null; fetchPage?: StaticFetch; emit: (event: ResearchEvent) => void; sessionId: string },
): Promise<{ candidate: ResearchCandidate; read: StaticPageRead | null }> {
  const url = candidate.row.url!;
  if (requiresRendering(url)) {
    args.emit(researchEvent({
      sessionId: args.sessionId, type: "ACQUISITION_DECIDED", phase: "BROWSER",
      internal: { candidateId: candidate.id, decision: "rendering_required" },
    }));
    return { candidate, read: null };
  }
  const read = await fetchStaticPage(url, { signal: args.signal, fetchPage: args.fetchPage });
  args.emit(researchEvent({
    sessionId: args.sessionId, type: "ACQUISITION_DECIDED", phase: "BROWSER",
    internal: { candidateId: candidate.id, decision: read.decision, staticUsable: read.staticUsable, status: read.status },
  }));
  if (!read.staticUsable) return { candidate, read: null };
  if (staticResolvesTriggers(read, candidate, args.plan)) {
    const now = new Date();
    const verified = verifyCandidateFromSnapshot({
      candidate, snapshot: staticPageToSnapshot(read), plan: args.plan!, now,
      screenshotRef: null, emit: args.emit, sessionId: args.sessionId,
    });
    return { candidate: verified, read };
  }
  // Not sufficient — harvest whatever contacts HTTP did find, then escalate.
  const harvested = {
    ...candidate,
    row: withRowContact(candidate.row, read.emails[0] ?? null, read.phones[0] ?? null),
    fieldEvidence: [
      ...candidate.fieldEvidence,
      ...(read.emails[0] && !candidate.row.email
        ? [contactEvidence("email", read.emails[0], staticPageToSnapshot(read), new Date())] : []),
      ...(read.phones[0] && !candidate.row.phone
        ? [contactEvidence("phone", read.phones[0], staticPageToSnapshot(read), new Date())] : []),
    ],
  };
  return { candidate: harvested, read: null };
}

/**
 * Read-failure ladder for browser page reads:
 *   browser fail → exactly one browser retry → HTTP fallback → SOURCE_DEGRADED.
 * No infinite retries; abort signals respected throughout.
 */
async function readWithLadder(args: {
  browser: AgentBrowser;
  session: BrowserSession;
  url: string;
  candidateId: string;
  signal?: AbortSignal | null;
  fetchPage?: StaticFetch;
  emit: (event: ResearchEvent) => void;
  sessionId: string;
}): Promise<{ observation: BrowserObservation } | "degraded"> {
  const { browser, session, url, candidateId, emit, sessionId } = args;
  // Beta-reality fix (§15/§16): search-result pages (Bing/Google/SearXNG SERPs)
  // must never consume browser budget — live runs burned 8 pages/10 actions
  // paginating a Bing SERP instead of reading candidate pages. Recognized SERP
  // URLs are skipped before any navigation.
  if (recognizeUrl(url).kind === "search") {
    emit(researchEvent({
      sessionId, type: "SOURCE_FAILED", phase: "BROWSER",
      internal: { code: "SEARCH_RESULTS_PAGE_SKIPPED", candidateId, url },
      domain: safeHost(url),
      message: "That's a search results page, not a source — reading the actual results instead.",
    }));
    return "degraded";
  }
  const attempt = async (): Promise<BrowserObservation> => {
    const host = safeHost(url);
    const paced = !!host && !isLoopbackHost(host);
    if (paced) await acquireHostSlot(host!, { maxConcurrent: 1 });
    try {
      const observation = await browser.navigate(session, url);
      if (pageReadFailed(observation.snapshot)) {
        if (paced) noteBrowserAction(host!, { networkError: true });
        throw new Error(`Read page:${candidateId}`);
      }
      // Friction markers (captcha / access block / rate limit) recorded here
      // back the whole host off for later candidates too.
      if (paced) noteBrowserAction(host!, { status: 200, friction: observation.snapshot.friction });
      return observation;
    } finally {
      if (paced) releaseHostSlot(host!);
    }
  };
  let firstError: unknown = null;
  try {
    return { observation: await attempt() };
  } catch (error) {
    if (args.signal?.aborted) throw error;
    // The host refused contact outright (Retry-After beyond the wait cap, or
    // an active block/challenge): degrade immediately — no retry, no HTTP
    // fallback, no repeated attempts against the same host.
    if (error instanceof HostPaceError) {
      emit(researchEvent({
        sessionId, type: "SOURCE_DEGRADED", phase: "BROWSER",
        internal: { code: "SOURCE_DEGRADED", candidateId, url, reason: error.code },
        domain: safeHost(url),
        message: "This site is asking us to wait before visiting again; research continued without it.",
      }));
      return "degraded";
    }
    firstError = error;
  }
  emit(researchEvent({
    sessionId, type: "READ_RETRY", phase: "BROWSER",
    internal: { candidateId, attempt: 2, error: firstError instanceof Error ? firstError.message : String(firstError) },
  }));
  try {
    return { observation: await attempt() };
  } catch (retryError) {
    if (args.signal?.aborted) throw retryError;
  }
  // HTTP fallback after exactly one browser retry.
  const read = await fetchStaticPage(url, { signal: args.signal, fetchPage: args.fetchPage });
  if (read.staticUsable) {
    emit(researchEvent({
      sessionId, type: "ACQUISITION_DECIDED", phase: "BROWSER",
      internal: { candidateId, decision: "static_used", mode: "http_fallback", status: read.status },
    }));
    return { observation: { snapshot: staticPageToSnapshot(read), action: "http_fallback", expectedState: null, verified: true } };
  }
  emit(researchEvent({
    sessionId, type: "SOURCE_DEGRADED", phase: "BROWSER",
    internal: {
      code: "SOURCE_DEGRADED",
      candidateId,
      url,
      browserError: firstError instanceof Error ? firstError.message : String(firstError),
      httpStatus: read.status,
      httpError: read.error ?? null,
    },
  }));
  return "degraded";
}

/**
 * Parallel candidate research: up to `concurrency` candidates in flight
 * (SCRAPIVO_RESEARCH_CONCURRENCY, default 3, clamped 1–6), strict
 * per-registrable-domain serialization. Results keep input order so dedupe,
 * merge, and evidence attachment stay candidate-correct.
 */
export async function researchCandidatesWithBrowser(args: {
  browser: AgentBrowser;
  sessionId: string;
  plan: RetrievalPlan;
  candidates: ResearchCandidate[];
  visible?: boolean;
  onEvent?: (event: ResearchEvent) => void;
  signal?: AbortSignal | null;
  fetchPage?: StaticFetch;
  concurrency?: number;
}): Promise<BrowserResearchResult> {
  const events: ResearchEvent[] = [];
  const emit = (event: ResearchEvent) => {
    events.push(event);
    args.onEvent?.(event);
  };
  const degradedSources = new Set<string>();
  const degradedKey = (url: string): string => registrableDomainOf(url) ?? url;
  // Every HTTP fetch of a candidate page goes through the host pacer.
  const pacedFetch = pacedStaticFetch(args.fetchPage);
  const counters = { pages: 0, actions: 0, screenshots: 0 };
  let sessionCounter = 0;

  const workOne = async (candidate: ResearchCandidate): Promise<ResearchCandidate> => {
    try {
      // NO_WEBSITE candidates: absence rule (H14) over browser searches.
      if (args.plan.signalTypes.includes("NO_WEBSITE") && !candidate.row.url) {
        emit(researchEvent({ sessionId: args.sessionId, type: "CHECKING_SIGNAL", phase: "BROWSER", internal: { candidateId: candidate.id, signal: "NO_WEBSITE" } }));
        const session = await args.browser.createSession({ id: `${args.sessionId}-${++sessionCounter}`, visible: args.visible ?? true });
        try {
          const checked = await verifyNoWebsite(args.browser, session, candidate, args.plan, { emit, sessionId: args.sessionId });
          if (checked.signal) {
            const claimEvidence = checked.claimEvidence ? [checked.claimEvidence] : [];
            emit(researchEvent({
              sessionId: args.sessionId, type: "SIGNAL_FOUND", phase: "BROWSER",
              internal: { candidateId: candidate.id, signal: "NO_WEBSITE" },
              domain: safeHost(checked.snapshot.url),
            }));
            return {
              ...candidate,
              signals: [...candidate.signals, checked.signal],
              evidence: [...candidate.evidence, ...claimEvidence],
            };
          }
          return candidate;
        } finally {
          counters.pages += session.counters.pages;
          counters.actions += session.counters.actions;
          counters.screenshots += session.counters.screenshots;
          await args.browser.close(session);
        }
      }
      if (!candidate.row.url) {
        return { ...candidate, state: "UNRESOLVED", rejectionReason: "no_public_page_for_browser_verification" };
      }
      const url = candidate.row.url;
      // Source recognition first: never contact hosts known to block
      // automated access, and route recognized structured job boards to the
      // structured feed instead of browsing the human careers site.
      const recognized = recognizeUrl(url);
      const host = safeHost(url);
      if (recognized.kind === "blocked" || (host !== null && isNeverContactHost(host))) {
        emit(researchEvent({
          sessionId: args.sessionId, type: "SOURCE_FAILED", phase: "BROWSER",
          internal: { code: "SOURCE_BLOCKS_AUTOMATED_ACCESS", candidateId: candidate.id, url, recognition: recognized.kind },
          domain: recognized.host || host,
          message: "This site blocks automated access, so research moved on to another source.",
        }));
        return { ...candidate, state: "UNRESOLVED", rejectionReason: "source_blocks_automated_access" };
      }
      if (recognized.kind === "ats" && recognized.ats && recognized.board) {
        // Structured job data exists for this employer — do not browse the
        // human site. The hint rides on the candidate's evidence so the jobs
        // pipeline can fetch the structured feed instead.
        emit(researchEvent({
          sessionId: args.sessionId, type: "ACQUISITION_DECIDED", phase: "BROWSER",
          internal: { candidateId: candidate.id, decision: "structured_source_used", url },
          domain: recognized.host,
          message: "This employer's openings are published as structured job data; using that instead of opening the site.",
        }));
        return {
          ...candidate,
          evidence: [...candidate.evidence, makeEvidence({
            source_url: url,
            source_type: "other",
            excerpt: `Employer openings are published through a recognized structured job board (${recognized.ats}/${recognized.board}).`,
            evidence_type: "other",
            supports: "other",
            subject: candidate.id,
            extraction_method: "structured_job_source_recognition",
            claim_parameters: {
              ats: recognized.ats,
              board: recognized.board,
              ...(recognized.jobId ? { job_id: recognized.jobId } : {}),
              ...(recognized.sourceId ? { source_id: recognized.sourceId } : {}),
              canonical_job_key: canonicalJobUrl(url),
            },
            confidence: 0.9,
          })],
          rejectionReason: null,
        };
      }
      if (degradedSources.has(degradedKey(url))) {
        return { ...candidate, state: "UNRESOLVED", rejectionReason: "source_degraded" };
      }
      // The host asked us to wait (Retry-After) or blocked/challenged us
      // earlier in this run or a recent one: skip it without any contact.
      if (hostCoolingDown(url)) {
        degradedSources.add(degradedKey(url));
        emit(researchEvent({
          sessionId: args.sessionId, type: "SOURCE_DEGRADED", phase: "BROWSER",
          internal: { code: "SOURCE_DEGRADED", candidateId: candidate.id, url, reason: "host_asked_to_wait" },
          domain: host,
          message: "Waiting before revisiting this site; research continued without it.",
        }));
        return { ...candidate, state: "UNRESOLVED", rejectionReason: "source_degraded" };
      }

      // HTTP-first acquisition policy (paced per host).
      let working = candidate;
      const acquired = await acquireStatically(working, {
        signal: args.signal, fetchPage: pacedFetch, emit, sessionId: args.sessionId, plan: args.plan,
      });
      working = acquired.candidate;
      if (acquired.read) {
        // Static page carried sufficient evidence — browser never called.
        counters.pages += 1;
        return working;
      }

      // Browser phase with read-failure ladder.
      const session = await args.browser.createSession({ id: `${args.sessionId}-${++sessionCounter}`, visible: args.visible ?? true });
      try {
        emit(researchEvent({
          sessionId: args.sessionId, type: "NAVIGATING", phase: "BROWSER",
          internal: { candidateId: working.id, url }, domain: safeHost(url),
        }));
        const result = await readWithLadder({
          browser: args.browser, session, url, candidateId: working.id,
          signal: args.signal, fetchPage: pacedFetch, emit, sessionId: args.sessionId,
        });
        if (result === "degraded") {
          degradedSources.add(degradedKey(url));
          return { ...working, state: "UNRESOLVED", rejectionReason: "source_degraded" };
        }
        const observation = result.observation;
        emit(researchEvent({
          sessionId: args.sessionId, type: "PAGE_LOADED", phase: "BROWSER",
          internal: { candidateId: working.id, pageType: observation.snapshot.pageType },
          domain: safeHost(observation.snapshot.url),
        }));
        const screenshotRef = await args.browser.screenshot(session).catch(() => null);
        const verified = verifyCandidateFromSnapshot({
          candidate: working, snapshot: observation.snapshot, plan: args.plan, now: new Date(),
          screenshotRef, emit, sessionId: args.sessionId,
        });
        // Host-level failures (captcha / access restricted / blocked or
        // challenge verdicts) degrade the whole registrable domain for the
        // rest of the run — never re-attempted — and are recorded against the
        // host's pacing state so later candidates skip it while it blocks or
        // asks us to wait. LOGIN_WALL is page-level: run-local degradation
        // only, never a cross-run host block.
        if (verified.rejectionReason && HOST_LEVEL_REJECTIONS.test(verified.rejectionReason)) {
          degradedSources.add(degradedKey(url));
          if (verified.rejectionReason !== "page_login_required") {
            noteHostOutcome(
              safeHost(observation.snapshot.url),
              verified.rejectionReason === "captcha" ? "challenge"
                : verified.rejectionReason === "page_rate_limited" ? "rate_limited"
                : "blocked",
            );
          }
        }
        return verified;
      } finally {
        counters.pages += session.counters.pages;
        counters.actions += session.counters.actions;
        counters.screenshots += session.counters.screenshots;
        await args.browser.close(session);
      }
    } catch (error) {
      if (args.signal?.aborted) throw error;
      // Unexpected per-candidate failure must never sink the run.
      emit(researchEvent({
        sessionId: args.sessionId, type: "SOURCE_DEGRADED", phase: "BROWSER",
        internal: {
          code: "SOURCE_DEGRADED", candidateId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      return { ...candidate, state: "UNRESOLVED", rejectionReason: "source_degraded" };
    }
  };

  const tasks = args.candidates.map((candidate) => ({
    domain: candidate.row.url ? registrableDomainOf(candidate.row.url) : "search",
    work: () => workOne(candidate),
  }));
  const pool = await runCandidateTasks(tasks, args.concurrency ?? researchConcurrency(), args.signal);
  const firstError = pool.errors[0]?.error;
  if (firstError) throw firstError;
  // Session counters accumulate in `counters` after each session closes; one
  // final read for any session still open is not needed (all closed above).
  return {
    candidates: args.candidates.map((candidate, index) => pool.results[index] ?? candidate),
    events,
    pages: counters.pages,
    actions: counters.actions,
    screenshots: counters.screenshots,
    reasoningCalls: 0,
  };
}

function safeHost(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}
