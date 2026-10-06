/**
 * Page / source classification (M2).
 *
 * A URL/title/snippet is a SOURCE until classified. List pages, job boards,
 * institutes, aggregators, and articles cannot become the lead entity.
 *
 * Forbidden: query-kind inheritance, page title as entity identity.
 */
import type { PageType } from "@/lib/search/canonical-contract";
import { mintProvisionalEntityId } from "@/lib/search/canonical-contract";

export type PageClassification = {
  page_type: PageType;
  /** True only when the page is plausibly a single-entity page. */
  may_extract_entity: boolean;
  reason: string;
  confidence: number;
};

const HOST_JOB_BOARD =
  /\b(monster|indeed|lever\.co|greenhouse\.io|ashbyhq|workable|smartrecruiters|linkedin\.com\/jobs|ziprecruiter|glassdoor|wellfound|angellist|dice\.com|reed\.co|totaljobs)\b/i;

const HOST_LIST_AGG =
  /\b(seedtable|failory|crunchbase\.com\/lists|producthunt|betalist|startupranking|vcbacked|handpicked|projectstartups|ycombinator\.com\/companies)\b/i;

const HOST_INSTITUTE =
  /\b(fi\.co|founderinstitute|foundersinstitute|startupschool|techstars\.com\/accelerat)\b/i;

const TITLE_LIST =
  /\b(50|100|top|best|list of|directory of|startups? (in|to watch)|funded startups|companies (hiring|to watch)|browse (jobs|openings))\b/i;

const TITLE_JOB_BOARD =
  /\b(jobs? (in|near|at)|hiring now|open (roles|positions)|job openings?|careers? at|marketing jobs|developer jobs)\b/i;

const TITLE_INSTITUTE =
  /\b(institute|accelerator|incubator|bootcamp|fellowship|founders? program)\b/i;

const TITLE_ARTICLE =
  /\b(how to|why |what is|guide to|raises \$|raised \$|announces|blog|news)\b/i;

function hostOf(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return "";
  }
}

/**
 * Classify a source page before any entity qualification.
 * Does NOT invent an entity — only says what kind of page this is.
 */
export function classifyPage(args: {
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
}): PageClassification {
  const url = args.url ?? "";
  const title = args.title ?? "";
  const snippet = args.snippet ?? "";
  const host = hostOf(url);
  const hay = `${title} ${snippet} ${host}`.toLowerCase();

  if (HOST_JOB_BOARD.test(host) || HOST_JOB_BOARD.test(url) || TITLE_JOB_BOARD.test(title)) {
    return {
      page_type: "job_board",
      may_extract_entity: false,
      reason: "job_board_or_listings_page",
      confidence: 0.9,
    };
  }
  if (HOST_LIST_AGG.test(host) || HOST_LIST_AGG.test(url) || TITLE_LIST.test(title)) {
    return {
      page_type: TITLE_LIST.test(title) && !HOST_LIST_AGG.test(host) ? "list" : "aggregator",
      may_extract_entity: false,
      reason: "list_or_directory_or_aggregator",
      confidence: 0.85,
    };
  }
  if (HOST_INSTITUTE.test(host) || TITLE_INSTITUTE.test(title)) {
    return {
      page_type: "institute",
      may_extract_entity: false,
      reason: "institute_or_program_org",
      confidence: 0.85,
    };
  }
  if (/\b(reddit\.com|facebook\.com\/groups|linkedin\.com\/posts)\b/i.test(host + url)) {
    return {
      page_type: "social_post",
      may_extract_entity: true,
      reason: "social_post",
      confidence: 0.8,
    };
  }
  if (TITLE_ARTICLE.test(title) || /\b(techcrunch|forbes|medium\.com|substack)\b/i.test(host)) {
    return {
      page_type: "article",
      may_extract_entity: false,
      reason: "article_or_news — entity is not the publisher by default",
      confidence: 0.75,
    };
  }
  if (/\b(careers?|jobs?|hiring)\b/i.test(hay) && /\b(at |@ |company)\b/i.test(hay)) {
    return {
      page_type: "job_posting",
      may_extract_entity: true,
      reason: "likely_single_job_posting",
      confidence: 0.6,
    };
  }

  // Unknown / generic company-looking page — still NOT resolved identity.
  return {
    page_type: "unknown",
    may_extract_entity: true,
    reason: "unclassified_source_page",
    confidence: 0.4,
  };
}

/** Page types that can never be the QualifiedLead entity. */
export function isNonEntityPage(pageType: PageType): boolean {
  return (
    pageType === "list" ||
    pageType === "directory" ||
    pageType === "aggregator" ||
    pageType === "job_board" ||
    pageType === "article" ||
    pageType === "institute"
  );
}

/**
 * Apply classification to a live SERP candidate.
 * Never inherits Spec.entity as the row kind from the query alone for
 * unresolved sources — kind stays provisional via entity_resolved=false.
 */
export function applyPageClassificationToLiveRow<
  T extends {
    title: string;
    url?: string | null;
    detail?: string;
    kind: string;
    key?: string | null;
    entity_id?: string | null;
    entity_resolved?: boolean | null;
    page_type?: PageType | null;
  },
>(row: T): T & { page_type: PageType; entity_resolved: boolean; entity_id: string } {
  const clf = classifyPage({
    url: row.url,
    title: row.title,
    snippet: row.detail,
  });
  const reject = isNonEntityPage(clf.page_type);
  return {
    ...row,
    page_type: clf.page_type,
    // Live SERP never auto-resolves from title alone.
    entity_resolved: false,
    entity_id:
      row.entity_id?.startsWith("provisional:") || !row.entity_id
        ? mintProvisionalEntityId(row.key ?? row.url ?? row.title)
        : row.entity_id,
    ...(reject
      ? {
          /* keep provisional id; theorem will LIST_PAGE_AS_ENTITY */
        }
      : {}),
  } as T & { page_type: PageType; entity_resolved: boolean; entity_id: string };
}
