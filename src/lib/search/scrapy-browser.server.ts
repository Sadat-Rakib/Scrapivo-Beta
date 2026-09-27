/**
 * Scrapy browser session registry — state for the visible research browser.
 *
 * One search run owns one BrowserSession; the registry tracks what the user
 * sees in the Scrapy mini-browser: current page, current action, pages
 * visited, and the latest screenshot path. In-memory, process-local,
 * owner-scoped reads (same convention as search-browser-progress).
 */

export type ScrapySessionStatus =
  | "starting"
  | "active"
  | "paused"
  | "user_control"
  | "completed"
  | "cancelled"
  | "failed";

export type ScrapyBrowserState = {
  sessionId: string;
  runId: string;
  ownerId: string;
  adapter: "playwright" | "cli";
  status: ScrapySessionStatus;
  currentUrl: string;
  currentTitle: string;
  currentAction: string;
  pagesVisited: number;
  actionCount: number;
  startedAt: number;
  lastActivityAt: number;
  lastScreenshotPath: string | null;
  lastScreenshotAt: number | null;
};

type Registry = {
  states: Map<string, ScrapyBrowserState>;
  /** runId → latest sessionId (runs can restart sessions after failures). */
  byRun: Map<string, string>;
};

const registry: Registry = { states: new Map(), byRun: new Map() };
const TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 40;

function prune(now: number): void {
  for (const [id, state] of registry.states) {
    if (now - state.lastActivityAt > TTL_MS) {
      registry.states.delete(id);
    }
  }
}

function keyFor(sessionId: string): string {
  return sessionId;
}

export function scrapySessionStarted(args: {
  sessionId: string;
  runId: string;
  ownerId: string;
  adapter: "playwright" | "cli";
}): void {
  const now = Date.now();
  prune(now);
  if (registry.states.size >= MAX_SESSIONS) {
    const oldest = [...registry.states.values()].sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
    if (oldest) registry.states.delete(keyFor(oldest.sessionId));
  }
  registry.states.set(keyFor(args.sessionId), {
    sessionId: args.sessionId,
    runId: args.runId,
    ownerId: args.ownerId,
    adapter: args.adapter,
    status: "active",
    currentUrl: "",
    currentTitle: "",
    currentAction: "Starting browser",
    pagesVisited: 0,
    actionCount: 0,
    startedAt: now,
    lastActivityAt: now,
    lastScreenshotPath: null,
    lastScreenshotAt: null,
  });
  registry.byRun.set(args.runId, args.sessionId);
}

export function scrapySessionAction(
  sessionId: string,
  update: {
    action?: string;
    url?: string;
    title?: string;
    newPage?: boolean;
    status?: ScrapySessionStatus;
  },
): void {
  const state = registry.states.get(keyFor(sessionId));
  if (!state) return;
  const now = Date.now();
  if (update.action) state.currentAction = update.action;
  if (update.url !== undefined) state.currentUrl = update.url;
  if (update.title !== undefined) state.currentTitle = update.title;
  if (update.newPage) state.pagesVisited += 1;
  if (update.status) state.status = update.status;
  state.actionCount += 1;
  state.lastActivityAt = now;
}

export function scrapySessionScreenshot(sessionId: string, filePath: string): void {
  const state = registry.states.get(keyFor(sessionId));
  if (!state) return;
  state.lastScreenshotPath = filePath;
  state.lastScreenshotAt = Date.now();
  state.lastActivityAt = Date.now();
}

export function scrapySessionFinished(
  sessionId: string,
  status: Extract<ScrapySessionStatus, "completed" | "cancelled" | "failed">,
): void {
  const state = registry.states.get(keyFor(sessionId));
  if (!state) return;
  state.status = status;
  state.lastActivityAt = Date.now();
}

/** Latest session for a run (newest activity wins), owner-scoped. */
export function readScrapyBrowserState(
  runId: string,
  ownerId: string,
): ScrapyBrowserState | null {
  prune(Date.now());
  const sessionId = registry.byRun.get(runId);
  const state = sessionId ? registry.states.get(keyFor(sessionId)) : null;
  if (!state || state.ownerId !== ownerId) return null;
  return { ...state };
}

/** Associate a run with an existing session (run restart / reattach). */
export function scrapySessionBindRun(sessionId: string, runId: string): void {
  if (registry.states.has(keyFor(sessionId))) registry.byRun.set(runId, sessionId);
}
