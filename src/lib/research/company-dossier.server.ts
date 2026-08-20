/**
 * Multi-source company dossier for research-driven outreach.
 * Fetches website / careers / about pages + optional news/SEC snippets,
 * then returns citable evidence for the research LLM.
 */
import { resolveCompanyDomain, domainsInText } from "@/lib/contact/contact-finder.server";
import { fetchPageContent } from "@/lib/search/page-enrichment.server";
import { resilientText } from "@/lib/search/http-fetch.server";
import { condensePageText, validateFetchedPage } from "@/lib/search/fetch-gate.server";

export type VerifiedHook = {
  claim: string;
  citation_url: string;
  source_type: "lead_post" | "website" | "careers" | "news" | "sec" | "about";
};

export type DossierPage = {
  url: string;
  source_type: VerifiedHook["source_type"];
  title: string;
  text: string;
};

export type CompanyDossier = {
  company: string;
  domain: string | null;
  pages: DossierPage[];
  allowed_urls: string[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPlainPage(
  url: string,
  relevanceTokens?: string[],
): Promise<{ title: string; text: string } | null> {
  const viaWorker = await fetchPageContent(url);
  if (viaWorker?.text || viaWorker?.markdown) {
    const title = viaWorker.title || url;
    const text = condensePageText(viaWorker.text || viaWorker.markdown || "", 8000);
    const gate = validateFetchedPage({ url, title, text, relevanceTokens });
    if (!gate.ok) return null;
    return { title, text };
  }
  try {
    const html = await resilientText(url, { retries: 1 });
    if (!html || html.length < 80) return null;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = (titleMatch?.[1] || url).trim().slice(0, 200);
    const text = condensePageText(stripHtml(html), 8000);
    const gate = validateFetchedPage({ url, title, text, relevanceTokens });
    if (!gate.ok) return null;
    return { title, text };
  } catch {
    return null;
  }
}

function guessCompanyName(leadTitle: string, leadAuthor?: string, leadSnippet?: string): string {
  if (
    leadAuthor &&
    leadAuthor.length > 1 &&
    leadAuthor.length < 80 &&
    !/anon|unknown|reddit/i.test(leadAuthor)
  ) {
    return leadAuthor.trim();
  }
  const fromTitle = leadTitle.split(/[@—|:-]/)[0]?.trim();
  if (fromTitle && fromTitle.length > 1 && fromTitle.length < 80) return fromTitle;
  const m = (leadSnippet || "").match(
    /\b(?:at|@)\s+([A-Z][\w&.-]{1,40}(?:\s+[A-Z][\w&.-]{1,30}){0,2})/,
  );
  return m?.[1]?.trim() || fromTitle || "Unknown company";
}

async function collectDomainPages(domain: string, companyName?: string): Promise<DossierPage[]> {
  const paths: Array<{ path: string; source_type: VerifiedHook["source_type"] }> = [
    { path: "/", source_type: "website" },
    { path: "/about", source_type: "about" },
    { path: "/about-us", source_type: "about" },
    { path: "/careers", source_type: "careers" },
    { path: "/jobs", source_type: "careers" },
    { path: "/contact", source_type: "website" },
    { path: "/company", source_type: "about" },
  ];
  const tokens = (companyName || "")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 4);
  const out: DossierPage[] = [];
  const seen = new Set<string>();
  for (const { path, source_type } of paths) {
    if (out.length >= 4) break;
    const url = `https://${domain}${path === "/" ? "" : path}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await fetchPlainPage(url, tokens);
    if (!page) continue;
    out.push({ url, source_type, title: page.title, text: page.text.slice(0, 4000) });
  }
  return out;
}

/** Optional SearXNG pass for news / SEC mentions of the company. */
async function fetchSignalSnippets(company: string, domain: string | null): Promise<DossierPage[]> {
  try {
    const { searchSearxng } = await import("@/lib/search/searxng.server");
    const queries = [
      `"${company}" (hiring OR careers OR funding OR breach OR SOC)`,
      domain ? `site:sec.gov "${company}"` : `site:sec.gov "${company}" 10-K`,
    ];
    const results = await searchSearxng(queries, 4, "month");
    const pages: DossierPage[] = [];
    for (const r of results.slice(0, 4)) {
      const url = r.url;
      if (!url) continue;
      const isSec = /sec\.gov/i.test(url);
      pages.push({
        url,
        source_type: isSec ? "sec" : "news",
        title: r.title || url,
        text: (r.content || r.title || "").slice(0, 1200),
      });
    }
    return pages;
  } catch {
    return [];
  }
}

export async function buildCompanyDossier(input: {
  leadUrl: string;
  leadTitle: string;
  leadSnippet: string;
  leadAuthor?: string;
}): Promise<CompanyDossier> {
  const company = guessCompanyName(input.leadTitle, input.leadAuthor, input.leadSnippet);
  const postText = `${input.leadTitle}\n${input.leadSnippet}\n${input.leadUrl}`;
  const fromPost = domainsInText(postText).filter(
    (d) => !/linkedin|reddit|twitter|x\.com|indeed|greenhouse|lever|ashby/i.test(d),
  );

  let domain: string | null = fromPost[0] ?? null;
  if (!domain) {
    const resolved = await resolveCompanyDomain(company, postText);
    if (resolved && (resolved.verified || resolved.via === "post_text")) {
      domain = resolved.domain;
    } else if (resolved?.via === "unverified_guess") {
      // Still try homepage fetch — dossier pages will be empty if it fails
      domain = resolved.domain;
    }
  }

  const pages: DossierPage[] = [
    {
      url: input.leadUrl,
      source_type: "lead_post",
      title: input.leadTitle,
      text: input.leadSnippet.slice(0, 4000),
    },
  ];

  if (domain) {
    const sitePages = await collectDomainPages(domain, company);
    pages.push(...sitePages);
  }

  const snippets = await fetchSignalSnippets(company, domain);
  pages.push(...snippets);

  return {
    company,
    domain,
    pages,
    allowed_urls: [...new Set(pages.map((p) => p.url))],
  };
}

export function dossierContextForPrompt(dossier: CompanyDossier): string {
  const blocks = dossier.pages.map((p, i) => {
    return `[Source ${i + 1} | ${p.source_type} | ${p.url}]
Title: ${p.title}
Excerpt:
${p.text.slice(0, 2500)}`;
  });
  return `Company: ${dossier.company}
Domain: ${dossier.domain ?? "unknown"}
Allowed citation URLs (hooks MUST use one of these):
${dossier.allowed_urls.map((u) => `- ${u}`).join("\n")}

Evidence:
${blocks.join("\n\n---\n\n")}`;
}
