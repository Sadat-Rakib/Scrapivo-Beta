/**
 * Entity resolution (M4).
 *
 * Turns a classified SOURCE into either a resolved entity or an
 * unresolved/rejected candidate. Never: provisional → qualified.
 *
 * Forbidden:
 * - copying Spec.entity onto the candidate
 * - treating page title alone as identity
 * - treating list/article/job_board/institute *as* the lead unless an
 *   underlying entity is extracted AND resolved with enough confidence
 *
 * Pipeline position:
 *   page classification → **entity resolution** → Spec match → claims → …
 */
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchSpec } from "./search-spec";
import type { PageType } from "@/lib/search/canonical-contract";
import {
  mintProvisionalEntityId,
  isProvisionalEntityId,
} from "@/lib/search/canonical-contract";
import { classifyPage, isNonEntityPage } from "@/lib/search/page-classify";
import { mergeKnownWithRegistry } from "@/lib/search/entity-registry";

/** Below this, entity_resolved stays false (theorem cannot pass). */
export const MIN_IDENTITY_CONFIDENCE = 0.7;

/** Literal named identity classifications; employer/client affiliation is not ownership. */
export function observedInvestorTypes(name: string, quote: string): Array<'fund' | 'angel'> {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return [];
  const out = new Set<'fund' | 'angel'>();
  for (const match of quote.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))) {
    const after = quote.slice(match.index! + match[0].length).split(/[.!?;\n]/)[0];
    const identity = /^\s*(?:[—–:,-]\s*|(?:is|operates as)\s+)(?:an?\s+)?(.+)$/iu.exec(after)?.[1];
    if (!identity || /^(?:not|never|no|without)\b/i.test(identity)) continue;
    for (const role of identity.split(/\s+and\s+(?:an?\s+)?/i)) {
      const nominal = /^((?:[\p{L}\p{N}-]+\s+){0,4}?)(angel investor|venture capital (?:firm|fund)|vc (?:firm|fund)|investment (?:firm|fund)|fund)\b/iu.exec(role);
      if (!nominal) continue;
      if (/^\s+(?:partner|employee|staff|advisor|consultant|analyst|associate|principal|manager|director|team\s+member)\b/i.test(role.slice(nominal[0].length))) continue;
      if (/\b(?:not|no|never|without|partner|employee|staff|advisor|consultant|client|supplier|for|at|of|with|to|in|by|from|invested|backed|interviewed|works?)\b/i.test(nominal[1])) continue;
      const modifiers = nominal[1].replace(/\b[A-Z][A-Z0-9]{1,7}\b(?!-)/g, '').trim();
      if (!/^(?:(?:individual|private|active|registered|global|early[ -]stage|pre[ -]seed|seed|growth[ -]stage|late[ -]stage|[\p{L}\p{N}]+-(?:focused|based)|[\p{L}]+(?:ian|an|ese|ish))\s*)*$/iu.test(modifiers)) continue;
      out.add(/^angel investor$/i.test(nominal[2]) ? 'angel' : 'fund');
    }
  }
  return [...out];
}

/** Unknown class can be researched, but cannot satisfy an explicitly requested OR class. */
export function investorScopeState(spec: SearchSpec, row: SpecRow): 'pass' | 'unknown' {
  const scope = spec.entity === 'investor' ? spec.criteria.find(item => item.field === 'investor_type')?.value : null;
  if (!scope) return 'pass';
  const requested = scope.toLowerCase().split(/\s+or\s+|[|/]/).map(value => value.trim());
  const name = row.title.split(/\s+[—–]\s+/)[0];
  return (row.evidence ?? []).some(item => item.subject === row.entity_id && !!item.subject &&
    !!item.source_url && !!item.excerpt && item.evidence_type === 'identity' && item.supports === 'identity' &&
    observedInvestorTypes(name, item.excerpt).some(type => requested.includes(type))) ? 'pass' : 'unknown';
}

export type ResolvedEntityType =
  | "person"
  | "company"
  | "business"
  | "job"
  | "investor"
  | "organization";

export type ResolutionStatus =
  | "resolved"
  | "unresolved"
  | "rejected"
  | "ambiguous";

export type KnownEntity = {
  name: string;
  entity_type: ResolvedEntityType;
  domain?: string | null;
  phone?: string | null;
  location?: string | null;
  entity_id?: string | null;
};

export type ResolutionProvenance = {
  method: string;
  signals: string[];
  observed_at: string;
  source_url: string | null;
  source_page_type: PageType;
  conflicts?: string[];
};

export type EntityResolutionResult = {
  status: ResolutionStatus;
  entity_id: string;
  entity_resolved: boolean;
  entity_type: ResolvedEntityType;
  name: string | null;
  domain: string | null;
  location: string | null;
  identity_confidence: number;
  /** Entity-facing page type after resolution (never list/article when resolved). */
  page_type: PageType;
  source_page_type: PageType;
  provenance: ResolutionProvenance;
  reject_reason?: string;
};

const PUBLISHER_HOSTS =
  /\b(techcrunch|forbes|bloomberg|reuters|wsj|nytimes|theverge|wired|medium\.com|substack|cnn|bbc)\b/i;

const JOB_BOARD_HOSTS =
  /\b(monster|indeed|lever\.co|greenhouse\.io|ashbyhq|workable|smartrecruiters|linkedin\.com\/jobs|ziprecruiter|glassdoor|wellfound|angellist|dice\.com)\b/i;

const SOCIAL_HOSTS = /\b(linkedin\.com|twitter\.com|x\.com|facebook\.com|reddit\.com)\b/i;

const INSTITUTE_HOSTS =
  /\b(fi\.co|founderinstitute|startupschool|techstars\.com|ycombinator\.com)\b/i;

const LEGAL_SUFFIX =
  /\b(inc|llc|ltd|corp|co|company|gmbh|ag|plc|sa|bv|oy|ab|pty)\b\.?/gi;

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIX, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost?.trim()) return null;
  try {
    const raw = urlOrHost.includes("://") ? urlOrHost : `https://${urlOrHost}`;
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    if (!host || host.length < 3) return null;
    return host;
  } catch {
    return null;
  }
}

function slugId(prefix: string, key: string): string {
  const slug = normalizeEntityName(key).replace(/\s+/g, "-").slice(0, 64) || "unknown";
  return `${prefix}:${slug}`;
}

function hostOf(url: string | null | undefined): string {
  return normalizeDomain(url) ?? "";
}

export function isFirstPartyEntityHost(host: string): boolean {
  if (!host) return false;
  if (PUBLISHER_HOSTS.test(host)) return false;
  if (JOB_BOARD_HOSTS.test(host)) return false;
  if (SOCIAL_HOSTS.test(host)) return false;
  if (INSTITUTE_HOSTS.test(host)) return false;
  if (/\b(seedtable|failory|crunchbase|producthunt|betalist)\b/i.test(host)) return false;
  return true;
}

/** Strip common SERP chrome from a title — never treat raw title as identity alone. */
function cleanTitleChrome(title: string): string {
  return title
    .replace(/\s*[|\-–—:]\s*(home|official site|careers?|jobs?|about|blog|news|linkedin).*$/i, "")
    .replace(/\s+(-|–|—)\s+(marketing|developer|engineering|sales)\s+jobs?\b.*$/i, "")
    .trim();
}

/**
 * Extract a company/org subject from article-style text.
 * Publisher is never the entity. Multiple distinct subjects → ambiguous.
 */
export function extractSubjectsFromArticle(args: {
  title: string;
  snippet?: string | null;
  url?: string | null;
}): { subjects: string[]; ambiguous: boolean; method: string } {
  const host = hostOf(args.url);
  const title = args.title.trim();
  const snippet = (args.snippet ?? "").trim();
  const subjects: string[] = [];

  const raise =
    /^(.{2,60}?)\s+(raises?|raised|announces?|lands?|closes?|secures?)\b/i.exec(title) ||
    /\b([A-Z][\w.&']+(?:\s+[A-Z][\w.&']+){0,4})\s+(raises?|raised|announces?)\b/.exec(
      `${title} ${snippet}`,
    );
  if (raise?.[1]) {
    const n = cleanTitleChrome(raise[1]).replace(/[,:].*$/, "").trim();
    if (n.length >= 2 && !PUBLISHER_HOSTS.test(n)) subjects.push(n);
  }

  // Second subject pattern: "X and Y raise" / "X, Y announce"
  const multi = /\b([A-Z][\w.&']+)\s+and\s+([A-Z][\w.&']+)\s+(raise|announce)/i.exec(
    `${title} ${snippet}`,
  );
  if (multi) {
    subjects.push(multi[1], multi[2]);
  }

  const uniq = [...new Set(subjects.map((s) => s.trim()).filter((s) => s.length >= 2))];
  // Drop publisher brand if it leaked in
  const filtered = uniq.filter((s) => {
    const n = normalizeEntityName(s);
    if (host && n.includes(normalizeEntityName(host.split(".")[0] ?? ""))) return false;
    if (/\b(techcrunch|forbes|reuters)\b/i.test(s)) return false;
    return true;
  });

  return {
    subjects: filtered,
    ambiguous: filtered.length > 1,
    method: filtered.length ? "article_subject_pattern" : "article_no_subject",
  };
}

/**
 * "Acme - Marketing Jobs" on a job board must NOT become Acme from title alone.
 */
export function extractEmployerFromJobBoardTitle(title: string): string | null {
  // Explicitly refuse the common false pattern.
  if (/\b(jobs?|careers?|hiring|openings?)\b/i.test(title)) {
    return null;
  }
  return null;
}

function matchKnown(
  extracted: { name: string; domain: string | null },
  known: KnownEntity[],
): { hit: KnownEntity; confidence: number; signal: string } | null {
  const nName = normalizeEntityName(extracted.name);
  const nDom = extracted.domain;

  for (const k of known) {
    const kd = normalizeDomain(k.domain ?? null);
    if (nDom && kd && nDom === kd) {
      return { hit: k, confidence: 0.95, signal: `known_domain:${kd}` };
    }
  }

  const nameHits = known.filter(
    (k) => nName && normalizeEntityName(k.name) === nName && nName.length >= 3,
  );
  if (nameHits.length > 1) {
    // Same display name, multiple registry rows — fail closed (ambiguous).
    return null;
  }
  if (nameHits.length === 1) {
    const k = nameHits[0]!;
    // Unique registry name match: enough to resolve when Spec later binds claims.
    // Name collision across rows is handled above.
    const conf = nDom ? 0.88 : 0.75;
    return { hit: k, confidence: conf, signal: `known_name_unique:${nName}` };
  }
  return null;
}

function entityPageType(t: ResolvedEntityType): PageType {
  if (t === "person") return "person_page";
  if (t === "job") return "job_posting";
  if (t === "company" || t === "organization" || t === "investor") return "company_page";
  return "entity_page";
}

function rowKind(t: ResolvedEntityType): SpecRow["kind"] {
  if (t === "organization") return "company";
  if (t === "person" || t === "company" || t === "business" || t === "job" || t === "investor") {
    return t;
  }
  return "company";
}

function unresolvedResult(args: {
  seed: string;
  source_page_type: PageType;
  source_url: string | null;
  reason: string;
  status?: ResolutionStatus;
  entity_type?: ResolvedEntityType;
  name?: string | null;
  confidence?: number;
  signals?: string[];
  conflicts?: string[];
}): EntityResolutionResult {
  const status = args.status ?? "unresolved";
  return {
    status,
    entity_id: mintProvisionalEntityId(args.seed),
    entity_resolved: false,
    entity_type: args.entity_type ?? "company",
    name: args.name ?? null,
    domain: null,
    location: null,
    identity_confidence: args.confidence ?? 0,
    page_type: args.source_page_type,
    source_page_type: args.source_page_type,
    provenance: {
      method: status,
      signals: args.signals ?? [],
      observed_at: nowIso(),
      source_url: args.source_url,
      source_page_type: args.source_page_type,
      conflicts: args.conflicts,
    },
    reject_reason: args.reason,
  };
}

/**
 * Resolve a classified source into an entity — or refuse.
 * Does not read Spec.entity (no query-kind inheritance).
 */
export function resolveEntityCandidate(args: {
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  location?: string | null;
  phone?: string | null;
  /** Already-classified page type; re-classifies if omitted. */
  page_type?: PageType | null;
  /** Optional known registry for cross-source matching (tests + later DB). */
  known?: KnownEntity[];
  /** Seed for provisional ids. */
  seed?: string;
}): EntityResolutionResult {
  const title = (args.title ?? "").trim();
  const snippet = (args.snippet ?? "").trim();
  const url = args.url ?? null;
  const host = hostOf(url);
  // M7: merge caller known with registry/entity feed. Unique corroboration
  // may resolve; collisions stay fail-closed inside matchKnown. Gate stays 0.7.
  const known = mergeKnownWithRegistry(args.known, title, url);
  const seed = args.seed ?? url ?? title ?? "unknown";

  const clf = args.page_type
    ? {
        page_type: args.page_type,
        may_extract_entity: !isNonEntityPage(args.page_type),
        reason: "provided",
        confidence: 1,
      }
    : classifyPage({ url, title, snippet });

  const source_page_type = clf.page_type;

  // —— List / aggregator / directory: source only ——
  if (
    source_page_type === "list" ||
    source_page_type === "directory" ||
    source_page_type === "aggregator"
  ) {
    return unresolvedResult({
      seed,
      source_page_type,
      source_url: url,
      reason: "list_or_directory_is_source_not_entity",
      status: "rejected",
      signals: ["page_type_non_entity"],
    });
  }

  // —— Job board: never mint employer from "Acme - Marketing Jobs" ——
  if (source_page_type === "job_board" || JOB_BOARD_HOSTS.test(host)) {
    const bogus = extractEmployerFromJobBoardTitle(title);
    if (bogus) {
      return unresolvedResult({
        seed,
        source_page_type: "job_board",
        source_url: url,
        reason: "job_board_title_is_not_employer_identity",
        status: "rejected",
        name: bogus,
        signals: ["refused_title_employer_extract"],
      });
    }
    return unresolvedResult({
      seed,
      source_page_type: "job_board",
      source_url: url,
      reason: "job_board_is_source_not_employer",
      status: "rejected",
      signals: ["job_board_host"],
    });
  }

  // —— Article: extract underlying subject(s); publisher ≠ entity ——
  if (source_page_type === "article" || PUBLISHER_HOSTS.test(host)) {
    const { subjects, ambiguous, method } = extractSubjectsFromArticle({
      title,
      snippet,
      url,
    });
    if (ambiguous) {
      return unresolvedResult({
        seed,
        source_page_type: "article",
        source_url: url,
        reason: "article_mentions_multiple_entities",
        status: "ambiguous",
        signals: [method, ...subjects.map((s) => `subject:${s}`)],
        conflicts: subjects,
        name: subjects[0] ?? null,
        confidence: 0.4,
      });
    }
    if (!subjects.length) {
      return unresolvedResult({
        seed,
        source_page_type: "article",
        source_url: url,
        reason: "article_no_extractable_subject",
        status: "unresolved",
        signals: [method],
      });
    }
    const name = subjects[0]!;
    // Re-merge registry against the *extracted subject*, not the article title chrome.
    const knownForSubject = mergeKnownWithRegistry(known, name, null);
    const knownHit = matchKnown({ name, domain: null }, knownForSubject);
    const confidence = knownHit?.confidence ?? 0.62; // pattern alone < threshold
    const entity_type: ResolvedEntityType = knownHit?.hit.entity_type ?? "company";
    const domain = normalizeDomain(knownHit?.hit.domain ?? null);
    const resolved = confidence >= MIN_IDENTITY_CONFIDENCE;
    const entity_id = resolved
      ? knownHit?.hit.entity_id?.trim() ||
        (domain ? slugId("org", domain) : slugId("org", name))
      : mintProvisionalEntityId(`article:${name}`);
    return {
      status: resolved ? "resolved" : "unresolved",
      entity_id,
      entity_resolved: resolved,
      entity_type,
      name,
      domain,
      location: args.location ?? knownHit?.hit.location ?? null,
      identity_confidence: confidence,
      page_type: resolved ? entityPageType(entity_type) : "article",
      source_page_type: "article",
      provenance: {
        method,
        signals: [
          method,
          ...(knownHit ? [knownHit.signal] : ["no_registry_corroboration"]),
          `confidence:${confidence}`,
        ],
        observed_at: nowIso(),
        source_url: url,
        source_page_type: "article",
      },
      reject_reason: resolved ? undefined : "identity_confidence_below_threshold",
    };
  }

  // —— Institute / accelerator: org identity from host, never person ——
  if (source_page_type === "institute" || INSTITUTE_HOSTS.test(host)) {
    const name =
      cleanTitleChrome(title).replace(/\s*[|\-–—].*$/, "").trim() ||
      (host.includes("fi.co") ? "Founder Institute" : host.split(".")[0] || "Institute");
    const entity_type: ResolvedEntityType = "organization";
    // Domain-backed org identity is enough to resolve as an organization.
    const confidence = host ? 0.88 : 0.5;
    const resolved = confidence >= MIN_IDENTITY_CONFIDENCE;
    const entity_id = resolved
      ? slugId("org", host || name)
      : mintProvisionalEntityId(`institute:${name}`);
    return {
      status: resolved ? "resolved" : "unresolved",
      entity_id,
      entity_resolved: resolved,
      entity_type,
      name,
      domain: host || null,
      location: args.location ?? null,
      identity_confidence: confidence,
      // Entity page type so LIST_LIKE(institute) does not block a resolved org;
      // Spec person queries still fail ENTITY_TYPE_MISMATCH at the theorem.
      page_type: resolved ? "company_page" : "institute",
      source_page_type: "institute",
      provenance: {
        method: "institute_host_identity",
        signals: ["institute_or_program", host ? `domain:${host}` : "no_domain"],
        observed_at: nowIso(),
        source_url: url,
        source_page_type: "institute",
      },
    };
  }

  // —— LinkedIn company page — never a person (M12) ——
  if (/linkedin\.com\/company\//i.test(url ?? "")) {
    const slug =
      /linkedin\.com\/company\/([^/?#]+)/i.exec(url ?? "")?.[1]?.replace(/-/g, " ") ??
      null;
    const name =
      cleanTitleChrome(title).split(/[|\-–—]/)[0]?.trim() ||
      (slug
        ? slug.charAt(0).toUpperCase() + slug.slice(1)
        : null);
    if (!name || name.length < 2) {
      return unresolvedResult({
        seed,
        source_page_type: "company_page",
        source_url: url,
        reason: "linkedin_company_path_without_name",
        entity_type: "company",
      });
    }
    const confidence = slug ? 0.84 : 0.72;
    const resolved = confidence >= MIN_IDENTITY_CONFIDENCE;
    return {
      status: resolved ? "resolved" : "unresolved",
      entity_id: resolved
        ? slugId("org", slug ?? name)
        : mintProvisionalEntityId(`org:${name}`),
      entity_resolved: resolved,
      entity_type: "company",
      name,
      domain: null,
      location: args.location ?? null,
      identity_confidence: confidence,
      page_type: "company_page",
      source_page_type:
        source_page_type === "unknown" ? "company_page" : source_page_type,
      provenance: {
        method: "linkedin_company_path",
        signals: slug ? [`company_slug:${slug}`] : ["title_name_only"],
        observed_at: nowIso(),
        source_url: url,
        source_page_type: "company_page",
      },
      reject_reason: resolved ? undefined : "identity_confidence_below_threshold",
    };
  }

  // —— LinkedIn person path ——
  if (/linkedin\.com\/in\//i.test(url ?? "")) {
    const handle =
      /linkedin\.com\/in\/([^/?#]+)/i.exec(url ?? "")?.[1]?.replace(/-/g, " ") ?? null;
    const name = cleanTitleChrome(title).split(/[|\-–—]/)[0]?.trim() || handle;
    if (!name || name.length < 2) {
      return unresolvedResult({
        seed,
        source_page_type: "person_page",
        source_url: url,
        reason: "person_path_without_name",
      });
    }
    const confidence = handle ? 0.82 : 0.6;
    const resolved = confidence >= MIN_IDENTITY_CONFIDENCE;
    return {
      status: resolved ? "resolved" : "unresolved",
      entity_id: resolved
        ? slugId("person", handle ?? name)
        : mintProvisionalEntityId(`person:${name}`),
      entity_resolved: resolved,
      entity_type: "person",
      name,
      domain: null,
      location: args.location ?? null,
      identity_confidence: confidence,
      page_type: "person_page",
      source_page_type: source_page_type === "unknown" ? "person_page" : source_page_type,
      provenance: {
        method: "linkedin_person_path",
        signals: handle ? [`handle:${handle}`] : ["title_name_only"],
        observed_at: nowIso(),
        source_url: url,
        source_page_type: "person_page",
      },
      reject_reason: resolved ? undefined : "identity_confidence_below_threshold",
    };
  }

  // —— First-party company / business site ——
  if (isFirstPartyEntityHost(host)) {
    const fromTitle = cleanTitleChrome(title);
    const domainLabel = host.split(".")[0] ?? "";
    // Title alone is insufficient: require domain corroboration.
    // Prefer domain brand; accept title when it shares tokens with domain.
    const titleNorm = normalizeEntityName(fromTitle);
    const domNorm = normalizeEntityName(domainLabel);
    const titleAgrees =
      !!titleNorm &&
      !!domNorm &&
      (titleNorm.includes(domNorm) ||
        domNorm.includes(titleNorm.split(" ")[0] ?? "") ||
        titleNorm.split(" ").some((t) => t.length > 3 && domNorm.includes(t)));

    let name: string;
    let confidence: number;
    const signals: string[] = [`domain:${host}`];

    if (titleAgrees && fromTitle.length >= 2) {
      name = fromTitle.split(/[|\-–—]/)[0]!.trim();
      confidence = 0.9;
      signals.push("title_domain_agreement");
    } else if (domNorm.length >= 2) {
      // Domain brand only — still a real identity signal (not SERP title inventing).
      name = domainLabel.replace(/-/g, " ");
      name = name.charAt(0).toUpperCase() + name.slice(1);
      confidence = 0.78;
      signals.push("domain_brand_only");
    } else {
      return unresolvedResult({
        seed,
        source_page_type,
        source_url: url,
        reason: "first_party_host_without_usable_identity",
        signals,
      });
    }

    // Conflict: title names a clearly different org than the domain brand.
    if (
      fromTitle &&
      titleNorm &&
      domNorm &&
      !titleAgrees &&
      titleNorm.length >= 4 &&
      !titleNorm.includes(domNorm) &&
      /\b(inc|llc|labs|studio|software|technologies)\b/i.test(fromTitle)
    ) {
      return unresolvedResult({
        seed,
        source_page_type,
        source_url: url,
        reason: "conflicting_title_and_domain_identity",
        status: "ambiguous",
        name: fromTitle,
        confidence: 0.35,
        signals: [...signals, "title_domain_conflict"],
        conflicts: [fromTitle, domainLabel],
      });
    }

    const knownHit = matchKnown({ name, domain: host }, known);
    if (knownHit) {
      confidence = Math.max(confidence, knownHit.confidence);
      signals.push(knownHit.signal);
      if (
        knownHit.hit.entity_type === "person" &&
        knownHit.confidence >= 0.8
      ) {
        // Domain matched a known person registry entry — unusual; fail closed if type clash with org site.
        return unresolvedResult({
          seed,
          source_page_type,
          source_url: url,
          reason: "conflicting_known_person_vs_org_domain",
          status: "ambiguous",
          signals: [...signals, "type_conflict"],
          conflicts: ["person", "company"],
        });
      }
    }

    const phone = args.phone?.replace(/\D/g, "") ?? "";
    if (phone.length >= 10) {
      confidence = Math.min(1, confidence + 0.05);
      signals.push("phone_present");
    }

    const entity_type: ResolvedEntityType =
      knownHit?.hit.entity_type === "business"
        ? "business"
        : knownHit?.hit.entity_type === "investor"
          ? "investor"
          : "company";

    const resolved = confidence >= MIN_IDENTITY_CONFIDENCE;
    const entity_id = resolved
      ? knownHit?.hit.entity_id?.trim() || slugId("org", host)
      : mintProvisionalEntityId(`web:${host}`);

    return {
      status: resolved ? "resolved" : "unresolved",
      entity_id,
      entity_resolved: resolved,
      entity_type,
      name: knownHit?.hit.name ?? name,
      domain: host,
      location: args.location ?? knownHit?.hit.location ?? null,
      identity_confidence: confidence,
      page_type: resolved ? entityPageType(entity_type) : source_page_type,
      source_page_type,
      provenance: {
        method: "first_party_domain",
        signals,
        observed_at: nowIso(),
        source_url: url,
        source_page_type,
      },
      reject_reason: resolved ? undefined : "identity_confidence_below_threshold",
    };
  }

  // —— Social post / unknown: refuse title-as-identity ——
  if (source_page_type === "social_post") {
    return unresolvedResult({
      seed,
      source_page_type,
      source_url: url,
      reason: "social_post_needs_author_resolution",
      signals: ["social_deferred_m14"],
    });
  }

  // Title-only unknown page — never resolve.
  return unresolvedResult({
    seed,
    source_page_type,
    source_url: url,
    reason: "title_alone_is_not_entity_identity",
    name: title || null,
    confidence: 0.2,
    signals: ["refused_title_only"],
  });
}

/**
 * Apply resolution onto a SpecRow after page classification.
 * Never copies Spec.entity. Rebinds evidence.subject when resolved.
 */
export function applyEntityResolutionToRow<
  T extends SpecRow & {
    entity_id?: string | null;
    entity_resolved?: boolean | null;
    page_type?: PageType | null;
    identity_confidence?: number | null;
    source_page_type?: PageType | null;
    resolution_method?: string | null;
  },
>(
  row: T,
  opts?: { known?: KnownEntity[] },
): T {
  const result = resolveEntityCandidate({
    url: row.url,
    title: row.title,
    snippet: row.detail,
    location: row.location,
    phone: row.phone,
    page_type: row.page_type,
    known: opts?.known,
    seed: row.key ?? row.url ?? row.title,
  });

  const evidence = (row.evidence ?? []).map((e) =>
    result.entity_resolved
      ? { ...e, subject: result.entity_id }
      : { ...e, subject: e.subject ?? undefined },
  );

  return {
    ...row,
    entity_id: result.entity_id,
    entity_resolved: result.entity_resolved,
    identity_confidence: result.identity_confidence,
    page_type: result.page_type,
    source_page_type: result.source_page_type,
    resolution_method: result.provenance.method,
    // Display name = resolved entity name when we have one; else keep title.
    title: result.name?.trim() || row.title,
    kind: result.entity_resolved ? rowKind(result.entity_type) : row.kind,
    location: result.location ?? row.location,
    url: row.url,
    evidence,
    // Keep provisional rows discoverable but never verified.
    verification_status: result.entity_resolved
      ? row.verification_status
      : (row.verification_status ?? "discovered"),
  };
}

/** True when a row still carries only a provisional / below-threshold identity. */
export function isUnresolvedIdentity(row: {
  entity_id?: string | null;
  entity_resolved?: boolean | null;
  identity_confidence?: number | null;
}): boolean {
  if (row.entity_resolved !== true) return true;
  if (isProvisionalEntityId(row.entity_id)) return true;
  if (
    typeof row.identity_confidence === "number" &&
    row.identity_confidence < MIN_IDENTITY_CONFIDENCE
  ) {
    return true;
  }
  return false;
}
