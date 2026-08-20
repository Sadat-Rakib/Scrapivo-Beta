# Design Document: Investor Search Fix

## Overview

This design addresses four critical issues in the investor search system: (1) broken stage filtering due to substring matching, (2) lack of semantic sector understanding, (3) outdated investor data, and (4) missing semantic search capabilities. The solution implements exact stage matching with proper normalization, adds AI-powered semantic sector search using free models, updates the investor dataset, and ensures all existing functionality continues working correctly.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Search API Layer                      │
│                    (searchInvestors function)                │
└────────────┬──────────────────────────────────┬─────────────┘
             │                                   │
    ┌────────▼────────┐                 ┌───────▼────────┐
    │  Stage Filter    │                 │ Sector Matcher │
    │  (Fixed Logic)   │                 │  (Semantic)    │
    └────────┬────────┘                 └───────┬────────┘
             │                                   │
             │                           ┌───────▼────────┐
             │                           │  Synonym Cache │
             │                           │  (In-Memory)   │
             │                           └───────┬────────┘
             │                                   │
             │                           ┌───────▼────────┐
             │                           │  Groq/Llama    │
             │                           │   Free AI API  │
             │                           └────────────────┘
             │
    ┌────────▼─────────────────────────────────────────┐
    │            Investor Dataset (JSON)                │
    │          (Updated, Israel-filtered)               │
    └───────────────────────────────────────────────────┘
```

### Component Interaction Flow

1. **Search Request**: User submits search with stage, sector, and other filters
2. **Stage Filtering**: Fixed exact-match stage filter processes stage criteria
3. **Sector Matching**: Semantic matcher expands sector query using AI (if available) or falls back to exact match
4. **Dataset Query**: Filters applied against updated investor dataset
5. **Result Ranking**: Results sorted by status and check size
6. **Response**: Filtered, ranked results returned to user

## Components and Interfaces

### 1. Stage Filter Component

**File**: `src/lib/investors/search.ts`

**Functions**:

```typescript
// Fixed normalization function
function stageNorm(s: string): string {
  // Converts to lowercase, replaces whitespace with hyphens
  // Standardizes "Series A/B/C" format
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/series\s*([a-z])/gi, "series-$1");
}

// Fixed stage matching function
function stageMatches(investorStages: string[], filterStage: string): boolean {
  const normalizedFilter = stageNorm(filterStage);
  return investorStages.some((s) => stageNorm(s) === normalizedFilter);
}
```

**Changes**:

- Replace `.includes()` substring matching with exact equality check
- Update stage filtering logic in `searchInvestors()` to use new `stageMatches()` function
- Preserve normalization for case/whitespace insensitivity
- Add explicit handling for "pre-seed" vs "seed" disambiguation

**Why This Fixes the Bug**:
The current code uses `stageNorm(s).includes(stage)` which causes "pre-seed" to match when filtering for "seed" because "seed" is a substring of "pre-seed". The fix uses exact equality after normalization: `stageNorm(s) === normalizedFilter`.

### 2. Semantic Sector Matcher Component

**New File**: `src/lib/investors/semantic-matcher.ts`

**Interface**:

```typescript
export interface SemanticMatcherConfig {
  model: string; // "groq/llama" or similar free model
  apiKey: string; // From environment variable
  cacheEnabled: boolean; // Enable in-memory caching
  timeoutMs: number; // Request timeout (default 2000ms)
  maxRetries: number; // Retry attempts (default 3)
}

export interface SemanticMatchResult {
  success: boolean;
  synonyms: string[]; // Expanded synonym list
  cached: boolean; // Whether result came from cache
  error?: string; // Error message if failed
}

export class SemanticMatcher {
  private cache: Map<string, string[]>;
  private config: SemanticMatcherConfig;

  constructor(config: SemanticMatcherConfig);

  async expandSectorTerm(term: string): Promise<SemanticMatchResult>;

  private async callAIModel(term: string): Promise<string[]>;

  private getCached(term: string): string[] | null;

  private setCached(term: string, synonyms: string[]): void;
}
```

**Implementation Details**:

1. **AI Integration**:
   - Use Groq API with Llama 3 model (free tier)
   - Prompt template: "List 5-10 synonyms and related terms for the sector: {term}. Return as comma-separated list."
   - Parse response to extract synonym list
   - Handle API errors gracefully

2. **Caching Strategy**:
   - In-memory Map for synonym storage
   - Cache key: normalized sector term
   - Cache invalidation: none (static for session)
   - Cache size limit: 1000 entries (LRU eviction if needed)

3. **Error Handling**:
   - Timeout after 2000ms
   - Exponential backoff: 100ms, 200ms, 400ms delays
   - Fallback to exact match on any failure
   - Log errors but don't throw

4. **Fallback Mechanism**:
   - If AI call fails: return original term only
   - If AI returns empty: return original term only
   - Search continues with available terms

### 3. Investor Dataset Updates

**File**: `data/investors.json`

**Update Strategy**:

1. **Data Sources for New Investors** (500 records):
   - Scrape public VC databases (Crunchbase, AngelList, Signal)
   - Focus on active investors from 2023-2026
   - Target stages: Pre-seed, Seed, Series A
   - Geographic focus: US, Canada, Europe (excluding Israel)

2. **Data Cleaning Process**:

   ```typescript
   function cleanInvestorData(records: InvestorRecord[]): InvestorRecord[] {
     return records
       .filter((r) => {
         // Remove Israel-based investors
         const hasIsraeliLocation = r.locations.some((loc) =>
           /israel|tel aviv|jerusalem|haifa|ramat gan|herzliya/i.test(loc),
         );
         return !hasIsraeliLocation;
       })
       .map((r) => {
         // Ensure data quality
         return {
           ...r,
           status: deriveStatus(r),
           verification: {
             state: "unverified",
             last_checked_at: new Date().toISOString(),
             notes: "",
           },
         };
       });
   }
   ```

3. **Schema Validation**:
   ```typescript
   function validateInvestorRecord(record: InvestorRecord): boolean {
     return (
       record.name?.trim().length > 0 &&
       record.firm?.trim().length > 0 &&
       record.title?.trim().length > 0 &&
       record.locations.length > 0 &&
       record.focus_areas.length > 0 &&
       record.stages.length > 0 &&
       record.check_sweet_spot_usd >= 0 &&
       record.check_min_usd >= 0 &&
       record.check_max_usd >= 0
     );
   }
   ```

### 4. Updated Search Function

**File**: `src/lib/investors/search.ts`

**Modified Function**:

```typescript
export async function searchInvestors(
  filters: InvestorSearchFilters = {},
): Promise<InvestorRecord[]> {
  const q = (filters.query || "").toLowerCase().trim();
  const stage = filters.stage && filters.stage !== "any" ? filters.stage : "";
  const sector = (filters.sector || "").toLowerCase().trim();
  const location = (filters.location || "").toLowerCase().trim();
  const status = filters.status ?? "active";
  const type = filters.investorType ?? "any";
  const limit = filters.limit ?? 80;

  let rows = getAllInvestors().map((r) => ({
    ...r,
    status: deriveStatus(r),
  }));

  // Status filter
  if (status !== "any") {
    rows = rows.filter(
      (r) => r.status === status || (status === "active" && r.status === "needs_review" && q),
    );
  }
  if (!filters.status) {
    rows = rows.filter((r) => r.status !== "inactive");
  }

  // Type filter
  if (type !== "any") rows = rows.filter((r) => r.investor_type === type);

  // Check band filter
  rows = rows.filter((r) => checkBandMatch(r, filters.checkBand));

  // FIXED: Stage filter with exact matching
  if (stage) {
    rows = rows.filter((r) => stageMatches(r.stages, stage));
  }

  // NEW: Semantic sector matching
  if (sector) {
    const matcher = getSemanticMatcher(); // Singleton instance
    const matchResult = await matcher.expandSectorTerm(sector);
    const searchTerms = matchResult.success ? matchResult.synonyms : [sector];

    rows = rows.filter((r) =>
      r.focus_areas.some((f) =>
        searchTerms.some((term) => f.sector.toLowerCase().includes(term.toLowerCase())),
      ),
    );
  }

  // Location filter
  if (location) {
    rows = rows.filter((r) => r.locations.some((l) => l.toLowerCase().includes(location)));
  }

  // Query filter
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.name,
        r.firm,
        r.title,
        ...r.locations,
        ...r.focus_areas.map((f) => `${f.sector} ${f.stage}`),
      ]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    });
  }

  // Sorting (preserved)
  return rows
    .sort((a, b) => {
      const as = a.status === "active" ? 1 : 0;
      const bs = b.status === "active" ? 1 : 0;
      if (bs !== as) return bs - as;
      return (b.check_sweet_spot_usd || 0) - (a.check_sweet_spot_usd || 0);
    })
    .slice(0, limit);
}
```

## Data Models

### InvestorRecord (Existing)

```typescript
export type InvestorRecord = {
  id: string;
  name: string;
  firm: string;
  title: string;
  investor_type: "vc" | "angel" | "scout" | "unknown";
  check_sweet_spot_usd: number;
  check_min_usd: number;
  check_max_usd: number;
  locations: string[];
  focus_areas: InvestorFocus[];
  stages: string[];
  status: "active" | "needs_review" | "inactive";
  verification: {
    state: "unverified" | "verified" | "stale";
    last_checked_at: string | null;
    notes: string;
  };
  links: {
    linkedin: string | null;
    firm: string | null;
    profile: string | null;
  };
  source_batch: string;
};
```

**No changes to schema** - all modifications work within existing structure.

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Pre-seed Filter Exclusivity

_For any_ investor record, if the stage filter is set to "Pre-seed", then the record SHALL appear in results if and only if its stages array contains "Pre-seed" as an exact match after normalization.

**Validates: Requirements 1.1, 1.2**

### Property 2: Stage Filter Exact Matching

_For any_ stage filter value and any investor record, the stage matching SHALL use exact equality after normalization rather than substring matching.

**Validates: Requirements 1.4**

### Property 3: Seed vs Pre-seed Disambiguation

_For any_ investor record containing only "Pre-seed" in stages and not "Seed", that record SHALL NOT appear when filtering by "Seed" stage.

**Validates: Requirements 1.3**

### Property 4: Stage Normalization Consistency

_For any_ stage string input, the normalization function SHALL produce lowercase output with whitespace replaced by hyphens and "Series X" formatted as "series-x".

**Validates: Requirements 1.5**

### Property 5: Israel Location Exclusion

_For any_ investor record where the locations array contains any string matching Israel-based locations (Israel, Tel Aviv, Jerusalem, Haifa, etc.), that record SHALL NOT appear in any search results.

**Validates: Requirements 3.2, 3.3**

### Property 6: Schema Validation Completeness

_For any_ new investor record, if it passes validation, then all required fields (name, firm, title, locations, focus_areas, stages) SHALL be present and non-empty.

**Validates: Requirements 6.1, 6.4**

### Property 7: Check Size Validation

_For any_ investor record, if it passes validation, then all check size fields (check_sweet_spot_usd, check_min_usd, check_max_usd) SHALL be non-negative numbers.

**Validates: Requirements 6.2**

### Property 8: Stages Array Validation

_For any_ investor record, if it passes validation, then the stages array SHALL contain at least one non-empty stage value.

**Validates: Requirements 6.3**

### Property 9: Israeli Location Rejection

_For any_ investor record submitted for addition, if any location field contains Israeli city names (Israel, Tel Aviv, Jerusalem, Haifa, Ramat Gan, Herzliya), then the record SHALL be rejected during validation.

**Validates: Requirements 6.5**

### Property 10: Status Derivation Correctness

_For any_ investor record, the derived status SHALL be "active" if all required fields are complete and non-zero, otherwise SHALL be "needs_review".

**Validates: Requirements 6.6**

### Property 11: Sort Order Stability

_For any_ set of investor records returned by search, records with status "active" SHALL appear before records with other statuses, and within each status group, records SHALL be ordered by descending check_sweet_spot_usd.

**Validates: Requirements 4.6**

### Property 12: Result Limit Enforcement

_For any_ search query with a specified limit value, the number of returned results SHALL NOT exceed that limit value.

**Validates: Requirements 4.7**

### Property 13: Data Preservation Invariant

_For any_ investor record that exists before dataset update and does not have Israeli locations, that record SHALL exist in the dataset after the update.

**Validates: Requirements 3.6**

## Error Handling

### AI Service Failures

1. **Network Errors**: Catch and log, fallback to exact matching
2. **Timeout**: Abort after 2000ms, fallback to exact matching
3. **Invalid Response**: Parse errors logged, fallback to exact matching
4. **Rate Limiting**: Exponential backoff with 3 retry attempts
5. **Missing API Key**: Log warning, disable semantic matching, use exact matching only

### Data Validation Errors

1. **Invalid Schema**: Reject record, log validation errors with field names
2. **Missing Required Fields**: Reject record, log missing field names
3. **Israeli Locations**: Reject record, log rejection reason
4. **Invalid Check Sizes**: Reject record, log invalid values

### Search Errors

1. **Empty Dataset**: Return empty array, log warning
2. **Invalid Filter Values**: Treat as "any"/no filter for that dimension
3. **Stage Not Found**: Return empty array (no matches)
4. **Sector Not Found**: Return empty array (no matches)

## Testing Strategy

### Unit Tests

**Stage Filter Tests** (`search.test.ts`):

- Test stage normalization with various formats (spaces, case, series notation)
- Test pre-seed filter excludes seed/series A/B results
- Test seed filter excludes pre-seed-only results
- Test series A/B/C filters work correctly
- Test "any" stage filter returns all records

**Semantic Matcher Tests** (`semantic-matcher.test.ts`):

- Test AI API integration with mocked responses
- Test cache hit/miss behavior
- Test fallback on AI failure
- Test timeout enforcement
- Test retry logic with transient failures
- Test specific synonym expansions (AI -> ML terms, fintech -> finance terms)

**Data Validation Tests** (`validation.test.ts`):

- Test required field validation
- Test check size validation (positive, zero, negative)
- Test Israeli location rejection
- Test status derivation logic
- Test schema conformance

**Regression Tests** (`regression.test.ts`):

- Test location filter still works
- Test check band filter still works
- Test investor type filter still works
- Test status filter still works
- Test query search still works
- Test sorting still works
- Test limit still works

### Property-Based Tests

Property-based tests will use **fast-check** library for TypeScript, configured to run 100 iterations per property.

**Configuration**:

```typescript
import fc from "fast-check";

// Run each property test with 100 iterations
const testConfig = { numRuns: 100 };
```

**Property Test Tags**:
Each property test will include a comment tag referencing the design property:

```typescript
// Feature: investor-search-fix, Property 1: Pre-seed Filter Exclusivity
```

**Property Test Implementations**:

1. **Property 1 - Pre-seed Filter Exclusivity** (`search.property.test.ts`)
   - Generate random investor records with various stage combinations
   - Apply pre-seed filter
   - Verify all results contain "Pre-seed" exactly
   - Verify no results contain only "Seed" or "Series" stages

2. **Property 2 - Stage Filter Exact Matching** (`search.property.test.ts`)
   - Generate random stage names and investor records
   - Apply stage filter
   - Verify matching uses exact equality after normalization

3. **Property 4 - Stage Normalization Consistency** (`search.property.test.ts`)
   - Generate random stage strings with various formats
   - Apply normalization
   - Verify output is lowercase, hyphenated, with standardized "series-x" format

4. **Property 5 - Israel Location Exclusion** (`search.property.test.ts`)
   - Generate random investor records including some with Israeli locations
   - Execute search
   - Verify no results contain Israeli location strings

5. **Property 6 - Schema Validation Completeness** (`validation.property.test.ts`)
   - Generate random investor records
   - Apply validation
   - Verify all passing records have non-empty required fields

6. **Property 7 - Check Size Validation** (`validation.property.test.ts`)
   - Generate random records with various check size values
   - Apply validation
   - Verify all passing records have non-negative check sizes

7. **Property 8 - Stages Array Validation** (`validation.property.test.ts`)
   - Generate random records with various stages arrays
   - Apply validation
   - Verify all passing records have at least one stage

8. **Property 9 - Israeli Location Rejection** (`validation.property.test.ts`)
   - Generate random records with various location combinations
   - Apply validation
   - Verify all records with Israeli locations are rejected

9. **Property 10 - Status Derivation Correctness** (`validation.property.test.ts`)
   - Generate random records with varying completeness
   - Apply status derivation
   - Verify "active" assigned only to complete records

10. **Property 11 - Sort Order Stability** (`search.property.test.ts`)
    - Generate random investor sets with different statuses and check sizes
    - Execute search
    - Verify sort order follows priority rules (active first, then by check size)

11. **Property 12 - Result Limit Enforcement** (`search.property.test.ts`)
    - Generate datasets larger than various limit values
    - Execute search with limits
    - Verify returned results length equals limit or dataset size (whichever is smaller)

12. **Property 13 - Data Preservation Invariant** (`dataset.property.test.ts`)
    - Generate dataset with mixed Israeli and non-Israeli records
    - Apply dataset update/cleaning
    - Verify all non-Israeli records preserved

### Integration Tests

**End-to-End Search Tests** (`e2e.test.ts`):

- Test complete search flow with all filters combined
- Test with real (mocked) AI responses
- Test with actual dataset subset
- Measure performance (should complete < 1000ms for typical queries)

### Performance Testing

**Benchmark Tests** (`benchmark.test.ts`):

- Search with stage filter: < 100ms for 1000 record dataset
- Search with semantic sector (cached): < 500ms
- Search with semantic sector (uncached): < 2000ms
- Combined filters: < 150ms
- Full dataset scan: < 200ms

### Test Coverage Goals

- Line coverage: > 90%
- Branch coverage: > 85%
- Property test iterations: 100 per property
- Unit test count: ~50 tests
- Property test count: ~13 properties
- Integration test count: ~10 tests
