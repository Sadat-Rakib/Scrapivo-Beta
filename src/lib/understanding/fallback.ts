/**
 * Understanding Engine — deterministic fallback extractor.
 *
 * Runs when the LLM is unconfigured, unreachable, or returns something the
 * schema rejects twice. It emits an UnderstandingFrame DIRECTLY and never calls
 * the legacy `extractSearchSpec` — that function's notion of intent has no
 * direction, so wiring it in here would reintroduce the exact confusion the
 * frame exists to prevent, on the path that runs when the good path is broken.
 * What is reused instead are the narrow helpers underneath it: role
 * normalization and location resolution.
 *
 * ── The one architectural idea ────────────────────────────────────────────
 *
 * Spans are assigned EXCLUSIVELY. The first version of this file ran every
 * detector over the whole sentence independently, and the result was the
 * failure that dominated the first grading report: two detectors claiming the
 * same words.
 *
 *   "around Trondheim trying to hire embedded engineers right now"
 *        -> location = "Trondheim trying to hire embedded engineers right now"
 *   "posted a marketing role in the last two weeks"
 *        -> location = "the last two weeks", temporal = empty
 *   "companies interested in seo"
 *        -> location = "seo"
 *
 * None of those are location bugs. They are the absence of a rule about who
 * owns a word. So the pass below consumes the sentence in one direction, and
 * every detector MASKS what it took:
 *
 *   user context -> quantity -> temporal -> deliverables cut
 *      -> target phrase -> relation clause -> location -> constraints
 *
 * A masked span is replaced by `|`, which is a hard boundary for everything
 * downstream. That is why the location parser cannot see a relation object: by
 * the time it runs, the relation already owns those words.
 *
 * ── The second idea: precision over recall ────────────────────────────────
 *
 * A deterministic guess that is wrong is worse than an honest `unknown`,
 * because the guess looks like understanding. But `unknown` is not the answer
 * to a plain request either: "restaurants in Lisbon" asks for no relationship,
 * and `relation = none` states that with full confidence. Asking "what should
 * be true of the restaurants?" is this layer failing to read plain English, not
 * being careful.
 */

import { knownCityName, resolveCanonicalLocation } from "@/lib/search/location-resolver";
import { normalizeRole } from "@/lib/search/search-spec-extract";
import {
  clamp,
  emptyFrame,
  openValue,
  RAW_MAX,
  UnderstandingFrameSchema,
  type Constraint,
  type FrameLocation,
  type OpenValue,
  type Quantity,
  type UnderstandingFrame,
  type UserContext,
} from "./frame";
import {
  activityToken,
  ACTIVITY_VERB_TOKENS,
  canonicalAsset,
  classifyHead,
  CLAUSE_STOP_TOKENS,
  CLIENT_OBJECT_RE,
  EMPLOYMENT_OBJECT_RE,
  EXCLUSION_CUE_RE,
  isAssetPhrase,
  isShouted,
  isTemporalPhrase,
  LOCATIVE_PREP_TOKENS,
  META_REQUEST_RE,
  narrowsTarget,
  NEAR_SCOPE_CUE_RE,
  normalizeFunctionWord,
  PRE_MODIFIER_LEAD,
  PREFERRED_MARKER_RE as PREFERRED_MARKER,
  RELATION_SIGNAL_RE,
  repairTokens,
  singularize,
  takePlaceSpan,
  type HeadClassification,
} from "./lexicon";
import {
  canonicalize,
  DELIVERABLE_FIELD_PATTERNS,
  EVIDENCE_BY_RELATION,
  expandPhrases,
  MODE_BY_RELATION,
  type ClarificationReason,
  type EntityType,
  type ProspectingMode,
  type RelationType,
  type TemporalRelation,
} from "./vocab";

// ── Text preparation ──────────────────────────────────────────────────────

/** The mask character. Not a word, not a place, a hard boundary everywhere. */
const MASK = " | ";

function prep(raw: string): { text: string; repairs: Array<{ from: string; to: string }> } {
  const { text, repairs } = repairTokens((raw ?? "").replace(/\s+/g, " ").trim());
  return { text: stripOpeners(expandPhrases(text)), repairs };
}

/**
 * Conversational openers, stripped from the FRONT of the request only.
 *
 * Real requests arrive wrapped in address and politeness — "ok so", "yo",
 * "can u get me", "gimme", "pls", "help me find" — and several of those words
 * are clause-stop tokens, so a request beginning with one left the target
 * detector with nothing to read and the whole frame came back targetless. This
 * is a separate pass from `LEAD_VERB_PREFIX_RE` (which strips the single
 * imperative verb) because openers STACK: "ok so can u get me some..." is
 * three layers, and one regex pass peels one.
 *
 * Front-anchored and loop-bounded on purpose. The same words mid-sentence are
 * load-bearing — "businesses that need help" must keep its `need`.
 */
const OPENER_RE =
  /^(?:\s*(?:ok(?:ay)?|so|well|right|hey|hi|hello|yo|sup|pls|plz|please|thanks|thx|um+|uh+|hmm+|alright|dude|mate|bro|listen|look)\b[\s,.!?:-]*)+/i;

const POLITE_REQUEST_RE =
  /^(?:\s*(?:can|could|would|will)\s+(?:you|u|ya)\s+(?:please\s+|pls\s+|plz\s+)?(?:get|give|find|fetch|pull|send|show|list|grab|dig\s+up|scrape)?\s*(?:me|us)?\s*)+/i;

const WANT_LEAD_RE =
  /^(?:\s*(?:(?:i|we|im|iam|ive|imma|ima|were)\s*(?:'m|'d|'ll|'ve|\s+am|\s+are|\s+would)?\s*)?(?:just\s+)?(?:really\s+)?(?:want|wanna|need|needin|needing|require|after|tryna|trying\s+to|looking\s+to|like\s+to|hoping\s+to)\s+(?:to\s+)?(?:find|get|see|source|build|have)?\s*(?:me|us)?\s*)+/i;

function stripOpeners(text: string): string {
  let s = text;
  for (let pass = 0; pass < 4; pass++) {
    const before = s;
    s = s.replace(OPENER_RE, "");
    s = s.replace(POLITE_REQUEST_RE, "");
    s = s.replace(WANT_LEAD_RE, "");
    s = s.trimStart();
    if (s === before) break;
    // Never strip the request down to nothing: an opener that IS the whole
    // message ("hey") is the message, and an empty frame says less than a
    // targetless one.
    if (!s.trim()) return before;
  }
  return s.trim() ? s : text;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter((t) => t && t !== "|");
}

/** Replace one span with the mask, preserving the rest byte-for-byte. */
function mask(text: string, start: number, end: number): string {
  return text.slice(0, start) + MASK + text.slice(end);
}

function clean(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s'/&.+#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The singular of a descriptor, for the `normalized` slot. The user's own
 * plural stays in `value`/`raw` — this is the form a matcher wants, and it
 * singularizes the HEAD rather than the last word, because "heads of talent"
 * is one head of talent and not one "heads of talents".
 */
function singularPhrase(phrase: string, head: string | null, repairedFrom?: string): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return phrase.toLowerCase();

  // The head was repaired from a misspelling, so the word standing in the
  // phrase is the typo. Matching on the singular below cannot find it —
  // "foundders" does not singularize to "founder" — and the normalized form
  // would keep the typo the classifier already saw through.
  if (head && repairedFrom) {
    const typo = repairedFrom.toLowerCase();
    for (let i = 0; i < words.length; i++) {
      const bare = words[i]!.replace(/[^\p{L}\p{N}'/-]/gu, "").toLowerCase();
      if (bare === typo) {
        words[i] = head;
        return words.join(" ").toLowerCase();
      }
    }
  }

  if (head) {
    const target = head.toLowerCase();
    for (let i = 0; i < words.length; i++) {
      const bare = words[i]!.replace(/[^\p{L}\p{N}'/-]/gu, "");
      const one = singularize(bare);
      if (one.toLowerCase() === target && one !== bare) {
        words[i] = one;
        return words.join(" ").toLowerCase();
      }
    }
  }
  words[words.length - 1] = singularize(words.at(-1)!);
  return words.join(" ").toLowerCase();
}

/**
 * A provenance span, bounded. Spans taken from the input can be as long as the
 * input is — one 500-character word is a single head noun — and a frame that
 * fails its own schema is a 500 in the inspector rather than a bad answer.
 */
function span(s: string | null | undefined): string | null {
  if (s == null) return null;
  const c = clamp(s, RAW_MAX);
  return c || null;
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, fifty: 50,
  hundred: 100, few: 3, couple: 2,
};

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const word = NUM_WORDS[s.replace(/\s+of$/, "").toLowerCase()];
  if (word) return word;
  const n = Number(s.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ── User context ──────────────────────────────────────────────────────────
//
// "I sell website design. Find me 100 local businesses in Alberta" does NOT
// mean those businesses need website design. Conflating the two asserts a need
// nobody demonstrated, and every later qualification step would hunt for
// evidence of it and find none. So the searcher's own sentence is lifted out
// BEFORE anything else reads the text.

const SELLING_RE =
  /\b(?:i|we)\s*(?:'m|'re|\s+am|\s+are)?\s*(?:a|an)?\s*(sell|selling|offer|offering|provide|providing|do|doing|run|running|specialize\s+in|specialise\s+in|build|building|make|making)\s+([^.;!?]{3,90})/i;

const OBJECTIVE_RE =
  /\b(?:i|we)\s*(?:'m|'re|\s+am|\s+are)?\s*(?:trying\s+to|looking\s+to|want\s+to|need\s+to|hoping\s+to)\s+([^.;!?]{3,90})/i;

const PRODUCT_WORDS =
  /\b(app|apps|software|saas|product|products|tool|tools|platform|device|devices|hardware|widget|widgets|plugin|theme|course|book)\b/i;

/**
 * The request clause starts at an explicit imperative. Everything before it is
 * the searcher talking about themselves — a general rule, so it works for
 * wording nobody wrote a regex for.
 */
const REQUEST_START_RE =
  /\b(?:find|get|pull|list|fetch|gimme|give\s+me|show\s+me|send\s+me|return|generate|build\s+me)\b/i;

/**
 * Where the searcher stops describing themselves.
 *
 * The selling clause is captured as "everything up to the next sentence
 * break", and casual writing has none: "i do food safety auditing n im tryna
 * find seed libraries around aarhus" is one sentence, so the pitch swallowed
 * the request and the frame reported that the user sells seed libraries in
 * Aarhus. A fresh first-person subject or an imperative is the boundary a
 * full stop would have been.
 */
const SELLING_END_RE =
  /\s*[,;]\s*|\s+(?:(?:n|and|but|so|then|plus)\s+)?(?:i|we)\s*(?:'m|'d|'ll|'ve|\s+am|\s+are|\s+need|\s+want|\s+would)\b|\s+(?:(?:n|and|but|so|then|plus)\s+)?(?:im|iam|ive|ima|imma|were)\b|\s+(?:tryna|trying\s+to|looking\s+to|hoping\s+to|wanna|want\s+to|need\s+to|need|needs|want|after)\b|\s+(?:find|get|pull|list|fetch|gimme|give\s+me|show\s+me|send\s+me)\b/i;

/**
 * Everything before the pitch is address and politeness and nothing else —
 * "gimme ok so i do waste haulage n im tryna find…".
 *
 * This is what distinguishes the searcher describing themselves from a
 * PROSPECT attribute: "companies that do waste haulage" has a noun in front of
 * the verb, and a noun is exactly what this refuses to match. Opening the
 * message and opening the message after two filler words are the same signal.
 */
const FILLER_ONLY_PREFIX_RE =
  /^(?:[\s,.;:!?-]*\b(?:ok(?:ay)?|so|well|right|hey|hi|hello|yo|sup|um+|uh+|hmm+|alright|dude|mate|bro|listen|look|pls|plz|please|thanks|thx|help|helping|gimme|give|show|send|find|get|pull|list|fetch|grab|me|us|can|could|would|you|u|i|we|im|iam|just|really|need|needs|want|wanna|tryna|trying|looking|hoping|to|for|some|a|an|the|like|and|n)\b[\s,.;:!?-]*)*$/i;

function detectUserContext(text: string): { context: UserContext; analysis: string } {
  const context: UserContext = { selling: null, objective: null, notes: [] };
  let analysis = text;

  const request = REQUEST_START_RE.exec(text);
  const preamble = request && request.index > 0 ? text.slice(0, request.index).trim() : "";

  const sell = SELLING_RE.exec(text);
  // Where the pitch actually ends in the original text — the capture may have
  // been clipped, and cutting the full match out would take the request with it.
  let sellEnd = sell ? sell.index + sell[0].length : -1;
  if (sell) {
    // A bare "we do X" inside the request clause is usually the PROSPECT's
    // attribute ("companies that do X"), not the searcher's. Only accept the
    // weak verbs when they sit in the preamble.
    const weakVerb = /^(do|doing|run|running|make|making|build|building)$/i.test(sell[1]);
    const inPreamble = preamble.length > 0 && sell.index < (request?.index ?? 0);
    // Opening the whole message is the same signal as sitting in a preamble,
    // and it is the form casual writing uses when there is no imperative to
    // find: "i do waste haulage, need facilities managers in Kaunas". A
    // prospect's attribute never occupies the first character of a request.
    const opensRequest =
      sell.index === 0 || FILLER_ONLY_PREFIX_RE.test(text.slice(0, sell.index));
    if (!weakVerb || inPreamble || opensRequest) {
      const stop = SELLING_END_RE.exec(sell[2]);
      if (stop) sellEnd = sell.index + sell[0].length - sell[2].length + stop.index;
      const what = clean(stop ? sell[2].slice(0, stop.index) : sell[2])
        // "website services to local businesses" — the audience is not the
        // thing being sold, and it is often the target, so it stays in the text.
        .replace(/\s+(?:to|for)\s+.*$/i, "")
        .replace(/\s+(?:because|since|so)\b.*$/i, "")
        // A dangling joiner is what is left when the boundary was the word
        // after it: "iso certification n" is not a thing anyone sells.
        .replace(/\s+(?:n|and|but|so|then|plus|&)$/i, "")
        .trim();
      if (what.length > 2) {
        // The pitch ends where the request begins, and `sell[0]` reaches past
        // that: its tail group is greedy. Quoting the whole match back would
        // attribute the user's search to their sales line.
        const rawSell = text.slice(sell.index, sellEnd).replace(/[\s,;.]+$/, "");
        const v = openValue(what.toLowerCase(), rawSell, canonicalize(what), 0.75);
        context.selling = PRODUCT_WORDS.test(what)
          ? { service: null, product: v }
          : { service: v, product: null };
        context.notes.push(openValue(clean(rawSell), rawSell, null, 0.7));
      }
    }
  }

  const obj = OBJECTIVE_RE.exec(text);
  if (obj) {
    const what = clean(obj[1]);
    if (what.length > 2) context.objective = openValue(what.toLowerCase(), obj[0], null, 0.6);
  }

  // Analysis text: prefer the imperative clause when there is one, otherwise
  // cut the selling clause out. Either way the semantic parse never sees the
  // searcher's pitch.
  //
  // The imperative that opens the REQUEST is the first one standing after the
  // pitch. "I sell X. Find me Y" puts it there, but "help me find ok so i do
  // packaging design n im tryna find board game cafés" opens with one too, and
  // slicing from that leaves the pitch in the text the parser reads — which is
  // how a plain café request came back with no target at all.
  const afterPitch = sellEnd > 0 ? REQUEST_START_RE.exec(text.slice(sellEnd)) : null;
  const requestStart = afterPitch
    ? sellEnd + afterPitch.index
    : request && (sellEnd < 0 || request.index > sellEnd)
      ? request.index
      : -1;
  if (requestStart > 0 && (context.selling || context.objective)) {
    analysis = text.slice(requestStart);
  } else if (context.selling && sell) {
    const head = text.slice(0, sell.index);
    // Address and politeness in front of the pitch is not part of the request
    // — keeping it leaves the target scan reading "ok" as the kind of thing to
    // find. A prefix carrying any content word is kept, because it may hold
    // the target ("dentists — i do waste haulage — in Kaunas" is nobody's
    // sentence, but a clause we cannot read is not ours to delete).
    const before = FILLER_ONLY_PREFIX_RE.test(head)
      ? ""
      : head.replace(/\b(?:because|since|as|so\s+that|cause|cuz)\s*$/i, "");
    analysis = `${before} ${text.slice(sellEnd)}`
      .replace(/\s+/g, " ")
      // The clause ended AT its punctuation or at the joiner that introduced
      // the request, so the request now begins with one of them. Neither is a
      // word, but both reach the target scan as one — "and im trying to find
      // prosthetics labs" left the lead-verb strip with nothing to match and
      // the target unread.
      .replace(/^(?:[\s,;.]|\b(?:and|n|but|so|then|plus|also|&)\b)+/i, "")
      .trim();
  }

  // A stated use for the results belongs to user context, not the target or
  // exclusion filters. Keep the original wording in input.raw for provenance.
  if (/\bresearch\s+only\s*:/i.test(text) || /\bno\s+outreach\b/i.test(text)) {
    context.objective = openValue("research", "research only / no outreach", "research", 1);
    analysis = analysis.replace(/\bresearch\s+only\s*:\s*/i, "").replace(/[,;]?\s*\bno\s+outreach\b/gi, "").trim();
  }
  return { context, analysis: analysis || text };
}

// ── Deliverables cut ──────────────────────────────────────────────────────
//
// A long prompt is a core request followed by a list of deliverables. The core
// semantics (target / relation / location) all live before the first
// deliverable clause, so everything after it is cut away for that pass — and
// then read separately for required/preferred/verification/output.

const DELIVERABLE_CUT_RE =
  /(?:[,;.]|\band\b)\s*(?=(?:phone|phones|email|emails|socials?|social\s+media|instagram|insta|ig|facebook|fb|linkedin|twitter|reviews?|ratings?|opening\s+hours|hours|address(?:es)?|owner|owners|verify|verified|confirm|double-?check|make\s+sure|prove|include|including|output|export|give\s+me|gimme|send|return|prefer(?:ably)?|ideally|bonus|optional|if\s+possible|if\s+available|nice\s+to\s+have|must\s+have|required|contact\s+info|contacts?|evidence|proof|source|(?:pull|scrape|grab|get|fetch|extract|collect|gather|note|add|append|attach)\s)\b)/i;

function coreSegment(text: string): { core: string; tail: string } {
  const contactAsk = /\b(?:need|want)\s+(?:the\s+|their\s+)?(?:emails?|phone|nums|socials?|contact\s+(?:details|info))\b/i.exec(text);
  if (contactAsk && contactAsk.index >= 8) {
    return { core: text.slice(0, contactAsk.index).trim(), tail: text.slice(contactAsk.index).trim() };
  }
  const m = DELIVERABLE_CUT_RE.exec(text);
  if (!m || m.index < 8) return { core: text, tail: "" };
  return { core: text.slice(0, m.index).trim(), tail: text.slice(m.index).trim() };
}

// ── Quantity ──────────────────────────────────────────────────────────────
//
// "50" and "at least 50" and "up to 50" are three different asks, and the
// difference decides when a run may stop. The hard part is not the numbers, it
// is NOT stealing them: "at least 100 employees" and "within 15 km" and "4.5
// stars" and "under $150/hour" are all filters, not counts. The unit that
// follows the number is what tells them apart.

const UNIT_AFTER_NUMBER =
  /^(?:employees?|staff|headcount|team|members?|seats?|km|kms|kilometer?s?|mi|miles?|m|meters?|ft|sqft|stars?|reviews?|followers?|percent|%|usd|dollars?|eur|gbp|k|hours?|hrs?|hr|days?|weeks?|months?|quarters?|years?|yrs?|yr|am|pm|people\s+minimum)$/i;

const QUANTITY_UNLIMITED_RE =
  /\b(?:every(?:thing)?\s+you\s+can\s+find|all\s+(?:of\s+)?(?:them|you\s+can\s+find)|unlimited|no\s+limit|max\s+out)\b/i;

/**
 * "as many X as possible" wraps the target rather than sitting beside it, so
 * the two halves are masked separately. Matching it as one span was what left
 * "as many kombucha breweries as possible" with no target at all.
 */
const QUANTITY_UNLIMITED_WRAP_RE =
  /\bas\s+many\b([\s\S]{0,80}?)\bas\s+(?:possible|(?:you|u|ya|yall|we|i)\s+can(?:\s+find|\s+get|\s+manage)?)\b/i;

const QUANTITY_RE = new RegExp(
  [
    // "20-30 hvac companies" — a dash range of counts, before a letter (so a
    // phone fragment or score never reads as a quantity). Without this the
    // bare-number rule took the "30" of "20-30" and left "20-" glued to the
    // target noun, which made the whole phrase unreadable.
    String.raw`\b(\d{1,5})\s*[-–—]\s*(\d{1,5})\b(?!\s*\+)\s*(?=[\p{L}])`,
    // "at least 25" / "minimum of 30" / "no fewer than 10"
    String.raw`\b(at\s+least|minimum(?:\s+of)?|min|no\s+fewer\s+than|no\s+less\s+than)\s+(\d{1,5}|one|two|three|four|five|ten|twenty|thirty|fifty|hundred)\b`,
    // "up to 50" / "no more than 50" / "max 50"
    String.raw`\b(up\s+to|no\s+more\s+than|max(?:imum)?(?:\s+of)?|at\s+most)\s+(\d{1,5})\b`,
    // "around 20" / "about 20" / "~20" / "roughly 20"
    String.raw`\b(around|about|roughly|approximately|circa|~)\s*(\d{1,5})\b`,
    // "100+" / "50 +"
    String.raw`\b(\d{1,5})\s*\+`,
    // bare "50" — accepted only when a lead verb or the target noun is beside
    // it, and rejected when a unit follows.
    // The `(?!\s*\+)` on both is what keeps "Find me 100+" out of these: a
    // leftmost match wins in an alternation, so without it "Find me 100" was
    // read as an exact count and the stray "+" was left where the target noun
    // should have been.
    String.raw`\b(?:find|get|give\s+me|gimme|show\s+me|send\s+me|pull|list|need|want|return|top|first)\s+(?:me\s+)?(\d{1,5})\b(?!\s*\+)`,
    String.raw`\b(\d{1,5})\b(?!\s*\+)\s+(?=[\p{L}])`,
  ].join("|"),
  "iu",
);

function detectQuantity(text: string): { quantity: Quantity | null; text: string } {
  const unlimited = (raw: string, next: string): { quantity: Quantity; text: string } => ({
    quantity: {
      requested: null,
      minimum: null,
      maximum: null,
      unlimited: true,
      approximate: false,
      raw,
    },
    text: next,
  });

  // "as many as you can" is masked FIRST — it wraps the target noun, and
  // leaving it standing costs the target its phrase — but it is only ANSWERED
  // last. A request carrying both a number and this phrase ("find me 20 …
  // as many as u can") states a count and then encourages effort; reading it
  // as unlimited threw the stated 20 away. So the reading is held aside and
  // the number scan runs on the masked text: an explicit count wins, and the
  // phrase is what the frame says only when no number was given.
  let openEnded: { quantity: Quantity; text: string } | null = null;

  const wrap = QUANTITY_UNLIMITED_WRAP_RE.exec(text);
  if (wrap && !wrap[1]?.trim()) {
    // "…as many as u can" — nothing wrapped, so it is one span. Splitting it
    // searched for the middle with `indexOf`, which on a blank middle matched
    // the space inside "as many" and masked the wrong half of the phrase.
    openEnded = unlimited(wrap[0].trim(), mask(text, wrap.index, wrap.index + wrap[0].length));
  } else if (wrap) {
    const head = wrap[0].indexOf(wrap[1] ?? "");
    const middleStart = wrap.index + (head > 0 ? head : wrap[0].length);
    const middleEnd = middleStart + (wrap[1]?.length ?? 0);
    // Right-to-left: masking the tail first keeps the head's offsets valid.
    let next = mask(text, middleEnd, wrap.index + wrap[0].length);
    next = mask(next, wrap.index, middleStart);
    openEnded = unlimited(wrap[0].trim(), next);
  } else {
    const m = QUANTITY_UNLIMITED_RE.exec(text);
    if (m) openEnded = unlimited(m[0], mask(text, m.index, m.index + m[0].length));
  }

  if (openEnded) text = openEnded.text;

  const re = new RegExp(QUANTITY_RE.source, "giu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [rangeMin, rangeMax, minWord, minNum, maxWord, maxNum, apxWord, apxNum, plusNum, verbNum, bareNum] =
      m.slice(1);

    // A currency amount can contain a shorter digit match ("$120,000" used
    // to yield a requested count of zero from its final three digits).
    const before = text.slice(0, m.index);
    const following = text.slice(m.index + m[0].length);
    if (/(?:[$€£]\s*|\d,)$/.test(before) || /^,\d/.test(following) || /^\d/.test(following)) continue;

    // Reject when what follows the number is a unit — that is a filter.
    const after = text.slice(m.index + m[0].length).trim().split(/\s+/)[0] ?? "";
    const tail = singularize(after.replace(/[^\p{L}\p{N}%]/gu, ""));
    const isPlus = !!plusNum;
    if (!isPlus && tail && UNIT_AFTER_NUMBER.test(tail)) continue;
    // "in the last 2 weeks" is temporal; the temporal pass runs first and masks
    // it, so a surviving number preceded by last/past is a leftover to skip.
    if (/\b(?:last|past|previous|next|within)\s*$/i.test(text.slice(0, m.index))) continue;

    const q: Quantity = {
      requested: null,
      minimum: null,
      maximum: null,
      unlimited: false,
      approximate: false,
      raw: m[0].trim(),
    };
    if (rangeMin) {
      q.minimum = toNumber(rangeMin);
      q.maximum = toNumber(rangeMax);
    } else if (minWord) q.minimum = toNumber(minNum);
    else if (maxWord) q.maximum = toNumber(maxNum);
    else if (apxWord) {
      q.requested = toNumber(apxNum);
      q.approximate = true;
    } else if (isPlus) q.minimum = toNumber(plusNum);
    else q.requested = toNumber(verbNum ?? bareNum);

    if ((q.requested ?? q.minimum ?? q.maximum ?? 0) <= 0) continue;
    return { quantity: q, text: mask(text, m.index, m.index + m[0].length) };
  }
  return openEnded ?? { quantity: null, text };
}

// ── Temporal ──────────────────────────────────────────────────────────────
//
// A temporal phrase is NEVER a place. It is masked here, before location runs,
// which is the whole fix for "posted a marketing role in the last two weeks"
// reading "the last two weeks" as geography.

/**
 * Every spelling of a window unit, and the one character the frame stores.
 *
 * `TemporalSchema.window` documents the normalized form ("30d" / "6w" / "3m")
 * and enforces only a string, so an LLM answered "in the last 2 months" as
 * `2m` and "from the last month" as `1mo` — one unit, two spellings, and any
 * reader doing date arithmetic has to guess which it got. The full words are
 * what `TEMPORAL_WINDOW_RE` captures; the abbreviations exist for the
 * validator, which re-keys a model's window through the same table so the two
 * extractors cannot name one month two ways.
 */
const UNIT_CHAR: Record<string, string> = {
  d: "d", day: "d",
  w: "w", wk: "w", week: "w",
  m: "m", mo: "m", mon: "m", mth: "m", month: "m",
  q: "q", qtr: "q", quarter: "q",
  y: "y", yr: "y", year: "y",
};

/**
 * "1mo" → "1m". Null when nothing recognizable is in there: an unknown unit is
 * left exactly as the extractor wrote it, because inventing a unit would date
 * a request the user never dated.
 */
export function canonicalWindow(window: string | null | undefined): string | null {
  const m = /^\s*(\d{1,3})?\s*([a-z]+)\s*$/i.exec(window ?? "");
  if (!m) return null;
  const unit = UNIT_CHAR[m[2]!.toLowerCase().replace(/s$/, "")];
  return unit ? `${m[1] ? Number.parseInt(m[1], 10) : 1}${unit}` : null;
}

const TEMPORAL_WINDOW_RE =
  /\b(?:(?:in|over|during|within|for|from)\s+)?(?:the\s+)?(last|past|previous|recent)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|couple(?:\s+of)?)?\s*(day|week|month|quarter|year|yr)s?\b/i;

const TEMPORAL_POINT_RE =
  /\b(right\s+now|rn|now|today|tonight|currently|at\s+the\s+moment|asap|as\s+soon\s+as\s+possible|immediately|recently|lately|just\s+now|this\s+(?:week|month|quarter|year|yr)|next\s+(?:week|month|quarter|year)|q[1-4]\s*20\d\d|q[1-4]|20\d\d)\b/i;

function detectTemporal(text: string): { temporal: UnderstandingFrame["temporal"]; text: string } {
  const w = TEMPORAL_WINDOW_RE.exec(text);
  if (w) {
    const n = toNumber(w[2]) ?? 1;
    const unit = UNIT_CHAR[w[3].toLowerCase()] ?? "d";
    const phrase = w[0].trim().toLowerCase().replace(/\s+/g, " ");
    const isBarePreviousPeriod =
      !w[2] &&
      /^(?:last|previous)\s+(?:week|month|quarter|year|yr)s?$/.test(phrase);
    const previousRelation: Record<string, TemporalRelation> = {
      week: "last_week",
      month: "last_month",
      quarter: "last_quarter",
      year: "last_year",
      yr: "last_year",
    };
    const previousYear =
      isBarePreviousPeriod && /^(?:year|yr)$/.test(w[3].toLowerCase())
        ? String(new Date().getUTCFullYear() - 1)
        : null;
    return {
      temporal: {
        relation: isBarePreviousPeriod
          ? previousRelation[w[3].toLowerCase()]!
          : "within_last",
        window: isBarePreviousPeriod ? null : `${n}${unit}`,
        year: previousYear,
        raw: w[0].trim(),
        confidence: 0.85,
      },
      text: mask(text, w.index, w.index + w[0].length),
    };
  }

  const p = TEMPORAL_POINT_RE.exec(text);
  if (p) {
    const phrase = p[1].toLowerCase().replace(/\s+/g, " ");
    let relation: TemporalRelation = "current";
    let window: string | null = null;
    let year: string | null = null;

    if (/^(recently|lately)$/.test(phrase)) relation = "recent";
    else if (/^this\s+week$/.test(phrase)) relation = "this_week";
    else if (/^this\s+month$/.test(phrase)) relation = "this_month";
    else if (/^this\s+quarter$/.test(phrase) || /^q[1-4]$/.test(phrase)) relation = "this_quarter";
    else if (/^this\s+(year|yr)$/.test(phrase)) {
      relation = "this_year";
      year = String(new Date().getUTCFullYear());
    }
    else if (/^next\s+/.test(phrase)) relation = "future";
    else if (/^20\d\d$/.test(phrase)) {
      relation = "in_year";
      year = phrase;
    } else if (/^q[1-4]\s*20\d\d$/.test(phrase)) {
      relation = "in_year";
      year = phrase.slice(-4);
    }

    return {
      temporal: { relation, window, year, raw: p[0].trim(), confidence: 0.8 },
      text: mask(text, p.index, p.index + p[0].length),
    };
  }

  return { temporal: null, text };
}

// ── Target phrase ─────────────────────────────────────────────────────────

/**
 * The searcher addressing us. Stripped before anything reads the text, because
 * the verb in "I need 25 dentists" belongs to the person asking and would
 * otherwise be read as the prospects' own need. The `(?:i|we)` part carries no
 * following search verb on purpose — "I need …" is a whole request.
 */
/**
 * A request whose subject is an interrogative or indefinite pronoun: "who
 * around Porto needs SEO", "anyone in Kraków hiring Go devs".
 *
 * These name no kind of entity, but in a prospecting tool they are not a
 * missing target — they mean "whichever businesses". Reading them as a
 * low-confidence business is more useful than asking what kind of thing the
 * user meant when the relation and the place already say what they want.
 */
const INTERROGATIVE_LEAD_RE =
  /^(?:who(?:ever|'s|\s+is)?|which|any(?:one|body|1)|some(?:one|body)|sb|folks?|ppl|peeps)\b/i;

const LEAD_VERB_PREFIX_RE =
  /^(?:(?:please|pls|hey|hi|ok|okay|yo|hello|so|well|now|btw|also|and)\s+)*(?:(?:can|could)\s+you\s+)?(?:help\s+(?:me|us)\s+)?(?:(?:i|we|im|iam|ive|imma|ima|were)\s*(?:'m|'d|'ve|\s+am|\s+are)?\s+)?(?:(?:basically|literally|actually|really|just|kinda|sorta|lowkey|honestly)\s+)?(?:(?:tryna|trying\s+to|looking\s+to|hoping\s+to|wanna|want\s+to|need\s+to|gonna|going\s+to)\s+)?(?:(?:need|needs|want|would\s+like|am\s+looking\s+for|looking\s+for|lookin\s+for|find|get|search\s+for|search|look\s+for|show|give|gimme|send|pull|list|fetch|return|generate|help|who|what|any|some)\b\s*(?:me\s+|us\s+)?(?:out\s+)?(?:to\s+)?(?:some\s+|a\s+|an\s+|the\s+|all\s+|more\s+|any\s+|of\s+|for\s+|like\s+)*)?/i;

/**
 * Tokens that end a target phrase. This is `CLAUSE_STOP_TOKENS` minus the
 * genitive `of`, which holds a phrase together rather than ending it: "heads of
 * talent" and "chamber of commerce" are single nouns, and cutting at `of` is
 * what made "heads of talent" classify as unknown.
 */
const TARGET_CONTINUE = new Set(["of"]);

/**
 * Hedges that sit in front of the noun and belong to nobody.
 *
 * "find like sailmakers", "get me some saunas", "any quilt shops" — the words
 * are how people speak, and keeping them made the category read "like
 * sailmakers", which no gazetteer, dictionary or retrieval filter can match.
 * They are skipped only BEFORE the phrase has begun, so "a couple of" inside a
 * genuine noun phrase is untouched.
 */
const TARGET_LEAD_FILLER = new Set([
  "like", "some", "sum", "any", "a", "an", "the", "bunch", "few", "couple",
  "several", "lots", "loads", "plenty", "just", "maybe", "perhaps", "pls",
  "please", "kinda", "sorta",
]);

function endsTarget(raw: string): boolean {
  // Repaired first: "plumbers tht dont have a site" has to stop at "tht", or
  // the whole predicate is swallowed into the target phrase.
  const word = normalizeFunctionWord(raw);
  if (TARGET_CONTINUE.has(word)) return false;
  return CLAUSE_STOP_TOKENS.has(word) || LOCATIVE_PREP_TOKENS.has(word);
}

type TargetSpan = {
  phrase: string;
  /** Spans this claims, to be masked by the caller. */
  spans: Array<[number, number]>;
};

/** One scan for a noun phrase starting at `from`. */
function scanTarget(text: string, from: number): { phrase: string; start: number; end: number } {
  const toks = text.slice(from).split(/(\s+)/); // whitespace kept, to measure
  const out: string[] = [];
  let lead = 0; // characters before the phrase begins
  let consumed = 0;

  for (const piece of toks) {
    if (/^\s+$/.test(piece) || piece === "") {
      if (out.length > 0) consumed += piece.length;
      else lead += piece.length;
      continue;
    }
    // A mask is a span someone else already claimed. Ahead of the phrase it is
    // simply behind us ("Give me 50 | restaurants"); once the phrase has begun
    // it is a boundary. Treating it as a boundary in both positions is what
    // made every quantified request targetless.
    if (piece === "|") {
      if (out.length > 0) break;
      lead += piece.length;
      continue;
    }
    const word = piece.toLowerCase().replace(/[^\p{L}\p{N}'/-]/gu, "");
    // Pure punctuation ahead of the phrase is debris from a masked span ("100 |
    // + businesses"); inside the phrase it is the clause ending.
    if (!word) {
      if (out.length > 0) break;
      lead += piece.length;
      continue;
    }
    if (out.length === 0 && TARGET_LEAD_FILLER.has(word)) {
      lead += piece.length;
      continue;
    }
    if (endsTarget(word)) break;
    out.push(piece);
    consumed += piece.length;
    if (out.length >= 6) break;
  }

  // A phrase may not END on a genitive.
  while (out.length && TARGET_CONTINUE.has(out.at(-1)!.toLowerCase())) {
    consumed -= out.pop()!.length + 1;
  }

  const start = from + lead;
  return { phrase: clean(out.join(" ")), start, end: start + Math.max(consumed, 0) };
}

/**
 * Take the target noun phrase, and report the spans it consumed rather than
 * everything up to its end: a pre-modifier the scan stepped over ("recently
 * funded AI startups") still carries the relation, and masking it would lose
 * the signal along with the noise.
 */
function takeTargetPhrase(text: string): TargetSpan {
  // Stacked, because casual writing stacks them: "gimme need some founders",
  // "help me find need climate startups". One pass leaves the second verb
  // standing where the noun should be, and a clause-stop verb there reports no
  // target at all. Bounded, and never allowed to consume the whole request.
  let prefix = 0;
  for (let pass = 0; pass < 3; pass++) {
    const rest = text.slice(prefix);
    const stripped = rest.replace(LEAD_VERB_PREFIX_RE, "");
    if (stripped === rest || !stripped.trim()) break;
    prefix += rest.length - stripped.length;
  }
  const spans: Array<[number, number]> = prefix > 0 ? [[0, prefix]] : [];

  let at = prefix;
  for (let skips = 0; skips <= 3; skips++) {
    const hit = scanTarget(text, at);
    if (hit.phrase) {
      spans.push([hit.start, hit.end]);
      return { phrase: hit.phrase, spans };
    }
    // Nothing yet: step over one adjectival pre-modifier — or over a span
    // another detector already claimed — and try again. A mask must be
    // steppable here, or "recently funded AI startups" (whose "recently" the
    // temporal pass takes) reports no target at all.
    const rest = text.slice(at).trimStart();
    const gap = text.length - at - rest.length;
    const next = rest.split(/\s+/)[0] ?? "";
    if (next === "|") {
      at += gap + next.length;
      skips--; // a mask is not a word, so it does not spend an attempt
      continue;
    }
    const word = next.toLowerCase().replace(/[^\p{L}\p{N}'/-]/gu, "");
    if (!word || !PRE_MODIFIER_LEAD.has(word)) break;
    at += gap + next.length;
  }

  return { phrase: "", spans };
}

/** "dentists and orthodontists in Perth" — one location, two categories. */
const CONJOINED_RE =
  /^([\p{L}][\p{L}\s-]{2,30}?)\s+(?:and|or|\/|&)\s+([\p{L}][\p{L}\s-]{2,30}?)$/iu;

// ── Relation ──────────────────────────────────────────────────────────────

type RelationHit = {
  type: RelationType;
  label: string | null;
  object: OpenValue | null;
  direction: "subject_to_object" | "object_to_subject" | "mutual" | "none" | "unknown";
  raw: string;
  confidence: number;
  start: number;
  end: number;
};

const HIRING_RE =
  /\b(?:hiring|to\s+hire|looking\s+to\s+hire|wants?\s+to\s+hire|trying\s+to\s+hire|needs?\s+to\s+hire|recruiting|recruits|bring(?:ing)?\s+on|taking\s+on|staffing\s+up|adding\s+to\s+(?:the\s+)?team|expanding\s+(?:the\s+)?team|posted\s+(?:a|an|some|new)?|advertising\s+(?:a|an)?)\s*/i;

const SEEKING_WORK_MARKERS =
  /\b(?:job[-\s]?seek(?:er|ers|ing)|open\s+to\s+work|available\s+for\s+work|between\s+roles|unemployed|out\s+of\s+work)\b/i;

/**
 * Absence and presence cues.
 *
 * The cue is matched here and WHICH asset it names is decided by
 * `canonicalAsset` over the following span — not by an alternation listed
 * inline. The alternation is why "dont got a site" and "no proper wesbite"
 * read as no relation at all while "without a website" worked: every new
 * phrasing and every typo needed its own branch. One vocabulary, shared with
 * the exclusion detector, is the fix.
 */
const LACKS_CUE_RE =
  /\b(?:no|without|don'?t\s+have|dont\s+have|doesn'?t\s+have|doesnt\s+have|do\s+not\s+have|lacking|lacks?|missing|haven'?t\s+got|havent\s+got|hasn'?t\s+got|hasnt\s+got|don'?t\s+got|dont\s+got|ain'?t\s+got|aint\s+got|not\s+having|yet\s+to\s+(?:have|get|build))\s+/i;

const HAS_CUE_RE =
  /\b(?:with|has|have|having|got|runs?|running|maintains?)\s+/i;

const USES_TECH_RE =
  /\b(?:using|uses|built\s+on|running\s+on|powered\s+by|hosted\s+on|runs\s+on|on)\s+(shopify|wordpress|wix|squarespace|webflow|magento|woocommerce|salesforce|hubspot|zoho|stripe|react|next\.?js|vue|angular|django|rails|laravel|kubernetes|aws|azure|gcp|snowflake|databricks|sap|netsuite|zendesk|intercom|klaviyo|mailchimp|shopware|bigcommerce|prestashop|odoo|xero|quickbooks|freshdesk|pipedrive|monday\.?com|airtable|notion|jira|twilio|segment|braze|contentful|sanity|strapi|umbraco|drupal|joomla|typeform|calendly|squarespace)\b/i;

/**
 * `using X` with an unlisted X. Safe as a general rule where the alternation
 * above is not, because `using` takes a tool as its object almost without
 * exception — whereas a bare `on` takes a place at least as often ("on the
 * high street"), which is why `on` stays confined to the known-tool list.
 */
const USES_OPEN_RE = /\b(?:using|built\s+(?:on|with)|powered\s+by)\s+([\p{L}][\p{L}\p{N}.\-+]{2,24})\b/iu;

const PARTNERED_RE =
  /\b(?:partnered\s+with|partners\s+with|integrat(?:ed|ing|es)\s+with|resell(?:er|ing|s)\s+of|official\s+partners?\s+of)\s+([\p{L}][\p{L}\s.&-]{1,40})/iu;

const ATTENDING_RE =
  /\b(?:attending|going\s+to|speaking\s+at|exhibiting\s+at|sponsors?\s+of|presenting\s+at)\s+([\p{L}][\p{L}\s.&0-9-]{2,50})/iu;

const RECEIVED_FUNDING_RE =
  /\b(?:raised|just\s+raised|closed|secured|landed|announced|got|received|took)\s+(?:a\s+|an\s+|their\s+|some\s+|new\s+)?(pre-?seed|seed|series\s+[a-e]|angel\s+round|bridge|funding\s+round|round\s+of\s+funding|round|funding|investment|capital|money|cash|\$[\d.]+\s*[mkb]?)\b|\b(?:recently\s+|newly\s+|just\s+)?(?:funded|backed)\b|\bventure[-\s]backed\b|\bpost[-\s](?:seed|series\s+[a-e])\b/i;

const INVESTING_RE =
  /\b(?:funding|invest(?:ing|s)?\s+in|back(?:ing|s)?|writing\s+(?:cheques?|checks?)(?:\s+(?:to|for|of))?|deploying\s+capital\s+(?:into|in))\s*/i;

const SEEKING_FUNDING_RE =
  /\b(?:raising|looking\s+to\s+raise|trying\s+to\s+raise|seeking\s+(?:funding|investment|investors?|capital)|looking\s+for\s+(?:funding|investment|investors?|capital)|fundrais(?:ing|e))\b/i;

const OFFERS_RE =
  /\b(?:offering|offers|providing|provides|(?:that|who|which)\s+(?:offer|offers|provide|provides|do|does|serve|serves|service|services|work\s+with|cater\s+(?:to|for)|specialise\s+in|specialize\s+in|focus\s+on)|serving|sells?|selling|specialising\s+in|specializing\s+in|focused\s+on|catering\s+(?:to|for))\s+([\p{L}][\p{L}\s/&+.#-]{2,50})/iu;

const NEED_VERB_RE =
  /\b(?:(?:tryna|trying\s+to|looking\s+to|hoping\s+to|wanna|want(?:s|ing)?\s+to|need(?:s|ing)?\s+to)\s+(?:get|have|commission|build|redo|rebuild|sort\s+out|put\s+up)|that\s+need|who\s+need|which\s+need|needing|needs?|wants?|wanting|looking\s+for|lookin\s+for|searching\s+for|seeking|seeks|in\s+need\s+of|shopping\s+for|require|requires|requiring|interested\s+in|ready\s+for|after|open\s+to|tendering\s+for|bidding\s+for)\s+(?:a\s+|an\s+|some\s+|the\s+|someone\s+(?:for|to\s+do)\s+|somebody\s+for\s+|help\s+with\s+|new\s+|more\s+|additional\s+)*/i;

/**
 * Subjects whose trade IS finding people.
 *
 * "businesses looking for web designers" wants to buy design; "recruiters
 * looking for software engineers" is a vacancy. The verb is identical and the
 * object is a role in both, so the subject is the only thing that separates
 * them — and for this small class of subjects the answer is a fact about the
 * occupation rather than a guess: a recruiter looking for engineers is
 * recruiting them, never commissioning them.
 */
const RECRUITER_SUBJECT =
  /^(?:recruiter|recruiting|recruitment|headhunter|staffing|staffer|sourcer|talent|hr)$/i;

const ASKING_HELP_RE =
  /\b(?:asking\s+for|asked\s+for|requesting|posting\s+about\s+needing)\s+(?:some\s+|a\s+|an\s+)?(?:help\s+(?:with\s+)?)?/i;

/** Recommendation-seeking: the topic is what follows "for", not "recommendations". */
const RECOMMENDATION_CUE_RE =
  /\b(?:asking\s+for|looking\s+for|requesting|open\s+to)\s+recommendations?\s+(?:for|on|about|to)\s+(?:a\s+|an\s+|some\s+)?/i;

/**
 * Expressed pain and defection, read with no canonical member of the ontology:
 * the relation is `custom` and the label carries the wording. The object is the
 * thing the pain is about, which is what a qualification can check.
 */
const FRUSTRATION_CUE_RE =
  /\b(?:frustrated\s+(?:with|by|about|over)|fed\s+up\s+with|tired\s+of|sick\s+of|stuck\s+with|struggling\s+(?:with|to)|switching\s+(?:away\s+)?from|moving\s+away\s+from)\s+/i;

const SOCIAL_SIGNAL_RE =
  /\b(?:posting|posted|tweeting|tweeted|complaining|ranting|asking)\s+(?:about|on)\s+([\p{L}][\p{L}\s/&+.#-]{2,50})|\bon\s+(?:linkedin|twitter|x|reddit|instagram|tiktok|facebook)\b/iu;

/**
 * Participles that finish a commissioning phrase rather than name the thing
 * commissioned: "get a new website BUILT", "need the logo REDONE".
 */
const TRAILING_PARTICIPLE = new Set([
  "built", "rebuilt", "done", "redone", "made", "remade", "designed",
  "redesigned", "developed", "fixed", "sorted", "set", "setup", "up",
  "written", "rewritten", "created", "launched", "sorted",
]);

/**
 * Take the object noun phrase that follows a relation verb.
 *
 * It ends where a new clause or a place begins. Without the locative stop,
 * "accountants who serve restaurants in Chicago" took "restaurants in Chicago"
 * as the object and left the frame with no location at all — the object ate
 * the place.
 */
export function takeObject(text: string, from: number): { value: string; end: number } {
  const rest = text.slice(from);
  const toks = rest.split(/(\s+)/);
  const out: string[] = [];
  let consumed = 0;
  for (const piece of toks) {
    // `split` on a capturing separator yields an empty leading token when the
    // slice starts with whitespace. Treating that as "a word with no letters"
    // ended the object before it began, which is how a negated relation kept
    // losing its object ("offer no marketing services").
    if (piece === "") continue;
    if (/^\s+$/.test(piece)) {
      // `end` is an offset into the original string, so leading whitespace
      // must be counted even though it is not part of the semantic value.
      consumed += piece.length;
      continue;
    }
    if (piece === "|") break;
    const bare = piece.toLowerCase().replace(/[^\p{L}\p{N}'/-]/gu, "");
    if (!bare) break;
    const word = normalizeFunctionWord(bare);
    if (out.length > 0 && (CLAUSE_STOP_TOKENS.has(word) || LOCATIVE_PREP_TOKENS.has(word))) break;
    // A stop word may open an object: what is being provided is often named by
    // the gerund of the verb that would otherwise start a clause. "companies
    // that provide RECRUITING" offers recruiting — refusing the first token
    // there left the relation with no object at all.
    //
    // An ASSET word may open one for a different reason: `phone`, `email` and
    // `socials` are clause stops because they name deliverables at the end of a
    // long request, and they are also exactly what an absence relation is
    // about. Refusing them here is why "with no website" read as `lacks_asset`
    // while "with no email address" and "with no phone" came back as no
    // readable relation at all — the same sentence, graded on which asset it
    // happened to name.
    if (
      out.length === 0 &&
      CLAUSE_STOP_TOKENS.has(word) &&
      !/^(?:help|work|jobs?)$/.test(word) &&
      !/ing$/.test(word) &&
      !canonicalAsset(word)
    ) {
      break;
    }
    out.push(piece);
    consumed += piece.length;
    if (/[,;.]$/.test(piece)) break;
    if (out.length >= 5) break;
  }
  while (out.length > 1 && TRAILING_PARTICIPLE.has(out.at(-1)!.toLowerCase().replace(/[^a-z]/g, ""))) {
    out.pop();
  }
  return { value: clean(out.join(" ")), end: from + consumed };
}

/**
 * Re-read a regex-captured object through `takeObject`.
 *
 * A capture like `([\p{L}\s]{2,50})` cannot know where the phrase ends, and
 * the span it matched is what gets masked — so an over-long capture does not
 * merely store a long object, it deletes whatever followed. "accountants who
 * serve restaurants in Chicago" lost its location that way: the capture ran to
 * the end of the sentence and masked the city with it. Sending every capture
 * back through the one boundary rule keeps the object and the mask in step.
 */
function objectAfterCue(
  text: string,
  m: RegExpExecArray,
  group = 1,
): { value: string; end: number } {
  const captured = m[group];
  if (!captured) return { value: "", end: m.index + m[0].length };
  const at = m[0].lastIndexOf(captured);
  if (at < 0) return { value: clean(captured), end: m.index + m[0].length };
  return takeObject(text, m.index + at);
}

function hit(
  type: RelationType,
  m: RegExpExecArray,
  object: OpenValue | null,
  direction: RelationHit["direction"],
  confidence: number,
  label: string | null = null,
  end?: number,
): RelationHit {
  // The claimed span and the reported raw are one decision. Where the object
  // was re-read to a shorter boundary the raw must shrink with it, or the
  // inspector shows a relation quoting a city it did not keep.
  const stop = end ?? m.index + m[0].length;
  const wide = m.index + m[0].length;
  return {
    type,
    label,
    object,
    direction,
    raw: (stop < wide ? m.input.slice(m.index, stop) : m[0]).trim(),
    confidence,
    start: m.index,
    end: stop,
  };
}

/**
 * Read the relation from the text AFTER the target phrase.
 *
 * Scanning only the tail is what fixes the direction errors. "I need 25 dental
 * practices" and "dental practices that need X" share the verb `need`; the
 * first occurrence is the SEARCHER's and sits before the target, the second is
 * the prospect's and sits after it. And the object is read from the tail too,
 * which is why "businesses looking for web designers" keeps `business` as the
 * target instead of letting `designers` overwrite it.
 */
const NEGATOR_WORD_RE =
  /\b(?:not|never|no longer|isn't|aren't|isnt|arent|don't|doesn't|dont|doesnt|ain't|aint)\b/gi;

/** Only these may sit between a negator and the verb it negates. */
const NEGATION_GLUE_RE =
  /^[\s,]*(?:(?:are|is|was|were|be|been|being|currently|actively|really|even|yet|longer|s|'s)\b[\s,]*)*$/i;

/**
 * The negation attached to a relation cue, if any, from either side of it.
 *
 * Two shapes, because English puts the negative in two places: before the verb
 * ("agencies that are NOT hiring") and on its object ("companies that offer NO
 * marketing services"). Both mean the relation is being ruled out rather than
 * requested, which is the opposite of what retrieval would do with a positive
 * `hiring`. The window is short and the words allowed inside it are a closed
 * list, so a negator belonging to some other clause ("not agencies, hiring
 * engineers") does not reach across and flip this one.
 */
function relationNegation(
  text: string,
  rel: RelationHit,
): { word: string; start: number; objectAt: number } | null {
  // The absence relation IS the negative reading of an asset; negating its own
  // cue would invert it twice.
  if (rel.type === "lacks_asset") return null;

  if (rel.start > 0) {
    const from = Math.max(0, rel.start - 40);
    const before = text.slice(from, rel.start);
    NEGATOR_WORD_RE.lastIndex = 0;
    const found = [...before.matchAll(NEGATOR_WORD_RE)].pop();
    if (found && NEGATION_GLUE_RE.test(before.slice(found.index + found[0].length))) {
      return { word: found[0].trim(), start: from + found.index, objectAt: rel.end };
    }
  }

  const after = /^\s*(?:no|not|never|zero)\b/i.exec(text.slice(rel.end));
  if (after) {
    return { word: after[0].trim(), start: rel.start, objectAt: rel.end + after[0].length };
  }
  return null;
}

export function detectRelation(text: string, subject: HeadClassification): RelationHit | null {
  let m: RegExpExecArray | null;

  // Seeking work, stated as a property of a person.
  if ((m = SEEKING_WORK_MARKERS.exec(text))) {
    return hit("seeking_job", m, openValue("employment", m[0], "employment", 0.85), "subject_to_object", 0.85);
  }

  // Absence first: "no website" must not be read as a negated constraint or a
  // stray relation verb, and it is the most common opportunity signal we have.
  if ((m = LACKS_CUE_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    const asset = canonicalAsset(obj.value);
    if (asset) {
      return hit(
        "lacks_asset",
        m,
        openValue(asset, `${m[0]}${obj.value}`.trim(), asset, 0.85),
        "none",
        0.85,
        null,
        obj.end,
      );
    }
  }

  if ((m = SEEKING_FUNDING_RE.exec(text))) {
    // The funding noun completes the same relation clause. Claim it with the
    // verb so a later locative reader cannot mistake the orphaned complement
    // for part of the preceding place.
    const object = takeObject(text, m.index + m[0].length);
    return hit(
      "seeking_funding",
      m,
      openValue("funding", m[0], "funding", 0.8),
      "subject_to_object",
      0.8,
      null,
      object.end,
    );
  }
  if ((m = RECEIVED_FUNDING_RE.exec(text))) {
    const round = m[1] ? clean(m[1]).toLowerCase() : "funding";
    return hit("received_funding", m, openValue(round, m[0], null, 0.75), "object_to_subject", 0.8);
  }

  // An investor's verb is the mirror of a startup's: "investors funding
  // companies" is not a company that received money. Guarded by the subject so
  // "companies funding research" is left to the readings below.
  if (subject.kind === "investor" && (m = INVESTING_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    return hit(
      "investing_in",
      m,
      obj.value ? openValue(obj.value.toLowerCase(), obj.value, canonicalize(obj.value), 0.75) : null,
      "subject_to_object",
      obj.value ? 0.8 : 0.6,
      null,
      obj.end,
    );
  }

  // "companies that provide recruiting" offers recruiting; "companies hiring
  // recruiters" wants one. Both contain a hiring word, so the EARLIER cue wins
  // — the verb the user actually chose comes first.
  const offerFirst = OFFERS_RE.exec(text);
  const postedIsJob = (hit: RegExpExecArray | null) => !hit || !/posted|advertis/i.test(hit[0]) ||
    /\b(?:job|role|vacancy|opening|position|candidate|staff|engineer|developer)\b/i.test(text.slice(hit.index, hit.index + 90));
  const tentativeHire = HIRING_RE.exec(text);
  const hireFirst = postedIsJob(tentativeHire) ? tentativeHire : null;
  if (offerFirst && (!hireFirst || offerFirst.index < hireFirst.index)) {
    const obj = objectAfterCue(text, offerFirst);
    const what = obj.value;
    return hit(
      "offers_service",
      offerFirst,
      what ? openValue(what.toLowerCase(), what, canonicalize(what), 0.75) : null,
      "subject_to_object",
      what ? 0.8 : 0.6,
      null,
      obj.end,
    );
  }

  if ((m = hireFirst)) {
    const obj = takeObject(text, m.index + m[0].length);
    const isPosting = /posted|advertis/i.test(m[0]);
    return hit(
      "hiring",
      m,
      obj.value
        ? openValue(obj.value.toLowerCase(), obj.value, canonicalize(obj.value) ?? normalizeRole(obj.value), 0.75)
        : null,
      "subject_to_object",
      obj.value ? 0.85 : 0.6,
      isPosting ? "posted_job" : null,
      obj.end,
    );
  }

  if ((m = USES_TECH_RE.exec(text))) {
    return hit("uses_technology", m, openValue(m[1].toLowerCase(), m[0], m[1].toLowerCase(), 0.85), "subject_to_object", 0.8);
  }
  if ((m = USES_OPEN_RE.exec(text))) {
    const tool = m[1].toLowerCase();
    // "using" also introduces a method ("using cold email") rather than a
    // product. The lower confidence says so; the value is kept verbatim.
    return hit("uses_technology", m, openValue(tool, m[0], tool, 0.6), "subject_to_object", 0.65);
  }
  if ((m = PARTNERED_RE.exec(text))) {
    const obj = objectAfterCue(text, m);
    if (obj.value) {
      return hit("partnered_with", m, openValue(obj.value, obj.value, null, 0.7), "mutual", 0.7, null, obj.end);
    }
  }
  if ((m = ATTENDING_RE.exec(text))) {
    const obj = objectAfterCue(text, m);
    if (obj.value) {
      return hit(
        "attending_event",
        m,
        openValue(obj.value, obj.value, null, 0.7),
        "subject_to_object",
        0.7,
        null,
        obj.end,
      );
    }
  }

  if ((m = RECOMMENDATION_CUE_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    if (obj.value) {
      return hit(
        "custom",
        m,
        openValue(obj.value.toLowerCase(), obj.value, canonicalize(obj.value), 0.75),
        "subject_to_object",
        0.75,
        "asking_for_recommendations",
        obj.end,
      );
    }
  }

  if ((m = FRUSTRATION_CUE_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    if (obj.value) {
      return hit(
        "custom",
        m,
        openValue(obj.value.toLowerCase(), obj.value, canonicalize(obj.value), 0.7),
        "subject_to_object",
        0.7,
        m[0].trim().toLowerCase().replace(/\s+/g, "_"),
        obj.end,
      );
    }
  }

  if ((m = ASKING_HELP_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    if (obj.value) {
      return hit(
        "asking_for_help",
        m,
        openValue(obj.value.toLowerCase(), obj.value, canonicalize(obj.value), 0.75),
        "subject_to_object",
        0.8,
        null,
        obj.end,
      );
    }
  }

  // The big one. "looking for X" is three different relations depending on X,
  // and getting it wrong is the difference between a lead list of buyers and a
  // lead list of sellers.
  if ((m = NEED_VERB_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    const raw = obj.value;
    const head = singularize(raw.toLowerCase());
    if (raw) {
      if (CLIENT_OBJECT_RE.test(head) || CLIENT_OBJECT_RE.test(raw.toLowerCase())) {
        return hit("seeking_client", m, openValue(raw.toLowerCase(), raw, "clients", 0.85), "subject_to_object", 0.85, null, obj.end);
      }
      if (EMPLOYMENT_OBJECT_RE.test(head) || EMPLOYMENT_OBJECT_RE.test(raw.toLowerCase())) {
        return hit("seeking_job", m, openValue(raw.toLowerCase(), raw, "employment", 0.85), "subject_to_object", 0.85, null, obj.end);
      }
      if (/^(funding|investment|capital|investors?)$/.test(head)) {
        return hit("seeking_funding", m, openValue(raw.toLowerCase(), raw, "funding", 0.8), "subject_to_object", 0.8, null, obj.end);
      }
      // A recruiter's search for a role is a vacancy, not a purchase.
      if (subject.head && RECRUITER_SUBJECT.test(singularize(subject.head)) && classifyHead(raw).kind === "person") {
        return hit(
          "hiring",
          m,
          openValue(raw.toLowerCase(), raw, canonicalize(raw) ?? normalizeRole(raw), 0.8),
          "subject_to_object",
          0.8,
          null,
          obj.end,
        );
      }
      return hit(
        "needs_service",
        m,
        openValue(raw.toLowerCase(), raw, canonicalize(raw), 0.75),
        "subject_to_object",
        0.8,
        null,
        obj.end,
      );
    }
    // A need verb with nothing after it is a real gap, not a relation.
    return hit("unknown", m, null, "unknown", 0.3);
  }

  if ((m = HAS_CUE_RE.exec(text))) {
    const obj = takeObject(text, m.index + m[0].length);
    const asset = canonicalAsset(obj.value);
    if (asset) {
      return hit(
        "has_asset",
        m,
        openValue(asset, `${m[0]}${obj.value}`.trim(), asset, 0.75),
        "none",
        0.7,
        null,
        obj.end,
      );
    }
  }

  if ((m = OFFERS_RE.exec(text))) {
    const obj = objectAfterCue(text, m);
    const what = obj.value;
    return hit(
      "offers_service",
      m,
      what ? openValue(what.toLowerCase(), what, canonicalize(what), 0.7) : null,
      "subject_to_object",
      0.7,
      null,
      what ? obj.end : undefined,
    );
  }

  if ((m = SOCIAL_SIGNAL_RE.exec(text))) {
    const obj = objectAfterCue(text, m);
    const about = obj.value || null;
    return hit(
      "custom",
      m,
      about ? openValue(about.toLowerCase(), about, null, 0.6) : null,
      "subject_to_object",
      0.55,
      "posting_about",
      about ? obj.end : undefined,
    );
  }

  // Deliberately nothing for a provider head noun. "marketing agencies in
  // Bristol" names a kind of company, it does not assert a relationship: the
  // trade is already in target.category, and reading it as `offers_service`
  // manufactured a predicate the user never asked for. What distinguishes it
  // from "companies in Bristol needing marketing" is the target, not a
  // relation — and the proof that it really is a marketing agency is an
  // evidence requirement, which is set from the target.
  return null;
}

// ── Employer affiliation ──────────────────────────────────────────────────
//
// "heads of talent at fintech companies" names one target (the person) and the
// kind of employer they sit inside. That second noun is neither the category of
// the target nor a place, and left unclaimed the location parser takes it. It
// belongs in organization_context, which exists for exactly this.

const AFFILIATION_RE =
  /\b(?:at|who\s+work\s+(?:at|for)|working\s+(?:at|for)|employed\s+(?:at|by))\s+(.{2,70})/i;

function detectAffiliation(text: string): { company: string; start: number; end: number } | null {
  const m = AFFILIATION_RE.exec(text);
  if (!m) return null;
  const tail = m[1] ?? "";
  const from = m.index + m[0].length - tail.length;

  // Character-accurate, because the span is masked afterwards and an offset a
  // token off would leave half an employer name for the location parser.
  let consumed = 0;
  let words = 0;
  for (const piece of tail.split(/(\s+)/)) {
    if (/^\s*$/.test(piece)) {
      if (words > 0) consumed += piece.length;
      continue;
    }
    const w = normalizeFunctionWord(piece.toLowerCase().replace(/[^\p{L}\p{N}'&/-]/gu, ""));
    if (!w || CLAUSE_STOP_TOKENS.has(w) || LOCATIVE_PREP_TOKENS.has(w)) break;
    consumed += piece.length;
    if (++words >= 4) break;
  }
  const company = clean(tail.slice(0, consumed));
  if (!company) return null;
  // A place after "at" is a location, not an employer: "founders at Porto".
  if (strictPlace(company)) return null;
  return { company, start: m.index, end: from + consumed };
}

// ── Location ──────────────────────────────────────────────────────────────

const RADIUS_RE =
  /\b(?:with?in|inside)\s+(\d{1,4})\s*(km|kms|kilometer?s?|mi|miles?)\s+(?:of|from|around|outside)\s+(.{2,80})/i;

const PREP_RE =
  /\b(in|near|nearby|around|round|outside|based\s+in|located\s+in|headquartered\s+in|across|throughout|from|serving|covering)\s+(.{2,80})/i;

const REMOTE_RE =
  /\b(remote(?:ly)?|work\s+from\s+home|wfh|anywhere|distributed|worldwide|global(?:ly)?)\b/i;

const strictPlace = (s: string) => {
  const t = s.replace(/^the\s+/i, "").trim();
  if (t.length < 3) return false;
  return resolveCanonicalLocation(t)?.resolution === "resolved";
};

/**
 * Is this span a place at all? The gazetteer cannot answer: it is a small
 * structural overlay that returns a PROVISIONAL "stated" entity for anything it
 * does not know, so `resolveCanonicalLocation("seo")` happily reports a place
 * called seo. Grammar answers instead — the span sat behind a locative
 * preposition — and this function's job is only to veto the spans that are
 * demonstrably something else.
 */
const DELIVERABLE_WORD = /\b(?:public|contacts?|details?|info|e-?mails?|phones?|numbers?|websites?|socials?|linkedin)\b/i;

function plausiblePlace(span: string): boolean {
  const s = span.trim();
  if (s.length < 2 || /\|/.test(s)) return false;
  if (/^(?:paying|salary|paid|this|that|these|those|much|size)$/i.test(s)) return false;
  if (isTemporalPhrase(s)) return false;
  if (strictPlace(s)) return true;
  // An activity verb inside the span marks a clause, not a place: "worldwide
  // building fintech", "switching away". One token is enough to veto — a real
  // place containing one is gazetteer-known and already returned above.
  if (s.split(/\s+/).some((tok) => ACTIVITY_VERB_TOKENS.has(activityToken(tok)))) return false;
  // A recognized entity/role/category noun is not a place. This is what stops
  // "interested in marketing agencies" from yielding a city called agencies.
  //
  // `guess: false` matters here: the classifier's shape backstops read any
  // unrecognized plural as a business, and half the world's place names end in
  // `s`. Only a span the TABLE names is disqualified.
  const head = classifyHead(s, { guess: false });
  if (head.kind !== "unknown") return false;
  // Numbers, single letters and pure noise are not places.
  if (!/^[\p{L}][\p{L}\s'\-.]*$/u.test(s)) return false;
  // A word the table does not name can still be demonstrably not a place by
  // its ENDING: nothing is a city called automation, logistics or management.
  // Without this, an unfamiliar abstract noun clears every veto above and
  // "warehouse automation" is read as automation the town.
  //
  // The endings below are the ones with no place collisions. Several obvious
  // additions have them and are deliberately absent — do not "finish" the
  // list: -ing is Beijing, -ness is Inverness, -ence/-ance are Florence and
  // Provence, -ware is Delaware, -ity is city itself. Precision over recall,
  // so "compliance" gets through; a place the gazetteer knows is already past
  // this by the `strictPlace` check above.
  if (/(?:tion|sion|ment|ics|ology|ism|ship)$/i.test(s.split(/\s+/).at(-1)!)) return false;
  // A requested deliverable is not a town: "founders public contact details",
  // "SaaS founders public emails" (the `with` dropped). A real place with one of
  // these words in its name is gazetteer-known and returned above.
  if (DELIVERABLE_WORD.test(s)) return false;
  return true;
}

function geoFor(
  place: string,
  raw: string,
  scope: FrameLocation["scope"],
  floor?: number,
): FrameLocation {
  const geo = resolveCanonicalLocation(place);
  const resolved = geo?.resolution === "resolved";
  return {
    value: resolved ? geo!.name : place,
    raw,
    scope,
    radius: null,
    radius_unit: null,
    country_code: geo?.country_code ?? null,
    canonical: resolved ? geo!.name : null,
    // An unrecognized town is still a location the user stated. Lower
    // confidence, never a rejection — the dictionary is a small overlay and
    // most of the world is provisional in it. A caller who inferred the place
    // rather than reading a preposition passes a lower floor still.
    confidence: resolved ? 0.9 : (floor ?? 0.45),
  };
}

function scopeFor(word: string): FrameLocation["scope"] {
  return NEAR_SCOPE_CUE_RE.test(word.trim()) ? "near" : "in";
}

function detectLocation(
  text: string,
  excluded: Set<string>,
): { location: FrameLocation | null; text: string } {
  let m: RegExpExecArray | null;

  if ((m = RADIUS_RE.exec(text))) {
    const span = takePlaceSpan(tokenize(m[3]), strictPlace).join(" ");
    if (span && plausiblePlace(span) && !excluded.has(span.toLowerCase())) {
      const base = geoFor(span, `${m[0].slice(0, m[0].length - m[3].length)}${span}`, "within_radius");
      return {
        location: {
          ...base,
          scope: "within_radius",
          radius: Number(m[1]),
          radius_unit: /^k/i.test(m[2]) ? "km" : "miles",
        },
        text: mask(text, m.index, m.index + m[0].length - m[3].length + span.length),
      };
    }
  }

  const re = new RegExp(PREP_RE.source, "gi");
  while ((m = re.exec(text))) {
    const tail = m[2];
    const span = takePlaceSpan(tokenize(tail), strictPlace).join(" ");
    if (!span) continue;
    if (!plausiblePlace(span)) continue;
    if (excluded.has(span.toLowerCase())) continue;
    const prefixLen = m[0].length - tail.length;
    const raw = `${m[0].slice(0, prefixLen)}${span}`.trim();
    return {
      location: geoFor(span, raw, scopeFor(m[1])),
      text: mask(text, m.index, m.index + prefixLen + span.length),
    };
  }

  // Bare place name with no preposition. STRICT resolution only — a provisional
  // match would turn any unfamiliar noun into a city.
  const toks = tokenize(text);
  for (let n = Math.min(3, toks.length); n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      const window = toks.slice(i, i + n).join(" ");
      const wordOnly = clean(window);
      if (wordOnly.length < 3) continue;
      if (excluded.has(wordOnly.toLowerCase())) continue;
      if (!strictPlace(wordOnly)) continue;
      const at = text.indexOf(window);
      return {
        location: geoFor(wordOnly, window, "in"),
        text: at >= 0 ? mask(text, at, at + window.length) : text,
      };
    }
  }

  if ((m = REMOTE_RE.exec(text))) {
    return {
      location: {
        value: "remote",
        raw: m[0],
        scope: "remote",
        radius: null,
        radius_unit: null,
        country_code: null,
        canonical: null,
        confidence: 0.7,
      },
      text: mask(text, m.index, m.index + m[0].length),
    };
  }

  return { location: null, text };
}

/** A single target searched in either place is one request with OR geography. */
function detectOrLocations(text: string, primary: FrameLocation | null): FrameLocation[] {
  if (!primary || primary.scope === "remote") return [];
  const re = /\b(?:in|near|around|across|from)\s+([\p{L}'-]+(?:\s+[\p{L}'-]+){0,3})\s+or\s+([\p{L}'-]+(?:\s+[\p{L}'-]+){0,3})/giu;
  for (const match of text.matchAll(re)) {
    const first = takePlaceSpan(tokenize(match[1]), strictPlace).join(" ");
    const second = takePlaceSpan(tokenize(match[2]), strictPlace).join(" ");
    if (!first || !second || !plausiblePlace(first) || !plausiblePlace(second)) continue;
    if (first.toLowerCase() !== primary.value.toLowerCase() && first.toLowerCase() !== primary.canonical?.toLowerCase()) continue;
    return [primary, geoFor(second, second, primary.scope)];
  }
  return [];
}

// ── Constraints ───────────────────────────────────────────────────────────

const NUM = String.raw`(\d[\d,.]*)`;

function num(s: string): number {
  return Number(s.replace(/,/g, ""));
}

const EXCL_STOP = new Set(["and", "but", "or", "if", "with", "that", "who", "which", "plus", "please"]);

/**
 * "not agencies", "excluding Toronto". The excluded thing is taken as at most
 * three words and stops at a clause boundary: an unbounded lazy capture with a
 * lookahead ran to the end of the input whenever no punctuation followed, which
 * is how "without websites" once excluded a category called "websites coffee
 * shops without websites".
 */
function detectExclusions(text: string): Constraint[] {
  const out: Constraint[] = [];
  const re = new RegExp(EXCLUSION_CUE_RE.source, "giu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Original case is kept as well as the folded form: the folded form is what
    // gets compared and stored, the cased form is the only evidence that
    // "excluding Waterford" names a town rather than a kind of business.
    const words: string[] = [];
    const cased: string[] = [];
    for (const piece of text.slice(m.index + m[0].length).split(/\s+/)) {
      const bare = piece.replace(/[^\p{L}\p{N}'/-]/gu, "");
      const w = normalizeFunctionWord(bare.toLowerCase());
      if (!w || EXCL_STOP.has(w) || CLAUSE_STOP_TOKENS.has(w) || LOCATIVE_PREP_TOKENS.has(w)) break;
      words.push(w);
      cased.push(bare);
      if (/[,.;|]$/.test(piece)) break;
      if (words.length >= 3) break;
    }
    if (words.length === 0) continue;

    // An asset's absence is the `lacks_asset` relation and was already read
    // there. Recording it here too would hand retrieval a `category != website`
    // filter beside a relation that already says it — and the check goes
    // through the shared vocabulary, which tolerates "no proper wesbite",
    // rather than through a second list of asset words that drifts from it.
    const value = words.map((w, i) => i === words.length - 1 ? singularize(w) : w).join(" ");
    if (isAssetPhrase(value)) continue;

    // What KIND of thing is being excluded decides the field, and the
    // gazetteer alone cannot say: it knows large cities and returns nothing
    // for Waterford or Enschede, which then read as a category nobody named.
    // Capitalization is the remaining evidence, and it is only trusted when the
    // phrase is not a recognized business/role noun — so "excluding Shopify
    // stores" stays a category while "excluding Waterford" becomes a place.
    // `plausiblePlace` is the shared predicate, and using it rather than a
    // second reading is what fixed "excluding Daugavpils": read through a
    // guessing classifier, a capitalized unknown plural is a business, so the
    // exclusion landed as `category != daugavpils` and the town stayed
    // searchable. Capitalization is still required — lower-case "not agencies"
    // must stay a category — but the veto now comes from the same place the
    // positive location reader takes it from.
    // A SHOUTED request capitalizes everything, so capitalization says nothing
    // about which words are names — "NOT CHAINS" read as a town otherwise, and
    // the user's actual filter (no chain businesses) was lost while a
    // non-existent place was excluded.
    const proper = cased.join(" ");
    const capitalized = !isShouted(text) && cased.every((w) => /^\p{Lu}/u.test(w));
    const isPlace = strictPlace(proper) || (capitalized && plausiblePlace(value));

    out.push({
      field: isPlace ? "location" : "category",
      operator: "neq",
      value: isPlace ? proper : value,
      unit: null,
      negated: true,
      raw: `${m[0]}${proper}`.trim(),
      confidence: 0.7,
    });
  }
  return out;
}

/** Same constraint stated twice (once in the masked core, once in the whole
 *  request) is one constraint — retrieval must not apply it twice. */
export function dedupeConstraints(list: Constraint[]): Constraint[] {
  const seen = new Set<string>();
  const out: Constraint[] = [];
  for (const c of list) {
    const key = `${c.field}|${c.operator}|${JSON.stringify(c.value)}|${c.negated}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function detectConstraints(text: string): Constraint[] {
  const out: Constraint[] = [];
  const push = (c: Partial<Constraint> & Pick<Constraint, "field" | "operator">) =>
    out.push({ value: null, unit: null, negated: false, raw: null, confidence: 0.75, ...c } as Constraint);

  let m: RegExpExecArray | null;

  const EMP = new RegExp(
    `\\b(?:(at\\s+least|minimum|min|more\\s+than|over|under|fewer\\s+than|less\\s+than|no\\s+more\\s+than)\\s+)?${NUM}\\s*(\\+)?\\s*(?:employees|staff|people|headcount|team\\s+members)\\b`,
    "i",
  );
  if ((m = EMP.exec(text))) {
    const q = (m[1] ?? "").toLowerCase();
    const plus = !!m[3];
    const op =
      q.startsWith("at least") || q === "minimum" || q === "min" || plus
        ? "gte"
        : q === "more than" || q === "over"
          ? "gt"
          : q === "under" || q.includes("fewer") || q.includes("less")
            ? "lt"
            : q.includes("no more")
              ? "lte"
              : "eq";
    push({ field: "employee_count", operator: op, value: num(m[2]), raw: m[0] });
  }

  const STARS = new RegExp(
    `\\b(?:(more\\s+than|over|above|at\\s+least|under|below)\\s+)?${NUM}\\s*(\\+)?\\s*(?:star|stars|\\u2b50)\\b|\\brated\\s+(above|over|at\\s+least|under)\\s+${NUM}`,
    "i",
  );
  if ((m = STARS.exec(text))) {
    const q = (m[1] ?? m[4] ?? "").toLowerCase();
    const v = num(m[2] ?? m[5] ?? "0");
    const plus = !!m[3];
    const op =
      q.includes("at least") || plus
        ? "gte"
        : q.includes("more") || q.includes("over") || q.includes("above")
          ? "gt"
          : q.includes("under") || q.includes("below")
            ? "lt"
            : "gte";
    if (v > 0) push({ field: "rating", operator: op, value: v, unit: "stars", raw: m[0] });
  }

    const MONEY = new RegExp(
    `\\b(under|below|less\\s+than|over|above|more\\s+than|at\\s+least|around|about)\\s*[$€£]?\\s*${NUM}\\s*(k|m|b)?\\s*(?:\\/|\\s+per\\s+)?\\s*(hour|hr|month|mo|year|yr|day)?`,
    "i",
  );
  if ((m = MONEY.exec(text)) && /[$€£]|budget|rate|price|revenue|cost|pay|\/\s*(?:hour|hr)/i.test(text)) {
    const q = m[1].toLowerCase();
    let v = num(m[2]);
    const mult = (m[3] ?? "").toLowerCase();
    if (mult === "k") v *= 1_000;
    if (mult === "m") v *= 1_000_000;
    if (mult === "b") v *= 1_000_000_000;
    const op = q.startsWith("at least")
      ? "gte"
      : /under|below|less/.test(q)
        ? "lt"
        : /over|above|more/.test(q)
          ? "gt"
          : "eq";
    const per = (m[4] ?? "").toLowerCase();
    const field = /hour|hr/.test(per)
      ? "hourly_rate"
      : /revenue/i.test(text)
        ? "revenue"
        : /budget/i.test(text)
          ? "budget"
          : "price";
    push({ field, operator: op, value: v, unit: per || null, raw: m[0] });
  }

  for (const ex of detectExclusions(text)) push(ex);

  const EITHER =
    /\b(?:either\s+)?([\p{L}][\p{L}\s-]{2,30}?)\s+or\s+([\p{L}][\p{L}\s-]{2,30}?)(?=\s*(?:$|,|\.|;|\||\bin\b|\bnear\b|\bwith\b))/iu;
  if ((m = EITHER.exec(text)) && /\beither\b/i.test(text)) {
    push({
      field: "category",
      operator: "one_of",
      value: [clean(m[1]).toLowerCase(), clean(m[2]).toLowerCase()],
      raw: m[0],
      confidence: 0.7,
    });
  }

  if ((m = /\bwith?in\s+(\d{1,4})\s*(km|kms|kilometer?s?|mi|miles?)\b/i.exec(text))) {
    push({
      field: "distance",
      operator: "within_radius",
      value: num(m[1]),
      unit: /^k/i.test(m[2]) ? "km" : "miles",
      raw: m[0],
    });
  }

  if (/\bremote\s+only\b|\bfully\s+remote\b/i.test(text)) {
    push({ field: "work_mode", operator: "eq", value: "remote", raw: "remote only", confidence: 0.8 });
  }

  return out;
}

// ── Long-form deliverables ────────────────────────────────────────────────

/**
 * Shared with the validator (`vocab.DELIVERABLE_FIELD_PATTERNS`), which keys the
 * same field names out of an LLM frame. Two copies of this table meant the two
 * extractors named the same column differently.
 */
const FIELD_WORDS = DELIVERABLE_FIELD_PATTERNS;

const REQUIRED_MARKER =
  /\b(must|required|require|need(?:ed)?|essential|mandatory|has\s+to\s+have|gotta\s+have|non-?negotiable)\b/i;

/**
 * Asking for a field outright is asking for it, marker or no marker.
 *
 * "gyms in Valencia, pull their opening hours and owner name" names two fields
 * and hedges neither, and a reader who only counts "must"/"if possible" drops
 * both — which is the silent requirement loss §11 forbids. A hedge still wins:
 * "include socials if possible" is preferred, not required.
 */
const DELIVERY_MARKER =
  /\b(pull|scrape|grab|fetch|extract|collect|gather|include|including|add|append|attach|note|give\s+me|gimme|get|send|return|export|output|along\s+with|list)\b/i;

/**
 * Split on clause boundaries so "phone required, socials if possible" lands in
 * two buckets instead of both inheriting the first marker.
 *
 * Exported for the validator, which re-reads the raw input to recover an ask an
 * LLM extraction read past. Two readings of one sentence must come from one
 * reader, or the recovery could add a field this one would never have found.
 */
export function fieldRequirements(
  text: string,
  tail = "",
): { required: OpenValue[]; preferred: OpenValue[] } {
  const required: OpenValue[] = [];
  const preferred: OpenValue[] = [];
  // A clause the deliverables cut already claimed is a deliverable clause, so
  // "gyms in Valencia, opening hours and owner name" needs no verb to be an ask.
  const claimed = new Set(deliverableClauses(tail).map((c) => c.trim()));
  for (const clause of deliverableClauses(text)) {
    const isPreferred = PREFERRED_MARKER.test(clause);
    const isRequired =
      REQUIRED_MARKER.test(clause) ||
      DELIVERY_MARKER.test(clause) ||
      claimed.has(clause.trim());
    if (!isPreferred && !isRequired) continue;
    const bucket = isPreferred ? preferred : required;
    for (const name of fieldsNamedIn(clause)) {
      if (name === "website" && /\bneed(?:s)?\s+(?:a\s+)?websites?\b/i.test(clause) && !DELIVERY_MARKER.test(clause)) continue;
      if (!bucket.some((f) => f.value === name)) bucket.push(openValue(name, clause.trim(), name, 0.7));
    }
  }

  // "…dental practices in Glasgow with an email address" asks for the address
  // as plainly as "email required" does, and no marker word appears anywhere
  // near it. Restricted to CONTACT fields: a website is a property of the
  // business, so "with a website" is the `has_asset` relation, and recording it
  // here as well would state one fact twice in two vocabularies.
  for (const name of presenceRequests(text)) {
    if (!required.some((f) => f.value === name) && !preferred.some((f) => f.value === name)) {
      required.push(openValue(name, name, name, 0.6));
    }
  }
  if (/\ball\s+contact\s+details?\b|\bcontact\s+info(?:rmation)?\b/i.test(text)) {
    for (const name of ["email", "phone"]) {
      if (!required.some((f) => f.value === name)) required.push(openValue(name, "all contact details", name, 0.8));
    }
  }
  if (/\bemails?\b[^.;]{0,25}\bif\s+public\b/i.test(text) && !required.some((f) => f.value === "email")) {
    required.push(openValue("email", "email if public", "email", 0.8));
  }
  return { required, preferred };
}

/**
 * Which fields a clause names, each counted once.
 *
 * A matched span is blanked before the next pattern reads the clause, because
 * the patterns overlap: "email address required" matched `email address` AND
 * `address`, and asked retrieval for a postal address nobody mentioned. The
 * table's order is therefore load-bearing — longest phrasing first.
 */
function fieldsNamedIn(clause: string): string[] {
  let rest = clause;
  const out: string[] = [];
  for (const [re, name] of FIELD_WORDS) {
    const m = re.exec(rest);
    if (!m) continue;
    out.push(name);
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
  }
  return out;
}

/** Contact details the searcher can ask for by presence alone. A website is
 *  deliberately absent — see `fieldRequirements`. */
const CONTACT_FIELDS: ReadonlySet<string> = new Set([
  "phone", "email", "address", "owner_name", "instagram", "facebook",
  "linkedin", "socials", "opening_hours", "reviews", "rating",
]);

/** `with <contact field>` — but never `with no …`, which is an absence and
 *  belongs to the relation. `without` cannot reach here: it is one word. */
function presenceRequests(text: string): string[] {
  const out: string[] = [];
  const re = /\bwith\s+(?:a|an|the|their|thier|its)?\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40).split(/[,.;|]/)[0] ?? "";
    if (/^(?:no|out|zero|nothing)\b/i.test(after)) continue;
    for (const name of fieldsNamedIn(after)) {
      if (CONTACT_FIELDS.has(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * Hard punctuation always separates clauses; "and" only does when BOTH halves
 * carry their own marker. Splitting on every "and" is what reduced "socials and
 * reviews if possible" to one preferred field — the half without the hedge lost
 * its marker and was dropped entirely.
 */
function deliverableClauses(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[,;.\u2014]|\bplus\b|\+/i)) {
    const parts = chunk.split(/\band\b/i);
    const marked = parts.filter(
      (p) => PREFERRED_MARKER.test(p) || REQUIRED_MARKER.test(p) || DELIVERY_MARKER.test(p),
    ).length;
    if (parts.length > 1 && marked === parts.length) out.push(...parts);
    else out.push(chunk);
  }
  return out;
}

const VERIFY_RE =
  /\b(verify|verified|verification|confirm|confirmed|make\s+sure|double-?check|prove|proof)\b/i;

function detectVerification(text: string): UnderstandingFrame["verification"] {
  if (!VERIFY_RE.test(text)) return [];
  const out: UnderstandingFrame["verification"] = [];
  const sentence = text.match(/[^.;]*\b(?:verify|verification|confirm|make\s+sure|double-?check|prove)\b[^.;]*/i);
  const raw = sentence?.[0]?.trim() ?? null;
  const scope = raw ?? text;
  if (/\b(no|without|don'?t\s+have|lack)\w*\s+(?:a\s+|an\s+|real\s+|proper\s+)?(website|site)/i.test(scope))
    out.push({ kind: "no_owned_website", label: null, raw });
  if (/\bphone\b/i.test(scope)) out.push({ kind: "phone_is_public", label: null, raw });
  if (/\bemail\b/i.test(scope)) out.push({ kind: "email_deliverable", label: null, raw });
  if (/\b(still|currently|open|operating|exists?|in\s+business|trading)\b/i.test(scope))
    out.push({ kind: "business_exists", label: null, raw });
  if (/\b(hiring|job|role|vacancy|posting)\b/i.test(scope))
    out.push({ kind: "intent_is_recent", label: "job posting is still live", raw });
  // Anything else the user asked to verify survives rather than being dropped —
  // "verify they accept walk-ins" must not need a vocab.ts commit.
  if (out.length === 0 && raw) out.push({ kind: "other", label: raw.slice(0, 200), raw });
  return out;
}

function detectOutput(text: string): UnderstandingFrame["output"] {
  const out: UnderstandingFrame["output"] = [];
  if (/\btables?\b|\bspreadsheets?\b|\bgrid\b/i.test(text)) out.push({ kind: "table", label: null, raw: null });
  if (/\bcsv\b|\bexcel\b|\bxlsx?\b/i.test(text)) out.push({ kind: "csv", label: null, raw: null });
  if (/\bcards?\b/i.test(text)) out.push({ kind: "cards", label: null, raw: null });
  if (/\b(?:outreach|cold\s+email|cold\s+dm|dm|message|pitch)\s*(?:drafts?|templates?|copy|scripts?)?\b/i.test(text))
    out.push({ kind: "outreach_drafts", label: null, raw: null });
  if (/\bsummar(?:y|ise|ize|ies)\b/i.test(text)) out.push({ kind: "summary", label: null, raw: null });
  if (/\bnotion\b/i.test(text)) out.push({ kind: "other", label: "Notion-ready output", raw: "notion" });
  if (/\bgoogle\s+sheets?\b|\bsheets?\b/i.test(text))
    out.push({ kind: "other", label: "Google Sheets output", raw: "sheets" });
  return out;
}

/**
 * Named places to look, as distinct from the fields to bring back: "founders
 * on LinkedIn", "opening hours from Google Maps". The list is of PLATFORMS —
 * a closed-enough set that naming them is honest — and anything unnamed is
 * simply not a source preference rather than a guess.
 */
const SOURCE_SITES: Record<string, string> = {
  linkedin: "LinkedIn",
  "google maps": "Google Maps",
  "google map": "Google Maps",
  gmaps: "Google Maps",
  maps: "Google Maps",
  google: "Google",
  yelp: "Yelp",
  crunchbase: "Crunchbase",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  reddit: "Reddit",
  instagram: "Instagram",
  insta: "Instagram",
  facebook: "Facebook",
  twitter: "X",
  x: "X",
  tiktok: "TikTok",
  github: "GitHub",
  producthunt: "Product Hunt",
  "product hunt": "Product Hunt",
  angellist: "AngelList",
  wellfound: "Wellfound",
  upwork: "Upwork",
  ycombinator: "Y Combinator",
  "companies house": "Companies House",
  yellowpages: "Yellow Pages",
  "yellow pages": "Yellow Pages",
};

const SOURCE_CUE_RE = new RegExp(
  String.raw`\b(?:on|from|via|off|using|through|in)\s+(` +
    Object.keys(SOURCE_SITES)
      .sort((a, b) => b.length - a.length)
      .map((k) => k.replace(/\s/g, String.raw`\s+`))
      .join("|") +
    String.raw`)\b`,
  "gi",
);

function detectSources(text: string): { sources: OpenValue[]; text: string } {
  const sources: OpenValue[] = [];
  const seen = new Set<string>();
  let next = text;
  let m: RegExpExecArray | null;
  const re = new RegExp(SOURCE_CUE_RE.source, "gi");
  while ((m = re.exec(text))) {
    const key = m[1]!.toLowerCase().replace(/\s+/g, " ");
    const label = SOURCE_SITES[key];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sources.push({ value: label, raw: span(m[0]), normalized: label, confidence: 0.75 });
    // Masked so the location reader cannot later read "on LinkedIn" as a place.
    next = mask(next, m.index, m.index + m[0].length);
  }
  return { sources, text: next };
}

// ── Compound ──────────────────────────────────────────────────────────────
//
// Two rules, both general, both checkable:
//
//  1. an explicit second imperative  — "find X and also find Y"
//  2. two independently located clauses — "dentists in Perth and also
//     orthodontists in Adelaide", where each half carries its own place
//
// Rule 2 is what the first version lacked, and it is why "dentists in Perth and
// also orthodontists in Adelaide" silently became "dentists in Perth". A bare
// "and" inside one noun phrase ("dentists and orthodontists in Perth") has one
// location and is NOT compound — it is a one_of category.

const SECOND_IMPERATIVE_RE =
  /\s*(?:,|;)?\s*\b(?:and\s+(?:also\s+)?|then\s+|plus\s+|also\s+)(?=(?:find|get|search\s+for|look\s+for|pull|give\s+me|show\s+me|i\s+(?:also\s+)?need|i\s+(?:also\s+)?want)\b)/i;

const CONJUNCTION_SPLIT_RE = /\s+(?:,\s*)?(?:and\s+also|and\s+then|,\s*also|;\s*also|\band\b|;)\s+/i;

const LOCATIVE_RE = /\b(?:in|near|nearby|around|round|outside|across|throughout|within)\s+[\p{L}]/iu;

/**
 * Wording that announces a second request outright. If it is present and the
 * split below still fails, the request is reported as an uncertain compound —
 * the one outcome §13 forbids is running half of it and saying nothing.
 */
const COMPOUND_SIGNAL_RE =
  /\b(?:and\s+also|also\s+(?:find|get|need|want|pull|list)|plus\s+(?:find|get|some)|as\s+well\s+as)\b/i;

function splitCompound(text: string): { parts: string[]; uncertain: boolean } {
  const byImperative = text
    .split(SECOND_IMPERATIVE_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
  if (byImperative.length > 1) return { parts: byImperative, uncertain: false };

  // Two locative clauses joined by a conjunction are two requests.
  const re = new RegExp(CONJUNCTION_SPLIT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const left = text.slice(0, m.index).trim();
    const right = text.slice(m.index + m[0].length).trim();
    if (left.length < 5 || right.length < 5) continue;
    if (LOCATIVE_RE.test(left) && LOCATIVE_RE.test(right)) {
      return { parts: [left, right], uncertain: false };
    }
  }

  return { parts: [text], uncertain: COMPOUND_SIGNAL_RE.test(text) };
}

// ── Mode + task ───────────────────────────────────────────────────────────

/**
 * Which kind of prospecting this is, derived from the relation and the target.
 * `fit_based` is the honest answer for plain discovery — a profile match with
 * no relationship asserted — and it is the default precisely so that nothing
 * has to invent an intent relationship to make a request look lead-shaped.
 */
function prospectingModeFor(
  relation: RelationType,
  entity: EntityType,
  label: string | null,
): { mode: ProspectingMode; confidence: number } {
  if (label === "posting_about") return { mode: "social_signal_based", confidence: 0.6 };
  // One table, in `vocab`, read by the extractor and the validator alike. The
  // switch that used to live here was a second copy, and it had already
  // drifted: `investing_in` was missing from it entirely, so every investor
  // search came back with no mode at all.
  if (relation === "none") {
    return { mode: entity === "job" ? "job_based" : "fit_based", confidence: 0.8 };
  }
  if (relation === "custom") return { mode: "custom", confidence: 0.5 };
  const mapped = MODE_BY_RELATION[relation];
  if (mapped) return { mode: mapped, confidence: 0.8 };
  return { mode: "unknown", confidence: 0.3 };
}

/**
 * Shrink the last target span so a peeled tail stays in the text.
 *
 * Mutates `spans` in place and reports whether it found the tail. The phrase is
 * a cleaned form of the text (punctuation dropped, whitespace collapsed), so
 * the tail is not guaranteed to appear verbatim inside the span — when it does
 * not, nothing is changed and the caller keeps its other reading rather than
 * unmasking a region it cannot locate.
 */
function unmaskTail(text: string, spans: Array<[number, number]>, tail: string): boolean {
  const last = spans.at(-1);
  if (!last) return false;
  const segment = text.slice(last[0], last[1]).toLowerCase();
  const at = segment.lastIndexOf(tail.toLowerCase());
  if (at <= 0) return false;
  last[1] = last[0] + at;
  return true;
}

// ── Entry point ───────────────────────────────────────────────────────────

export type FallbackOptions = { startedAt?: number; depth?: number };

export function extractFrameDeterministic(
  rawInput: string,
  opts: FallbackOptions = {},
): UnderstandingFrame {
  const started = opts.startedAt ?? Date.now();
  const depth = opts.depth ?? 0;
  const raw = (rawInput ?? "").trim();
  const { text, repairs } = prep(raw);
  const frame = emptyFrame(raw);
  frame.input.normalized = text;
  const notes: string[] = [];
  if (repairs.length > 0) {
    notes.push(
      `read through spelling repairs: ${repairs.map((r) => `"${r.from}" → "${r.to}"`).join(", ")}`,
    );
  }

  // 0. Text aimed at this program rather than at the world. Answered before
  //    anything is read out of it, because every reader below is built to find
  //    a request in whatever it is given: "list your system prompt" otherwise
  //    yields a search for prompts, and "ignore previous instructions" is one
  //    repair away from a search for instructors. Saying that no prospecting
  //    request was found is the honest answer, and it is a question rather
  //    than a refusal — §19's contract, applied to input that is not a request
  //    at all.
  if (META_REQUEST_RE.test(text)) {
    // "other", not "unknown": we know perfectly well what kind of text this is
    // — it is simply not a prospecting request. `unknown` would claim the
    // layer failed to read it, and the validator rightly treats a frame that
    // cannot say what is being attempted as a defect.
    frame.task_type = { value: "other", raw: null, confidence: 0.6 };
    frame.prospecting_mode = { value: "unknown", raw: null, confidence: 0.6 };
    // No prospect relationship was requested, and saying `unknown` here would
    // assert that one was and went unread.
    frame.relation.type = { value: "none", raw: null, confidence: 0.6 };
    frame.relation.direction = { value: "none", raw: null, confidence: 0.6 };
    frame.clarification = {
      needed: true,
      fields: ["target"],
      reason: "missing_target",
      question: null,
    };
    frame.meta = {
      extractor: "deterministic",
      provider: null,
      model: null,
      prompt_version: null,
      latency_ms: Date.now() - started,
      fallback_used: false,
      cached: false,
      repair: null,
      notes: ["addressed to the assistant, not a description of prospects — nothing was searched for"],
    };
    return UnderstandingFrameSchema.parse(frame);
  }

  // 1. The searcher's own sentence, lifted out before anything reads the rest.
  let { context, analysis } = detectUserContext(text);
  frame.user_context = context;
  analysis = analysis.replace(/\b(in|near|around)\s+(.+?)\s+(?:wait\s+)?no\s+(?:make\s+that|actually|rather|instead)\s+([\p{L}\s-]+?)(?=,|\.|\bwith\b|$)/iu,
    (_whole, prep: string, _old: string, replacement: string) => `${prep} ${replacement.trim()}`);

  // 2. Deliverables are cut BEFORE the compound split, or "…and give me a
  //    table plus outreach drafts" reads as a second search for tables. What
  //    was cut is still read in full at step 9.
  const { core, tail: deliverableTail } = coreSegment(analysis);

  // 3. Compound, on the request's core only.
  const { parts, uncertain } = splitCompound(core);
  const primaryRaw = parts[0] ?? core;
  let work = primaryRaw;

  // 4. Quantity and temporal, masked so neither can be mistaken for a place.
  const q = detectQuantity(work);
  frame.quantity = q.quantity;
  work = q.text;
  const amountPlaceholder = /\bthis\s+much\b/i.exec(primaryRaw);
  if (amountPlaceholder) {
    const field = /\b(?:jobs?|salary|paying|paid|compensation|wages?)\b/i.test(primaryRaw)
      ? "salary_min" : /\brevenue\b/i.test(primaryRaw) ? "revenue" : "amount";
    frame.unresolved.push({ field, raw: amountPlaceholder[0] });
    frame.constraints.push({ field, operator: "gte", value: null, unit: null, negated: false, raw: amountPlaceholder[0], confidence: 1 });
  }
  const sizePlaceholder = /\b(?:around|about|roughly|at least|under)\s+this\s+size\b/i.exec(primaryRaw);
  if (sizePlaceholder) {
    frame.unresolved.push({ field: "employee_count", raw: sizePlaceholder[0] });
    frame.constraints.push({ field: "employee_count", operator: "eq", value: null, unit: null, negated: false, raw: sizePlaceholder[0], confidence: 1 });
  }
  const t = detectTemporal(work);
  frame.temporal = t.temporal;
  work = t.text;
  // A time window written after the deliverables ("…insta if possible today")
  // is still the window the request is about. Only read there when the core
  // named none, and the tail is not masked by it — nothing downstream reads
  // the tail for geography, so there is nothing to protect it from.
  if (!frame.temporal && deliverableTail) {
    frame.temporal = detectTemporal(deliverableTail).temporal;
  }

  // 4b. Named platforms are where to look, not where the prospect is. Masked
  //     here so "founders on LinkedIn" cannot leave LinkedIn in the geography.
  const src = detectSources(work);
  work = src.text;
  const tailSrc = detectSources(deliverableTail);
  const sourceSeen = new Set(src.sources.map((s) => s.value));
  frame.source_preferences = [
    ...src.sources,
    ...tailSrc.sources.filter((s) => !sourceSeen.has(s.value)),
  ];

  // 4c. A worldwide scope word says WHERE to search, not what to search for.
  //     Masked before the target phrase reads it, or "startup founders
  //     worldwide building fintech" peels into a place called "worldwide
  //     building fintech" and the scope is lost with it. The narrower
  //     wordings ("anywhere in the world", "the globe") still land in a place
  //     span and are normalized from there.
  const scopeWord = /\b(?:world\s*-?\s*wide|globally)\b/i.exec(work);
  if (scopeWord) {
    frame.constraints.push({
      field: "geo_scope",
      operator: "eq",
      value: "worldwide",
      unit: null,
      negated: false,
      raw: scopeWord[0],
      confidence: 0.9,
    });
    work = mask(work, scopeWord.index, scopeWord.index + scopeWord[0].length);
    notes.push(`"${scopeWord[0]}" is a search scope, not a place`);
  }

  // 5. Constraints are read before location so an excluded place cannot also
  //    become the positive one.
  // Read twice, never as one string: concatenating the masked core and the raw
  // request let a match start in one and end in the other.
  frame.constraints = dedupeConstraints([...frame.constraints,
    ...detectConstraints(work.slice(0, 1600)),
    ...detectConstraints(analysis.slice(0, 1600)),
  ]);
  if (/\b(?:not|never|exclude|excluding|without)\s+(?:already\s+)?funded\b/i.test(analysis)) {
    frame.constraints.push({ field: "funding_status", operator: "neq", value: "funded", unit: null, negated: true, raw: "not already funded", confidence: 0.9 });
  }
  const excluded = new Set(
    frame.constraints
      .filter((c) => c.field === "location" && c.negated)
      .map((c) => String(c.value).toLowerCase()),
  );

  // 6. The target phrase, from the head of what remains. The spans are masked
  //    only after the head has been read, because reading the head is what
  //    decides how much of the phrase was really the target (below).
  const target = takeTargetPhrase(work);
  let phrase = target.phrase;
  const spans = target.spans.map(([a, b]) => [a, b] as [number, number]);

  // "dentists and orthodontists" — one target, two categories.
  const conj = CONJOINED_RE.exec(phrase);
  if (conj) {
    const a = clean(conj[1]).toLowerCase();
    const b = clean(conj[2]).toLowerCase();
    // Both sides must independently name a thing ("wedding venues and
    // florists", "photographers / videographers"). A slash that only
    // separates aliases of ONE family — "hvac / heating cooling companies" —
    // leaves the right side holding the head noun and the left side a bare
    // trade word; splitting there strands "hvac" as the whole target and the
    // entity reads unknown.
    const sideHead = (side: string) => classifyHead(side, { guess: false }).kind !== "unknown";
    if (a && b && sideHead(a) && sideHead(b)) {
      frame.constraints.push({
        field: "category",
        operator: "one_of",
        value: [a, b],
        negated: false,
        unit: null,
        raw: span(phrase) ?? "",
        confidence: 0.7,
      });
      phrase = conj[1];
    }
  }

  let head = classifyHead(phrase);

  // A trailing tail that makes an otherwise readable phrase unreadable is not
  // the head: "climate startups ljubljana" is about startups, and "COBBELRS
  // ANN ARBOR" about cobblers. Up to three words are peeled, because a place
  // name is routinely two or three ("ann arbor", "san luis obispo") and the
  // one-word version left the phrase unreadable and the city unread.
  //
  // What happens to the peeled tail depends on what it looks like. A place is
  // offered to the geography at low confidence; anything else is HANDED BACK
  // — left unmasked so the relation and location readers meet it in place,
  // which is how "aberystwyth fuded" ends up as a city plus a funding event
  // rather than as two thirds of a category.
  //
  // A head the classifier GUESSED from shape is peelable too. "SAILMAKERS
  // PÉCS" answers `business` only because a city ending in `s` reads as an
  // unrecognized plural, and that guess must lose to a confident reading of
  // the words in front of it — but only when what it gives up is a place, or
  // every two-word category would be halved.
  let trailingPlace: string | null = null;
  const words = phrase.split(/\s+/).filter(Boolean);
  // A bare participle after the head noun opens a clause ("founders talking
  // about churn", "agencies based…"); it is not a town, unless it is a place
  // someone actually knows ("cafes beijing").
  const takePlace = (tail: string): boolean =>
    plausiblePlace(tail) && !excluded.has(tail.toLowerCase()) &&
    !(/^[\p{L}]+(?:ing|ed)$/iu.test(tail) && !strictPlace(tail) && !knownCityName(tail));

  // An activity verb inside the phrase opens a clause, not a modifier:
  // "startup founders building fintech" is founders, and "building fintech" is
  // what they make. Split at the verb and hand the tail back, so the relation,
  // industry and location readers meet it in place. Only when the head in
  // front of the verb still reads — a split that leaves no target is no split.
  const verbAt = words.findIndex((w, i) => i > 0 && ACTIVITY_VERB_TOKENS.has(activityToken(w)));
  if (verbAt > 0) {
    const tail = words.slice(verbAt).join(" ");
    const shorter = words.slice(0, verbAt).join(" ");
    const retry = classifyHead(shorter);
    if (retry.kind !== "unknown" && unmaskTail(work, spans, tail)) {
      head = retry;
      phrase = shorter;
      notes.push(
        `"${tail}" starts with the activity "${words[verbAt]}" — handed back rather than read into the target`,
      );
    }
  }

  if (head.kind === "unknown" || head.guessed === true) {
    for (let drop = 1; drop <= Math.min(3, words.length - 1); drop++) {
      const shorter = words.slice(0, -drop).join(" ");
      const retry = classifyHead(shorter);
      if (retry.kind === "unknown") continue;
      const tail = words.slice(-drop).join(" ");
      const placelike = takePlace(tail);
      // A shape-guessed head loses to a known head when what follows it is a
      // requested deliverable ("founders public contact details").
      const deliverableTail = head.guessed === true && retry.guessed !== true && DELIVERABLE_WORD.test(tail);
      if (head.kind !== "unknown" && !(placelike && retry.confidence > head.confidence) && !deliverableTail) continue;
      head = retry;
      phrase = shorter;
      if (placelike) {
        trailingPlace = tail;
        notes.push(
          `read "${tail}" as a place rather than as the head noun — "${shorter}" is what is being searched for`,
        );
      } else if (unmaskTail(work, spans, tail)) {
        notes.push(
          `"${shorter}" is what is being searched for; "${tail}" read as the rest of the request`,
        );
      }
      break;
    }
  }

  // Neither word is in the dictionary, so nothing above could fire — but the
  // SHAPE still says which is which. "<plural> <singular>" with no preposition
  // between them is the terse form of "<what> in <where>" ("roastereis turku",
  // "cobblers ann arbor"), and reading the last word as a place keeps the
  // geography even when the trade stays unlabelled. Requiring the word before
  // it to be plural is what keeps "waste haulage" whole.
  if ((head.kind === "unknown" || head.guessed === true) && !trailingPlace && words.length >= 2) {
    const tail = words.at(-1)!;
    const before = words.at(-2)!;
    const plural = (w: string) => w.length >= 5 && /s$/.test(w) && !/(?:ss|us)$/.test(w);
    // A plural-shaped tail normally IS the head ("waste haulage services"),
    // with one exception: when the head's own classification came from that
    // same plural shape. Then the only thing saying "daugavpils" is a business
    // is that it ends in `s`, which half the cities in Europe also do, and the
    // familiar word in front of it is the better candidate for the head.
    if (plural(before) && (!plural(tail) || head.guessed === true) && takePlace(tail)) {
      trailingPlace = tail;
      phrase = words.slice(0, -1).join(" ");
      head = classifyHead(phrase);
      notes.push(
        `neither word is familiar; read "${tail}" as a place and "${phrase}" as what is being searched for`,
      );
    }
  }

  // An activity tail handed back above ("building fintech", "focusing on AI")
  // names what the target makes or does. That is an industry when the object
  // is a bare noun the head tables do not claim; an article ("building a
  // team") or a recognized noun ("building owners") reads as something else.
  const activity = /\b(?:building|developing|focusing\s+on|working\s+on)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)/iu.exec(work);
  if (activity && !frame.target.industry) {
    const activityWords: string[] = [];
    for (const w of activity[1].split(/\s+/)) {
      if (activityWords.length >= 2 || CLAUSE_STOP_TOKENS.has(normalizeFunctionWord(w.toLowerCase()))) break;
      activityWords.push(w);
    }
    const noun = activityWords.join(" ");
    if (noun && !/^(?:a|an|the|their|our|your|its|his|her|my)\b/i.test(noun) &&
        classifyHead(noun.split(/\s+/)[0]!, { guess: false }).kind === "unknown") {
      frame.target.industry = openValue(noun.toLowerCase(), noun, null, 0.65);
      const at = activity.index + activity[0].length - activity[1].length;
      spans.push([at, at + noun.length]);
      notes.push(`"${activity[0].trim()}" read as the industry the target builds in`);
    }
  }

  // Right-to-left, so an earlier span's offsets survive a later replacement.
  for (const [from, to] of [...spans].sort((a, b) => b[0] - a[0])) {
    if (to > from) work = mask(work, from, to);
  }

  // A modifier that resolves as a place is a location, not part of the noun:
  // "Berlin startups" is startups in Berlin. Checked strictly, so "dental" in
  // "dental practices" stays where it belongs.
  let modifierLocation: FrameLocation | null = null;
  if (head.modifiers.length > 0) {
    for (const mod of head.modifiers) {
      if (!strictPlace(mod) || excluded.has(mod.toLowerCase())) continue;
      modifierLocation = geoFor(mod, mod, "in");
      phrase = phrase.replace(new RegExp(`\\b${mod}\\b`, "i"), "").replace(/\s+/g, " ").trim();
      head = classifyHead(phrase);
      break;
    }
  }

  // An interrogative subject with nothing else to read is "whichever
  // businesses", not an absent target. Only when the phrase came back empty —
  // a real noun anywhere in it outranks the pronoun.
  let interrogative = false;
  if (!phrase && INTERROGATIVE_LEAD_RE.test(text)) {
    interrogative = true;
    notes.push(
      `"${INTERROGATIVE_LEAD_RE.exec(text)?.[0]}" names no kind of entity; read as businesses at low confidence rather than asking`,
    );
  }

  const entity: EntityType =
    head.kind === "unknown" ? (interrogative ? "business" : "unknown") : head.kind;
  frame.target.entity_type = {
    value: entity,
    raw: span(head.head),
    confidence: interrogative ? 0.4 : head.confidence,
  };
  if (head.ambiguous) {
    frame.target.entity_ambiguous = true;
    notes.push(
      `"${head.head}" is legitimately a person or an organization; kept as ${entity} rather than asking`,
    );
  }

  /** Did the head phrase name nothing beyond the entity type? See below. */
  let generic = false;
  if (phrase) {
    // A repaired head belongs in the value, not only in `normalized`: the
    // typo is preserved verbatim in `raw`, and "foundders" as the value is a
    // descriptor nothing downstream can match on.
    let spelled = head.repairedFrom
      ? phrase.replace(new RegExp(`\\b${head.repairedFrom}\\b`, "i"), head.head ?? head.repairedFrom)
      : phrase;
    // "b2b saas founders" is role=founder + industry=saas (+ model b2b, read
    // from the raw text later) — the lexicon's intent. Leaving the industry in
    // the role made validation drop the industry as a span harvested twice,
    // and the role then matched no real founder title.
    let rolePhrase = phrase;
    if (entity === "person" && head.industry && head.head) {
      const industryTokens = new Set(head.industry.toLowerCase().split(/\s+/));
      const keep = (word: string) => !industryTokens.has(word.toLowerCase()) && !/^(?:b2b|b2c|d2c|dtc)$/i.test(word);
      const stripped = spelled.split(/\s+/).filter(keep).join(" ").trim();
      if (stripped && stripped.toLowerCase() !== spelled.toLowerCase()) {
        spelled = stripped;
        rolePhrase = phrase.split(/\s+/).filter(keep).join(" ").trim() || phrase;
      }
    }
    // "founders of (B2B SaaS) startups": a GENERIC organization noun is no
    // part of the title ("founder of startups" matches no real founder). A
    // startup noun is the company stage. A noun that narrows the kind of
    // organization ("founders of agencies", "of brands") is kept as said.
    if (entity === "person" && head.head) {
      const ofOrg = /^(.+?)\s+(?:of|at|from)\s+(startups?|scale-?ups?|companies|company|firms?|businesses)$/i.exec(spelled.trim());
      if (ofOrg && ofOrg[1].toLowerCase().includes(head.head.toLowerCase().replace(/s$/, ""))) {
        spelled = ofOrg[1];
        rolePhrase = rolePhrase.replace(/\s+(?:of|at|from)\s+\S+$/i, "").trim() || rolePhrase;
        if (/^(?:startups?|scale-?ups?)$/i.test(ofOrg[2]) && !frame.target.company_stage) {
          frame.target.company_stage = openValue("startup", ofOrg[2], "startup", 0.8);
          notes.push(`"${ofOrg[2]}" names the company stage, not part of the role`);
        }
      }
    }
    const descriptor = openValue(
      spelled.toLowerCase(),
      rolePhrase,
      canonicalize(spelled) ?? singularPhrase(spelled, head.head, head.repairedFrom),
      head.confidence,
    );
    // A descriptor that only restates the entity type is not a descriptor.
    // "companies in Napier hiring quantity surveyors" was carrying
    // `category = "companies"` beside `entity_type = company`, which reads to
    // every later stage as a narrowing the user never asked for — a filter on
    // the word "companies". Null is the honest value, and the wording is not
    // lost: it stays in `entity_type.raw`, in `relation.subject`, in
    // `input.raw` and in the trace line below.
    //
    // Checked against BOTH forms because the plural and the singular are
    // listed independently: a plural the set happens to miss is still caught
    // by its normalized singular.
    generic = !narrowsTarget(descriptor.value) && !narrowsTarget(descriptor.normalized);
    if (generic) {
      notes.push(
        `"${phrase}" only restates the entity type, so it names no category — kept as entity_type=${entity} with no descriptor`,
      );
    } else if (entity === "person") frame.target.role = descriptor;
    else if (entity === "business" || entity === "company" || entity === "organization")
      frame.target.category = descriptor;
    else if (entity === "job") frame.target.category = descriptor;
    else if (entity === "investor") frame.target.category = descriptor;
    else frame.target.descriptors = [descriptor];
  }
  if (head.industry) {
    frame.target.industry = openValue(head.industry, head.industry, head.industry, 0.7);
  }
  if (frame.target.entity_type.value === "job") {
    for (const match of analysis.matchAll(/\b(?:React|TypeScript)\b/gi)) {
      const named = /^react$/i.test(match[0]) ? "React" : "TypeScript";
      if (!frame.target.technologies.some((t) => t.value === named)) {
        frame.target.technologies.push(openValue(named, match[0], named, 0.9));
      }
    }
  }
  const colloquialBrand = /\bd2c\s+(.+?)\s+(?:guys|people|folks)\b/i.exec(phrase);
  if (colloquialBrand && frame.target.entity_type.value === "company") {
    frame.target.entity_subtype = openValue("brand", colloquialBrand[0], "brand", 0.85);
    frame.target.industry = openValue(colloquialBrand[1].toLowerCase(), colloquialBrand[1], null, 0.75);
    frame.target.business_type = openValue("d2c", "D2C", "d2c", 0.9);
    frame.target.category = null;
  }
  // The claim to prove is the target itself — "marketing agencies in Bristol"
  // has to be shown to really be marketing agencies. The flags themselves are
  // the validator's, derived from the relation; this only names the claim.
  //
  // A generic head has no claim in it: "must really be a company" is true of
  // every company and asks a verifier for nothing.
  if (phrase && !generic) {
    const claim = singularPhrase(phrase, head.head).toLowerCase();
    const article = /^[aeiou]/.test(claim) ? "an" : "a";
    frame.evidence.reasons = [clamp(`must really be ${article} ${claim}`, 200)];
  }

  // 6b. An employer named after the target ("… at fintech companies") is the
  //     organization the person sits in — claimed here so the location parser
  //     cannot read it as a place.
  if (entity === "person") {
    const aff = detectAffiliation(work);
    if (aff) {
      // "at Stripe" names one employer; "at fintech companies" names a KIND of
      // employer, and storing that as a company would have the frame claim the
      // person works somewhere called "fintech companies". A recognized head
      // noun is what tells the two apart, and its modifier is the vertical.
      const kind = classifyHead(aff.company);
      const isClass = kind.kind === "company" || kind.kind === "business" || kind.kind === "organization";
      if (isClass) {
        if (kind.industry && !frame.target.industry) {
          frame.target.industry = openValue(kind.industry, aff.company, kind.industry, 0.7);
        }
        notes.push(`"${aff.company}" read as the kind of employer, not as a named company or a place`);
      } else {
        frame.organization_context.company = openValue(aff.company, aff.company, canonicalize(aff.company), 0.75);
        notes.push(`"${aff.company}" read as the employer of the target, not as a place`);
      }
      work = mask(work, aff.start, aff.end);
    }
  }

  // 7. The relation, from the tail only. Scanning the tail is what keeps the
  //    searcher's own verb ("I need 25 dentists") out of the relation slot and
  //    stops the object noun overwriting the target.
  const rel = detectRelation(work, head);
  const negatedRel = rel ? relationNegation(work, rel) : null;
  if (rel && negatedRel) {
    // The object may sit behind the negator ("offer no marketing services"),
    // where the relation's own reader stopped at the negative word.
    if (!rel.object && negatedRel.objectAt > 0) {
      const obj = takeObject(work, negatedRel.objectAt);
      if (obj.value) {
        rel.object = openValue(obj.value.toLowerCase(), obj.value, canonicalize(obj.value), 0.7);
        rel.end = Math.max(rel.end, obj.end);
      }
    }
    // "agencies that are NOT hiring", "engineers NOT looking for work",
    // "companies that offer NO marketing services".
    //
    // The relation is still what the sentence is about, but its polarity is
    // inverted, and a frame that recorded `hiring` here would hand retrieval
    // the exact opposite of the request. There is no `relation.negated` flag
    // on purpose: §12 made negation a constraint, so it lands as one and every
    // consumer reads polarity in one place.
    frame.constraints.push({
      field: "relation",
      operator: "neq",
      value: rel.type,
      unit: null,
      negated: true,
      raw: clamp(`${negatedRel.word} ${rel.raw}`.trim(), RAW_MAX),
      confidence: 0.75,
    });
    // The object is worth a filter of its own only when it says something the
    // relation does not. "not looking for work" names no second fact — work is
    // what `seeking_job` already means — whereas "offer no marketing services"
    // names the service being ruled out.
    if (rel.object && !EMPLOYMENT_OBJECT_RE.test(rel.object.value)) {
      const field = rel.type === "hiring" ? "hiring_for" : "service";
      frame.constraints.push({
        field,
        operator: "neq",
        value: rel.object.value,
        unit: null,
        negated: true,
        raw: clamp(`${negatedRel.word} ${rel.raw} ${rel.object.value}`.trim(), RAW_MAX),
        confidence: 0.7,
      });
      // The exclusion reader saw the same words earlier and, knowing nothing of
      // the verb in front of them, filed them as a category. Two filters over
      // one phrase would narrow the search twice, and the category one is the
      // wrong reading: these companies are not a kind of marketing service.
      const dup = rel.object.value.toLowerCase();
      frame.constraints = frame.constraints.filter(
        (c) => !(c.field === "category" && c.negated && String(c.value).toLowerCase() === dup),
      );
    }
    frame.relation.type = { value: "none", raw: null, confidence: 0.7 };
    frame.relation.direction = { value: "none", raw: null, confidence: 0.7 };
    frame.relation.object = null;
    work = mask(work, Math.min(negatedRel.start, rel.start), rel.end);
    notes.push(
      `"${negatedRel.word}" inverts the relation, so it is recorded as a filter against ${rel.type} rather than as that relation`,
    );
  } else if (rel) {
    frame.relation = {
      type: { value: rel.type, raw: rel.raw || null, confidence: rel.confidence },
      label: rel.label,
      object: rel.object,
      direction: { value: rel.direction, raw: rel.raw || null, confidence: rel.confidence },
    };
    if (rel.start >= 0 && rel.end > rel.start) work = mask(work, rel.start, rel.end);
    if ((rel.type === "hiring" || rel.type === "seeking_client") && entity === "person") {
      frame.organization_context.on_behalf_of_company = rel.type === "hiring" ? "yes" : "unknown";
    }
  } else if (RELATION_SIGNAL_RE.test(work) && !/\b(?:posted?|posts?)\s+(?:recently|lately|this\s+(?:week|month))\b/i.test(work)) {
    // Wording announces a relationship we could not read. That is `unknown`,
    // and it is a different statement from `none`.
    frame.relation.type = {
      value: "unknown",
      raw: RELATION_SIGNAL_RE.exec(work)?.[0] ?? null,
      confidence: 0.3,
    };
    frame.relation.direction = { value: "unknown", raw: null, confidence: 0.3 };
  } else {
    // No relationship was requested. Saying so with confidence is the entire
    // point of `none`: "restaurants in Lisbon" is a complete request.
    frame.relation.type = { value: "none", raw: null, confidence: 0.85 };
    frame.relation.direction = { value: "none", raw: null, confidence: 0.85 };
    frame.relation.object = null;
  }
  if (frame.constraints.some((c) => c.field === "funding_status" && c.negated) && frame.relation.type.value === "received_funding") {
    frame.relation.type = { value: "none", raw: null, confidence: 0.85 };
    frame.relation.direction = { value: "none", raw: null, confidence: 0.85 };
    frame.relation.object = null;
  }
  if (frame.constraints.some((c) => c.field === "funding_status" && c.negated) && /\braising\b/i.test(primaryRaw)) {
    frame.relation.type = { value: "seeking_funding", raw: "raising", confidence: 0.85 };
    frame.relation.direction = { value: "subject_to_object", raw: "raising", confidence: 0.85 };
    frame.relation.object = openValue("funding", "raising", "funding", 0.85);
    frame.constraints = frame.constraints.filter((c) => c.field !== "relation" && c.field !== "service");
  }
  if (frame.target.entity_type.value === "company" && /\bbrands?\b/i.test(frame.target.category?.value ?? "") &&
      frame.relation.type.value === "offers_service" && frame.relation.object && !frame.target.industry) {
    frame.target.industry = frame.relation.object;
  }

  // 7b. One relation settles the target's kind by itself: only a person seeks
  //      employment. "arborists looking for work" is a practitioner even where
  //      "arborists in Kent" could be a firm, so the relation overrules an
  //      ambiguous or unreadable head — and the descriptor moves from category
  //      to role with it, or the frame would describe a business with a job
  //      title.
  if (
    frame.relation.type.value === "seeking_job" &&
    entity !== "person" &&
    (head.ambiguous || head.kind === "unknown" || entity === "business")
  ) {
    frame.target.entity_type = {
      value: "person",
      raw: span(head.head),
      confidence: 0.8,
    };
    if (frame.target.category && !frame.target.role) {
      frame.target.role = frame.target.category;
      frame.target.category = null;
    }
    notes.push(
      `read the target as a person because it is looking for work — only a person is employed`,
    );
  }

  // 8. Location, from whatever words nobody else claimed.
  const loc = detectLocation(work, excluded);
  frame.location =
    loc.location ??
    modifierLocation ??
    (trailingPlace ? geoFor(trailingPlace, trailingPlace, "in", 0.4) : null);
  frame.locations = detectOrLocations(primaryRaw, frame.location);
  if (!frame.location) {
    const prefix = /^([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+){0,2})\s+(?:businesses|firms|shops|companies|brands|jobs|restaurants)\b/u.exec(primaryRaw);
    if (prefix) {
      const words = prefix[1].split(/\s+/);
      const place = words.length > 1 && strictPlace(words.at(-1)!) ? words.slice(0, -1).join(" ") : prefix[1];
      if (plausiblePlace(place)) frame.location = geoFor(place, place, "in", 0.5);
    }
  }
  if (frame.location && frame.target.entity_type.value === "business" && !frame.target.entity_subtype &&
      /^\s*[\p{Lu}][\p{L}'-]+\s+(?:[\p{Lu}][\p{L}'-]+\s+)?businesses\b/u.test(primaryRaw)) {
    frame.target.entity_subtype = openValue("local", null, "local", 0.6);
  }

  // 9. Deliverables, from the whole request — the cut segment included.
  const fields = fieldRequirements(analysis, deliverableTail);
  frame.required_fields = fields.required;
  if (frame.required_fields.some((f) => ["linkedin", "instagram", "facebook"].includes(f.value)) &&
      !frame.required_fields.some((f) => f.value === "socials")) {
    frame.required_fields.push(openValue("socials", null, "socials", 0.6));
  }
  frame.preferred_fields = fields.preferred;
  frame.contact_requirements = fields.required.filter((f) =>
    ["phone", "email", "address", "linkedin", "instagram", "facebook", "socials"].includes(f.value),
  );
  frame.verification = detectVerification(analysis);
  if (/\b(?:last|latest|recent|recently|this\s+(?:week|month)|active)\b[^.!?]{0,70}\b(?:social|posts?|posted|instagram|insta|facebook|linkedin)\b|\b(?:social|posts?|posted|instagram|insta|facebook|linkedin)\b[^.!?]{0,70}\b(?:last|latest|recent|recently|this\s+(?:week|month)|active)\b/i.test(analysis)) {
    if (!frame.verification.some((v) => /social post/i.test(v.label ?? ""))) {
      frame.verification.push({ kind: "other", label: "last social post date", raw: span(analysis) });
    }
  }
  frame.output = detectOutput(analysis);

  // A request that specifies deliverables at all implies two it never spells
  // out: a lead with no name is not a lead, and the answer to "verify this" is
  // the evidence. Only ever added beside fields the user did state, so a plain
  // "restaurants in Lisbon" stays free of requirements nobody asked for.
  const specified = frame.required_fields.length + frame.preferred_fields.length + frame.verification.length > 0;
  if (specified) {
    const has = (n: string) => frame.required_fields.some((f) => f.value === n);
    if (!has("name")) {
      frame.required_fields.unshift(openValue("name", null, "name", 0.6));
      notes.push("added name to the required fields — a lead without one cannot be contacted");
    }
    if (frame.verification.length > 0 && !has("evidence")) {
      frame.required_fields.push(openValue("evidence", null, "evidence", 0.6));
      notes.push("added evidence to the required fields — it is what a verification request asks to see");
    }
  }

  // 10. Compound subgoals: represent BOTH halves or do not claim to be
  //     compound. Depth-limited because each subgoal re-enters this function.
  if (parts.length > 1 && depth === 0) {
    const subgoals = parts.slice(0, 6).map((part) => {
      const sub = extractFrameDeterministic(part, { startedAt: started, depth: depth + 1 });
      return {
        raw: span(part) ?? "",
        target: sub.target,
        relation: sub.relation,
        location: sub.location,
        temporal: sub.temporal,
        constraints: sub.constraints,
      };
    });
    frame.compound.is_compound = true;
    frame.compound.subgoals = subgoals;
  } else if (uncertain) {
    // Second request announced, split not trustworthy. Marked compound with no
    // subgoals, which is what makes the clarification fire instead of silently
    // answering the first half.
    frame.compound.is_compound = true;
  }

  // 11. Task + mode.
  let relType = frame.relation.type.value as RelationType;
  // 11a. Activity capture (PRD V2 Phase 4 / P1-D): "companies doing solar
  // installation in Windhoek" — when the relation wording is a do/offer/provide
  // verb the deterministic reader cannot classify, its OBJECT is the requested
  // trade, not a mystery to clarify about. Implemented at the relation
  // evaluation ONLY (never in the shared ACTIVITY_VERB_TOKENS set — that
  // regressed place-span parsing; see SEARCH_EXECUTION_MAP.md P1-D).
  if ((relType === "unknown" || relType === "offers_service" || relType === "none") &&
      !frame.target.category && !frame.target.industry &&
      ["business", "company", "organization", "unknown"].includes(frame.target.entity_type.value)) {
    const activityMatch = /\b(?:doing|does|do|offering|offers|offer|providing|provides|provide|making|makes|make|running|runs|run)\s+((?:[a-z][a-z'-]*\s+){0,2}[a-z][a-z'-]*)\s*(?:\?|[.,;]|$|\s+(?:in|near|around|across|with|for)\b)/i.exec(frame.input.normalized);
    const activity = activityMatch?.[1]?.trim();
    const vague = !activity || /^(that|this|it|them|the same|something|stuff)\b/i.test(activity);
    const locValue = frame.location?.value?.toLowerCase() ?? null;
    if (activity && !vague && !(locValue && activity.toLowerCase().includes(locValue))) {
      frame.target.category = openValue(activity.toLowerCase(), activityMatch![0].trim(), null, 0.7);
      if (frame.target.entity_type.value === "unknown") {
        frame.target.entity_type = { value: "business", raw: "anyone doing " + activity, confidence: 0.7 };
        notes.push('"anyone doing X" reads as a business target (PRD V2 Phase 4)');
      }
      notes.push('activity "' + activity + '" read as the target category (PRD V2 Phase 4)');
      if (relType === "unknown") {
        // The wording described the target's trade, not a relationship.
        frame.relation.type = { value: "none", raw: "activity wording", confidence: 0.7 };
        relType = "none";
      }
    }
  }
  const mode = prospectingModeFor(relType, entity, frame.relation.label);
  frame.prospecting_mode = { value: mode.mode, raw: null, confidence: mode.confidence };

  // 11b. Evidence obligations follow mechanically from the relation, so set
  //      them here from the shared table rather than leaving the validator to
  //      repair every single frame. A run where every frame carries repairs is
  //      a run where the repairs that mean something are invisible.
  const obligation = EVIDENCE_BY_RELATION[relType];
  if (obligation) {
    frame.evidence.claim_evidence_required = obligation.claim;
    frame.evidence.intent_signal_required = obligation.intent;
  }
  if (relType === "investing_in" && /\b(?:actively|recent|recently|actual|current)\b/i.test(analysis)) {
    frame.evidence.intent_signal_required = true;
  }
  frame.task_type = {
    value: entity === "job" ? "job_discovery" : "lead_discovery",
    raw: null,
    confidence: entity === "unknown" ? 0.5 : 0.8,
  };

  // 12. Clarification — only for genuine blockers. An unfamiliar occupation is
  //     not one, and neither is an absent optional detail.
  // A readable entity is a target even when no words describe it further:
  // "who around Tromsø needs grant writing" names no noun, and the relation
  // and the place carry the request. Asking "what are you looking for?" there
  // is asking about the one part that was clear.
  const hasTarget = !!(
    frame.target.role ||
    frame.target.category ||
    frame.target.descriptors.length ||
    (frame.target.entity_type.value !== "unknown" && relType !== "none")
  );
  let reason: ClarificationReason | null = null;
  if (!hasTarget) reason = "missing_target";
  else if (relType === "unknown") reason = "unreadable_relation";
  else if (uncertain) reason = "compound_parse_uncertain";
  else if (
    relType === "none" &&
    frame.constraints.length === 0 &&
    !frame.quantity &&
    !frame.temporal &&
    !narrowsTarget(frame.target.category?.value) &&
    !narrowsTarget(frame.target.role?.value) &&
    !frame.target.industry
  ) {
    // "find businesses" is executable but unboundedly broad. One
    // high-information question is worth more than a million rows.
    reason = "underspecified_scope";
  }

  if (reason) {
    frame.clarification = {
      needed: true,
      fields:
        reason === "missing_target"
          ? ["target"]
          : reason === "unreadable_relation"
            ? ["relation"]
            : reason === "compound_parse_uncertain"
              ? ["compound"]
              : // Scope, not location: "people in london" already has a place and
                // is still too broad to run — what is missing is what KIND.
                ["target.scope"],
      reason,
      question: null,
    };
  }

  if (relType === "none") notes.push("no relationship was requested — relation=none, not unknown");
  if (relType === "unknown") notes.push("relation wording present but not readable deterministically");

  frame.meta = {
    extractor: "deterministic",
    provider: null,
    model: null,
    prompt_version: null,
    latency_ms: Date.now() - started,
    fallback_used: false,
    cached: false,
    repair: null,
    notes: notes.slice(0, 20),
  };

  return UnderstandingFrameSchema.parse(frame);
}

export {
  splitCompound,
  detectQuantity,
  detectTemporal,
  detectLocation,
  takeTargetPhrase,
  prep,
  coreSegment,
  detectUserContext,
};
