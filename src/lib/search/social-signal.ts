/**
 * Phase 1E / M14 — provider-agnostic social-signal interface on the SPEC path.
 *
 * Pipeline: provider hit → SocialArtifact → need detection → author resolve
 * → ClaimEvidence (subject-bound) → SpecRow.
 *
 * POST ≠ AUTHOR ≠ COMPANY. Never inherit Spec.entity onto a social post.
 * posted_at → event_at; observed_at is crawl time only.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { makeEvidence, type Evidence } from "@/lib/search/evidence";
import {
  socialArtifactFromHit,
  socialArtifactKey,
  type SocialArtifact,
  type SocialHitLike,
} from "@/lib/search/social-artifact";
import {
  detectSocialNeed,
  socialNeedMatchesSpec,
  type SocialNeedDetection,
} from "@/lib/search/social-need";
import {
  resolveSocialAuthor,
  socialAuthorSatisfiesPersonSpec,
  type SocialAuthorResolver,
  type SocialAuthorResolution,
} from "@/lib/search/social-author";
import { bindSocialClaimSubject } from "@/lib/search/social-company";

export interface SocialSignalHit {
  title: string;
  url: string;
  excerpt: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
}

export interface SocialSignalProvider {
  id: string;
  /** Discover social demand posts for this spec. */
  search(spec: SearchSpec, limit?: number): Promise<SocialSignalHit[]>;
}

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c?.value?.trim() ? c.value : null;
}

/** Build a Reddit search query from requested need fields. */
export function socialQueryFromSpec(spec: SearchSpec): string {
  const role = fieldOf(spec, "requested_role");
  const service = fieldOf(spec, "requested_service");
  const product = fieldOf(spec, "requested_product");
  const loc = fieldOf(spec, "location");
  const parts = [
    role ? `"${role}"` : null,
    service ? `"${service}"` : null,
    product ? `"${product}"` : null,
    "(looking for OR need OR hiring OR help)",
    loc,
  ].filter(Boolean);
  return parts.join(" ") || spec.raw_query;
}

/**
 * Typed social-provider failure — never conflate with an honest empty result.
 * www/old.reddit.com *.json are blocked (403) or removed (404); Spec-path
 * discovery uses Arctic Shift subreddit listings + client-side need filter.
 */
export class SocialProviderError extends Error {
  readonly code: "SOURCE_UNAVAILABLE" | "SOURCE_ERROR" | "PROVIDER_BLOCKED";
  readonly httpStatus?: number;
  readonly provider: string;

  constructor(
    message: string,
    opts: {
      code: SocialProviderError["code"];
      provider: string;
      httpStatus?: number;
    },
  ) {
    super(message);
    this.name = "SocialProviderError";
    this.code = opts.code;
    this.provider = opts.provider;
    this.httpStatus = opts.httpStatus;
  }
}

/** Demand-side subs where buyers ask — Arctic Shift has no cross-sub `q=` search. */
const ARCTIC_SIGNAL_SUBS = [
  "forhire",
  "slavelabour",
  "DoneDirtCheap",
  "HireaWriter",
  "hiring",
  "freelance_forhire",
  "smallbusiness",
  "Entrepreneur",
  "startups",
  "webdev",
];

const ARCTIC_SHIFT_POSTS =
  "https://arctic-shift.photon-reddit.com/api/posts/search";

function filterTermsFromQuery(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[()"']/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length >= 3 &&
        !/^(looking|for|need|needs|hiring|help|or|and|the|a|an)$/i.test(t),
    )
    .slice(0, 8);
}

function postMatchesTerms(
  title: string,
  body: string,
  terms: string[],
): boolean {
  if (!terms.length) return true;
  const hay = `${title} ${body}`.toLowerCase();
  // At least one content term (role/service/product) must appear.
  return terms.some((t) => hay.includes(t));
}

/**
 * Reddit via Arctic Shift — **transport only**.
 *
 * Emits SocialSignalHit rows (raw Reddit artifacts). Does NOT decide ask vs
 * seller, does NOT qualify, does NOT bind subjects. Downstream owns:
 * SocialArtifact → author resolve → need detect → subject bind → qualify().
 *
 * Soft term preference is retrieval narrowing (which posts to fetch), not a
 * lead gate — unmatched newest posts still fill the budget so need detection
 * can reject sellers honestly.
 */
export const redditSocialProvider: SocialSignalProvider = {
  id: "reddit-arctic-shift",
  async search(spec, limit = 8) {
    const q = socialQueryFromSpec(spec);
    const terms = filterTermsFromQuery(q);
    const preferred: SocialSignalHit[] = [];
    const rest: SocialSignalHit[] = [];
    const seen = new Set<string>();
    let anyOk = false;
    let lastStatus = 0;
    let blocked = 0;
    let transportFails = 0;

    for (const sub of ARCTIC_SIGNAL_SUBS) {
      if (preferred.length + rest.length >= limit * 3) break;
      try {
        const res = await fetch(
          `${ARCTIC_SHIFT_POSTS}?subreddit=${encodeURIComponent(sub)}&limit=50&sort=desc`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; ScrapivoDiscover/1.0; +https://scrapivo.local)",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(12_000),
          },
        );
        lastStatus = res.status;
        if (res.status === 403 || res.status === 429) {
          blocked++;
          continue;
        }
        if (!res.ok) {
          transportFails++;
          continue;
        }
        anyOk = true;
        const json = (await res.json()) as {
          data?: Array<Record<string, unknown>>;
        };
        for (const d of json.data ?? []) {
          const title = String(d.title ?? "");
          const permalink = String(d.permalink ?? "");
          const selftext = String(d.selftext ?? "");
          // Archive hygiene only — removed posts are not artifacts.
          if (selftext === "[removed]" || selftext === "[deleted]") continue;
          if (!title || !permalink) continue;
          const url = permalink.startsWith("http")
            ? permalink
            : `https://reddit.com${permalink}`;
          if (seen.has(url)) continue;
          seen.add(url);
          const hit: SocialSignalHit = {
            title,
            url,
            excerpt: (selftext || title).slice(0, 240),
            author:
              d.author && String(d.author) !== "[deleted]"
                ? String(d.author)
                : undefined,
            subreddit: String(d.subreddit ?? sub),
            created_utc:
              typeof d.created_utc === "number" ? d.created_utc : undefined,
          };
          if (postMatchesTerms(title, selftext, terms)) preferred.push(hit);
          else rest.push(hit);
        }
      } catch {
        transportFails++;
      }
    }

    const hits = [...preferred, ...rest].slice(0, limit);
    if (hits.length) return hits;
    if (!anyOk) {
      if (blocked > 0) {
        throw new SocialProviderError(
          `reddit arctic-shift blocked HTTP ${lastStatus || 403}`,
          {
            code: "PROVIDER_BLOCKED",
            provider: "reddit-arctic-shift",
            httpStatus: lastStatus || 403,
          },
        );
      }
      throw new SocialProviderError(
        `reddit arctic-shift unavailable (status=${lastStatus || 0}, fails=${transportFails})`,
        {
          code: "SOURCE_UNAVAILABLE",
          provider: "reddit-arctic-shift",
          httpStatus: lastStatus || undefined,
        },
      );
    }
    // Archive answered; nothing in the polled window — honest empty transport.
    return [];
  },
};

export type SocialPipelineResult = {
  artifact: SocialArtifact;
  need: SocialNeedDetection;
  author: SocialAuthorResolution;
  row: SpecRow | null;
  skip_reason?: string;
};

export type SocialHitsToRowsOptions = {
  observed_at?: string;
  /** Map platform author id → real-world person entity_id when known. */
  resolveAuthor?: SocialAuthorResolver;
  /** Extra employment / identity evidence for company-behalf binding. */
  extraEvidence?: Evidence[];
  /**
   * Proven author location — NEVER inferred from subreddit.
   * Keyed by platform author id or resolved entity_id.
   */
  authorLocations?: Record<string, string>;
  /** Prefer company subject when company_behalf + employment proven. */
  preferCompanySubject?: boolean;
  /** Include non-ask hits as skipped pipeline results (tests). */
  keepSkipped?: boolean;
};

function supportsField(spec: SearchSpec): Evidence["supports"] {
  if (fieldOf(spec, "requested_role")) return "requested_role";
  if (fieldOf(spec, "requested_service")) return "requested_service";
  if (fieldOf(spec, "requested_product")) return "requested_product";
  return "intent";
}

/**
 * One SocialArtifact → optional SpecRow through the M14 pipeline.
 * Non-asks and community containers yield row=null.
 */
export function socialArtifactToSpecRow(
  artifact: SocialArtifact,
  spec: SearchSpec,
  opts?: SocialHitsToRowsOptions,
): SocialPipelineResult {
  if (artifact.is_community_container) {
    return {
      artifact,
      need: detectSocialNeed(""),
      author: { status: "unresolved", reason: "community_container" },
      row: null,
      skip_reason: "community_container_not_a_lead",
    };
  }

  const need = detectSocialNeed(artifact.text);
  const author = resolveSocialAuthor(artifact, {
    resolveRealWorld: opts?.resolveAuthor,
  });

  if (!need.is_ask || !need.claim_type) {
    return {
      artifact,
      need,
      author,
      row: null,
      skip_reason: need.reject_reason ?? "not_an_ask",
    };
  }

  if (
    !socialNeedMatchesSpec(need, {
      requested_service: fieldOf(spec, "requested_service"),
      requested_product: fieldOf(spec, "requested_product"),
      requested_role: fieldOf(spec, "requested_role"),
    })
  ) {
    return {
      artifact,
      need,
      author,
      row: null,
      skip_reason: "need_mismatch_vs_spec",
    };
  }

  if (author.status === "unresolved") {
    return {
      artifact,
      need,
      author,
      row: null,
      skip_reason: author.reason,
    };
  }

  const authorEntityId = author.entity_id;
  const binding = bindSocialClaimSubject({
    author_entity_id: authorEntityId,
    need,
    evidence: opts?.extraEvidence ?? [],
    prefer_company_subject: opts?.preferCompanySubject,
  });

  // Personal path: subject = author. Company path only when binding ok.
  let subjectId = authorEntityId;
  let kind: SpecRow["kind"] = "person";
  if (need.claim_parameters.company_behalf === "true" && opts?.preferCompanySubject) {
    if (!binding.ok) {
      return {
        artifact,
        need,
        author,
        row: null,
        skip_reason: binding.reason,
      };
    }
    subjectId = binding.subject_entity_id;
    kind = binding.subject_kind === "company" ? "company" : "person";
  } else if (!binding.ok && opts?.preferCompanySubject) {
    return {
      artifact,
      need,
      author,
      row: null,
      skip_reason: binding.reason,
    };
  }

  const realWorld =
    kind === "person" ? socialAuthorSatisfiesPersonSpec(author) : true;

  const locKey = author.platform_id;
  const location =
    opts?.authorLocations?.[subjectId] ??
    opts?.authorLocations?.[locKey] ??
    null;

  // Align claim params with Spec so M9 parameter match can pass without
  // inventing need — only when detection already established an ask.
  const requestedService = fieldOf(spec, "requested_service");
  const requestedProduct = fieldOf(spec, "requested_product");
  const requestedRole = fieldOf(spec, "requested_role");
  const alignedParams: Record<string, string> = {
    ...need.claim_parameters,
    is_ask: "true",
    intent: need.intent,
    platform: artifact.platform,
    post_id: artifact.post_id,
    author_platform_id: artifact.author_platform_id ?? "",
    community: artifact.community ?? "",
  };
  if (requestedService) alignedParams.service = requestedService;
  if (requestedProduct) alignedParams.product = requestedProduct;
  if (requestedRole) alignedParams.role = requestedRole;
  // Map detected_need onto service/product when Spec left them empty.
  if (!alignedParams.service && need.detected_need === "website_help") {
    alignedParams.service = "website";
  }
  if (!alignedParams.product && need.detected_need === "website_help") {
    alignedParams.product = "website";
  }

  const evidence: Evidence[] = [
    makeEvidence({
      source_url: artifact.post_url,
      source_type: "social",
      excerpt: need.evidence_text.slice(0, 180),
      evidence_type: need.claim_type,
      supports: supportsField(spec),
      extraction_method: `${artifact.platform}_social_artifact`,
      confidence: need.confidence,
      subject: subjectId,
      // event_at = post timestamp; observed_at = crawl — never swapped.
      event_at: artifact.posted_at,
      observed_at: artifact.observed_at,
      claim_parameters: alignedParams,
    } as Evidence & { claim_parameters: Record<string, string> }),
    ...(opts?.extraEvidence ?? []),
  ];

  const row: SpecRow = {
    kind,
    key: socialArtifactKey(artifact),
    entity_id: subjectId,
    entity_resolved: realWorld && !authorEntityId.startsWith("provisional:"),
    page_type: "social_post",
    title: artifact.text.split("\n")[0]?.slice(0, 160) || artifact.post_url,
    detail: [
      artifact.community ? `r/${artifact.community}` : null,
      artifact.author_name ? `u/${artifact.author_name}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    url: artifact.post_url,
    email: null,
    phone: null,
    // Never copy Spec.location or subreddit onto the author.
    location,
    evidence,
    verification_status: "discovered",
  };

  return { artifact, need, author, row };
}

/**
 * Map provider hits through SocialArtifact → SpecRows.
 * Dedupes by post key. Filters non-asks. Does NOT inherit Spec.entity.
 */
export function socialHitsToSpecRows(
  hits: SocialSignalHit[],
  spec: SearchSpec,
  opts?: SocialHitsToRowsOptions,
): SpecRow[] {
  const seen = new Set<string>();
  const rows: SpecRow[] = [];
  for (const h of hits) {
    const artifact = socialArtifactFromHit(h as SocialHitLike, {
      observed_at: opts?.observed_at,
    });
    const key = socialArtifactKey(artifact);
    if (seen.has(key)) continue;
    seen.add(key);
    const result = socialArtifactToSpecRow(artifact, spec, opts);
    if (result.row) rows.push(result.row);
  }
  return rows;
}

/** Full pipeline results including skips (for tests / coverage). */
export function socialHitsThroughPipeline(
  hits: SocialSignalHit[],
  spec: SearchSpec,
  opts?: SocialHitsToRowsOptions,
): SocialPipelineResult[] {
  const seen = new Set<string>();
  const out: SocialPipelineResult[] = [];
  for (const h of hits) {
    const artifact = socialArtifactFromHit(h as SocialHitLike, {
      observed_at: opts?.observed_at,
    });
    const key = socialArtifactKey(artifact);
    if (seen.has(key)) {
      out.push({
        artifact,
        need: detectSocialNeed(artifact.text),
        author: resolveSocialAuthor(artifact, {
          resolveRealWorld: opts?.resolveAuthor,
        }),
        row: null,
        skip_reason: "duplicate_post",
      });
      continue;
    }
    seen.add(key);
    out.push(socialArtifactToSpecRow(artifact, spec, opts));
  }
  return out;
}

/** Run the default social provider when signal_required. */
export async function runSocialSignalGapfill(
  spec: SearchSpec,
  provider: SocialSignalProvider = redditSocialProvider,
): Promise<{
  rows: SpecRow[];
  provider: string;
  error?: string;
  /** Typed failure — never an honest zero. */
  failure_code?: "SOURCE_UNAVAILABLE" | "SOURCE_ERROR" | "PROVIDER_BLOCKED";
}> {
  if (!spec.signal_required) return { rows: [], provider: provider.id };
  try {
    const hits = await provider.search(spec, 8);
    return { rows: socialHitsToSpecRows(hits, spec), provider: provider.id };
  } catch (e) {
    if (e instanceof SocialProviderError) {
      return {
        rows: [],
        provider: provider.id,
        error: e.message,
        failure_code: e.code,
      };
    }
    return {
      rows: [],
      provider: provider.id,
      error: e instanceof Error ? e.message : String(e),
      failure_code: "SOURCE_ERROR",
    };
  }
}
