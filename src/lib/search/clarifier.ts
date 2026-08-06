// =====================================================================
// Clarifying questions — turn a vague ask into a targeted search
//
// Design rules:
//  1. ONLY ask what changes the search.
//  2. ALWAYS have a recommended default.
//  3. NEVER block on it — skippable.
//  4. Ask at most 4.
//  5. Product pitches get product questions; crafts get skill questions.
// =====================================================================
import type { ClassifiedQuery } from "./query-classifier";
import { isProductPitchQuery } from "./query-classifier";

export type ClarifyOptionId = string;

export type ClarifyOption = {
  id: ClarifyOptionId;
  label: string;
  /** One line explaining what picking this actually does to the search. */
  hint: string;
  recommended?: boolean;
};

export type ClarifyQuestionId =
  | "audience"
  | "buyer_type"
  | "geography"
  | "experience"
  | "craft"
  | "signal_focus";

export type ClarifyQuestion = {
  id: ClarifyQuestionId;
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
  /** Years of experience — skill path only; drives junior/mid/senior filters. */
  experience?: "0-1" | "1-2" | "3-4" | "5+";
  /** Product path: which buyer-signal shapes to prioritize. */
  signal_focus?: "all" | "recommend" | "pain" | "compare";
  craft?: string;
  /** Free-text the user typed instead of picking. */
  other?: Partial<Record<ClarifyQuestionId, string>>;
};

/** True when clarifiers should speak product/customer language, not craft/YoE. */
export function isProductClarifyPath(classified: ClassifiedQuery): boolean {
  return classified.type === "product" || isProductPitchQuery(classified.raw || "");
}

function craftLooksUncertain(coreSkill: string): boolean {
  const s = (coreSkill || "").trim();
  if (!s) return true;
  const words = s.split(/\s+/);
  if (words.length > 3) return true;
  return /\b(?:am|is|are|the|and|etc|who|that|looking|need|want|find)\b/i.test(s);
}

function skillAudienceQuestion(): ClarifyQuestion {
  return {
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
  };
}

function productAudienceQuestion(): ClarifyQuestion {
  return {
    id: "audience",
    question: "What should we bring back?",
    options: [
      {
        id: "all",
        label: "Everything",
        hint: "People asking for tools like yours, companies in pain, and reachable buyers",
        recommended: true,
      },
      {
        id: "posts",
        label: "Posts only",
        hint: "Public asks for recommendations, alternatives, or help with the problem you solve",
      },
      {
        id: "companies",
        label: "Companies only",
        hint: "Businesses evaluating vendors or showing product buying signals",
      },
      {
        id: "people",
        label: "People only",
        hint: "Founders and operators you can reach about the problem you solve",
      },
    ],
    allowOther: false,
  };
}

function skillExperienceQuestion(): ClarifyQuestion {
  return {
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
  };
}

function productSignalFocusQuestion(): ClarifyQuestion {
  return {
    id: "signal_focus",
    question: "What buying signals matter most?",
    options: [
      {
        id: "all",
        label: "All buying signals",
        hint: "Recommendations, pain posts, and people comparing alternatives",
        recommended: true,
      },
      {
        id: "recommend",
        label: "Looking for a tool",
        hint: "“Anyone recommend…”, “best tool for…”, “need a solution”",
      },
      {
        id: "pain",
        label: "Struggling with the problem",
        hint: "People venting or asking for help with the pain you solve",
      },
      {
        id: "compare",
        label: "Switching / alternatives",
        hint: "“Alternative to X”, “migrating from…”, competitor comparisons",
      },
    ],
    allowOther: false,
  };
}

function skillBuyerQuestion(): ClarifyQuestion {
  return {
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
  };
}

function productBuyerQuestion(): ClarifyQuestion {
  return {
    id: "buyer_type",
    question: "Who's your ideal customer?",
    options: [
      { id: "any", label: "Anyone", hint: "Don't filter by company size", recommended: true },
      { id: "startups", label: "Startups / founders", hint: "Early-stage teams evaluating new tools" },
      { id: "smb", label: "Small businesses", hint: "Owner-operated shops and local companies" },
      { id: "agency", label: "Agencies", hint: "Studios that buy tools for client work" },
      { id: "enterprise", label: "Enterprise", hint: "Large companies with procurement cycles" },
      {
        id: "individual",
        label: "Individuals / freelancers",
        hint: "Solo operators buying for themselves",
      },
    ],
    allowOther: true,
  };
}

function geographyQuestion(): ClarifyQuestion {
  return {
    id: "geography",
    question: "Anywhere in particular?",
    options: [
      {
        id: "global",
        label: "Worldwide",
        hint: "Most results — remote and online buyers",
        recommended: true,
      },
      { id: "us", label: "United States", hint: "US-based buyers only" },
      { id: "na", label: "North America", hint: "US and Canada" },
      { id: "uk", label: "UK", hint: "UK-based buyers only" },
      { id: "eu", label: "Europe", hint: "EU and UK" },
    ],
    allowOther: true,
  };
}

function skillCraftQuestion(classified: ClassifiedQuery): ClarifyQuestion {
  return {
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
  };
}

function productCraftQuestion(classified: ClassifiedQuery): ClarifyQuestion {
  const label = classified.coreSkill || classified.raw || "—";
  return {
    id: "craft",
    question: "What does your product do?",
    options: [
      {
        id: "confirm",
        label: label.length > 64 ? `${label.slice(0, 61)}…` : label,
        hint: "Search for people who need this capability",
        recommended: true,
      },
      {
        id: "saas",
        label: "SaaS / software tool",
        hint: "Find buyers asking for software like yours",
      },
      {
        id: "agency_service",
        label: "Done-for-you service",
        hint: "Find people outsourcing this work",
      },
      {
        id: "marketplace",
        label: "Marketplace / directory",
        hint: "Find operators looking for platforms like yours",
      },
      {
        id: "automation",
        label: "Automation / AI agent",
        hint: "Find teams wanting to automate this workflow",
      },
    ],
    allowOther: true,
  };
}

export function buildClarifyingQuestions(
  classified: ClassifiedQuery,
  opts: { hasLocation?: boolean } = {},
): ClarifyQuestion[] {
  const product = isProductClarifyPath(classified);
  const out: ClarifyQuestion[] = [];

  if (craftLooksUncertain(classified.coreSkill)) {
    out.push(product ? productCraftQuestion(classified) : skillCraftQuestion(classified));
  }

  out.push(product ? productAudienceQuestion() : skillAudienceQuestion());

  if (product) {
    out.push(productSignalFocusQuestion());
  } else {
    out.push(skillExperienceQuestion());
  }

  out.push(product ? productBuyerQuestion() : skillBuyerQuestion());

  if (!opts.hasLocation) {
    out.push(geographyQuestion());
  }

  // Cap at 4 — product swaps YoE for signal focus; skill keeps YoE.
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
  /** YoE bucket from clarifier — skill path only. */
  experience?: "0-1" | "1-2" | "3-4" | "5+";
  /** Product path: which buyer-signal shapes to prioritize. */
  signalFocus?: "all" | "recommend" | "pain" | "compare";
  /** Extra query phrases derived from signal_focus. */
  signalTerms: string[];
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

const SIGNAL_FOCUS: Record<
  NonNullable<ClarifyAnswers["signal_focus"]>,
  { terms: string[]; label: string }
> = {
  all: {
    terms: [],
    label: "all buying signals",
  },
  recommend: {
    terms: [
      "recommend",
      "recommendations",
      "best tool",
      "looking for a tool",
      "anyone know a",
      "need a solution",
    ],
    label: "tool recommendations",
  },
  pain: {
    terms: [
      "struggling with",
      "need help with",
      "frustrated with",
      "pain point",
      "can't figure out",
      "looking for help",
    ],
    label: "problem / pain posts",
  },
  compare: {
    terms: [
      "alternative to",
      "vs",
      "compared to",
      "switching from",
      "migrating from",
      "better than",
    ],
    label: "alternatives / switching",
  },
};

const PRODUCT_CRAFT_LABELS: Record<string, string> = {
  saas: "SaaS / software tool",
  agency_service: "done-for-you service",
  marketplace: "marketplace / directory",
  automation: "automation / AI agent",
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
  const product = isProductClarifyPath(classified);
  const craftRaw = (answers.other?.craft || answers.craft || "").trim() || undefined;
  const craft = craftRaw
    ? PRODUCT_CRAFT_LABELS[craftRaw] || craftRaw
    : undefined;
  const audience = answers.audience ?? "all";
  const buyerKey = answers.buyer_type ?? "any";
  const profile = BUYER_PROFILES[buyerKey];
  const geo = answers.geography ?? "global";
  const signalFocus = product ? (answers.signal_focus ?? "all") : undefined;
  const experience = product ? undefined : (answers.experience ?? "0-1");

  const location = answers.other?.geography?.trim() || classified.location || GEO_LOCATIONS[geo];

  const noun = craft || classified.coreSkill || (product ? "your product" : "work");
  const parts: string[] = [];
  parts.push(product ? `Looking for customers for ${noun}` : `Looking for ${noun}`);
  if (audience !== "all") parts.push(`${audience} only`);
  if (buyerKey !== "any") {
    parts.push(product ? `customers: ${profile.label}` : `targeting ${profile.label}`);
  }
  parts.push(location ? `in ${location}` : "worldwide");
  if (signalFocus && signalFocus !== "all") {
    parts.push(SIGNAL_FOCUS[signalFocus].label);
  }
  if (experience) parts.push(EXP_LABEL[experience]);

  return {
    craft,
    audience,
    buyerTerms: profile.terms,
    extraSubreddits: profile.subs,
    location: location ?? null,
    maxAgeHours: 48,
    experience,
    signalFocus,
    signalTerms: signalFocus ? SIGNAL_FOCUS[signalFocus].terms : [],
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
  // Clear product pitches with ICP + place already stated don't need a form.
  if (isProductClarifyPath(classified)) {
    const hasIcp =
      /\b(startups?|founders?|freelancers?|agenc(?:y|ies)|smbs?|small businesses?|enterprises?|teams?|companies|customers?)\b/i.test(
        raw,
      );
    const hasPlace = !!classified.location || mentionsPlace(raw);
    const hasPain =
      /\b(helps?|solves?|that (does|lets|allows|enables)|struggling|looking for customers)\b/i.test(
        raw,
      );
    if (hasIcp && (hasPlace || hasPain) && raw.split(/\s+/).length >= 8) return false;
  }
  const hasBuyer =
    /\b(startups?|founders?|small businesses?|agenc(?:y|ies)|studios?|enterprises?|smbs?|local|shops?|stores?|brands?|ecommerce|e-commerce|saas|nonprofits?)\b/i.test(
      raw,
    );
  const hasPlace = !!classified.location || mentionsPlace(raw);
  return !(hasBuyer && hasPlace);
}
