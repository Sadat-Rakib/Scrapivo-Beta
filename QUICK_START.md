# Investor Directory - Quick Start Guide

## 🚀 Quick Access

**Live System**: http://localhost:8080/investors

---

## 📊 What You Have

```
╔════════════════════════════════════════════════════════════╗
║                  INVESTOR DIRECTORY v2.0                   ║
╠════════════════════════════════════════════════════════════╣
║  Total Entities:     3,492                                 ║
║  VC Firms:           509                                   ║
║  Individuals:        2,983                                 ║
║  ────────────────────────────────────────────────────────  ║
║  ✓ Smart Location Matching (City → Country → Region)      ║
║  ✓ Conditional Social Links (No broken links)             ║
║  ✓ Email Addresses (~50% coverage)                        ║
║  ✓ LinkedIn Profiles (100% coverage)                      ║
║  ✓ Twitter Profiles (~20% coverage)                       ║
║  ✓ Investment Categories (100% coverage)                  ║
╚════════════════════════════════════════════════════════════╝
```

---

## 🎯 Common Use Cases

### 1. Find AI Seed Investors in India

```
1. Go to: http://localhost:8080/investors
2. Type: "AI"
3. Set Stage: "Seed"
4. Set Location: "India"
5. Click: "Find investors"
```

### 2. Find All VC Firms in Europe

```
1. Go to: http://localhost:8080/investors
2. Set Location: "Europe"
3. Click: "Find investors"
4. Filter results by entity type (if needed)
```

### 3. Find Angel Investors (Small Checks)

```
1. Go to: http://localhost:8080/investors
2. Set Check Size: "Angel (<$100K)"
3. Click: "Find investors"
```

---

## 🔍 Search Examples

| What You Want        | How To Search                     |
| -------------------- | --------------------------------- |
| AI Investors         | Type: "AI"                        |
| Seed Stage           | Stage: "Seed"                     |
| Bangladesh Investors | Location: "Dhaka" or "Bangladesh" |
| SaaS Investors       | Type: "SaaS"                      |
| Growth Stage         | Check Size: "$5M+"                |
| Specific Firm        | Type firm name (e.g., "Sequoia")  |

---

## 🗺️ Location Magic

The system intelligently matches locations:

```
Search: "Dhaka"
  ↓
Matches: Bangladesh
  ↓
Also Matches: South Asia → Asia
  ↓
Result: All Bangladesh + Asian investors
```

**Try These**:

- "San Francisco" → USA + North America investors
- "Mumbai" → India + South Asia + Asia investors
- "London" → UK + Western Europe + Europe investors
- "Asia" → All investors in Asian countries

---

## 🎴 Understanding the Cards

### Individual Investor Card

```
┌─────────────────────────────────┐
│ Rebecca Redfield                │ ← Name
│ Senior Associate                │ ← Role
│ @ .406 Ventures                 │ ← Firm
│                                 │
│ 📧 Email  🔗 LinkedIn           │ ← Contact (conditional)
│ 💰 $2M - $5M                    │ ← Check size
│ 📍 United States                │ ← Location
│ 🎯 Pre-seed (AI)  Seed (Cloud)  │ ← Focus areas
└─────────────────────────────────┘
```

### VC Firm Card

```
┌─────────────────────────────────┐
│ 🏢 Firm  .406 Ventures          │ ← Firm badge
│ Venture Capital Firm            │
│                                 │
│ 🌐 Website  🔗 LinkedIn         │ ← Links (conditional)
│ 📍 HQ: Boston, USA              │ ← Headquarters
│ 👥 10 Team Members              │ ← Team size
│                                 │
│ 💰 $2M - $5M                    │ ← Check size
│ 🌍 USA                          │ ← Investment locations
│ 🎯 AI, Cloud, Cybersecurity     │ ← Focus areas
└─────────────────────────────────┘
```

---

## ⚡ Quick Commands

### Run Integration Tests

```bash
cd "c:\Users\mirsa\OneDrive\Desktop\Scrapivo (2)"
npx tsx scripts/test-investor-integration.ts
```

### Start Dev Server

```bash
npm run dev
# Then visit: http://localhost:8080/investors
```

### Check Data Statistics

```bash
npx tsx -e "
const data = require('./data/investors.json');
const investors = data.investors || [];
const firms = investors.filter(i => i.type === 'firm');
const individuals = investors.filter(i => i.type === 'individual');
console.log('Total:', investors.length);
console.log('Firms:', firms.length);
console.log('Individuals:', individuals.length);
"
```

---

## 📚 Documentation

| Document                       | Purpose                      |
| ------------------------------ | ---------------------------- |
| `QUICK_START.md`               | This file - Quick reference  |
| `INTEGRATION_SUMMARY.md`       | Complete project summary     |
| `INVESTOR_INTEGRATION_DOCS.md` | Full technical documentation |

---

## 🧪 Test It Now

### Test 1: Basic Search

1. Open: http://localhost:8080/investors
2. Type: "AI"
3. Click: "Find investors"
4. ✓ You should see AI-focused investors

### Test 2: Location Matching

1. Clear previous search
2. Location: "Dhaka"
3. Click: "Find investors"
4. ✓ You should see Bangladesh and Asian investors

### Test 3: Stage Filter

1. Clear previous search
2. Stage: "Seed"
3. Click: "Find investors"
4. ✓ You should see seed-stage investors

### Test 4: Social Links

1. Find any investor card
2. Look for: 📧 Email 🔗 LinkedIn 🐦 Twitter 🌐 Website
3. Click any button
4. ✓ Link should work (no broken links)

---

## ✅ Everything Works!

All systems operational:

- ✅ 3,492 searchable entities
- ✅ Smart location matching
- ✅ Conditional social links
- ✅ All filters working
- ✅ All tests passing (10/10)

---

## 🆘 Need Help?

**Common Issues**:

**Q: No results found**
A: Try broader search terms or remove filters

**Q: Location not working**
A: Make sure location is spelled correctly. Try country name instead of city.

**Q: Social link not showing**
A: The link doesn't exist in the data (this is correct behavior)

**Q: TypeScript errors**
A: Run: `npx tsc --noEmit --skipLibCheck`

---

## 🎉 You're Ready!

The investor directory is fully operational and ready to use.

**Next Steps**:

1. Try the test cases above
2. Explore different search combinations
3. Click on investor cards to see full details
4. Use social links to connect with investors

**For more details, see**:

- Full documentation: `INVESTOR_INTEGRATION_DOCS.md`
- Project summary: `INTEGRATION_SUMMARY.md`

---

_Happy Investor Hunting!_ 🚀
