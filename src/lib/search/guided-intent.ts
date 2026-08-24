/**
 * Guided page-search intent parsing — deterministic, regex-only.
 *
 * Directory pages (Businesses / Investors / Jobs) no longer expose a filter
 * panel. Instead the user types a free-form ask ("10 dentist shops in Austin,
 * Texas"), we extract every dimension we can CONFIRM from the text, and the
 * questionnaire asks only for what is genuinely missing — plus a few
 * fixed ICP questions (service, contact requirement, list size, engagement
 * type) that describe the searcher and can never be read from the text.
 * No model is in the loop: the same input always yields the same structured
 * intent, so the flow cannot hallucinate a category or a city the user never
 * wrote.
 */

export type GuidedDomain = "businesses" | "investors" | "jobs";

export interface ParsedIntent {
  /** Businesses: what kind of business to find ("dentists", "med spas"). */
  category?: string;
  /** Free keyword for jobs (role) / investors (keyword context). */
  query?: string;
  location?: string;
  /** Investors dimensions. */
  sector?: string;
  stage?: "Pre-seed" | "Seed" | "Series A" | "Series B";
  checkBand?: "angel" | "seed" | "growth";
  entityType?: "individual" | "firm";
  /** Jobs dimensions. */
  seniority?: "intern" | "junior" | "mid" | "senior" | "lead";
  remoteOnly?: boolean;
  /** Jobs: coarse region derived from explicit region words (not cities). */
  region?: "remote" | "north_america" | "europe" | "asia" | "middle_east";
}

// ── gazetteer ───────────────────────────────────────────────────────────────

/** Known places, longest first so "new york" wins over partial words. */
const PLACES = [
  "new york city",
  "san francisco",
  "los angeles",
  "ho chi minh city",
  "mexico city",
  "sao paulo",
  "buenos aires",
  "cape town",
  "tel aviv",
  "abu dhabi",
  "kuala lumpur",
  "san antonio",
  "san diego",
  "san jose",
  "fort worth",
  "kansas city",
  "new orleans",
  "north carolina",
  "south carolina",
  "new jersey",
  "north america",
  "middle east",
  "latin america",
  "united states",
  "united kingdom",
  "new york",
  "las vegas",
  "hong kong",
  "new delhi",
  "philadelphia",
  "jacksonville",
  "columbus",
  "charlotte",
  "indianapolis",
  "seattle",
  "denver",
  "boston",
  "nashville",
  "detroit",
  "portland",
  "memphis",
  "louisville",
  "baltimore",
  "milwaukee",
  "albuquerque",
  "tucson",
  "fresno",
  "sacramento",
  "atlanta",
  "miami",
  "raleigh",
  "omaha",
  "minneapolis",
  "tampa",
  "orlando",
  "austin",
  "houston",
  "dallas",
  "chicago",
  "phoenix",
  "toronto",
  "vancouver",
  "montreal",
  "calgary",
  "ottawa",
  "london",
  "manchester",
  "birmingham",
  "leeds",
  "glasgow",
  "edinburgh",
  "dublin",
  "berlin",
  "munich",
  "paris",
  "amsterdam",
  "barcelona",
  "madrid",
  "milan",
  "rome",
  "stockholm",
  "copenhagen",
  "warsaw",
  "lisbon",
  "vienna",
  "zurich",
  "brussels",
  "dubai",
  "riyadh",
  "doha",
  "singapore",
  "tokyo",
  "osaka",
  "seoul",
  "sydney",
  "melbourne",
  "brisbane",
  "auckland",
  "mumbai",
  "bangalore",
  "delhi",
  "hyderabad",
  "chennai",
  "karachi",
  "lahore",
  "dhaka",
  "chittagong",
  "jakarta",
  "bangkok",
  "manila",
  "lagos",
  "nairobi",
  "cairo",
  "johannesburg",
  "istanbul",
  "texas",
  "california",
  "florida",
  "illinois",
  "pennsylvania",
  "ohio",
  "georgia",
  "michigan",
  "virginia",
  "washington",
  "arizona",
  "massachusetts",
  "tennessee",
  "indiana",
  "missouri",
  "maryland",
  "wisconsin",
  "colorado",
  "minnesota",
  "alabama",
  "louisiana",
  "kentucky",
  "oregon",
  "oklahoma",
  "connecticut",
  "usa",
  "u.s.a",
  "u.s",
  "america",
  "canada",
  "europe",
  "asia",
  "africa",
  "australia",
].sort((a, b) => b.length - a.length);

const REGION_MAP: Record<string, ParsedIntent["region"]> = {
  "north america": "north_america",
  usa: "north_america",
  "u.s.a": "north_america",
  "u.s": "north_america",
  america: "north_america",
  "united states": "north_america",
  canada: "north_america",
  europe: "europe",
  asia: "asia",
  "middle east": "middle_east",
};

// ── token banks ─────────────────────────────────────────────────────────────

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|dozens|couple of|couple|few|several";

const MEASURE_NOUNS =
  "businesses|business|companies|company|firms|firm|shops|shop|stores|store|listings|listing|leads|lead|results|options|records|profiles|investors|investor|vcs|vc|angels|angel|jobs|job|roles|role|positions|position|openings|vacancies|candidates|people|places";

/** Filler phrases removed when isolating the core ask. Longest first. */
const FILLER = [
  "with no website",
  "without a website",
  "without website",
  "help me find",
  "i'm looking for",
  "i am looking for",
  "im looking for",
  "we're looking for",
  "we are looking for",
  "i would like",
  "looking for",
  "look for",
  "help me",
  "find me",
  "show me",
  "give me",
  "get me",
  "search for",
  "search",
  "find",
  "get",
  "list of",
  "i need",
  "i want",
  "we need",
  "we want",
  "need",
  "want",
  "please",
  "fetch",
  "pull",
  "source",
  "some",
  "etc",
  "i'm a",
  "i am a",
  "im a",
  "i'm an",
  "i am an",
  "like this",
  "like that",
  "worth selling",
  "for sale",
  "to buy",
  "to acquire",
  "that are",
  "that is",
  "which are",
  "which is",
  "who are",
  "who is",
  "that",
  "which",
  "where",
  "who",
  "with",
  "my",
  "our",
  "me",
  "we",
  "us",
  "in",
  "near",
  "around",
  "at",
  "across",
  "a",
  "an",
  "the",
  "of",
  "for",
  "to",
].sort((a, b) => b.length - a.length);

const INVESTOR_NOISE = [
  "venture capital",
  "angel investors",
  "investors",
  "investor",
  "backers",
  "backing",
  "raising",
  "raise",
  "investing",
  "invests",
  "invest",
  "startups",
  "startup",
  "checks",
  "check",
  "funds",
  "money",
  "capital",
].sort((a, b) => b.length - a.length);

const JOB_NOISE = [
  "openings",
  "vacancies",
  "opportunities",
  "positions",
  "position",
  "roles",
  "role",
  "jobs",
  "job",
  "gigs",
  "hiring",
].sort((a, b) => b.length - a.length);

const GENERIC_BUSINESS_NOUNS =
  /^(businesses|business|companies|company|firms|firm|shops|shop|stores|store|listings|leads|records|profiles)\s+(?=[a-z])/i;

const SECTORS: [RegExp, string][] = [
  [/\bartificial intelligence\b|\bmachine learning\b|\bai\b|\bml\b/i, "AI"],
  [/\bfintech\b|\bfinancial technology\b/i, "Fintech"],
  [/\bhealthcare\b|\bhealth tech\b|\bmedtech\b|\bhealth\b/i, "Healthcare"],
  [/\bclimate tech\b|\bclimatetech\b|\bcleantech\b|\bclimate\b/i, "Climate"],
  [/\bsaas\b/i, "SaaS"],
  [/\bdevtools\b|\bdeveloper tools\b/i, "DevTools"],
  [/\bcrypto\b|\bweb3\b|\bblockchain\b/i, "Crypto/Web3"],
  [/\bbiotech\b/i, "Biotech"],
  [/\bedtech\b|\beducation tech\b/i, "EdTech"],
  [/\be-?commerce\b/i, "E-commerce"],
  [/\bgaming\b|\bvideo games?\b/i, "Gaming"],
  [/\bcybersecurity\b|\bcyber security\b/i, "Cybersecurity"],
  [/\brobotics\b/i, "Robotics"],
  [/\bspace tech\b|\bspacetech\b/i, "Space"],
  [/\bclean energy\b|\brenewables?\b/i, "Energy"],
  [/\bmarketplace(s)?\b/i, "Marketplace"],
  [/\bconsumer\b/i, "Consumer"],
  [/\bb2b\b|\benterprise\b/i, "B2B/Enterprise"],
  [/\bmobile\b/i, "Mobile"],
  [/\bagtech\b|\bagriculture tech\b/i, "AgTech"],
  [/\blogistics\b|\bsupply chain\b/i, "Logistics"],
];

// ── helpers ─────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cut(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s{2,}/g, " ").trim();
}

function stripAll(text: string, words: string[], maxPasses = 6): string {
  let out = text;
  const re = new RegExp(`\\b(?:${words.map(escapeRe).join("|")})\\b`, "gi");
  for (let i = 0; i < maxPasses; i++) {
    const next = out
      .replace(re, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function titleCasePlace(place: string): string {
  return place
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ")
    .replace(/\bUsa\b/, "USA");
}

function tidyCore(core: string): string | undefined {
  const cleaned = core
    .replace(/[\u2018\u2019'"]/g, "")
    .replace(/[^a-zA-Z0-9+#./& -]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return undefined;
  // A leftover that is itself just a measure noun carries no search meaning.
  if (new RegExp(`^(?:${MEASURE_NOUNS})$`, "i").test(cleaned)) return undefined;
  return cleaned;
}

// ── parser ──────────────────────────────────────────────────────────────────

/**
 * Extract every dimension the text actually states. Only fields present in
 * the input are set — everything else stays undefined so the questionnaire
 * can ask for it.
 */
export function parseSearchIntent(domain: GuidedDomain, raw: string): ParsedIntent {
  const intent: ParsedIntent = {};
  const text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return intent;

  let working = text;

  // 1) Remote (jobs only) — before location so "remote" never becomes a place.
  if (domain === "jobs" && /\bremote\b/i.test(working)) {
    intent.remoteOnly = true;
    intent.region = "remote";
    working = working
      .replace(/\bremote\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // 2) Investor stage (investors only — "seed shops" must stay a category).
  const stagePatterns: [RegExp, ParsedIntent["stage"]][] = [
    [/\bpre-?seed\b/i, "Pre-seed"],
    [/\bseries\s*b\b/i, "Series B"],
    [/\bseries\s*a\b/i, "Series A"],
    [/\bseed\b/i, "Seed"],
  ];
  if (domain === "investors") {
    for (const [re, stage] of stagePatterns) {
      const m = re.exec(working);
      if (m) {
        intent.stage = stage;
        working = cut(working, m.index, m.index + m[0].length);
        break;
      }
    }
  }

  // 3) Investor entity type — before check size so "angel investors" reads as
  //    WHO they are (individuals), not a check-size band.
  if (domain === "investors") {
    if (/\bangels?\b/i.test(working)) {
      intent.entityType = "individual";
      working = working
        .replace(/\bangels?\b/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    } else if (/\b(?:vcs?|venture|firms?)\b/i.test(working)) {
      intent.entityType = "firm";
      working = working
        .replace(/\b(?:vcs?|venture|firms?)\b/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  // 4) Investor check-size band.
  if (domain === "investors") {
    const checkPatterns: [RegExp, ParsedIntent["checkBand"]][] = [
      [/\bangel\b/i, "angel"],
      [
        /\$?5\s*m(?:illions?)?\s*\+|\b5\s*million\s*\+|\$10\s*m\b|\$?\d{2,3}\s*m(?:illions?)?\b|\bgrowth(?:\s*stage)?\b|\blate\s*stage\b|\bseries\s*c\b/i,
        "growth",
      ],
      [
        /\$?\d+\s*k\b\s*[–—-]\s*\$?\d+\s*m(?:illions?)?\b|\$?100\s*k\b|\$?250\s*k\b|\$?500\s*k\b|\$?[1-4]\s*m(?:illions?)?\b|\bup\s*to\s*\$?5\s*m\b/i,
        "seed",
      ],
    ];
    for (const [re, band] of checkPatterns) {
      const m = re.exec(working);
      if (m) {
        intent.checkBand = band;
        working = cut(working, m.index, m.index + m[0].length);
        break;
      }
    }
  }

  // 5) Jobs seniority (jobs only — "senior care homes" must stay a category).
  if (domain === "jobs") {
    const seniorityPatterns: [RegExp, ParsedIntent["seniority"]][] = [
      // "internship(s)" must win before junior — it is its own level, not a
      // junior alias, and leaving it in the query breaks title matching.
      [/\b(?:intern|interns|internship|internships|trainee)\b/i, "intern"],
      [/\b(?:junior|entry[ -]?level|entry level|graduate)\b/i, "junior"],
      [/\b(?:mid[ -]?level|mid level|intermediate)\b/i, "mid"],
      [/\b(?:senior|sr\.?)\b/i, "senior"],
      [/\b(?:lead|principal|staff|head of|manager|director)\b/i, "lead"],
    ];
    for (const [re, level] of seniorityPatterns) {
      const m = re.exec(working);
      if (m) {
        intent.seniority = level;
        working = cut(working, m.index, m.index + m[0].length);
        break;
      }
    }
  }

  // 6) Investor sector (canonical label) — before location so capitalized
  //    sector words ("AI") are never mistaken for a place.
  if (domain === "investors") {
    for (const [re, label] of SECTORS) {
      const m = re.exec(working);
      if (m) {
        intent.sector = label;
        working = cut(working, m.index, m.index + m[0].length);
        break;
      }
    }
  }

  // 7) Location — "in/near <Capitalized Place>" first (captures multi-word
  //    places like "Austin, Texas"), then known place names for bare mentions.
  let location: string | undefined;
  const prep =
    /\b(?:in|near|around|at|across|based\s+in|located\s+in)\s+([A-Z][A-Za-z.'-]*(?:\s*,?\s+[A-Z][A-Za-z.'-]+){0,3})/.exec(
      working,
    );
  if (prep) {
    location = prep[1].trim();
    working = cut(working, prep.index, prep.index + prep[0].length);
  } else {
    // Bare mentions: collect every known place ("austin texas" →
    // "Austin, Texas"), longest names first.
    const found: string[] = [];
    for (const place of PLACES) {
      if (found.length >= 3) break;
      const re = new RegExp(`(?<=\\b)${escapeRe(place)}(?=\\b)`, "i");
      const m = re.exec(working);
      if (m) {
        found.push(titleCasePlace(m[0]));
        working = cut(working, m.index, m.index + m[0].length);
      }
    }
    if (found.length) location = found.join(", ");
  }
  if (location) {
    intent.location = location.replace(/,$/, "").trim();
    const region = REGION_MAP[location.toLowerCase()];
    if (region && intent.region !== "remote") intent.region = region;
  }

  // 8) Core ask: strip counts, filler phrases and domain noise.
  let core = working;
  core = core.replace(
    new RegExp(
      `\\b(?:\\d+|${NUMBER_WORDS})\\s+(?:more\\s+)?(?:other\\s+)?(?:${MEASURE_NOUNS})\\b`,
      "gi",
    ),
    " ",
  );
  core = core.replace(new RegExp(`\\b(?:${NUMBER_WORDS})\\b`, "gi"), " ");
  core = core.replace(/\b\d+\b/g, " ");

  if (domain === "jobs") {
    core = stripAll(core, JOB_NOISE);
    core = stripAll(core, FILLER);
  } else if (domain === "investors") {
    core = stripAll(core, INVESTOR_NOISE);
    core = stripAll(core, FILLER);
  } else {
    core = stripAll(core, FILLER);
    // "businesses looking for web development" → drop the leading generic
    // noun so the category becomes the actual ask.
    while (GENERIC_BUSINESS_NOUNS.test(core)) {
      core = core.replace(GENERIC_BUSINESS_NOUNS, "").trim();
    }
  }

  const cleaned = tidyCore(core);
  if (cleaned) {
    if (domain === "businesses") intent.category = cleaned.toLowerCase();
    else intent.query = cleaned;
  }

  return intent;
}

// ── questionnaire ───────────────────────────────────────────────────────────

export type FlowOption = {
  value: string;
  label: string;
  hint?: string;
  /** Rendered as a badge so users can trust the default. */
  recommended?: boolean;
};

export type FlowQuestion = {
  id: string;
  question: string;
  options: FlowOption[];
  /** Free-text answer is always allowed when set. */
  allowOther?: boolean;
  otherPlaceholder?: string;
  /** Value recorded when the user skips. Omitted + required = no skip. */
  skipValue?: string;
  /** Required questions have no Skip button (the search cannot run without). */
  required?: boolean;
};

export type FlowAnswers = Record<string, string>;

export const REMOTE_OPTION = "__remote__";

/**
 * Questions for whatever the parser could NOT confirm. Fully-specified inputs
 * (e.g. "dentists in Austin, Texas") skip the target questions, but the
 * businesses flow always appends its ICP questions — what the user sells,
 * their contact requirement, and list size describe the person searching, so
 * they cannot be read from the ask itself.
 */
export function buildGuidedQuestions(domain: GuidedDomain, parsed: ParsedIntent): FlowQuestion[] {
  const qs: FlowQuestion[] = [];

  if (domain === "businesses") {
    if (!parsed.category) {
      qs.push({
        id: "category",
        question: "What type of business do you want to find?",
        options: [
          { value: "dentists", label: "Dentists" },
          { value: "roofers", label: "Roofers" },
          { value: "gyms", label: "Gyms" },
          { value: "law firms", label: "Law firms" },
          { value: "med spas", label: "Med spas" },
          { value: "restaurants", label: "Restaurants" },
          { value: "marketing agencies", label: "Marketing agencies" },
          { value: "salons", label: "Salons" },
        ],
        allowOther: true,
        otherPlaceholder: "e.g. electricians, cafes, plumbers…",
        required: true,
      });
    }
    if (!parsed.location) {
      qs.push({
        id: "location",
        question: "Which city or area should we search?",
        options: [
          { value: "Austin, TX", label: "Austin, TX" },
          { value: "Toronto", label: "Toronto" },
          { value: "London", label: "London" },
          { value: "New York", label: "New York" },
          { value: "Miami", label: "Miami" },
          { value: "Dhaka", label: "Dhaka" },
        ],
        allowOther: true,
        otherPlaceholder: "e.g. Chicago, Manchester, Karachi…",
        required: true,
      });
    }
    // ICP questions — what the user sells shapes which businesses are worth
    // contacting, and the requirement answer becomes an automatic filter.
    qs.push({
      id: "service",
      question: "What do you sell / what's your service?",
      options: [
        { value: "web design", label: "Web design / development" },
        { value: "marketing", label: "Marketing / ads" },
        { value: "seo", label: "SEO" },
        { value: "software", label: "Software / apps" },
        { value: "photography", label: "Photography / video" },
        { value: "accounting", label: "Accounting / bookkeeping" },
      ],
      allowOther: true,
      otherPlaceholder: "e.g. coffee equipment supply, HR consulting…",
      skipValue: "",
    });
    qs.push({
      id: "requirement",
      question: "What should every business on this list have?",
      options: [
        { value: "contact", label: "Email or phone", hint: "Ready to contact", recommended: true },
        { value: "email", label: "Email address" },
        { value: "phone", label: "Phone number" },
        { value: "website", label: "A website I can review" },
        { value: "any", label: "No requirement" },
      ],
      skipValue: "contact",
    });
    // Pain-signal question — the answer becomes the ICP opportunity filter
    // (same tags as the post-search chips, applied up front).
    qs.push({
      id: "opportunity",
      question: "What kind of businesses do you want on this list?",
      options: [
        { value: "any", label: "Any business", hint: "No signal filter", recommended: true },
        { value: "no_website", label: "Businesses with no website", hint: "Need one built" },
        { value: "poor_design", label: "Outdated / poor design", hint: "Redesign prospects" },
        { value: "not_mobile_friendly", label: "Not mobile-friendly", hint: "Losing mobile visitors" },
        { value: "seo_poor", label: "Weak SEO", hint: "Ranking poorly on Google" },
        { value: "sales_ready", label: "Sales-ready", hint: "Reachable with a live site" },
      ],
      skipValue: "any",
    });
    qs.push({
      id: "count",
      question: "How many businesses do you need?",
      options: [
        { value: "10", label: "10" },
        { value: "25", label: "25" },
        { value: "50", label: "50" },
        { value: "any", label: "As many as possible", recommended: true },
      ],
      skipValue: "any",
    });
    return qs;
  }

  if (domain === "investors") {
    if (!parsed.stage) {
      qs.push({
        id: "stage",
        question: "What stage are you raising?",
        options: [
          { value: "Pre-seed", label: "Pre-seed" },
          { value: "Seed", label: "Seed", hint: "Most common early raise" },
          { value: "Series A", label: "Series A" },
          { value: "Series B", label: "Series B+" },
          { value: "any", label: "Any stage" },
        ],
        skipValue: "any",
      });
    }
    if (!parsed.checkBand) {
      qs.push({
        id: "checkBand",
        question: "Rough check size do you need?",
        options: [
          { value: "angel", label: "Angel (<$100K)" },
          { value: "seed", label: "$100K–$5M", hint: "Typical seed / early VC" },
          { value: "growth", label: "$5M+" },
          { value: "any", label: "Any size" },
        ],
        skipValue: "any",
      });
    }
    if (!parsed.location) {
      qs.push({
        id: "location",
        question: "Where should they be based or invest?",
        options: [
          { value: "", label: "Worldwide", hint: "No location filter" },
          { value: "USA", label: "United States" },
          { value: "Europe", label: "Europe" },
          { value: "UK", label: "UK" },
          { value: "Asia", label: "Asia" },
        ],
        allowOther: true,
        otherPlaceholder: "e.g. Middle East, Canada, Berlin…",
        skipValue: "",
      });
    }
    if (!parsed.sector && !parsed.query) {
      qs.push({
        id: "sector",
        question: "What does your startup do? (helps us rank sector matches)",
        options: [
          { value: "AI", label: "AI / ML" },
          { value: "Fintech", label: "Fintech" },
          { value: "Healthcare", label: "Healthcare" },
          { value: "Climate", label: "Climate" },
          { value: "SaaS", label: "SaaS" },
          { value: "DevTools", label: "DevTools" },
        ],
        allowOther: true,
        otherPlaceholder: "e.g. Crypto, Gaming, logistics software…",
        skipValue: "",
      });
    }
    if (!parsed.entityType) {
      qs.push({
        id: "entityType",
        question: "Who do you want to reach?",
        options: [
          { value: "any", label: "Both", hint: "Firms and individual angels", recommended: true },
          { value: "firm", label: "VC firms", hint: "Institutional checks" },
          { value: "individual", label: "Angel investors", hint: "Individual checks" },
        ],
        skipValue: "any",
      });
    }
    return qs;
  }

  // jobs
  if (!parsed.query) {
    qs.push({
      id: "query",
      question: "What role should we search for?",
      options: [
        { value: "designer", label: "Designer" },
        { value: "developer", label: "Developer" },
        { value: "marketer", label: "Marketer" },
        { value: "sales", label: "Sales" },
        { value: "data analyst", label: "Data analyst" },
      ],
      allowOther: true,
      otherPlaceholder: "e.g. nurse, product manager, welder…",
      skipValue: "",
    });
  }
  if (!parsed.location && !parsed.remoteOnly) {
    qs.push({
      id: "location",
      question: "Where do you want to work?",
      options: [
        { value: REMOTE_OPTION, label: "Remote", hint: "Remote-only postings" },
        { value: "New York", label: "New York" },
        { value: "London", label: "London" },
        { value: "Toronto", label: "Toronto" },
        { value: "Austin, TX", label: "Austin, TX" },
        { value: "", label: "Anywhere", hint: "No location filter" },
      ],
      allowOther: true,
      otherPlaceholder: "e.g. Berlin, Dubai, Singapore…",
      skipValue: "",
    });
  }
  if (!parsed.seniority) {
    qs.push({
      id: "seniority",
      question: "What seniority level?",
      options: [
        { value: "intern", label: "Intern / Entry-level" },
        { value: "junior", label: "Junior" },
        { value: "mid", label: "Mid" },
        { value: "senior", label: "Senior" },
        { value: "lead", label: "Lead / Manager" },
        { value: "any", label: "Any level" },
      ],
      skipValue: "any",
    });
  }
  qs.push({
    id: "employmentType",
    question: "What kind of engagement?",
    options: [
      { value: "any", label: "Any", recommended: true },
      { value: "full-time", label: "Full-time" },
      { value: "contract", label: "Contract / freelance" },
      { value: "part-time", label: "Part-time" },
      { value: "internship", label: "Internship" },
    ],
    skipValue: "any",
  });
  return qs;
}
