# AUM Repair Log — M1

`data/investors_merged.json` shipped 16 investor records with the magnitude
suffix stripped from `aum` (`$293`, `$61`, `$1` …). Every value below was
re-researched on 2026-08-22 and written back with its source; four records had
**no credible published AUM** and the misleading unit-less value was removed
rather than guessed.

## Researched replacements (12)

| Firm | Was | Now | Source |
|---|---|---|---|
| Adams Street Partners | `$61` | `$76B` | adamsstreetpartners.com — "$76bn Assets Under Management", as of Jun 30, 2026 |
| Baillie Gifford | `$293` | `$360B` | en.wikipedia.org/wiki/Baillie_Gifford — £286.3B (2025), ≈$360B |
| Centurium Capital | `$7` | `$6.2B` | Centurium 2022 ESG report (Dec 2022) via en.wikipedia.org/wiki/Centurium_Capital |
| Altos Ventures | `$10` | `$5.4B` | SEC Form ADV filed Jul 7, 2026 ($5,448,790,139 discretionary) via whalewisdom.com/filer/altos-ventures-management-inc |
| Apax Digital | `$2` | `$2.75B` | apax.com press release — Digital Fund II closed at $1.75bn hard cap (Sep 2021) + Digital Fund I $1.0bn |
| Apis Partners | `$2` | `$2.3B` | apis.pe homepage stat block — "$2.3 billion assets under management" |
| AT Capital Group | `$2` | `$2.1B` | atcapital.com.sg homepage — "2.1 billion AUM" |
| Avataar Ventures | `$1` | `$1B` | avataar.vc homepage stats block — "$1B Assets Under Management" |
| Chiratae Ventures | `$1` | `$1.3B` | chiratae.com/about-us — "$1.3 Billion AUM"; Wikipedia corroborates $1.28B (2024) |
| Amino Capital | `$1` | `$1B` | aminocapital.com — "over $1 billion in capital under management" |
| Ally Bridge Group | `$1` | `$2.5B` | SEC S-1 (ABG Acquisition Corp. I, Feb 2021): "manages or advises over $2.5 billion in healthcare assets" — most recent public figure; firm site publishes none |
| Anicut Capital | `$3` | `$510M` | thehindubusinessline.com (Dec 2025) — total AUM ₹4,500 crore (~US$510M) after GAF-IV close |

## Removed (no credible published AUM — unit-less value dropped)

| Firm | Removed value | Rationale |
|---|---|---|
| Berggruen Holdings | `$2` | No current published AUM; only a dated 2011 figure (>€1.5B holdings, Wikipedia/LA Times). Family office discloses per-deal cap, not AUM. |
| Aglaia Family Office | `$5` | Multi-family office (Singapore); publishes no AUM anywhere. |
| Burman Family Holdings | `$1` | Publishes "US $500M invested over twenty years" (deployed capital, not AUM); third-party "~$500M" figures derive from it. Corrupted `$1` matched nothing verifiable. |
| Abies Ventures | `$10` | Discloses fund sizes only (Fund II ¥8B ≈ US$53M, May 2026 release); aggregate AUM never stated. |

Post-repair state: **0 unit-less values remain; 29 records carry an AUM**
(was 33, minus 4 removals).
