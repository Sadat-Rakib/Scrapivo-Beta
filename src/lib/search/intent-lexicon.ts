/**
 * Central urgency + demand-bucket lexicon for Scrapivo signal quality.
 * Used by validation, scoring, match_reasons, and source boosts.
 */

export type DemandBucket =
  | "explicit_demand"
  | "pain"
  | "workaround"
  | "switching"
  | "timing"
  | "hiring";

/** High-urgency phrases (ranked roughly by strength). */
export const URGENCY_PHRASES: string[] = [
  // Extreme
  "urgently", "urgent", "asap", "a.s.a.p", "immediately", "right away",
  "as soon as possible", "stat", "emergency", "critically need",
  "desperate for", "desperately need", "need yesterday",
  // Near-term deadlines
  "this week", "by end of week", "eod", "end of day", "cob", "close of business",
  "by friday", "by monday", "by tomorrow", "by tonight", "today", "tonight",
  "this morning", "this afternoon", "need by", "needed by", "deadline",
  "due by", "must hire by", "start by", "starting this week", "starting next week",
  "start immediately", "can start immediately", "looking to start",
  "start asap", "hire asap", "hiring asap", "fill asap", "filled asap",
  // Mass / volume
  "mass hiring", "hiring multiple", "hiring several", "need multiple",
  "several openings", "multiple roles", "team expansion now",
  // Strong need language
  "we really need", "really need", "urgently hiring", "urgent hire",
  "urgent need", "pressing need", "time sensitive", "time-sensitive",
  "can't wait", "cannot wait", "need someone now", "need a person now",
  "looking for someone asap", "need help asap", "help needed urgently",
  "asap hire", "immediate start", "immediate opening", "immediate need",
  "open immediately", "available immediately", "join immediately",
  // Soft but actionable urgency
  "soon as possible", "at the earliest", "as early as possible",
  "priority hire", "top priority", "high priority", "rush project",
  "tight deadline", "short timeline", "quick turnaround", "fast turnaround",
  "need asap", "needed asap", "required urgently", "required immediately",
  "must fill", "must hire", "gotta hire", "got to hire", "have to hire",
  "need someone urgently", "need a developer urgently", "need a designer urgently",
  "hiring right now", "looking right now", "need right now",
];

/** Explicit demand — people asking for a person/tool/service. */
export const EXPLICIT_DEMAND_PHRASES: string[] = [
  // Hire-polarity only — bare "looking for" is overloaded (seller CTAs).
  "looking to hire", "looking for a freelancer", "looking for a developer",
  "looking for a designer", "looking for a contractor", "looking for someone to",
  "looking for help with", "need a ", "need an ", "need someone", "need help with",
  "i need a", "i need an", "we need a", "we need an", "seeking a", "seeking an",
  "want to hire", "anyone know a", "anyone know an",
  "can anyone recommend", "recommend a", "recommend an", "who do you use",
  "anyone who can", "someone who can", "dm me if", "ping me if",
  "help wanted", "freelance needed", "contractor needed", "agency needed",
  "looking for recommendations", "any recommendations for",
  "where can i find", "who can help", "need customers for", // product sellers hunting buyers
  "customers for my", "clients for my", "users for my",
];

/** Pain / frustration. */
export const PAIN_PHRASES: string[] = [
  "frustrated", "struggling", "can't figure out", "cannot figure out",
  "tired of", "sick of", "hate that", "painful", "nightmare",
  "wasting time", "manual process", "too slow", "broken process",
  "overwhelmed", "drowning in", "infuriating", "keeps breaking",
];

/** Workarounds (spreadsheets, copy-paste, duct tape). */
export const WORKAROUND_PHRASES: string[] = [
  "spreadsheet", "google sheet", "excel hack", "copy paste", "copy-paste",
  "duct tape", "hacky solution", "temporary workaround", "manual workflow",
  "doing it by hand", "homemade tool", "airtable as", "notion as a crm",
];

/** Switching / churn from competitors. */
export const SWITCHING_PHRASES: string[] = [
  "switching from", "migrating from", "alternative to", "replace ",
  "replacing ", "vs ", "versus ", "better than", "leaving ",
  "cancelled ", "canceling ", "churned from", "looking for alternative",
  "fed up with", "moving away from",
];

/** Timing / growth events. */
export const TIMING_PHRASES: string[] = [
  "just raised", "we raised", "series a", "series b", "seed round",
  "funding", "just funded", "planning to grow", "scaling our",
  "expanding the team", "growing the team", "launching soon",
  "just launched", "opened a new", "new office", "entering market",
  "product launch", "go to market", "gtm", "hiring spree",
];

/** Hiring-specific. */
export const HIRING_PHRASES: string[] = [
  "hiring", "we're hiring", "we are hiring", "now hiring", "[hiring]",
  "open role", "open roles", "job opening", "job openings", "position available",
  "join our team", "apply here", "apply at", "careers", "job posting",
  "freelance gig", "contract role", "full-time role", "part-time role",
];

const REMOTE_PHRASES = [
  "remote", "work from home", "wfh", "distributed", "anywhere",
  "fully remote", "remote-first", "remote ok", "remote-friendly",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a single case-insensitive matcher for a phrase list. */
function compilePhraseIndex(phrases: string[]): Array<{ phrase: string; re: RegExp }> {
  return phrases
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((phrase) => ({
      phrase,
      re: new RegExp(
        // Word-ish boundaries for short tokens; substring OK for multi-word
        phrase.length <= 4
          ? `\\b${escapeRe(phrase)}\\b`
          : escapeRe(phrase),
        "i",
      ),
    }));
}

const URGENCY_INDEX = compilePhraseIndex(URGENCY_PHRASES);
const EXPLICIT_INDEX = compilePhraseIndex(EXPLICIT_DEMAND_PHRASES);
const PAIN_INDEX = compilePhraseIndex(PAIN_PHRASES);
const WORKAROUND_INDEX = compilePhraseIndex(WORKAROUND_PHRASES);
const SWITCHING_INDEX = compilePhraseIndex(SWITCHING_PHRASES);
const TIMING_INDEX = compilePhraseIndex(TIMING_PHRASES);
const HIRING_INDEX = compilePhraseIndex(HIRING_PHRASES);
const REMOTE_INDEX = compilePhraseIndex(REMOTE_PHRASES);

function matchPhrases(
  text: string,
  index: Array<{ phrase: string; re: RegExp }>,
  max = 5,
): string[] {
  const hits: string[] = [];
  for (const { phrase, re } of index) {
    if (re.test(text)) {
      hits.push(phrase);
      if (hits.length >= max) break;
    }
  }
  return hits;
}

export type UrgencyResult = {
  score: number; // 0–100
  phrases: string[];
  hasUrgency: boolean;
};

/** Score urgency 0–100 from matched phrases. */
export function scoreUrgency(text: string): UrgencyResult {
  const phrases = matchPhrases(text || "", URGENCY_INDEX, 8);
  if (!phrases.length) return { score: 0, phrases: [], hasUrgency: false };
  // First hit weighted higher; stack diminishing returns
  let score = 45;
  score += Math.min(40, phrases.length * 12);
  const extreme = phrases.some((p) =>
    /urgent|asap|immediately|right away|desperate|emergency|stat|mass hiring|hiring asap/i.test(p),
  );
  if (extreme) score += 15;
  return { score: Math.min(100, score), phrases, hasUrgency: true };
}

export type DemandResult = {
  buckets: DemandBucket[];
  phrases: Partial<Record<DemandBucket, string[]>>;
  primary: DemandBucket | null;
};

export function detectDemandBuckets(text: string): DemandResult {
  const t = text || "";
  const phrases: Partial<Record<DemandBucket, string[]>> = {};
  const buckets: DemandBucket[] = [];

  const checks: Array<[DemandBucket, Array<{ phrase: string; re: RegExp }>]> = [
    ["hiring", HIRING_INDEX],
    ["explicit_demand", EXPLICIT_INDEX],
    ["pain", PAIN_INDEX],
    ["workaround", WORKAROUND_INDEX],
    ["switching", SWITCHING_INDEX],
    ["timing", TIMING_INDEX],
  ];

  for (const [bucket, index] of checks) {
    const hits = matchPhrases(t, index, 4);
    if (hits.length) {
      buckets.push(bucket);
      phrases[bucket] = hits;
    }
  }

  // Priority for primary label
  const order: DemandBucket[] = [
    "hiring", "explicit_demand", "timing", "switching", "pain", "workaround",
  ];
  const primary = order.find((b) => buckets.includes(b)) ?? null;
  return { buckets, phrases, primary };
}

export function mentionsRemoteText(text: string): boolean {
  return REMOTE_INDEX.some(({ re }) => re.test(text || ""));
}

/**
 * Build human-readable why / match reasons from urgency + demand + remote.
 */
export function buildIntentWhy(
  text: string,
  extras?: { skillHit?: string; source?: string; remote?: boolean },
): { why_match: string; match_reasons: string[]; urgency: UrgencyResult; demand: DemandResult } {
  const urgency = scoreUrgency(text);
  const demand = detectDemandBuckets(text);
  const remote = extras?.remote ?? mentionsRemoteText(text);
  const reasons: string[] = [];

  if (urgency.hasUrgency && urgency.phrases[0]) {
    reasons.push(`Urgency: “${urgency.phrases[0]}”`);
  }
  if (demand.primary && demand.phrases[demand.primary]?.[0]) {
    const label = demand.primary.replace(/_/g, " ");
    reasons.push(`${label}: “${demand.phrases[demand.primary]![0]}”`);
  }
  if (extras?.skillHit) {
    reasons.push(`Skill match: ${extras.skillHit}`);
  }
  if (remote) {
    reasons.push("Mentions remote / WFH");
  }
  if (extras?.source) {
    reasons.push(`Source: ${extras.source}`);
  }

  let why_match = "";
  if (urgency.hasUrgency && demand.primary) {
    why_match = `Urgent ${demand.primary.replace(/_/g, " ")} signal (“${urgency.phrases[0]}”)`;
  } else if (urgency.hasUrgency) {
    why_match = `Time-sensitive need (“${urgency.phrases[0]}”)`;
  } else if (demand.primary && demand.phrases[demand.primary]?.[0]) {
    why_match = `${demand.primary.replace(/_/g, " ")} — “${demand.phrases[demand.primary]![0]}”`;
  } else if (extras?.skillHit) {
    why_match = `Matches your skill: ${extras.skillHit}`;
  } else {
    why_match = "Relevant buyer-intent post";
  }

  return { why_match, match_reasons: reasons.slice(0, 6), urgency, demand };
}

/** Weighted prospect score components (PMF-style, 0–100). */
export function scoreIntentFit(opts: {
  text: string;
  skillRelevant: boolean;
  hasEvidenceUrl?: boolean;
}): number {
  const urgency = scoreUrgency(opts.text);
  const demand = detectDemandBuckets(opts.text);
  const pain = demand.buckets.includes("pain") || demand.buckets.includes("explicit_demand") ? 25 : 0;
  const fit = opts.skillRelevant ? 25 : 0;
  const timing =
    (urgency.score / 100) * 20 +
    (demand.buckets.includes("timing") || demand.buckets.includes("hiring") ? 10 : 0);
  const evidence = opts.hasEvidenceUrl ? 15 : 5;
  const reach = /linkedin\.com|email|@|dm me|apply/i.test(opts.text) ? 15 : 8;
  return Math.round(Math.min(100, pain + fit + Math.min(20, timing) + evidence + reach));
}
