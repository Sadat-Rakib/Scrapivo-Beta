# 🏗️ Scrapivo Architecture Changes

## Current vs. Proposed Architecture

---

## 📊 INVESTORS MODULE

### **BEFORE** (Current - Broken):

```
User Query: "Pre-seed AI"
    ↓
┌─────────────────────────────────────┐
│ Simple String Matching              │
│ - stageNorm("Pre-seed") → "pre-seed"│
│ - stageNorm("Seed") → "seed"       │
│ - "seed".includes("pre-seed") ❌    │
│ - "ai".includes("artificial") ❌    │
└─────────────────────────────────────┘
    ↓
❌ Returns Seed/Series A/B
❌ Returns no "AI" matches
```

### **AFTER** (Proposed - Fixed):

```
User Query: "Pre-seed AI"
    ↓
┌─────────────────────────────────────┐
│ Semantic Stage Matching             │
│ - Parse: "pre-seed" (with exclusions)
│ - Exclude: stages containing "seed" │
│   without "pre"                     │
│ - Check amount range: 0-500K        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ AI Sector Matching                  │
│ - Expand: "AI" → ["artificial       │
│   intelligence", "machine learning",│
│   "LLM", "ML", "deep learning"]     │
│ - Fuzzy match investor focus areas  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Web Crawling (Optional)             │
│ - Crawl LinkedIn profiles           │
│ - Scrape Twitter for recent invests │
│ - Parse firm website for thesis     │
│ - Enrich with live data             │
└─────────────────────────────────────┘
    ↓
✅ Returns ONLY pre-seed AI investors
✅ 90%+ accuracy
✅ Enriched with LinkedIn/Twitter
```

---

## 🔍 DISCOVER MODULE

### **BEFORE** (Current - Low Volume + Hallucinations):

```
User Query: "React developer"
    ↓
┌─────────────────────────────────────┐
│ Keyword Expansion                   │
│ - Extract: "react", "developer"     │
│ - Add related: "reactjs", "frontend"│
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Parallel Source Fan-out (52)        │
│ - Reddit, HN, Upwork, GitHub...     │
│ - Per-source timeout: 16-28s        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Simple Regex Filter                 │
│ - isBuyerContent() checks keywords  │
│ - Drops ~30-40% results             │
│ - FALSE POSITIVES: 15-20%           │
└─────────────────────────────────────┘
    ↓
❌ Volume: 50-150 leads (too low)
❌ Quality: 15-20% irrelevant
❌ Speed: 20-40 seconds
```

### **AFTER** (Proposed - High Volume + Quality):

```
User Query: "React developer"
    ↓
┌─────────────────────────────────────┐
│ Keyword Expansion (same)            │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Parallel Source Fan-out (57)        │
│ NEW SOURCES:                        │
│ + AngelList                         │
│ + Twitter Lists                     │
│ + IndieHackers Enhanced             │
│ + More Craigslist cities            │
│ + Dev.to expanded                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Relaxed Pre-Filter                  │
│ - isPotentialBuyerContent()         │
│ - Increased per-source limits       │
│   (15 → 30)                         │
│ - Drops only 10-20%                 │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ LLM Relevance Filter (NEW)          │
│ - Batch: 20 leads at a time         │
│ - Model: GPT-4o-mini                │
│ - Semantic validation               │
│ - Cost: ~$0.0001/lead               │
│ - Speed: 2-3s/batch                 │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Cache Layer (NEW)                   │
│ - TTL: 15 minutes                   │
│ - Key: hash(query + filters)        │
│ - Hit rate: 30-40%                  │
└─────────────────────────────────────┘
    ↓
✅ Volume: 450+ leads (3x increase)
✅ Quality: <5% irrelevant
✅ Speed: <15 seconds
```

---

## 💼 JOBS MODULE (NEW)

### **Architecture**:

```
User Input: Resume + Preferences
    ↓
┌─────────────────────────────────────┐
│ Resume Parser                       │
│ - Extract skills, experience, prefs │
│ - Parse education, certifications   │
│ - Identify target roles             │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Job Search (Multi-Source)           │
│ - LinkedIn Jobs                     │
│ - Indeed                            │
│ - RemoteOK                          │
│ - We Work Remotely                  │
│ - AngelList                         │
│ - Y Combinator                      │
│ - Greenhouse/Lever (ATS)            │
│ - GitHub Jobs                       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Job-Resume Matching                 │
│ - Skill overlap scoring             │
│ - Experience level match            │
│ - Location/remote preference        │
│ - LLM semantic matching             │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Hiring Contact Finder               │
│ - Scrape company website            │
│ - Search LinkedIn for hiring mgr    │
│ - Find email patterns               │
│ - Verify contacts                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Outreach Draft Generator            │
│ - Personalized message              │
│ - Reference resume highlights       │
│ - Mention specific role details     │
│ - Professional tone                 │
└─────────────────────────────────────┘
    ↓
✅ Personalized job opportunities
✅ Direct hiring contact info
✅ Ready-to-send outreach drafts
```

---

## 🛡️ ANTI-HALLUCINATION PIPELINE

### **Multi-Layer Validation**:

```
Raw Leads (1000)
    ↓
┌─────────────────────────────────────┐
│ Layer 1: Keyword Pre-Filter        │
│ - Fast regex checks                 │
│ - Remove obvious mismatches         │
│ - Cost: Free                        │
│ - Speed: Instant                    │
│ - Drops: 30-40%                     │
└─────────────────────────────────────┘
    ↓ (600 leads)
┌─────────────────────────────────────┐
│ Layer 2: Buyer Intent Detection    │
│ - Pattern matching                  │
│ - Seller signal removal             │
│ - Cost: Free                        │
│ - Speed: Instant                    │
│ - Drops: 20-30%                     │
└─────────────────────────────────────┘
    ↓ (450 leads)
┌─────────────────────────────────────┐
│ Layer 3: LLM Semantic Check         │
│ - Batch validation (20/batch)       │
│ - Semantic relevance                │
│ - Cost: ~$0.045 total               │
│ - Speed: 2-3s/batch (45s total)     │
│ - Drops: 10-20%                     │
└─────────────────────────────────────┘
    ↓ (400 leads)
┌─────────────────────────────────────┐
│ Layer 4: Engagement Threshold      │
│ - Boost high-quality signals        │
│ - Sort by relevance + engagement    │
│ - Cost: Free                        │
│ - Speed: Instant                    │
└─────────────────────────────────────┘
    ↓
✅ Final: 400 high-quality leads
✅ False positive rate: <5%
✅ Total cost: ~$0.045
✅ Total time: ~1 minute
```

---

## 🗄️ Data Flow

### **Current Flow**:

```
Static JSON → Simple Filter → UI
```

### **Proposed Flow**:

```
Multiple Sources → Pre-Filter → LLM Filter → Cache → UI
       ↓              ↓            ↓          ↓
  Live Crawl    Buyer Intent   Semantic   Fast
  (Fresh Data)  (Pattern)      (AI)       (Reuse)
```

---

## 📦 Component Architecture

### **New Components**:

```
src/
├── lib/
│   ├── investors/
│   │   ├── stage-matcher.ts          ✨ NEW
│   │   ├── sector-matcher.ts         ✨ NEW
│   │   ├── crawler.ts                ✨ NEW
│   │   ├── linkedin-scraper.ts       ✨ NEW
│   │   ├── twitter-scraper.ts        ✨ NEW
│   │   └── profile-enrichment.ts     ✨ NEW
│   │
│   ├── search/
│   │   ├── llm-relevance-filter.ts   ✨ NEW
│   │   ├── result-cache.ts           ✨ NEW
│   │   ├── angellist-sources.ts      ✨ NEW
│   │   └── twitter-lists.ts          ✨ NEW
│   │
│   └── jobs/
│       ├── search.ts                 ✨ NEW
│       ├── job-matcher.ts            ✨ NEW
│       ├── hiring-contact-finder.ts  ✨ NEW
│       └── resume-parser.ts          ✨ NEW
│
├── routes/_authenticated/
│   └── jobs.tsx                      ✨ NEW
│
└── components/
    └── jobs/
        ├── job-card.tsx              ✨ NEW
        ├── resume-upload.tsx         ✨ NEW
        └── job-preferences-form.tsx  ✨ NEW
```

---

## 🔄 Integration Points

### **LLM Integration**:

```
OpenAI GPT-4o-mini
    ↓
┌─────────────────────────────────────┐
│ Use Cases:                          │
│ 1. Lead relevance filtering         │
│ 2. Sector semantic matching         │
│ 3. Resume parsing                   │
│ 4. Job-resume matching              │
│ 5. Outreach draft generation        │
└─────────────────────────────────────┘
    ↓
Cost: ~$0.0001 per lead
Speed: 2-3 seconds per batch (20 leads)
```

### **Web Crawling Integration**:

```
Firecrawl API
    ↓
┌─────────────────────────────────────┐
│ Use Cases:                          │
│ 1. Investor website crawling        │
│ 2. Company profile enrichment       │
│ 3. Job listing details              │
│ 4. LinkedIn public profile scraping │
└─────────────────────────────────────┘
    ↓
Cost: ~$0.001 per page
Speed: 1-2 seconds per page
Free tier: 1,000 pages/month
```

### **Search Integration**:

```
Serper API
    ↓
┌─────────────────────────────────────┐
│ Use Cases:                          │
│ 1. Find LinkedIn profiles           │
│ 2. Find Twitter profiles            │
│ 3. Find company websites            │
│ 4. Discover related sources         │
└─────────────────────────────────────┘
    ↓
Cost: ~$0.005 per query
Speed: 0.5-1 second per query
Free tier: 2,500 queries/month
```

---

## ⚡ Performance Optimizations

### **Caching Strategy**:

```
Request → Check Cache → Hit? → Return
                ↓ Miss
          Fetch Sources → Filter → LLM → Cache → Return
                                            ↓
                                    TTL: 15 min
```

### **Parallel Processing**:

```
52 Sources → Promise.allSettled() → Stream Results
    ↓             ↓                      ↓
Source 1     Source 2  ... Source 52   UI Update
(16s timeout)                          (as ready)
```

### **Batch LLM Calls**:

```
450 Leads → Chunk(20) → 23 Batches → Parallel → Merge
                ↓
         2-3s per batch
         45-60s total
```

---

## 📈 Scalability

### **Current Limits**:

- 52 sources
- ~150 leads/search
- 20-40 seconds response
- No caching

### **Proposed Limits**:

- 57 sources (5 new)
- ~450 leads/search (3x)
- <15 seconds response (2x faster)
- 30-40% cache hit rate

### **Future Scaling**:

- Add Redis for distributed caching
- Add job queue for background enrichment
- Add webhook for real-time updates
- Add streaming API for progressive results

---

**Status**: Ready for implementation  
**Dependencies**: OpenAI, Firecrawl, Serper APIs  
**Timeline**: 3-4 weeks  
**Next**: Get approval → Start Phase 1
