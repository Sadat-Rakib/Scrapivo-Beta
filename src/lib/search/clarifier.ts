// =====================================================================
// Clarifying questions — turn a vague ask into a targeted search
//
// Design rules:
//  1. ONLY ask what changes the search.
//  2. ALWAYS have a recommended default.
//  3. NEVER block on it — skippable.
//  4. Ask at most 4.
// =====================================================================
import type { ClassifiedQuery } from "./query-classifier";

export type ClarifyOptionId = string;

export type ClarifyOption = {
  id: ClarifyOptionId;
  label: string;
  /** One line explaining what picking this actually does to the search. */
  hint: string;
  recommended?: boolean;
};

export type ClarifyQuestion = {
  id: "audience" | "buyer_type" | "geography" | "experience" | "craft";
  question: string;
  options: ClarifyOption[];
  /** Free-text is always allowed — the option list is never exhaustive. */
  allowOther: boolean;
};

/** What the user picked. Every field optional — skipping is first-class. */
export type ClarifyAnswers = {
  audience?: "people" | "companies" | "posts" | "all";
  buyer_type?: "startups" | "smb" | "agency" | "enterprise" | "individual" | "any";
  geography?: "global" | "us" | "na" | "eu" | "uk" | "local";
  /** Years of experience — drives junior/mid/senior lead filters. */
  experience?: "0-1" | "1-2" | "3-4" | "5+";
  craft?: string;
  /** Free-text the user typed instead of picking. */
  other?: Partial<Record<ClarifyQuestion["id"], string>>;
};

function craftLooksUncertain(coreSkill: string): boolean {
  const s = (coreSkill || "").trim();
  if (!s) return true;
  const words = s.split(/\s+/);
  if (words.length > 3) return true;
  return /\b(?:am|is|are|the|and|etc|who|that|looking|need|want|find)\b/i.test(s);
}

export function buildClarifyingQuestions(
  classified: ClassifiedQuery,
  opts: { hasLocation?: boolean } = {},
): ClarifyQuestion[] {
  const out: ClarifyQuestion[] = [];

  if (craftLooksUncertain(classified.coreSkill)) {
    out.push({
      id: "craft",
      question: "What do you do? (so we search for people who need it)",
      options: [
        {
          id: "confirm",
          label: classified.coreSkill || "—",
          hint: "Use what we detected",
          recommended: true,
        },
        { id: "writer", label: "Writer / copywriter", hint: "Content, copy, ghostwriting" },
        { id: "designer", label: "Designer", hint: "UI/UX, brand, product design" },
        { id: "developer", label: "Developer", hint: "Web, apps, engineering" },
        { id: "sales", label: "Sales", hint: "SDR, AE, outbound" },
        { id: "growth", label: "Growth / marketing", hint: "Acquisition, SEO, ads" },
        { id: "data", label: "Data", hint: "Analyst, BI, SQL" },
        { id: "tutor", label: "Teacher / tutor", hint: "Students needing lessons" },
        { id: "investor", label: "Investor", hint: "Startups raising capital" },
      ],
      allowOther: true,
    });
  }

  out.push({
    id: "audience",
    question: "What should we bring back?",
    options: [
      {
        id: "all",
        label: "Everything",
        hint: "Posts asking for your work, companies showing signals, and reachable people",
        recommended: true,
      },
      {
        id: "posts",
        label: "Posts only",
        hint: "People publicly asking for your service right now",
      },
      {
        id: "companies",
        label: "Companies only",
        hint: "Businesses hiring or showing buying signals",
      },
      { id: "people", label: "People only", hint: "Individuals you can contact directly" },
    ],
    allowOther: false,
  });

  out.push({
    id: "experience",
    question: "What's your years of experience?",
    options: [
      {
        id: "0-1",
        label: "0–1 years",
        hint: "Prefer junior / entry-level openings and asks",
        recommended: true,
      },
      {
        id: "1-2",
        label: "1–2 years",
        hint: "Skip senior-heavy titles; keep mid-friendly asks",
      },
      {
        id: "3-4",
        label: "3–4 years",
        hint: "Mid-level — drop intern/junior-only and staff/principal",
      },
      {
        id: "5+",
        label: "5+ years",
        hint: "Prefer senior / lead openings",
      },
    ],
    allowOther: false,
  });

  out.push({
    id: "buyer_type",
    question: "Who's your ideal buyer?",
    options: [
      { id: "any", label: "Anyone", hint: "Don't filter by company size", recommended: true },
      { id: "startups", label: "Startups", hint: "Early-stage companies, often funded recently" },
      { id: "smb", label: "Small businesses", hint: "Local and owner-operated businesses" },
      { id: "agency", label: "Agencies", hint: "Studios and agencies who subcontract work" },
      { id: "enterprise", label: "Enterprise", hint: "Large companies with procurement" },
      {
        id: "individual",
        label: "Individuals / students",
        hint: "People needing tutoring, coaching, or freelance help",
      },
    ],
    allowOther: true,
  });

  if (!opts.hasLocation) {
    out.push({
      id: "geography",
      question: "Anywhere in particular?",
      options: [
        {
          id: "global",
          label: "Worldwide",
          hint: "Most results — remote work is the norm",
          recommended: true,
        },
        { id: "us", label: "United States", hint: "US-based buyers only" },
        { id: "na", label: "North America", hint: "US and Canada" },
        { id: "uk", label: "UK", hint: "UK-based buyers only" },
        { id: "eu", label: "Europe", hint: "EU and UK" },
      ],
      allowOther: true,
    });
  }

  // Cap at 4 — experience replaces the old pre-search freshness question
  // (UI chips already handle 24h / All).
  return out.slice(0, 4);
}

// ── applying answers ────────────────────────────────────────────────────────

export type SearchRefinement = {
  /** Overrides classified.coreSkill when the user corrected us. */
  craft?: string;
  /** Which segments to prioritise; "all" means don't bias. */
  audience: "people" | "companies" | "posts" | "all";
  /** Extra terms folded into source queries to bias toward a buyer type. */
  buyerTerms: string[];
  /** Subreddits worth adding for this buyer type. */
  extraSubreddits: string[];
  /** Location string the pipeline already understands, or null for worldwide. */
  location: string | null;
  /** Max age in hours for the freshness gate (default 48 for ingest). */
  maxAgeHours: number;
  /** YoE bucket from clarifier. */
  experience?: "0-1" | "1-2" | "3-4" | "5+";
  /** Human-readable summary, shown back so the user can see what we assumed. */
  summary: string;
};

const BUYER_PROFILES: Record<
  NonNullable<ClarifyAnswers["buyer_type"]>,
  { terms: string[]; subs: string[]; label: string }
> = {
  startups: {
    terms: ["startup", "founder", "seed", "pre-seed", "YC", "early stage"],
    subs: ["startups", "SaaS", "ycombinator", "Entrepreneur"],
    label: "startups",
  },
  smb: {
    terms: ["small business", "local business", "owner", "shop", "store"],
    subs: ["smallbusiness", "Entrepreneur", "restaurateur"],
    label: "small businesses",
  },
  agency: {
    terms: ["agency", "studio", "white label", "subcontract", "overflow work"],
    subs: ["agency", "advertising", "marketing", "web_design"],
    label: "agencies",
  },
  enterprise: {
    terms: ["enterprise", "RFP", "procurement", "vendor", "contract"],
    subs: ["sysadmin", "ITManagers"],
    label: "enterprise buyers",
  },
  individual: {
    terms: ["personal", "my own", "individual", "solo"],
    subs: ["slavelabour", "DoneDirtCheap", "forhire"],
    label: "individuals",
  },
  any: { terms: [], subs: [], label: "any buyer" },
};

const GEO_LOCATIONS: Record<NonNullable<ClarifyAnswers["geography"]>, string | null> = {
  global: null,
  us: "United States",
  na: "United States",
  eu: "Europe",
  uk: "United Kingdom",
  local: null,
};

const EXP_LABEL: Record<NonNullable<ClarifyAnswers["experience"]>, string> = {
  "0-1": "0–1 years experience",
  "1-2": "1–2 years experience",
  "3-4": "3–4 years experience",
  "5+": "5+ years experience",
};

/**
 * Fold answers into concrete pipeline inputs.
 *
 * Unanswered questions fall back to the recommended default.
 */
export function applyClarifyAnswers(
  classified: ClassifiedQuery,
  answers: ClarifyAnswers = {},
): SearchRefinement {
  const craft = (answers.other?.craft || answers.craft || "").trim() || undefined;
  const audience = answers.audience ?? "all";
  const buyerKey = answers.buyer_type ?? "any";
  const profile = BUYER_PROFILES[buyerKey];
  const geo = answers.geography ?? "global";
  const experience = answers.experience ?? "0-1";

  const location = answers.other?.geography?.trim() || classified.location || GEO_LOCATIONS[geo];

  const parts: string[] = [];
  parts.push(`Looking for ${craft || classified.coreSkill || "work"}`);
  if (audience !== "all") parts.push(`${audience} only`);
  if (buyerKey !== "any") parts.push(`targeting ${profile.label}`);
  parts.push(location ? `in ${location}` : "worldwide");
  parts.push(EXP_LABEL[experience]);

  return {
    craft,
    audience,
    buyerTerms: profile.terms,
    extraSubreddits: profile.subs,
    location: location ?? null,
    maxAgeHours: 48,
    experience,
    summary: parts.join(" · "),
  };
}

export function mentionsPlace(raw: string): boolean {
  const t = (raw || "").trim();
  return /\b(?:in|near|around|across|based\s+in|located\s+in)\s+(?:the\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?/.test(
    t,
  );
}

export function shouldClarify(classified: ClassifiedQuery): boolean {
  if (craftLooksUncertain(classified.coreSkill)) return true;
  const raw = (classified.raw || "").trim();
  if (raw.split(/\s+/).length <= 2) return true;
  const hasBuyer =
    /\b(startups?|founders?|small businesses?|agenc(?:y|ies)|studios?|enterprises?|smbs?|local|shops?|stores?|brands?|ecommerce|e-commerce|saas|nonprofits?)\b/i.test(
      raw,
    );
  const hasPlace = !!classified.location || mentionsPlace(raw);
  return !(hasBuyer && hasPlace);
}
