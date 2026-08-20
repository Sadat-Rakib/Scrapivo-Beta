# 🧪 End-to-End Testing Guide

## Quick Start

**Production URL**: https://scrapivo-beta.vercel.app

## Test Scenarios

### Scenario 1: Basic Search (5 minutes)

1. **Navigate to Discover**
   - Open https://scrapivo-beta.vercel.app
   - Click "Discover" in the navigation

2. **Run Search**
   - Enter: "React developer"
   - Click "Discover Leads"
   - Wait ~30-60 seconds

3. **Verify Results**
   Check that leads appear from:
   - ✅ Reddit
   - ✅ LinkedIn (via SearXNG)
   - ✅ Hacker News
   - ✅ **Craigslist** (NEW - should show gigs)
   - ✅ **Dev.to** (NEW - should show hiring posts)
   - ✅ Upwork
   - ✅ GitHub
   - ✅ Twitter/X (via SearXNG)

4. **Check Lead Quality**
   - Click on a lead to open details panel
   - Verify:
     - Title makes sense
     - Snippet shows relevant content
     - Posted date is recent (or shows freshnessWindow)
     - Platform label is correct
     - Engagement score exists

---

### Scenario 2: Test New Platforms (10 minutes)

#### Test Craigslist

1. Search: "graphic designer"
2. Look for results with:
   - Platform: "Craigslist"
   - Platform Label: "Craigslist Gig"
   - URL contains: `craigslist.org`
3. Expected: Gigs from major cities (NYC, LA, SF, etc.)

#### Test Dev.to

1. Search: "Python developer"
2. Look for results with:
   - Platform: "Dev.to"
   - Platform Label: "Dev.to Post"
   - URL contains: `dev.to`
3. Expected: Articles with hiring/freelance intent

#### Test Quora

1. Search: "web developer"
2. Look for results with:
   - Platform: "Quora"
   - Platform Label: "Quora Question"
   - URL contains: `quora.com`
3. Expected: Questions about hiring/finding developers

---

### Scenario 3: SearXNG Integration Test (5 minutes)

**Purpose**: Verify SearXNG is working for social platforms

1. **Search for Social Intent**
   - Enter: "looking for a designer"
   - This phrase should trigger social dorks

2. **Check for Social Results**
   Look for platforms powered by SearXNG:
   - ✅ LinkedIn posts (`linkedin.com/posts`)
   - ✅ Twitter/X posts (`twitter.com` or `x.com`)
   - ✅ Instagram posts (`instagram.com`)
   - ✅ Facebook posts (`facebook.com`)

3. **Verify Performance**
   - First search after deployment may be slow (SearXNG cold start)
   - Subsequent searches should be faster (caching)
   - Should complete within 60 seconds

---

### Scenario 4: Multi-Skill Test (10 minutes)

Test different skills to verify source coverage:

#### Designer Search

- Query: "UI designer"
- Expected sources:
  - Upwork, Freelancer, Fiverr
  - Craigslist, Reddit, Dribbble
  - LinkedIn, Twitter
  - Hacker News

#### Writer Search

- Query: "content writer"
- Expected sources:
  - Upwork, Freelancer
  - Craigslist, Reddit (r/forhire, r/HireaWriter)
  - LinkedIn, Twitter
  - Dev.to (tech writing)

#### Developer Search

- Query: "Node.js developer"
- Expected sources:
  - GitHub, Stack Overflow Jobs
  - Hacker News, Dev.to
  - Upwork, Remote OK
  - Craigslist, Reddit
  - LinkedIn, Twitter

---

### Scenario 5: Filter & Sort Test (5 minutes)

1. **Run a Search**
   - Enter any skill
   - Wait for results

2. **Test Filters**
   - Use the filter panel to:
     - Filter by platform
     - Filter by date range
     - Filter by intent level
   - Verify results update correctly

3. **Test Sorting**
   - Sort by:
     - Relevance (default)
     - Date (newest first)
     - Engagement (highest first)
   - Verify order changes

---

## 🐛 Debugging Checks

### If No Results Appear

1. **Check Browser Console**
   - Open DevTools (F12)
   - Look for errors in Console tab
   - Check Network tab for failed requests

2. **Check SearXNG Status**
   - Visit: https://searxng-bgj26.onrender.com
   - Should show SearXNG homepage
   - If 404 or down, check Render dashboard

3. **Check UptimeRobot**
   - Verify monitor shows "Up"
   - Check if recent pings succeeded

### If Craigslist Results Missing

1. **Test RSS Feed Directly**

   ```bash
   curl "https://newyork.craigslist.org/search/cgg?format=rss&query=developer"
   ```

   - Should return XML RSS feed
   - If 403/404, Craigslist may be blocking

2. **Check Console for Errors**
   - Look for "craigslist" in logs
   - Check if XML parsing failed

### If Dev.to Results Missing

1. **Test API Directly**

   ```bash
   curl "https://dev.to/api/articles?tag=hiring&per_page=5"
   ```

   - Should return JSON with articles
   - If empty, Dev.to may have no recent posts

2. **Check Search Query**
   - Skill must appear in article title/description
   - Try broader terms

### If Quora Results Missing

1. **Test Web Access**
   - Visit: https://www.quora.com/search?q=hire+developer
   - Should show search results
   - If blocked, Cloudflare may be active

2. **Check Browser Headers**
   - Quora scraping requires User-Agent
   - Check if requests are being blocked

### If Social Platforms Missing (LinkedIn, Twitter, etc.)

1. **Check SearXNG Connectivity**

   ```bash
   curl "https://searxng-bgj26.onrender.com/search?q=test&format=json"
   ```

   - First request may take 30-50s (cold start)
   - Should return JSON with results

2. **Check Budget System**
   - Social dorks have separate budget
   - May be exhausted if many searches run
   - Wait 1 minute and try again

3. **Check Cache**
   - Cached results have 10-minute TTL
   - Stale cache extends to 45 minutes
   - Results may be slightly old

---

## ✅ Success Criteria

A successful test run should show:

### Coverage

- ✅ At least 10 different sources
- ✅ Mix of gig platforms, communities, social
- ✅ All 3 new platforms appear (Craigslist, Dev.to, Quora)
- ✅ SearXNG social results (LinkedIn, Twitter, etc.)

### Quality

- ✅ Buyer intent detected (hiring posts, not portfolios)
- ✅ Recent dates (within last 7 days preferred)
- ✅ Relevant to search query
- ✅ No broken links
- ✅ No duplicates

### Performance

- ✅ Results load within 60 seconds
- ✅ No console errors
- ✅ Filters work smoothly
- ✅ Lead details panel opens correctly

### Resilience

- ✅ If one source fails, others still return
- ✅ Empty sources don't crash the page
- ✅ Timeout sources are handled gracefully

---

## 📊 Expected Results by Search Type

### "React developer"

- **Sources**: 15-25 sources
- **Total Leads**: 50-200 leads
- **Top Sources**: GitHub, Hacker News, Dev.to, Upwork, Reddit, LinkedIn

### "graphic designer"

- **Sources**: 10-20 sources
- **Total Leads**: 30-150 leads
- **Top Sources**: Craigslist, Upwork, Fiverr, Dribbble, Reddit, LinkedIn

### "content writer"

- **Sources**: 10-18 sources
- **Total Leads**: 40-120 leads
- **Top Sources**: Upwork, Craigslist, Reddit, LinkedIn, Twitter

---

## 🎯 Test Report Template

After testing, document your findings:

```markdown
## Test Results - [Date/Time]

### Search Query: [e.g., "React developer"]

**Results**:

- Total Leads: [number]
- Sources Active: [number]
- Load Time: [seconds]

**New Platforms**:

- Craigslist: ✅/❌ [number of leads]
- Dev.to: ✅/❌ [number of leads]
- Quora: ✅/❌ [number of leads]

**Social Platforms (via SearXNG)**:

- LinkedIn: ✅/❌ [number of leads]
- Twitter: ✅/❌ [number of leads]
- Instagram: ✅/❌ [number of leads]

**Issues Found**:

- [List any errors, missing sources, or bugs]

**Overall Status**: ✅ PASS / ❌ FAIL
```

---

## 🚨 Critical Tests

These MUST work for the integration to be considered successful:

### Critical Test 1: SearXNG Reachability

```bash
curl "https://searxng-bgj26.onrender.com/search?q=test&format=json"
```

- **Expected**: JSON response with results
- **Critical**: ✅ Must succeed

### Critical Test 2: Production Deployment

- **URL**: https://scrapivo-beta.vercel.app
- **Expected**: Site loads, no build errors
- **Critical**: ✅ Must succeed

### Critical Test 3: Basic Search

- **Query**: Any skill (e.g., "developer")
- **Expected**: At least 10 sources return results
- **Critical**: ✅ Must succeed

### Critical Test 4: New Platform Coverage

- **Craigslist**: At least 1 result for "designer" search
- **Dev.to**: At least 1 result for "developer" search
- **Quora**: At least 1 result for "hire" search
- **Critical**: ✅ At least 2 of 3 must succeed

---

## 📞 Support

If tests fail consistently:

1. **Check Deployment Logs**
   - Visit: https://vercel.com/mir-sadat-bin-rakibs-projects/scrapivo-beta
   - Click latest deployment
   - Check Function Logs

2. **Check Environment Variables**

   ```bash
   vercel env ls | grep SEARXNG
   ```

   - Should show SEARXNG_URL in all environments

3. **Rebuild if Needed**

   ```bash
   npm run build
   vercel --prod
   ```

4. **Check Documentation**
   - `INTEGRATION_COMPLETE.md` - Full integration details
   - `SEARXNG_INTEGRATION_STATUS.md` - SearXNG setup

---

## ✨ Happy Testing!

Everything is deployed and ready. Run through the scenarios above to verify all systems are working correctly.

**Target**: All critical tests passing + 80% of sources active

**Production URL**: https://scrapivo-beta.vercel.app

Good luck! 🚀
