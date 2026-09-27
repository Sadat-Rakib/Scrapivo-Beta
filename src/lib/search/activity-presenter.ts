/**
 * Public activity presentation — the privacy boundary between Scrapy's
 * internals and what the user sees.
 *
 * Internal event may know about SearXNG, DuckDuckGo, parquet tiers, provider
 * ladders, adapters. The USER sees product concepts only: "Checking saved
 * leads", "Searching the web", "Opening result", "Resolving company
 * website". Any event text that would leak infrastructure is dropped.
 */

const SOURCE_LABELS: Record<string, string> = {
  database: "saved leads",
  "s3-parquet": "saved leads",
  "pg-index": "saved leads",
  "hot-index": "saved leads",
  "live-web": "online leads",
  "live-osm": "public maps",
  "live-jobs": "job boards",
  osm: "public maps",
  web: "the web",
  searxng: "the web",
  duckduckgo: "the web",
  jobs: "job boards",
  browser: "online leads",
  enrich: "public contacts",
  verification: "verification",
};

const ACTION_LABELS: Array<[RegExp, string]> = [
  [/^stored search complete$/i, "Checked saved leads"],
  [/^searching candidates$/i, "Searching the web"],
  [/^searching the web$/i, "Searching the web"],
  [/^found candidate sources$/i, "Found possible leads"],
  [/^found search results$/i, "Found possible leads"],
  [/^found web candidates$/i, "Found possible leads"],
  [/^live discovery complete$/i, "Checked online leads"],
  [/^read page$/i, "Reading page"],
  [/^clicking result$/i, "Opening result"],
  [/^navigating to result$/i, "Opening result"],
  [/^opened result$/i, "Reading page"],
  [/^extracted candidates$/i, "Found possible leads"],
  [/^checking possible official domain$/i, "Resolving company website"],
  [/^resolving official website$/i, "Resolving company website"],
  [/^official destination resolved$/i, "Found company website"],
  [/^checking contact page$/i, "Checking public contacts"],
  [/^enrichment pass complete$/i, "Checked public contacts"],
  [/^leads verified$/i, "Verified leads"],
  [/^candidate verified$/i, "Lead verified"],
  [/^leads qualified$/i, "Verified matches ready"],
  [/^found public contact$/i, "Found public contact"],
];

const INTERNAL_RE =
  /searxng|duckduckgo|provider|adapter|parquet|postgres|supabase|registry-identity|browser-live|pg-index|hot-index|overpass|resilientfetch|json-?ld/i;

export type PublicActivityEvent = {
  action: string;
  source?: string;
  detail?: string;
  count?: number | string;
};

/** Map one internal event to its user-safe presentation. */
export function presentActivityEvent<T extends { action: string; source?: string; detail?: string; count?: number | string }>(
  event: T,
): PublicActivityEvent {
  let action = event.action ?? "Working";
  for (const [re, label] of ACTION_LABELS) {
    if (re.test(action)) {
      action = label;
      break;
    }
  }
  const rawSource = (event.source ?? "").toLowerCase();
  let source: string | undefined = SOURCE_LABELS[rawSource];
  let detail = event.detail ?? undefined;
  if (INTERNAL_RE.test(action)) action = "Working";
  if (detail && INTERNAL_RE.test(detail)) detail = undefined;
  if (source && INTERNAL_RE.test(source)) source = undefined;
  return { action, source, detail, count: event.count };
}
