/**
 * Deterministic intent extractor: user text (+ existing classifier outputs)
 * → SearchSpec (Phase 1).
 *
 * Layered, cheapest-first: entity nouns → role/industry/location slots →
 * signal requirement. Inferred fields carry confidence and stated=false.
 * Fixes (locked): demand-verb veto bypass for craft-less entity nouns (R1),
 * person-noun branch before seller craft (R2), product guard for person nouns
 * (R4), NY/NYC/LA/SF aliases (R5).
 */
import {
  buildSpec,
  stated,
  type LocationSuggestion,
  type SearchSpec,
  type SpecEntity,
  type SpecField,
} from "./search-spec";
// Place-wording single-sourced in location-resolver (also read by the
// index normalizer via normCityLookup below).
import {
  COUNTRY_ISO,
  GEO_ALIAS,
  resolveCanonicalLocation,
  resolveLocationToken,
  suggestLocation,
  type GeoEntity,
} from "./location-resolver";

export { COUNTRY_ISO };
import {
  extractFundingSignal,
  extractNeedPhrase,
  indexInNeedSpan,
} from "./need-phrase";

/** Normalized city lookup value (canonical-lower): mirrors the loader's
 *  norm_lookup_city in scripts/pipeline/store.py for ASCII names.
 *  'Bombay' -> 'mumbai', 'Pune' -> 'pune'. Display casing lives elsewhere. */
export function normCityLookup(raw: string): string {
  const low = raw
    .normalize("NFKD")
    .replace(/([\p{Script=Latin}])\p{M}+/gu, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  if (GEO_ALIAS[low]) return GEO_ALIAS[low].toLowerCase();
  return low;
}

/** Canonical location name → ISO2 stems: owned by location-resolver (re-exported). */

const PERSON_NOUNS =
  /\b(founders?|co-?founders?|ceo|ceos|cto|ctos|owners?|people|executives?|professionals?|designers?|developers?|engineers?|writers?|copywriters?|marketers?|managers?|directors?|leads?|recruiters?|principals?|partners?|researchers?|scientists?|agents?)\b/i;
const BUSINESS_NOUNS =
  /\b(business(es)?|compan(y|ies)|agenc(y|ies)|brands?|shops?|stores?|restaurants?|contractors?|plumbers?|plumbing|dentists?|dental|electricians?|roofers?|roofing|salons?|gyms?|cafes?|bakeries?|bakery|locksmiths?|landscapers?|hvac|barbers?|hotels?|spas?|mechanics?|lawyers?|attorneys?|florists?|clinics?|d2c|dtc|b2b|b2c|coffee\s+roasters?|roasters?|yoga(\s+studios?)?|studios?|boutiques?|pharmacies?|pharmacy|veterinar(?:y|ies|ians?)|vets?|chiropractors?|optometrists?|accountants?|bookkeepers?|photographers?|caterers?|cleaners?|janitorial|movers?|painters?|welders?|fabricators?|startups?|installers?|solar|forwarders?|freight|logistics|couriers?|hauliers?|truckers?|carriers?|shippers?|transport(?:ation|ers?)|brokers?|builders?|construction|renovators?|gardeners?|surveyors?|inspectors?|appraisers?|restorers?|repairers?|technicians?|tailors?|printers?|suppliers?|manufacturers?|distributors?|wholesalers?|importers?|exporters?|dealers?|butchers?|bakers?|videographers?|exterminators?|opticians?|hospitals?|realtors?|realty|real[ -]?estate)\b/i;
const ORG_NOUNS =
  /\b(organizations?|organisations?|orgs?|institutes?|firms?|associations?)\b/i;
const INVESTOR_NOUNS = /\b(investors?|vcs?|angels?|funds?)\b/i;
const JOB_NOUNS = /\b(jobs?|roles?|openings?|positions?|careers?)\b/i;

// Legacy regex kept for tests that import SIGNAL_HINT indirectly via extract;
// Phase 1A signal detection is owned by extractNeedPhrase (stem/phrase grammar).
const SIGNAL_HINT =
  /\b(looking for|need(?:s|ing)?\s+(?:a\s+)?(?:web|website|developer|design|marketing|seo|sales|crm|help|agency|freelancer)|hiring|asking for|want(?:s|ing)?\s+(?:a\s+)?(?:new|help|seo|marketing)|(?:seo|marketing|sales)\s+help|without\s+(?:a\s+)?website)\b/i;

void SIGNAL_HINT;

/**
 * Open role ontology: normalize known titles, preserve arbitrary role phrases.
 * A finite list is a shortcut for aliases — never the definition of "person role."
 */
const ROLE_ALIASES: Record<string, string> = {
  founder: "founder",
  founders: "founder",
  "co-founder": "founder",
  cofounder: "founder",
  "co-founders": "founder",
  cofounders: "founder",
  ceo: "ceo",
  ceos: "ceo",
  cto: "cto",
  ctos: "cto",
  cfo: "cfo",
  cfos: "cfo",
  owner: "owner",
  owners: "owner",
  recruiter: "recruiter",
  recruiters: "recruiter",
  principal: "principal",
  principals: "principal",
  partner: "partner",
  partners: "partner",
  "marketing director": "marketing director",
  "marketing directors": "marketing director",
  "principal engineer": "principal engineer",
  "principal engineers": "principal engineer",
  "restaurant manager": "restaurant manager",
  "restaurant managers": "restaurant manager",
  "real estate agent": "real estate agent",
  "real-estate agent": "real estate agent",
  "venture partner": "venture partner",
  "venture partners": "venture partner",
  "ai researcher": "ai researcher",
  "ai researchers": "ai researcher",
  "software engineer": "software engineer",
  "software engineers": "software engineer",
  "sales manager": "sales manager",
  "sales managers": "sales manager",
  copywriter: "copywriter",
  copywriters: "copywriter",
  writer: "writer",
  writers: "writer",
  researcher: "researcher",
  researchers: "researcher",
  dentist: "dentist",
  dentists: "dentist",
  director: "director",
  directors: "director",
  manager: "manager",
  managers: "manager",
  developer: "developer",
  developers: "developer",
  engineer: "engineer",
  engineers: "engineer",
  designer: "designer",
  designers: "designer",
  marketer: "marketer",
  marketers: "marketer",
};

/**
 * Longer compounds first — open ontology; unknown phrases still normalize via
 * normalizeRole(). Never treat this list as the universe of occupations.
 */
const ROLE_PHRASE =
  /\b((?:software|machine[\s-]?learning|principal)\s+engineers?|(?:restaurant|sales|product|project|account|operations?)\s+managers?|(?:marketing|engineering|product|sales|growth|ops|operations|creative)\s+directors?|real[\s-]?estate\s+agents?|venture\s+partners?|ai\s+researchers?|co-?founders?|founders?|ceos?|ctos?|cfos?|owners?|copywriters?|writers?|designers?|developers?|engineers?|marketers?|researchers?|scientists?|recruiters?|principals?|partners?|managers?|directors?|agents?|vps?|vice[\s-]?presidents?)\b/i;

/** Normalize a raw role token; unknown phrases stay as cleaned user wording. */
export function normalizeRole(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  const singular = key.replace(/s$/, "");
  if (ROLE_ALIASES[singular]) return ROLE_ALIASES[singular];
  return key;
}

/**
 * Temporal semantics for M5 → M9: window + relation, not crawl time.
 * signal_recency uses parseRecencyWindow units (Nd / Nw / Nm).
 */
export function extractTemporal(text: string): {
  signal_recency: string | null;
  relation: string | null;
  year: string | null;
} {
  const t = text ?? "";
  const lastDays = t.match(/\blast\s+(\d+)\s+days?\b/i);
  if (lastDays) {
    return { signal_recency: `${lastDays[1]}d`, relation: "last_n_days", year: null };
  }
  const lastWeeks = t.match(/\blast\s+(\d+)\s+weeks?\b/i);
  if (lastWeeks) {
    return { signal_recency: `${lastWeeks[1]}w`, relation: "last_n_weeks", year: null };
  }
  const lastMonths = t.match(/\blast\s+(\d+)\s+months?\b/i);
  if (lastMonths) {
    return { signal_recency: `${lastMonths[1]}m`, relation: "last_n_months", year: null };
  }
  if (/\bthis\s+quarter\b|\bcurrent\s+quarter\b/i.test(t)) {
    return { signal_recency: "3m", relation: "this_quarter", year: null };
  }
  if (/\bcurrently\s+hiring\b|\bcurrently\s+looking\b/i.test(t)) {
    return { signal_recency: "30d", relation: "current", year: null };
  }
  const yearM = t.match(/\bin\s+(20\d{2})\b/);
  if (yearM) {
    return { signal_recency: null, relation: "in_year", year: yearM[1] };
  }
  if (/\brecently\b/i.test(t)) {
    return { signal_recency: "90d", relation: "recent", year: null };
  }
  return { signal_recency: null, relation: null, year: null };
}

/** Salary threshold stated in the query (jobs). */
export function extractSalaryMin(text: string): number | null {
  const t = text ?? "";
  const patterns = [
    /\$\s*([\d,]+)\s*k\+/i,
    /\$\s*([\d,]+)k\b/i,
    /paying\s+\$?\s*([\d,]+)\s*k\+/i,
    /paying\s+\$?\s*([\d,]+)\s*k\b/i,
    /salary\s+(?:of\s+)?\$?\s*([\d,]+)\s*k?\+/i,
    /\$\s*([\d,]+)\+/i,
    /\$\s*([\d,]+)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    let n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    // Bare "$150" in a salary context is thousands when followed by k, else dollars.
    if (/k/i.test(m[0]) || n < 1000) {
      if (n < 1000) n = n * 1000;
    }
    return n;
  }
  return null;
}

const TECH_RE =
  /\b(react(?:\.?js| native)?|vue(?:\.?js)?|angular|python|golang|rust|kotlin|swift|typescript|javascript|node\.?js|java|ruby|php|rails|django|\.net|c\+\+|flutter|kubernetes|k8s|aws|gcp|azure|next\.?js|remix)\b/i;

/** Technology / stack token from the query. */
export function extractTechnology(text: string): string | null {
  const m = (text ?? "").match(TECH_RE);
  if (!m) return null;
  const v = m[1].toLowerCase().replace(/\.js$/, "").replace(/\s+/g, " ");
  if (v.startsWith("react")) return v.includes("native") ? "React Native" : "React";
  if (v.startsWith("vue")) return "Vue";
  if (v.startsWith("node")) return "Node.js";
  if (v.startsWith("next")) return "Next.js";
  if (v === "golang") return "Go";
  if (v === "k8s") return "Kubernetes";
  if (v === "javascript") return "JavaScript";
  if (v === "typescript") return "TypeScript";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** Explicit worldwide / global scope — not a city. */
const WORLDWIDE_RE = /\b(worldwide|globally|global|anywhere|world[\s-]?wide)\b/i;

/**
 * Entity taxonomy (Phase 2): agency / brand / D2C / B2B / B2C qualifiers.
 * Single owner for model-wording knowledge; the extractor stores a
 * `business_model` criterion, validation filters on it. Optional only —
 * never added to REQUIRED so existing ready/clarify contracts hold.
 */
export function extractBusinessModel(text: string): string | null {
  const t = (text ?? "").toLowerCase();
  if (/\bd2c\b|\bdtc\b|direct-to-consumer|direct to consumer/.test(t)) return "d2c";
  if (/\bb2b\b|business-to-business|business to business/.test(t)) return "b2b";
  if (/\bb2c\b|business-to-consumer|business to consumer/.test(t)) return "b2c";
  if (/\bagenc(y|ies)\b/.test(t)) return "agency";
  if (/\bbrands?\b/.test(t)) return "brand";
  return null;
}

function normGeo(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  const low = t.toLowerCase();
  if (GEO_ALIAS[low]) return GEO_ALIAS[low];
  // "Ny" → "New York" handled via alias on lowercase; Title-case the rest.
  return t
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Tokens that look like "in X" but are funding stages, never places. */
const NON_GEO_AFTER_IN =
  /^(pre-?seed|seed|series(\s*[a-bcd])?|funding|capital|round|rounds|money|funds?|raise|raising)$/i;

/**
 * Raw geo hit: the typed words plus the display value. `known` is true when
 * the words match the alias table OR the country-name table (COUNTRY_ISO owns
 * country names; GEO_ALIAS owns cities/aliases) — unknown words (typos like
 * "Daaka", or real unlisted cities) are returned unresolved so the caller
 * can suggest (fuzzy) or state verbatim (gazetteer may know it).
 */
function extractGeo(text: string): { raw: string; value: string; known: boolean } | null {
  // Collect ALL "in X" / "near X" candidates, prefer the LAST real place.
  // Fixes "investors in pre-seed in AI worldwide" which used to capture
  // "pre-seed in AI worldwide" as the location.
  // Unicode letters (\p{L}) so Medellín / São Paulo / München resolve.
  const allIn: Array<{ phrase: string; near: boolean }> = [];
  const re =
    /\b(in|near|around)\s+((?:downtown\s+|greater\s+)?[\p{L}][\p{L} .',-]{1,50})(?=[.?!,;]|$)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    allIn.push({
      phrase: m[2],
      near: /^near|around$/i.test(m[1]),
    });
  }
  for (let i = allIn.length - 1; i >= 0; i--) {
    // Strip trailing qualifiers ("Austin without a website" → "Austin").
    // Intent verbs MUST be stripped before conjunctions like "for": otherwise
    // "in Toronto looking for photographers" becomes "Toronto looking" (the
    // "for …" clause is cut, but "looking" sticks to the place). Same for
    // seeking / asking / needing / hiring / wanting.
    let cand = allIn[i].phrase
      .trim()
      .replace(/\s+(worldwide|globally|global|anywhere)$/i, "")
      .replace(
        /\s+(?:currently\s+)?(?:looking|seeking|asking|needing|hiring|wanting|needs?|wants?)\b.*$/i,
        "",
      )
      .replace(/\s+(without|with|no|that|which|and|or|for|who|whose|to)\b.*$/i, "")
      .trim();
    if (!cand || NON_GEO_AFTER_IN.test(cand.split(/\s+/)[0])) continue;
    // Skip pure stage phrases ("pre-seed", "seed round").
    if (/^(pre-?seed|seed|series|funding|capital)(\s+(round|capital|funding))?$/i.test(cand))
      continue;
    // "in worldwide" is scope, not a place.
    if (WORLDWIDE_RE.test(cand) && cand.split(/\s+/).length <= 2) continue;
    if (cand.split(/\s+/).length > 5) continue; // sentence tail, not a place
    if (allIn[i].near && !/^near\s+/i.test(cand)) cand = `near ${cand}`;
    const geo = resolveCanonicalLocation(cand);
    if (geo && geo.resolution === "resolved") {
      return { raw: cand, value: geo.name, known: true };
    }
    const key = cand.toLowerCase().replace(/\s+/g, " ").replace(/^near\s+/, "");
    return {
      raw: cand,
      value: geo?.name ?? normGeo(cand.replace(/^near\s+/i, "")),
      known: !!GEO_ALIAS[key] || key in COUNTRY_ISO || geo?.resolution === "resolved",
    };
  }
  // Modification phrasing: "make it Toronto", "change to Austin".
  const mMod = text.match(
    /\b(?:make it|change(?: it)? to|switch to)\s+([\p{L}][\p{L} .'-]{1,40})(?=[.?!,;]|$)/iu,
  );
  if (mMod) {
    const key = mMod[1].trim().toLowerCase().replace(/\s+/g, " ");
    return { raw: mMod[1], value: normGeo(mMod[1]), known: !!GEO_ALIAS[key] || key in COUNTRY_ISO };
  }
  const m2 = text.match(/\b(NY|NYC|LA|SF)\b(?![a-z])/i);
  if (m2) return { raw: m2[1], value: normGeo(m2[1]), known: true };
  // Fallback: known place typed WITHOUT "in" ("dentists Canada",
  // "companies UK", "dentists Pune"). Longest match wins. Always known.
  // Alias table wins on collision (existing behavior preserved); country
  // names resolve through COUNTRY_ISO with title-cased display values.
  const hay = ` ${text.toLowerCase()} `;
  const known = [...Object.keys(GEO_ALIAS), ...Object.keys(COUNTRY_ISO)].sort(
    (a, b) => b.length - a.length,
  );
  for (const k of known) {
    if (k.length < 2) continue;
    if (new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay)) {
      return { raw: k, value: GEO_ALIAS[k] ?? normGeo(k), known: true };
    }
  }
  return null;
}

function extractIndustry(text: string): string | null {
  const m = text.match(
    /\b(saas|fintech|ai|artificial intelligence|healthcare|e-?commerce|real estate|plumbing|legal|insurance|cybersecurity|edtech|biotech|logistics|hospitality|construction|retail|manufacturing|finance|marketing|software|climate|climatetech|devtools|developer tools|web3|crypto)\b/i,
  );
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v === "ai" || v === "artificial intelligence") return "AI";
  if (v === "saas") return "SaaS";
  if (v === "fintech") return "Fintech";
  if (v === "healthcare") return "Healthcare";
  if (/^e-?commerce$/.test(v)) return "E-commerce";
  if (v === "climate" || v === "climatetech") return "Climate";
  if (v === "devtools" || v === "developer tools") return "DevTools";
  return v;
}

function extractSeniority(text: string): string | null {
  const m = text.match(/\b(senior|junior|lead|principal|staff|intern)\b/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Employment slot (Phase 3, optional): full-time / part-time / contract /
 * freelance / internship / remote / hybrid / onsite. Single value, first
 * match wins; never required so ready/clarify contracts hold.
 */
export function extractEmployment(text: string): string | null {
  const m = (text ?? "").match(
    /\b(full[-\s]?time|part[-\s]?time|contract|freelance|internship|remote|hybrid|on[-\s]?site)\b/i,
  );
  if (!m) return null;
  const v = m[1].toLowerCase().replace(/\s+/g, "-");
  if (v.startsWith("full")) return "full-time";
  if (v.startsWith("part")) return "part-time";
  if (v.startsWith("on")) return "onsite";
  return v;
}

/** Investor-hunt slots: stage / check-size / sector (all optional individually). */
function extractInvestorSlots(text: string): { stage?: string; check?: string } {
  const out: { stage?: string; check?: string } = {};
  const stageM = text.match(/\b(pre[-\s]?seed|series[-\s]?[abcd]|seed)\b/i);
  if (stageM) {
    const v = stageM[1].toLowerCase().replace(/\s+/g, "-");
    out.stage = v === "seed" ? "seed" : v.replace("preseed", "pre-seed");
    // Plain "seed" (not a series) implies seed-sized checks.
    if (out.stage === "seed") out.check = "seed";
  }
  if (/\bangel\b/i.test(text)) out.check = "angel";
  else if (/\bgrowth|series[-\s]?[bc]\b/i.test(text)) out.check = "growth";
  return out;
}

export function extractSearchSpec(
  rawQuery: string,
  opts?: { statedLocation?: string | null; statedSector?: string | null },
): SearchSpec {
  const text = (rawQuery || "").trim();
  const criteria: SpecField[] = [];
  const need = extractNeedPhrase(text);

  // 1. Entity — person nouns win over seller-default; bare business nouns win
  //    over buying-signal default (R1/R2/R3). Company/business nouns outrank
  //    bare professional nouns ("developers" in "companies looking for
  //    website developers" is the hire, not the target).
  const hasCompanyNoun = BUSINESS_NOUNS.test(text);
  const hasJobNoun = JOB_NOUNS.test(text);
  const hasOrgNoun = ORG_NOUNS.test(text);
  const hasPersonTitle =
    PERSON_NOUNS.test(text) &&
    /\b(founders?|co-?founders?|ceo|ceos|cto|ctos|owners?|managers?|directors?|recruiters?|principals?|partners?)\b/i.test(
      text,
    );
  // "founder organizations" — title is an adjective on an org, not a person hunt.
  const titleAsOrgAdjective =
    hasPersonTitle &&
    hasOrgNoun &&
    /\b(founders?|co-?founders?|ceo|ceos|cto|ctos|owners?)\s+(organizations?|organisations?|orgs?|institutes?|firms?|associations?)\b/i.test(
      text,
    );
  let entity: SpecEntity = "unknown";
  if (INVESTOR_NOUNS.test(text)) entity = "investor";
  else if (titleAsOrgAdjective) {
    entity = "company";
  } else if (hasPersonTitle && (hasCompanyNoun || extractBusinessModel(text))) {
    // "B2B founders in India" / "CTOs at Series A startups" — person hunt
    // with a company-model qualifier, not a company directory trawl.
    // Exception: "founder" + "startup(s)" alone without "at/of" still person.
    entity = "person";
  } else if (hasCompanyNoun) {
    // Agency/brand/model/startup qualifiers denote companies, not local trades:
    // "D2C brands" and "B2B agencies" are company hunts even without the
    // literal word "company". Startups are companies (not local businesses).
    entity =
      /\bcompan(y|ies)\b|\bagenc(y|ies)\b|\bbrands?\b|\bstartups?\b|\bd2c\b|\bdtc\b|\bb2b\b|\bb2c\b/i.test(
        text,
      )
        ? "company"
        : "business";
  } else if (hasOrgNoun) {
    entity = "company";
  } else if (hasJobNoun && PERSON_NOUNS.test(text)) {
    // Explicit "jobs" word + professional noun ("frontend developer jobs"):
    // the user wants POSTINGS, not people with that title. Company nouns
    // still win above ("companies looking for website developers").
    entity = "job";
  } else if (hasJobNoun && TECH_RE.test(text)) {
    // "React jobs in Toronto" — technology + jobs noun → job postings.
    entity = "job";
  } else if (PERSON_NOUNS.test(text)) entity = "person";
  else if (hasJobNoun) entity = "job";

  // 2. Role (person/job) + seniority — open ontology, not a closed enum.
  const roleM = text.match(ROLE_PHRASE);
  if (
    roleM &&
    !titleAsOrgAdjective &&
    (entity === "person" || entity === "job" || entity === "unknown")
  ) {
    const role = normalizeRole(roleM[1]);
    if (entity === "unknown") entity = "person";
    criteria.push(stated("role", role));
  }
  const seniority = extractSeniority(text);
  if (
    seniority &&
    (entity === "person" ||
      entity === "job" ||
      (entity === "company" && need.requested_role))
  ) {
    criteria.push(stated("seniority", seniority));
  }
  // Employment slot (Phase 3, job hunts only): "remote senior designer jobs",
  // "part-time marketing roles". Optional — never required.
  if (entity === "job") {
    const emp = extractEmployment(text);
    if (emp) criteria.push(stated("employment", emp));
  }
  // Standalone professional nouns imply a person role hunt — and a job
  // posting hunt when the query explicitly says "jobs".
  if (
    (entity === "unknown" || entity === "person" || entity === "job") &&
    !criteria.some((c) => c.field === "role")
  ) {
    const proM = text.match(
      /\b(copywriters?|writers?|designers?|developers?|engineers?|marketers?|managers?|directors?|executives?)\b/i,
    );
    if (proM) {
      if (entity === "unknown") entity = "person";
      criteria.push(stated("role", normalizeRole(proM[1])));
    }
  }
  // Technology + job with no craft noun → role defaults to developer
  // ("React jobs"), preserving technology as its own criterion.
  const technology = extractTechnology(text);
  if (technology) {
    criteria.push(stated("technology", technology));
    if (entity === "job" && !criteria.some((c) => c.field === "role")) {
      criteria.push(stated("role", "developer"));
    }
  }

  // Salary threshold (jobs): stated → salary_min criterion; queryRequiredFields
  // then requires salary only when Spec/query demands it.
  if (entity === "job") {
    const sal = extractSalaryMin(text);
    if (sal != null) criteria.push(stated("salary_min", String(sal)));
  }

  // 3. Industry/sector + business category.
  // Phase 1A: never bind a help/need noun as entity_industry (D failure).
  const indMatch = text.match(
    /\b(saas|fintech|ai|artificial intelligence|healthcare|e-?commerce|real estate|plumbing|legal|insurance|cybersecurity|edtech|biotech|logistics|hospitality|construction|retail|manufacturing|finance|marketing|software|climate|climatetech|devtools|developer tools|web3|crypto)\b/i,
  );
  let ind: string | null = null;
  if (indMatch && indMatch.index != null && !indexInNeedSpan(indMatch.index, need.needSpans)) {
    ind = extractIndustry(text);
  } else if (opts?.statedSector?.trim()) {
    ind = opts.statedSector.trim();
  }
  if (ind && indMatch?.index != null && indexInNeedSpan(indMatch.index, need.needSpans)) {
    ind = null;
  }
  if (ind) {
    criteria.push(
      stated(
        entity === "business" ? "category" : entity === "investor" ? "investor_sector" : "industry",
        ind,
      ),
    );
  } else if (entity === "business") {
    const catM = text.match(
      /\b((?:[a-z][a-z'-]*\s+)?(plumbers?|plumbing|dentists?|dental|electricians?|roofers?|roofing|salons?|gyms?|cafes?|bakeries?|bakery|locksmiths?|landscapers?|hvac|barbers?|hotels?|spas?|mechanics?|lawyers?|attorneys?|florists?|restaurants?|contractors?|clinics?|shops?|stores?|real[ -]?estate|realestate|realtors?|realty|coffee\s+roasters?|roasters?|yoga(\s+studios?)?|boutiques?|pharmacies?|pharmacy|veterinar(?:y|ies|ians?)|chiropractors?|optometrists?|accountants?|photographers?|caterers?|cleaners?|movers?|painters?|installers?|solar|forwarders?|freight|logistics|couriers?|hauliers?|truckers?|carriers?|shippers?|transport(?:ation|ers?)|brokers?|builders?|construction|renovators?|gardeners?|surveyors?|inspectors?|appraisers?|restorers?|repairers?|technicians?|tailors?|printers?|suppliers?|manufacturers?|distributors?|wholesalers?|importers?|exporters?|dealers?|butchers?|bakers?|videographers?|exterminators?|opticians?|hospitals?))\b/i,
    );
    if (catM) {
      // Keep the intent qualifier ("wedding photographers", "solar
      // installers"); drop filler/evaluative words and bare connectors.
      const qualifier = (catM[1].split(/\s+/).length > 1 ? catM[1].split(/\s+/)[0] : "").toLowerCase();
      const keep = qualifier && !/^(best|top|cheap|local|good|great|affordable|reliable|licensed|certified|professional|expert|trusted|find|hiring|in|with|and|or|the|a|an|for|of|to|near|me|my|our|your|us|we|here|this|that|these|those|some|any|all|need|needs|want|looking|seeking)$/i.test(qualifier);
      const c = (keep ? catM[1] : catM[2] || catM[1]).toLowerCase().replace(/\s+/g, " ");
      criteria.push(stated("category", c));
    }
  }

  // 3a. Entity taxonomy (Phase 2, optional): agency/brand/D2C/B2B/B2C.
  // Stored as `business_model` for company/business hunts; never required,
  // so bare-entity and ready contracts are unchanged. Person hunts may still
  // carry a model qualifier ("B2B founders") without flipping entity.
  if (entity === "company" || entity === "business" || entity === "person") {
    const bm = extractBusinessModel(text);
    if (bm && (entity === "company" || entity === "business")) {
      criteria.push(stated("business_model", bm));
    }
  }

  // 4. Location (explicit only — never inferred in Phase 1).
  // Known words (exact/alias/hierarchy) are stated with canonical GeoEntity
  // fields. Unknown words close to a known place (Daaka→Dhaka) become a
  // did-you-mean suggestion, never a search. Unknown words with no close
  // match are stated as provisional geo entities — the DB is the judge of
  // coverage, not the parser.
  // Worldwide / global is geo_scope, not a location ask.
  if (WORLDWIDE_RE.test(text)) {
    criteria.push(stated("geo_scope", "worldwide"));
  }
  const geoHit = extractGeo(text);
  const statedLoc = opts?.statedLocation?.trim() ?? null;
  let locationSuggestion: LocationSuggestion | null = null;
  const attachGeo = (geo: GeoEntity) => {
    criteria.push(stated("location", geo.name));
    criteria.push(stated("location_id", geo.id));
    criteria.push(stated("location_kind", geo.kind));
    if (geo.country_code) criteria.push(stated("location_country", geo.country_code));
    if (geo.scope) criteria.push(stated("location_scope", geo.scope));
    if (geo.parent_ids.length) {
      criteria.push(stated("location_parents", geo.parent_ids.join(",")));
    }
  };
  if (statedLoc) {
    const geo = resolveCanonicalLocation(statedLoc);
    if (geo) attachGeo(geo);
    else criteria.push(stated("location", statedLoc));
  } else if (geoHit) {
    const geo = resolveCanonicalLocation(geoHit.raw);
    if (geo && geo.resolution === "resolved") {
      attachGeo(geo);
    } else if (geoHit.known && geo) {
      attachGeo(geo);
    } else {
      const r = resolveLocationToken(geoHit.raw);
      if (r.kind === "fuzzy" && r.canonical) {
        locationSuggestion = {
          typed: geoHit.raw.trim(),
          suggestion: r.canonical,
          confidence: r.confidence,
        };
      } else if (geo) {
        attachGeo(geo);
      } else {
        criteria.push(stated("location", geoHit.value));
      }
    }
  } else {
    locationSuggestion = suggestLocation(text) ?? null;
  }

  // 4a. Opportunity + requested need (Phase 1A need-phrase grammar).
  if (need.opportunity) {
    criteria.push(stated("opportunity", need.opportunity));
  } else if (
    /\b(without\s+(a\s+|any\s+)?websites?|no\s+websites?|no\s+web\s+presence)\b/i.test(text)
  ) {
    criteria.push(stated("opportunity", "no_website"));
  }
  if (need.requested_service) criteria.push(stated("requested_service", need.requested_service));
  if (need.requested_role) criteria.push(stated("requested_role", need.requested_role));
  if (need.requested_product) criteria.push(stated("requested_product", need.requested_product));

  // 4a2. Funding / startup event query (E): company + funding signal, not unknown.
  const funding = extractFundingSignal(text);
  if (funding.isFunding || (funding.isStartup && /\bfunded|funding|raised\b/i.test(text))) {
    if (entity === "unknown" || entity === "business") entity = "company";
    criteria.push(stated("funding_status", "recent"));
    if (funding.isStartup && !criteria.some((c) => c.field === "company_stage")) {
      // optional tag — not identity industry
      criteria.push(stated("company_stage", "startup"));
    }
    need.isSignal = true;
    if (!need.signalTypes.includes("funding")) need.signalTypes.push("funding");
  } else if (funding.isStartup && entity === "unknown") {
    entity = "company";
    criteria.push(stated("company_stage", "startup"));
  }

  // 4a3. Temporal semantics — explicit window for M9 event_at checks.
  const temporal = extractTemporal(text);
  if (temporal.relation) {
    criteria.push(stated("temporal_relation", temporal.relation));
  }
  if (temporal.year) {
    criteria.push(stated("temporal_year", temporal.year));
  }
  // "recently funded" without other window still stamps recency for funding.
  let signal_recency = temporal.signal_recency;
  if (!signal_recency && funding.isFunding && /\brecently\b/i.test(text)) {
    signal_recency = "90d";
  }

  // 4b. Investor slots (stage/check/sector) — each optional, asked iff missing.
  if (entity === "investor") {
    const islots = extractInvestorSlots(text);
    if (islots.stage) criteria.push(stated("investor_stage", islots.stage));
    if (islots.check) criteria.push(stated("investor_check", islots.check));
  }

  // 5. Signal requirement from need-phrase grammar (not bare "need companies").
  // Funding / hiring / social asks all require claim evidence downstream.
  const signal_required =
    need.isSignal &&
    (entity === "company" ||
      entity === "business" ||
      entity === "person" ||
      (entity === "job" && need.signalTypes.includes("hiring")));

  const signal_types = signal_required
    ? [
        ...new Set(
          need.signalTypes.length
            ? need.signalTypes
            : ["service_request", "buying_intent"],
        ),
      ]
    : [];

  const spec = buildSpec({
    entity,
    criteria,
    signal_required,
    signal_types,
    signal_recency,
    raw_query: text,
    locationSuggestion,
  });
  void opts;
  return spec;
}

export type { SearchSpec };
export type { SpecField };
