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
  adapter: "playwright" | "cli" | "worker";
  status: ScrapySessionStatus;
  /** Worker sessions only: who drives the real browser right now. */
  controller: "agent" | "human";
  /** Worker sessions only: kept open after the run for viewing/takeover. */
  retained: boolean;
  /** Latest frame captured in memory (worker runtime). */
  lastScreenshotData: string | null;
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
  adapter: "playwright" | "cli" | "worker";
}): void {
  const now = Date.now();
  prune(now);
  // The same worker lane re-used by the next branch of one run: it is active
  // again, but a person who took control keeps it (and the frame they see).
  const previous = registry.states.get(keyFor(args.sessionId));
  if (previous && previous.ownerId === args.ownerId && previous.adapter === args.adapter) {
    previous.runId = args.runId;
    previous.retained = false;
    previous.status = previous.controller === "human" ? "user_control" : "active";
    previous.lastActivityAt = now;
    registry.byRun.set(args.runId, args.sessionId);
    return;
  }
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
    controller: "agent",
    retained: false,
    lastScreenshotData: null,
  });
  registry.byRun.set(args.runId, args.sessionId);
}

/** In-memory frame (base64 JPEG) for runtimes that do not write files. */
export function scrapySessionScreenshotData(sessionId: string, base64Jpeg: string): void {
  const state = registry.states.get(keyFor(sessionId));
  if (!state) return;
  state.lastScreenshotData = base64Jpeg.length < 1_200_000 ? base64Jpeg : null;
  state.lastScreenshotAt = Date.now();
  state.lastActivityAt = Date.now();
}

/** Worker sessions: record who controls the browser and whether it is retained. */
export function scrapySessionControl(sessionId: string, update: { controller?: "agent" | "human"; retained?: boolean }): void {
  const state = registry.states.get(keyFor(sessionId));
  if (!state) return;
  if (update.controller) {
    state.controller = update.controller;
    state.status = update.controller === "human" ? "user_control" : state.retained ? "completed" : "active";
  }
  if (update.retained !== undefined) state.retained = update.retained;
  state.lastActivityAt = Date.now();
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
