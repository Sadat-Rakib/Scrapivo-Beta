/**
 * Guided page-search intent parsing — deterministic, regex-only.
 *
 * Directory pages (Businesses / Investors / Jobs) no longer expose a filter
 * panel. Instead the user types a free-form ask ("10 dentist shops in Austin,
 * Texas"), we extract every dimension we can CONFIRM from the text, and the
 * questionnaire asks only for what is genuinely missing. When category,
 * location, role, seniority, count, or engagement are already stated in
 * the text, those questions are skipped.
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
  /** Jobs: full-time | contract | part-time | internship | any */
  employmentType?: string;
  remoteOnly?: boolean;
  /** Jobs: coarse region derived from explicit region words (not cities). */
  region?: "remote" | "north_america" | "europe" | "asia" | "middle_east";
  /** Businesses: how many listings the user wants (numeric or null = any). */
  count?: number | null;
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
  // Canadian provinces / territories
  "british columbia",
  "new brunswick",
  "newfoundland",
  "nova scotia",
  "northwest territories",
  "prince edward island",
  "alberta",
  "ontario",
  "quebec",
  "manitoba",
  "saskatchewan",
  "yukon",
  "nunavut",
  // Australian states
  "new south wales",
  "western australia",
  "south australia",
  // UK nations
  "scotland",
  "wales",
  "northern ireland",
  "england",
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
  "and",
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

const NUMBER_WORD_MAP: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  dozen: 12,
  dozens: 12,
};

function parseCountFromText(text: string): { count?: number; rest: string } {
  const measureRe = new RegExp(
    `\\b(\\d+|${NUMBER_WORDS})\\s+(?:more\\s+)?(?:other\\s+)?(?:${MEASURE_NOUNS})\\b`,
    "i",
  );
  const m = measureRe.exec(text);
  if (m) {
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORD_MAP[raw] ?? undefined);
    if (n != null && n > 0) {
      return { count: n, rest: cut(text, m.index, m.index + m[0].length) };
    }
  }
  const bare = /\b(\d+)\b/.exec(text);
  if (bare) {
    const n = Number(bare[1]);
    if (n > 0 && n <= 500) {
      return { count: n, rest: cut(text, bare.index, bare.index + bare[0].length) };
    }
  }
  return { rest: text };
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

  // 0) Businesses count — before location/category stripping.
  if (domain === "businesses") {
    const { count, rest } = parseCountFromText(working);
    if (count != null) intent.count = count;
    working = rest;
  }

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

  // 5) Jobs seniority + employment type (jobs only).
  if (domain === "jobs") {
    const employmentPatterns: [RegExp, string][] = [
      [/\b(?:intern|interns|internship|internships|trainee)\b/i, "internship"],
      [/\b(?:full[ -]?time|permanent)\b/i, "full-time"],
      [/\b(?:part[ -]?time)\b/i, "part-time"],
      [/\b(?:contract|freelance|freelancer|c2c|1099)\b/i, "contract"],
    ];
    for (const [re, etype] of employmentPatterns) {
      const m = re.exec(working);
      if (m) {
        intent.employmentType = etype;
        if (etype === "internship") intent.seniority = "intern";
        working = cut(working, m.index, m.index + m[0].length);
        break;
      }
    }

    const seniorityPatterns: [RegExp, ParsedIntent["seniority"]][] = [
      [/\b(?:intern|interns|internship|internships|trainee)\b/i, "intern"],
      [/\b(?:junior|entry[ -]?level|entry level|graduate)\b/i, "junior"],
      [/\b(?:mid[ -]?level|mid level|intermediate)\b/i, "mid"],
      [/\b(?:senior|sr\.?)\b/i, "senior"],
      [/\b(?:lead|principal|staff|head of|manager|director)\b/i, "lead"],
    ];
    if (!intent.seniority) {
      for (const [re, level] of seniorityPatterns) {
        const m = re.exec(working);
        if (m) {
          intent.seniority = level;
          if (level === "intern" && !intent.employmentType) intent.employmentType = "internship";
          working = cut(working, m.index, m.index + m[0].length);
          break;
        }
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

  // 7) Location — last "in/near <Place>" wins; peel nested "in X in Y" down to Y.
  let location: string | undefined;
  const prepRe =
    /\b(?:in|near|around|at|across|based\s+in|located\s+in)\s+([a-z][a-z.'-]*(?:\s*,?\s+[a-z][a-z.'-]+){0,4})/gi;
  const prepMatches: RegExpExecArray[] = [];
  for (let m = prepRe.exec(working); m; m = prepRe.exec(working)) prepMatches.push(m);
  const prepMatch = prepMatches.at(-1) ?? null;
  if (prepMatch) {
    const afterPrep = prepMatch[0]
      .replace(/^\s*\b(?:in|near|around|at|across|based\s+in|located\s+in)\s+/i, "")
      .trim();
    const nested = afterPrep.split(/\s+\bin\b\s+/i);
    let captured = nested[nested.length - 1].trim();
    captured = captured.replace(/\s+\b(?:for|at|near)\b\s+.*$/i, "").trim();
    location = titleCasePlace(captured);
    working = cut(working, prepMatch.index, prepMatch.index + prepMatch[0].length);
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
 * (e.g. "10 cafes in Dubai", "hvac in Alberta") skip every dimension already
 * extracted from the text.
 */
export function buildGuidedQuestions(domain: GuidedDomain, parsed: ParsedIntent): FlowQuestion[] {
  const qs: FlowQuestion[] = [];

  if (domain === "businesses") {
    const fullySpecified = Boolean(parsed.category && parsed.location);

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

    // When category + location are known, skip ICP wizard — search immediately.
    if (fullySpecified) {
      if (parsed.count == null) {
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
      }
      return qs;
    }

    // Partial ask — optional ICP refinements only when target fields were missing.
    if (parsed.count == null) {
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
    }
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
  if (!parsed.employmentType) {
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
  }
  return qs;
}
