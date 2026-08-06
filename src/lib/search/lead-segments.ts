/**
 * Segment scored leads into Posts / Companies / People for Discover pills.
 *
 * Rules (these fix real production bugs — don't loosen them):
 *  - Companies are only created from an actually-extracted company identity
 *    ("Role @ Company" tails, "Company: X" snippet lines, job-board authors).
 *    Never from post-title fragments.
 *  - People are only created from human authors on social/forum sources.
 *    Job-board listings are company-authored ("Upwork Client", "Acme Inc")
 *    and must never appear as a "person".
 *  - Social/profile URLs (LinkedIn, Twitter/X, Facebook, GitHub) are attached
 *    ONLY when they literally appear in the lead's data — never guessed.
 */
import type { Lead } from "../scoring";

export type InlineContacts = {
  emails: string[];
  phones: string[];
  links: string[]; // telegram / whatsapp / discord invite links found in the post
};

const ROLE_LOCALPARTS_INLINE = new Set([
  "info",
  "support",
  "hello",
  "contact",
  "admin",
  "noreply",
  "no-reply",
  "dmarc",
  "abuse",
  "security",
  "privacy",
  "postmaster",
  "webmaster",
]);

export type CompanyRow = {
  key: string;
  name: string;
  domain?: string;
  website?: string;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  why_now: string;
  signal_count: number;
  platforms: string[];
  sample_url: string;
  latest_signal?: string; // e.g. "3h ago"
  /** Contact details literally published inside the post — highest trust. */
  inline_contacts?: InlineContacts;
  leads: Lead[];
  score: number;
};

export type PersonRow = {
  key: string;
  name: string;
  title_hint?: string;
  role_hint?: string;
  platform?: string;
  author_url?: string;
  linkedin_url?: string;
  github_url?: string;
  company_hint?: string;
  company_domain?: string;
  location_hint?: string;
  why_match?: string;
  sample_url: string;
  posted_at_relative?: string;
  signal_count: number;
  /** Contact details literally published inside the post — highest trust. */
  inline_contacts?: InlineContacts;
  lead: Lead;
  score: number;
};

export type LeadSegments = {
  posts: Lead[];
  companies: CompanyRow[];
  people: PersonRow[];
};

// Sources where `author` is the hiring company, not a person.
// Note: "linkedin" is NOT here — LinkedIn posts have human authors; jobs are
// gated separately via isLinkedInPost().
const COMPANY_AUTHOR_SOURCES = new Set([
  "upwork",
  "remoteok",
  "remotive",
  "jobicy",
  "arbeitnow",
  "themuse",
  "weworkremotely",
  "usajobs",
  "samgov",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "greenhouse",
  "lever",
  "google_jobs",
  "wellfound",
  "workatastartup",
  "secedgar",
  "news",
  "startupsgallery",
  "startups_gallery",
  "dealroom",
  "neuronfeed",
  "tenders",
  "geoapify",
  "foursquare",
  "smb",
  "coreclaw_maps",
]);

// Sources whose authors are real humans with public profiles.
const PERSON_AUTHOR_SOURCES = new Set([
  "reddit",
  "redditrss",
  "hn",
  "bluesky",
  "mastodon",
  "lemmy",
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
  "threads",
  "github",
  "devto",
  "hashnode",
  "lobsters",
  "indiehackers",
  "youtube",
  "tiktok",
  "quora",
  "searxng",
  "serpapi",
  "tavily",
  "discourse",
  "discord_public",
  "substack",
  "dealroom",
  "neuronfeed",
]);

const ORG_SUFFIX_RE =
  /\b(inc|llc|ltd|corp|gmbh|co|company|labs|lab|studio|agency|services|solutions|technologies|technology|digital|consulting|consultancy|group|media|partners|partner|ventures|holdings|systems|software|apps?)\b/i;

const COMPANY_SLUG_TAIL_RE =
  /^(services|agency|studio|labs|lab|solutions|digital|technologies|technology|consulting|consultancy|group|media|partners|ventures|holdings|systems|software|apps?|official|hq)$/i;

function isLinkedInPost(lead: Lead): boolean {
  return (
    /post/i.test(`${lead.platform_label || lead.platform || ""}`) ||
    /linkedin\.com\/posts\//i.test(lead.full_post_url || "")
  );
}

/** Title-Case 2–4 tokens with no org suffix → person name, not a firm. */
function looksLikePersonName(name: string): boolean {
  const n = (name || "").trim();
  if (!n || ORG_SUFFIX_RE.test(n)) return false;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  // Allow lowercase (SERP often lowercases); normalize check.
  return parts.every((p) => /^[A-Za-z][a-zA-Z'.-]{1,30}$/.test(p));
}

function toTitleCaseName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

function looksLikeCompanyName(name: string): boolean {
  const n = (name || "").replace(/^@/, "").trim();
  if (!n) return false;
  if (ORG_SUFFIX_RE.test(n)) return true;
  // CamelCase brand without spaces (MadeByEWD, AcmeMarketing)
  if (!/\s/.test(n) && /^[A-Z][a-z]+[A-Z]/.test(n)) return true;
  // All-caps / brand-ish handle
  if (!/\s/.test(n) && /^[A-Z]{3,}[a-z]*[A-Z]/.test(n)) return true;
  return false;
}

// Seeker / provider phrasing — people offering services, not asking for them.
const SEEKER_PHRASE_RE =
  /\b(i(?:'| a)?m a|i am a|available for (hire|work)|open to work|looking for (work|a (job|role|position|gig))|for hire|hire me|my (portfolio|rates)|seeking (work|opportunities))\b/i;
// Align with ingest buyer signals — "looking for developer" (no article) must count.
const BUYER_PHRASE_RE =
  /\b(need(s|ed)?(\s+(a|an|someone|help|this|\w+))?|looking for(\s+(a|an|someone|help|\w+))?|looking to (hire|find|get)|hiring|who can (help|build|make|design|develop)|any(one)? (recommend|know|recs|recommendations?)|willing to pay|budget|freelance(r)? needed|seeking (a|an|freelancer)|want(s|ed)? (a|an|someone)|can someone (help|build|make)|recommend a|paid (gig|project)|help wanted)\b/i;

// Platform/aggregator domains — never a company's own website.
const PLATFORM_DOMAINS = [
  "reddit.com",
  "linkedin.com",
  "lnkd.in",
  "twitter.com",
  "x.com",
  "t.co",
  "bsky.app",
  "news.ycombinator.com",
  "ycombinator.com",
  "github.com",
  "github.io",
  "upwork.com",
  "remoteok.com",
  "remotive.com",
  "jobicy.com",
  "arbeitnow.com",
  "themuse.com",
  "weworkremotely.com",
  "usajobs.gov",
  "sam.gov",
  "sec.gov",
  "mastodon.social",
  "lemmy.world",
  "facebook.com",
  "instagram.com",
  "dev.to",
  "hashnode.com",
  "hashnode.dev",
  "lobste.rs",
  "indiehackers.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "workable.com",
  "recruitee.com",
  "greenhouse.io",
  "google.com",
  "bit.ly",
  "wellfound.com",
  "angel.co",
  "fiverr.com",
  "discord.com",
  "discord.gg",
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "wikipedia.org",
  "medium.com",
  "youtube.com",
];

function isPlatformDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return PLATFORM_DOMAINS.some((p) => d === p || d.endsWith(`.${p}`));
}

function leadText(lead: Lead): string {
  return `${lead.title || ""}\n${lead.snippet || ""}`;
}

// ── URL extraction (only what's literally present in the data) ──────────────
function extractUrl(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  if (!m) return undefined;
  return m[0].replace(/[),.;'"\]]+$/, "");
}

function linkedInCompanyUrl(lead: Lead): string | undefined {
  const hay = `${lead.author_url || ""} ${lead.full_post_url || ""} ${leadText(lead)}`;
  return extractUrl(hay, /https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s)"'\]]+/i);
}

function linkedInPersonUrl(lead: Lead): string | undefined {
  const hay = `${lead.author_url || ""} ${lead.full_post_url || ""} ${leadText(lead)}`;
  return extractUrl(hay, /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s)"'\]]+/i);
}

function twitterProfileUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,15})(?![\w/])/i);
  if (!m) return undefined;
  if (/^(status|search|hashtag|intent|share|home|i)$/i.test(m[1])) return undefined;
  return m[0];
}

function facebookPageUrl(text: string): string | undefined {
  const u = extractUrl(text, /https?:\/\/(?:www\.)?facebook\.com\/[^\s)"'\]]+/i);
  if (!u || /facebook\.com\/(groups|sharer|share|events|marketplace)\b/i.test(u)) {
    return undefined;
  }
  return u;
}

function githubProfileUrl(lead: Lead): string | undefined {
  const u = lead.author_url || "";
  const m = u.match(/^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+\/?$/i);
  return m ? u : undefined;
}

/** First non-platform domain found in the lead's text/urls → company site. */
function companyDomain(lead: Lead): string | undefined {
  const hay = `${leadText(lead)} ${lead.author_url || ""}`;
  for (const m of hay.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)) {
    const d = m[1].toLowerCase().replace(/\.$/, "");
    // skip file-ish and versioned matches ("next.js", "v2.0", image files)
    if (
      /\.(js|ts|jsx|tsx|css|html|json|png|jpe?g|svg|pdf|md|webp|gif|ico|avif|mp4|webm|woff2?)$/i.test(
        d,
      )
    )
      continue;
    if (!d.includes(".") || isPlatformDomain(d)) continue;
    if (d.split(".").every((part) => /^\d+$/.test(part))) continue;
    return d;
  }
  return undefined;
}

// ── Company identity extraction ─────────────────────────────────────────────
const GENERIC_COMPANY_WORDS =
  /^(company|client|startup|team|business|anonymous|confidential|various|multiple|n\/a|unknown|upwork client)$/i;

function cleanCompanyName(raw: string, opts?: { allowPersonNames?: boolean }): string | undefined {
  const name = (raw || "")
    .replace(/\s+/g, " ")
    .replace(/[|•·]+.*$/, "")
    .trim()
    .replace(/[,;:]$/, "");
  if (!name || name.length < 2 || name.length > 60) return undefined;
  if (GENERIC_COMPANY_WORDS.test(name)) return undefined;
  if (/^https?:\/\//i.test(name) || /^[@#]/.test(name) || /^u\//i.test(name)) return undefined;
  // Social posts must not promote person authors to company rows.
  if (!opts?.allowPersonNames && looksLikePersonName(name)) return undefined;
  return name;
}

/** Extract the actual company behind a lead — undefined when we can't tell. */
export function extractCompanyFromLead(lead: Lead): string | undefined {
  const title = lead.title || "";
  const isLiPost = lead.source === "linkedin" && isLinkedInPost(lead);

  // LinkedIn company URL slug → company name
  const liCo = linkedInCompanyUrl(lead);
  if (liCo) {
    const slug = liCo.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1];
    if (slug) {
      const fromSlug = cleanCompanyName(decodeURIComponent(slug).replace(/[-_]+/g, " "), {
        allowPersonNames: true,
      });
      if (fromSlug) return fromSlug;
    }
  }
  // HN "Who is hiring" comments follow "Company | Role | Location | ..."
  const platform = `${lead.platform_label || lead.platform || ""}`.toLowerCase();
  if (platform.includes("who is hiring") || platform.includes("who's hiring")) {
    const first = title.split("|")[0]?.trim() || "";
    const candidate = first.replace(/\s*\((?:https?:\/\/)?[^)]*\)\s*/g, " ").trim();
    if (
      candidate &&
      !/\b(hiring|looking|seeking|remote|engineer|developer|designer|full[- ]?time|part[- ]?time)\b/i.test(
        candidate,
      )
    ) {
      const fromHn = cleanCompanyName(candidate, { allowPersonNames: true });
      if (fromHn) return fromHn;
    }
  }
  // "Role @ Company"
  const at = title.match(/@\s*([^|•@]+?)\s*$/)?.[1];
  const fromAt = cleanCompanyName(at || "", { allowPersonNames: true });
  if (fromAt) return fromAt;
  // "Company: X" line (RemoteOK / Upwork / GitHub org snippets)
  const fromLine = cleanCompanyName((lead.snippet || "").match(/^company:\s*(.+)$/im)?.[1] || "", {
    allowPersonNames: true,
  });
  if (fromLine) return fromLine;

  // GitHub: repo owner when distinct from issue author → company
  if (lead.source === "github") {
    const owner = (lead.full_post_url || "").match(
      /github\.com\/([^/]+)\/[^/]+\/(?:issues|pull)\//i,
    )?.[1];
    const authorLogin = (lead.author || "").replace(/^@/, "").trim();
    if (
      owner &&
      (!authorLogin || owner.toLowerCase() !== authorLogin.toLowerCase()) &&
      !/^(docs|examples|awesome|tutorials)$/i.test(owner)
    ) {
      const fromGh = cleanCompanyName(owner.replace(/[-_]+/g, " "), { allowPersonNames: true });
      if (fromGh) return fromGh;
      if (owner.length >= 2 && owner.length <= 60) return owner;
    }
  }

  // Instagram brand handles (snohetta.design) → company, not person.
  if (lead.source === "instagram" || lead.source === "facebook") {
    const a = (lead.author || "").replace(/^@/, "").trim();
    if (a && (/\.[a-z]{2,}$/i.test(a) || ORG_SUFFIX_RE.test(a) || looksLikeCompanyName(a))) {
      const fromBrand = cleanCompanyName(a.replace(/\./g, " "), { allowPersonNames: true });
      if (fromBrand && !looksLikePersonName(fromBrand)) return fromBrand;
      // Keep dotted brand as display name (snohetta.design)
      if (a.length >= 3 && a.length <= 60) return a;
    }
  }

  // Freelancer / marketplace buyer orgs often sit in author or platform_label.
  if (lead.source === "freelancer" || lead.source === "fiverr" || lead.source === "upwork") {
    const fromAuthor = cleanCompanyName(lead.author || "", { allowPersonNames: true });
    if (fromAuthor && !looksLikePersonName(fromAuthor) && fromAuthor.length >= 2) {
      return fromAuthor;
    }
    const fromPlat = cleanCompanyName(
      (lead.platform_label || "").replace(/^freelancer:?\s*/i, "").trim(),
      { allowPersonNames: true },
    );
    if (fromPlat && !looksLikePersonName(fromPlat) && fromPlat.length >= 2) return fromPlat;
  }

  // Author-as-company ONLY for true company-authored sources / LinkedIn Jobs.
  // Never for LinkedIn posts (human authors).
  if (!isLiPost && COMPANY_AUTHOR_SOURCES.has(lead.source)) {
    const fromAuthor = cleanCompanyName(lead.author || "", { allowPersonNames: false });
    if (fromAuthor && !looksLikePersonName(fromAuthor)) return fromAuthor;
  }
  if (lead.source === "linkedin" && !isLiPost) {
    const fromAuthor = cleanCompanyName(lead.author || "", { allowPersonNames: true });
    if (fromAuthor && !looksLikePersonName(fromAuthor)) return fromAuthor;
  }
  if (lead.source === "ashby" || lead.source === "workable") {
    const fromAuthor = cleanCompanyName(lead.author || "", { allowPersonNames: true });
    if (fromAuthor && !looksLikePersonName(fromAuthor)) return fromAuthor;
  }

  // SEC / news: "Acme raises" / "Acme Inc filed"
  if (
    lead.source === "news" ||
    lead.source === "secedgar" ||
    lead.source === "startupsgallery" ||
    lead.source === "startups_gallery"
  ) {
    const fromNews = cleanCompanyName(
      title.match(
        /^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})\s+(?:raises|raised|files|filed|launches|hired|hiring|announces)/,
      )?.[1] || "",
      { allowPersonNames: true },
    );
    if (fromNews) return fromNews;
  }
  // Domain from a company website in the post → brand-ish name
  const domain = companyDomain(lead);
  if (
    domain &&
    (lead.source === "searxng" ||
      lead.source === "tavily" ||
      lead.source === "serpapi" ||
      lead.source === "webboolean" ||
      lead.source === "startupsgallery" ||
      lead.source === "startups_gallery" ||
      lead.source === "geoapify" ||
      lead.source === "foursquare" ||
      lead.source === "news")
  ) {
    const brand = cleanCompanyName(domain.split(".")[0]?.replace(/[-_]+/g, " ") || "", {
      allowPersonNames: true,
    });
    if (brand && brand.length >= 3) return brand.charAt(0).toUpperCase() + brand.slice(1);
  }
  // Social buyer posts: "our startup X", "we at Acme", "Acme Inc is looking"
  // — independent firm signal (not author).
  const hay = leadText(lead);
  const fromSocialCo = cleanCompanyName(
    hay.match(
      /\b(?:our (?:startup|company|agency)|we(?:'| a)?re (?:a |an )?(?:startup|company) called|we at|i(?:'| a)?m (?:the )?(?:founder|ceo|cto|co-?founder) (?:of|at)|working (?:at|for))\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\b/,
    )?.[1] ||
      hay.match(
        /\b([A-Z][\w&.'-]{1,30}(?:\s+(?:Inc|LLC|Ltd|Labs|Studio|Agency|Co|Corp|Company|Services)\.?))\b/,
      )?.[1] ||
      title.match(
        /\b([A-Z][\w&.'-]{1,30}(?:\s+(?:Inc|LLC|Ltd|Labs|Studio|Agency|Co|Services)\.?))\b/,
      )?.[1] ||
      "",
    { allowPersonNames: true },
  );
  if (
    fromSocialCo &&
    (lead.source === "reddit" ||
      lead.source === "twitter" ||
      lead.source === "hn" ||
      lead.source === "linkedin" ||
      lead.source === "tavily" ||
      lead.source === "serpapi")
  ) {
    // Never dual-list when the only "company" equals the person author.
    const author = (lead.author || "").trim().toLowerCase();
    if (author && fromSocialCo.toLowerCase() === author) return undefined;
    return fromSocialCo;
  }
  // "... at Company" (capitalized) inside the title
  const fromInline = cleanCompanyName(
    title.match(/\bat\s+([A-Z][\w&.'\s-]{1,40}?)(?:\s*[|,–—-]|\s+is\b|\s+looking\b|$)/)?.[1] || "",
    { allowPersonNames: false },
  );
  if (fromInline) {
    const author = (lead.author || "").trim().toLowerCase();
    if (author && fromInline.toLowerCase() === author) return undefined;
    return fromInline;
  }
  // Social only: "Acme Labs is hiring" / "hiring at Acme Studio" with org suffix.
  if (
    lead.source === "reddit" ||
    lead.source === "twitter" ||
    lead.source === "hn" ||
    lead.source === "linkedin" ||
    lead.source === "tavily" ||
    lead.source === "serpapi" ||
    lead.source === "searxng" ||
    lead.source === "webboolean"
  ) {
    const fromHiring = cleanCompanyName(
      hay.match(/\b([A-Z][\w&.'-]{1,30}(?:\s+[A-Z][\w&.'-]{1,30}){0,3})\s+is hiring\b/)?.[1] ||
        hay.match(
          /\bhiring (?:at|for)\s+([A-Z][\w&.'-]{1,30}(?:\s+[A-Z][\w&.'-]{1,30}){0,3})\b/,
        )?.[1] ||
        "",
      { allowPersonNames: true },
    );
    if (fromHiring && (ORG_SUFFIX_RE.test(fromHiring) || linkedInCompanyUrl(lead))) {
      const author = (lead.author || "").trim().toLowerCase();
      if (author && fromHiring.toLowerCase() === author) return undefined;
      if (!looksLikePersonName(fromHiring)) return fromHiring;
    }
  }
  return undefined;
}

// ── In-post contact extraction ──────────────────────────────────────────────
// Posts frequently publish their own contact ("mail us: hello[at]acme[dot]ai",
// "thanks, Vyom", t.me links). Extracting these is free, instant, and the
// highest-trust contact there is — the poster chose to publish it.
function deobfuscate(s: string): string {
  return (s || "")
    .replace(/\s*\[\s*(?:at|@)\s*\]\s*/gi, "@")
    .replace(/\s*\(\s*(?:at|@)\s*\)\s*/gi, "@")
    .replace(/\s*\{\s*(?:at|@)\s*\}\s*/gi, "@")
    .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s*\(\s*dot\s*\)\s*/gi, ".")
    .replace(/\s*\{\s*dot\s*\}\s*/gi, ".");
}

export function extractInlineContacts(text: string): InlineContacts | undefined {
  const t = deobfuscate(text || "");
  const emails = [
    ...new Set(
      [...t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) =>
        m[0].toLowerCase(),
      ),
    ),
  ]
    .filter(
      (e) =>
        !/example\.com|yourdomain|@reddit|@x\.com/.test(e) &&
        !ROLE_LOCALPARTS_INLINE.has(e.split("@")[0] || "") &&
        !/\b(dmarc|abuse|postmaster|noreply)\b/i.test(e.split("@")[0] || ""),
    )
    .slice(0, 3);
  const phones = [
    ...new Set(
      [...t.matchAll(/\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,5}\b/g)].map((m) =>
        m[0].trim(),
      ),
    ),
  ].slice(0, 2);
  const links = [
    ...new Set(
      [
        ...t.matchAll(/https?:\/\/(?:t\.me|wa\.me|chat\.whatsapp\.com|discord\.gg)\/[^\s)"']+/gi),
      ].map((m) => m[0].replace(/[),.;]+$/, "")),
    ),
  ].slice(0, 3);
  if (!emails.length && !phones.length && !links.length) return undefined;
  return { emails, phones, links };
}

// ── LinkedIn post author from the URL slug ──────────────────────────────────
// linkedin.com/posts/vyom-bhatia_national-identity-activity-… encodes the
// author. This turns LinkedIn post leads into PEOPLE rows (they previously
// produced none).
export function linkedInAuthorFromUrl(url: string): { name: string; profile_url: string } | null {
  const m = (url || "").match(/linkedin\.com\/posts\/([A-Za-z0-9-]+?)_/i);
  if (!m) return null;
  const slug = m[1];
  const parts = slug.split("-").filter(Boolean);
  // Drop the trailing vanity-id chunk ("…-1a2b3c4d") when present.
  while (parts.length > 1 && /\d/.test(parts[parts.length - 1])) parts.pop();
  // Single-word slugs are company pages, not people.
  if (parts.length < 2 || parts.length > 4) return null;
  // Company-page slugs: talentforge-services, acme-digital, …
  if (parts.some((p) => COMPANY_SLUG_TAIL_RE.test(p))) return null;
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  if (name.replace(/[^A-Za-z]/g, "").length < 3) return null;
  if (looksLikeCompanyName(name)) return null;
  return { name, profile_url: `https://www.linkedin.com/in/${slug}` };
}

// ── Person identity extraction ──────────────────────────────────────────────
const NON_PERSON_AUTHOR =
  /^(anon|unknown|deleted|\[deleted\]|automoderator|upwork client|.*\bclient$|.*\b(inc|llc|ltd|corp|gmbh|services|agency|studio|labs|solutions)\.?$|[a-z0-9-]+\.[a-z]{2,})$/i;

function personDisplayName(author: string): string {
  return author.replace(/^u\//i, "").replace(/^@/, "").trim();
}

function isFieldDecisionMaker(lead: Lead): boolean {
  if (lead.is_decision_maker) return true;
  const text = `${leadText(lead)} ${lead.author || ""}`;
  return /\b(ceo|cto|coo|cmo|cfo|founder|co-?founder|owner|director|vp\b|head of|hiring manager)\b/i.test(
    text,
  );
}

function isBuyerPersonLead(lead: Lead): boolean {
  // Prefer LLM buyer labels when present; drop seekers explicitly.
  if (lead.ai_role_in_post === "seeker" || lead.ai_intent === "seeker") return false;
  const text = leadText(lead);
  // Seller CTAs must never become People rows
  if (
    /\bfor your (business|company|startup)\b/i.test(text) ||
    /\bdm me your (requirements|project|brief|details)\b/i.test(text) ||
    /\bcommission[- ]based partner\b/i.test(text) ||
    /\bpartner to find .{0,30}(clients|customers)\b/i.test(text)
  ) {
    return false;
  }
  if (
    lead.ai_role_in_post === "buyer" ||
    lead.ai_intent === "hiring" ||
    lead.ai_intent === "buying"
  ) {
    return true;
  }
  // CTOs / founders / owners in the field — not only people publicly asking.
  if (isFieldDecisionMaker(lead) && !SEEKER_PHRASE_RE.test(text)) return true;
  if (SEEKER_PHRASE_RE.test(text) && !BUYER_PHRASE_RE.test(text)) return false;
  if (BUYER_PHRASE_RE.test(text)) return true;
  // Warm tier with a real author still counts — Posts already passed buyer gates.
  return (lead.score ?? 0) >= 45 || lead.tier === "hot" || lead.tier === "warm";
}

function isPersonLead(lead: Lead): boolean {
  let author = (lead.author || "").trim();
  // Recover LinkedIn post author from URL slug — prefer slug over a bad/
  // lowercase SERP author so People tabs fill.
  if (lead.source === "linkedin" && isLinkedInPost(lead)) {
    const fromLi = linkedInAuthorFromUrl(lead.full_post_url || "");
    if (fromLi) {
      if (
        !author ||
        NON_PERSON_AUTHOR.test(author) ||
        looksLikeCompanyName(author) ||
        !looksLikePersonName(author)
      ) {
        author = fromLi.name;
        lead.author = fromLi.name;
      } else if (!looksLikePersonName(author) && looksLikePersonName(toTitleCaseName(author))) {
        author = toTitleCaseName(author);
        lead.author = author;
      }
      lead.author_url = lead.author_url || fromLi.profile_url;
    } else if (author && looksLikePersonName(toTitleCaseName(author))) {
      author = toTitleCaseName(author);
      lead.author = author;
    }
  }
  // Recover Reddit/Twitter/Instagram handles from URL / text.
  if ((!author || NON_PERSON_AUTHOR.test(author)) && lead.full_post_url) {
    try {
      const u = new URL(lead.full_post_url);
      const host = u.hostname.replace(/^www\./, "");
      if (host.endsWith("reddit.com")) {
        const user =
          u.pathname.match(/\/(?:user|u)\/([^/?#]+)/i)?.[1] ||
          leadText(lead).match(/\bu\/([A-Za-z0-9_-]{2,30})\b/i)?.[1];
        if (user && !/^(comments|r|wiki|search)$/i.test(user)) {
          author = user;
          lead.author = user;
          lead.author_url = lead.author_url || `https://reddit.com/user/${user}`;
        }
      } else if (host === "twitter.com" || host === "x.com") {
        const tw = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\//);
        if (tw && !["i", "home", "search"].includes(tw[1].toLowerCase())) {
          author = `@${tw[1]}`;
          lead.author = author;
          lead.author_url = lead.author_url || `https://x.com/${tw[1]}`;
        }
      } else if (host.endsWith("instagram.com")) {
        const fromProfile = u.pathname.match(/^\/([A-Za-z0-9_.]{2,30})\/?$/);
        const handle =
          (fromProfile &&
          !["p", "reel", "stories", "explore"].includes(fromProfile[1].toLowerCase())
            ? fromProfile[1]
            : null) ||
          leadText(lead).match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ||
          leadText(lead).match(/\b([a-z0-9_.]{3,30}\.design)\b/i)?.[1];
        if (handle) {
          author = handle.replace(/^@/, "");
          lead.author = author;
          lead.author_url = lead.author_url || `https://www.instagram.com/${author}/`;
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!author || author.length < 2) return false;
  if (NON_PERSON_AUTHOR.test(author)) return false;
  if (looksLikeCompanyName(author)) return false;
  // GitHub issue authors are people with profile URLs.
  if (lead.source === "github") {
    const login = author.replace(/^@/, "");
    lead.author_url = lead.author_url || `https://github.com/${login}`;
    return isBuyerPersonLead(lead);
  }
  // Brand-like handles without separators (AcmeMarketing, MadeByEWD) — not people.
  // Skip for lowercase social handles (reddit/github logins).
  const bare = author.replace(/^@/, "");
  if (/^[A-Z][a-z]+[A-Z]/.test(bare) && !/\s/.test(bare) && lead.source !== "reddit") {
    return false;
  }
  // LinkedIn POSTS are person-authored (jobs are company-authored).
  // Also allow /in/ profile hits for field decision-makers (CTO/founder).
  if (lead.source === "linkedin") {
    const isInProfile = /linkedin\.com\/in\//i.test(lead.full_post_url || "");
    if (!isLinkedInPost(lead) && !(isInProfile && isFieldDecisionMaker(lead))) return false;
    if (looksLikeCompanyName(author)) return false;
    // Multi-token authors must look like real names (allow lowercase via normalize).
    if (/\s/.test(author)) {
      const titled = toTitleCaseName(author);
      if (!looksLikePersonName(author) && !looksLikePersonName(titled)) return false;
      if (!looksLikePersonName(author) && looksLikePersonName(titled)) {
        lead.author = titled;
        author = titled;
      }
    }
    return isBuyerPersonLead(lead);
  }
  if (COMPANY_AUTHOR_SOURCES.has(lead.source)) return false;
  if (PERSON_AUTHOR_SOURCES.has(lead.source)) {
    return isBuyerPersonLead(lead);
  }
  // Unknown source: accept only when the author URL is a user-profile URL.
  const url = lead.author_url || "";
  if (
    !/\/(user|u|profile|in)\/|bsky\.app\/profile|news\.ycombinator\.com\/user|@[a-z0-9_]+$/i.test(
      url,
    )
  ) {
    return false;
  }
  return isBuyerPersonLead(lead);
}

function roleHint(lead: Lead): string | undefined {
  const text = leadText(lead);
  const m = text.match(
    /\b(?:i'?m|i am|we'?re|as)\s+(?:the\s+|a\s+|an\s+)?(founder|co-?founder|ceo|cto|coo|cmo|cfo|owner|hiring manager|recruiter|director of [\w\s]{2,25}|head of [\w\s]{2,25}|vp of [\w\s]{2,25})/i,
  );
  if (m) {
    const r = m[1].trim();
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  if (lead.is_decision_maker) return "Decision-maker";
  return undefined;
}

function locationHint(lead: Lead): string | undefined {
  const m = leadText(lead).match(
    /\b(?:based in|located in)\s+([A-Z][A-Za-z\s,'-]{2,30}?)(?:[.,;\n]|$)/,
  );
  return m?.[1]?.trim();
}

function relativeAge(iso?: string): string | undefined {
  if (!iso) return "Recently (undated)";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return "Recently (undated)";
  const m = Math.floor(diff / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

// ── Segmentation ────────────────────────────────────────────────────────────
export function segmentLeads(rawLeads: Lead[]): LeadSegments {
  // Pre-pass: LinkedIn post URLs encode their author — attach it so those
  // leads can become people rows (never company rows from author alone).
  const leads = rawLeads.map((l) => {
    if (
      l.source === "linkedin" &&
      isLinkedInPost(l) &&
      (!l.author || NON_PERSON_AUTHOR.test(l.author))
    ) {
      const a = linkedInAuthorFromUrl(l.full_post_url || "");
      if (a) {
        return {
          ...l,
          author: a.name,
          author_url: l.author_url || a.profile_url,
        };
      }
    }
    return l;
  });
  const posts = (() => {
    // Posts = social / community / public asks. ATS and job boards already
    // populate Companies; dumping them into Posts made every clients search
    // look like "Reddit + company pages" even when LinkedIn/IG were present
    // further down a 100+ ATS-dominated list (and then the 24h chip hid the
    // undated social ones entirely).
    const withInline = (l: Lead) => {
      const inline = extractInlineContacts(leadText(l));
      return inline ? { ...l, inline_contacts: inline } : l;
    };
    // Only pure company career/ATS boards are excluded from Posts when we have
    // social/community supply. News, GitHub, tenders, forums stay as Posts.
    const ATS_ONLY = new Set([
      "upwork",
      "remoteok",
      "remotive",
      "jobicy",
      "arbeitnow",
      "themuse",
      "weworkremotely",
      "usajobs",
      "ashby",
      "smartrecruiters",
      "workable",
      "recruitee",
      "greenhouse",
      "lever",
      "google_jobs",
      "wellfound",
      "workatastartup",
      "githubjobs",
    ]);
    const isAtsOnly = (l: Lead) => ATS_ONLY.has(l.source);
    const socialish = leads.filter((l) => !isAtsOnly(l));
    const companyish = leads.filter(isAtsOnly);
    // Prefer real posts; only pad with company openings if the social layer
    // is empty so Discover is never a blank wall.
    const pool = socialish.length >= 2 ? socialish : [...socialish, ...companyish];
    return pool.map(withInline);
  })();

  // Companies — group by extracted company identity.
  // Dual-list only when extractCompanyFromLead finds an independent firm
  // signal (Company:, /company/ URL, "we at Acme") — never person author.
  const byCompany = new Map<string, { name: string; leads: Lead[] }>();
  for (const l of leads) {
    const name = extractCompanyFromLead(l);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byCompany.has(key)) byCompany.set(key, { name, leads: [] });
    byCompany.get(key)!.leads.push(l);
  }

  const companies: CompanyRow[] = Array.from(byCompany.entries())
    .map(([key, { name, leads: group }]) => {
      const sorted = [...group].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const best = sorted[0];
      const platforms = [...new Set(group.map((g) => g.platform_label || g.platform))];
      const domain = group.map(companyDomain).find(Boolean);
      const linkedin = group.map(linkedInCompanyUrl).find(Boolean);
      const twitter = group.map((g) => twitterProfileUrl(leadText(g))).find(Boolean);
      const facebook = group.map((g) => facebookPageUrl(leadText(g))).find(Boolean);
      const newest = group
        .map((g) => g.posted_at)
        .filter(Boolean)
        .sort()
        .pop() as string | undefined;
      return {
        key,
        name,
        domain,
        website: domain ? `https://${domain}` : undefined,
        linkedin_url: linkedin,
        twitter_url: twitter,
        facebook_url: facebook,
        why_now: best.why_match || best.match_reasons?.[0] || "Active buying signal",
        signal_count: group.length,
        platforms,
        sample_url: best.full_post_url,
        latest_signal: relativeAge(newest),
        inline_contacts: group.map((g) => extractInlineContacts(leadText(g))).find(Boolean),
        leads: sorted,
        score: Math.max(...group.map((g) => g.score ?? 0)),
      };
    })
    .sort((a, b) => b.score - a.score || b.signal_count - a.signal_count)
    .slice(0, 120);

  /**
   * Auto-generated throwaway handles ("Impossible_Fee_6217") — Reddit's
   * suggested shape when someone signs up without picking a name.
   *
   * Was previously any trailing digits, which wiped most of the People tab:
   * real accounts like "No_Pomegranate604" and "Western-Patience3292" are
   * reachable via Reddit DM and were the bulk of buyer posts. Only the
   * Adjective_Noun_NNNN pattern is treated as anonymous now.
   */
  function isAnonymousHandle(name: string): boolean {
    const n = (name || "").trim().replace(/^u\//i, "").replace(/^@/, "");
    if (!n) return true;
    return /^[A-Za-z]+[_-][A-Za-z]+[_-]\d{3,}$/.test(n);
  }

  // People — dedupe human authors across posts, keep their best signal.
  const byPerson = new Map<string, { rows: Lead[] }>();
  for (const l of leads) {
    if (!isPersonLead(l)) continue;
    const key = personDisplayName(l.author!).toLowerCase();
    if (!key) continue;
    // A People row is a person you can actually reach. An anonymous platform
    // handle ("Impossible_Fee_6217") is not — there's no real name to match.
    // Ordinary handles with a digit suffix ARE reachable on-platform.
    // Strict anonymous throwaways only (e.g. Impossible_Fee_6217). Keep
    // ordinary handles with digits — they are reachable on-platform.
    if (isAnonymousHandle(key) && !l.author_url && !linkedInPersonUrl(l)) continue;
    if (!byPerson.has(key)) byPerson.set(key, { rows: [] });
    byPerson.get(key)!.rows.push(l);
  }

  const people: PersonRow[] = Array.from(byPerson.entries())
    .map(([key, { rows }]) => {
      const sorted = [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const l = sorted[0];
      const company = extractCompanyFromLead(l);
      const domain = companyDomain(l);
      const ask = (l.title || l.snippet || "").slice(0, 90);
      return {
        key: `${key}|${l.full_post_url}`,
        name: personDisplayName(l.author!),
        title_hint: ask,
        role_hint: roleHint(l),
        platform: l.platform_label || l.platform,
        author_url: l.author_url,
        linkedin_url:
          linkedInPersonUrl(l) || (l.author_url?.includes("/in/") ? l.author_url : undefined),
        github_url: githubProfileUrl(l),
        // Don't show the person as their own "company".
        company_hint:
          company && company.toLowerCase() !== personDisplayName(l.author!).toLowerCase()
            ? company
            : undefined,
        company_domain: domain,
        location_hint: locationHint(l),
        why_match:
          l.why_match ||
          (isFieldDecisionMaker(l)
            ? "Relevant decision-maker in this field"
            : BUYER_PHRASE_RE.test(leadText(l))
              ? "Person publicly asking for this service"
              : undefined),
        sample_url: l.full_post_url,
        posted_at_relative: l.posted_at_relative || relativeAge(l.posted_at),
        signal_count: rows.length,
        inline_contacts: extractInlineContacts(leadText(l)),
        lead: l,
        score: l.score ?? 0,
      };
    })
    .sort((a, b) => {
      // Prefer decision-makers when scores are close.
      const dm = (isFieldDecisionMaker(b.lead) ? 8 : 0) - (isFieldDecisionMaker(a.lead) ? 8 : 0);
      return b.score - a.score || dm;
    })
    .slice(0, 120);

  return { posts, companies, people };
}
