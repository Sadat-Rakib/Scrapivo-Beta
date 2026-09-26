/**
 * Location resolver (M6): wording → canonical geographic entity + hierarchy.
 *
 * Policy:
 * - Exact/alias hits resolve immediately.
 * - Fuzzy hits stay suggestions (never silent search) — unchanged from Step 2.1.
 * - Metros / admin regions / neighborhoods are a SMALL structural overlay, not
 *   a giant city dictionary. Unknown places become provisional stated entities;
 *   M7 gazetteer feeds can deepen them later without changing this contract.
 * - Qualification uses locationSatisfies: candidate must equal Spec location
 *   OR sit inside it (Downtown Toronto ∈ Toronto ∈ GTA). Sibling cities fail
 *   (Dallas ⊭ Austin). Broader candidates fail Spec that asked narrower.
 */
import type { LocationSuggestion } from "./search-spec";

/** Geographic grain — hierarchy for containment checks. */
export type GeoKind =
  | "neighborhood"
  | "city"
  | "metro"
  | "admin"
  | "country"
  | "stated";

export type GeoResolution = "resolved" | "provisional";

/** Canonical location entity consumed by Spec + theorem. */
export interface GeoEntity {
  /** Stable id, e.g. geo:city:toronto · geo:metro:gta · geo:stated:lyon */
  id: string;
  /** Display name. */
  name: string;
  kind: GeoKind;
  /** ISO2 when known. */
  country_code: string | null;
  /** Ancestor ids rootward (parent first). */
  parent_ids: string[];
  /** Direct member city ids for metros/admins (optional). */
  member_ids: string[];
  aliases: string[];
  confidence: number;
  resolution: GeoResolution;
  /** How the user phrased scope: near / downtown / greater / exact. */
  scope: "exact" | "near" | "downtown" | "greater" | null;
}

/**
 * Alias table: user wording (lowercase) → canonical display name.
 * Cities + countries only — metros/neighborhoods live in the hierarchy overlay.
 */
export const GEO_ALIAS: Record<string, string> = {
  ny: "New York",
  nyc: "New York",
  "new york city": "New York",
  "new york": "New York",
  la: "Los Angeles",
  "los angeles": "Los Angeles",
  sf: "San Francisco",
  "san francisco": "San Francisco",
  toronto: "Toronto",
  vancouver: "Vancouver",
  montreal: "Montreal",
  calgary: "Calgary",
  austin: "Austin",
  dallas: "Dallas",
  london: "London",
  berlin: "Berlin",
  paris: "Paris",
  madrid: "Madrid",
  rome: "Rome",
  chicago: "Chicago",
  boston: "Boston",
  seattle: "Seattle",
  melbourne: "Melbourne",
  tokyo: "Tokyo",
  sydney: "Sydney",
  dubai: "Dubai",
  singapore: "Singapore",
  dhaka: "Dhaka",
  dacca: "Dhaka",
  chattogram: "Chattogram",
  chittagong: "Chattogram",
  usa: "USA",
  "united states": "USA",
  "united states of america": "USA",
  america: "USA",
  uk: "UK",
  "united kingdom": "UK",
  britain: "UK",
  england: "UK",
  canada: "Canada",
  india: "India",
  france: "France",
  germany: "Germany",
  japan: "Japan",
  australia: "Australia",
  uae: "UAE",
  "united arab emirates": "UAE",
  bangladesh: "Bangladesh",
  spain: "Spain",
  italy: "Italy",
  netherlands: "Netherlands",
  ireland: "Ireland",
  sweden: "Sweden",
  pune: "Pune",
  mumbai: "Mumbai",
  bombay: "Mumbai",
  delhi: "Delhi",
  "new delhi": "Delhi",
  bangalore: "Bangalore",
  bengaluru: "Bangalore",
  hyderabad: "Hyderabad",
  chennai: "Chennai",
  kolkata: "Kolkata",
  calcutta: "Kolkata",
  oakland: "Oakland",
  "san jose": "San Jose",
  mississauga: "Mississauga",
  brampton: "Brampton",
  markham: "Markham",
  vaughan: "Vaughan",
};

/** Minimum similarity for a suggestion; below this there is no guess. */
export const FUZZY_FLOOR = 0.68;
/** Minimum normalized token length: 3 keeps real short places (Rio, Goa)
 *  suggestable while 1-2 letter noise stays out (aliases bypass this). */
const MIN_TOKEN = 3;

/**
 * City display/lower name → ISO2 country. Single owner of city→country
 * knowledge: the S3 reader (scan gate), the validator (row gate), and the
 * index layer all read this. Unknown cities return null (reader-gated).
 */
const CITY_COUNTRY_HINT: Record<string, string> = {
  pune: "IN",
  mumbai: "IN",
  delhi: "IN",
  bangalore: "IN",
  hyderabad: "IN",
  chennai: "IN",
  kolkata: "IN",
  dhaka: "BD",
  chattogram: "BD",
  austin: "US",
  dallas: "US",
  "new york": "US",
  "los angeles": "US",
  chicago: "US",
  boston: "US",
  seattle: "US",
  "san francisco": "US",
  oakland: "US",
  "san jose": "US",
  london: "GB",
  toronto: "CA",
  mississauga: "CA",
  brampton: "CA",
  markham: "CA",
  vaughan: "CA",
  berlin: "DE",
  paris: "FR",
  madrid: "ES",
  rome: "IT",
  tokyo: "JP",
  sydney: "AU",
  dubai: "AE",
  singapore: "SG",
  melbourne: "AU",
  vancouver: "CA",
  montreal: "CA",
  calgary: "CA",
};

const COUNTRY_NAME_ISO: Record<string, string> = {
  usa: "US",
  uk: "GB",
  canada: "CA",
  india: "IN",
  france: "FR",
  germany: "DE",
  japan: "JP",
  australia: "AU",
  uae: "AE",
  bangladesh: "BD",
  spain: "ES",
  italy: "IT",
  netherlands: "NL",
  ireland: "IE",
  sweden: "SE",
};

/**
 * Canonical location name → ISO2 stems used by the parquet partitions.
 * Lives here so Austria cannot fuzzy-match Australia before an exact country hit.
 */
export const COUNTRY_ISO: Record<string, string[]> = {
  canada: ["ca"],
  usa: ["us"],
  "united states": ["us"],
  "united states of america": ["us"],
  america: ["us"],
  uk: ["gb", "uk"],
  "united kingdom": ["gb", "uk"],
  britain: ["gb", "uk"],
  england: ["gb", "uk"],
  india: ["in"],
  france: ["fr"],
  germany: ["de"],
  japan: ["jp"],
  australia: ["au"],
  uae: ["ae"],
  "united arab emirates": ["ae"],
  bangladesh: ["bd"],
  spain: ["es"],
  italy: ["it"],
  netherlands: ["nl"],
  singapore: ["sg"],
  ireland: ["ie"],
  sweden: ["se"],
  mexico: ["mx"],
  brazil: ["br"],
  pakistan: ["pk"],
  nigeria: ["ng"],
  "south africa": ["za"],
  kenya: ["ke"],
  philippines: ["ph"],
  indonesia: ["id"],
  thailand: ["th"],
  vietnam: ["vn"],
  malaysia: ["my"],
  "new zealand": ["nz"],
  norway: ["no"],
  denmark: ["dk"],
  finland: ["fi"],
  belgium: ["be"],
  switzerland: ["ch"],
  austria: ["at"],
  poland: ["pl"],
  portugal: ["pt"],
  greece: ["gr"],
  turkey: ["tr"],
  "saudi arabia": ["sa"],
  qatar: ["qa"],
  egypt: ["eg"],
  armenia: ["am"],
  argentina: ["ar"],
  azerbaijan: ["az"],
  bulgaria: ["bg"],
  bahrain: ["bh"],
  bolivia: ["bo"],
  chile: ["cl"],
  colombia: ["co"],
  "costa rica": ["cr"],
  cyprus: ["cy"],
  czechia: ["cz"],
  "czech republic": ["cz"],
  "dominican republic": ["do"],
  ecuador: ["ec"],
  estonia: ["ee"],
  ghana: ["gh"],
  guatemala: ["gt"],
  "hong kong": ["hk"],
  croatia: ["hr"],
  hungary: ["hu"],
  israel: ["il"],
  iceland: ["is"],
  jordan: ["jo"],
  "south korea": ["kr"],
  kuwait: ["kw"],
  kazakhstan: ["kz"],
  lebanon: ["lb"],
  "sri lanka": ["lk"],
  lithuania: ["lt"],
  luxembourg: ["lu"],
  latvia: ["lv"],
  morocco: ["ma"],
  malta: ["mt"],
  nepal: ["np"],
  oman: ["om"],
  panama: ["pa"],
  peru: ["pe"],
  "puerto rico": ["pr"],
  paraguay: ["py"],
  romania: ["ro"],
  serbia: ["rs"],
  slovenia: ["si"],
  slovakia: ["sk"],
  tunisia: ["tn"],
  taiwan: ["tw"],
  tanzania: ["tz"],
  ukraine: ["ua"],
  uruguay: ["uy"],
  uzbekistan: ["uz"],
};

function titlePlace(raw: string): string {
  return raw
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function countryIsoOf(name: string): string | null {
  const key = norm(name);
  if (COUNTRY_NAME_ISO[key]) return COUNTRY_NAME_ISO[key];
  const stems = COUNTRY_ISO[key];
  if (stems?.[0]) return stems[0].toUpperCase();
  return null;
}

export function countryHintForCity(location: string): string | null {
  const hit = CITY_COUNTRY_HINT[norm(location)];
  if (hit) return hit;
  const alias = GEO_ALIAS[norm(location)];
  if (alias) {
    const hit2 = CITY_COUNTRY_HINT[alias.toLowerCase()];
    if (hit2) return hit2;
  }
  return null;
}

/** Words that are never place candidates in the bare-word scan. */
const STOPWORDS = new Set([
  "find",
  "finds",
  "finding",
  "need",
  "needs",
  "needing",
  "want",
  "wants",
  "looking",
  "search",
  "searching",
  "seeking",
  "hire",
  "hiring",
  "near",
  "best",
  "top",
  "cheap",
  "local",
  "business",
  "businesses",
  "company",
  "companies",
  "people",
  "person",
  "founder",
  "founders",
  "investor",
  "investors",
  "job",
  "jobs",
  "role",
  "roles",
  "service",
  "services",
  "with",
  "without",
  "that",
  "this",
  "from",
  "worldwide",
  "global",
  "remote",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "and",
  "the",
  "for",
  "are",
  "you",
  "all",
  "any",
  "our",
  "get",
  "who",
  "how",
  "can",
  "may",
  "not",
  "but",
  "see",
  "use",
  "run",
  "ask",
  "she",
  "her",
  "him",
  "his",
  "has",
  "had",
  "was",
  "out",
  "downtown",
  "greater",
  "area",
]);

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

function slug(s: string): string {
  return norm(s).replace(/\s+/g, "-");
}

function cityId(name: string): string {
  return `geo:city:${slug(name)}`;
}

function countryId(iso: string): string {
  return `geo:country:${iso.toLowerCase()}`;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[lb];
}

/** 1 - normalized edit distance over spaceless strings. */
export function similarity(a: string, b: string): number {
  const na = norm(a).replace(/ /g, "");
  const nb = norm(b).replace(/ /g, "");
  const max = Math.max(na.length, nb.length);
  if (!max) return 0;
  if (Math.abs(na.length - nb.length) / max > 0.45) return 0;
  return 1 - levenshtein(na, nb) / max;
}

export type ResolvedKind = "exact" | "alias" | "fuzzy" | "unknown";

export interface ResolvedLocation {
  kind: ResolvedKind;
  /** Canonical display name when kind is exact/alias/fuzzy. */
  canonical: string | null;
  confidence: number;
}

/** Structural hierarchy overlay — metros, admins, neighborhoods. Not a city dump. */
type HierarchyDef = {
  id: string;
  name: string;
  kind: Exclude<GeoKind, "stated">;
  country_code: string | null;
  parent_ids: string[];
  member_ids: string[];
  aliases: string[];
};

const HIERARCHY: HierarchyDef[] = [
  {
    id: "geo:admin:ontario",
    name: "Ontario",
    kind: "admin",
    country_code: "CA",
    parent_ids: [countryId("CA")],
    member_ids: [
      cityId("Toronto"),
      cityId("Mississauga"),
      cityId("Brampton"),
      cityId("Markham"),
      cityId("Vaughan"),
      cityId("Ottawa"),
    ],
    aliases: ["ontario", "on canada"],
  },
  {
    id: "geo:metro:gta",
    name: "Greater Toronto Area",
    kind: "metro",
    country_code: "CA",
    parent_ids: ["geo:admin:ontario", countryId("CA")],
    member_ids: [
      cityId("Toronto"),
      cityId("Mississauga"),
      cityId("Brampton"),
      cityId("Markham"),
      cityId("Vaughan"),
    ],
    aliases: [
      "gta",
      "greater toronto",
      "greater toronto area",
      "toronto area",
      "toronto metro",
    ],
  },
  {
    id: "geo:neighborhood:downtown-toronto",
    name: "Downtown Toronto",
    kind: "neighborhood",
    country_code: "CA",
    parent_ids: [
      cityId("Toronto"),
      "geo:metro:gta",
      "geo:admin:ontario",
      countryId("CA"),
    ],
    member_ids: [],
    aliases: ["downtown toronto", "dt toronto", "toronto downtown"],
  },
  {
    id: "geo:metro:bay-area",
    name: "San Francisco Bay Area",
    kind: "metro",
    country_code: "US",
    parent_ids: [countryId("US")],
    member_ids: [cityId("San Francisco"), cityId("Oakland"), cityId("San Jose")],
    aliases: [
      "bay area",
      "sf bay area",
      "san francisco bay area",
      "the bay area",
    ],
  },
  {
    id: "geo:metro:silicon-valley",
    name: "Silicon Valley",
    kind: "metro",
    country_code: "US",
    parent_ids: ["geo:metro:bay-area", countryId("US")],
    member_ids: [cityId("San Jose"), cityId("San Francisco")],
    aliases: ["silicon valley", "the valley"],
  },
  {
    id: "geo:metro:greater-london",
    name: "Greater London",
    kind: "metro",
    country_code: "GB",
    parent_ids: [countryId("GB")],
    member_ids: [cityId("London")],
    aliases: ["greater london", "london metro", "london area"],
  },
  {
    id: "geo:neighborhood:manhattan",
    name: "Manhattan",
    kind: "neighborhood",
    country_code: "US",
    parent_ids: [cityId("New York"), countryId("US")],
    member_ids: [],
    aliases: ["manhattan", "nyc manhattan"],
  },
];

const HIERARCHY_BY_ID = new Map(HIERARCHY.map((h) => [h.id, h]));
const HIERARCHY_ALIAS = new Map<string, HierarchyDef>();
for (const h of HIERARCHY) {
  HIERARCHY_ALIAS.set(norm(h.name), h);
  for (const a of h.aliases) HIERARCHY_ALIAS.set(norm(a), h);
}

function cityEntity(name: string, scope: GeoEntity["scope"] = null): GeoEntity {
  const country = countryHintForCity(name);
  const parents: string[] = [];
  for (const h of HIERARCHY) {
    if (h.member_ids.includes(cityId(name))) {
      parents.push(h.id, ...h.parent_ids);
    }
  }
  if (country) parents.push(countryId(country));
  return {
    id: cityId(name),
    name,
    kind: "city",
    country_code: country,
    parent_ids: [...new Set(parents)],
    member_ids: [],
    aliases: Object.entries(GEO_ALIAS)
      .filter(([, v]) => v === name)
      .map(([k]) => k),
    confidence: 1,
    resolution: "resolved",
    scope,
  };
}

function hierarchyEntity(
  h: HierarchyDef,
  scope: GeoEntity["scope"] = null,
): GeoEntity {
  return {
    id: h.id,
    name: h.name,
    kind: h.kind,
    country_code: h.country_code,
    parent_ids: [...h.parent_ids],
    member_ids: [...h.member_ids],
    aliases: [...h.aliases],
    confidence: 1,
    resolution: "resolved",
    scope,
  };
}

function countryEntity(iso: string, name: string): GeoEntity {
  return {
    id: countryId(iso),
    name,
    kind: "country",
    country_code: iso,
    parent_ids: [],
    member_ids: [],
    aliases: [],
    confidence: 1,
    resolution: "resolved",
    scope: null,
  };
}

function statedEntity(raw: string, scope: GeoEntity["scope"] = null): GeoEntity {
  const name = raw.trim().replace(/\s+/g, " ");
  return {
    id: `geo:stated:${slug(name)}`,
    name,
    kind: "stated",
    country_code: null,
    parent_ids: [],
    member_ids: [],
    aliases: [norm(name)],
    confidence: 0.5,
    resolution: "provisional",
    scope,
  };
}

function parseScopePrefix(raw: string): {
  core: string;
  scope: GeoEntity["scope"];
} {
  let t = raw.trim();
  let scope: GeoEntity["scope"] = null;
  if (/^near\s+/i.test(t)) {
    scope = "near";
    t = t.replace(/^near\s+/i, "").trim();
  } else if (/^downtown\s+/i.test(t)) {
    scope = "downtown";
    t = t.replace(/^downtown\s+/i, "").trim();
  } else if (/^greater\s+/i.test(t)) {
    scope = "greater";
  }
  return { core: t, scope };
}

/**
 * Resolve free-text location intent into a GeoEntity.
 * Prefer hierarchy → alias city → country → provisional stated.
 */
export function resolveCanonicalLocation(raw: string): GeoEntity | null {
  const input = (raw ?? "").trim();
  if (!input) return null;

  const { core, scope } = parseScopePrefix(input);
  const parts = core.split(",").map((p) => p.trim()).filter(Boolean);
  const primary = parts[0] ?? core;
  const qualifier = parts[1] ?? null;

  if (scope === "downtown" || /^downtown\s+/i.test(input)) {
    const cityName = primary.replace(/^downtown\s+/i, "").trim();
    const neighKey = norm(`downtown ${cityName}`);
    const neigh = HIERARCHY_ALIAS.get(neighKey);
    if (neigh) return hierarchyEntity(neigh, "downtown");
    const cityTok = resolveLocationToken(cityName);
    if (cityTok.canonical) return cityEntity(cityTok.canonical, "downtown");
  }

  const hier =
    HIERARCHY_ALIAS.get(norm(core)) ??
    HIERARCHY_ALIAS.get(norm(primary)) ??
    HIERARCHY_ALIAS.get(norm(input));
  if (hier) {
    let ent = hierarchyEntity(hier, scope === "near" ? "near" : scope);
    if (qualifier) {
      const qIso =
        COUNTRY_NAME_ISO[norm(qualifier)] ??
        (GEO_ALIAS[norm(qualifier)]
          ? COUNTRY_NAME_ISO[norm(GEO_ALIAS[norm(qualifier)])]
          : null);
      if (!(qIso && ent.country_code && ent.country_code !== qIso) && qIso) {
        ent = { ...ent, country_code: qIso };
      }
    }
    return ent;
  }

  // Exact country name BEFORE fuzzy — Austria must not become Australia.
  const countryIso = countryIsoOf(primary);
  if (countryIso && !GEO_ALIAS[norm(primary)]) {
    // Prefer GEO_ALIAS display when the country is also an alias (USA/UK).
    return countryEntity(
      countryIso,
      GEO_ALIAS[norm(primary)] ?? titlePlace(primary),
    );
  }
  // Countries that are also GEO_ALIAS entries (USA, UK, Canada, …)
  if (countryIso && GEO_ALIAS[norm(primary)]) {
    const display = GEO_ALIAS[norm(primary)];
    if (
      display === "USA" ||
      display === "UK" ||
      COUNTRY_NAME_ISO[norm(display)] ||
      COUNTRY_ISO[norm(display)]
    ) {
      return countryEntity(countryIso, display);
    }
  }

  const tok = resolveLocationToken(primary);
  if (tok.kind === "exact" || tok.kind === "alias") {
    if (!tok.canonical) return null;
    const iso =
      COUNTRY_NAME_ISO[norm(tok.canonical)] ?? COUNTRY_NAME_ISO[norm(primary)];
    if (
      iso &&
      (tok.canonical === "USA" ||
        tok.canonical === "UK" ||
        COUNTRY_NAME_ISO[norm(primary)])
    ) {
      return countryEntity(iso, tok.canonical);
    }
    let ent = cityEntity(tok.canonical, scope);
    if (qualifier) {
      const qIso =
        COUNTRY_NAME_ISO[norm(qualifier)] ??
        (GEO_ALIAS[norm(qualifier)]
          ? COUNTRY_NAME_ISO[norm(GEO_ALIAS[norm(qualifier)])]
          : null);
      const qHier = HIERARCHY_ALIAS.get(norm(qualifier));
      if (qIso) {
        if (ent.country_code && ent.country_code !== qIso) {
          return statedEntity(core, scope);
        }
        ent = {
          ...ent,
          country_code: qIso,
          parent_ids: [...new Set([...ent.parent_ids, countryId(qIso)])],
        };
      } else if (qHier) {
        ent = {
          ...ent,
          parent_ids: [
            ...new Set([qHier.id, ...qHier.parent_ids, ...ent.parent_ids]),
          ],
          country_code: ent.country_code ?? qHier.country_code,
        };
      }
    }
    return ent;
  }

  if (tok.kind === "fuzzy" && tok.canonical) {
    return {
      ...cityEntity(tok.canonical, scope),
      confidence: tok.confidence,
      resolution: "provisional",
    };
  }

  const asCountry = COUNTRY_NAME_ISO[norm(primary)];
  if (asCountry) {
    const display = GEO_ALIAS[norm(primary)] ?? primary;
    return countryEntity(asCountry, display);
  }

  return statedEntity(core, scope);
}

/**
 * Does candidate geography satisfy a Spec-required location?
 *
 * Pass when equal, or candidate is nested inside required (more specific OK).
 * Fail when sibling / unrelated / candidate is strictly broader than Spec.
 */
export function locationSatisfies(
  candidateRaw: string | null | undefined,
  required: GeoEntity | string | null | undefined,
): boolean {
  if (!required) return true;
  const candRaw = (candidateRaw ?? "").trim();
  if (!candRaw) return false;

  const req =
    typeof required === "string" ? resolveCanonicalLocation(required) : required;
  if (!req) return false;

  const cand = resolveCanonicalLocation(candRaw);
  if (!cand) return false;

  if (
    req.country_code &&
    cand.country_code &&
    req.country_code !== cand.country_code
  ) {
    return false;
  }

  if (cand.id === req.id) return true;
  if (cand.parent_ids.includes(req.id)) return true;
  if (req.member_ids.includes(cand.id)) return true;

  if (
    cand.kind !== "stated" &&
    req.kind !== "stated" &&
    norm(cand.name) === norm(req.name)
  ) {
    return true;
  }

  if (cand.resolution === "provisional" || req.resolution === "provisional") {
    const a = norm(cand.name);
    const b = norm(req.name);
    if (a === b) return true;
    // Coarse company geography is comma-delimited. An exact whole segment is
    // valid ("Dallas/Fort Worth Metroplex, Southern US"), but substring
    // containment is not (the same value must not satisfy plain "Dallas").
    const candSegments = candRaw.split(",").map(norm).filter(Boolean);
    const reqSegments = (typeof required === "string" ? required : req.name)
      .split(",").map(norm).filter(Boolean);
    if (reqSegments.length && reqSegments.every((s) => candSegments.includes(s))) return true;
    if ((a.includes(b) || b.includes(a)) && (cand.scope === "near" || req.scope === "near")) {
      return true;
    }
    return false;
  }

  if (req.kind === "country" && cand.country_code === req.country_code) return true;

  if (req.scope === "near") {
    if (cand.parent_ids.some((p) => req.parent_ids.includes(p))) return true;
    if (req.kind === "city" && cand.parent_ids.includes(req.id)) return true;
    for (const h of HIERARCHY) {
      if (
        h.kind === "metro" &&
        h.member_ids.includes(req.id) &&
        h.member_ids.includes(cand.id)
      ) {
        return true;
      }
    }
  }

  return false;
}

/** Lookup hierarchy entity by id (tests / enrichment). */
export function geoById(id: string): GeoEntity | null {
  const h = HIERARCHY_BY_ID.get(id);
  if (h) return hierarchyEntity(h);
  if (id.startsWith("geo:city:")) {
    const aliasHit = Object.values(GEO_ALIAS).find((v) => cityId(v) === id);
    if (aliasHit) return cityEntity(aliasHit);
    const name = id
      .slice("geo:city:".length)
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return cityEntity(name);
  }
  if (id.startsWith("geo:country:")) {
    const iso = id.slice("geo:country:".length).toUpperCase();
    const name =
      Object.entries(COUNTRY_NAME_ISO).find(([, v]) => v === iso)?.[0] ?? iso;
    return countryEntity(iso, GEO_ALIAS[name] ?? name.toUpperCase());
  }
  return null;
}

/** Resolve one token against alias keys + canonical names. */
export function resolveLocationToken(token: string): ResolvedLocation {
  const t = norm(token);
  if (t.length < MIN_TOKEN && !GEO_ALIAS[t] && !COUNTRY_ISO[t]) {
    return { kind: "unknown", canonical: null, confidence: 0 };
  }
  const hier = HIERARCHY_ALIAS.get(t);
  if (hier) {
    return { kind: "exact", canonical: hier.name, confidence: 1 };
  }
  if (GEO_ALIAS[t]) {
    const canon = GEO_ALIAS[t];
    return {
      kind: canon.toLowerCase() === t ? "exact" : "alias",
      canonical: canon,
      confidence: 1,
    };
  }
  // Exact country names beat fuzzy (Austria ≠ Australia).
  if (COUNTRY_ISO[t]) {
    return { kind: "exact", canonical: titlePlace(t), confidence: 1 };
  }
  let best: { canon: string; sim: number } | null = null;
  const consider = (key: string, canon: string) => {
    const sim = similarity(t, key);
    if (sim >= FUZZY_FLOOR && (!best || sim > best.sim)) best = { canon, sim };
  };
  for (const key of Object.keys(GEO_ALIAS)) {
    if (key.length < MIN_TOKEN) continue;
    consider(key, GEO_ALIAS[key]);
  }
  const seen = new Set<string>();
  for (const canon of Object.values(GEO_ALIAS)) {
    const low = canon.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    if (low.length < MIN_TOKEN) continue;
    consider(low, canon);
  }
  for (const h of HIERARCHY) {
    consider(norm(h.name), h.name);
    for (const a of h.aliases) consider(a, h.name);
  }
  if (!best) return { kind: "unknown", canonical: null, confidence: 0 };
  const found: { canon: string; sim: number } = best;
  return { kind: "fuzzy", canonical: found.canon, confidence: found.sim };
}

const IN_PHRASE = /\bin\s+([A-Za-z][A-Za-z .'-]{1,40})(?=[.?!,;]|$)/g;

/**
 * Best fuzzy suggestion for the query, or null. Skips anything extractGeo
 * would already resolve exactly (aliases included) — this only fires for
 * misspellings and unknown phrasings.
 */
export function suggestLocation(text: string): LocationSuggestion | null {
  const cands: string[] = [];
  IN_PHRASE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IN_PHRASE.exec(text)) !== null) cands.push(m[1]);
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    if (w.length >= MIN_TOKEN && !STOPWORDS.has(w)) cands.push(w);
  }
  let best: LocationSuggestion | null = null;
  const tried = new Set<string>();
  for (const c of cands) {
    const t = norm(c);
    if (!t || tried.has(t)) continue;
    tried.add(t);
    if (GEO_ALIAS[t] || HIERARCHY_ALIAS.has(t)) continue;
    const r = resolveLocationToken(t);
    if (r.kind === "fuzzy" && r.canonical) {
      const s: LocationSuggestion = {
        typed: c.trim(),
        suggestion: r.canonical,
        confidence: r.confidence,
      };
      if (!best || s.confidence > best.confidence) best = s;
    }
  }
  return best;
}
