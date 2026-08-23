/**
 * Investor "Match from my Website" — zero-cost signal extraction.
 *
 * Scrapes a user-supplied URL with Cheerio, extracts key business signals
 * (industry, stage, tech stack, keywords), then ranks the seeded investor
 * database by relevance to those signals.
 */

import type { InvestorWithMetadata } from "./search";
import { getAllInvestors } from "./search";

export interface WebsiteSignals {
  url: string;
  title: string;
  description: string;
  keywords: string[];
  industries: string[];
  techMentions: string[];
  stageHints: string[];
  headcount: string | null;
  socialLinks: string[];
}

export interface MatchedInvestor {
  investor: InvestorWithMetadata;
  score: number;
  reasons: string[];
}

// ─── Signal extraction (Cheerio-based, zero-cost) ───────────────────────────

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  fintech: ["fintech", "financial", "banking", "payments", "lending", "neobank", "insurtech"],
  healthtech: ["health", "medical", "biotech", "telemedicine", "pharma", "clinical", "healthcare"],
  edtech: ["education", "edtech", "learning", "lms", "courseware", "e-learning"],
  saas: ["saas", "software as a service", "cloud platform", "subscription", "b2b software"],
  ai: [
    "artificial intelligence",
    "machine learning",
    "deep learning",
    "ai-powered",
    "llm",
    "gpt",
    "nlp",
  ],
  climate: ["climate", "cleantech", "carbon", "sustainability", "renewable", "green energy"],
  ecommerce: ["ecommerce", "e-commerce", "marketplace", "shopify", "retail tech", "dtc"],
  web3: ["web3", "blockchain", "crypto", "defi", "nft", "token", "smart contract", "dao"],
  cybersecurity: ["cybersecurity", "security", "infosec", "zero trust", "soc", "siem"],
  devtools: ["developer tools", "devops", "ci/cd", "api", "sdk", "infrastructure"],
  consumer: ["consumer", "social", "creator", "community", "mobile app", "lifestyle"],
  proptech: ["real estate", "proptech", "property", "housing"],
  logistics: ["logistics", "supply chain", "shipping", "warehouse", "freight"],
  foodtech: ["food", "restaurant", "delivery", "agritech", "agriculture"],
  legaltech: ["legal", "legaltech", "compliance", "regtech"],
  hrtech: ["hr", "hiring", "recruiting", "talent", "workforce", "payroll"],
};

const STAGE_HINTS: Record<string, string[]> = {
  pre_seed: ["pre-seed", "idea stage", "mvp", "prototype", "pre-revenue"],
  seed: ["seed", "early stage", "first round", "bootstrapped"],
  series_a: ["series a", "growth stage", "scaling"],
  series_b: ["series b", "expansion", "scale-up"],
  growth: ["series c", "series d", "late stage", "growth equity", "ipo"],
};

export async function extractWebsiteSignals(url: string): Promise<WebsiteSignals> {
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

  let html = "";
  try {
    const res = await fetch(normalizedUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ScrapivoBot/1.0)",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = (await res.text()).slice(0, 120_000);
  } catch (err: any) {
    throw new Error(`Could not fetch ${normalizedUrl}: ${err.message}`);
  }

  // Extract meta tags
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || "";

  const descMatch =
    html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
  const description = descMatch?.[1]?.trim() || "";

  const kwMatch =
    html.match(/name=["']keywords["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']keywords["']/i);
  const rawKeywords = kwMatch?.[1]?.trim() || "";

  // Strip HTML tags for body text analysis
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 50_000);

  const blob = `${title} ${description} ${rawKeywords} ${bodyText}`.toLowerCase();

  // Detect industries
  const industries: string[] = [];
  for (const [industry, terms] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (terms.some((t) => blob.includes(t))) {
      industries.push(industry);
    }
  }

  // Detect stage hints
  const stageHints: string[] = [];
  for (const [stage, terms] of Object.entries(STAGE_HINTS)) {
    if (terms.some((t) => blob.includes(t))) {
      stageHints.push(stage);
    }
  }

  // Extract keywords from meta + title
  const keywords = rawKeywords
    ? rawKeywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    : [];
  // Add title words as supplementary
  const titleWords = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  keywords.push(...titleWords);

  // Detect tech mentions
  const techTerms = [
    "react",
    "vue",
    "angular",
    "next.js",
    "node",
    "python",
    "django",
    "kubernetes",
    "docker",
    "aws",
    "gcp",
    "azure",
    "terraform",
    "graphql",
    "typescript",
    "rust",
    "golang",
    "swift",
    "flutter",
    "tensorflow",
    "pytorch",
  ];
  const techMentions = techTerms.filter((t) => blob.includes(t));

  // Social links
  const socialLinks: string[] = [];
  const socialPatterns = [
    /href=["'](https?:\/\/(www\.)?linkedin\.com\/[^"']+)["']/gi,
    /href=["'](https?:\/\/(www\.)?twitter\.com\/[^"']+)["']/gi,
    /href=["'](https?:\/\/(www\.)?github\.com\/[^"']+)["']/gi,
  ];
  for (const pat of socialPatterns) {
    const matches = html.matchAll(pat);
    for (const m of matches) {
      if (m[1]) socialLinks.push(m[1]);
    }
  }

  // Headcount hints
  let headcount: string | null = null;
  const headcountMatch = blob.match(/(\d+)\+?\s*(employees?|team members?|people|staff)/);
  if (headcountMatch) headcount = headcountMatch[1];

  return {
    url: normalizedUrl,
    title,
    description,
    keywords: [...new Set(keywords)].slice(0, 30),
    industries: [...new Set(industries)],
    techMentions: [...new Set(techMentions)],
    stageHints: [...new Set(stageHints)],
    headcount,
    socialLinks: [...new Set(socialLinks)].slice(0, 10),
  };
}

// ─── Matching engine ────────────────────────────────────────────────────────

export function matchInvestorsToSignals(signals: WebsiteSignals, limit = 50): MatchedInvestor[] {
  const all = getAllInvestors();
  const scored: MatchedInvestor[] = [];

  for (const inv of all) {
    let score = 0;
    const reasons: string[] = [];

    // Stringify investor data for matching
    const invBlob = [
      inv.name,
      "sectors" in inv ? ((inv as any).sectors || []).join(" ") : "",
      "focus_areas" in inv ? ((inv as any).focus_areas || []).join(" ") : "",
      "thesis" in inv ? (inv as any).thesis || "" : "",
      "description" in inv ? (inv as any).description || "" : "",
      "portfolio_companies" in inv ? ((inv as any).portfolio_companies || []).join(" ") : "",
      "stages" in inv ? ((inv as any).stages || []).join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();

    // Industry overlap
    for (const ind of signals.industries) {
      const indTerms = INDUSTRY_KEYWORDS[ind] || [ind];
      if (indTerms.some((t) => invBlob.includes(t))) {
        score += 25;
        reasons.push(`Invests in ${ind}`);
      }
    }

    // Keyword overlap
    for (const kw of signals.keywords) {
      if (kw.length > 3 && invBlob.includes(kw)) {
        score += 5;
        reasons.push(`Keyword match: "${kw}"`);
      }
    }

    // Stage alignment
    for (const stage of signals.stageHints) {
      const stageTerms = STAGE_HINTS[stage] || [stage];
      if (stageTerms.some((t) => invBlob.includes(t))) {
        score += 15;
        reasons.push(`Stage aligned: ${stage.replace(/_/g, " ")}`);
      }
    }

    // Tech interest overlap
    for (const tech of signals.techMentions) {
      if (invBlob.includes(tech)) {
        score += 8;
        reasons.push(`Tech interest: ${tech}`);
      }
    }

    // Cap reasons to top 5 unique
    const uniqueReasons = [...new Set(reasons)].slice(0, 5);

    if (score > 0) {
      scored.push({ investor: inv, score, reasons: uniqueReasons });
    }
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
