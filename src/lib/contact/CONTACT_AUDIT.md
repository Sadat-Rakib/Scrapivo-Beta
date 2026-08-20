# Contact Intelligence — module map & gap matrix

Short audit for Phase B. Concepts only from public email-scraper patterns (bounded crawl, contact-page priority, regex+DOM); we do **not** vendor external repos.

## Existing modules

| Module                                                 | Role                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `harvest.server.ts`                                    | Bounded domain crawl (home/contact/about/team/footer), robots respect |
| `cheerio-email.server.ts`                              | Single-page Cheerio extract                                           |
| `email-patterns.ts`                                    | Pattern inference + candidate derivation                              |
| `verify-contact.server.ts`                             | Free verify waterfall (+ optional paid)                               |
| `discover-contacts.server.ts`                          | Orchestrator: harvest → people → derive → verify                      |
| `contact-finder.server.ts` / `people-finder.server.ts` | Broader person/page helpers                                           |
| `provenance.ts`                                        | Consent + provenance rows                                             |
| `contact.functions.ts`                                 | Discover enrich server fn (uses discoverContacts)                     |

## Useful external patterns (adapt, don't copy)

- Prefer `/contact`, `/about`, `/team` before deep crawl
- Normalize + classify role vs personal local-parts
- Dedupe case-insensitively; rank named > role > generic
- Cache per domain aggressively

## Gaps addressed by shared API

| Gap                                     | Fix                                       |
| --------------------------------------- | ----------------------------------------- |
| Local called harvest+cheerio separately | Route through `discoverContactsForDomain` |
| No shared domain cache across products  | In-memory TTL cache in shared entry       |
| Inconsistent preferred-email ranking    | Single ranker in shared layer             |
| Website provenance weak on Local        | `website_status` on LocalBusinessRow      |

## Explicitly out of scope here

LinkedIn cookie harvest, paid-only first paths, autosend outreach.
