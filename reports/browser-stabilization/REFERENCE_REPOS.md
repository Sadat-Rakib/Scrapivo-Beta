# Reference Repos: "AgentReach" and "Scout"

Research date: 2026-10-01. Method: GitHub/web search first (no guessed URLs); metadata via
GitHub API; architecture from READMEs on default branches. Context: Scrapivo is a lead
research system (Playwright, SERP, HTTP-first fetch, JSON-LD extraction, contact-page
traversal, human takeover for CAPTCHA/login). Mission: legitimate access to PUBLIC data.

## AgentReach — candidates found

| Repo | Stars | Lang | License | Verdict |
|---|---|---|---|---|
| Panniantong/Agent-Reach | ~87,300 | Python | MIT | LIKELY INTENDED |
| bojieli/agentreach | ~166 | Go | MIT | Namesake — SSH remote-agent proxy, not internet reading. Not intended |
| katsushi2441/kagentreach | small | — | — | Namesake — trend-research engine. Not intended |

### Panniantong/Agent-Reach (likely intended)
- URL: https://github.com/Panniantong/Agent-Reach
- Stars ~87.3k; Python 3.10+; MIT; HEAD of `main`: `a19a171fa980a0785849596492e0af4db800c82f` (2026-09)
- Description: "Give your AI agent eyes to see the entire internet" — a capability layer
  (tool selection, install, health checks, routing) above per-platform reading tools.
- Architecture:
  - `channels/` Python module per platform; each holds an ORDERED list of primary +
    fallback backends (e.g. twitter: twitter-cli -> OpenCLI -> bird). Blocked routes are
    swapped by reordering, not rewrites (yt-dlp retired for Bilibili after 412 blocks).
  - `agent-reach install / doctor / uninstall` CLI; `doctor` probes per-channel health
    (real functionality probed, not just binary existence).
  - Registers a SKILL.md into the agent's skills dir so the agent learns which command
    to call; MCP used selectively (Exa search, LinkedIn).
- Public-data acquisition (zero-config tier): Jina Reader (`r.jina.ai`) for web pages,
  yt-dlp for YouTube subtitles/search, feedparser for RSS, `gh` CLI for public GitHub,
  Exa MCP search (free, no key), bili-cli. A second tier requires user's own
  login/cookies (Twitter, Reddit, LinkedIn, XHS) — see unsafe section.
- Browser/tool interfaces: OpenCLI reuses the user's existing desktop Chrome session;
  no injection of logins — manual Cookie-Editor exports only.
- Useful for Scrapivo: channel abstraction with fallback ordering; `doctor`-style health
  probes per source; SKILL.md/tool self-description for agents; per-channel credential
  scoping; proxy optional (~$1/mo server deployments only).
- UNSAFE / inapplicable (flagged): scripted access via user login cookies on
  cookie-gated platforms (Twitter, XHS, LinkedIn) is ToS-violating scraping of gated
  data and risks account bans (README itself warns and suggests burner accounts — do
  NOT adopt). Scrapivo should keep these sources behind human takeover only.
- Integration value: ADOPT IDEAS, not code (it is a CLI/installer layer, not a library).
  MIT — fully compatible with MIT/Apache-2.0 if code were reused.

## Scout — candidates found

| Repo | Stars | Lang | License | Verdict |
|---|---|---|---|---|
| agno-agi/scout | ~736 | Python | Apache-2.0 | Strong candidate — "Company Brain" lead/CRM research agent |
| cortex-works/cortex-scout | ~71 | Rust | MIT | Strong candidate — web extraction + browser automation + HITL |
| Scout-AI-Labs/scout-mcp | ~1 | JavaScript | MIT | Candidate — thin MCP client for a hosted search/scrape API |
| firecrawl/open-scouts | small | Python | — | Minor — monitoring platform, less aligned |

Ambiguity note: the PRD says only "Scout". Given Scrapivo's profile (lead research +
Playwright + human takeover), BOTH agno-agi/scout (company/contact intelligence, CRM)
and cortex-works/cortex-scout (extraction engine, HITL auth, replaces Playwright-style
flows) fit; Scout-AI-Labs/scout-mcp is thematically aligned (SERP/scrape/extract) but
tiny. Recorded all three; no single unambiguous match.

### agno-agi/scout ("Open Source Company Brain")
- URL: https://github.com/agno-agi/scout
- Stars ~736; Python; Apache-2.0; HEAD of `main`: `088a8ebb3d0e4764e3f30937345ea3753d5990a8` (2026-07)
- Architecture: single agent + context providers. Each provider (Web, Workspace,
  Database/CRM, Wiki, Slack, GDrive, MCP servers) exposes two NL tools —
  `query_<source>` / `update_<source>` — while a SUB-AGENT behind each provider owns
  source quirks (pagination, lookups), so the main agent sees one clean tool.
- Research model: "navigation over ingestion" — explicitly rejects chunk-embed-vector-DB;
  navigates live sources like a coding agent (`ls`, `grep`, open, follow imports).
  Web backend: Parallel SDK/API (search/research API, not raw scraping) when keyed.
- Storage: Postgres CRM (contacts, projects, notes, follow-ups) with agentic SQL and
  schema-on-demand; Git-backed wiki with audit trail; Docker/Railway deploy.
- Contact discovery: incidental/event-driven (person extracted from a message -> CRM,
  linked to wiki). No email-finding/enrichment APIs, no scraping of gated data.
- Useful for Scrapivo: provider pattern for structured public-data adapters
  (`query_serp`, `query_jsonld`, `query_contact_page`); sub-agent-per-source to keep
  extraction quirks out of the orchestrator; CRM write path as a first-class tool;
  navigation-over-embeddings matches Scrapivo's HTTP-first philosophy.
- Unsafe: nothing material. Apache-2.0 — compatible with MIT/Apache-2.0 (keep NOTICE).

### cortex-works/cortex-scout
- URL: https://github.com/cortex-works/cortex-scout
- Stars ~71; Rust; MIT; HEAD of `main`: `34ae735ffc60c5418b8a7ca1c4f7da09292b809f` (v3.3.7, 2026-09)
- Architecture: self-hostable Rust binary exposing tools over MCP stdio + optional HTTP
  server; outputs structured for LLM consumption; LanceDB-backed `memory_search` of
  research history (skip live fetch at semantic similarity >= 0.60).
- Search: multi-engine (google, bing, ddg, brave) with merge/dedup, health-based
  rotation, per-engine stagger, cross-process shared cache (300s TTL); community
  expansion (Reddit/HN) when results are thin.
- Extraction ladder: native retrieval -> Chromium CDP rendering -> stateful E2E -> HITL.
- Browser tooling: `scout_browser_automate` — one declarative `steps` array (navigate,
  locate, assert, tabs, screenshots, route mock, console/network capture, storage CRUD)
  over a stateful CDP engine; persistent profile keeps cookies across calls.
- HITL: `hitl_web_fetch(auth_mode="challenge"|"auth")` and `scout_agent_profile_auth`
  open a VISIBLE browser so a human solves CAPTCHA/OAuth once; cookies then persist.
- Useful for Scrapivo: the fallback ladder mirrors Scrapivo's HTTP-first -> browser ->
  human-takeover design and validates it; declarative step arrays cut agent
  turns/tokens vs raw Playwright loops; search merge/dedup + shared TTL cache;
  `extract_fields` tool shape (page -> structured vs. objective); memory dedup of
  already-researched targets.
- UNSAFE / inapplicable (flagged): topics include `anti-bot-bypass`, `stealth`, proxy
  rotation (`IP_LIST_PATH`, `proxy_control grab`), host-level throttle/jitter tuning,
  and evidence artifacts against LinkedIn/Ticketmaster/Airbnb/Amazon protection stacks.
  The "human solves CAPTCHA once, then silent automation continues" pattern is CAPTCHA
  circumvention by proxy — Scrapivo must only use the visible-session handoff for
  SITES THE OPERATOR IS ENTITLED TO ACCESS and keep every protected page on human
  control, not silent automation. Do not adopt stealth/proxy-rotation modules.
- Integration value: ADOPT IDEAS (ladder, tool shapes, caching). Rust binary is not a
  drop-in for a Playwright/Python stack. MIT — compatible if snippets were reused.

### Scout-AI-Labs/scout-mcp (secondary)
- URL: https://github.com/Scout-AI-Labs/scout-mcp — 1 star, JavaScript, MIT
- HEAD of `main`: `056b1024da88d6c47c1f35a451a894f23e561065` ("zero-dependency,
  hand-rolled MCP server")
- 8 tools (`scout_search` w/ deep mode, `scout_scrape`->Markdown, `scout_extract`
  vs. an objective, `scout_crawl` bounded, `scout_screenshot`, `scout_company`,
  `scout_answer`, `scout_find_all`) backed by its own hosted API (`usescout.sh`, API
  key) — a client for a paid service, not an open acquisition mechanism.
- Useful: tool-granularity model (search vs scrape vs extract vs answer as separate
  tools); bounded-crawl parameter. No caching/rate-limit docs. MIT.

## License compatibility summary
All researched repos are MIT or Apache-2.0 — both compatible with MIT/Apache-2.0
products (Apache-2.0 requires preserving NOTICE). No GPL encountered, so code reuse is
permissible, though only cortex-scout (Rust) and Agent-Reach (CLI layer) even contain
directly reusable code; the rest of the value is architectural.

## Recommended adoption — top 5 ideas for Scrapivo
1. **Source-routing with ordered primary/fallback backends + health probes.**
   From Agent-Reach (MIT): every public-data source is a "channel" with a ranked
   backend list (HTTP-first -> JSON-LD -> contact-page traversal -> browser) and a
   `doctor`-style probe that verifies the backend actually works, so a blocked route is
   demoted by reordering rather than code changes.
2. **Progressive extraction ladder ending in human takeover.**
   From cortex-scout (MIT): native retrieval -> headless render -> HITL. Matches
   Scrapivo's existing design; adopt the explicit ladder contract per source and the
   `hitl_web_fetch(auth_mode=...)` idea of a visible-session handoff — but for
   entitled-access pages only; keep CAPTCHA/login pages permanently under human control.
3. **Provider/sub-agent split with `query_<source>` / `update_<source>` tool pairs.**
   From agno-agi/scout (Apache-2.0): a sub-agent per source adapter owns quirks
   (SERP paging, JSON-LD dialects, contact-page variants); the orchestrator sees clean
   tools, and writes (found contacts) go through one dedicated CRM write path.
4. **Declarative step-array browser tool + shared cache.**
   From cortex-scout (MIT): replace ad-hoc Playwright scripting with one tool taking a
   `steps` array (navigate/locate/extract/assert) to cut tokens and turns; add a
   cross-process TTL cache (~300s) and multi-engine SERP merge/dedup with health-based
   rotation; add semantic memory so already-researched leads are not re-fetched.
5. **Skill/tool self-registration for the agent runtime.**
   From Agent-Reach (MIT): ship a SKILL.md-style manifest the agent reads so it learns
   which Scrapivo command/tool to call per scenario (and its public-data-only policy)
   without per-prompt instruction; keep credentials local, scoped per channel, never
   uploaded — mirroring Agent-Reach's 600-perm local config pattern.
