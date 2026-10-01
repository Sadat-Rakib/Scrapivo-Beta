/** Minimal serializable lead for progressive result streaming. */
import { presentActivityEvent } from "@/lib/search/activity-presenter";

export type StreamedLead = {
  key: string;
  entity_id: string;
  kind: string;
  title: string;
  url: string | null;
  website_url: string | null;
  profile_url: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  why_match: string | null;
  /** C10 honesty: a streamed row is provisional until the strict gate passed. */
  rowStatus?: "provisional" | "verified";
};

export type SearchBrowserProgressEvent = {
  id: number;
  action: string;
  source?: string;
  detail?: string;
  /** Optional quantitative payload: "Found N candidates", "4/15 researched". */
  count?: number | string;
  /** Progressive results: a lead that just verified mid-run. */
  row?: StreamedLead;
  at: string;
};

type ProgressRun = {
  ownerId: string;
  events: SearchBrowserProgressEvent[];
  updatedAt: number;
  done: boolean;
};

const runs = new Map<string, ProgressRun>();
const TTL_MS = 10 * 60_000;
const MAX_EVENTS = 80;
/** Streamed leads are results, not chatter: they outlive the activity cap. */
const MAX_ROW_EVENTS = 200;

/** Trim oldest activity first; lead rows are dropped only past their own cap. */
function trimEvents(events: SearchBrowserProgressEvent[]): SearchBrowserProgressEvent[] {
  const rows = events.filter((event) => event.row).length;
  const activity = events.length - rows;
  let dropActivity = Math.max(0, activity - MAX_EVENTS);
  let dropRows = Math.max(0, rows - MAX_ROW_EVENTS);
  if (!dropActivity && !dropRows) return events;
  return events.filter((event) => {
    if (event.row) return dropRows-- > 0 ? false : true;
    return dropActivity-- > 0 ? false : true;
  });
}

export function beginSearchBrowserProgress(runId: string, ownerId: string) {
  const now = Date.now();
  prune(now);
  runs.set(runId, { ownerId, events: [], updatedAt: now, done: false });
}

function prune(now: number) {
  for (const [id, run] of runs) if (now - run.updatedAt > TTL_MS) runs.delete(id);
}

export function publishSearchBrowserProgress(
  runId: string,
  ownerId: string,
  rawEvent: Omit<SearchBrowserProgressEvent, "id" | "at">,
) {
  // Privacy boundary: internal infra never reaches stored/user events.
  const event = presentActivityEvent(rawEvent);
  const now = Date.now();
  prune(now);
  const run = runs.get(runId) ?? { ownerId, events: [], updatedAt: now, done: false };
  if (run.ownerId !== ownerId || run.done) return;
  run.events.push({ ...event, id: (run.events.at(-1)?.id ?? 0) + 1, at: new Date(now).toISOString() });
  run.events = trimEvents(run.events);
  run.updatedAt = now;
  runs.set(runId, run);
}

export function finishSearchBrowserProgress(runId: string, ownerId: string) {
  const run = runs.get(runId);
  if (!run || run.ownerId !== ownerId) return;
  run.done = true;
  run.updatedAt = Date.now();
}

export function readSearchBrowserProgress(runId: string, ownerId: string, after: number) {
  const now = Date.now();
  prune(now);
  const run = runs.get(runId);
  if (!run || run.ownerId !== ownerId) return { events: [], done: false };
  run.updatedAt = now;
  return { events: run.events.filter((event) => event.id > after), done: run.done };
}
