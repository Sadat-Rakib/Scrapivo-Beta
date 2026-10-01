# Local-business path + website status (Task 9)

Query: "plumbers in Camrose, Alberta without a website, with phone numbers". Product core, worker runtime, headed, local no-persist (run `camrose1`, 168 s).

## Understanding
`category=plumber, location=Camrose (geo:city:camrose, CA), opportunity=no_website, required_field=phone`. Before the world gazetteer (Task 12) the place was the unknown string "Camrose Alberta".

## Runtime
- Stored records: the Canada extract returned 2 exact Camrose plumbers; the browser added candidates from a DuckDuckGo results page (6 remembered after dedupe and target checks).
- Exact-name website checks ran through the browser: DuckDuckGo raised a CAPTCHA mid-run (`blocked`, skipped for the rest of the run), Bing answered. The self-hosted structured search index was unreachable (environment: Docker is not running).
- Qualification: 6 complete candidates, 0 qualified. 2 have an observed website (`CLAIM_PARAMETER_MISMATCH`: a website contradicts the requested absence). 4 have no website on record but absence was not verified in the time and search budget (`NO_CLAIM_EVIDENCE`).
- Outcome `NO_QUALIFIED_RESULTS`. The ledger accounts for all 6 (`rejected`, `unaccounted: 0`). No business was labelled "no website" on the strength of a missing URL.

## Website status (`src/lib/search/website-status.ts`)
Pure `websiteStatus(row)`: `has_website`, `unreachable`, `no_website_verified` (only with a subject-bound `no_website` claim, and it carries the proof excerpt), `no_website_on_record` ("No website on record (not verified)"). A legacy `website_status: "verified_no_website"` stamped from a missing URL is not treated as proof. Shown as a chip on the local-business card and a "Website" row in the detail panel. Tests: `src/lib/search/__tests__/website-status.test.ts`.

## Limitation
Verifying website absence needs a structured source plus two exact-name web checks per business. With the search index down and one engine blocked, the browser search budget covers only a few candidates per run, so this query honestly returns zero here. With SearXNG running, exact checks do not spend browser searches.
