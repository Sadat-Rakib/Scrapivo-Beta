import type { JsonValue, ResearchEvent, ResearchEventType, ResearchPhase } from "./types";

const COPY: Record<ResearchEventType, string> = {
  UNDERSTANDING_READY: "Request understood.",
  RESEARCH_STARTED: "Research started.",
  KNOWN_SOURCE_SEARCH_STARTED: "Checking known public sources…",
  KNOWN_SOURCE_RESULTS: "Known-source candidates checked.",
  ENRICHMENT_STARTED: "Checking a few missing details…",
  FIELD_LOOKUP: "Checking a missing field…",
  LIVE_SEARCH_STARTED: "Searching the public web…",
  SOURCE_SELECTED: "Checking a relevant public source…",
  BROWSER_SESSION_STARTED: "Opening a research browser…",
  NAVIGATING: "Opening a public page…",
  PAGE_LOADED: "Public page loaded.",
  INSPECTING_PAGE: "Inspecting public evidence…",
  CLICKING: "Opening a relevant page section…",
  TYPING: "Entering a research query…",
  SCROLLING: "Checking more page content…",
  OPENING_PROFILE: "Opening a public profile…",
  OPENING_WEBSITE: "Opening the organization website…",
  CHECKING_CONTACT: "Checking published contact details…",
  CONTACT_FOUND: "Found a published contact channel.",
  CHECKING_SIGNAL: "Checking for a current intent signal…",
  SIGNAL_FOUND: "Found a current intent signal.",
  CHECKING_STATUS: "Checking operational status…",
  CANDIDATE_ACCEPTED: "Verified a promising match.",
  CANDIDATE_REJECTED: "Skipped a candidate that did not qualify.",
  CAPTCHA_DETECTED: "A source requested human verification.",
  ACCESS_RESTRICTED: "A source restricted public access.",
  HUMAN_ACTION_REQUIRED: "Human action is required to continue on this source.",
  SOURCE_FAILED: "A public source was unavailable.",
  FALLBACK: "Trying another permitted source…",
  RESULTS_READY: "Verified results are ready.",
  CANCELLED: "Research cancelled. Verified results were preserved.",
  DONE: "Research complete.",
};

export function researchEvent(args: {
  sessionId: string;
  type: ResearchEventType;
  phase: ResearchPhase;
  internal?: Record<string, JsonValue>;
  message?: string;
  domain?: string | null;
  screenshotRef?: string | null;
  candidateCount?: number;
  timestamp?: string;
}): ResearchEvent {
  return {
    sessionId: args.sessionId,
    timestamp: args.timestamp ?? new Date().toISOString(),
    type: args.type,
    phase: args.phase,
    internal: args.internal ?? {},
    message: args.message ?? COPY[args.type],
    domain: args.domain,
    screenshotRef: args.screenshotRef,
    candidateCount: args.candidateCount,
  };
}
