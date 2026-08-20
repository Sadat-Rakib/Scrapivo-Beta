# Test Verification Script

## Pre-Test Checklist

✅ Build successful  
✅ Dev server running on http://localhost:8081  
✅ Firm prioritization removed  
✅ Limit increased to 500  
✅ Expandable cards implemented  
✅ Israel tags removed  
✅ Location hierarchy configured

---

## Test 1: Entity Display (Firms + Individuals)

**Objective**: Verify both firms AND individuals appear together

**Steps**:

1. Go to http://localhost:8081/investors
2. Search with: Stage = "Seed"
3. Observe the results

**Expected**:

- Mix of firms (with "Firm" badge) and individuals (no badge)
- Example firm: ".406 Ventures" (has "Firm" badge)
- Example individual: Any person with firm name in subtitle
- Both types sorted by check size (not firms first)

**Pass Criteria**: ✅ See both entity types mixed together

---

## Test 2: Result Limit (500 vs 80)

**Objective**: Verify up to 500 results shown

**Steps**:

1. Search with no filters (or very broad filter)
2. Count results shown

**Expected**:

- Up to 500 results displayed
- "X matches" text shows actual count

**Pass Criteria**: ✅ Can see more than 80 results

---

## Test 3: Expandable Cards

**Objective**: Cards expand to show full details

**Steps**:

1. Click any investor/VC card
2. Observe expansion
3. Click again to collapse

**Expected When Expanded**:

- All investment categories (if >4)
- All locations (if >3)
- Bio/description (if available)
- Investment thesis (if available)
- Smooth slide-down animation
- Can collapse by clicking again

**Pass Criteria**: ✅ Card expands showing additional info

---

## Test 4: Location Hierarchy - India

**Objective**: Hierarchical location matching

**Steps**:

1. Clear all filters
2. Location filter: "India"
3. Observe results

**Expected**:

- Should show investors with "India" in investment_locations
- Data shows 326 India investors exist
- May also include Asia region investors (if hierarchy matches)

**Pass Criteria**: ✅ Shows India-specific investors

---

## Test 5: Location Hierarchy - Bangladesh

**Objective**: Country + region matching

**Steps**:

1. Clear all filters
2. Location filter: "Bangladesh"
3. Observe results

**Expected**:

- Should show Bangladesh investors (data has 2)
- Should also show South Asia / Asia region investors
- Uses matchLocation() hierarchy

**Pass Criteria**: ✅ Shows Bangladesh + regional investors

---

## Test 6: Location Hierarchy - Dhaka (City)

**Objective**: City → Country → Region matching

**Steps**:

1. Clear all filters
2. Location filter: "Dhaka"
3. Observe results

**Expected**:

- Maps "Dhaka" → Bangladesh → South Asia → Asia
- Shows Bangladesh investors + Asia region investors
- Uses CITY_TO_LOCATION mapping

**Pass Criteria**: ✅ City search finds country/region investors

---

## Test 7: Location Hierarchy - Asia (Continent)

**Objective**: Continent-level matching

**Steps**:

1. Clear all filters
2. Location filter: "Asia"
3. Observe results

**Expected**:

- Shows ALL investors in Asian countries
- Includes: India, Bangladesh, Pakistan, Singapore, China, Japan, etc.
- Uses REGIONAL_GROUPS['Asia'] mapping
- Should be many results (India alone has 326)

**Pass Criteria**: ✅ Shows investors from all Asian countries

---

## Test 8: Israel Removal

**Objective**: No Israel tags anywhere

**Steps**:

1. Search location: "Israel"
2. Observe results

**Expected**:

- 0 results
- No cards show Israel location tags
- Data has been cleaned (379 tags removed)

**Pass Criteria**: ✅ Zero Israel results

---

## Test 9: Stage Filter - Pre-seed

**Objective**: Exact stage matching (not seed)

**Steps**:

1. Clear all filters
2. Stage: "Pre-seed"
3. Observe results

**Expected**:

- Only shows "Pre-seed" stage investors
- Does NOT show "Seed" investors
- Uses exact matching after normalization

**Pass Criteria**: ✅ No "Seed" investors in Pre-seed results

---

## Test 10: Stage Filter - Seed

**Objective**: Seed excludes Pre-seed

**Steps**:

1. Clear all filters
2. Stage: "Seed"
3. Observe results

**Expected**:

- Only shows "Seed" stage investors
- Does NOT show "Pre-seed" investors

**Pass Criteria**: ✅ No "Pre-seed" investors in Seed results

---

## Test 11: Check Size - Angel

**Objective**: Check size filtering (<$100K)

**Steps**:

1. Clear all filters
2. Check size: "Angel (<$100K)"
3. Observe results

**Expected**:

- Shows investors with sweet spot <$100K
- Uses parseMoney() to parse check sizes

**Pass Criteria**: ✅ Shows small check investors

---

## Test 12: Check Size - Seed

**Objective**: Mid-range check sizes

**Steps**:

1. Clear all filters
2. Check size: "$100K-$5M"
3. Observe results

**Expected**:

- Shows investors in $100K-$5M range
- Should be many results (common range)

**Pass Criteria**: ✅ Shows mid-range check investors

---

## Test 13: Check Size - Growth

**Objective**: Large check sizes (>$5M)

**Steps**:

1. Clear all filters
2. Check size: "$5M+"
3. Observe results

**Expected**:

- Shows investors with >$5M checks
- Likely larger firms and VCs

**Pass Criteria**: ✅ Shows large check investors

---

## Test 14: Semantic Sector - AI

**Objective**: Synonym expansion for AI

**Steps**:

1. Clear all filters
2. Search query: "AI"
3. Observe results

**Expected**:

- Shows investors with "AI", "machine learning", "artificial intelligence", "deep learning", etc.
- Uses semantic matcher with Groq + Llama
- May take <2s for uncached query

**Pass Criteria**: ✅ Shows AI-related investors beyond exact "AI"

---

## Test 15: Semantic Sector - Fintech

**Objective**: Synonym expansion for fintech

**Steps**:

1. Clear all filters
2. Search query: "fintech"
3. Observe results

**Expected**:

- Shows "fintech", "financial technology", "payments", "banking", etc.
- Semantic expansion working

**Pass Criteria**: ✅ Shows finance-related investors

---

## Test 16: Combined Filters

**Objective**: Multiple filters work together

**Steps**:

1. Stage: "Seed"
2. Check size: "$100K-$5M"
3. Location: "USA"
4. Observe results

**Expected**:

- Shows ONLY investors matching ALL criteria
- Seed stage + $100K-$5M + USA locations

**Pass Criteria**: ✅ All filters apply correctly

---

## Known Data Limitations

⚠️ **Empty Location Records**: 1,851 records (53%) have no location data

- These won't appear in location searches (correct behavior)
- They still appear in non-location searches

⚠️ **Empty Categories**: Some records have no investment categories

- Won't match sector searches
- Still appear in non-sector searches

---

## Quick Test Commands

```bash
# Check server is running
curl http://localhost:8081/investors

# Check build
npm run build

# Restart dev server
npm run dev
```

---

## Success Metrics

- [ ] All 16 tests pass
- [ ] No console errors
- [ ] Performance acceptable (<2s for queries)
- [ ] User satisfied with results
- [ ] Both firms and individuals visible
- [ ] Israel searches return 0

---

## Report Issues

If any test fails, report:

1. Test number that failed
2. Expected vs actual behavior
3. Console errors (if any)
4. Screenshot (if helpful)

---

**Test Environment**: http://localhost:8081/investors  
**Data File**: `data/investors_merged.json`  
**Total Records**: 3,492 (509 firms + 2,983 individuals)
