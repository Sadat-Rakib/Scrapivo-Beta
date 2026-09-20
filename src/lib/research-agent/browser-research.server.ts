import type { Evidence } from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { AgentBrowser, BrowserSession, PageSnapshot } from "./browser";
import { detectOperationalStatus, operationalStatusAccepted, statusEvidence } from "./operational-status";
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

async function verifyNoWebsite(
  browser: AgentBrowser,
  session: BrowserSession,
  candidate: ResearchCandidate,
  plan: RetrievalPlan,
): Promise<{ signal: SignalEvidence | null; snapshot: PageSnapshot }> {
  const name = candidate.row.title;
  const location = candidate.row.location ?? plan.location ?? "";
  const first = await browser.search(session, `"${name}" "${location}" official website`);
  const second = await browser.search(session, `"${name}" "${location}" contact`);
  if ([...first.snapshot.friction, ...second.snapshot.friction]
    .some((item) => item === "CAPTCHA" || item === "ACCESS_BLOCK" || item === "RATE_LIMIT")) {
    return { signal: null, snapshot: second.snapshot };
  }
  const ignored = /facebook|instagram|linkedin|yelp|yellowpages|map|directory|tripadvisor/i;
  const links = [...first.snapshot.links, ...second.snapshot.links];
  const hasOwned = links
    .some((link) => link.url && !ignored.test(link.url));
  if (hasOwned || links.length === 0) return { signal: null, snapshot: second.snapshot };
  const observedAt = new Date().toISOString();
  return {
    signal: {
      type: "NO_WEBSITE",
      claim: `No owned website found as of ${observedAt.slice(0, 10)}`,
      sourceUrl: second.snapshot.url,
      sourceType: "search-presence-check",
      observedAt,
      eventAt: null,
      freshness: "CURRENT",
      confidence: 0.76,
      evidenceGrade: "B",
      snippetOrObservation: "Two exact-name search variants found no likely owned domain.",
    },
    snapshot: second.snapshot,
  };
}

export async function researchCandidatesWithBrowser(args: {
  browser: AgentBrowser;
  sessionId: string;
  plan: RetrievalPlan;
  candidates: ResearchCandidate[];
  visible?: boolean;
  onEvent?: (event: ResearchEvent) => void;
}): Promise<BrowserResearchResult> {
  const events: ResearchEvent[] = [];
  const emit = (event: ResearchEvent) => {
    events.push(event);
    args.onEvent?.(event);
  };
  const session = await args.browser.createSession({ id: args.sessionId, visible: args.visible ?? true });
  emit(researchEvent({ sessionId: args.sessionId, type: "BROWSER_SESSION_STARTED", phase: "BROWSER" }));
  const output: ResearchCandidate[] = [];
  try {
    for (const candidate of args.candidates) {
      let current = { ...candidate };
      if (args.plan.signalTypes.includes("NO_WEBSITE") && !current.row.url) {
        emit(researchEvent({ sessionId: args.sessionId, type: "CHECKING_SIGNAL", phase: "BROWSER", internal: { candidateId: current.id, signal: "NO_WEBSITE" } }));
        const checked = await verifyNoWebsite(args.browser, session, current, args.plan);
        if (checked.signal) {
          current = { ...current, signals: [...current.signals, checked.signal] };
          emit(researchEvent({ sessionId: args.sessionId, type: "SIGNAL_FOUND", phase: "BROWSER", internal: { candidateId: current.id, signal: "NO_WEBSITE" }, domain: new URL(checked.snapshot.url).hostname }));
        }
        output.push(current);
        continue;
      }
      if (!current.row.url) {
        output.push({ ...current, state: "UNRESOLVED", rejectionReason: "no_public_page_for_browser_verification" });
        continue;
      }

      emit(researchEvent({ sessionId: args.sessionId, type: "NAVIGATING", phase: "BROWSER", internal: { candidateId: current.id, url: current.row.url }, domain: new URL(current.row.url).hostname }));
      const observation = await args.browser.navigate(session, current.row.url);
      emit(researchEvent({ sessionId: args.sessionId, type: "PAGE_LOADED", phase: "BROWSER", internal: { candidateId: current.id, pageType: observation.snapshot.pageType }, domain: new URL(observation.snapshot.url).hostname }));
      const friction = observation.snapshot.friction;
      if (friction.includes("CAPTCHA")) {
        emit(researchEvent({ sessionId: args.sessionId, type: "CAPTCHA_DETECTED", phase: "BROWSER", internal: { candidateId: current.id } }));
        emit(researchEvent({ sessionId: args.sessionId, type: "HUMAN_ACTION_REQUIRED", phase: "BROWSER", internal: { candidateId: current.id } }));
        output.push({ ...current, state: "UNRESOLVED", rejectionReason: "captcha" });
        continue;
      }
      if (friction.includes("LOGIN_WALL") || friction.includes("ACCESS_BLOCK") || friction.includes("RATE_LIMIT")) {
        emit(researchEvent({ sessionId: args.sessionId, type: "ACCESS_RESTRICTED", phase: "BROWSER", internal: { candidateId: current.id, friction } }));
        output.push({ ...current, state: "UNRESOLVED", rejectionReason: "access_restricted" });
        continue;
      }

      emit(researchEvent({ sessionId: args.sessionId, type: "INSPECTING_PAGE", phase: "BROWSER", internal: { candidateId: current.id } }));
      const screenshotRef = await args.browser.screenshot(session);
      const now = new Date();
      const email = firstEmail(observation.snapshot.visibleRelevantText);
      const phone = firstPhone(observation.snapshot.visibleRelevantText);
      const fields = [
        ...(email && !current.row.email ? [contactEvidence("email", email, observation.snapshot, now)] : []),
        ...(phone && !current.row.phone ? [contactEvidence("phone", phone, observation.snapshot, now)] : []),
      ];
      if (fields.length) emit(researchEvent({ sessionId: args.sessionId, type: "CONTACT_FOUND", phase: "BROWSER", internal: { candidateId: current.id, fields: fields.map((item) => item.field) }, screenshotRef }));

      emit(researchEvent({ sessionId: args.sessionId, type: "CHECKING_STATUS", phase: "BROWSER", internal: { candidateId: current.id } }));
      const operationalStatus = detectOperationalStatus([observation.snapshot.visibleRelevantText]);
      const statusProof = statusEvidence({
        status: operationalStatus,
        sourceUrl: observation.snapshot.url,
        observation: operationalStatus === "UNKNOWN" ? "No explicit operational status found." : `Page states ${operationalStatus}.`,
        observedAt: now.toISOString(),
      });
      if (!operationalStatusAccepted(operationalStatus)) {
        output.push({
          ...current,
          state: "REJECTED",
          operationalStatus,
          operationalStatusEvidence: [...current.operationalStatusEvidence, statusProof],
          rejectionReason: `operational_status:${operationalStatus}`,
        });
        emit(researchEvent({ sessionId: args.sessionId, type: "CANDIDATE_REJECTED", phase: "VERIFICATION", internal: { candidateId: current.id, reason: `operational_status:${operationalStatus}` } }));
        continue;
      }

      const signals = args.plan.signalRequired || args.plan.freshnessRequired
        ? signalsFromSnapshot(observation.snapshot, args.plan.signalTypes, now)
        : [];
      if (signals.length) emit(researchEvent({ sessionId: args.sessionId, type: "SIGNAL_FOUND", phase: "BROWSER", internal: { candidateId: current.id, signalTypes: signals.map((item) => item.type) }, screenshotRef }));
      const legacyEvidence = signals.map((signal) => signalAsLegacyEvidence(signal, current.id));
      current = {
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
      output.push(current);
    }
  } finally {
    await args.browser.close(session);
  }
  return {
    candidates: output,
    events,
    pages: session.counters.pages,
    actions: session.counters.actions,
    screenshots: session.counters.screenshots,
    reasoningCalls: 0,
  };
}
