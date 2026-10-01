/**
 * Understanding Engine — noun and clause lexicons.
 *
 * This file exists because three of the layer's worst failures had one cause:
 * nothing knew where a noun phrase ENDS.
 *
 *   "around Trondheim trying to hire embedded engineers right now"
 *       -> the whole tail became the location
 *   "companies that posted a marketing role in the last two weeks"
 *       -> "last two weeks" became the location and temporal stayed empty
 *   "dental practices", "coffee roasters", "heads of talent"
 *       -> entity_type unknown, because no cue word matched
 *
 * The first two are one rule (a place span stops at a clause boundary, and a
 * temporal phrase is never a place) and the third is another (classify the
 * HEAD of the leading noun phrase, not whichever keyword appears anywhere).
 *
 * WHY LEXICONS AND NOT MORPHOLOGY. A suffix rule would be smaller and it does
 * not work: "-ers" is `roasters` (a business) and `developers` (a person);
 * "-ist" is `dentist` and `florist` (businesses) and `therapist` (a person).
 * The distinction is trade-versus-knowledge-work, which is semantic. So the
 * head nouns are curated, suffixes are a low-confidence backstop, and — this
 * is the part that keeps the open-world promise — a head noun NOBODY here
 * recognizes yields `unknown` with the user's own phrase preserved as the
 * category, never a clarification and never a guess.
 *
 * Nothing in this file is a membership requirement for a descriptor VALUE.
 * "hydroponic grow-light manufacturer" is stored verbatim whether or not
 * `manufacturer` happens to be listed below.
 */

// ── Typo tolerance ────────────────────────────────────────────────────────

/**
 * Edit distance counting a TRANSPOSITION as one error, not two (optimal string
 * alignment). `max` lets it abandon a hopeless comparison early, which matters
 * because the fuzzy lookups below run it against a few hundred lexicon keys per
 * head noun.
 *
 * Transpositions are counted because they are the dominant typing error and
 * plain Levenshtein charges two for them — which put "wesbite"/"website" and
 * "dentits"/"dentist" outside a seven-letter word's budget, exactly the words
 * this exists to repair. Raising the budget instead would have admitted every
 * two-substitution neighbour as well.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let twoBack: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1);
      }
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Misspellings of the short function words that carry clause structure.
 *
 * These get a hand-written list rather than the fuzzy lookup above, and the
 * reason is length: at three or four letters the edit neighbourhood of a
 * function word is full of real trade nouns ("bar", "spa", "pub", "vet",
 * "app"), so any budget large enough to reach "tht" → "that" is large enough
 * to turn a target into a clause boundary. The list is small, auditable, and
 * covers the typos that actually appear in chat.
 */
const FUNCTION_WORD_TYPOS: Record<string, string> = {
  tht: "that", taht: "that", htat: "that", thta: "that", tha: "that",
  wiht: "with", wtih: "with", wih: "with", wtn: "with",
  wihtout: "without", wihout: "without", withut: "without", witout: "without",
  teh: "the", hte: "the", thr: "the",
  nd: "and", adn: "and", annd: "and",
  fo: "for", ofr: "for", fror: "for",
  naer: "near", nera: "near", neer: "near",
  arund: "around", aroudn: "around", arround: "around",
  lookin: "looking", loking: "looking", lookign: "looking",
  serching: "searching", seaching: "searching",
  hirng: "hiring", hirin: "hiring", hirign: "hiring",
  needin: "needing", needng: "needing",
  whitout: "without",
  // Five letters and shorter never reach the fuzzy repair — at that length a
  // real word is one edit from another ("quilt"/"built") — so the common ones
  // are listed outright.
  aound: "around", arond: "around", aroud: "around", rund: "round",
  nearr: "near",
  hirig: "hiring", hring: "hiring",
  needd: "need", ned: "need", neds: "needs",
  wnat: "want", wnats: "wants",
  siet: "site", stie: "site",
  emial: "email", emailz: "email",
  fone: "phone", phne: "phone",
  pls: "please", plz: "please", thx: "thanks", ty: "thanks",
};

/** The word a token was probably meant to be, where it is a function word. */
export function normalizeFunctionWord(word: string): string {
  return FUNCTION_WORD_TYPOS[word] ?? word;
}

/**
 * How far a word of this length may stray before we stop calling it a typo.
 *
 * Length-scaled rather than fixed because a fixed budget is wrong at both ends:
 * at distance 1, four-letter words collide constantly ("site"/"sites"/"cite",
 * "cafe"/"care"), while a genuine misspelling of a long word usually carries
 * two errors ("audioolgist", "pharmacovigilence"). Zero below five letters
 * means short function words must match exactly.
 */
export function typoBudget(word: string): number {
  if (word.length < 5) return 0;
  if (word.length < 8) return 1;
  return 2;
}

/**
 * Nearest key in a closed vocabulary, or null when nothing is close enough.
 *
 * Only ever used where the POSITION already tells us what kind of word this is
 * — a head noun, a locative preposition, an asset. That scoping is what keeps
 * it safe: a place name never reaches these lookups, so "Split" can never be
 * repaired into "site".
 */
export function nearestKey(
  word: string,
  keys: Iterable<string>,
  maxBudget = Infinity,
): string | null {
  const w = word.toLowerCase();
  const budget = Math.min(typoBudget(w), maxBudget);
  if (budget === 0) return null;

  let best: string | null = null;
  let bestD = budget + 1;
  for (const key of keys) {
    if (key.includes(" ")) continue;
    const d = editDistance(w, key, budget);
    if (d < bestD) {
      bestD = d;
      best = key;
      if (d === 1) break;
    }
  }
  return best;
}

// ── Clause boundaries ─────────────────────────────────────────────────────

/**
 * First tokens of anything that starts a new clause after a noun phrase or a
 * place name. A place span and a head-noun span both stop here.
 *
 * Kept to FIRST tokens on purpose: a place name is one to four tokens, so a
 * single-token lookahead is enough, and a list of whole phrases would have to
 * be kept in sync with every regex that matches one.
 *
 * Collision check, because a stop word that is also a city would erase real
 * locations: Reading, Bath, Nice, Mobile, Orange, Hull and Derby are NOT here.
 * The only risky member is `last` (there is no city called Last).
 */
export const CLAUSE_STOP_TOKENS: ReadonlySet<string> = new Set([
  // conjunctions / connectives
  "and", "but", "or", "plus", "also", "then", "so", "because", "cause", "cuz",
  // relativizers
  "that", "who", "whom", "whose", "which", "where", "when",
  // relation verbs (and the slang the expander leaves behind)
  "looking", "look", "lookin", "seeking", "seek", "seeks", "searching", "search",
  "hiring", "hire", "hires", "recruiting", "recruit", "recruits",
  "needing", "need", "needs", "wanting", "want", "wants", "requiring", "require",
  "requires", "trying", "try", "tryna", "wanna", "gonna", "asking", "ask", "asks",
  "using", "use", "uses", "offering", "offer", "offers", "providing", "provide",
  "provides", "selling", "sell", "sells", "serving", "serve", "serves",
  "partnered", "partnering", "attending", "attend", "exhibiting", "speaking",
  "raised", "raising", "raise", "funded", "funding", "posted", "posting",
  "accredited", "certified", "licensed", "registered", "listed", "rated",
  "built", "powered", "running", "run", "doing", "does", "do", "done",
  "interested", "ready", "shopping", "after", "open", "paying", "actively",
  // negation / possession
  "with", "without", "no", "not", "non", "none", "lacking", "lack", "lacks",
  "missing", "excluding", "except", "excluded", "skip", "avoid", "only", "just",
  "has", "have", "having", "had", "dont", "doesnt", "havent", "hasnt", "isnt",
  "aint", "is", "are", "was", "were", "be", "been",
  // comparison / quantity
  "within", "under", "over", "above", "below", "more", "fewer", "less", "least",
  "most", "minimum", "min", "maximum", "max", "up", "around", "about", "between",
  "at", "than", "as",
  // temporal (the whole point of item 9 — these can never extend a place span)
  "right", "rn", "now", "today", "tonight", "tomorrow", "yesterday", "currently",
  "recently", "recent", "this", "last", "past", "since", "lately", "already",
  "still", "asap", "soon", "immediately",
  // deliverables
  "phone", "email", "emails", "socials", "instagram", "insta", "ig", "facebook",
  "fb", "linkedin", "twitter", "reviews", "rating", "ratings", "hours",
  "verify", "verified", "confirm", "confirmed", "double", "check", "prove",
  "include", "including", "output", "export", "give", "gimme", "send", "return",
  "table", "csv", "spreadsheet", "notion", "sheet", "list", "summary",
  "if", "prefer", "preferred", "preferably", "ideally", "bonus", "optional",
  "required", "must", "should", "please", "pls", "thx", "thanks",
  // prepositions that would start a SECOND locative clause
  "for", "from", "to", "by", "on", "of", "off", "into", "onto", "per",
]);

/**
 * Tokens that may sit INSIDE a multi-word place name. Without these, "Rio de
 * Janeiro" and "Stratford upon Avon" lose their tail, and `of` is in the stop
 * list above for good reason ("in Leeds of all places" is not a place).
 */
export const PLACE_JOIN_TOKENS: ReadonlySet<string> = new Set([
  "de", "del", "della", "der", "den", "des", "di", "da", "do", "dos", "das",
  "la", "le", "les", "los", "las", "el", "al", "an", "am", "auf", "aan", "op",
  "san", "santa", "santo", "sao", "são", "saint", "st", "ste", "fort", "ft",
  "new", "old", "north", "south", "east", "west", "upper", "lower", "greater",
  "upon", "on", "under", "sur", "sous", "bei", "ob", "im", "in", "the", "and",
]);

/**
 * A temporal expression, matched WHOLE against a candidate place span. This is
 * the `TEMPORAL_AS_LOCATION` guard: "in the last two weeks" reaches the place
 * parser as "last two weeks", and the only correct answer is "that is not a
 * place".
 */
export const WHOLE_TEMPORAL_RE =
  /^(?:the\s+)?(?:last|past|previous|next|coming|recent)?\s*(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|couple(?:\s+of)?)?\s*(?:second|minute|hour|day|days|week|weeks|month|months|quarter|quarters|year|years|yr|yrs|decade)s?(?:\s+ago)?$|^(?:right\s+now|rn|now|today|tonight|tomorrow|yesterday|currently|recently|lately|this\s+(?:week|month|quarter|year|yr)|last\s+(?:week|month|quarter|year|yr)|next\s+(?:week|month|quarter|year)|ytd|q[1-4](?:\s*20\d\d)?|20\d\d|'?\d\d|asap|as\s+soon\s+as\s+possible|any\s?time|ever)$/i;

/**
 * Wording that introduces something the user wants left OUT.
 *
 * Read by two places that must agree: the deterministic exclusion detector,
 * which turns "excluding Waterford" into a negated constraint, and the
 * validator, which uses it to decide whether a location span the model
 * produced is a search area or the thing being excluded. They disagreed while
 * each owned its own copy, and a frame came back holding `location = Gdansk`
 * whose own raw span read "excluding Gdansk".
 *
 * Kept unanchored and caseless; a scanner clones it with `g`, the validator
 * anchors it to the start of a span.
 */
export const EXCLUSION_CUE_RE =
  /\b(?:excluding|exclude|except|other\s+than|not|no|without|skip|avoid)\s+(?:the\s+)?/iu;

/** Does this span OPEN with an exclusion, i.e. is the span itself the thing
 *  being excluded rather than a place to search? */
export function opensWithExclusion(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return new RegExp(`^\\s*${EXCLUSION_CUE_RE.source}`, "iu").test(raw);
}

/**
 * Prepositions that place a search NEAR a place rather than INSIDE it.
 *
 * None of these is an exclusion, and none appears in `EXCLUSION_CUE_RE`:
 * "outside Turku" asks for the area around Turku, not for everywhere but
 * Turku.
 *
 * Shared by the deterministic reader's `scopeFor` and by the validator. A
 * model answered "outside Trois-Rivières" with `scope = "in"` — the reverse of
 * the only reading those words have — and by the time a frame is validated the
 * raw span is the sole witness to which direction was typed. Two copies of
 * this list would let the two sides disagree about it.
 */
export const NEAR_SCOPE_CUE_RE = /^(?:near|nearby|around|round|outside)$/i;

/** Does this place phrase OPEN with a word meaning "near" rather than "in"? */
export function opensWithNearCue(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const [first = ""] = raw.trim().split(/[\s,]+/, 1);
  return NEAR_SCOPE_CUE_RE.test(first);
}

/**
 * Wording that marks a requested field as a nice-to-have rather than a must.
 *
 * Shared by the deterministic reader and the validator for the same reason as
 * the list above: the strength of an ask is stated in the words, and the raw
 * span is all that survives into a frame. A required field is a filter — a row
 * without it is dropped — so reading "phone would b great" as a requirement
 * silently discards rows the user would have accepted.
 *
 * "b" is spelled out here rather than in `PHRASE_ALIASES`, where it would have
 * to hold for every bare "b" in the language: this domain writes "series b",
 * and expanding that to "series be" would corrupt a funding stage to repair a
 * hedge. The construction pins it — "would", then the letter, then a word of
 * praise.
 */
export const PREFERRED_MARKER_RE =
  /\b(if\s+possible|if\s+(?:they'?re?\s+)?available|if\s+(?:you|u|ya)?\s*can|if\s+there(?:'s| is| are)|nice\s+to\s+have|prefer(?:red|ably)?|ideally|bonus|optional|where\s+(?:available|possible)|would\s+(?:be|b)\s+(?:nice|great)|when\s+(?:you\s+)?can)\b/i;

/** Do these words hedge the ask they name? */
export function hedgesTheAsk(raw: string | null | undefined): boolean {
  return raw ? PREFERRED_MARKER_RE.test(raw) : false;
}

/**
 * Wording that ANNOUNCES a relationship without necessarily being parseable
 * into one. This is what separates `relation = none` from `relation = unknown`
 * (item 3): "cafes in Porto" contains none of these and means no relation was
 * requested; "companies around Porto doing that thing with creators" contains
 * `doing` and means a relation was requested that we failed to read.
 *
 * Deliberately excludes bare `with`/`no`: "coffee roasters with parking" and
 * "dentists with no website" are handled by the constraint and absence
 * detectors, and treating every `with` as an unreadable relation would make
 * ordinary discovery ask a question.
 */
export const RELATION_SIGNAL_RE =
  /\b(?:looking\s+(?:for|to)|lookin|searching\s+for|seeking|seeks|hiring|hire|hires|recruiting|recruits|needing|needs?|wanting|wants?|requiring|requires?|trying\s+to|tryna|asking\s+for|in\s+need\s+of|shopping\s+for|interested\s+in|ready\s+for|after\s+a|offering|offers?|providing|provides?|selling|sells?|serving|serves?|using|uses?|built\s+on|powered\s+by|running\s+on|partnered\s+with|partners\s+with|integrat(?:ed|ing)\s+with|attending|exhibiting\s+at|speaking\s+at|sponsors?\s+of|raised|raising|funded|closed\s+a|secured|posted|accredited\s+by|certified\s+by|licensed\s+by|doing|does|that\s+do|who\s+do|which\s+do|lacking|lacks?|missing|don'?t\s+have|doesn'?t\s+have|haven'?t\s+got|without\s+(?:a|an|any)|with\s+no|open\s+to|available\s+for|tendering|bidding)\b/i;

// ── Head-noun classification ──────────────────────────────────────────────

export type HeadKind = "person" | "business" | "company" | "job" | "investor" | "organization";

type HeadEntry = { kind: HeadKind; ambiguous?: boolean };

const P = (): HeadEntry => ({ kind: "person" });
const B = (): HeadEntry => ({ kind: "business" });
const C = (): HeadEntry => ({ kind: "company" });
const J = (): HeadEntry => ({ kind: "job" });
const I = (): HeadEntry => ({ kind: "investor" });
const O = (): HeadEntry => ({ kind: "organization" });
/** Legitimately either — "veterinary orthopaedic specialists" is a person or a
 *  practice depending on who is asking, and pretending otherwise is a guess. */
const AMBIG = (kind: HeadKind): HeadEntry => ({ kind, ambiguous: true });

/**
 * Keyed on the SINGULAR head. Callers singularize first, so `bakeries`,
 * `bakery`, `Bakeries` all land on one entry.
 */
const HEAD_NOUNS: Record<string, HeadEntry> = {
  // — people: leadership —
  founder: P(), cofounder: P(), "co-founder": P(), owner: P(), proprietor: P(),
  ceo: P(), cto: P(), cfo: P(), coo: P(), cmo: P(), cro: P(), cio: P(), ciso: P(),
  chief: P(), president: P(), vp: P(), "vice president": P(), director: P(),
  head: P(), lead: P(), manager: P(), supervisor: P(), executive: P(), exec: P(),
  principal: P(), "decision maker": P(), stakeholder: P(), buyer: P(),
  // — people: work —
  engineer: P(), developer: P(), dev: P(), programmer: P(), coder: P(),
  designer: P(), copywriter: P(), writer: P(), editor: P(), journalist: P(),
  marketer: P(), recruiter: P(), headhunter: P(), salesperson: P(), rep: P(),
  bookkeeper: P(), lawyer: P(), solicitor: P(), attorney: P(), barrister: P(),
  paralegal: P(), analyst: P(), strategist: P(), scientist: P(), researcher: P(),
  technician: P(),
  nurse: P(), doctor: P(), physician: P(), surgeon: P(), dermatologist: P(),
  psychologist: P(), psychiatrist: P(), counsellor: P(), counselor: P(),
  midwife: P(), paramedic: P(), pharmacist: P(), radiologist: P(),
  physiotherapist: P(), physio: P(), chiropractor: P(), osteopath: P(),
  dietitian: P(), nutritionist: P(), podiatrist: P(), optometrist: P(),
  audiologist: P(), orthoptist: P(), phlebotomist: P(), sonographer: P(),
  coach: P(), trainer: AMBIG("person"), instructor: AMBIG("person"),
  teacher: P(), professor: P(), lecturer: P(), tutor: P(), student: P(),
  graduate: P(), intern: P(), apprentice: P(), freelancer: P(), contractor: AMBIG("business"),
  creator: P(), influencer: P(), streamer: P(), blogger: P(), podcaster: P(),
  youtuber: P(), artist: P(), musician: P(), illustrator: P(), animator: P(),
  videographer: P(), photographer: AMBIG("person"), sommelier: P(), chef: P(),
  barista: P(), bartender: P(), waiter: P(), driver: P(), courier: P(),
  pilot: P(), welder: P(), machinist: P(), carpenter: P(), joiner: P(),
  mechanic: AMBIG("business"), stylist: P(), hairdresser: P(), beautician: P(),
  esthetician: P(), tattooist: P(), "tattoo artist": P(), masseuse: P(),
  "personal trainer": P(), "yoga instructor": P(), veterinarian: P(),
  // — people: generic —
  person: P(), people: P(), individual: P(), human: P(), professional: P(),
  candidate: P(), applicant: P(), jobseeker: P(), "job seeker": P(),
  // — legitimately either —
  consultant: AMBIG("person"), specialist: AMBIG("person"),
  practitioner: AMBIG("person"), adviser: AMBIG("person"), advisor: AMBIG("person"),
  accountant: AMBIG("person"), architect: AMBIG("business"),
  agent: AMBIG("person"), broker: AMBIG("business"), realtor: AMBIG("person"),
  therapist: AMBIG("person"), partner: AMBIG("person"), provider: AMBIG("company"),
  vet: AMBIG("business"), barber: AMBIG("business"), painter: AMBIG("business"),
  cleaner: AMBIG("business"), caterer: AMBIG("business"), mover: AMBIG("business"),

  // — companies —
  // "business" is deliberately B, not C: in every lead list anyone asks for,
  // "businesses in Alberta" means shops and trades, not corporations. The word
  // for a corporation is "company", which is right beside it.
  company: C(), business: B(), startup: C(), "start-up": C(), scaleup: C(),
  "scale-up": C(), firm: C(), corporation: C(), corp: C(), enterprise: C(),
  brand: C(), vendor: C(), supplier: C(), manufacturer: C(), distributor: C(),
  wholesaler: C(), importer: C(), exporter: C(), agency: C(), consultancy: C(),
  group: C(), lab: C(), saas: C(), platform: C(), marketplace: C(),
  publisher: C(), operator: C(), integrator: C(), reseller: C(), isv: C(),
  msp: C(), "software house": C(), unicorn: C(), incumbent: C(), employer: C(),

  // — local businesses —
  shop: B(), store: B(), outlet: B(), boutique: B(), restaurant: B(), cafe: B(),
  "café": B(), coffeehouse: B(), diner: B(), bistro: B(), eatery: B(),
  takeaway: B(), deli: B(), bar: B(), pub: B(), taproom: B(), bakery: B(),
  patisserie: B(), brewery: B(), winery: B(), distillery: B(), roaster: B(),
  roastery: B(), butcher: B(), grocer: B(), greengrocer: B(), fishmonger: B(),
  cheesemonger: B(), florist: B(), nursery: B(), salon: B(), barbershop: B(),
  spa: B(), gym: B(), studio: AMBIG("business"), clinic: B(), practice: B(),
  surgery: B(), pharmacy: B(), dispensary: B(), hotel: B(), hostel: B(),
  motel: B(), resort: B(), guesthouse: B(), campsite: B(), dealership: B(),
  garage: B(), workshop: B(), "body shop": B(), carwash: B(), laundromat: B(),
  launderette: B(), daycare: B(), kennel: B(), cattery: B(), stable: B(),
  farm: B(), orchard: B(), vineyard: B(), ranch: B(), mill: B(), foundry: B(),
  factory: B(), plant: B(), warehouse: B(), depot: B(), yard: B(),
  // "not chains" is a filter on the KIND of business, and every lead list asks
  // for it. Absent from the table it read as an unknown capitalized plural,
  // which is a place — so the filter was lost and a town nobody named was
  // excluded.
  chain: B(), franchise: B(),
  cinema: B(), theatre: B(), theater: B(), gallery: B(), arcade: B(),
  bookstore: B(), bookshop: B(), "pet shop": B(), market: B(),
  centre: AMBIG("business"), center: AMBIG("business"),
  // trades that operate as small businesses in every lead list we build
  dentist: B(), plumber: B(), electrician: B(), roofer: B(),
  locksmith: B(), landscaper: B(), builder: B(), glazier: B(), plasterer: B(),
  tiler: B(), decorator: B(), gardener: B(),
  installer: B(), fitter: B(), upholsterer: B(), exterminator: B(),
  "driving school": B(), "estate agent": B(), "travel agent": B(),
  cobbler: B(), sailmaker: B(), chocolatier: B(), cidery: B(), creamery: B(),
  // Trades whose name is an OCCUPATION rather than premises. "arborists looking
  // for work" is a person; "arborists in Kent" could be either, so they are
  // ambiguous-leaning-person and a modifier or a relation settles it.
  // A clinical title is the practitioner AND the practice: "orthodontists in
  // Adelaide" is a list of clinics, "orthodontists looking for clients" is a
  // list of people. The lean stays on the premises, because that is what a
  // lead list of them means, and the ambiguity is declared so the other
  // reading is never scored as an error.
  orthodontist: AMBIG("business"),
  arborist: AMBIG("person"), surveyor: AMBIG("person"),
  luthier: AMBIG("person"), thatcher: AMBIG("person"),
  farrier: AMBIG("person"), blacksmith: AMBIG("person"),
  // — people: further occupations —
  agronomist: P(), actuary: P(), conservator: P(), archivist: P(),
  cartographer: P(), draughtsman: P(), draftsman: P(), interpreter: P(),
  translator: AMBIG("person"), transcriptionist: P(), proofreader: P(),
  "piano tuner": P(), arbitrator: P(), mediator: AMBIG("person"),
  auditor: AMBIG("person"), valuer: AMBIG("person"), assessor: AMBIG("person"),

  // — institutions —
  nonprofit: O(), "non-profit": O(), charity: O(), ngo: O(), foundation: O(),
  trust: O(), association: O(), society: O(), union: O(), cooperative: O(),
  "co-op": O(), club: O(), school: O(), college: O(), university: O(),
  academy: O(), hospital: O(), council: O(), municipality: O(), church: O(),
  temple: O(), mosque: O(), synagogue: O(), library: O(), museum: O(),
  "housing association": O(), "sports club": O(), department: O(), ministry: O(),

  // — investors —
  investor: I(), vc: I(), "venture capital": I(), angel: I(), lp: I(),
  "family office": I(), fund: I(), syndicate: I(), accelerator: I(),
  incubator: I(),

  // — jobs —
  job: J(), role: J(), position: J(), opening: J(), vacancy: J(), posting: J(),
  listing: J(), gig: J(), req: J(),
};

/** Weak backstops, used only when the head noun is not listed above. */
const ORG_SUFFIXES = [
  "ery", "eries", "ory", "ories", "shop", "shops", "works", "mart", "market",
  "store", "stores", "house", "houses", "centre", "center", "hub", "hubs",
];
// `-ist` covers a long tail of occupations we will never finish listing —
// agronomist, taxidermist, strategist, ceramicist, herpetologist — and reads
// as a person in every one of them. It sits after the table, so "dentist" and
// "optometrist" keep their explicit (and deliberately ambiguous) entries.
const PERSON_SUFFIXES = ["ologist", "ographer", "wright", "eer", "ician", "ist", "smith"];

/**
 * Does the head END in this suffix, allowing for one typed slip in a long one?
 *
 * The suffix backstops carry the open world: they are what makes "hydroponics
 * works" a business and "taxidermist" a person without either word being
 * listed. A single mistyped letter switched them off entirely — "cider
 * hoouses" stopped reading as an org and was peeled apart as a place name —
 * and the repair table below cannot help, because these words are deliberately
 * absent from it.
 *
 * Tolerance is limited to suffixes of five letters or more, where one edit
 * cannot reach a different suffix: "-eer" and "-ist" stay exact, since at
 * three letters almost any word is one edit from ending in one.
 */
function endsLike(last: string, suffix: string): boolean {
  if (last.endsWith(suffix)) return last.length > suffix.length + 1;
  if (suffix.length < 5) return false;
  for (const width of [suffix.length, suffix.length + 1, suffix.length - 1]) {
    if (last.length <= width + 1) continue;
    if (editDistance(last.slice(-width), suffix, 1) <= 1) return true;
  }
  return false;
}

/**
 * Heads that say "a person of the preceding kind" and nothing else. Only ever
 * dropped when a real head precedes them (see `classifyHead`), so a bare
 * "people" stays the generic request it is.
 */
const TRANSPARENT_HEADS: ReadonlySet<string> = new Set([
  "types", "type", "folks", "folk", "guys", "ppl", "people", "persons",
  "individuals", "pros",
]);

/** "freelance copywriters" is a person; "local bakeries" is a business. */
const PERSON_MODIFIERS = /\b(freelance|self-?employed|solo|contract|part-?time|junior|senior|mid-?level|entry-?level|aspiring|experienced)\b/i;
const BUSINESS_MODIFIERS = /\b(local|small|independent|family-?(?:run|owned)|boutique|chain|franchise|multi-?site|high-?street|brick-?and-?mortar)\b/i;

/**
 * Optional industry recognition. Used only to move a modifier out of the role
 * phrase — "robotics founders" reads better as role=founder + industry=robotics
 * than as role="robotics founder". Absence from this list costs nothing: the
 * modifier simply stays part of the open descriptor.
 */
const INDUSTRY_WORDS = new Set([
  "robotics", "fintech", "biotech", "medtech", "healthtech", "edtech", "agritech",
  "proptech", "adtech", "martech", "hrtech", "insurtech", "deeptech", "cleantech",
  "climate", "climate tech", "logistics", "cybersecurity", "security", "saas",
  "ai", "ml", "crypto", "web3", "blockchain", "gaming", "esports", "ecommerce",
  "e-commerce", "retail", "hospitality", "construction", "legal", "manufacturing",
  "renewables", "energy", "insurance", "banking", "telecom", "automotive",
  "aerospace", "defence", "defense", "pharma", "biotechnology", "mining",
  "shipping", "maritime", "agriculture", "food", "beverage", "fashion", "beauty",
  "wellness", "fitness", "travel", "real estate", "media", "publishing",
  "advertising", "recruitment", "staffing", "consulting", "nonprofit",
]);

// ── Public helpers ────────────────────────────────────────────────────────

/** English plural -> singular, good enough for head nouns and no more. */
export function singularize(word: string): string {
  const w = word.trim();
  if (w.length < 4) return w;
  const lower = w.toLowerCase();
  // `-ss`, `-us` and `-is` endings are almost never plurals (business, campus,
  // analysis). `-as` was here too and cost us every noun that simply ends in
  // one: saunas, pizzas, villas, arenas, cinemas, plazas all read as singular
  // and missed their entry, so the target came back unknown.
  if (/(?:ss|us|is)$/.test(lower)) return w;
  if (/ies$/.test(lower)) return `${w.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes)$/.test(lower)) return w.slice(0, -2);
  if (/oes$/.test(lower)) return w.slice(0, -2);
  if (/s$/.test(lower)) return w.slice(0, -1);
  return w;
}

export type HeadClassification = {
  kind: HeadKind | "unknown";
  /** The singularized head noun, or null when the phrase had no usable head. */
  head: string | null;
  /** True when the classification is a coin toss we refuse to hide. */
  ambiguous: boolean;
  confidence: number;
  /** Modifier words before the head, e.g. "veterinary orthopaedic". */
  modifiers: string[];
  /** Set when a modifier was recognized as an industry. */
  industry: string | null;
  /** The misspelling this head was repaired from, when it was repaired. */
  repairedFrom?: string;
  /**
   * The kind came from the word's SHAPE — a misspelling repair or the
   * unrecognized-plural backstop — rather than from the table.
   *
   * Callers that are still deciding how much of a phrase is the target need
   * this: "sailmakers pécs" answers `business` only because "pécs" reads as an
   * unrecognized plural, and a guess of that strength must lose to a confident
   * reading of the words before it.
   */
  guessed?: boolean;
};

const NOISE_WORDS = new Set([
  "the", "a", "an", "some", "any", "all", "more", "other", "such", "these",
  "those", "my", "our", "their", "your", "me", "us", "good", "great", "top",
  "best", "new", "real", "actual", "proper", "decent",
]);

/**
 * Closed-class words a typo may be repaired INTO, and the only ones.
 *
 * Deliberately excludes every open-world noun — head nouns, occupations,
 * categories, industries, place names. Those are exactly the words we promised
 * never to require a dictionary entry for (§6), and a misspelled one costs
 * nothing here: the phrase still travels through the frame verbatim. What a
 * misspelled CUE costs is the whole reading — "hirng" turns a hiring request
 * into a plain listing — so repair is scoped to the words that carry grammar
 * and requirements rather than to the words that carry the world.
 */
let REPAIR_VOCAB: Set<string> | null = null;
function repairVocab(): Set<string> {
  if (REPAIR_VOCAB) return REPAIR_VOCAB;
  REPAIR_VOCAB = new Set<string>([
    // placement and clause structure
    "around", "outside", "inside", "across", "throughout", "within", "near",
    "nearby", "based", "located", "between", "about", "from", "with", "that",
    "which", "who", "whose", "their", "they", "there", "where", "when",
    // relation cues
    "hiring", "hire", "hires", "recruiting", "recruit", "recruits", "looking",
    "seeking", "seeks", "seek", "needing", "needs", "need", "needed",
    "wanting", "wants", "want", "offering", "offers", "offer", "providing",
    "provides", "provide", "selling", "sells", "sell", "funded", "funding",
    "raised", "raising", "using", "uses", "posted", "posting", "posts",
    "mentioned", "mentioning", "partnered", "partnering", "attending",
    "attended", "exhibiting", "asking", "searching", "serving", "serves",
    "serve", "employing", "employs", "employ", "expanding", "launching",
    "opening", "switching", "migrating", "adopting", "trying", "tryna",
    "wanna", "gonna", "commissioning", "building", "built", "redesign",
    "redesigning", "invests", "investing", "backing", "advertising",
    // relation OBJECTS that are grammar rather than world. "clients" and
    // "someone" are the objects a relation cue takes, and each one decides a
    // relation type: "looking for clients" is seeking_client, "needs someone
    // for X" puts the service in X. A typo in one of these does not cost a
    // descriptor, it costs the relation.
    "clients", "client", "customers", "customer", "someone", "somebody",
    "anyone", "anybody", "people",
    // negation and exclusion
    "without", "excluding", "exclude", "except", "besides", "never",
    "neither", "dont", "doesnt", "isnt", "arent", "havent", "hasnt", "cant",
    // quantity
    "least", "minimum", "maximum", "possible", "many", "much", "over",
    "under", "more", "less", "upto", "atleast", "roughly", "approximately",
    // assets and contact fields
    "website", "websites", "site", "sites", "webpage", "homepage", "domain",
    "logo", "booking", "phone", "email", "emails", "socials", "instagram",
    "facebook", "linkedin", "twitter", "tiktok", "youtube", "reviews",
    "review", "rating", "ratings", "hours", "address", "owner", "owners",
    "contact", "contacts", "number", "numbers", "handle", "handles",
    // deliverables
    "required", "require", "requires", "preferred", "prefer", "optional",
    "verify", "verified", "verification", "confirm", "confirmed", "double",
    "check", "checked", "proof", "evidence", "source", "sources", "summary",
    "table", "spreadsheet", "json", "sheet", "notion", "outreach", "drafts",
    "draft", "export", "column", "columns", "include", "including",
    // filler and politeness
    "please", "thanks", "thank", "gimme", "really", "actually", "maybe",
    "urgent", "some",
    // temporal
    "today", "tonight", "yesterday", "recently", "recent", "currently",
    "lately", "month", "months", "week", "weeks", "year", "years", "quarter",
    "days", "since", "last", "past",
  ]);
  return REPAIR_VOCAB;
}

/**
 * Repair misspelled CLOSED-CLASS words before anything is read out of the text.
 *
 * Four guards keep it from touching the open world:
 *
 *  - the vocabulary above holds no nouns anyone searches FOR;
 *  - a token right after a locative preposition is a place and is never
 *    touched, which is what protects "aound kosice" once "aound" is repaired;
 *  - a capitalized token is a name (unless the whole message is shouted);
 *  - fuzzy repair needs six letters, because at five "quilt" is one edit from
 *    "built". At exactly five it is narrowed to a dropped keystroke — the
 *    candidate must be one letter LONGER — and below five only the exact
 *    table repairs anything.
 *
 * Returns the repairs so the frame can report them rather than silently
 * rewriting what the user typed.
 */
/**
 * Is this text shouted? Measured as a MAJORITY of its words, not as the whole
 * string being uppercase.
 *
 * Capitalization is the signal that a token is a proper noun, and that signal
 * is what protects a place name from being repaired into a vocabulary word. In
 * shouted text it carries no information and has to be ignored — but one
 * lowercase word is enough to break a whole-string test, and real shouting ends
 * in "rn" or "asap" more often than not. That case left every word in the
 * request looking like a proper noun, so nothing was repaired and nothing was
 * read.
 */
export function isShouted(text: string): boolean {
  const words = text.match(/[\p{L}]{2,}/gu) ?? [];
  if (words.length < 3) return false;
  const caps = words.filter((w) => w === w.toUpperCase()).length;
  return caps / words.length >= 0.7;
}

/** The vocabulary words exactly one letter longer than a typed token. */
const BY_LENGTH = new Map<number, string[]>();
function longerByOne(vocab: Iterable<string>, typed: number): string[] {
  const want = typed + 1;
  let bucket = BY_LENGTH.get(want);
  if (!bucket) {
    bucket = [];
    for (const w of vocab) if (w.length === want) bucket.push(w);
    BY_LENGTH.set(want, bucket);
  }
  return bucket;
}

/**
 * Would this token, or its singular, be read as the name of a KIND OF THING?
 *
 * The closed-class repair vocabulary must never consume a word that names
 * something searchable. "investrs" is one keystroke from "invests", a relation
 * cue sitting in the table — and one keystroke from "investor", which is what
 * the writer meant. Repairing it turned a search for investors into a search
 * for a category called "invests". Where the noun is the better reading,
 * nothing is repaired here and `classifyHead` does it later, in the one
 * position where repairing a noun is safe.
 */
function namesAThing(lower: string): boolean {
  if (HEAD_NOUNS[lower]) return true;
  const singular = singularize(lower);
  if (HEAD_NOUNS[singular]) return true;
  return singular.length >= 6 && nearestKey(singular, Object.keys(HEAD_NOUNS), 1) !== null;
}

export function repairTokens(text: string): {
  text: string;
  repairs: Array<{ from: string; to: string }>;
} {
  const vocab = repairVocab();
  const shouted = isShouted(text);
  const repairs: Array<{ from: string; to: string }> = [];

  let out = "";
  let cursor = 0;
  let prev: string | null = null;

  for (const m of text.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
    const token = m[0];
    const lower = token.toLowerCase();
    const at = m.index ?? 0;
    out += text.slice(cursor, at);
    cursor = at + token.length;

    let replacement = token;
    const placeSlot = prev !== null && LOCATIVE_PREP_TOKENS.has(prev);
    const named = !shouted && /^\p{Lu}/u.test(token);

    if (!vocab.has(lower) && !namesAThing(lower)) {
      const exact = FUNCTION_WORD_TYPOS[lower];
      if (exact && !placeSlot) {
        replacement = exact;
      } else if (!placeSlot && !named && lower.length >= 6) {
        // One edit, never two. At distance 2 the vocabulary starts eating the
        // open world: "plumbers" is two edits from "numbers", "roasters" two
        // from "posters". Every typo worth repairing here — "wesbite",
        // "fnuding", "oustide", "arouund" — is a single transposition or slip,
        // and Damerau counts a transposition as one.
        const near = nearestKey(lower, vocab, 1);
        if (near) replacement = near;
      } else if (!placeSlot && !named && lower.length === 5) {
        // A DROPPED KEYSTROKE, and nothing else. At five letters the general
        // branch above is unsafe because a substitution reaches real words
        // ("quilt"/"built", "sales"/"sells"), but a candidate one letter
        // LONGER than what was typed cannot: to collide it would have to be a
        // word the typist nearly typed and shortened by exactly one letter.
        // "fuded" is the whole point — a missed key in "funded" costs the
        // relation, and the exact table cannot hold every slip in every verb.
        const near = nearestKey(lower, longerByOne(vocab, lower.length), 1);
        if (near) replacement = near;
      }
      if (replacement !== token) repairs.push({ from: token, to: replacement });
    }

    out += replacement;
    prev = replacement.toLowerCase();
  }
  out += text.slice(cursor);

  return { text: out, repairs };
}

/**
 * Classify a leading noun phrase by its HEAD, which for English is the last
 * noun ("heads of talent" is the exception below).
 *
 * Returns `unknown` rather than a guess when the head is unrecognized. That is
 * the open-world contract: the caller still stores the phrase as a category or
 * role, so an unfamiliar vertical loses only its structural label.
 *
 * `guess: false` withholds the two branches that answer from shape rather than
 * from the table — the misspelling repair and the unrecognized-plural business
 * backstop. Both are right when the caller ALREADY knows the span is the head
 * of the thing being searched for, and wrong when the question is whether the
 * span is a noun at all: a place name ending in `s` (Pecs, Cannes,
 * Trois-Rivieres) reads as an unrecognized plural and therefore as a business,
 * which vetoed those cities as locations.
 */
/**
 * Spelled plural → the head-noun key it belongs to, built once on first use.
 *
 * Only the single-word keys: a misspelling of "family offices" is not one edit
 * from anything, and the multi-word path is already tried as a phrase above.
 */
let PLURAL_HEAD_KEYS: Map<string, string> | null = null;
function pluralHeadKeys(): Map<string, string> {
  if (PLURAL_HEAD_KEYS) return PLURAL_HEAD_KEYS;
  const out = new Map<string, string>();
  for (const key of Object.keys(HEAD_NOUNS)) {
    if (key.includes(" ")) continue;
    const plural = /(?:s|x|z|ch|sh)$/.test(key)
      ? `${key}es`
      : /[^aeiou]y$/.test(key)
        ? `${key.slice(0, -1)}ies`
        : `${key}s`;
    if (!out.has(plural)) out.set(plural, key);
  }
  PLURAL_HEAD_KEYS = out;
  return out;
}

export function classifyHead(
  phrase: string,
  opts: { guess?: boolean } = {},
): HeadClassification {
  const guess = opts.guess ?? true;
  const cleaned = phrase
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return { kind: "unknown", head: null, ambiguous: false, confidence: 0.2, modifiers: [], industry: null };
  }

  let tokens = cleaned.split(" ").filter((t) => t && !NOISE_WORDS.has(t));
  if (tokens.length === 0) {
    return { kind: "unknown", head: null, ambiguous: false, confidence: 0.2, modifiers: [], industry: null };
  }

  // A transparent head carries no meaning of its own and defers to what
  // precedes it: "cto types" is a CTO, "wind turbine technician ppl" is a
  // technician, "dev guys" is a developer. Dropping it is what stops the real
  // head being read as an unrecognized plural — which the backstop below then
  // calls a business, so "cto types in the bay who r hiring" came back as a
  // company hiring CTOs rather than a person who is hiring.
  //
  // Dropped only when something remains to be the head: a bare "people" or
  // "folks" IS the whole request, and is meant to stay generic so §15's one
  // question can fire on it.
  let droppedTransparent = false;
  while (tokens.length > 1 && TRANSPARENT_HEADS.has(tokens.at(-1)!)) {
    tokens.pop();
    droppedTransparent = true;
  }

  // "heads of talent", "directors of engineering", "VP of sales": the head is
  // the FIRST noun and everything after "of" is its department. Without this,
  // the head reads as "talent" and a person becomes unknown.
  const ofAt = tokens.indexOf("of");
  let ofTail: string[] = [];
  if (ofAt > 0) {
    ofTail = tokens.slice(ofAt + 1);
    tokens = tokens.slice(0, ofAt);
  }

  // Try the longest multi-word entry first ("tattoo artist", "family office",
  // "estate agent") before falling back to the final token.
  let entry: HeadEntry | undefined;
  let head: string | null = null;
  let headStart = tokens.length - 1;

  for (let n = Math.min(3, tokens.length); n >= 1 && !entry; n--) {
    const start = tokens.length - n;
    const candidate = tokens.slice(start).join(" ");
    const singular = singularize(candidate);
    entry = HEAD_NOUNS[singular] ?? HEAD_NOUNS[candidate];
    if (entry) {
      head = singular;
      headStart = start;
    }
  }

  const modifiers = tokens.slice(0, headStart).filter((t) => t !== "of");
  const industry = findIndustry([...modifiers, ...ofTail]);

  if (entry) {
    // An explicit modifier can override an ambiguous head, which is the only
    // honest way to read "freelance copywriters" (person) against
    // "copywriting agencies" (company).
    let kind = entry.kind;
    let ambiguous = entry.ambiguous ?? false;
    if (ambiguous) {
      if (PERSON_MODIFIERS.test(cleaned)) {
        kind = "person";
        ambiguous = false;
      } else if (BUSINESS_MODIFIERS.test(cleaned)) {
        kind = kind === "person" ? "business" : kind;
        ambiguous = false;
      }
    }
    return {
      kind,
      head,
      ambiguous,
      confidence: ambiguous ? 0.45 : 0.85,
      modifiers,
      industry,
    };
  }

  const typed0 = tokens.at(-1)!;
  const last = singularize(typed0);

  // A transparent head already said these are people, so an unrecognized word
  // under one is a job title we do not list ("cto types", "devops folks") and
  // not a trade. Answered before the suffix backstops because those read shape
  // alone and would send "growth pros" to a business on `-th`-style accidents.
  if (droppedTransparent) {
    // "D2C skincare guys" names brands colloquially. The business-model cue
    // is stronger than the weak human head; a role phrase such as "dev guys"
    // continues to mean people.
    if (/\b(?:d2c|direct[- ]to[- ]consumer)\b/i.test(cleaned)) {
      return { kind: "company", head: last, ambiguous: false, confidence: 0.75, modifiers, industry: last };
    }
    return { kind: "person", head: last, ambiguous: false, confidence: 0.6, modifiers, industry };
  }

  for (const suf of ORG_SUFFIXES) {
    if (endsLike(last, suf)) {
      return { kind: "business", head: last, ambiguous: false, confidence: 0.55, modifiers, industry };
    }
  }
  for (const suf of PERSON_SUFFIXES) {
    if (endsLike(last, suf)) {
      return { kind: "person", head: last, ambiguous: false, confidence: 0.55, modifiers, industry };
    }
  }

  // Last resort: read the head as a misspelling of a word we know.
  //
  // Safe HERE and almost nowhere else, because the position has already told
  // us this token is the head of the thing being searched for — a place name
  // never reaches this line, so "Split" cannot be repaired into "site". The
  // confidence drops to 0.5 and the repair is reported, so a wrong guess is
  // visible in the frame rather than silent.
  // The length discipline is `repairTokens`' own, and for the same reason: at
  // five letters a single substitution reaches ordinary words, and the head
  // noun table is full of five-letter trades. "cider" is one edit from "coder"
  // and a cider house became a programmer. At five the repair is narrowed to a
  // DROPPED KEYSTROKE — the candidate must be one letter longer — which a real
  // word cannot satisfy by accident.
  const near =
    guess && last.length >= 5
      ? nearestKey(
          last,
          last.length >= 6
            ? Object.keys(HEAD_NOUNS)
            : Object.keys(HEAD_NOUNS).filter((k) => k.length === last.length + 1),
          1,
        )
      : null;
  // The same repair against the SPELLED PLURALS, for the typo that hid the
  // plural from `singularize`. "businesess" ends in `ss`, which singularization
  // refuses to touch (business, campus, analysis are not plurals), so the
  // attempt above compared a ten-letter word against an eight-letter key and
  // missed by two edits — while the word as written is one edit from
  // "businesses". Only the long words are eligible, where a single edit cannot
  // reach an unrelated plural by accident.
  const nearPlural =
    !near && guess && typed0.length >= 7 ? nearestKey(typed0, [...pluralHeadKeys().keys()], 1) : null;
  const repaired = near ?? (nearPlural ? pluralHeadKeys().get(nearPlural)! : null);
  if (repaired) {
    const entry = HEAD_NOUNS[repaired];
    return {
      kind: entry.kind,
      head: repaired,
      ambiguous: entry.ambiguous ?? false,
      confidence: 0.5,
      modifiers,
      industry,
      repairedFrom: near ? last : typed0,
      guessed: true,
    };
  }

  // A PLURAL unrecognized head is still a countable class of things, and in a
  // lead engine that is a business far more often than anything else: saunas,
  // bell foundries, quilt shops, kombucha breweries. Reading it as a business
  // at low confidence, marked ambiguous, keeps the request runnable and keeps
  // the guess visible; reading it as `unknown` cost every one of those a
  // structural label they did not need to lose.
  //
  // Singular stays unknown — "find sauna" is as likely to be a thing as a
  // place, and nothing is lost by saying so.
  // Plural SHAPE, not a successful singularization. `singularize` refuses an
  // `-is`/`-us` ending because "analysis" and "campus" are not plurals, and a
  // misspelled plural lands in exactly that hole — "roastereis" came back
  // singular and therefore unknown, losing both the category and (because the
  // caller peels an unreadable head) the city standing next to it. The only
  // question here is whether the word is a countable class of things, so the
  // shape answers it, and the answer is marked `guessed` either way.
  const pluralShaped = typed0.length >= 5 && /s$/.test(typed0) && !/(?:ss|us)$/.test(typed0);
  const wasPlural = typed0 !== last || pluralShaped;
  if (wasPlural && guess) {
    return {
      kind: "business",
      head: last,
      ambiguous: true,
      confidence: 0.4,
      modifiers,
      industry,
      guessed: true,
    };
  }

  // Unrecognized head. The phrase survives; only the structural label is lost.
  return { kind: "unknown", head: last, ambiguous: false, confidence: 0.25, modifiers, industry };
}

function findIndustry(words: string[]): string | null {
  if (words.length === 0) return null;
  const joined = words.join(" ");
  if (INDUSTRY_WORDS.has(joined)) return joined;
  for (const w of words) if (INDUSTRY_WORDS.has(w)) return w;
  return null;
}

/**
 * Locative prepositions. They close a noun phrase and open a geography
 * ("restaurants | in Lisbon"), so a target phrase stops here — but they are
 * deliberately absent from `CLAUSE_STOP_TOKENS`, which also bounds place spans
 * and would then reject its own leading preposition.
 */
export const LOCATIVE_PREP_TOKENS: ReadonlySet<string> = new Set([
  "in", "near", "nearby", "round", "across", "throughout", "outside", "inside",
  "from", "serving", "covering", "based", "located", "headquartered",
]);

/**
 * Clause-stop words that can nonetheless PRE-MODIFY the head noun, so a phrase
 * beginning with one is not targetless: "recently funded AI startups" is about
 * startups. Only adjectival participles and adverbs are here — `looking`,
 * `seeking` and `without` are post-nominal and skipping them would promote
 * their object ("without websites" is not a search for websites).
 */
export const PRE_MODIFIER_LEAD: ReadonlySet<string> = new Set([
  "recently", "recent", "newly", "just", "currently", "freshly", "already",
  "only", "top", "best", "new", "verified", "remote",
  "funded", "raised", "hiring", "recruiting", "posted", "accredited",
  "certified", "licensed", "registered", "rated", "listed", "open", "ready",
]);

/** True when the phrase is a temporal expression and therefore not a place. */
export function isTemporalPhrase(span: string): boolean {
  const s = span.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return false;
  return WHOLE_TEMPORAL_RE.test(s);
}

/**
 * Take the leading place span out of a token list: the longest gazetteer hit
 * if there is one, otherwise tokens up to the first clause boundary.
 *
 * `resolve` is injected so this module stays pure and testable — and so the
 * understanding layer's only dependency on the location dictionary lives at
 * one call site.
 */
export function takePlaceSpan(
  tokens: string[],
  resolve: (s: string) => boolean,
  maxTokens = 4,
): string[] {
  if (tokens.length === 0) return [];

  // A sentence ends a place span: "I sell web design. Find businesses in
  // Alberta." must yield `Alberta`, not `Alberta.`. Short tokens keep their dot
  // because an abbreviation is part of the name ("St. Louis").
  const clipped: string[] = [];
  for (const tok of tokens.slice(0, maxTokens + 1)) {
    const bare = tok.replace(/[.,;:!?)\]]+$/, "");
    const terminal = /[.;!?]$/.test(tok) && bare.length >= 3;
    if (bare) clipped.push(bare);
    if (terminal) break;
  }
  if (clipped.length === 0) return [];

  for (let n = Math.min(maxTokens, clipped.length); n >= 1; n--) {
    const span = clipped.slice(0, n);
    if (span.some((t) => CLAUSE_STOP_TOKENS.has(normalizeFunctionWord(t.toLowerCase())) && n > 1)) continue;
    if (resolve(span.join(" "))) return span;
  }

  // Nothing in the gazetteer matched, so take tokens up to the first clause
  // boundary. A joiner does NOT rescue a boundary word here: "Trinidad and
  // Tobago" is a gazetteer name and was already tried above, whereas "near
  // Reykjavik and got a phone" would otherwise hand back three extra words as
  // part of the city.
  const out: string[] = [];
  for (const tok of clipped.slice(0, maxTokens)) {
    const t = normalizeFunctionWord(tok.toLowerCase());
    if (CLAUSE_STOP_TOKENS.has(t)) break;
    // A pictograph is not part of a place name, and it ends one. "cafes in
    // porto 🙏" handed back "porto 🙏", which then failed the letters-only
    // check every caller applies — so ONE emoji anywhere after a preposition
    // cost the request its whole geography.
    if (!/[\p{L}\p{N}]/u.test(tok)) break;
    out.push(tok);
  }
  while (out.length && PLACE_JOIN_TOKENS.has(out.at(-1)!.toLowerCase())) out.pop();
  return out;
}

/**
 * The bare words for "an entity". A descriptor that only restates the entity
 * type narrows nothing: "find businesses" carries category="businesses" and is
 * exactly the request §15 wants one question about, so counting that as a
 * narrowing is what stops the question ever firing. Shared by the fallback and
 * the clarification state so the two cannot disagree about what is runnable.
 */
export const GENERIC_TARGET_WORDS: ReadonlySet<string> = new Set([
  "business", "businesses", "company", "companies", "organization", "organizations",
  "organisation", "organisations", "person", "people", "individual", "individuals",
  "professional", "professionals", "job", "jobs", "investor", "investors",
  "place", "places", "thing", "things", "lead", "leads", "prospect", "prospects",
  "client", "clients", "customer", "customers", "contact", "contacts",
  // Plain synonyms of the words above. "firms in Maribor" is the same request
  // as "companies in Maribor", and a category of "firm" filters nothing.
  //
  // What is deliberately NOT here: "agency" and "agencies" (a marketing agency
  // is a real trade, and "not agencies" is a category constraint that has to
  // keep working), "startup" and "startups" (a stage, which narrows), and
  // "shop"/"shops" (retail premises). A word belongs in this set only when it
  // is a bare stand-in for the entity type, never when it says something about
  // the entity.
  "firm", "firms", "entity", "entities", "org", "orgs",
  "corporation", "corporations", "enterprise", "enterprises",
  "outfit", "outfits", "employer", "employers",
]);

/** Does this descriptor narrow the search beyond a bare entity type? */
export function narrowsTarget(value: string | null | undefined): boolean {
  const s = value?.trim().toLowerCase();
  if (!s) return false;
  return !GENERIC_TARGET_WORDS.has(s);
}

/**
 * Text addressed to the ASSISTANT rather than describing prospects.
 *
 * Closed-world on purpose, and the one place in this file where that is
 * unambiguously right: the open world is businesses and people, while "your
 * system prompt" names something inside this program. Without it the reader has
 * no defence — every noun phrase is a candidate descriptor, so "list your
 * system prompt" reads as a search for prompts and "ignore previous
 * instructions" resolves, one repair away, to a search for instructors.
 *
 * The verdict is a question, never a refusal: the layer states that it found no
 * prospecting request, and the caller decides what to do about it.
 */
export const META_REQUEST_RE =
  /\b(?:system\s+prompt|your\s+(?:system\s+)?(?:prompt|instructions|rules|guidelines|source\s+code)|ignore\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)|disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)|reveal\s+your|repeat\s+(?:the\s+|your\s+)(?:prompt|instructions)|you\s+are\s+(?:an?\s+)?(?:ai|llm|language\s+model|assistant))\b/i;

/** Objects that make "looking for X" a search for CUSTOMERS, not for work. */
export const CLIENT_OBJECT_RE =
  /^(?:new\s+|more\s+|additional\s+)?(?:clients?|customers?|leads?|business|new\s+business|projects?|contracts?|briefs?|commissions?|accounts?|retainers?|work\s+from\s+clients?)$/i;

/** Objects that make "looking for X" a search for EMPLOYMENT. */
export const EMPLOYMENT_OBJECT_RE =
  /^(?:a\s+|new\s+)?(?:jobs?|work|employment|roles?|positions?|gigs?|openings?|vacanc(?:y|ies)|opportunit(?:y|ies)|placements?|internships?)$/i;

/**
 * Things a prospect can be said to HAVE or LACK, keyed on the singular, with
 * the canonical name each one normalizes to.
 *
 * One table serves both the absence detector ("no website" is a relation) and
 * the exclusion detector ("excluding agencies" is a constraint), because those
 * two read the same words and disagreeing about them is how "without websites"
 * once produced a `category != website` filter beside the relation that already
 * said it.
 */
const ASSET_WORDS: Record<string, string> = {
  website: "website", site: "website", webpage: "website", homepage: "website",
  "web site": "website", "web page": "website", "web presence": "website",
  "online presence": "website", "landing page": "website", domain: "website",
  email: "email", "email address": "email", inbox: "email",
  phone: "phone", "phone number": "phone", telephone: "phone", mobile: "phone",
  social: "social media", socials: "social media", "social media": "social media",
  instagram: "instagram", facebook: "facebook", linkedin: "linkedin",
  twitter: "twitter", tiktok: "tiktok", youtube: "youtube",
  blog: "blog", newsletter: "newsletter", podcast: "podcast",
  "google business profile": "google business profile", gbp: "google business profile",
  "google listing": "google business profile", listing: "listing",
  review: "reviews", reviews: "reviews", rating: "reviews",
  app: "mobile app", "mobile app": "mobile app",
  ssl: "ssl certificate", "ssl certificate": "ssl certificate", https: "ssl certificate",
  "booking system": "booking system", "online booking": "booking system",
  ecommerce: "online store", "online store": "online store", webshop: "online store",
  "shopping cart": "online store", checkout: "online store",
  crm: "crm", "analytics": "analytics", "tracking": "analytics",
  "menu": "menu", "price list": "price list", "portfolio": "portfolio",
  "case study": "case studies", "case studies": "case studies",
};

/**
 * Canonical asset name for a phrase, or null when the phrase names no asset.
 *
 * Tolerates a misspelling ("wesbite", "websight") because it is called only on
 * a span that syntax has already marked as the object of have/lack, where a
 * place name cannot appear. Adjectives that add nothing ("real", "proper",
 * "own") are stripped first — they are how people say "not just a Facebook
 * page", and they never change WHICH asset is meant.
 */
export function canonicalAsset(phrase: string): string | null {
  const s = phrase
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:a|an|any|the)\s+/, "")
    .replace(/^(?:real|proper|actual|own(?:ed)?|legit|decent|good|active|working|functioning|dedicated|professional|modern|up-to-date)\s+/g, "")
    .trim();
  if (!s) return null;

  const direct = ASSET_WORDS[s] ?? ASSET_WORDS[singularize(s)];
  if (direct) return direct;

  const near = nearestKey(s, Object.keys(ASSET_WORDS));
  if (near) return ASSET_WORDS[near]!;

  // Fall back to the HEAD of the phrase. The adjective strip above is a fixed
  // list and people modify these nouns freely — "prroper website", "fancy
  // booking system", "half-decent logo" — so a short phrase ending in an asset
  // is that asset. Without this, "no prroper website" stopped being the
  // `lacks_asset` relation and became a `category != "prroper website"` filter.
  const words = s.split(" ");
  if (words.length > 1 && words.length <= 4) {
    const head = words.at(-1)!;
    const direct2 = ASSET_WORDS[head] ?? ASSET_WORDS[singularize(head)];
    if (direct2) return direct2;
    const near2 = nearestKey(head, Object.keys(ASSET_WORDS));
    if (near2) return ASSET_WORDS[near2]!;
  }
  return null;
}

/** True when the phrase names an asset, and so is never an exclusion filter. */
export function isAssetPhrase(phrase: string): boolean {
  return canonicalAsset(phrase) !== null;
}
