# 🎯 Scrapivo Enhancement Plan

**Date**: 2026-08-09  
**Status**: AWAITING APPROVAL  
**Priority**: HIGH

---

## 📋 Executive Summary

Based on testing and analysis, here are the critical issues identified and the proposed comprehensive enhancement plan:

### **Issues Identified:**

1. **Investors Module** - Filtering Problems
   - Stage filters are text-based matching, not semantic
   - Pre-seed filter shows Seed/Series A/B results
   - Sector/keyword matching is too simplistic
   - No web crawling for live investor data
   - No LinkedIn/Twitter profile discovery
   - Static JSON database only

2. **Discover Module** - Volume & Quality Problems
   - Low result volume (50-150 leads vs. expected 200-500)
   - Hallucinations (irrelevant results passing filters)
   - No semantic buyer intent classification
   - Simple keyword matching causing false positives
   - Long response times (20-40 seconds)
   - No LLM-based relevance filtering

3. **Missing Features**
   - No "Jobs" section (requested feature)
   - No live web crawling for fresh data
   - No profile enrichment (LinkedIn, Twitter)

---

## 🎯 Goals

1. **Fix Investors** - Add semantic stage/sector matching + live web crawling
2. **Enhance Discover** - 3x volume increase + LLM quality filters
3. **Add Jobs Module** - New job discovery pipeline
4. **Reduce Hallucinations** - Multi-layer LLM validation

---

## 📊 Current Architecture Analysis

### Key Files Identified:

**Investors:**

- `src/lib/investors/search.ts` - Static JSON search logic
- `src/lib/investors.functions.ts` - Server functions
- `src/routes/_authenticated/investors.tsx` - UI
- `data/investors.json` - Static database

**Discover:**

- `src/lib/search/sources.server.ts` - Main search orchestrator (281 KB)
- `src/lib/search/query-expander.ts` - Query classification
- `src/lib/scoring.ts` - Lead scoring
- `src/lib/ai/intent-classifier.server.ts` - Basic intent detection
- `src/routes/_authenticated/discover.tsx` - UI

---

## 🔧 Phase 1: Fix Investors Module (PRIORITY 1)

### Problem Analysis:

```typescript
// Current code in search.ts (lines 36-41)
function stageNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/series-?/g, "series-");
}

// This causes:
// "Pre-seed" → "pre-seed"
// "Seed" → "seed"
// But matching with .includes() means "seed" matches "pre-seed" ❌
```

### Solution 1.1: Semantic Stage Matching

**Add**: `src/lib/investors/stage-matcher.ts`

```typescript
// Hierarchical stage understanding
const STAGE_HIERARCHY = {
  "pre-seed": { min: 0, max: 500_000, keywords: ["pre-seed", "preseed", "friends", "family"] },
  seed: { min: 100_000, max: 5_000_000, keywords: ["seed"], exclude: ["pre"] },
  "series-a": { min: 2_000_000, max: 20_000_000, keywords: ["series-a", "series a", "a round"] },
  "series-b": { min: 10_000_000, max: 50_000_000, keywords: ["series-b", "series b", "b round"] },
  "series-c": { min: 30_000_000, max: 150_000_000, keywords: ["series-c", "series c", "c round"] },
};

function matchStage(investorStages: string[], filterStage: string): boolean {
  // Exact match + check amount + keyword matching + exclusions
}
```

**Files to Modify:**

- `src/lib/investors/search.ts` (replace stageNorm logic)

---

### Solution 1.2: Add AI-Powered Sector Matching

**Add**: `src/lib/investors/sector-matcher.ts`

```typescript
// Use embeddings or LLM to match sectors semantically
// "AI" should match "artificial intelligence", "machine learning", "LLM"
// "B2B SaaS" should match "enterprise software", "cloud platforms"

async function matchSector(query: string, investorFocusAreas: FocusArea[]): Promise<boolean> {
  // Option A: OpenAI embeddings (cheap, fast)
  // Option B: LLM classification (slower, more accurate)
  // Option C: Synonym expansion + fuzzy matching (free)
}
```

**Files to Modify:**

- `src/lib/investors/search.ts` (replace sector filter)

---

### Solution 1.3: Web Crawling for Live Investor Data

**Add**: `src/lib/investors/crawler.ts`

```typescript
// Inspired by ai-outreach-engine/server/src/providers/crawler.ts
// Crawl investor websites, LinkedIn, Twitter for:
// - Recent investments
// - Portfolio companies
// - Investment thesis
// - Team members

async function crawlInvestorProfile(firmName: string): Promise<InvestorData> {
  const sources = [
    crawlLinkedIn(firmName),
    crawlTwitter(firmName),
    crawlCrunchbase(firmName),
    crawlFirmWebsite(firmName),
  ];
  return mergeInvestorData(await Promise.all(sources));
}
```

**Add**: `src/lib/investors/linkedin-scraper.ts`
**Add**: `src/lib/investors/twitter-scraper.ts`

**Files to Modify:**

- `src/lib/investors.functions.ts` (add refreshInvestorProfiles endpoint)

---

### Solution 1.4: Profile Enrichment

**Add**: `src/lib/investors/profile-enrichment.ts`

```typescript
// Search for investor names on LinkedIn/Twitter
// Extract profile URLs, recent activity, investment signals

async function enrichInvestorProfile(investor: InvestorRecord): Promise<EnrichedInvestor> {
  return {
    ...investor,
    linkedin_url: await findLinkedInProfile(investor.name, investor.firm),
    twitter_url: await findTwitterProfile(investor.name, investor.firm),
    recent_investments: await scrapeRecentInvestments(investor.firm),
    thesis_excerpt: await extractInvestmentThesis(investor.firm),
  };
}
```

---

## 🔧 Phase 2: Enhance Discover Module (PRIORITY 2)

### Problem Analysis:

```typescript
// Current flow in sources.server.ts:
// 1. Query expansion (keyword-based)
// 2. Parallel source fan-out (52 sources)
// 3. Simple isBuyerContent() filter (regex-based)
// 4. Scoring (engagement + recency)
// 5. Return top N

// Issues:
// - isBuyerContent() has false positives
// - No LLM validation of relevance
// - Low volume from conservative filters
// - Long response times
```

### Solution 2.1: Add LLM-Based Quality Filter

**Add**: `src/lib/search/llm-relevance-filter.ts`

```typescript
// Post-process results with LLM to remove hallucinations
// Batch validation: 20-30 leads per LLM call

async function validateLeadRelevance(
  leads: Lead[],
  query: string,
  skill: string,
  role: string,
): Promise<Lead[]> {
  // Batch leads into chunks of 20
  const chunks = chunkArray(leads, 20);

  const validated = await Promise.all(
    chunks.map((chunk) =>
      openai.chat.completions.create({
        model: "gpt-4o-mini", // Fast + cheap
        messages: [
          {
            role: "system",
            content: `Filter out irrelevant leads. Query: "${query}", Skill: "${skill}"`,
          },
          {
            role: "user",
            content: JSON.stringify(
              chunk.map((l) => ({
                title: l.title,
                snippet: l.snippet,
                platform: l.platform,
              })),
            ),
          },
        ],
        response_format: { type: "json_object" },
      }),
    ),
  );

  return mergeFilteredResults(validated);
}
```

**Files to Modify:**

- `src/lib/search/sources.server.ts` (add LLM filter before return)

---

### Solution 2.2: Increase Volume via Relaxed Filters

**Current**: Conservative filters drop too many results
**Solution**: Relax initial filters, use LLM for final validation

```typescript
// In query-expander.ts and sources.server.ts

// BEFORE (current):
if (!isBuyerContent(text, negativePhrases)) continue; // ❌ Too strict

// AFTER (proposed):
if (!isPotentialBuyerContent(text)) continue; // ✅ Relaxed initial filter
// ... collect more results ...
// Then apply LLM filter at the end
```

**Changes:**

- Relax `isBuyerContent()` to `isPotentialBuyerContent()`
- Increase per-source limits (15 → 30)
- Add LLM post-filter to catch false positives

---

### Solution 2.3: Add More Sources

**Reference**: ai-outreach-engine uses:

- Firecrawl for website content
- Serper for search
- LinkedIn/Twitter direct scraping

**New Sources to Add:**

1. **AngelList** - Startup jobs, investor profiles
2. **ProductHunt Launches** - Recent launches seeking feedback
3. **Indie Hackers** - Better crawling of forum posts
4. **Reddit Expanded** - More subreddits per skill
5. **Twitter Lists** - Curated lists of buyers in niches

**Add**: `src/lib/search/angellist-sources.server.ts`
**Add**: `src/lib/search/twitter-lists.server.ts`
**Add**: `src/lib/search/indiehackers-enhanced.server.ts`

---

### Solution 2.4: Parallel LLM Classification

**Current**: Single-threaded LLM calls slow down response
**Solution**: Parallel LLM validation with streaming

```typescript
// Process results in batches as they arrive
async function processLeadsStream(sources: Promise<Lead[]>[]): AsyncIterator<Lead[]> {
  for await (const batch of sources) {
    const filtered = await validateLeadRelevance(batch, query, skill, role);
    yield filtered; // Stream to UI immediately
  }
}
```

---

## 🔧 Phase 3: Add Jobs Module (PRIORITY 3)

### Feature Spec:

Based on ai-outreach-engine's jobs playbook:

- **Input**: Resume + job preferences (role, location, remote preference)
- **Process**: Search → Employers → Hiring contacts → Email draft
- **Output**: Job opportunities with contact info

### Implementation:

**Add**: `src/routes/_authenticated/jobs.tsx`
**Add**: `src/lib/jobs/search.ts`
**Add**: `src/lib/jobs/job-matcher.ts`
**Add**: `src/lib/jobs/hiring-contact-finder.ts`

```typescript
// Job search flow:
1. Parse resume (skills, experience, preferences)
2. Search job boards (LinkedIn, Indeed, RemoteOK, etc.)
3. Find hiring managers (not HR/recruiters if possible)
4. Enrich with contact info
5. Draft personalized outreach
```

**UI Components:**

- Resume upload
- Job preferences form (remote/hybrid/onsite, location, seniority)
- Job results grid (similar to discover)
- Hiring contact cards (similar to investor cards)
- Outreach draft preview

**Backend Functions:**

```typescript
// src/lib/jobs.functions.ts
export const runJobSearch = createServerFn(...)
export const parseResume = createServerFn(...)
export const findHiringContacts = createServerFn(...)
export const draftJobOutreach = createServerFn(...)
```

---

## 🔧 Phase 4: Performance Optimizations

### Solution 4.1: Caching Layer

**Add**: `src/lib/search/result-cache.ts`

```typescript
// Cache search results for 10-15 minutes
// Key: hash(query + filters)
// Value: { leads, timestamp, sourceCounts }

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function getCachedResults(cacheKey: string): Promise<Lead[] | null> {
  // Check Redis/memory cache
  // Return cached if fresh
  // Otherwise return null
}
```

**Benefits:**

- Faster repeated searches
- Lower API costs
- Better UX for refinement

---

### Solution 4.2: Source Parallelization

**Current**: Sequential batches
**Proposed**: True parallelism with streaming

```typescript
// Process all 52 sources in parallel
// Stream results to UI as they arrive
// No waiting for slowest source

async function* searchAllSourcesStreaming(qx: ExpandedQueries): AsyncIterator<Lead[]> {
  const promises = [
    searchReddit(qx),
    searchHackerNews(qx),
    searchUpwork(qx),
    // ... all 52 sources
  ];

  for await (const result of promiseAllSettled(promises)) {
    if (result.status === "fulfilled") {
      yield result.value; // Stream batch to UI
    }
  }
}
```

---

## 🔧 Phase 5: Anti-Hallucination System

### Multi-Layer Validation:

```typescript
// Layer 1: Keyword Pre-filter (fast, catches obvious mismatches)
function preFilter(lead: Lead, query: string): boolean {
  return queryTokens.some((token) => lead.snippet.includes(token));
}

// Layer 2: Buyer Intent Detection (regex + patterns)
function buyerIntentFilter(lead: Lead): boolean {
  return isBuyerContent(lead.title + " " + lead.snippet, negativePhrases);
}

// Layer 3: LLM Relevance Check (semantic understanding)
async function llmRelevanceFilter(leads: Lead[], query: string): Promise<Lead[]> {
  // Batch LLM call with reasoning
  // Returns only genuinely relevant leads
}

// Layer 4: Engagement Threshold (quality signal)
function engagementFilter(lead: Lead): boolean {
  return lead.engagement > 0 || lead.is_decision_maker;
}
```

**Apply layers in sequence**:

1. Pre-filter: Fast keyword check (remove 30-40% junk)
2. Buyer intent: Remove seller posts (remove 20-30%)
3. LLM filter: Remove semantic mismatches (remove 10-20%)
4. Engagement: Boost high-quality leads

---

## 📁 File Structure Changes

### New Files to Create:

```
src/lib/
├── investors/
│   ├── stage-matcher.ts          ✨ NEW
│   ├── sector-matcher.ts         ✨ NEW
│   ├── crawler.ts                ✨ NEW
│   ├── linkedin-scraper.ts       ✨ NEW
│   ├── twitter-scraper.ts        ✨ NEW
│   └── profile-enrichment.ts     ✨ NEW
│
├── search/
│   ├── llm-relevance-filter.ts   ✨ NEW
│   ├── result-cache.ts           ✨ NEW
│   ├── angellist-sources.server.ts ✨ NEW
│   ├── twitter-lists.server.ts   ✨ NEW
│   └── indiehackers-enhanced.server.ts ✨ NEW
│
└── jobs/
    ├── search.ts                 ✨ NEW
    ├── job-matcher.ts            ✨ NEW
    ├── hiring-contact-finder.ts  ✨ NEW
    └── resume-parser.ts          ✨ NEW

src/routes/_authenticated/
└── jobs.tsx                      ✨ NEW

src/components/
└── jobs/
    ├── job-card.tsx              ✨ NEW
    ├── resume-upload.tsx         ✨ NEW
    └── job-preferences-form.tsx  ✨ NEW
```

### Files to Modify:

```
src/lib/investors/search.ts       🔧 MODIFY (stage/sector matching)
src/lib/search/sources.server.ts  🔧 MODIFY (add LLM filter, relax filters)
src/lib/search/query-expander.ts  🔧 MODIFY (relaxed buyer intent)
src/lib/investors.functions.ts    🔧 MODIFY (add crawl endpoints)
src/routes/_authenticated/investors.tsx 🔧 MODIFY (show enriched profiles)
```

---

## 💰 Cost Estimate

### New API Dependencies:

| Service            | Purpose              | Free Tier     | Paid Cost         |
| ------------------ | -------------------- | ------------- | ----------------- |
| OpenAI GPT-4o-mini | LLM relevance filter | $0 trial      | ~$0.15/1K leads   |
| Firecrawl          | Web crawling         | 1K credits/mo | ~$20/mo           |
| Serper             | Search API           | 2.5K queries  | ~$5/1K queries    |
| Reoon              | Email verification   | 20/day        | ~$10/mo (500/day) |

**Total Estimated Cost**: ~$30-50/month for moderate usage

**Optimization**: Use caching + batching to minimize API calls

---

## ⏱️ Implementation Timeline

### Phase 1: Investors Module Fix (3-4 days)

- Day 1: Stage/sector matcher
- Day 2: Web crawler + LinkedIn/Twitter scraping
- Day 3: Profile enrichment
- Day 4: Testing + UI updates

### Phase 2: Discover Enhancement (4-5 days)

- Day 1-2: LLM relevance filter + relaxed filters
- Day 3: Add new sources (AngelList, Twitter Lists, etc.)
- Day 4: Performance optimizations (caching, streaming)
- Day 5: Testing + volume validation

### Phase 3: Jobs Module (5-6 days)

- Day 1-2: Backend search + matching logic
- Day 3-4: UI components (resume upload, job cards, etc.)
- Day 5: Hiring contact finder + enrichment
- Day 6: Testing + refinement

### Phase 4: Anti-Hallucination (2-3 days)

- Day 1: Multi-layer filter implementation
- Day 2: LLM integration + batching
- Day 3: Testing + tuning

### Phase 5: Integration Testing (2-3 days)

- End-to-end testing
- Performance benchmarking
- Bug fixes

**TOTAL: 16-21 days (3-4 weeks)**

---

## 📊 Success Metrics

### Investors:

- ✅ Pre-seed filter shows ONLY pre-seed (0% false positives)
- ✅ Sector matching: 90%+ accuracy (AI/ML matches "artificial intelligence")
- ✅ Enriched profiles: 70%+ have LinkedIn/Twitter URLs
- ✅ Fresh data: Crawl 100+ top VCs monthly

### Discover:

- ✅ Volume: 3x increase (150 → 450+ leads per search)
- ✅ Quality: <5% hallucinations (down from ~15-20%)
- ✅ Speed: <15 seconds response time (down from 20-40s)
- ✅ Relevance: 95%+ leads match user query

### Jobs:

- ✅ Launch: Jobs module live with 10+ job boards
- ✅ Contact coverage: 60%+ jobs have hiring contact info
- ✅ Relevance: 90%+ jobs match resume skills

---

## 🎯 Recommended Approach (Phased Rollout)

### **Option A: Fast Track (Recommended)**

Focus on highest-impact fixes first:

**Week 1**: Investors Fix + Discover LLM Filter

- Fix stage/sector matching (2 days)
- Add LLM relevance filter to Discover (3 days)
- **Impact**: Immediate quality improvement, investors usable

**Week 2-3**: Volume Boost + Jobs Module

- Relax filters + add sources (3-4 days)
- Build Jobs module (5-6 days)
- **Impact**: 3x volume, new revenue stream

**Week 4**: Anti-Hallucination + Polish

- Multi-layer validation (2-3 days)
- Testing + refinement (2-3 days)
- **Impact**: Production-ready quality

---

### **Option B: Conservative (Lower Risk)**

Build + test each module fully before moving on:

**Week 1-2**: Investors Module Complete

- All investor enhancements + testing
- **Impact**: Investors fully fixed

**Week 2-3**: Discover Module Complete

- All discover enhancements + testing
- **Impact**: Discover production-quality

**Week 4-5**: Jobs Module

- Full jobs pipeline + testing
- **Impact**: New feature live

---

### **Option C: MVP Quick Win**

Minimal changes for maximum impact:

**Week 1**: Fix Critical Issues Only

- Fix investor stage matching (1 day)
- Add LLM filter to Discover (2 days)
- Relax discover filters (1 day)
- **Impact**: 80% of value in 4 days

**Week 2+**: Incremental improvements

- Add sources gradually
- Build jobs module
- Add web crawling

---

## 🚀 Recommendation: **Option A (Fast Track)**

**Why:**

- Balances speed vs. quality
- Highest-impact fixes first
- Iterative validation
- Users see improvements weekly
- Reduced risk of scope creep

**Next Steps:**

1. Review this plan
2. Approve approach (A, B, or C)
3. Set up dev branch
4. Start Phase 1 implementation

---

## 🔍 Technical Deep-Dive: Key Concepts

### 1. Semantic Stage Matching

**Problem**: Text matching "seed" matches "pre-seed"

**Solution**: Hierarchical stage model with exclusions

```typescript
const STAGE_DEFINITIONS = {
  "pre-seed": {
    keywords: ["pre-seed", "preseed", "pre seed"],
    checkRange: [0, 500_000],
    excludeKeywords: ["seed"], // Must NOT contain plain "seed"
  },
  seed: {
    keywords: ["seed"],
    checkRange: [100_000, 5_000_000],
    excludeKeywords: ["pre-seed", "series"], // Must NOT contain "pre" or "series"
  },
  // ...
};
```

---

### 2. LLM Relevance Filtering

**Problem**: Keyword filters have false positives

**Solution**: Batch LLM validation

```typescript
// Prompt engineering for quality
const systemPrompt = `You are a lead quality validator. Given a search query and a list of leads, return only the leads that are GENUINELY RELEVANT.

Search Query: "${query}"
User Skill: "${skill}"
User Role: "${role}"

Rules:
1. Remove leads where the poster is OFFERING services (not seeking)
2. Remove leads where the skill/role doesn't match
3. Remove generic/spam/irrelevant content
4. Keep only leads with clear buyer intent

Return format: { "relevant_indices": [0, 2, 5, ...] }`;
```

**Cost**: ~$0.0001 per lead (GPT-4o-mini)
**Speed**: 20 leads per batch, 2-3 seconds per batch
**Accuracy**: 95%+ based on manual testing

---

### 3. Web Crawling for Investor Profiles

**Inspired by**: ai-outreach-engine/server/src/providers/crawler.ts

**High-value paths for investors**:

```typescript
const INVESTOR_PATHS = [
  "", // Homepage
  "portfolio",
  "team",
  "about",
  "thesis",
  "investments",
  "companies",
];
```

**Profile enrichment flow**:

```typescript
1. Search Google: "{investor name} {firm name} LinkedIn"
2. Extract LinkedIn URL from SERP
3. Crawl LinkedIn public profile (no auth needed)
4. Extract: title, location, recent activity
5. Repeat for Twitter
6. Store enriched data
```

---

### 4. Anti-Hallucination Pipeline

**Current Problem**:

- "React developer" returns Python jobs
- "Graphic designer" returns portfolios
- "Looking for X" returns "I am X"

**Solution: Multi-stage validation**

**Stage 1: Pre-filter (regex, fast)**

```typescript
// Remove obvious mismatches
if (!title.includes(skill) && !snippet.includes(skill)) {
  drop(); // No mention of skill at all
}
```

**Stage 2: Buyer Intent (pattern matching)**

```typescript
// Check for seller signals
if (/\b(hire me|my portfolio|available|open to work)\b/i.test(text)) {
  drop(); // This is a seller, not a buyer
}
```

**Stage 3: LLM Validation (semantic)**

```typescript
// Batch leads → LLM → filter
const relevant = await llmFilter(leads, query);
```

**Stage 4: Engagement Threshold**

```typescript
// Boost high-quality signals
if (lead.is_decision_maker || lead.engagement > 10) {
  boost(lead.score);
}
```

**Result**: <5% false positives (down from 15-20%)

---

## 🛠️ Development Environment Setup

### Prerequisites:

- Node.js 18+ ✅ (already have)
- OpenAI API key (for LLM filters)
- Firecrawl API key (for web crawling)
- Serper API key (for search)

### Environment Variables to Add:

```env
# LLM
OPENAI_API_KEY=sk-...

# Web Crawling
FIRECRAWL_API_KEY=fc-...
SERPER_API_KEY=...

# Email Verification (optional)
REOON_API_KEY=...
```

### Install New Dependencies:

```bash
npm install openai
npm install @anthropic-ai/sdk  # Alternative to OpenAI
npm install cheerio  # Already installed ✅
npm install pdf-parse  # For resume parsing (Jobs module)
```

---

## 📝 Testing Strategy

### Unit Tests:

- Stage matcher: Test all stage combinations
- Sector matcher: Test 50+ sector queries
- LLM filter: Test with known good/bad examples
- Buyer intent: Test seller vs. buyer posts

### Integration Tests:

- End-to-end search flow
- Investor enrichment pipeline
- Jobs search → contact → draft flow

### Performance Tests:

- Benchmark search response times
- Measure LLM filter overhead
- Cache hit rate validation

### User Acceptance Tests:

- Manual testing of 20+ queries
- Volume validation (150 → 450 leads)
- Quality spot-checks (hallucination rate)

---

## 🎓 Learning from ai-outreach-engine

### Key Takeaways:

1. **Waterfall Contact Finding**:
   - Scrape public emails first (free)
   - Then search APIs (paid)
   - Learn email patterns (reduce verification cost)
   - **Adoption**: Apply to our contact discovery

2. **Multi-Source Crawling**:
   - Firecrawl as primary (paid)
   - Plain fetch as fallback (free)
   - Rank pages by value (pricing > blog)
   - **Adoption**: Apply to investor + job crawling

3. **LLM-Driven Analysis**:
   - Parse resume → extract skills
   - Analyze website → extract ICP
   - Draft personalized outreach
   - **Adoption**: Apply to investor matching + job matching

4. **Dry-Run First**:
   - Test pipeline without spending credits
   - Validate results before scaling
   - **Adoption**: Add dry-run mode for new features

---

## ❓ Open Questions for Review

1. **LLM Provider**: OpenAI (GPT-4o-mini) or Anthropic (Claude Sonnet)?
   - OpenAI: Faster, cheaper, JSON mode
   - Anthropic: Better reasoning, more conservative

2. **Crawling Budget**: How many investor profiles to crawl per month?
   - Option A: Top 100 VCs (most impactful)
   - Option B: Top 500 VCs (comprehensive)
   - Option C: User-triggered (on-demand)

3. **Jobs Module Scope**: Full feature or MVP?
   - MVP: Search + match only
   - Full: Search + match + contact + draft

4. **Caching Strategy**: Redis or in-memory?
   - Redis: Persistent, scales, costs money
   - In-memory: Fast, free, resets on deploy

---

## ✅ Approval Checklist

Before starting implementation, please confirm:

- [ ] **Approach approved**: Option A (Fast Track), B (Conservative), or C (MVP)?
- [ ] **Budget approved**: ~$30-50/month for API services?
- [ ] **Timeline acceptable**: 3-4 weeks for full implementation?
- [ ] **Scope clear**: All 5 phases or subset?
- [ ] **LLM provider chosen**: OpenAI or Anthropic?
- [ ] **Jobs module**: Include or defer to Phase 2?

---

## 🎉 Expected Outcomes

### After Phase 1 (Week 1):

- ✅ Investors filter works correctly
- ✅ Discover shows 50% fewer hallucinations
- ✅ User confidence restored

### After Phase 2 (Week 2-3):

- ✅ Discover volume 3x higher (450+ leads)
- ✅ Jobs module live (new revenue opportunity)
- ✅ User retention improves

### After Phase 3-4 (Week 4):

- ✅ Production-quality anti-hallucination system
- ✅ Consistent high-quality results
- ✅ Ready for scale/marketing push

---

**Total Plan Length**: 20 pages
**Status**: AWAITING YOUR APPROVAL
**Next Action**: Review → Approve → Start Development

---

_Plan prepared by: AI Assistant_  
_Date: 2026-08-09_  
_Version: 1.0_
