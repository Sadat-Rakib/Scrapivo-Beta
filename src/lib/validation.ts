import type { Lead } from "./scoring";
import type { ClassifiedQuery } from "./search/query-classifier";
import type { ExpandedQueries } from "./search/query-expander";
import { isStronglyRelevantToSkill, getStrongSkillSynonyms } from "./search/query-expander";
import { detectDemandBuckets, scoreUrgency, mentionsRemoteText } from "./search/intent-lexicon";

const EXPIRED_PHRASES = [
  "position filled",
  "no longer accepting",
  "[deleted]",
  "[removed]",
  "removed by moderator",
  "[ removed by moderator ]",
  "edit: filled",
  "found someone",
  "update: hired",
  "no longer hiring",
  "this listing has expired",
  "role has been filled",
];

const SCAM_PHRASES = [
  "no experience needed earn",
  "work from home earn $",
  "guaranteed income",
  "send your whatsapp",
  "earn $$$",
  "make money fast",
  "investment opportunity",
  "no interview required",
  "instant hire",
  "send bank details",
  "processing fee required",
  "registration fee",
  "pay to apply",
  "wire transfer",
  "crypto payment only",
  "telegram only",
  "whatsapp me to start",
  "earn $500/day",
  "earn $1000 a day",
  "no skills required earn",
  "training fee",
  "kit fee",
  "us bills",
  "not a money",
  "not money",
  "uncommon us bills",
  "dollar bills",
  "in exchange for exposure",
  "paid in exposure",
  "equity only",
];

/** Titles that imply senior / high YoE — filtered when preferJunior. */
const SENIOR_TITLE_RE =
  /\b(senior|sr\.?|staff|principal|lead|director|head of|vp|vice president|chief|10\+?\s*years|8\+?\s*years|7\+?\s*years|5\+?\s*years|mid[- ]?senior)\b/i;

const JUNIOR_TITLE_RE =
  /\b(junior|jr\.?|intern|internship|entry[- ]?level|new grad|graduate|associate|0[-–]1|0-2\s*years?|1\s*year|early career|apprentice)\b/i;

export type LeadFilterPrefs = {
  yearsExperience?: number | null;
  preferJunior?: boolean;
  /** Mid band: drop intern/junior-only and staff/principal extremes. */
  preferMid?: boolean;
  preferSenior?: boolean;
  preferRemote?: boolean;
  /** Server-side max age in hours for dated social (from clarifier). */
  maxAgeHours?: number;
  /** User explicitly answered YoE in clarifier — enforce on clients ATS too. */
  explicitExperience?: boolean;
  location?: string | null;
};

export function prefersJunior(prefs?: LeadFilterPrefs): boolean {
  if (prefs?.preferSenior) return false;
  if (prefs?.preferMid) return false;
  if (prefs?.preferJunior === false) return false;
  if (prefs?.preferJunior === true) return true;
  const y = prefs?.yearsExperience;
  return y == null || y <= 1;
}

export function isSeniorHeavyLead(lead: Lead): boolean {
  const title = lead.title || "";
  const snippet = lead.snippet || "";
  // Junior title wins even if snippet mentions seniority elsewhere.
  if (JUNIOR_TITLE_RE.test(`${title} ${snippet}`)) return false;
  // Title is the reliable signal — snippet "lead generation" must not trip \blead\b.
  if (SENIOR_TITLE_RE.test(title)) return true;
  return /\b((?:5|6|7|8|9|10)\+?\s*(?:years|yrs|yoe)|senior\s+(?:engineer|developer|designer|role|position|hire))\b/i.test(
    snippet,
  );
}

export function isJuniorFriendlyLead(lead: Lead): boolean {
  return JUNIOR_TITLE_RE.test(`${lead.title} ${lead.snippet}`);
}

export function mentionsRemote(lead: Lead): boolean {
  return mentionsRemoteText(`${lead.title} ${lead.snippet}`);
}

const STRONG_BUYER_SIGNALS = [
  "need a ",
  "need an ",
  "need someone",
  "need help with",
  "hiring",
  "we are hiring",
  "we're hiring",
  "seeking a",
  "want to hire",
  "looking to hire",
  "our team needs",
  "our startup needs",
  "our company needs",
  "job posting",
  "position available",
  "open role",
  "paid project",
  "paid gig",
  "work available",
  "contract available",
  "freelance needed",
  "help wanted",
  "can anyone recommend",
  "anyone know a good",
  "recommend a",
  "refer me",
  "dm me if",
  "apply here",
  "apply at",
  "[hiring]",
  "now hiring",
  // Hire-polarity "looking for" shapes only (not bare "looking for")
  "looking for a freelancer",
  "looking for an freelancer",
  "looking for a developer",
  "looking for an developer",
  "looking for a designer",
  "looking for someone to",
  "looking for a contractor",
  "looking for help with",
  "looking for a sales",
  "looking for an sales",
  "looking for a salesperson",
  "looking for a sales rep",
  "looking for a sales manager",
  "looking for a sales closer",
  "looking for a sales executive",
  "looking for an sdr",
  "looking for a bdr",
];

const SOFT_BUYER_SIGNALS = [
  "building",
  "launching",
  "working on",
  "starting",
  "founded",
  "we need",
  "i need",
  "anyone who",
  "someone who can",
  "recommendations",
  "suggestions",
  "any good",
  "does anyone know",
  "who should i",
  "which",
  "best for",
  "advice on",
  "help",
  "assist",
  "support",
  "budget",
  "pay",
  "paid",
  "project",
  "contract",
  "remote",
  "freelance",
];

const PROVIDER_SIGNALS = [
  "available for hire",
  "open to work",
  "i am a",
  "i'm a",
  "i am an",
  "i'm an",
  "hire me",
  "my portfolio",
  "my services",
  "i offer",
  "i provide",
  "i specialize",
  "check out my work",
  "my github",
  "my rates",
  "my rate is",
  "dm me for clients",
  "seeking clients",
  "looking for clients",
  "i will build",
  "i'll build",
  "i can build",
  "gig for you",
  "looking for a website or web application? i'm",
  "looking for a website? i'm",
  "hire me to",
  "dm me for work",
  "dm for projects",
  "taking on clients",
  "accepting clients",
  "book a call with me",
  "check out my gig",
  "order my gig",
  "i build websites for",
  "i design websites for",
  "freelance developer available",
  "developer for hire",
  "designer for hire",
  "available for freelance",
  "open for freelance",
  "commission open",
  "commissions open",
  "slots open for",
  "dm me your requirements",
  "dm me your project",
  "dm me your details",
  "partner to find",
  "find website clients",
  "commission-based partner",
  "commission based partner",
  "starting at $",
  "from only $",
  "book now",
  "slots available",
  "let's fix that room",
  "fix that room",
  "starting at $99",
  "try our agent",
  "try my agent",
  "i built an agent",
  "i built a tool",
  "check out our tool",
  "our ai agent",
  "pitching our",
  "we built a tool that",
  "introducing our",
  "launching our (new )?service",
];

/** Seller ads that open with a buyer hook then pitch themselves. */
const SELLER_HOOK_RE =
  /\b(looking for a (website|web app|developer|designer)\??\s*i['']?m|looking for a (freelance |web )?(developer|designer|website).{0,50}for your (business|company|startup)|if you are a (business )?(founder|owner)|dm me your (requirements|project|brief|details)|commission[- ]based partner|partner to find .{0,30}(clients|customers)|find website clients|i['']?m (a |an )?(freelance|developer|designer|web developer)|hire me to|i will build|check out my (portfolio|gig)|i build (websites?|apps?) for|my (fiverr|upwork) (gig|profile)|order (now|today) on fiverr|need a pro .{0,40} service|across the (uk|us|usa|europe)|get a quote|our web team|we (design|build|create) (websites?|web apps?|apps?)|looking for (clients|customers) for (our|my)|book a (free )?consultation|free consultation|dm (us|me) for (a )?quote|let'?s fix that room|fix that room you'?ve been|starting at\s*\$\d+|from only\s*\$\d+|book now|slots available|try (our|my) (ai )?agent|i built (an? |this )?(ai )?(agent|tool)|ask (our|the) agent who is hiring|who is hiring.{0,40}(try|use|check out) (our|my))\b/i;

/** Sales / partner / lead-gen titles — never a buyer for the user's skill. */
/**
 * Is the user themselves a salesperson / marketer / BD person?
 *
 * The sales-partner and off-skill guards below exist so a DESIGNER does not
 * see "Sales Closer at a Design Agency". When the user's craft IS sales, those
 * same titles are the product. Measured on a live "sales" demo search:
 * socialdorks returned LinkedIn/Instagram/Facebook rows and validate wiped
 * every one of them (offSkillRole:32) because these guards fired unconditionally.
 */
export function isSalesFamilyCraft(coreSkill: string, relatedSkills: string[] = []): boolean {
  const blob = `${coreSkill || ""} ${(relatedSkills || []).join(" ")}`.toLowerCase();
  return /\b(sales|selling|seller|sdr|bdr|closer|outbound|inbound|business\s*development|account\s*executive|ae\b|lead\s*gen(?:eration)?|revenue|crm|pipeline)\b/i.test(
    blob,
  );
}

/**
 * Commission-sales roles, which are never the user's craft — UNLESS the user's
 * craft is sales. See isSalesFamilyCraft.
 */
const SALES_PARTNER_TITLE_RE =
  /\b(commission[-\s](?:based|only)|(?:paid\s+)?per\s+sale|sales\s+(?:closer|partner|rep|representative|agent|associate|executive)|closers?\s+(?:needed|wanted)|appointment\s+setters?|cold[-\s]call(?:er|ers|ing)|partner to find|affiliate partner|lead generator|leads?\s+provided|find .{0,20}(clients|customers) for)\b/i;

/**
 * Prefer title + short body for intent checks — SERP snippets often glue
 * unrelated comment/job soup that injects false "need a" / "looking for".
 */
export function leadIntentText(lead: Pick<Lead, "title" | "snippet">): string {
  const title = (lead.title || "").trim();
  const body = (lead.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${title} ${body}`.trim();
}

/**
 * Third-party hire of sales talent ("Looking for a sales rep to join our
 * startup") — not a seller pitching sales services. Without this, SALES_PARTNER
 * titles short-circuit detectBuyerIntent / isHirePolarityLookingFor and wipe
 * every social sales lead for craft=sales.
 */
export function isSalesTalentHireAsk(text: string): boolean {
  if (!text) return false;
  if (SELLER_HOOK_RE.test(text)) return false;
  const salesRole =
    /\b(sales\s+(?:rep|representative|manager|closer|executive|associate|agent|strateg(?:y|ist)|ops|operations)|sdr|bdr|account\s+executive|appointment\s+setter|closer)\b/i;
  if (!salesRole.test(text)) return false;
  return (
    /\b(hiring|looking\s+for|looking\s+to\s+hire|need(?:ing)?\s+(?:a|an)|seeking|recommend(?:\s+a)?|join\s+our|wanted|needed|open\s+role|we(?:'| a)?re\s+hiring)\b/i.test(
      text,
    ) ||
    /\b(?:rep|manager|closer|executive|sdr|bdr).{0,40}\b(?:to\s+join|for\s+our|join\s+our)\b/i.test(
      text,
    )
  );
}

/**
 * Bare "looking for" is overloaded (seller CTAs, advice, partner hunts).
 * Only count hire-polarity shapes that are not seller CTAs.
 * Optional craftTerms: match "looking for a <lead generation|…>" for any skill.
 */
export function isHirePolarityLookingFor(text: string, craftTerms?: string[]): boolean {
  if (!text) return false;
  // Seller / partner CTAs first — except hiring sales talent into a team.
  if (SELLER_HOOK_RE.test(text)) return false;
  if (SALES_PARTNER_TITLE_RE.test(text) && !isSalesTalentHireAsk(text)) return false;
  if (
    /\bfor your (business|company|startup)\b/i.test(text) ||
    /\bdm me your\b/i.test(text) ||
    /\bpartner to find\b/i.test(text) ||
    /\bstarting at\s*\$\d+/i.test(text)
  ) {
    return false;
  }
  if (isSalesTalentHireAsk(text)) return true;
  if (/\blooking to hire\b/i.test(text)) return true;
  if (
    /\blooking for (a |an )?(freelance[rs]?|developer|designer|contractor|engineer|someone (to|who)|help with|web developer|web designer|sales(?:person| ?rep| ?manager| ?closer| ?executive)?|sdr|bdr|account executive)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  // Craft-aware — SERP dorks search "looking for a ${craft}" for any skill
  // (lead generation, copywriter, VA, …), not only hardcoded role nouns.
  if (craftTerms?.length) {
    for (const raw of craftTerms) {
      const t = (raw || "").trim();
      if (t.length < 3) continue;
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\blooking for (a |an )?[^\\n.]{0,48}${esc}\\b`, "i").test(text)) {
        return true;
      }
    }
  }
  // Hire-shaped follow-through (not bare "looking for a better way").
  return /\blooking for (a |an |someone ).{0,48}\b(to (help|build|design|write|manage|join|hire)|who (can|knows)|for (our|my|the)|asap|urgently|please)\b/i.test(
    text,
  );
}

const EDUCATIONAL_NOISE_RE =
  /\b(steps to|how to become|become a freelance|guide to|career path|career in|tutorial|learn to|getting started with|how (have|do|did) you .{0,40}(find|get|land) (jobs?|clients?|work)|managed to find jobs|their rates|real pay|how they really feel|feel about ai|lessons? (i|we) learned|what i wish i knew|tips for (new|junior)|portfolio review|case study:|behind the (design|scenes)|unpaid design tests|hiring trend|strong belief|emotion\s*=\s*good|so you need a designer|thoughts on (hiring|design)|a hiring trend|best practices for|complete guide|101:|for beginners|explained\b|what is (a |an )?\w+|my journey (as|to)|day in the life)\b/i;

const JOB_LIST_PAGE_RE =
  /\b(hiring now:\s*\d+|jobs for (january|february|march|april|may|june|july|august|september|october|november|december)|\d+\s+(part[- ]?time|remote|freelance|full[- ]?time)\s+\w+\s+jobs|browse \d+ .+ jobs|freelance jobs:\s*work remote|\d{2,}\s+(remote\s+)?jobs\b|\d{1,3}(,\d{3})*\+?\s+.{0,60}\b(jobs|openings|gigs)\b|top \d+ (freelance|remote|web) jobs|best (freelance|remote) (jobs|websites) (for|in)|best .{0,50} jobs\b|jobs online\b|web(site)? development jobs\b|web(site)? developer jobs\b|freelance .{0,40} (jobs|openings) in\b|job board|jobs aggregator|latest job openings)\b/i;

const MARKETPLACE_LISTICLE_RE =
  /\b(\d+\+?\s*best[- ]rated|best[- ]rated .{0,40} services|services near you|top \d+ .{0,40} (services|agencies|companies|freelancers)|best rated .{0,30} (services|agencies)|15\+?\s*best|their rates.? real pay|how they really feel about)\b/i;

/** Wrong craft when user searched generic design / web design / UI. */
const DESIGN_ADJACENCY_DENY_RE =
  /\b(interior design(?:er)?|sculptor|mold caster|3d print(?:er|ing)|motion graphics|3d animation|character design|graphic novel|concept artist|industrial design(?:er)?|room makeover|home staging|explainer videos?|carport|renovat(?:e|ion)|enclose a|landscape design(?:er)?|backyard redesign|prosthetic|jeans artist|fashion design(?:er)?|apparel design|tattoo artist|furniture design|architecture (?:firm|studio)|architect(?:ure)?\b|construction|contractor to (?:build|enclose|renovate))\b/i;

/** Roles that are clearly NOT the user's skill family (title-level reject).
 *  NOTE: "graphic designer" is NOT here — it's on-skill for design searches
 *  and was wiping every design SERP/Upwork hit via isOffSkillRole. */
const OFF_SKILL_TITLE_RE =
  /\b(3d artist|3d modeler|seo strategist|seo specialist|seo manager|video editor|data scientist|devops engineer|machine learning|ml engineer|product manager|sales (rep|manager|engineer)|account (executive|manager)|cybersecurity|cyber security|info(rmation)? security|pre[- ]?sales|lead generator|commission[- ]based|nurse|accountant|bookkeeper|electrician|plumber|interior design(?:er)?|sculptor|mold caster|3d print(?:er|ing)|motion graphics|3d animation|character design|graphic novel|concept artist)\b/i;

const DESIGN_FAMILY_RE =
  /\b(design|designer|web design|ui|ux|ui\/?ux|product design|graphic design|branding|figma|logo)\b/i;

const PRODUCT_BUYER_SIGNALS = [
  "recommend",
  "recommendation",
  "suggestions",
  "any good",
  "best tool",
  "alternative to",
  "need a",
  "anyone use",
  "what do you use",
];

export const JOB_BOARD_SOURCES = new Set([
  "upwork",
  "remoteok",
  "greenhouse",
  "lever",
  "indeed",
  "glassdoor",
  "google_jobs",
  "wellfound",
  "weworkremotely",
  "remotive",
  "jobicy",
  "arbeitnow",
  "themuse",
  "usajobs",
  "samgov",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "githubjobs",
]);

export function detectBuyerIntent(text: string): {
  isBuyer: boolean;
  confidence: "high" | "medium" | "low";
  matchedSignals: string[];
} {
  const lower = text.toLowerCase();
  // Hiring a salesperson is buyer intent for craft=sales — must win before the
  // sales-partner short-circuit below (which exists for design/dev searches).
  if (isSalesTalentHireAsk(text)) {
    return { isBuyer: true, confidence: "high", matchedSignals: ["sales talent hire"] };
  }
  // Seller/provider wins over buyer-hook phrasing ("Looking for a Website? I'm…").
  if (
    PROVIDER_SIGNALS.some((s) => lower.includes(s)) ||
    SELLER_HOOK_RE.test(text) ||
    SALES_PARTNER_TITLE_RE.test(text)
  ) {
    const clearThirdParty =
      /\b(need someone to|who can (build|help|make)|willing to pay|our (startup|company|team) needs|looking to hire)\b/i.test(
        text,
      );
    if (!clearThirdParty) {
      return { isBuyer: false, confidence: "high", matchedSignals: [] };
    }
  }

  const urgency = scoreUrgency(lower);
  const demand = detectDemandBuckets(lower);
  if (urgency.hasUrgency && demand.buckets.length > 0) {
    return {
      isBuyer: true,
      confidence: "high",
      matchedSignals: [
        ...urgency.phrases.slice(0, 2),
        ...(demand.phrases[demand.primary!] ?? []).slice(0, 2),
      ],
    };
  }

  const strongMatches = STRONG_BUYER_SIGNALS.filter((s) => lower.includes(s));
  const hireLooking = isHirePolarityLookingFor(text);
  if (strongMatches.length >= 1 || hireLooking) {
    return {
      isBuyer: true,
      confidence: "high",
      matchedSignals: hireLooking
        ? [...strongMatches, "looking for (hire)"].slice(0, 4)
        : strongMatches,
    };
  }

  if (demand.primary === "hiring" || demand.primary === "explicit_demand") {
    return {
      isBuyer: true,
      confidence: "high",
      matchedSignals: demand.phrases[demand.primary] ?? [],
    };
  }

  const softMatches = SOFT_BUYER_SIGNALS.filter((s) => lower.includes(s));
  // Soft pairs alone were letting tutorials through ("project"+"remote").
  // Require 3 soft hits, or urgency + 2 soft, unless a demand bucket fired.
  if (softMatches.length >= 3 || (urgency.hasUrgency && softMatches.length >= 2)) {
    return { isBuyer: true, confidence: "medium", matchedSignals: softMatches };
  }

  return { isBuyer: false, confidence: "low", matchedSignals: [] };
}

export function detectProductIntent(text: string): boolean {
  const lower = text.toLowerCase();
  if (PROVIDER_SIGNALS.some((s) => lower.includes(s))) return false;
  if (PRODUCT_BUYER_SIGNALS.some((s) => lower.includes(s))) return true;
  // Customer-pain language for product pitches (invoice/client-hunt etc.).
  return /\b(struggling with|need help with|looking for (a |an )?(tool|app|software|way to)|anyone know (a|how)|how do (you|i) (find|manage|track|invoice)|recommend .{0,20}(tool|app|software))\b/i.test(
    lower,
  );
}

const GENERIC_ROLE_TOKENS = new Set([
  "engineer",
  "developer",
  "designer",
  "manager",
  "specialist",
  "consultant",
  "analyst",
  "architect",
  "freelancer",
  "contractor",
  "professional",
  "expert",
  "lead",
  "senior",
  "junior",
  "intern",
]);

/** Role queries must match the core skill or a primary related term — not generic role words alone. */
export function isRelevantToRoleQuery(
  text: string,
  coreSkill: string,
  relatedSkills: string[],
): boolean {
  const lower = text.toLowerCase();
  const syns = getStrongSkillSynonyms(coreSkill);
  const matchedSyns = syns.filter((t) => lower.includes(t.toLowerCase()));
  const specificMatches = matchedSyns.filter((t) => !GENERIC_ROLE_TOKENS.has(t.toLowerCase()));
  if (specificMatches.length > 0) return true;
  return relatedSkills.slice(0, 5).some((s) => {
    const sl = s.toLowerCase();
    return sl.length > 2 && !GENERIC_ROLE_TOKENS.has(sl) && lower.includes(sl);
  });
}

export function isRelevantToQuery(
  lead: Lead,
  coreSkill: string,
  relatedSkills: string[],
  classified?: ClassifiedQuery,
): boolean {
  const text = `${lead.title} ${lead.snippet} ${lead.ai_summary ?? ""}`;
  // Startup feeds for investor deal-flow — identity is the signal.
  if (
    (lead.source === "dealroom" ||
      lead.source === "neuronfeed" ||
      lead.source === "startupsgallery") &&
    /investor|fundraising|raising/i.test(`${coreSkill} ${classified?.raw || ""}`)
  ) {
    return true;
  }
  // Clients / buyer demand: core skill, then top related skills (avoid zeroing
  // skill-adjacent buyer posts while still rejecting bare "web"/"development").
  if (classified?.goal === "clients" || classified?.signalMode === "buying_signal") {
    // Sales / lead-gen craft: require phrase-level sales-family language.
    // Never fall back to isStronglyRelevantToSkill(coreSkill) when coreSkill
    // is "lead generation…" — that used to admit "Team Lead" / "Lead Guitarist".
    if (isSalesFamilyCraft(coreSkill, relatedSkills)) {
      const salesHit =
        /\b(sales|selling|salesperson|sales\s*rep|sdr|bdr|closer|outbound|inbound|account\s*executive|\bae\b|business\s*development|lead\s*gen(?:eration)?|lead[- ]gen|lead[- ]sourc(?:e|ing)|appointment\s*sett(?:er|ing)|prospecting|pipeline|quota|crm|cold[-\s]?call|client\s*acquisition|revenue|verified\s+leads?|(?:need|want|buy|buying|looking for|generate|generating)\s+(?:\d+\s+)?(?:qualified\s+)?leads?|lead[- ]focused|meta\s*ads?\s*lead|google\s*ads?\s*lead)\b/i.test(
          text,
        );
      if (!salesHit) return false;
      // Job-title "Lead …" that is NOT lead-gen / sales.
      if (
        /\b(lead\s+(guitar|guitarist|vocalist|singer|man|product|designer|developer|engineer|architect|pastor|pastorate)|team\s+lead|tech(?:nical)?\s+lead|site\s+lead|engineering\s+lead|social\s+media\s+lead)\b/i.test(
          `${lead.title}`,
        ) &&
        !/\b(lead\s*gen|lead\s*generation|sales|sdr|bdr|outbound|appointment)\b/i.test(text)
      ) {
        return false;
      }
      if (
        /\b(full[- ]?stack|software engineer|frontend|front[- ]end|backend|back[- ]end|react|next\.?js|vue|angular|devops|machine learning|data scientist|ui\/?ux designer|graphic designer|guitarist|bassist|drummer|vocalist|band)\b/i.test(
          `${lead.title}`,
        ) &&
        !/\b(sales|sdr|bdr|closer|account executive|lead\s*gen)\b/i.test(`${lead.title}`)
      ) {
        return false;
      }
      return true;
    }
    if (isStronglyRelevantToSkill(text, coreSkill)) return true;
    // Use more related skills — "design" expands to web/UI/graphic/logo/Figma.
    return relatedSkills
      .slice(0, 8)
      .some(
        (s) =>
          s.length > 3 &&
          !/^(lead|leads|generation|service|services|client|clients)$/i.test(s) &&
          isStronglyRelevantToSkill(text, s),
      );
  }
  if (classified?.type === "product") {
    const terms = [coreSkill, ...relatedSkills].filter(Boolean);
    const lower = text.toLowerCase();
    // Prefer multi-word / specific phrases — never bare lead/services/generation.
    const phraseHit = terms.some((t) => {
      const tl = t.toLowerCase().trim();
      if (tl.length < 4) return false;
      if (/^(lead|leads|generation|service|services|client|clients)$/i.test(tl)) return false;
      if (/\s/.test(tl) || tl.length >= 8) return lower.includes(tl);
      return new RegExp(
        `(?<![a-z0-9+#])${tl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`,
      ).test(lower);
    });
    if (phraseHit) return true;
    const tokens = new Set<string>();
    for (const t of terms) {
      for (const w of t.toLowerCase().split(/\s+/)) {
        if (w.length < 5) continue;
        if (
          /^(with|from|that|this|help|need|find|more|manage|lead|leads|generation|service|services|client|clients)$/i.test(
            w,
          )
        ) {
          continue;
        }
        tokens.add(w);
        if (w === "invoice") tokens.add("invoicing");
        if (w === "invoicing" || w === "invoices") {
          tokens.add("invoice");
          tokens.add("invoicing");
        }
      }
    }
    if ([...tokens].some((w) => new RegExp(`(?<![a-z0-9+#])${w}(?![a-z0-9])`).test(lower))) {
      return true;
    }
    if (lead.source === "stackexchange" || lead.source === "freelancer") {
      return /invoice|invoicing|billing|client acquisition|freelance|crm|saas|accounting|bookkeep|lead\s*gen/i.test(
        lower,
      );
    }
    return false;
  }
  if (classified?.type === "role") {
    return isRelevantToRoleQuery(text, coreSkill, relatedSkills);
  }
  if (isStronglyRelevantToSkill(text, coreSkill)) return true;
  return relatedSkills.slice(0, 5).some((s) => isStronglyRelevantToSkill(text, s));
}

export function isEducationalNoise(lead: Lead): boolean {
  return EDUCATIONAL_NOISE_RE.test(`${lead.title} ${lead.snippet}`);
}

/**
 * Sources we fetch from a marketplace's OWN API, where every row is one client
 * describing one project they want done and will pay for.
 *
 * These hosts also appear in three separate aggregator blocklists, because as
 * a HOST "freelancer.com" is indistinguishable from Indeed or Glassdoor. As a
 * SOURCE it is the opposite: not a repost of someone else's job ad, but the
 * product's core lead shape. That distinction was missed in all three places,
 * and each one silently deleted the entire Freelancer integration on its own —
 * isEmploymentShapedLead, URL_BLOCKLIST, and isJobListPage below. Fixing two of
 * them changed nothing, because the third still dropped every row.
 *
 * Anything arriving from a SERP still gets host-matched normally; only our own
 * API rows are exempt.
 */
export const FIRST_PARTY_MARKETPLACE_SOURCES = new Set(["freelancer", "upwork"]);

export function isJobListPage(lead: Lead): boolean {
  const url = (lead.full_post_url || "").toLowerCase();
  const text = leadIntentText(lead);
  const fullSnippet = lead.snippet || "";
  if (FIRST_PARTY_MARKETPLACE_SOURCES.has(lead.source)) return false;
  if (
    /toptal\.com|freelancer\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|simplyhired\.com|dice\.com|linkedin\.com\/jobs\/collections|linkedin\.com\/jobs\/search/.test(
      url,
    )
  ) {
    return true;
  }
  // Aggregator dumps with markdown company/role headers
  const mdHeaders = (fullSnippet.match(/^#{2,4}\s+/gm) || []).length;
  if (mdHeaders >= 2) return true;
  // Pasted job-board soup: multiple [Hiring] markers in one snippet
  const hiringMarks = (fullSnippet.match(/\[hiring\]/gi) || []).length;
  if (hiringMarks >= 2) return true;
  // Aggregator /jobs index without a single job deep-link id
  if (
    /\/jobs\/?(?:\?|$|#)/.test(url) &&
    !/linkedin\.com\/posts\//.test(url) &&
    !/upwork\.com\/jobs\/~/.test(url) &&
    !/workatastartup\.com\/jobs\/\d+/.test(url)
  ) {
    return true;
  }
  if (
    /\/jobs?[\/?#]/.test(url) &&
    !/linkedin\.com\/posts\//.test(url) &&
    !/@/.test(lead.title || "")
  ) {
    // Keep named Role @ Company; drop bare list pages
    if (!/\b(inc|llc|ltd|labs|studio|agency|corp)\b/i.test(text)) {
      return JOB_LIST_PAGE_RE.test(text) || /\/jobs\/?$/.test(url.split("?")[0]);
    }
  }
  return JOB_LIST_PAGE_RE.test(text) || JOB_LIST_PAGE_RE.test(`${lead.title} ${lead.snippet}`);
}

/** Marketplace / “best N services” listicles — never a single buyer lead. */
export function isMarketplaceOrListicle(lead: Lead): boolean {
  const text = `${lead.title} ${lead.snippet}`;
  const url = (lead.full_post_url || "").toLowerCase();
  if (MARKETPLACE_LISTICLE_RE.test(text)) return true;
  // SERP profile / directory noise that looks like a hire but isn't.
  if (
    /\b(top \d+|best \d+|list of|directory of|freelance platforms?|how to find|hire the best)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /linkedin\.com\/in\//i.test(url) &&
    !/\b(hiring|looking for|need a|we're hiring)\b/i.test(text)
  ) {
    return true;
  }
  if (
    /\/(tag|category|topics?|search)\//i.test(url) &&
    !/\b(hiring|need a|looking for)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

/** Explicit seller/provider pitch — never a client lead. */
export function isSellerOrProviderLead(
  lead: Lead,
  coreSkill?: string,
  relatedSkills: string[] = [],
): boolean {
  const text = leadIntentText(lead);
  const lower = text.toLowerCase();
  const title = lead.title || "";
  const url = (lead.full_post_url || "").toLowerCase();
  const salesCraft = isSalesFamilyCraft(coreSkill || "", relatedSkills);
  if (
    /fiverr\.com\/[^/]+\/[^/?#]+/.test(url) &&
    !/\b(need|looking for|hiring|request)\b/i.test(text)
  ) {
    return true;
  }
  if (/fiverr\.com\/categories\//.test(url)) return true;
  // Sales-shaped titles are seller-noise for a designer — and the ASK for a
  // salesperson. Skip the partner regex when the craft is sales.
  if (SELLER_HOOK_RE.test(text) || SELLER_HOOK_RE.test(title)) return true;
  if (!salesCraft && (SALES_PARTNER_TITLE_RE.test(text) || SALES_PARTNER_TITLE_RE.test(title))) {
    return true;
  }
  // Price-floor service ads without third-party hire intent
  if (
    /\bstarting at\s*\$\d+/i.test(title) &&
    !/\b(need someone to|looking to hire|who can|willing to pay|\[hiring\])\b/i.test(title)
  ) {
    return true;
  }
  if (PROVIDER_SIGNALS.some((s) => lower.includes(s))) {
    const clearThirdParty =
      /\b(need someone to|who can (build|help|make)|willing to pay|our (startup|company|team) needs|looking to hire)\b/i.test(
        text,
      );
    if (!clearThirdParty) return true;
  }
  // Product / SaaS pitches about "our lead gen tool" are sellers, not buyers.
  if (
    /\b(our|my|introducing|meet|check out)\b.{0,40}\b(lead\s*gen(?:eration)?|social listening|finds buyers)\b/i.test(
      text,
    ) ||
    /\b(lead\s*gen(?:eration)?|social listening)\b.{0,40}\b(tool|platform|software|saas|app)\b/i.test(
      text,
    )
  ) {
    if (!/\b(need|looking for|hiring|willing to pay|who can)\b/i.test(title)) return true;
  }
  return false;
}

/** Title is clearly a different occupation than the user's skill. */
export function isOffSkillRole(
  lead: Lead,
  coreSkill: string,
  relatedSkills: string[] = [],
): boolean {
  const title = lead.title || "";
  const body = `${title} ${lead.snippet || ""}`;
  const skill = (coreSkill || "").toLowerCase().trim();
  const familyText = `${skill} ${(relatedSkills || []).join(" ")}`;
  const designFamily = DESIGN_FAMILY_RE.test(familyText);
  const salesCraft = isSalesFamilyCraft(skill, relatedSkills);

  // Sales / partner / lead-gen titles: drop for every craft EXCEPT sales.
  if (!salesCraft && SALES_PARTNER_TITLE_RE.test(title)) return true;

  // Sales craft: drop software/design/music role titles that aren't sales roles.
  if (
    salesCraft &&
    /\b(full[- ]?stack|software engineer|frontend|front[- ]end|backend|back[- ]end|react developer|next\.?js|vue|angular|devops|machine learning|data scientist|ui\/?ux|graphic design(?:er)?|web developer|mobile (dev|developer)|ios engineer|android engineer|guitarist|bassist|drummer|vocalist|keyboard(?:ist)?|rhythm guitar|lead guitar|band seeking|band wants)\b/i.test(
      title,
    ) &&
    !/\b(sales|sdr|bdr|closer|account executive|ae\b|business development|lead\s*gen)\b/i.test(
      title,
    )
  ) {
    return true;
  }
  // Job-title "Lead …" collisions for lead-gen / sales crafts.
  if (
    salesCraft &&
    /\b(lead\s+(guitar|guitarist|vocalist|singer|man|product|designer|developer|engineer|architect)|team\s+lead|tech(?:nical)?\s+lead|site\s+lead|engineering\s+lead|social\s+media\s+lead)\b/i.test(
      title,
    ) &&
    !/\b(lead\s*gen|lead\s*generation|sales|sdr|bdr|outbound)\b/i.test(body)
  ) {
    return true;
  }

  // Design searches: keep web/UI/graphic/product designers; only deny adjacent crafts.
  if (designFamily) {
    if (DESIGN_ADJACENCY_DENY_RE.test(body)) return true;
    if (
      /\b((web|ui|ux|ui\/ux|product|graphic|visual|brand|logo)\s*)?design(?:er|ing)?\b/i.test(title)
    ) {
      return false;
    }
  } else if (
    /^(design|designer|web design|ui|ux|ui\/ux|product design)$/i.test(skill) &&
    DESIGN_ADJACENCY_DENY_RE.test(body)
  ) {
    return true;
  }

  // OFF_SKILL_TITLE_RE lists "sales (rep|manager|engineer)" so a designer does
  // not get sales roles. When the craft IS sales, that entry would delete the
  // entire result set — strip sales terms from the matcher for this call.
  const offSkillRe = salesCraft
    ? /\b(3d artist|3d modeler|seo strategist|seo specialist|seo manager|video editor|data scientist|devops engineer|machine learning|ml engineer|product manager|account (executive|manager)|cybersecurity|cyber security|info(rmation)? security|nurse|accountant|bookkeeper|electrician|plumber|interior design(?:er)?|sculptor|mold caster|3d print(?:er|ing)|motion graphics|3d animation|character design|graphic novel|concept artist)\b/i
    : OFF_SKILL_TITLE_RE;
  if (!offSkillRe.test(title)) return false;

  // Related-skill title hits are on-skill (e.g. "Figma" for a design search).
  const relatedHit = (relatedSkills || []).some(
    (s) => s.length > 2 && title.toLowerCase().includes(s.toLowerCase()),
  );
  if (relatedHit) return false;

  const employmentShaped =
    JOB_BOARD_SOURCES.has(lead.source) ||
    /linkedin\.com\/jobs\//i.test(lead.full_post_url || "") ||
    /\b(hiring|job opening|we'?re hiring|position|vacancy)\b/i.test(title);
  if (employmentShaped) return true;
  return !isStronglyRelevantToSkill(body, coreSkill);
}

export function hasExpiredSignal(lead: Lead): boolean {
  const text = `${lead.title} ${lead.snippet}`.toLowerCase();
  return EXPIRED_PHRASES.some((phrase) => text.includes(phrase));
}

export function isLikelyScam(lead: Lead): boolean {
  const text = `${lead.title} ${lead.snippet}`.toLowerCase();
  return (
    SCAM_PHRASES.some((phrase) => text.includes(phrase)) ||
    /\${2,}/.test(text) ||
    /!{3,}/.test(text)
  );
}

/** Personal anecdotes / seeker stories that match a skill keyword but aren't leads. */
const PERSONAL_STORY_RE =
  /\b(taking a break|looking for (some )?advice|recently started a role|my store|chick[- ]?fil[- ]?a|for (chick|workers)|browse \d+ new .+ jobs in|just sharing|my journey|r\/\w*workers|how (have|do|did) you .{0,40}(find|get|land) (jobs?|clients?|work)|how i (got|broke|started|landed)|managed to find jobs|what would stop you from|would you hire|poll[: ]|unpopular opinion|my (thoughts|perspective|pov|take|notes|experience|story|opinion|bio|background) (on|about|with|in)|designer notes|dev notes|a day in the life|ama\b|ask me anything|survey[: ]|fill (out |in )?(this |my )?survey|rate (my|this)|roast my|critique my|feedback on my|looking for feedback|share your (experience|thoughts)|what do you think about|hot take|unpopular|vent[: ]|rant[: ]|here(?:'| i)?s my (story|experience|journey)|i(?:'| a)?ve been (in|doing) .{0,40} for \d+|career advice|resume review|linkedin (profile|headline) tips)\b/i;

export function isPersonalStoryNoise(lead: Lead): boolean {
  const text = leadIntentText(lead);
  if (PERSONAL_STORY_RE.test(text)) return true;
  if (PERSONAL_STORY_RE.test(lead.title || "")) return true;
  if (/reddit\.com\/r\/\w*workers/i.test(lead.full_post_url || "")) return true;
  // Title is clearly a personal essay / notes dump, not an opportunity ask.
  if (
    /\b(notes|thoughts|reflections|journal|diary|memoir|perspective|pov)\b/i.test(
      lead.title || "",
    ) &&
    !/\b(hiring|looking for|need a|need an|who can|willing to pay|\[hiring\]|budget)\b/i.test(
      `${lead.title} ${lead.snippet}`,
    )
  ) {
    return true;
  }
  return false;
}

const LOCATION_ALLOW: Record<string, string[]> = {
  india: [
    "india",
    "indian",
    "bharat",
    "mumbai",
    "bangalore",
    "bengaluru",
    "delhi",
    "new delhi",
    "hyderabad",
    "chennai",
    "pune",
    "kolkata",
    "gurgaon",
    "gurugram",
    "noida",
    "ahmedabad",
    "jaipur",
    "kochi",
    "chandigarh",
    ".in/",
    "🇮🇳",
  ],
  "united states": [
    "united states",
    "usa",
    "u.s.",
    "u.s.a",
    "america",
    "american",
    "new york",
    "boston",
    "san francisco",
    "los angeles",
    "chicago",
    "austin",
    "seattle",
    "denver",
    "texas",
    "california",
    "florida",
    "arizona",
    "atlanta",
    "miami",
    "dallas",
    "houston",
    "philadelphia",
    "san diego",
    "portland",
    "las vegas",
    "washington",
    "nyc",
    ".us/",
    "🇺🇸",
  ],
  "united kingdom": [
    "united kingdom",
    "uk",
    "u.k.",
    "britain",
    "british",
    "england",
    "scotland",
    "wales",
    "london",
    "manchester",
    "birmingham",
    "edinburgh",
    ".uk/",
    "🇬🇧",
  ],
  europe: [
    "europe",
    "european",
    "eu",
    "germany",
    "france",
    "spain",
    "italy",
    "netherlands",
    "belgium",
    "sweden",
    "norway",
    "denmark",
    "finland",
    "poland",
    "portugal",
    "ireland",
    "austria",
    "switzerland",
    "berlin",
    "paris",
    "amsterdam",
    "dublin",
    "madrid",
    "barcelona",
    "lisbon",
    "stockholm",
    "copenhagen",
    "munich",
    "zurich",
    ".eu/",
  ],
  canada: [
    "canada",
    "canadian",
    "toronto",
    "vancouver",
    "montreal",
    "ottawa",
    "calgary",
    "edmonton",
    "winnipeg",
    "quebec",
    "victoria",
    "halifax",
    "mississauga",
    ".ca/",
  ],
  australia: ["australia", "sydney", "melbourne", ".au/"],
  germany: ["germany", "german", "berlin", "munich", "deutschland", ".de/"],
  israel: ["israel", "israeli", "tel aviv", "tel-aviv", "jerusalem", ".il/"],
  singapore: ["singapore", ".sg/"],
  dubai: ["dubai", "uae", "united arab emirates"],
  france: ["france", "paris", ".fr/"],
};

const GLOBAL_DENY_TOKENS = [
  "israel",
  "tel aviv",
  "tel-aviv",
  "germany",
  "deutschland",
  "berlin",
  "munich",
  "new york",
  "boston",
  "san francisco",
  "los angeles",
  "london",
  "paris",
  "singapore",
  "dubai",
  "sydney",
  "melbourne",
  "tokyo",
  "seoul",
  "phoenix",
  "arizona",
  " az ",
  ", az",
  "texas",
  "california",
  "florida",
  "chicago",
  "seattle",
  "denver",
  "austin",
  "atlanta",
  "miami",
  "dallas",
  "houston",
  "philadelphia",
  "san diego",
  "portland",
  "las vegas",
  "praktikum",
  "israeltechjobs",
  "r/israel",
];

export function locationAllowTokens(location: string): string[] {
  const key = location.toLowerCase().trim();
  if (LOCATION_ALLOW[key]) return LOCATION_ALLOW[key];
  // city or unknown: use the location string itself + common variants
  const tokens = [key];
  if (key.includes(" ")) tokens.push(...key.split(/\s+/).filter((t) => t.length > 2));
  return tokens;
}

/**
 * When user asked for a place, drop leads that clearly reference a conflicting geography
 * without also matching the requested place.
 *
 * Soft keep when there is NO geo mention (volume) for known countries — but foreign
 * geo always rejects. Europe / UK / US all use allow-lists.
 */
export function passesLocationFilter(lead: Lead, location: string | null | undefined): boolean {
  if (!location) return true;
  // Directory Places results already geo-scoped
  if (lead.source === "geoapify" || lead.source === "foursquare" || lead.source === "osm")
    return true;

  const text = `${lead.title} ${lead.snippet} ${lead.full_post_url} ${lead.platform}`.toLowerCase();
  const allow = locationAllowTokens(location);
  const hasAllow = allow.some((t) => text.includes(t.toLowerCase()));
  if (hasAllow) return true;

  const remoteOk = /\b(remote|worldwide|global|anywhere|work from home|wfh)\b/i.test(text);
  const locKey = location.toLowerCase().trim();
  const deny = GLOBAL_DENY_TOKENS.filter((d) => {
    return !allow.some((a) => a.includes(d.trim()) || d.trim().includes(a));
  });
  // Also deny other countries' allow-lists
  for (const [country, tokens] of Object.entries(LOCATION_ALLOW)) {
    if (country === locKey) continue;
    // Europe contains many EU countries — don't deny intra-EU tokens against Europe.
    if (locKey === "europe" && ["germany", "france", "united kingdom"].includes(country)) continue;
    for (const t of tokens) {
      if (t.length >= 4 && text.includes(t) && !allow.includes(t)) {
        return false;
      }
    }
  }
  if (deny.some((d) => text.includes(d))) return false;

  const anyGeoMention = Object.values(LOCATION_ALLOW)
    .flat()
    .some((t) => t.length >= 5 && text.includes(t));
  if (anyGeoMention && !hasAllow) return false;

  // Country-level gate: require allow OR remote without foreign geo OR no geo mention.
  if (
    LOCATION_ALLOW[locKey] ||
    locKey === "canada" ||
    locKey === "india" ||
    locKey === "united states" ||
    locKey === "europe" ||
    locKey === "united kingdom"
  ) {
    if (remoteOk) return true;
    if (!anyGeoMention) return true;
    return false;
  }
  return true;
}

/** Directory mode: require agency/company-ish signal, not lone "Marketing Lead" personal posts. */
export function passesDirectoryIcp(lead: Lead, classified: ClassifiedQuery): boolean {
  if (classified.intentMode !== "directory_smb") return true;
  if (lead.source === "geoapify" || lead.source === "foursquare") return true;
  const text = `${lead.title} ${lead.snippet}`.toLowerCase();
  const icp = (classified.icpNoun || "").toLowerCase();
  if (/\b(agenc(?:y|ies)|firm|studio|consultancy|company|llc|pvt|private limited)\b/.test(text))
    return true;
  if (icp && text.includes(icp)) return true;
  // Reject bare role titles / personal stories
  if (/^marketing lead\b/i.test(lead.title) && !/\bagenc/i.test(text)) return false;
  return false;
}

export function shouldIncludeLead(
  lead: Lead,
  classified: ClassifiedQuery,
  expanded: ExpandedQueries,
): boolean {
  if (isPersonalStoryNoise(lead)) return false;

  if (classified.intentMode === "directory_smb") {
    if (!passesDirectoryIcp(lead, classified)) return false;
    // Directory Places always included; other sources must still look like companies
    if (lead.source === "geoapify" || lead.source === "foursquare") return true;
  }

  const text = `${lead.title} ${lead.snippet}`;
  const lower = text.toLowerCase();
  const skillOk = isRelevantToQuery(
    lead,
    classified.coreSkill,
    classified.relatedSkills,
    classified,
  );
  const llmBuyer =
    lead.ai_role_in_post === "buyer" ||
    lead.ai_intent === "hiring" ||
    lead.ai_intent === "buying" ||
    lead.ai_intent === "researching";

  if (JOB_BOARD_SOURCES.has(lead.source)) {
    // Clients: Upwork/freelance gigs are buyer demand when skill-matched.
    // ATS / Jobicy / Arbeitnow openings are COMPANY SIGNALS — "Designer @ Acme"
    // never carries "need a designer" grammar, and requiring buyer intent emptied
    // the Companies tab (measured: greenhouse 9 → 1 after validate).
    if (classified.goal === "clients" || classified.signalMode === "buying_signal") {
      if (lead.source === "upwork" && skillOk) return true;
      if (skillOk) return true;
      return detectBuyerIntent(text).isBuyer || llmBuyer;
    }
    if (classified.intentMode === "directory_smb") return false;
    if (classified.type === "role") {
      return isRelevantToRoleQuery(text, classified.coreSkill, classified.relatedSkills);
    }
    return true;
  }

  // Startup identity feeds (Dealroom / NeuronFeed / gallery) — company rows for
  // investor deal-flow and craft company volume. Never require "need a …" grammar.
  if (
    lead.source === "dealroom" ||
    lead.source === "neuronfeed" ||
    lead.source === "startupsgallery" ||
    lead.source === "secedgar" ||
    lead.source === "stackexchange"
  ) {
    if (/investor|fundraising|raising/i.test(`${classified.coreSkill} ${classified.raw}`)) {
      return true;
    }
    if (classified.type === "product" || /tutor|teacher|tutoring/i.test(classified.coreSkill)) {
      return skillOk || lead.demand_verified === true;
    }
    if (skillOk || lead.signal_type === "leading_indicator") return true;
  }

  // Only apply hard provider negatives — soft words like "help"/"project" used
  // to wipe thin SERP snippets that still carry real buyer intent.
  const hardNeg = expanded.negativeSignals.filter(
    (s) =>
      s.length >= 8 &&
      /\b(hire me|my portfolio|available for hire|open to work|i am a|i'm a|seeking clients)\b/i.test(
        s,
      ),
  );
  if (hardNeg.some((s) => lower.includes(s.toLowerCase()))) return false;

  if (classified.type === "product") {
    if (detectProductIntent(text)) return true;
    if (lead.source === "stackexchange" && skillOk) return true;
    // Capability keywords from the pitch ("invoices", "find clients") count when
    // the post is not a seller CTA.
    const terms = [classified.coreSkill, ...classified.relatedSkills]
      .filter(Boolean)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 4);
    if (terms.some((t) => lower.includes(t)) && !PROVIDER_SIGNALS.some((s) => lower.includes(s))) {
      return (
        /\b(need|looking for|struggling|recommend|anyone|help with|how do|alternative|tool|app|software|invoice|billing|client)\b/i.test(
          text,
        ) ||
        !!lead.posted_at ||
        lead.source === "freelancer" ||
        lead.source === "stackexchange"
      );
    }
    return false;
  }

  if (classified.intentMode === "directory_smb") {
    return passesDirectoryIcp(lead, classified);
  }

  const intent = detectBuyerIntent(text);
  // Buying-signal / clients: real hire/buyer polarity only — bare "designer"
  // on a dated post used to keep personal POV / notes threads.
  if (classified.goal === "clients" || classified.signalMode === "buying_signal") {
    // Tutor marketplace projects are student/parent demand by definition.
    if (
      lead.source === "freelancer" &&
      /tutor|tutoring|homework|lessons|instructor/i.test(text) &&
      /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${classified.raw}`)
    ) {
      return true;
    }
    if (intent.isBuyer) return true;
    if (skillOk && llmBuyer) return true;
    if (
      skillOk &&
      (lead.demand_verified === true || !!lead.posted_at) &&
      /\b(need (a|an|someone)|looking for (a|an)|looking to hire|who can|willing to pay|freelancer needed|help wanted|\[hiring\]|we(?:'| a)?re hiring|budget)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    return false;
  }
  return intent.isBuyer;
}

export function validateLeads(
  leads: Lead[],
  classified: ClassifiedQuery,
  expanded: ExpandedQueries,
  prefs?: LeadFilterPrefs,
): Lead[] {
  const junior = prefersJunior(prefs);
  const mid = !!prefs?.preferMid;
  const senior = !!prefs?.preferSenior;
  const remotePref = prefs?.preferRemote !== false;
  const directoryMode = classified.intentMode === "directory_smb";

  // Named gates rather than a bare filter chain.
  //
  // Thirteen anonymous `if (...) return false` lines could turn 37 leads into 6
  // without leaving any record of WHICH rule was responsible, so diagnosing a
  // collapsed funnel meant bisecting by hand. Same order, same semantics —
  // the only addition is that a drop is now attributable.
  const gates: ReadonlyArray<{ name: string; reject: (l: Lead) => boolean }> = [
    {
      name: "irrelevant",
      reject: (l) =>
        !isRelevantToQuery(l, classified.coreSkill, classified.relatedSkills, classified),
    },
    { name: "expired", reject: (l) => hasExpiredSignal(l) },
    { name: "scam", reject: (l) => isLikelyScam(l) },
    { name: "personalStory", reject: (l) => isPersonalStoryNoise(l) },
    { name: "educational", reject: (l) => isEducationalNoise(l) },
    { name: "jobListPage", reject: (l) => isJobListPage(l) },
    { name: "listicle", reject: (l) => isMarketplaceOrListicle(l) },
    {
      name: "seller",
      reject: (l) => isSellerOrProviderLead(l, classified.coreSkill, classified.relatedSkills),
    },
    {
      name: "offSkillRole",
      reject: (l) => isOffSkillRole(l, classified.coreSkill, classified.relatedSkills),
    },
    { name: "location", reject: (l) => !passesLocationFilter(l, classified.location) },
    { name: "shouldInclude", reject: (l) => !shouldIncludeLead(l, classified, expanded) },
    {
      name: "seniorHeavy",
      // Enforce YoE on titles whenever the user prefers junior/mid/senior.
      // Exception: on the clients path, an ATS opening is a COMPANY SIGNAL
      // unless the user explicitly answered the experience clarifier.
      reject: (l) => {
        if (
          classified.goal === "clients" &&
          JOB_BOARD_SOURCES.has(l.source) &&
          !prefs?.explicitExperience
        )
          return false;
        if (junior && isSeniorHeavyLead(l)) return true;
        if (senior && isJuniorFriendlyLead(l) && !isSeniorHeavyLead(l)) return true;
        if (
          mid &&
          (/\b(intern|internship|entry[- ]?level|junior|jr\.?)\b/i.test(l.title || "") ||
            /\b(staff|principal|vp\b|chief|director|10\+?\s*years)\b/i.test(l.title || ""))
        )
          return true;
        return false;
      },
    },
    {
      name: "onsiteOnly",
      reject: (l) =>
        remotePref &&
        JOB_BOARD_SOURCES.has(l.source) &&
        !mentionsRemote(l) &&
        /\b(onsite|on-site|in[- ]office only)\b/i.test(`${l.title} ${l.snippet}`),
    },
  ];
  const dropped: Record<string, number> = {};

  const kept = leads.filter((lead) => {
    if (directoryMode && (lead.source === "geoapify" || lead.source === "foursquare")) {
      // Still apply location/scam checks lightly
      if (isLikelyScam(lead)) return false;
      if (!passesLocationFilter(lead, classified.location)) return false;
      // Agency ICP: require marketing/digital/advertising signal — not bare “estate agency”
      if (/\bagenc/i.test(classified.icpNoun || classified.raw || "")) {
        const text = `${lead.title} ${lead.snippet}`.toLowerCase();
        if (
          /\b(gas|lpg|petrol|cycle|bicycle|news|travel|insurance|estate|real\s*estate|property|milk|oil|ply|trading|sales|tour)\b/.test(
            text,
          ) &&
          !/\b(marketing|advertis|digital|media|seo|brand|creative)\b/.test(text)
        ) {
          return false;
        }
        const marketingish = /\b(marketing|advertis|digital|media|seo|brand|creative)\b/i.test(
          text,
        );
        if (!marketingish) return false;
      }
      return true;
    }
    for (const gate of gates) {
      if (gate.reject(lead)) {
        dropped[gate.name] = (dropped[gate.name] ?? 0) + 1;
        return false;
      }
    }
    return true;
  });

  if (process.env.SCRAPIVO_DEBUG_STAGES && leads.length) {
    const why = Object.entries(dropped)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}:${n}`)
      .join(" ");
    console.log(`[validate] ${leads.length} → ${kept.length}${why ? `  dropped ${why}` : ""}`);
  }
  return kept;
}
