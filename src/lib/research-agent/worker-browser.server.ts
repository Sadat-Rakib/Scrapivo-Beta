/**
 * WorkerBrowserAdapter — the AgentBrowser runtime backed by Scrapivo's private,
 * persistent Chromium worker (src/browser-worker). Consumers keep using the
 * AgentBrowser interface; nothing here imports Playwright.
 *
 * - One worker session per (owner, run); the same lane and profile are reused
 *   for every page of the run.
 * - Every call carries the run's AbortSignal; aborting closes the HTTP request
 *   and the worker stops the in-flight step (no read after an aborted
 *   navigation).
 * - While a person controls the session the worker refuses agent steps; the
 *   adapter yields (waits) until control returns or the run is cancelled.
 * - The mini-browser registry is updated from the SAME session, so the UI
 *   shows exactly what the agent is doing.
 */
import type {
  AgentBrowser,
  BrowserCloseOutcome,
  BrowserObservation,
  BrowserSession,
  ExtractionResult,
  ExtractionSchema,
  PageSnapshot,
  WaitCondition,
} from "./browser";
import { BrowserWorkerError, callBrowserWorker } from "./browser-worker-client.server";
import {
  scrapySessionAction,
  scrapySessionControl,
  scrapySessionFinished,
  scrapySessionScreenshotData,
  scrapySessionStarted,
} from "@/lib/search/scrapy-browser.server";

type WorkerSession = { id: string; ownerId: string; status: string; controller: "agent" | "human" };
type WorkerObservation = {
  sessionId: string;
  snapshotId: string;
  requestedUrl: string | null;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  headings: string[];
  links: Array<{ ref: string; name: string; url: string }>;
  elements: Array<{ ref: string; role: string; name: string }>;
  friction: string[];
  pageType: "error" | "unknown";
  observedAt: string;
};
type AdapterMeta = { runId?: string; ownerId?: string; visible?: boolean };

const TEXT_SLICE = 18_000;
const HUMAN_CONTROL_POLL_MS = 1_500;

export class WorkerBrowserAdapter implements AgentBrowser {
  private readonly snapshots = new Map<string, string>();
  private readonly ownerId: string;

  constructor(private readonly signal: AbortSignal | null = null, private readonly meta: AdapterMeta = {}) {
    this.ownerId = meta.ownerId?.trim() || "local";
  }

  /** Worker call that yields while a person controls the browser. */
  private async call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, timeoutMs = 45_000): Promise<T> {
    for (;;) {
      try {
        return await callBrowserWorker<T>(method, path, body ? { ownerId: this.ownerId, ...body } : undefined, { signal: this.signal, timeoutMs });
      } catch (error) {
        if (error instanceof BrowserWorkerError && error.code === "HUMAN_CONTROL" && !this.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, HUMAN_CONTROL_POLL_MS));
          continue;
        }
        if (error instanceof BrowserWorkerError && error.code === "CANCELLED") throw new Error("SEARCH_CANCELLED");
        throw error;
      }
    }
  }

  private query(path: string) {
    return `${path}${path.includes("?") ? "&" : "?"}ownerId=${encodeURIComponent(this.ownerId)}`;
  }

  private async capture(session: BrowserSession) {
    if (process.env.SCRAPIVO_BROWSER_SCREENSHOTS === "false" || this.signal?.aborted) return;
    try {
      const bytes = await callBrowserWorker<Buffer>("GET", this.query(`/browser/sessions/${session.id}/screenshot`), undefined, { signal: this.signal, timeoutMs: 12_000, binary: true });
      scrapySessionScreenshotData(session.id, bytes.toString("base64"));
      session.counters.screenshots += 1;
    } catch { /* a missing frame never blocks research */ }
  }

  private observation(session: BrowserSession, view: WorkerObservation, action: string): BrowserObservation {
    this.snapshots.set(session.id, view.snapshotId);
    const snapshot: PageSnapshot = {
      url: view.url,
      title: view.title,
      pageType: view.pageType,
      headings: view.headings ?? [],
      visibleRelevantText: (view.text ?? "").replace(/[ \t]+/g, " ").slice(0, TEXT_SLICE),
      interactiveElements: (view.elements ?? []).map((element) => ({ ref: element.ref, role: element.role, name: element.name, state: [] })),
      links: (view.links ?? []).map((link) => ({ ref: link.ref, name: link.name, url: link.url })),
      selectedFilters: [],
      loadingState: "complete",
      friction: (view.friction ?? []) as PageSnapshot["friction"],
    };
    session.lastSnapshot = snapshot;
    if (action !== "Observing") session.counters.pages += 1;
    scrapySessionAction(session.id, { action, url: view.url, title: view.title, newPage: action !== "Observing" });
    return { snapshot, action, expectedState: null, verified: true };
  }

  async createSession(options?: { id?: string; visible?: boolean; screenshotDirectory?: string; limits?: Partial<BrowserSession["limits"]> }): Promise<BrowserSession> {
    const visible = options?.visible ?? this.meta.visible ?? false;
    const created = await this.call<WorkerSession>("POST", "/browser/sessions", { runKey: this.meta.runId ?? options?.id ?? null, visible }, 60_000);
    scrapySessionStarted({ sessionId: created.id, runId: this.meta.runId ?? "", ownerId: this.meta.ownerId ?? "", adapter: "worker" });
    return {
      id: created.id,
      visible,
      createdAt: new Date().toISOString(),
      screenshotDirectory: "",
      counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 },
      limits: {
        actions: options?.limits?.actions ?? 400,
        pages: options?.limits?.pages ?? 120,
        scrolls: options?.limits?.scrolls ?? 20,
        screenshots: options?.limits?.screenshots ?? 60,
        reasoningCalls: 0,
      },
      lastSnapshot: null,
    };
  }

  async navigate(session: BrowserSession, url: string): Promise<BrowserObservation> {
    const view = await this.call<WorkerObservation>("POST", `/browser/sessions/${session.id}/observe`, { url });
    const observed = this.observation(session, view, "Navigating to result");
    await this.capture(session);
    return observed;
  }

  search(session: BrowserSession, query: string): Promise<BrowserObservation> {
    return this.navigate(session, `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  }

  async observe(session: BrowserSession): Promise<PageSnapshot> {
    const view = await this.call<WorkerObservation>("GET", this.query(`/browser/sessions/${session.id}/snapshot`));
    return this.observation(session, view, "Observing").snapshot;
  }

  private async act(session: BrowserSession, action: Record<string, unknown>, label: string): Promise<BrowserObservation> {
    const view = await this.call<WorkerObservation>("POST", `/browser/sessions/${session.id}/act`, { snapshotId: this.snapshots.get(session.id) ?? null, action });
    session.counters.actions += 1;
    const observed = this.observation(session, view, label);
    if (action.type === "click" || action.type === "back" || action.type === "forward") await this.capture(session);
    return observed;
  }

  click(session: BrowserSession, ref: string) { return this.act(session, { type: "click", ref }, "Clicking result"); }
  type(session: BrowserSession, ref: string, text: string) { return this.act(session, { type: "type", ref, text }, "Typing"); }
  select(session: BrowserSession, ref: string, value: string) { return this.act(session, { type: "select", ref, value }, "Selecting option"); }
  key(session: BrowserSession, key: string) { return this.act(session, { type: "key", key }, "Pressing key"); }
  back(session: BrowserSession) { return this.act(session, { type: "back" }, "Going back"); }
  forward(session: BrowserSession) { return this.act(session, { type: "forward" }, "Going forward"); }
  async scroll(session: BrowserSession, _target: string | null, direction: "up" | "down" | "left" | "right") {
    session.counters.scrolls += 1;
    return this.act(session, { type: "scroll", deltaY: direction === "up" ? -600 : direction === "down" ? 600 : 0 }, "Scrolling");
  }
  waitFor(session: BrowserSession, condition: WaitCondition) {
    return this.act(session, { type: "wait", ms: Math.min(condition.timeoutMs ?? 1_000, 5_000) }, "Waiting");
  }

  async extract(session: BrowserSession, schema: ExtractionSchema): Promise<ExtractionResult> {
    return this.call<ExtractionResult>("POST", `/browser/sessions/${session.id}/extract`, { fields: schema.fields });
  }

  async extractLinks(session: BrowserSession, selector: string, timeoutMs = 5000): Promise<PageSnapshot["links"]> {
    const result = await this.call<{ links: PageSnapshot["links"]; snapshotId: string }>("POST", `/browser/sessions/${session.id}/links`, { selector, timeoutMs });
    this.snapshots.set(session.id, result.snapshotId);
    return result.links;
  }

  async screenshot(session: BrowserSession): Promise<string> {
    await this.capture(session);
    return `worker:${session.id}`;
  }

  /**
   * Cleanup must run even after the run's signal aborted, so it never uses it.
   * A completed run keeps its browser open (retained) for viewing/takeover;
   * a cancelled run closes it. The caller's outcome wins: an aborted signal
   * alone may be a time budget, not a cancellation.
   */
  async close(session: BrowserSession, outcome?: BrowserCloseOutcome): Promise<void> {
    const cancelled = outcome ? outcome === "cancelled" : !!this.signal?.aborted;
    try {
      await callBrowserWorker("POST", `/browser/sessions/${session.id}/close`, { ownerId: this.ownerId, retain: !cancelled }, { timeoutMs: 15_000 });
      // Retaining leaves whoever controls the browser in control.
      scrapySessionControl(session.id, cancelled ? { retained: false, controller: "agent" } : { retained: true });
    } catch { /* worker idle sweeper reclaims it */ }
    scrapySessionFinished(session.id, cancelled ? "cancelled" : "completed");
  }
}
