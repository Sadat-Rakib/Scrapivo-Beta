/**
 * BrowserRuntime seam. Acquisition code depends on the AgentBrowser interface
 * only; this module picks the concrete runtime:
 *
 *   SCRAPIVO_BROWSER_ADAPTER = playwright (default, in-process legacy)
 *                            | cli        (agent-browser CLI, legacy)
 *                            | worker     (private persistent Chromium worker)
 *
 * During this pass `worker` falls back to the in-process Playwright runtime
 * when the worker is unconfigured or unreachable. The fallback is never
 * silent: `onRuntime` reports what was requested, what ran, and why.
 */
import type { AgentBrowser, BrowserCloseOutcome, BrowserObservation, BrowserSession, ExtractionSchema, PageSnapshot, WaitCondition } from "./browser";
import { requestedRuntime, type BrowserRuntimeName } from "./browser-worker-config.server";
import { BrowserWorkerError, browserWorkerConfigured } from "./browser-worker-client.server";
import { PlaywrightBrowserAdapter } from "./playwright-browser.server";
import { AgentBrowserCliAdapter } from "./agent-browser-cli.server";
import { WorkerBrowserAdapter } from "./worker-browser.server";

export type RuntimeInfo = { requested: BrowserRuntimeName; used: BrowserRuntimeName; reason?: string };
type Meta = { runId?: string; ownerId?: string; visible?: boolean; onRuntime?: (info: RuntimeInfo) => void };

const FALLBACK_CODES = new Set(["WORKER_UNCONFIGURED", "WORKER_UNAVAILABLE", "WORKER_TIMEOUT", "BROWSER_UNAVAILABLE", "SESSION_LIMIT", "PROFILE_LIMIT", "UNAUTHORIZED"]);

/** Worker first; the legacy runtime takes over only when the worker cannot start a session. */
export class WorkerWithFallback implements AgentBrowser {
  private active: AgentBrowser;
  constructor(private readonly worker: WorkerBrowserAdapter, private readonly legacy: () => AgentBrowser, private readonly report: (info: RuntimeInfo) => void) {
    this.active = worker;
  }
  async createSession(options?: Parameters<AgentBrowser["createSession"]>[0]): Promise<BrowserSession> {
    try {
      const session = await this.worker.createSession(options);
      this.report({ requested: "worker", used: "worker" });
      return session;
    } catch (error) {
      if (!(error instanceof BrowserWorkerError) || !FALLBACK_CODES.has(error.code)) throw error;
      this.report({ requested: "worker", used: "playwright", reason: error.code });
      this.active = this.legacy();
      return this.active.createSession(options);
    }
  }
  navigate(session: BrowserSession, url: string) { return this.active.navigate(session, url); }
  search(session: BrowserSession, query: string) { return this.active.search(session, query); }
  observe(session: BrowserSession) { return this.active.observe(session); }
  click(session: BrowserSession, ref: string) { return this.active.click(session, ref); }
  type(session: BrowserSession, ref: string, text: string) { return this.active.type(session, ref, text); }
  select(session: BrowserSession, ref: string, value: string) { return this.active.select(session, ref, value); }
  scroll(session: BrowserSession, target: string | null, direction: "up" | "down" | "left" | "right") { return this.active.scroll(session, target, direction); }
  waitFor(session: BrowserSession, condition: WaitCondition) { return this.active.waitFor(session, condition); }
  extract(session: BrowserSession, schema: ExtractionSchema) { return this.active.extract(session, schema); }
  async extractLinks(session: BrowserSession, selector: string, timeoutMs?: number): Promise<PageSnapshot["links"]> {
    return this.active.extractLinks ? this.active.extractLinks(session, selector, timeoutMs) : (await this.active.observe(session)).links;
  }
  key(session: BrowserSession, key: string): Promise<BrowserObservation> {
    if (!this.active.key) throw new Error("key action unsupported by this runtime");
    return this.active.key(session, key);
  }
  back(session: BrowserSession): Promise<BrowserObservation> {
    if (!this.active.back) throw new Error("back action unsupported by this runtime");
    return this.active.back(session);
  }
  forward(session: BrowserSession): Promise<BrowserObservation> {
    if (!this.active.forward) throw new Error("forward action unsupported by this runtime");
    return this.active.forward(session);
  }
  screenshot(session: BrowserSession) { return this.active.screenshot(session); }
  close(session: BrowserSession, outcome?: BrowserCloseOutcome) { return this.active.close(session, outcome); }
}

export function buildAgentBrowserRuntime(signal: AbortSignal | null, meta: Meta = {}): AgentBrowser {
  const requested = requestedRuntime();
  const report = (info: RuntimeInfo) => { try { meta.onRuntime?.(info); } catch { /* diagnostics only */ } };
  if (requested === "cli") { report({ requested, used: "cli" }); return new AgentBrowserCliAdapter(undefined, signal); }
  if (requested === "playwright") { report({ requested, used: "playwright" }); return new PlaywrightBrowserAdapter(signal, meta); }
  if (!browserWorkerConfigured()) {
    report({ requested, used: "playwright", reason: "WORKER_UNCONFIGURED" });
    return new PlaywrightBrowserAdapter(signal, meta);
  }
  return new WorkerWithFallback(new WorkerBrowserAdapter(signal, meta), () => new PlaywrightBrowserAdapter(signal, meta), report);
}
