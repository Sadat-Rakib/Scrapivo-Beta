export type SearchBrowserProgressEvent = {
  id: number;
  action: string;
  source?: string;
  detail?: string;
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
const MAX_EVENTS = 40;

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
  event: Omit<SearchBrowserProgressEvent, "id" | "at">,
) {
  const now = Date.now();
  prune(now);
  const run = runs.get(runId) ?? { ownerId, events: [], updatedAt: now, done: false };
  if (run.ownerId !== ownerId || run.done) return;
  run.events.push({ ...event, id: (run.events.at(-1)?.id ?? 0) + 1, at: new Date(now).toISOString() });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
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
