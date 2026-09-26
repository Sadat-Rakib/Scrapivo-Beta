# SCHEMA + CATEGORY PROPOSALS — NEW S3 CSV COHORT (for approval — NO transform run)

Cohort: 67 CSVs at bucket root, ~0.93 GiB, **~1.83M rows**, 20 schema clusters in
7 semantic families. Profiled read-only (`tools/profile_s3_csvs.py`, streamed,
≤4000 value-sample rows/file; row counts exact). Detail per file:
`reports/csv_profiles/<slug>.json`. Index: `reports/CSV_DATASET_INVENTORY.*`.

Entity rollup: **person 58 files (~1.08M rows) | company 9 files (~755k rows:
8 crunchbase + 1 Lakta SaaS)**. One value-evidence override applied and recorded:
crunchbase `name` = organization names (heuristic first said person; corrected to
company 0.85 — see mapping JSON).

## Family A — Locked-spec Person (17 files, ~691k rows, 18 cols) → PERSON, universal mapping

Files: `Vanda Closer Data Master List of CXO 112924` (275k), `Vanda 105k Apollo
leads` (105k), `Contractors - data111112` (112k), 10 apollo-contacts-exports
(OK_ONLY / CATCH_ALL / deliverable splits), `Professional Services 47.5k`,
`staffing & recruiting 20.3k`, `trucking 15.6k`, `Coaches 1.6K`.
Schema is byte-identical to the locked Person spec — mapping is 1:1:

| canonical | source | transform | evidence |
|---|---|---|---|
| Name | First Name + Last Name | trim, collapse spaces | locked spec; values `Juan/Cruz` |
| Title | Title | trim, null-like→null | `Chief Technology Officer` |
| Company Name | Comp name | trim; suffix-normalize for matching only | `Osalim Agribusiness` |
| Website | Website | lowercase host, strip params | `http://www.osalim.com.br`, 0% missing |
| Email | Email | lowercase, RFC-shape check | `juanpfcruz@osalim.com.br`, 0% missing |
| Phone | Comp Phone ONLY | E.164-normalize | 9.2% missing (rep file) |
| Employees | Employees | range-parse else raw | 0.5% missing |
| Personal/Company LinkedIn | Pers/Comp Linkedin | URL-normalize, shape-check | 0.1%/0.7% missing |
| Facebook/Twitter | same | URL-normalize | 44.9%/63.4% missing |
| Country/Industry | same | trim; Country→ISO2 (raw kept if unmapped) | 0%/1.2% missing |
| Tools Used | Tech Used | split `,|;|/`, trim, dedupe | 1.7% missing |
| DROP | Phone (personal, 100% missing here), Keywords (8.1%), SEO Description (100%) | — | locked spec |

`Company` vs `Comp name` in THIS family: values identical per row (`Company Name for
Emails` = same string) → verified same concept; canonical uses Comp name.
Quality pre-read: email/website/linkedin near-complete → majority expected
sufficient under Person rule (score≥40 + Name + Company). Formal distribution at
transform-verification stage.

## Family B — Apollo full (18 files, ~54k rows, 80 cols) → PERSON + company-side extras

`americas/europe/asia/other_region_v2/v3_part1/v5`, `cleaned-1..5`. Core maps as
Family A (`First/Last Name, Title, Company, Email+Status, #Employees, Industry,
Keywords, Person/Company Linkedin, Website, Facebook/Twitter, City/State/Country,
Company geo, Company Phone→Phone, Technologies→Tools Used`; DROP personal phone
variants `First/Mobile/Home/Other/Work Direct` — personal-phone rule; DROP Keywords/SEO).
`Company Name for Emails` = same value as `Company` → same canonical field (evidence
recorded). Keep-as-extra (company/firmographic evidence, NOT canonical person):
`Seniority, Departments, Annual Revenue, Total/Latest Funding*, Last Raised At,
# Retail Locations, Apollo Contact/Account Id`. `Stage=Cold` constant → record as
`source_stage` provenance, not canonical.

## Family C — Apollo + campaign (5 files, ~224k rows, 66 cols: 1.csv–5.csv) → PERSON, same as B + engagement evidence

Adds `Email Sent/Open/Bounced, Replied, Demoed, Primary/Secondary/Tertiary Email(+Source),
Apollo IDs`. Proposal: canonical person as Family B; campaign columns preserved into
`source_engagement` evidence block (open/reply = candidate-signal provenance for the
future signal layer, NOT auto-verified signals). All `Intent/Client/CXplained/*`
columns 100% empty → documented empty, carried as null (schema-future-proofing, not dropped
silently). `6.csv` (32k rows, 30 cols, Email 44.1% missing) is the truncated sibling —
same mapping, lower expected sufficient-rate; flagged in quality stats.

## Family D — Apollo + MillionVerifier (4–5 files, ~25k rows, 49/48 cols) → PERSON, same as B + validity evidence

`americas/asia/europe/other_region_v6`, `cleaned-6`, `1-americas_region`,
`1-asia_region`(+80col MV variant), `1- europe_region`, `1-other_region` (plus
truncated splinters v3_part2/v4 with junk columns `asddas/asd/asdas/dsfsd/fdsfsd` —
garbage headers documented, ignored, never mapped).
Adds `overall_score, is_safe_to_send, is_valid_syntax, is_disposable,
is_role_account, mx_accepts_mail/records, can_connect_smtp, has_inbox_full,
is_catch_all, is_deliverable, is_disabled, is_spamtrap, is_free_email, status,
username, domain`. Proposal: feed DIRECTLY into quality components (email_pts
calibration: `is_deliverable×is_valid_syntax×mx_accepts_mail`; catch-all/disposable/
spamtrap → reduced email_pts per locked validity rule). `username/domain` =
derived email parts → not canonical, kept as evidence. Splinter files with
`fullname/firstname/lastname + Company/company` duplicates: `firstname+lastname`
verified same concept as First+Last Name (values match `fullname`); `company`
(lowercase) same values as `Company` → one canonical field each.

## Family E — Crunchbase orgs (8 files, ~707k rows, 41 cols) → COMPANY (override recorded)

`crunchbase_1m-1.1m … 2.8m-2.87m` (100k-row chunks). Canonical proposal:
`Company Name←name, Website←website/url` (both present, verify same host),
`Industry←categories` (multi-value split), `Employees←num_employees_enum`
/range-enum map, `Country/Location←locations`, `Description←short_description`,
`Founded←founded_on`, `Status←operating_status/ipo_status/company_type`,
`Funding{total,rounds,last_type,last_at}←funding_*`, `Contact{email←contact_email,
phone←phone_number}`, `Social{linkedin,facebook,twitter}`, `External IDs←permalink,
id, created_at` (provenance), `Investor flags←num_investors/exits/acquisitions/
investments/lead_*` (kept, mostly 94–99% null — investor-signal evidence, not drops).
Contactability: email 25.8% / phone 19.8% / linkedin 19.3% missing → mixed
sufficient-rate; thresholds proposed AFTER distribution (locked decision 2 — no preset).
`semrush_*, apptopia_*, hub_tags, growth/investor_insight_*` (46–99% null): kept as
evidence block, mapped only where populated. `founders` (80.3% missing): person-name
list → future person-record seeding, not canonical company contact.

## Family F — Lakta SaaS (1 file, 47,496 rows, 18 cols) → COMPANY

`company_name, website_url (+website_or_social_url/latka_url — verify same host),
industry, location (+country_page_url), revenue(+_alt — verify same metric/currency),
growth_percent, funding, founder_name, linkedin_url, twitter_url (81.7% missing),
logo_url, founder_latka_url, extra (16.4%)`. Proposal: canonical company + founder
linkage candidate (`founder_name + founder_latka_url` → person-seed queue, NOT
auto-created person records). `extra` needs value census before mapping — ambiguity
flagged for approval.

## Family G — Lending List (1 file, 34,564 rows, 19 cols) → PERSON (thin)

Locked-spec-shaped but Title/Website/Linkedin/Employees/Tech 100% missing; Email+Phone
0% missing; Country/Industry present; `Category` 100% missing. Expected: mostly
INCOMPLETE under Person rule (no Company? — `Comp name` 0% missing, so Name+Company
present; score hinges on email validity + phone → borderline). Proposal: transform
with same Family A mapping; threshold does the triage; nothing deleted either way.

## Category normalization (proposed, needs approval)

Industry values are free-text (`information technology & services`, `chemicals`…):
propose lowercase-trim dedupe → canonical taxonomy map persisted in mapping JSON;
unmapped kept raw + flagged (never coerced). Country → ISO2 with same fallback.
Crunchbase `categories` + `company_type`, Apollo `Departments/Seniority` kept raw
alongside normalized forms for audit.

## Unresolved ambiguities (your call)

1. `website` vs `url` (Crunchbase), `website_url` vs `website_or_social_url` vs
   `latka_url` (Lakta): same-host verification at transform; if differ → canonical
   takes corporate site, others to evidence. Approve?
2. `extra` (Lakta, 16.4%) + two unnamed trailing columns (`Healthcare`, 99.2% empty):
   inspect values at transform; map or document-drop. Approve approach?
3. Family C `Secondary/Tertiary Email`: fallback contact evidence (ordered), canonical
   Email stays primary. Approve?
4. Duplicate `apollo-contacts-export (5)…deliverable…(1)` vs no-`(1)` (identical 7510 KiB):
   exact duplicates suspected → dedupe-REPORT first (locked: report, don't delete). Approve?
5. Overlap across families (same Apollo contacts in region splits + cleaned-* + 1–6.csv):
   cross-file dedupe analysis AFTER per-file transform, report-only. Approve?

## STOP — approval required before: transform, quality distribution run, threshold
proposals for Company/Business/Investor, 200-row exports, any S3 writes.
