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
  | "signal_focus"
  | "local_opportunity"
  | "investor_stage"
  | "investor_check";

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
  /** Local business opportunity filter (no website, SEO poor, …). */
  local_opportunity?: "any" | "no_website" | "seo_poor" | "has_phone" | "sales_ready";
  /** Investor hunt: preferred stage. */
  investor_stage?: "pre-seed" | "seed" | "series-a" | "series-b" | "any";
  /** Investor hunt: check-size band. */
  investor_check?: "angel" | "seed" | "growth" | "any";
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

const BUYER_TYPE_RE =
  /\b(startups?|founders?|small businesses?|agenc(?:y|ies)|studios?|enterprises?|smbs?|local|shops?|stores?|brands?|ecommerce|e-commerce|saas|nonprofits?)\b/i;

/**
 * Infer result-segment audience from the typed query so we never re-ask
 * "What should we bring back?" when the user already said companies/people/posts.
 */
const DEMAND_VERB_RE =
  /\b(?:looking\s+for|look\s+for|hiring|hire|need(?:s|ing)?|want(?:s|ing)?|asking\s+for|seeking|searching\s+for|in\s+search\s+of|who\s+can)\b/i;

/**
 * Buyer / client hunts — not job applications. YoE and "who are you targeting"
 * are the wrong clarifiers here.
 */
export function isClientsBuyerHunt(classified: ClassifiedQuery): boolean {
  if (classified.goal === "jobs") return false;
  if (classified.goal === "clients" || classified.goal === "both") return true;
  if (classified.signalMode === "buying_signal") return true;
  if (classified.type === "product") return true;
  const raw = classified.raw || "";
  if (DEMAND_VERB_RE.test(raw)) return true;
  // Service / lead crafts imply hunting buyers, not applying for roles.
  if (
    /\b(services?|clients?|customers?|leads?|buyers?)\b/i.test(raw) &&
    raw.trim().split(/\s+/).length >= 2
  ) {
    return true;
  }
  return false;
}

export function extractStatedAudience(raw: string): NonNullable<ClarifyAnswers["audience"]> | null {
  const t = (raw || "").toLowerCase();
  if (!t.trim()) return null;
  const wantsPeople = /\b(people|persons?|individuals?|humans)\b/.test(t);
  const wantsCompanies =
    /\b(companies|company|businesses|business|firms?|organizations?|organisations?)\b/.test(t);
  const wantsPosts = /\b((linkedin\s+)?posts?|tweets?|threads?)\b/.test(t);
  const wantsEverything = /\b(everything|all (of )?(them|those|three)|etc\.?)\b/.test(t);
  const exclusiveCompanies =
    /\b(?:companies|company|businesses|business|firms?)\s+only\b/.test(t) ||
    /\bonly\s+(?:companies|company|businesses|business|firms?)\b/.test(t);
  const exclusivePeople =
    /\b(?:people|persons?|individuals?)\s+only\b/.test(t) ||
    /\bonly\s+(?:people|persons?|individuals?)\b/.test(t);
  const exclusivePosts =
    /\b(?:(?:linkedin\s+)?posts?|tweets?|threads?)\s+only\b/.test(t) ||
    /\bonly\s+(?:(?:linkedin\s+)?posts?|tweets?|threads?)\b/.test(t);
  const demandVerb = DEMAND_VERB_RE.test(t);

  if (wantsEverything) return "all";
  // Explicit exclusives win before dual / demand broadening.
  if (exclusiveCompanies) return "companies";
  if (exclusivePeople) return "people";
  if (exclusivePosts) return "posts";
  if (wantsPeople && wantsCompanies) return "all";
  if (wantsPeople && wantsPosts) return "all";
  if (wantsCompanies && wantsPosts) return "all";
  // "companies looking for X" / "people looking for X" = hunt buyers across
  // tabs — not companies-only / people-only scoping that wipes People/Posts.
  if ((wantsCompanies || wantsPeople) && demandVerb) return "all";
  if (wantsPeople) return "people";
  if (wantsCompanies) return "companies";
  if (wantsPosts) return "posts";
  return null;
}

export function extractStatedExperience(
  raw: string,
): NonNullable<ClarifyAnswers["experience"]> | null {
  const t = (raw || "").toLowerCase();
  if (/\b(5\+|10\+|senior|staff|principal|lead\s+level)\b/.test(t)) return "5+";
  if (/\b(3-4|3–4|mid[- ]level|3\+?\s*years?)\b/.test(t)) return "3-4";
  if (/\b(1-2|1–2|1\+?\s*years?)\b/.test(t)) return "1-2";
  if (/\b(0-1|0–1|junior|entry[- ]level|intern)\b/.test(t)) return "0-1";
  if (/\b(\d+)\+?\s*years?\b/.test(t)) {
    const n = Number(RegExp.$1);
    if (n >= 5) return "5+";
    if (n >= 3) return "3-4";
    if (n >= 1) return "1-2";
    return "0-1";
  }
  return null;
}

export function hasStatedBuyerType(raw: string): boolean {
  return BUYER_TYPE_RE.test(raw || "");
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
      {
        id: "startups",
        label: "Startups / founders",
        hint: "Early-stage teams evaluating new tools",
      },
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

function isLocalBusinessHunt(classified: ClassifiedQuery): boolean {
  return /\b(local businesses?|plumbers?|dentists?|roofers?|restaurants?|gyms?|med spas?|law firms?|near me|in (texas|london|austin|toronto))\b/i.test(
    classified.raw || "",
  );
}

function isFindInvestorHunt(classified: ClassifiedQuery): boolean {
  // Finding VCs/angels for the founder — not "startups raising" deal-flow.
  return /\b(find (an? )?investors?|need (an? )?investors?|looking for (an? )?(vc|angel|venture)|raise from|pitch (to )?(vcs?|investors?))\b/i.test(
    classified.raw || "",
  );
}

function localOpportunityQuestion(): ClarifyQuestion {
  return {
    id: "local_opportunity",
    question: "Any opportunity filter for local businesses?",
    allowOther: true,
    options: [
      {
        id: "no_website",
        label: "No website",
        hint: "Best for pitching web builds",
        recommended: true,
      },
      { id: "seo_poor", label: "SEO poor", hint: "Thin / HTTP / weak site signals" },
      { id: "has_phone", label: "Has phone", hint: "Ready to call" },
      { id: "sales_ready", label: "Sales ready", hint: "Email or phone present" },
      { id: "any", label: "Any", hint: "No opportunity filter" },
    ],
  };
}

function investorStageQuestion(): ClarifyQuestion {
  return {
    id: "investor_stage",
    question: "Which stage should the investor cover?",
    allowOther: true,
    options: [
      { id: "pre-seed", label: "Pre-seed", hint: "Earliest checks" },
      { id: "seed", label: "Seed", hint: "Most common early raise", recommended: true },
      { id: "series-a", label: "Series A", hint: "Growth round" },
      { id: "series-b", label: "Series B+", hint: "Later stage" },
      { id: "any", label: "Any stage", hint: "No stage filter" },
    ],
  };
}

function investorCheckQuestion(): ClarifyQuestion {
  return {
    id: "investor_check",
    question: "Rough check size?",
    allowOther: true,
    options: [
      { id: "angel", label: "Angel (<$100K)", hint: "Individual angels" },
      { id: "seed", label: "$100K–$5M", hint: "Typical seed / early VC", recommended: true },
      { id: "growth", label: "$5M+", hint: "Larger funds" },
      { id: "any", label: "Any size", hint: "No check filter" },
    ],
  };
}

export function buildClarifyingQuestions(
  classified: ClassifiedQuery,
  opts: { hasLocation?: boolean } = {},
): ClarifyQuestion[] {
  const product = isProductClarifyPath(classified);
  const raw = classified.raw || "";
  const statedAudience = extractStatedAudience(raw);
  const statedExp = extractStatedExperience(raw);
  const statedBuyer = hasStatedBuyerType(raw);
  const hasLocation = !!opts.hasLocation || !!classified.location || mentionsPlace(raw);
  const clientsHunt = isClientsBuyerHunt(classified);
  const out: ClarifyQuestion[] = [];

  // Investor directory hunt — dedicated clarifiers (seeded DB path).
  if (isFindInvestorHunt(classified)) {
    out.push(investorStageQuestion());
    out.push(investorCheckQuestion());
    if (!hasLocation) out.push(geographyQuestion());
    return out.slice(0, 4);
  }

  // Local business hunt — opportunity + place.
  if (isLocalBusinessHunt(classified)) {
    out.push(localOpportunityQuestion());
    if (!hasLocation) out.push(geographyQuestion());
    if (craftLooksUncertain(classified.coreSkill)) {
      out.push(skillCraftQuestion(classified));
    }
    return out.slice(0, 4);
  }

  if (craftLooksUncertain(classified.coreSkill)) {
    out.push(product ? productCraftQuestion(classified) : skillCraftQuestion(classified));
  }

  // Geography early so the 4-slot budget never drops the most relevant ask
  // when craft + audience are already clear.
  if (!hasLocation) {
    out.push(geographyQuestion());
  }

  if (!statedAudience) {
    out.push(product ? productAudienceQuestion() : skillAudienceQuestion());
  }

  if (product) {
    out.push(productSignalFocusQuestion());
  } else if (!statedExp && classified.goal === "jobs") {
    // YoE only for job hunts — never for clients / buying-signal buyer hunts.
    out.push(skillExperienceQuestion());
  } else if (!statedExp && !clientsHunt) {
    // Bare vague craft with no demand language (e.g. "designer") — YoE still helps.
    out.push(skillExperienceQuestion());
  }

  // Buyer type: skip when already stated, or when craft + audience/demand are
  // clear enough that default "any" is fine (volume demos / precise hunts).
  const skipBuyer =
    statedBuyer ||
    (clientsHunt &&
      !craftLooksUncertain(classified.coreSkill) &&
      (!!statedAudience || DEMAND_VERB_RE.test(raw)));
  if (!skipBuyer) {
    out.push(product ? productBuyerQuestion() : skillBuyerQuestion());
  }

  // Cap at 4 — prefer geography + remaining missing dims.
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
  localOpportunity?: ClarifyAnswers["local_opportunity"];
  investorStage?: ClarifyAnswers["investor_stage"];
  investorCheck?: ClarifyAnswers["investor_check"];
  /** True when query is find-investors outreach, not startups-raising. */
  findInvestors?: boolean;
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
  us: "USA",
  na: "North America",
  eu: "Europe",
  uk: "UK",
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
  const craft = craftRaw ? PRODUCT_CRAFT_LABELS[craftRaw] || craftRaw : undefined;
  // Honor audience already typed in the query when the user skips the form.
  const inferredAudience = extractStatedAudience(classified.raw || "");
  const audience = answers.audience ?? inferredAudience ?? "all";
  const buyerKey = answers.buyer_type ?? "any";
  const profile = BUYER_PROFILES[buyerKey];
  const geo = answers.geography ?? "global";
  const signalFocus = product ? (answers.signal_focus ?? "all") : undefined;
  const inferredExp = extractStatedExperience(classified.raw || "");
  const clientsHunt = isClientsBuyerHunt(classified);
  // Clients / buying-signal hunts: never invent a YoE bucket — it biases ATS
  // filters toward junior roles the user never asked for.
  const experience =
    product || clientsHunt
      ? (answers.experience ?? inferredExp ?? undefined)
      : (answers.experience ?? inferredExp ?? "0-1");

  const location = answers.other?.geography?.trim() || classified.location || GEO_LOCATIONS[geo];

  const findInvestors = isFindInvestorHunt(classified);
  const localOpportunity =
    answers.local_opportunity ||
    (answers.other?.local_opportunity as ClarifyAnswers["local_opportunity"]) ||
    undefined;
  const investorStage =
    answers.investor_stage ||
    (answers.other?.investor_stage as ClarifyAnswers["investor_stage"]) ||
    undefined;
  const investorCheck =
    answers.investor_check ||
    (answers.other?.investor_check as ClarifyAnswers["investor_check"]) ||
    undefined;

  const noun = craft || classified.coreSkill || (product ? "your product" : "work");
  const parts: string[] = [];
  if (findInvestors) {
    parts.push("Finding investors / VCs");
    if (investorStage && investorStage !== "any") parts.push(investorStage);
    if (investorCheck && investorCheck !== "any") parts.push(`check: ${investorCheck}`);
  } else {
    parts.push(product ? `Looking for customers for ${noun}` : `Looking for ${noun}`);
  }
  if (audience !== "all") parts.push(`${audience} only`);
  if (buyerKey !== "any") {
    parts.push(product ? `customers: ${profile.label}` : `targeting ${profile.label}`);
  }
  parts.push(location ? `in ${location}` : "worldwide");
  if (localOpportunity && localOpportunity !== "any") {
    parts.push(localOpportunity.replace(/_/g, " "));
  }
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
    localOpportunity,
    investorStage,
    investorCheck,
    findInvestors,
    summary: parts.join(" · "),
  };
}

export { isFindInvestorHunt, isLocalBusinessHunt };

export function mentionsPlace(raw: string): boolean {
  const t = (raw || "").trim();
  return /\b(?:in|near|around|across|based\s+in|located\s+in)\s+(?:the\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?/.test(
    t,
  );
}

export function shouldClarify(classified: ClassifiedQuery): boolean {
  const raw = (classified.raw || "").trim();
  if (!raw) return true;
  if (raw.split(/\s+/).length <= 2) return true;
  if (craftLooksUncertain(classified.coreSkill)) return true;

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

  const hasPlace = !!classified.location || mentionsPlace(raw);
  const hasAudience = !!extractStatedAudience(raw);
  const hasBuyer = hasStatedBuyerType(raw);
  const hasHiring = DEMAND_VERB_RE.test(raw);

  // Precise hiring queries with place + craft: search immediately.
  if (
    !craftLooksUncertain(classified.coreSkill) &&
    hasPlace &&
    (hasBuyer || hasHiring) &&
    raw.split(/\s+/).length >= 5
  ) {
    return false;
  }

  // Clear clients hunt with craft + audience already stated: only geography
  // might remain — if place is present, skip the panel entirely.
  if (
    isClientsBuyerHunt(classified) &&
    !craftLooksUncertain(classified.coreSkill) &&
    hasAudience &&
    hasPlace &&
    raw.split(/\s+/).length >= 5
  ) {
    return false;
  }

  // Only open the panel when we would actually ask something.
  const questions = buildClarifyingQuestions(classified, {
    hasLocation: hasPlace,
  });
  return questions.length > 0;
}
