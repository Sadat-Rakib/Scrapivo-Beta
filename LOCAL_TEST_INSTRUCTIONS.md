# 🧪 Local Testing Instructions

## ✅ Server Status: RUNNING

Your development server is now live and ready for testing!

- **Local URL**: http://localhost:8081/
- **Status**: ✅ Running (200 OK)
- **Startup Time**: 27 seconds
- **Mode**: Development (hot reload enabled)

---

## 🎯 Quick Test Scenarios

### Test 1: Basic Navigation (1 minute)

1. Open your browser
2. Go to: **http://localhost:8081/**
3. Verify:
   - ✅ Home page loads
   - ✅ Navigation menu works
   - ✅ No console errors (F12 → Console tab)

---

### Test 2: Discover Page - Basic Search (3 minutes)

1. Navigate to "Discover" in the menu
2. Enter search query: **"React developer"**
3. Click "Discover Leads" (or similar button)
4. Wait 15-30 seconds for results
5. Expected results from:
   - ✅ Reddit (r/forhire, r/hiring, r/webdev)
   - ✅ Hacker News (Who's Hiring + broad search)
   - ✅ **Dev.to** ✨ (NEW - hiring/freelance posts)
   - ✅ GitHub (issues, hiring lists)
   - ✅ Upwork (job postings)
   - ✅ LinkedIn (via SearXNG - if available)
   - ✅ Twitter/X (via SearXNG - if available)

**Success Criteria**: At least 10 sources return results, total 20+ leads

---

### Test 3: NEW Platform - Craigslist (3 minutes)

1. In Discover page, search: **"graphic designer"**
2. Wait for results
3. Look for leads with:
   - **Platform**: "Craigslist"
   - **Platform Label**: "Craigslist Gig"
   - **URL**: Contains `craigslist.org`
   - **Cities**: NYC, LA, SF, Chicago, etc.
4. Check lead details:
   - Title should show gig description
   - Snippet should show job details
   - Should NOT show "hire me" or portfolio posts (filtered out)

**Success Criteria**: At least 1-3 Craigslist results appear

---

### Test 4: NEW Platform - Dev.to (3 minutes)

1. In Discover page, search: **"Python developer"**
2. Wait for results
3. Look for leads with:
   - **Platform**: "Dev.to"
   - **URL**: Contains `dev.to`
   - **Content**: Articles with hiring/freelance/collab intent
4. Check lead details:
   - Title should be article title
   - Snippet should show article description
   - Posted date should be recent

**Success Criteria**: At least 1-3 Dev.to results appear

---

### Test 5: NEW Platform - Quora (3 minutes)

1. In Discover page, search: **"web developer"**
2. Wait for results
3. Look for leads with:
   - **Platform**: "Quora"
   - **Platform Label**: "Quora Question"
   - **URL**: Contains `quora.com`
   - **Content**: Questions about hiring/finding developers
4. Check lead details:
   - Title should be the question
   - Should contain phrases like "looking for", "where can I hire", "need a"

**Success Criteria**: At least 1-3 Quora results appear

---

### Test 6: Multi-Platform Coverage (5 minutes)

Test different skill types to verify comprehensive coverage:

#### Designer Test

- **Query**: "UI designer"
- **Expected Sources**:
  - Craigslist ✨, Upwork, Fiverr, Freelancer
  - Reddit (r/forhire, r/designjobs)
  - Dribbble (via dorks)
  - LinkedIn, Instagram (via SearXNG)
- **Success**: 10-20 sources, 30-100 leads

#### Writer Test

- **Query**: "content writer"
- **Expected Sources**:
  - Upwork, Craigslist ✨, Freelancer
  - Reddit (r/forhire, r/HireaWriter)
  - Dev.to ✨ (tech writing)
  - LinkedIn, Twitter (via SearXNG)
- **Success**: 10-15 sources, 25-80 leads

#### Developer Test

- **Query**: "Node.js developer"
- **Expected Sources**:
  - GitHub, Hacker News, Dev.to ✨
  - Stack Exchange, Upwork
  - Craigslist ✨, Reddit
  - LinkedIn, Twitter (via SearXNG)
- **Success**: 15-25 sources, 50-150 leads

---

## 🔍 What to Look For

### ✅ Good Signs:

- Results appear from 10+ different sources
- Mix of platforms (gig sites, communities, social, job boards)
- All 3 NEW platforms appear (Craigslist, Dev.to, Quora)
- Lead details panel shows complete information
- No errors in browser console
- Filter/sort controls work smoothly
- Engagement scores are calculated
- Posted dates are shown (when available)

### ❌ Red Flags:

- No results from any source
- Same results repeated multiple times (duplicates)
- Errors in console (F12 → Console tab)
- Missing platform labels
- Broken links
- "Hire me" or portfolio posts in results (should be filtered)
- Very old posts (>7 days for most sources)

---

## 🐛 Debugging Guide

### If No Results Appear:

1. **Check Browser Console** (F12)
   - Look for errors in Console tab
   - Check Network tab for failed requests
   - Red errors = something broke

2. **Check Server Logs**
   - Look at the terminal where `npm run dev` is running
   - Look for error messages
   - Common issues:
     - API rate limits
     - Network timeouts
     - Missing environment variables

3. **Verify Environment Variables**
   - Check `.env` file exists
   - Verify `SEARXNG_URL="https://searxng-bgj26.onrender.com"`
   - Check other API keys are present

---

### If Craigslist Results Missing:

1. **Test RSS Feed Directly**
   Open in browser: https://newyork.craigslist.org/search/cgg?format=rss&query=developer
   - Should show XML RSS feed
   - If 403/404, Craigslist may be rate-limiting

2. **Check Server Logs**
   Look for: `[craigslist]` in terminal output
   - Should show number of leads found
   - If errors, will show stack trace

3. **Verify xml2js Dependency**
   ```bash
   npm list xml2js
   ```
   Should show: `xml2js@0.6.2`

---

### If Dev.to Results Missing:

1. **Test API Directly**
   Open in browser: https://dev.to/api/articles?tag=hiring&per_page=5
   - Should show JSON with articles
   - If empty, Dev.to may have no recent hiring posts

2. **Check Server Logs**
   Look for: `[devto]` in terminal output

3. **Try Different Skills**
   - Dev.to is developer-focused
   - Try: "React", "Python", "JavaScript", "DevOps"

---

### If Quora Results Missing:

1. **Test Web Access**
   Open in browser: https://www.quora.com/search?q=hire+developer
   - Should show search results
   - If blocked, Cloudflare may be active

2. **Check Server Logs**
   Look for: `[quora]` in terminal output

3. **Note**: Quora scraping can be fragile
   - May be blocked by Cloudflare
   - May have rate limits
   - HTML structure may have changed

---

### If SearXNG/Social Platforms Missing:

1. **Check SearXNG Status**
   Open in browser: https://searxng-bgj26.onrender.com
   - Should show SearXNG homepage
   - If 404/503, Render free tier is sleeping

2. **Wait for Cold Start**
   - First request after 15min: ~30-50 seconds
   - Subsequent requests: Fast (<5s)
   - Try search again after 1 minute

3. **Check Environment Variable**
   In `.env`, verify:
   ```
   SEARXNG_URL="https://searxng-bgj26.onrender.com"
   ```

---

## 📊 Expected Performance

### First Search (Cold Start):

- **Time**: 20-40 seconds
- **Reason**: APIs warming up, SearXNG cold start
- **Sources**: 30-40 active
- **Leads**: 50-150

### Subsequent Searches:

- **Time**: 10-20 seconds
- **Reason**: Caching active, APIs warmed up
- **Sources**: 40-50 active
- **Leads**: 80-200

### Browser Console:

- Should see logs like:
  ```
  [reddit] 25 leads via pullpush+public-json
  [hn] 18 leads from Who's Hiring + broad search
  [craigslist] 5 leads from 4 cities
  [devto] 8 leads from hiring tags
  [quora] 3 leads from hiring questions
  [upwork] 12 leads from RSS + dorks
  [github] 15 leads from issues + hiring lists
  ```

---

## ✅ Success Checklist

After testing, verify:

- [ ] Home page loads without errors
- [ ] Discover page loads without errors
- [ ] Search form accepts input
- [ ] Results appear within 30 seconds
- [ ] At least 10 sources return results
- [ ] **Craigslist** results appear (for "graphic designer")
- [ ] **Dev.to** results appear (for "Python developer")
- [ ] **Quora** results appear (for "web developer")
- [ ] Lead details panel opens
- [ ] Lead details show complete information
- [ ] Filter controls work (platform, date, etc.)
- [ ] Sort controls work (relevance, date, engagement)
- [ ] No errors in browser console
- [ ] No errors in server terminal

---

## 🎯 Next Steps After Testing

### If All Tests Pass ✅

1. Document any issues or observations
2. Test on production: https://scrapivo-beta.vercel.app
3. Compare local vs. production results
4. Celebrate! 🎉

### If Tests Fail ❌

1. Note which platforms are failing
2. Check error messages in console/terminal
3. Share error logs for debugging
4. Verify environment variables
5. Check API rate limits

---

## 🚀 Advanced Testing (Optional)

### Performance Testing:

1. Run 5 different searches in succession
2. Measure response times
3. Check if caching improves speed
4. Verify no memory leaks (check Task Manager)

### Edge Cases:

1. Search with special characters: "C++ developer"
2. Search with very generic term: "developer"
3. Search with very specific term: "React Native iOS developer"
4. Search with non-English characters: "développeur"

### Network Conditions:

1. Slow down network in DevTools (F12 → Network → Throttling)
2. Test with "Slow 3G"
3. Verify timeouts work correctly
4. Check fallback behavior

---

## 📞 Server Info

- **Local URL**: http://localhost:8081/
- **Status**: ✅ RUNNING
- **Process ID**: Available in terminal
- **Stop Server**: Press `Ctrl+C` in terminal
- **Restart Server**: `npm run dev`
- **Build for Production**: `npm run build`
- **Deploy to Vercel**: `vercel --prod`

---

## 🎊 You're Ready to Test!

1. Open your browser
2. Go to: **http://localhost:8081/**
3. Navigate to "Discover"
4. Try the test scenarios above
5. Report back what you find!

**Good luck!** 🚀

_Server started: 2026-08-09_
_URL: http://localhost:8081/_
_Status: RUNNING ✅_
