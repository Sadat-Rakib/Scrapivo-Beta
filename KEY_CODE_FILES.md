# 🔑 Key Code Files & Logic - Reference Guide

## 📁 Core Files Analysis

---

## 1️⃣ INVESTORS MODULE

### **Current Implementation** (Broken):

**File**: `src/lib/investors/search.ts`

**Problem Code** (Lines 36-48):

```typescript
function stageNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/series-?/g, "series-");
}

// This causes the bug:
if (stage) {
  rows = rows.filter((r) =>
    r.stages.some(
      (s) => stageNorm(s).includes(stage) || stage.includes(stageNorm(s)),
      // ❌ "seed" matches "pre-seed" because includes() is too broad
    ),
  );
}
```

**Fix Required**:

```typescript
// NEW FILE: src/lib/investors/stage-matcher.ts

const STAGE_HIERARCHY = {
  "pre-seed": {
    aliases: ["pre-seed", "preseed", "pre seed", "friends and family"],
    checkRange: [0, 500_000],
    excludeKeywords: ["\\bseed\\b"], // Regex: exclude plain "seed"
  },
  seed: {
    aliases: ["seed"],
    checkRange: [100_000, 5_000_000],
    excludeKeywords: ["pre", "series"], // Exclude "pre-seed" and "series"
  },
  "series-a": {
    aliases: ["series-a", "series a", "a round", "seriesa"],
    checkRange: [2_000_000, 20_000_000],
  },
  // ... more stages
};

function matchStage(investorStages: string[], filterStage: string): boolean {
  const filter = STAGE_HIERARCHY[filterStage.toLowerCase()];
  if (!filter) return false;

  return investorStages.some((stage) => {
    const stageNorm = stage.toLowerCase().trim();

    // Check aliases
    const aliasMatch = filter.aliases.some(
      (alias) => stageNorm === alias || stageNorm.includes(alias),
    );
    if (!aliasMatch) return false;

    // Check exclusions
    if (filter.excludeKeywords) {
      for (const exclude of filter.excludeKeywords) {
        if (new RegExp(exclude, "i").test(stageNorm)) {
          return false; // Excluded
        }
      }
    }

    return true;
  });
}
```

---

### **Sector Matching Fix**:

**Current Problem** (Lines 73-77):

```typescript
if (sector) {
  rows = rows.filter(
    (r) => r.focus_areas.some((f) => f.sector.toLowerCase().includes(sector)),
    // ❌ "ai" won't match "artificial intelligence" or "machine learning"
  );
}
```

**Fix Required**:

```typescript
// NEW FILE: src/lib/investors/sector-matcher.ts

const SECTOR_SYNONYMS = {
  ai: ["ai", "artificial intelligence", "machine learning", "ml", "deep learning", "llm", "nlp"],
  "b2b saas": ["b2b", "saas", "enterprise software", "cloud", "software as a service"],
  fintech: ["fintech", "financial technology", "payments", "banking", "finance"],
  health: ["health", "healthcare", "medical", "biotech", "pharma"],
  // ... more sectors
};

function matchSector(query: string, investorFocusAreas: FocusArea[]): boolean {
  const queryLower = query.toLowerCase().trim();
  const synonyms = SECTOR_SYNONYMS[queryLower] || [queryLower];

  return investorFocusAreas.some((focus) => {
    const sectorLower = focus.sector.toLowerCase();
    return synonyms.some((syn) => sectorLower.includes(syn) || syn.includes(sectorLower));
  });
}
```

---

## 2️⃣ DISCOVER MODULE

### **Main Orchestrator**:

**File**: `src/lib/search/sources.server.ts` (281 KB, 4084 lines)

**Key Function** (Lines 3200-3500):

```typescript
export async function searchAll(
  classified: ClassifiedQuery,
  qx: ExpandedQueries,
  prefs: SearchParams["prefs"],
): Promise<{ leads: Lead[]; debug: SearchDebug }> {
  const all: SourceLead[] = [];
  const promises: Array<{ name: string; p: Promise<SourceLead[]> }> = [];

  function add(name: string, p: Promise<SourceLead[]>, budget = SOURCE_BUDGET_MS) {
    promises.push({ name, p: withBudget(p, [], budget) });
  }

  // Fan-out to all sources
  add("reddit", searchReddit(qx));
  add("hn", searchHackerNews(qx));
  add("upwork", searchUpwork(qx));
  // ... 50+ more sources

  // Wait for all
  const settled = await Promise.allSettled(promises.map(({ p }) => p));
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === "fulfilled") {
      all.push(...settled[i].value);
    }
  }

  // Current filtering (too simple)
  return filterAndScore(all);
}
```

**Problem**: No LLM validation, simple keyword filtering

---

### **Proposed Enhancement**:

```typescript
// NEW FILE: src/lib/search/llm-relevance-filter.ts

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function validateLeadRelevance(
  leads: Lead[],
  query: string,
  skill: string,
  role: string,
): Promise<Lead[]> {
  if (leads.length === 0) return [];

  // Batch into chunks of 20
  const chunks = chunkArray(leads, 20);
  const validated: Lead[] = [];

  for (const chunk of chunks) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a lead quality validator. Filter out irrelevant leads.
            
Rules:
1. Remove leads where the poster is OFFERING services (not seeking)
2. Remove leads where skill/role doesn't match
3. Remove generic/spam/irrelevant content
4. Keep only leads with clear buyer intent

Return: { "relevant_indices": [0, 2, 5, ...] }`,
          },
          {
            role: "user",
            content: JSON.stringify({
              query,
              skill,
              role,
              leads: chunk.map((l, i) => ({
                index: i,
                title: l.title,
                snippet: l.snippet.slice(0, 200),
                platform: l.platform,
              })),
            }),
          },
        ],
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      const relevantIndices = result.relevant_indices || [];

      for (const idx of relevantIndices) {
        if (chunk[idx]) {
          validated.push(chunk[idx]);
        }
      }
    } catch (error) {
      console.error("[LLM Filter Error]", error);
      // Fallback: include all on error
      validated.push(...chunk);
    }
  }

  return validated;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

**Integration** (in sources.server.ts):

```typescript
// After collecting all leads, before returning:
const filtered = await validateLeadRelevance(all, classified.raw, qx.skill, qx.role);
return filterAndScore(filtered);
```

---

## 3️⃣ QUERY EXPANSION

**File**: `src/lib/search/query-expander.ts`

**Key Function** (Lines 150-300):

```typescript
export function expandQuery(input: string): ExpandedQueries {
  const core = extractCoreSkill(input);
  const role = ROLE_MAP[core] || core;
  const skill = core;

  // Buyer intent phrases
  const buyerPhrases = [
    `looking for a ${role}`,
    `need a ${role}`,
    `hiring ${role}`,
    `seeking ${role}`,
    // ...
  ];

  // Job board queries
  const jobBoardQueries = [`${skill} developer`, `${skill} freelancer`, `${skill} consultant`];

  // Social queries (for SearXNG dorks)
  const socialQueries = [`"looking for a ${role}"`, `"need a ${role}"`, `"hire ${role}"`];

  return {
    raw: input,
    skill,
    role,
    queryType: classifyQuery(input).type,
    relatedSkills: getRelatedSkills(skill),
    buyerIntentQueries: buyerPhrases,
    jobBoardQueries,
    socialQueries,
    redditBuyerQueries: buildRedditQueries(skill),
    booleanWebQueries: buildBooleanQueries(role),
    subreddits: getSubredditBoosts(skill),
    negativePhrases: getNegativePhrases(),
    negativeSignals: [],
  };
}
```

**This is GOOD** - No changes needed, just add LLM filter downstream

---

## 4️⃣ BUYER INTENT DETECTION

**File**: `src/lib/search/query-expander.ts` (Lines 450-550)

**Current Function**:

```typescript
export function isBuyerContent(text: string, negativePhrases: string[]): boolean {
  const lower = text.toLowerCase();

  // Positive signals (buyer)
  const buyerSignals = [
    /\b(looking for|need|seeking|hiring|want to hire)\b/i,
    /\b(freelancer|consultant|contractor|agency)\b/i,
    /\b(project|gig|work|opportunity)\b/i,
  ];

  // Negative signals (seller)
  const sellerSignals = [
    /\b(hire me|my portfolio|i am|i'm|available for|open to work)\b/i,
    /\b(my services|my work|my experience|resume|cv)\b/i,
    /\b(starting at \$|per hour|contact me)\b/i,
  ];

  const hasBuyerSignal = buyerSignals.some((re) => re.test(lower));
  const hasSellerSignal = sellerSignals.some((re) => re.test(lower));

  if (hasSellerSignal) return false;
  if (hasBuyerSignal) return true;

  // Check negative phrases
  for (const phrase of negativePhrases) {
    if (lower.includes(phrase)) return false;
  }

  return true;
}
```

**This is OK** - But too conservative. Relaxed version needed:

```typescript
// NEW VERSION: isPotentialBuyerContent (relaxed)
export function isPotentialBuyerContent(text: string): boolean {
  const lower = text.toLowerCase();

  // Hard exclude sellers
  const hardSellerSignals = [
    /\bhire me\b/i,
    /\bmy portfolio\b/i,
    /\bavailable for hire\b/i,
    /\bopen to work\b/i,
  ];

  if (hardSellerSignals.some((re) => re.test(lower))) {
    return false;
  }

  // Everything else passes (let LLM decide)
  return true;
}
```

---

## 5️⃣ SCORING SYSTEM

**File**: `src/lib/scoring.ts`

**Current Scoring** (Lines 100-200):

```typescript
export function scoreLead(lead: Lead): number {
  let score = 0;

  // Recency bonus
  if (lead.posted_at && isRecent(lead.posted_at, 1)) {
    score += 20;
  }

  // Engagement bonus
  score += Math.log(1 + (lead.engagement || 0)) * 5;

  // Decision maker bonus
  if (lead.is_decision_maker) {
    score += 15;
  }

  // Intent boost (from source)
  score += lead.intentBoost || 0;

  // Platform preference
  if (JOB_BOARD_SOURCES.includes(lead.source)) {
    score += 10;
  }

  return score;
}
```

**This is GOOD** - Keep as-is, just ensure LLM-filtered leads get scored

---

## 6️⃣ WEB CRAWLING (Inspired by ai-outreach-engine)

**Reference File**: From ai-outreach-engine

```typescript
// ai-outreach-engine/server/src/providers/crawler.ts

export async function crawlSite(
  domain: string,
  opts: { maxPages?: number } = {},
): Promise<{ pages: CrawledPage[]; provider: string }> {
  const maxPages = opts.maxPages ?? 10;

  // Rank pages by value
  const HIGH_VALUE_PATHS = [
    "",
    "pricing",
    "plans",
    "features",
    "product",
    "about",
    "use-cases",
    "solutions",
    "customers",
  ];

  function pathScore(url: string): number {
    const path = new URL(url).pathname.toLowerCase();
    const segment = path.split("/")[1] || "";

    // Exclude low-value paths
    if (/^(blog|news|changelog|docs|help|legal)$/.test(segment)) {
      return -1;
    }

    const index = HIGH_VALUE_PATHS.indexOf(segment);
    return index >= 0 ? 90 - index * 3 : 30;
  }

  // Map domain to get all links
  const links = await firecrawlMap(domain);

  // Rank and select top N
  const ranked = links
    .map((url) => ({ url, score: pathScore(url) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages);

  // Scrape selected pages
  const pages = await Promise.all(ranked.map(({ url }) => firecrawlScrape(url)));

  return { pages: pages.filter(Boolean), provider: "firecrawl" };
}
```

**Adaptation for Scrapivo**:

```typescript
// NEW FILE: src/lib/investors/crawler.ts

export async function crawlInvestorProfile(firmName: string): Promise<InvestorData> {
  // Find firm website
  const website = await searchFirmWebsite(firmName);
  if (!website) return null;

  // Crawl high-value pages
  const pages = await crawlSite(website, { maxPages: 5 });

  // Parse investment thesis
  const thesis = extractInvestmentThesis(pages);

  // Parse recent investments
  const recentInvestments = extractRecentInvestments(pages);

  return { firmName, website, thesis, recentInvestments };
}
```

---

## 🎯 Implementation Priority

### **Phase 1** (Week 1):

1. Fix `src/lib/investors/search.ts` stage matching
2. Add `src/lib/investors/sector-matcher.ts`
3. Add `src/lib/search/llm-relevance-filter.ts`
4. Integrate LLM filter into `sources.server.ts`

### **Phase 2** (Week 2):

1. Relax `isBuyerContent` → `isPotentialBuyerContent`
2. Add new sources (AngelList, Twitter Lists)
3. Add `src/lib/investors/crawler.ts`
4. Add `src/lib/investors/linkedin-scraper.ts`

### **Phase 3** (Week 3):

1. Build Jobs module (`src/lib/jobs/`)
2. Add Jobs UI (`src/routes/_authenticated/jobs.tsx`)
3. Test end-to-end

### **Phase 4** (Week 4):

1. Performance optimization (caching)
2. Anti-hallucination tuning
3. Production testing

---

**Status**: Ready for approval  
**Next**: Get approval → Start coding  
**Files**: 15 new, 5 modified  
**Timeline**: 3-4 weeks
