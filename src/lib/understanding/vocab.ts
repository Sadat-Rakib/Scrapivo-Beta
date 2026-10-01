/**
 * Understanding Engine — vocabularies.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 *
 *   Closed enums describe the GRAMMAR of a request (what kind of relationship,
 *   which direction, which scope). Open strings describe the WORLD (roles,
 *   industries, categories, services, products, technologies, niches, job
 *   titles, business types).
 *
 * A value outside a closed enum is meaningless — "direction: sideways" is not a
 * request we half-understand, it is nonsense. A value outside an open list is
 * merely unfamiliar: "actuarial consultant", "medical spa", "firmware engineer
 * for cobot arms". Those must work on the day they are first typed, without a
 * commit to this file. So nothing here is ever a membership requirement for an
 * open descriptor — the alias tables below only *add* a canonical form when one
 * happens to be known, and leave the user's own wording intact otherwise.
 *
 * Every closed enum that could plausibly meet an unanticipated real request
 * carries an escape hatch, and the two escapes mean different things:
 *
 *   "unknown" — we could not work out what was meant. Low confidence, probably
 *               a clarification.
 *   "custom"  — we understood it perfectly well, it simply is not one of our
 *   /"other"    standard members. Carries an open label. Full confidence.
 *
 * Collapsing those two would make "companies using Shopify" indistinguishable
 * from a parse failure.
 */

// ── Structural enums (closed) ──────────────────────────────────────────────

/**
 * What the user is trying to DO. `lead_discovery` is the overwhelming default
 * and the reason this product exists: find prospect entities, then qualify
 * them. The old members (`find_entities`, `find_signals`) described a generic
 * search engine and said nothing about prospecting, which let a frame look
 * complete while carrying no idea what kind of lead list was wanted.
 */
export const TASK_TYPES = [
  "lead_discovery",
  "job_discovery",
  "enrich",
  "outreach",
  "other",
  "unknown",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * WHICH KIND of prospecting request this is. Required on every valid frame,
 * because it is the difference between four searches that share a target:
 *
 *   fit_based           "coffee roasters within 15 km of Copenhagen"
 *                       — they match a profile. No relationship asserted.
 *   opportunity_based   "coffee shops without websites"
 *                       — an observable GAP we can sell into.
 *   intent_based        "companies looking for marketing help"
 *                       — they have EXPRESSED a want.
 *   hiring_based        "companies hiring React developers"
 *   job_based           "remote Rust job postings"      (the job is the target)
 *   event_based         "recently funded AI startups"
 *   social_signal_based "founders posting about churn on LinkedIn"
 *   investment_based    "investors funding climate startups"
 *                       — find the BACKER by what it backs.
 *   funding_based       "startups seeking investors"
 *                       — find the COMPANY by the capital it wants.
 *
 * fit_based is the honest answer for plain entity discovery. Inventing an
 * intent relationship to make a request look "lead-like" is the mistake this
 * enum exists to make unnecessary: what the user SELLS is not evidence of what
 * a prospect NEEDS.
 *
 * The two capital modes exist because the mode is what will pick the SOURCES,
 * and both of these read wrong under the generic modes. "investors funding
 * climate startups" as `fit_based` says "look up investors and filter them",
 * when the request is to find them THROUGH their portfolio — a different
 * corpus entirely. "startups seeking investors" as `intent_based` puts it
 * beside "companies wanting marketing help", but nobody answers that one from
 * a pitch platform or an accelerator cohort. Four requests about money, four
 * distinct searches: `investment_based` (who backs this), `funding_based` (who
 * wants backing), `event_based` (who just raised), `fit_based` (investors, as
 * a kind of organization, with no capital relation stated at all).
 */
export const PROSPECTING_MODES = [
  "fit_based",
  "opportunity_based",
  "intent_based",
  "hiring_based",
  "job_based",
  "event_based",
  "social_signal_based",
  "investment_based",
  "funding_based",
  "custom",
  "unknown",
] as const;
export type ProspectingMode = (typeof PROSPECTING_MODES)[number];

/**
 * Broad shape of the thing being looked for. `organization` is the deliberate
 * catch-all for schools, nonprofits, clinics, agencies, municipalities, clubs —
 * anything institutional that is not a commercial company — and `other` covers
 * the rest. Both carry an open `entity_subtype`, so nothing is ever forced into
 * "company" just to be representable.
 *
 * **`business` and `company` are NOT distinguished by this layer.** Every reader
 * treats them as one class (`fallback.ts`'s head classification, the validator,
 * the lexicon's `HeadKind`), and no rule anywhere says which of the two a café,
 * a law firm or a startup is. So a frame saying `business` where a reader
 * expected `company` is not a defect, and a test pinning one of them exactly
 * asserts a distinction nothing defines — which is what failed an otherwise
 * perfect reading of "haulage startups in Vilnius raising money".
 *
 * If retrieval ever needs the split — a local commercial premises is findable on
 * a map, a software company is not — it has to be DEFINED here and taught to
 * both extractors first. Do not infer it from whichever value happens to arrive.
 */
export const ENTITY_TYPES = [
  "business",
  "company",
  "person",
  "job",
  "investor",
  "organization",
  "product",
  "content",
  "other",
  "unknown",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Entity types that require an open `entity_subtype` to be meaningful. */
export const ENTITY_TYPES_NEEDING_SUBTYPE: readonly EntityType[] = ["other", "organization"];

/**
 * The relationship between SUBJECT and OBJECT. This is the axis the old layer
 * had no representation for at all, which is why "marketing companies" and
 * "companies needing marketing" collapsed into one query.
 *
 * `custom` + `relation.label` is how an unanticipated relationship stays
 * expressible: "companies using Shopify" (uses_technology exists), but also
 * "businesses partnered with Stripe", "founders attending Web Summit",
 * "clinics accredited by X" — the last two would otherwise have nowhere to go.
 */
export const RELATION_TYPES = [
  "hiring",
  "seeking_job",
  "needs_service",
  "offers_service",
  "seeking_client",
  "asking_for_help",
  "lacks_asset",
  "has_asset",
  "uses_technology",
  "partnered_with",
  "attending_event",
  "received_funding",
  "seeking_funding",
  "investing_in",
  "custom",
  "none",
  "unknown",
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** Relations whose meaning is carried by an open label rather than the member. */
export const RELATION_TYPES_NEEDING_LABEL: readonly RelationType[] = ["custom"];

/**
 * `none` is the answer for plain entity discovery and it is NOT a degraded
 * `unknown`. "restaurants in Lisbon" requested no relationship; asking "what
 * should be true of the restaurants?" is the layer failing to understand a
 * perfectly clear request. The three escapes read:
 *
 *   none    — no relationship predicate was intended. Full confidence.
 *   unknown — wording indicates a relationship we could not determine.
 *   custom  — relationship understood, outside the canonical set. Needs label.
 */
export const RELATION_ESCAPES: readonly RelationType[] = ["none", "unknown", "custom"];

/**
 * Relations that mean nothing without something to act on.
 *
 * The set is smaller than it looks like it should be, and the exclusions are
 * the point. "agencies that are hiring" is a complete, useful request — the
 * user wants employers with an open role, any role. So is "startups that
 * raised" and "designers looking for clients". Demanding an object there
 * rejects correct frames. `needs_service` is the opposite: "companies that
 * need" is not a request until you know what they need.
 */
export const RELATIONS_REQUIRING_OBJECT: readonly RelationType[] = [
  "needs_service",
  /** Same shape as `needs_service`: help with WHAT is the whole request. */
  "asking_for_help",
  "offers_service",
  "lacks_asset",
  "has_asset",
  "uses_technology",
  "partnered_with",
  "attending_event",
  "custom",
];

/**
 * Which prospecting mode a relation implies. Once the relation is known the
 * mode is not a second guess, and a frame carrying `hiring` with mode
 * `fit_based` describes two different searches at once.
 *
 * `none` is deliberately absent rather than mapped to `fit_based`: plain
 * discovery can also be `job_based` ("remote Rust postings" — the job IS the
 * target), so that default needs the entity type in hand.
 */
export const MODE_BY_RELATION: Partial<Record<RelationType, ProspectingMode>> = {
  hiring: "hiring_based",
  seeking_job: "job_based",
  needs_service: "intent_based",
  asking_for_help: "intent_based",
  seeking_client: "intent_based",
  seeking_funding: "funding_based",
  offers_service: "fit_based",
  has_asset: "fit_based",
  uses_technology: "fit_based",
  lacks_asset: "opportunity_based",
  received_funding: "event_based",
  attending_event: "event_based",
  partnered_with: "event_based",
  // What an investor habitually backs is a standing attribute, not something
  // that just happened to them — the event is on the other side of that
  // sentence, where `received_funding` sits. But it is not plain fit either:
  // the portfolio is the search key, not a filter on a list of investors.
  investing_in: "investment_based",
};

/**
 * Evidence obligations that follow mechanically from the relation.
 *
 * claim  — must we prove the stated attribute is true of this entity?
 * intent — must we prove they currently WANT something?
 *
 * `lacks_asset` is the one worth pausing on: "businesses with no website" is an
 * absence to verify, not a desire they expressed. Treating it as intent would
 * let us claim a shop is shopping for a website when all we know is it has none.
 *
 * Lives here rather than in the validator because the extractor sets these at
 * read time. Two copies drifted once: the validator repaired every intent
 * relation on every frame, which buried the repairs that meant something.
 */
export const EVIDENCE_BY_RELATION: Partial<
  Record<RelationType, { claim: boolean; intent: boolean }>
> = {
  hiring: { claim: true, intent: true },
  seeking_job: { claim: true, intent: true },
  needs_service: { claim: true, intent: true },
  asking_for_help: { claim: true, intent: true },
  seeking_client: { claim: true, intent: true },
  seeking_funding: { claim: true, intent: true },
  offers_service: { claim: true, intent: false },
  lacks_asset: { claim: true, intent: false },
  has_asset: { claim: true, intent: false },
  uses_technology: { claim: true, intent: false },
  partnered_with: { claim: true, intent: false },
  attending_event: { claim: true, intent: false },
  received_funding: { claim: true, intent: false },
  investing_in: { claim: true, intent: false },
  /** Plain discovery still has to prove the entity IS what was asked for —
   *  "restaurants in Lisbon" needs evidence of each being a restaurant there.
   *  It needs no buyer-intent proof, and asserting one would invent a signal. */
  none: { claim: true, intent: false },
};

/**
 * Who is doing the thing to whom.
 *
 *   subject_to_object — "founders hiring developers" (subject acts on object)
 *   object_to_subject — "developers looking for founders to work for"
 *   mutual            — "companies partnered with each other"
 *   none              — the relation is a property, not an action
 *   unknown           — genuinely could not tell; forces a validator decision
 */
export const DIRECTIONS = [
  "subject_to_object",
  "object_to_subject",
  "mutual",
  "none",
  "unknown",
] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const LOCATION_SCOPES = [
  "in",
  "near",
  "around",
  "within_radius",
  "remote",
  "global",
  "unknown",
] as const;
export type LocationScope = (typeof LOCATION_SCOPES)[number];

/**
 * `within_last` + `window` ("2w", "30d", "3m") replaced three members that
 * encoded the unit in the member name (`last_n_days`/`weeks`/`months`). One
 * bounded-window relation with the duration beside it is a single way to say
 * one thing; three were three, and a reader had to check which the extractor
 * had picked before comparing two frames.
 *
 * `recent` is deliberately still separate: "recently funded" states no N, and
 * turning it into a window would invent a boundary the user did not give.
 */
export const TEMPORAL_RELATIONS = [
  "current",
  "recent",
  "within_last",
  "this_week",
  "this_month",
  "this_quarter",
  "this_year",
  "last_week",
  "last_month",
  "last_quarter",
  "last_year",
  "in_year",
  "future",
  "any",
  "unknown",
] as const;
export type TemporalRelation = (typeof TEMPORAL_RELATIONS)[number];

/** Legacy helper output, mapped onto the members above. */
export const TEMPORAL_RELATION_ALIASES: Record<string, TemporalRelation> = {
  last_n_days: "within_last",
  last_n_weeks: "within_last",
  last_n_months: "within_last",
  last_n_years: "within_last",
};

/**
 * Constraint operators. Closed because retrieval will dispatch on these exact
 * tokens later — a free-text operator is a constraint nothing can execute.
 * `custom` exists so an unusual comparison is still recorded structurally
 * (with `raw` preserved) rather than being flattened back into prose.
 */
export const OPERATORS = [
  "eq",
  /** `neq` and `eq + negated` both occur in the wild; the validator folds the
   *  first onto the second so retrieval has one shape to dispatch on. */
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  "exists",
  "one_of",
  "within_radius",
  "custom",
] as const;
export type Operator = (typeof OPERATORS)[number];

/**
 * What the user asked us to PROVE. Standard kinds are enumerated because
 * verification later needs a checker per kind; `other` + an open label keeps
 * "verify they accept walk-ins" representable instead of discarded.
 */
export const VERIFICATION_KINDS = [
  "business_exists",
  "no_owned_website",
  "website_is_real",
  "phone_is_public",
  "email_deliverable",
  "contact_is_current",
  "employment_is_current",
  "claim_is_evidenced",
  "intent_is_recent",
  "other",
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/**
 * What the user asked us to PRODUCE. Same escape hatch: "make a Notion-ready
 * table", "output a CSV grouped by suburb" survive as `other` + label.
 */
export const OUTPUT_KINDS = [
  "table",
  "cards",
  "list",
  "csv",
  "outreach_drafts",
  "summary",
  "evidence",
  "other",
] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Kinds whose meaning lives in the open label rather than the member. */
export const KINDS_NEEDING_LABEL = ["other", "custom"] as const;

// ── Open-descriptor alias tables (optional, never required) ────────────────

/**
 * OPTIONAL normalization only. `canonicalize` returns null for anything absent,
 * and every caller keeps the user's wording as the value regardless. Adding an
 * entry here improves matching later; omitting one must never break a request.
 */
export const OBJECT_ALIASES: Record<string, string> = {
  // people / roles
  dev: "developer",
  devs: "developer",
  developers: "developer",
  engineer: "engineer",
  engineers: "engineer",
  "embedded engineers": "embedded engineer",
  "firmware engineers": "firmware engineer",
  "rust devs": "rust developer",
  "rust ppl": "rust developer",
  programmers: "developer",
  designers: "designer",
  marketers: "marketer",
  // assets
  site: "website",
  sites: "website",
  website: "website",
  websites: "website",
  "web presence": "website",
  "web site": "website",
  "proper website": "website",
  "actual site": "website",
  "real website": "website",
  // services
  seo: "seo",
  "search engine optimization": "seo",
  marketing: "marketing",
  "digital marketing": "marketing",
  ads: "advertising",
  "paid ads": "advertising",
  bookkeeping: "bookkeeping",
  "payroll automation": "payroll automation",
  // employment object
  job: "employment",
  jobs: "employment",
  work: "employment",
  employment: "employment",
  "a job": "employment",
};

/** Slang and shorthand that carry meaning, resolved before anything else. */
export const PHRASE_ALIASES: Record<string, string> = {
  rn: "right now",
  asap: "as soon as possible",
  atm: "at the moment",
  tryna: "trying to",
  wanna: "want to",
  gonna: "going to",
  n: "and",
  w: "with",
  "w/": "with",
  "w/o": "without",
  ppl: "people",
  biz: "business",
  co: "company",
  cos: "companies",
  fb: "facebook",
  ig: "instagram",
  li: "linkedin",
  yt: "youtube",
};

/**
 * Fields a constraint may talk about. NOT a closed set — this is a hint list
 * used to normalize obvious synonyms ("staff count" -> employee_count). An
 * unrecognized field name is kept verbatim and is never a violation.
 */
export const CONSTRAINT_FIELD_ALIASES: Record<string, string> = {
  employees: "employee_count",
  "employee count": "employee_count",
  staff: "employee_count",
  "staff count": "employee_count",
  headcount: "employee_count",
  "team size": "employee_count",
  rating: "rating",
  stars: "rating",
  reviews: "review_count",
  "review count": "review_count",
  rate: "hourly_rate",
  "hourly rate": "hourly_rate",
  price: "price",
  budget: "budget",
  revenue: "revenue",
  funding: "funding_amount",
  site: "website",
  website: "website",
  distance: "distance",
  radius: "distance",
  city: "location",
  location: "location",
  category: "category",
  industry: "industry",
};

/**
 * The fields a request can ask to be DELIVERED for each row, and the wordings
 * that name them.
 *
 * A separate namespace from `CONSTRAINT_FIELD_ALIASES`, which names fields a
 * request can FILTER on. They overlap on phone/email/website and diverge
 * everywhere else: `employee_count` is only ever filtered, `owner_name` only
 * ever delivered.
 *
 * Patterns rather than a string table because these arrive inside a clause —
 * "phone number required", "socials if possible" — so the match has to tolerate
 * the wording around the field and the plural on it.
 */
export const DELIVERABLE_FIELD_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bphone(?:\s+numbers?)?\b|\bnums\b/i, "phone"],
  [/\bemails?(?:\s+address(?:es)?)?\b/i, "email"],
  [/\bwebsites?\b/i, "website"],
  [/\baddress(?:es)?\b/i, "address"],
  [
    /\bowner(?:'?s)?\s+names?\b|\bfounders?\s+names?\b|\bnames?\s+of\s+(?:the\s+)?(?:owner|founder)/i,
    "owner_name",
  ],
  [/\binstagram\b|\binsta\b|\big\b/i, "instagram"],
  [/\bfacebook\b|\bfb\b/i, "facebook"],
  [/\blinkedin\b/i, "linkedin"],
  [/\bsocials?\b|\bsocial\s+media\b/i, "socials"],
  [/\bopening\s+hours?\b|\bhours\b/i, "opening_hours"],
  [/\breviews?\b/i, "reviews"],
  [/\bratings?\b/i, "rating"],
  [/\bevidence\b|\bproof\b|\bsources?\b|\blinks?\b/i, "evidence"],
  [/\bsummar(?:y|ies)\b/i, "summary"],
];

/**
 * The key a delivered field is addressed by, or null when we do not know it.
 *
 * `required_fields` is a list of KEYS — something downstream selects columns
 * and judges row completeness by — while `raw` holds the words that produced
 * it. One extractor emitted `"phone"` and another `"phone number"` for the same
 * sentence, which is two different columns to anything doing an equality check,
 * so the same request produced rows of different shapes depending on which
 * model answered.
 *
 * Null rather than a slugified guess: an unrecognized ask ("their VAT number")
 * is a real ask, and inventing `vat_number` as though it were a known field
 * would claim a capability nothing has. The caller keeps the user's wording.
 */
export function keyDeliverableField(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  for (const [re, name] of DELIVERABLE_FIELD_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

/**
 * Delivered fields that name a FAMILY of channels, and the members inside each.
 *
 * Members are limited to keys `keyDeliverableField` can actually return —
 * listing a channel the patterns above do not recognize would describe a
 * narrowing that can never happen.
 */
export const DELIVERABLE_FIELD_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  socials: ["instagram", "facebook", "linkedin"],
};

/**
 * The family member a raw span actually names, or null when it names none.
 *
 * A model answered "insta if possible" with `socials`, which is a WIDER ask
 * than the one typed: it licenses three columns where the user named one, and
 * a row is then judged incomplete for missing a channel nobody asked about.
 * Widening is as much a misread as dropping the field, and the raw span is
 * what settles it.
 */
export function namedFamilyMember(
  key: string,
  raw: string | null | undefined,
): string | null {
  const members = DELIVERABLE_FIELD_MEMBERS[key];
  if (!members || !raw) return null;
  const named = keyDeliverableField(raw);
  return named && members.includes(named) ? named : null;
}

/**
 * Resolve an open descriptor to a canonical form when one is known.
 * Returns `null` when unknown — the caller keeps the user's own wording.
 */
export function canonicalize(
  raw: string | null | undefined,
  table: Record<string, string> = OBJECT_ALIASES,
): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (table[key]) return table[key];
  const singular = key.replace(/s$/, "");
  if (table[singular]) return table[singular];
  return null;
}

/** Expand known slang in place so downstream regexes see real words. */
export function expandPhrases(text: string): string {
  if (!text) return "";
  return text.replace(/[\p{L}\p{N}/']+/gu, (tok) => {
    const hit = PHRASE_ALIASES[tok.toLowerCase()];
    return hit ?? tok;
  });
}

// ── Type guards ────────────────────────────────────────────────────────────

export function isRelationType(v: string): v is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(v);
}
export function isEntityType(v: string): v is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(v);
}
export function isDirection(v: string): v is Direction {
  return (DIRECTIONS as readonly string[]).includes(v);
}
/**
 * WHY a question is being asked. Recorded so a reviewer can tell a genuine
 * blocker from the layer failing to read plain English — the failure mode that
 * made "restaurants in Lisbon" ask what should be true of the restaurants.
 *
 *   missing_target         we do not know what to look for at all
 *   ambiguous_entity       the noun is legitimately a person OR a business
 *   ambiguous_direction    a relation is stated but who-does-what is unclear
 *   unreadable_relation    relation wording present, meaning not recoverable
 *   missing_relation_object "looking for" with nothing after it
 *   underspecified_scope   executable but unboundedly broad ("find businesses")
 *   compound_parse_uncertain two requests detected, split not trustworthy
 *   contradiction          the request asks for mutually exclusive things
 *   invalid_answer         a clarification answer could not be used
 */
export const CLARIFICATION_REASONS = [
  "missing_target",
  "ambiguous_entity",
  "ambiguous_direction",
  "unreadable_relation",
  "missing_relation_object",
  "underspecified_scope",
  "missing_purpose",
  "compound_parse_uncertain",
  "contradiction",
  "invalid_answer",
] as const;
export type ClarificationReason = (typeof CLARIFICATION_REASONS)[number];

export function isProspectingMode(v: string): v is ProspectingMode {
  return (PROSPECTING_MODES as readonly string[]).includes(v);
}
export function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as readonly string[]).includes(v);
}
