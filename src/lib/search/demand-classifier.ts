// =====================================================================
// Demand classification — the "opportunity, not job board" gate
//
// This is the single rule that defines the product: a lead is someone who
// WANTS work done. Not someone selling the same work. Not a list of other
// people's jobs. Not an article about the craft.
//
// It lives here (rather than inside one source) because the same four junk
// shapes turn up on every surface we read — Reddit, SERPs, forums, Discord
// listings, marketplaces — and fixing them per-source means fixing them
// twenty times and missing nineteen.
//
// The four rejects, in order of how often they fooled the old pipeline:
//   1. SELF-PROMOTION — "[FOR HIRE] Senior designer, $30/hr", "I will build
//      your website". These are our own competitors. Worse than useless: they
//      look like perfect matches to a keyword scorer because they contain
//      every craft term.
//   2. AGGREGATOR / LISTICLE — "20 best design agencies", "Weekly job thread",
//      "Openings at Sonova, Veeva, Canada Life…". One URL, many companies,
//      nobody to contact.
//   3. EDITORIAL — "How much does a designer cost?", dictionary entries,
//      tutorials. Matches the craft, contains no buyer.
//   4. SEEKER — "Looking for a job as a designer". Demand-shaped phrasing,
//      supply-side person.
//
// Everything else is scored on how explicitly the author states a need.
// =====================================================================

export type DemandVerdict = {
  /** True when someone is asking for work to be done. */
  isDemand: boolean;
  /** 0..1 — how confident, used to rank rather than to hard-gate. */
  confidence: number;
  /** Why, in the user's words. Shown in the UI as the match reason. */
  reason: string;
  /** Score adjustment applied by the caller. */
  boost: number;
  /** Set when rejected, so the debug payload can explain the drop. */
  rejectedAs?: "self_promotion" | "aggregator" | "editorial" | "seeker" | "no_signal";
};

// ── 1. self-promotion (a seller, not a buyer) ───────────────────────────────
// NOTE on [OFFER]: on r/slavelabour and r/DoneDirtCheap the convention is
// [TASK] = "I want this done" and [OFFER] = "I am offering my services".
// It was originally in the DEMAND list, and live data showed why that's wrong —
// "[Offer] I will Be Your Professional Virtual Assistant For $5 per hour"
// scored as a confirmed buyer. It's the seller side of our own market.
/**
 * Unambiguous third-party demand: the author wants to PAY someone. "DM me" and
 * similar reply-invitations are shared vocabulary between buyers and sellers,
 * so they must not outrank this.
 */
const THIRD_PARTY_ASK_RE =
  /(?:looking for|need|want|seeking|searching for|hiring|in search of)\s+(?:a|an|some|someone|any)?\s*[a-z]*\s*(?:designer|developer|writer|editor|marketer|photographer|illustrator|animator|consultant|freelancer|contractor|artist|videographer|copywriter)/i;

const SELF_PROMO_TAG_RE =
  /^\s*[[({]?\s*(for\s*hire|forhire|hire\s*me|available|portfolio|showcase|seeking\s*work|open\s*to\s*work|offer(?:ing)?|advert|promo|ad)\b/i;

const SELF_PROMO_PHRASE_RE = new RegExp(
  [
    // "I will design your logo" — the Fiverr gig shape.
    String.raw`\bi\s+will\s+(design|build|create|write|edit|develop|make|do)\b`,
    String.raw`\b(hire|dm|message|contact)\s+me\b`,
    String.raw`\bmy\s+(portfolio|rates|services|gigs?|work|prices)\b`,
    String.raw`\bavailable\s+for\s+(hire|work|freelance|projects)\b`,
    String.raw`\bopen\s+to\s+(work|opportunities)\b`,
    String.raw`\bi(?:'m|\s+am)\s+(?:a|an)\s+(?:freelance|experienced|senior|professional|expert)?\s*(?:designer|developer|writer|editor|marketer|consultant)\b`,
    String.raw`\bi\s+(?:offer|provide|specialize|specialise)\b`,
    String.raw`\b(?:starting|prices?|rates?)\s+(?:at|from)\s*[$€£]\s*\d`,
    String.raw`\bper\s+(?:hour|word|project|design)\s+rate\b`,
    String.raw`\b\d+\+?\s+years?\s+of\s+experience\b.{0,40}\b(?:available|contact|dm)\b`,
    // Agency CTAs aimed at the reader's business.
    String.raw`\bfor\s+your\s+(?:business|company|startup|brand)\b`,
    String.raw`\bwe\s+(?:design|build|develop|create)\s+(?:websites?|apps?|brands?)\b`,
    String.raw`\bbook\s+a\s+(?:free\s+)?(?:call|consultation|demo)\b`,
    String.raw`\bget\s+a\s+(?:free\s+)?quote\b`,
  ].join("|"),
  "i",
);

/**
 * Seller phrasing with no possible buyer reading. Unlike SELF_PROMO_PHRASE_RE
 * these are never rescued by a demand tag, because a buyer would never write
 * them: you cannot be hiring a writer AND offering to write for someone.
 */
const STRONG_SELF_PROMO_RE = new RegExp(
  [
    String.raw`\bi\s+will\s+(?:design|build|create|write|edit|develop|make|do|deliver|provide)\b`,
    // "Website built for you", "Logo designed for you"
    String.raw`\b(?:built|designed|made|written|created|developed)\s+for\s+you\b`,
    // "pay $200 only if you like it" — risk-reversal, a classic seller close
    String.raw`\bpay\s+(?:me\s+)?[$€£]?\d[\d,.]*\s*only\s+if\b`,
    String.raw`\bonly\s+pay\s+if\s+you\b`,
    String.raw`\b(?:no|zero)\s+upfront\s+(?:cost|payment|fee)\b`,
    String.raw`\bsatisfaction\s+guaranteed\b`,
    String.raw`\bmy\s+(?:portfolio|rates|services|gigs?)\b`,
    String.raw`\bdm\s+me\s+(?:to\s+)?(?:get|order|start|for\s+a\s+quote)\b`,
    String.raw`\bcommissions?\s+(?:are\s+)?open\b`,
    String.raw`\bslots?\s+available\b`,
  ].join("|"),
  "i",
);

// ── 2. aggregator / listicle (many companies, no single buyer) ──────────────
const AGGREGATOR_RE = new RegExp(
  [
    // "10 Best …", "Top 25 …"
    String.raw`^\s*(?:the\s+)?(?:top\s+)?\d{1,3}\s+(?:best|top|great|leading|amazing|popular)\b`,
    String.raw`\b(?:top|best)\s+\d{1,3}\s+\w+`,
    // Recurring board threads.
    String.raw`\b(?:weekly|monthly|daily|megathread|mega\s*thread|round\s*up|roundup)\b.{0,30}\b(?:thread|jobs?|hiring|listings?)\b`,
    String.raw`\b(?:jobs?|hiring|openings?|listings?|vacancies)\s+(?:thread|megathread|roundup|digest|newsletter|board)\b`,
    // "Openings at A, B, C, D" — the multi-company digest shape.
    String.raw`\bopenings?\s+at\b.{0,80},.{0,40},`,
    // Directory pages.
    String.raw`\b(?:directory|listings?\s+of|list\s+of)\s+\w+`,
    String.raw`\bservers?\s+tagged\s+with\b`,
    String.raw`\b(?:browse|explore)\s+\d{2,}\+?\s+\w+`,
  ].join("|"),
  "i",
);

/** Hosts that are inherently catalogues rather than a place a buyer posts. */
const AGGREGATOR_HOST_RE =
  /(disboard\.org|top\.gg|clutch\.co|goodfirms|designrush|g2\.com|capterra|trustpilot|producthunt\.com\/topics|\.wikipedia\.org|merriam-webster|dictionary\.com|indeed\.com\/career-advice)/i;

// ── 3. editorial (about the craft, not asking for it) ───────────────────────
const EDITORIAL_RE = new RegExp(
  [
    String.raw`^\s*(?:how|what|why|when|where|which)\s+(?:to|do|does|is|are|much|many)\b`,
    String.raw`\b(?:guide|tutorial|walkthrough|explained|explainer|101|checklist|template|cheat\s*sheet)\b`,
    String.raw`\b(?:definition|meaning)\s+(?:of|&)\b`,
    String.raw`\b(?:vs\.?|versus)\b.{0,30}\b(?:which|better|comparison)\b`,
    String.raw`\bcase\s+study\b`,
    String.raw`\b(?:reasons?\s+(?:to|not\s+to)|things\s+to\s+know)\b`,
    String.raw`\bhow\s+much\s+(?:does|do|is|are|should)\b`,
    String.raw`\b(?:my|a)\s+(?:thoughts|perspective|pov|take|notes|reflections)\s+(?:on|about)\b`,
    String.raw`\b(?:designer|dev|design)\s+notes\b`,
    String.raw`\b(?:fill\s+out|take)\s+(?:this\s+)?survey\b|\bsurvey\s*[:\-]\b`,
    String.raw`\b(?:day\s+in\s+the\s+life|ask\s+me\s+anything|ama\b|hot\s+take|unpopular\s+opinion)\b`,
  ].join("|"),
  "i",
);

// ── 4. job seeker (supply side using demand grammar) ────────────────────────
const SEEKER_RE = new RegExp(
  [
    String.raw`\blooking\s+for\s+(?:a\s+)?(?:job|work|role|position|opportunit)`,
    String.raw`\b(?:seeking|searching\s+for)\s+(?:a\s+)?(?:job|role|position|employment|opportunit)`,
    String.raw`\b(?:my|updated)\s+(?:resume|cv|portfolio)\b`,
    String.raw`\bcan\s+(?:anyone|someone)\s+(?:hire|refer)\s+me\b`,
    String.raw`\bneed\s+a\s+job\b`,
  ].join("|"),
  "i",
);

// ── demand signals, strongest first ─────────────────────────────────────────
type DemandRule = { re: RegExp; reason: string; boost: number; confidence: number };

const DEMAND_RULES: DemandRule[] = [
  {
    // Explicit board tag — the single most reliable signal that exists.
    // NOT "looking for": as a bare title prefix that's ordinary prose
    // ("Looking for advice"), and treating it as a tag scored every such post
    // as confirmed paid work. The dedicated "Looking to hire" rule below
    // handles it properly, because it requires an object (a/an/someone).
    re: /^\s*[[({]?\s*(hiring|paid|task|job|request|wtb|w\.?t\.?b)\b/i,
    reason: "Tagged as paid work",
    boost: 24,
    confidence: 0.95,
  },
  {
    re: /\b(?:urgently|asap|immediately|right\s+now|today|this\s+week)\b.{0,40}\b(?:need|looking\s+for|hiring|want)\b|\b(?:need|looking\s+for|hiring)\b.{0,40}\b(?:urgently|asap|immediately|by\s+(?:tomorrow|friday|monday))\b/i,
    reason: "Urgent stated need",
    boost: 22,
    confidence: 0.9,
  },
  {
    re: /\b(?:budget|willing\s+to\s+pay|paying|will\s+pay|can\s+pay)\b.{0,30}[$€£₹]?\s*\d|[$€£₹]\s*\d[\d,.]*\s*(?:\/|per\s+)?(?:hr|hour|project|month|k\b)/i,
    reason: "Named a budget",
    boost: 22,
    confidence: 0.9,
  },
  {
    re: /\b(?:we|our\s+(?:team|company|startup|business|agency|firm))\s+(?:are\s+)?(?:need|needs|looking\s+for|are\s+looking\s+for|want|require|requires|is\s+looking\s+for)\b/i,
    reason: "Company stated a need",
    boost: 20,
    confidence: 0.85,
  },
  {
    re: /\b(?:i|we)\s+(?:really\s+|urgently\s+)?(?:need|needs)\s+(?:a|an|some|someone|help)\b/i,
    reason: "Stated a personal need",
    boost: 18,
    confidence: 0.82,
  },
  {
    re: /\blooking\s+(?:for|to\s+hire)\s+(?:a|an|someone|somebody)\b/i,
    reason: "Looking to hire",
    boost: 18,
    confidence: 0.8,
  },
  {
    re: /\b(?:can\s+(?:anyone|someone)|anyone)\s+(?:recommend|suggest|know\s+(?:a|an|any)|point\s+me)\b|\bany\s+recommendations?\s+for\b|\brecommend\s+(?:a|an)\s+good\b/i,
    reason: "Asking for a recommendation",
    boost: 15,
    confidence: 0.75,
  },
  {
    re: /\b(?:need\s+(?:help|someone)\s+(?:with|to)|help\s+wanted|wanted:|who\s+can\s+(?:build|help|make|design|write))\b/i,
    reason: "Asking for help",
    boost: 15,
    confidence: 0.75,
  },
  {
    re: /\b(?:currently|still)\s+doing\s+(?:this|it)\s+manually\b|\bby\s+hand\s+(?:right\s+now|currently)\b|\b(?:spreadsheet|excel)\s+(?:hell|nightmare|mess)\b/i,
    reason: "Doing it manually — a buying trigger",
    boost: 14,
    confidence: 0.7,
  },
  {
    // The informal half of the market. Most demand is not posted as a job — it
    // is someone thinking out loud ("I'm looking to rebrand", "on the hunt for
    // an editor", "where can I find someone who does this"). These never carry
    // a hiring tag and were falling through every rule above, so the pipeline
    // saw only the formal, job-shaped side of the demand it was built to find.
    // Safe to keep broad: the seller/listicle/editorial rejects all run first.
    re: new RegExp(
      [
        String.raw`\bi(?:'m|\s+am)\s+looking\s+to\s+(?:build|create|make|launch|start|redesign|rebrand|revamp|automate|outsource|hire)\b`,
        String.raw`\bon\s+the\s+hunt\s+for\s+(?:a|an|some)\b`,
        String.raw`\bin\s+(?:the\s+)?need\s+of\s+(?:a|an|some)\b`,
        String.raw`\btrying\s+to\s+find\s+(?:a|an|someone|somebody)\b`,
        String.raw`\bwhere\s+(?:can|do)\s+i\s+find\s+(?:a|an|someone)\b`,
        String.raw`\bsuggestions?\s+for\s+(?:a|an)\b`,
        String.raw`\bknow\s+anyone\s+who\s+(?:can|does|could)\b`,
        String.raw`\bany(?:one|body)\s+(?:here\s+)?(?:that|who)\s+(?:can|could)\s+(?:help|do|build|make|design|write|edit)\b`,
        String.raw`\bhelp\s+me\s+(?:with|build|create|make|design|write|find)\b`,
      ].join("|"),
      "i",
    ),
    reason: "Informal ask for help",
    boost: 14,
    confidence: 0.72,
  },
  {
    re: /\b(?:rfp|request\s+for\s+proposal|open\s+to\s+(?:proposals|quotes|bids)|taking\s+(?:bids|quotes)|accepting\s+proposals)\b/i,
    reason: "Open request for proposals",
    boost: 20,
    confidence: 0.88,
  },
  {
    // "alternatives to" (plural) is at least as common as the singular.
    re: /\b(?:alternatives?\s+to|switching\s+(?:away\s+)?from|migrating\s+(?:away\s+)?from|moving\s+(?:off|away\s+from)|replacing|fed\s+up\s+with)\s+\w/i,
    reason: "Replacing an existing tool",
    boost: 16,
    confidence: 0.78,
  },
];

export type ClassifyInput = {
  title: string;
  body?: string;
  /** Used only to reject known catalogue hosts. */
  url?: string;
};

/**
 * Decide whether a piece of content represents someone asking for work.
 *
 * Order matters and is deliberate: REJECTS run before ACCEPTS, because seller
 * posts and listicles reliably contain demand grammar ("looking for clients",
 * "10 best agencies for when you need a designer"). Checking demand first and
 * rejecting second would let both straight through.
 */
export function classifyDemand(input: ClassifyInput): DemandVerdict {
  const title = (input.title || "").trim();
  const body = (input.body || "").trim();
  const full = `${title}\n${body}`;

  const reject = (rejectedAs: DemandVerdict["rejectedAs"], reason: string): DemandVerdict => ({
    isDemand: false,
    confidence: 0,
    reason,
    boost: 0,
    rejectedAs,
  });

  if (!title && !body) return reject("no_signal", "empty content");

  // ── rejects ──
  if (input.url && AGGREGATOR_HOST_RE.test(input.url)) {
    return reject("aggregator", "Catalogue or reference site, not a buyer");
  }
  if (SELF_PROMO_TAG_RE.test(title)) {
    return reject("self_promotion", "Seller advertising their own services");
  }
  if (AGGREGATOR_RE.test(title)) {
    return reject("aggregator", "List of many companies, no single buyer to contact");
  }
  if (SEEKER_RE.test(full)) {
    return reject("seeker", "Job seeker, not someone hiring");
  }
  if (EDITORIAL_RE.test(title)) {
    return reject("editorial", "Article about the topic, not a request for it");
  }
  // Unambiguous seller offers reject even when the post carries a demand tag.
  // Sellers do misuse the tags: "[TASK] Website built for you first — pay $200
  // only if you actually like it" is a pitch wearing a buyer's label. These
  // phrases have no buyer reading at all, so the tag can't rescue them.
  if (STRONG_SELF_PROMO_RE.test(full)) {
    return reject("self_promotion", "Seller pitching their own service");
  }
  // Weaker self-promo prose only counts when no explicit demand tag overrides
  // it — "[HIRING] … DM me your portfolio" is a buyer asking for portfolios.
  const hasDemandTag = DEMAND_RULES[0].re.test(title);
  // An explicit third-party ask has no seller reading — "looking for a
  // designer … DM me" is a BUYER inviting replies, not someone touting their
  // own service. Checked against the full text, not just the title, because a
  // picture post carries its ask in the transcribed body and its title is
  // something like "my latest".
  const explicitAsk = THIRD_PARTY_ASK_RE.test(full);
  if (!hasDemandTag && !explicitAsk && SELF_PROMO_PHRASE_RE.test(full)) {
    return reject("self_promotion", "Seller advertising their own services");
  }

  // ── accepts ──
  for (const rule of DEMAND_RULES) {
    if (rule.re.test(full)) {
      return {
        isDemand: true,
        confidence: rule.confidence,
        reason: rule.reason,
        boost: rule.boost,
      };
    }
  }

  return reject("no_signal", "No stated need — nobody is asking for anything here");
}

/**
 * Morphological variants of a craft term.
 *
 * This exists because of a real zero-result bug: the query "companies looking
 * for writers" produced skill="writers" (plural), while every actual post says
 * "writer" (singular) — so a boundary-exact match found nothing, anywhere.
 * Same trap for designers/designer, developers/developer, editing/editor.
 *
 * Kept deliberately narrow — regular plurals and the write/writer/writing
 * family only. A real stemmer would collapse "designer" into "design" and
 * reintroduce the substring problem this file exists to prevent.
 */
export function craftVariants(term: string): string[] {
  const t = (term || "").toLowerCase().trim();
  if (t.length < 3) return t ? [t] : [];
  const out = new Set<string>([t]);

  // Peel org-unit wrappers: "sales team" → also match "sales" / "sales rep".
  const peeled = t
    .replace(
      /\b(teams?|departments?|depts?|groups?|squads?|units?|functions?|organizations?|organisations?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (peeled && peeled !== t && peeled.length >= 3) {
    out.add(peeled);
    for (const v of craftVariants(peeled)) out.add(v);
  }

  // Common sales agent nouns — posts say "sales rep", not "sales team".
  if (peeled === "sales" || t === "sales") {
    for (const extra of ["sales rep", "salesperson", "sdr", "bdr", "account executive", "closer"]) {
      out.add(extra);
    }
  }

  // plural ↔ singular — never strip "sales" → "sale" (matches garage sales).
  const NOT_PLURAL = new Set(["sales", "ops", "analytics", "devops", "news", "graphics"]);
  if (t.endsWith("ies") && t.length > 4) out.add(`${t.slice(0, -3)}y`);
  else if (t.endsWith("ses") || t.endsWith("xes") || t.endsWith("ches") || t.endsWith("shes")) {
    out.add(t.slice(0, -2));
  } else if (t.endsWith("s") && !t.endsWith("ss") && !NOT_PLURAL.has(t)) out.add(t.slice(0, -1));
  else if (!NOT_PLURAL.has(t)) {
    out.add(`${t}s`);
    if (/[^aeiou]y$/.test(t)) out.add(`${t.slice(0, -1)}ies`);
  }

  const base = t.replace(/(?:ers?|ors?|ing)$/, "");
  if (base.length >= 5 && base !== t) {
    for (const suffix of ["er", "ers", "or", "ors", "ing"]) out.add(base + suffix);
  }

  if (base === t && t.length >= 5 && !/\s/.test(t) && !NOT_PLURAL.has(t)) {
    const stem = t.endsWith("e") ? t.slice(0, -1) : t;
    for (const suffix of ["er", "ers", "ing"]) out.add(stem + suffix);
  }

  return [...out].filter((v) => v.length >= 3);
}

/**
 * The PERSON noun for a craft — "design" -> "designer" — for use inside
 * natural-language asks like `looking for a ${x}`.
 *
 * Every source that phrases a query this way needs it, and getting it wrong is
 * silent: `qx.skill` holds the FIELD, so the un-converted version asks for
 * "looking for a design", which nobody writes, and the source returns zero
 * without erroring. That bug has now been found separately in the social dorks,
 * Lemmy, Bluesky and Hacker News.
 *
 * Two rules, both learned the hard way:
 *   - a term that is ALREADY an agent noun is returned untouched, because
 *     pluralising it produced "looking for a writers"
 *   - the singular is required, since the article "a" precedes it
 */
/** Irregular field → person noun. craftVariants("sales") invents "saleser". */
const PERSON_NOUN_IRREGULAR: Record<string, string> = {
  // "sales rep" is how LinkedIn/FB posts actually phrase hire asks —
  // "salesperson" is rarer and "saleser" was the previous broken derivation.
  sales: "sales rep",
  selling: "sales rep",
  crm: "CRM specialist",
  seo: "SEO specialist",
  devops: "DevOps engineer",
};

export function personNoun(skill: string, role?: string): string {
  const preferred = (role || skill || "").toLowerCase().trim();
  const raw = (skill || role || "").toLowerCase().trim();
  if (PERSON_NOUN_IRREGULAR[preferred]) return PERSON_NOUN_IRREGULAR[preferred];
  if (PERSON_NOUN_IRREGULAR[raw]) return PERSON_NOUN_IRREGULAR[raw];
  // A role like "Designer" is already what we want; prefer it when it is one.
  if (/(?:er|or|ist)$/.test(preferred)) return preferred;
  if (/(?:er|or|ist)$/.test(raw)) return raw;
  const agent = craftVariants(raw).find((t) => /(?:er|or)$/.test(t) && t !== raw);
  return agent ?? preferred ?? raw;
}

/**
 * Word-boundary craft match, tolerant of plural/singular and agent-noun forms.
 * Substring matching is what made "react" hit "reactivation" and "ai" hit
 * "email", so every variant is still boundary-anchored — we widen the term
 * list, never the matching rule. Returns the ORIGINAL term for the
 * "why this matched" line.
 */
export function matchesCraft(text: string, terms: string[]): string | null {
  const hay = ` ${(text || "").toLowerCase()} `;
  for (const term of terms) {
    for (const variant of craftVariants(term)) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(hay)) return term;
    }
  }
  return null;
}
