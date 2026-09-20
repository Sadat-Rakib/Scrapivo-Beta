import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  AgentBrowser,
  BrowserElement,
  BrowserObservation,
  BrowserSession,
  ExtractionResult,
  ExtractionSchema,
  PageSnapshot,
  WaitCondition,
} from "./browser";

type CommandRunner = (args: string[], signal?: AbortSignal | null) => Promise<string>;

type CliEnvelope = {
  success: boolean;
  data?: Record<string, unknown> | null;
  error?: string | null;
};

function executablePath(): string {
  if (process.env.AGENT_BROWSER_BIN?.trim()) return process.env.AGENT_BROWSER_BIN.trim();
  const suffix = process.platform === "win32" ? "agent-browser-win32-x64.exe" :
    process.platform === "darwin"
      ? `agent-browser-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`
      : `agent-browser-linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
  return path.resolve(process.cwd(), "node_modules", "agent-browser", "bin", suffix);
}

function defaultRunner(args: string[], signal?: AbortSignal | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executablePath(),
      args,
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30_000, killSignal: "SIGTERM" },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve(stdout.trim());
      },
    );
    const abort = () => {
      child.kill();
      reject(new Error("SEARCH_CANCELLED"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function parse(output: string): CliEnvelope {
  const line = output.split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(line) as CliEnvelope;
  } catch {
    throw new Error(`agent-browser returned non-JSON output: ${line.slice(0, 300)}`);
  }
  if (!envelope.success) throw new Error(envelope.error || "agent-browser command failed");
  return envelope;
}

function classifyPage(text: string, url: string): PageSnapshot["pageType"] {
  if (/captcha|access denied|forbidden|not found|server error/i.test(text)) return "error";
  if (/search|results? for|result count/i.test(text) || /[?&]q=/.test(url)) return "search_results";
  if (/\b(form|textbox|combobox|submit)\b/i.test(text)) return "form";
  if (/\b(directory|listings?)\b/i.test(text)) return "directory";
  if (/\b(feed|posts?|timeline)\b/i.test(text)) return "feed";
  if (/\b(about|contact|company|business|profile)\b/i.test(text)) return "entity_detail";
  return "unknown";
}

function friction(text: string): PageSnapshot["friction"] {
  const found: PageSnapshot["friction"] = [];
  if (/captcha|verify you are human|challenge-platform/i.test(text)) found.push("CAPTCHA");
  if (/sign in|log in to continue|authentication required/i.test(text)) found.push("LOGIN_WALL");
  if (/too many requests|rate limit/i.test(text)) found.push("RATE_LIMIT");
  if (/access denied|request blocked|forbidden/i.test(text)) found.push("ACCESS_BLOCK");
  if (/cookie preferences|accept cookies/i.test(text)) found.push("COOKIE_BANNER");
  if (/\b(dialog|modal)\b/i.test(text)) found.push("MODAL");
  return found;
}

function snapshotFromEnvelope(envelope: CliEnvelope, prior?: PageSnapshot | null): PageSnapshot {
  const data = envelope.data ?? {};
  const raw = String(data.snapshot ?? "").slice(0, 12_000);
  const refs = (data.refs ?? {}) as Record<string, { role?: string; name?: string }>;
  const elements: BrowserElement[] = Object.entries(refs).map(([ref, item]) => ({
    ref: `@${ref}`,
    role: item.role ?? "unknown",
    name: item.name ?? "",
    state: raw.match(new RegExp(`ref=${ref}[^\\n]*`, "i"))?.[0]
      ?.match(/\b(disabled|checked=true|expanded=true|selected)\b/gi) ?? [],
  }));
  const links = elements.filter((item) => item.role === "link").map((item) => {
    const escaped = item.ref.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = raw.match(new RegExp(`[^\\n]*ref=${escaped}[^\\n]*`, "i"))?.[0] ?? "";
    return { ref: item.ref, name: item.name, url: line.match(/url=([^\s\]]+)/i)?.[1] ?? null };
  });
  const headings = raw.split(/\r?\n/)
    .filter((line) => /^\s*- heading\b/i.test(line))
    .map((line) => line.match(/"([^"]+)"/)?.[1] ?? line.replace(/^\s*- heading\s*/i, ""))
    .slice(0, 30);
  const url = String(data.origin ?? data.url ?? prior?.url ?? "about:blank");
  return {
    url,
    title: String(data.title ?? prior?.title ?? headings[0] ?? ""),
    pageType: classifyPage(raw, url),
    headings,
    visibleRelevantText: raw,
    interactiveElements: elements,
    links,
    selectedFilters: raw.split(/\r?\n/).filter((line) => /\b(selected|checked=true)\b/i.test(line)).slice(0, 30),
    loadingState: /\bloading\b|spinner/i.test(raw) ? "loading" : "complete",
    friction: friction(raw),
    screenshotRef: prior?.screenshotRef ?? null,
  };
}

const DEFAULT_LIMITS: BrowserSession["limits"] = {
  actions: 80,
  pages: 30,
  scrolls: 12,
  screenshots: 12,
  reasoningCalls: 3,
};

export class AgentBrowserCliAdapter implements AgentBrowser {
  constructor(
    private readonly runner: CommandRunner = defaultRunner,
    private readonly signal: AbortSignal | null = null,
  ) {}

  async createSession(options: Parameters<AgentBrowser["createSession"]>[0] = {}): Promise<BrowserSession> {
    const id = options.id ?? `scrapivo-${crypto.randomUUID().slice(0, 12)}`;
    const screenshotDirectory = path.resolve(options.screenshotDirectory ?? "reports/gate2/browser-sessions", id);
    await mkdir(screenshotDirectory, { recursive: true });
    return {
      id,
      visible: options.visible ?? true,
      createdAt: new Date().toISOString(),
      screenshotDirectory,
      counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 },
      limits: { ...DEFAULT_LIMITS, ...options.limits },
      lastSnapshot: null,
    };
  }

  private args(session: BrowserSession, command: string[]): string[] {
    return ["--session", session.id, ...(session.visible ? ["--headed"] : []), "--json", ...command];
  }

  private async command(session: BrowserSession, command: string[]): Promise<CliEnvelope> {
    if (this.signal?.aborted) throw new Error("SEARCH_CANCELLED");
    return parse(await this.runner(this.args(session, command), this.signal));
  }

  private action(session: BrowserSession, kind: "action" | "page" | "scroll" | "screenshot"): void {
    if (kind === "action" && ++session.counters.actions > session.limits.actions) throw new Error("BROWSER_ACTION_BUDGET_EXHAUSTED");
    if (kind === "page" && ++session.counters.pages > session.limits.pages) throw new Error("BROWSER_PAGE_BUDGET_EXHAUSTED");
    if (kind === "scroll" && ++session.counters.scrolls > session.limits.scrolls) throw new Error("BROWSER_SCROLL_BUDGET_EXHAUSTED");
    if (kind === "screenshot" && ++session.counters.screenshots > session.limits.screenshots) throw new Error("BROWSER_SCREENSHOT_BUDGET_EXHAUSTED");
  }

  async observe(session: BrowserSession): Promise<PageSnapshot> {
    const snapshot = snapshotFromEnvelope(
      await this.command(session, ["snapshot", "-c", "--urls"]),
      session.lastSnapshot,
    );
    session.lastSnapshot = snapshot;
    return snapshot;
  }

  private async actAndObserve(
    session: BrowserSession,
    command: string[],
    action: string,
    expectedState: string,
  ): Promise<BrowserObservation> {
    this.action(session, "action");
    await this.command(session, command);
    const snapshot = await this.observe(session);
    return { snapshot, action, expectedState, verified: true };
  }

  async navigate(session: BrowserSession, url: string): Promise<BrowserObservation> {
    this.action(session, "page");
    return this.actAndObserve(session, ["open", url], "navigate", `url:${url}`);
  }

  async search(session: BrowserSession, query: string): Promise<BrowserObservation> {
    return this.navigate(session, `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
  }

  async click(session: BrowserSession, ref: string): Promise<BrowserObservation> {
    return this.actAndObserve(session, ["click", ref], "click", `changed_after:${ref}`);
  }

  async type(session: BrowserSession, ref: string, text: string): Promise<BrowserObservation> {
    return this.actAndObserve(session, ["fill", ref, text], "type", `value_set:${ref}`);
  }

  async select(session: BrowserSession, ref: string, value: string): Promise<BrowserObservation> {
    return this.actAndObserve(session, ["select", ref, value], "select", `selected:${value}`);
  }

  async scroll(
    session: BrowserSession,
    target: string | null,
    direction: "up" | "down" | "left" | "right",
  ): Promise<BrowserObservation> {
    this.action(session, "scroll");
    const command = target ? ["scrollintoview", target] : ["scroll", direction, "600"];
    return this.actAndObserve(session, command, "scroll", "fresh_page_state");
  }

  async waitFor(session: BrowserSession, condition: WaitCondition): Promise<BrowserObservation> {
    const timeoutMs = condition.timeoutMs ?? 10_000;
    const started = Date.now();
    let snapshot = await this.observe(session);
    while (Date.now() - started < timeoutMs) {
      const matched = (!condition.selector || snapshot.interactiveElements.some((item) => item.ref === condition.selector)) &&
        (!condition.text || snapshot.visibleRelevantText.toLowerCase().includes(condition.text.toLowerCase())) &&
        (!condition.urlIncludes || snapshot.url.includes(condition.urlIncludes));
      if (matched) return { snapshot, action: "wait", expectedState: JSON.stringify(condition), verified: true };
      await new Promise((resolve) => setTimeout(resolve, 150));
      snapshot = await this.observe(session);
    }
    return { snapshot, action: "wait", expectedState: JSON.stringify(condition), verified: false };
  }

  async extract(session: BrowserSession, schema: ExtractionSchema): Promise<ExtractionResult> {
    const values: Record<string, string | null> = {};
    const errors: string[] = [];
    for (const [field, descriptor] of Object.entries(schema.fields)) {
      try {
        const command = descriptor.attribute
          ? ["get", "attr", descriptor.attribute, descriptor.selector]
          : ["get", "text", descriptor.selector];
        const data = (await this.command(session, command)).data ?? {};
        values[field] = String(data.value ?? data.text ?? data.attribute ?? "") || null;
      } catch (error) {
        values[field] = null;
        errors.push(`${field}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      values,
      sourceUrl: session.lastSnapshot?.url ?? "about:blank",
      observedAt: new Date().toISOString(),
      errors,
    };
  }

  async screenshot(session: BrowserSession): Promise<string> {
    this.action(session, "screenshot");
    const file = path.join(session.screenshotDirectory, `${Date.now()}-${session.counters.screenshots}.png`);
    const envelope = await this.command(session, ["screenshot", file]);
    const reported = String(envelope.data?.path ?? file);
    if (session.lastSnapshot) session.lastSnapshot.screenshotRef = reported;
    return reported;
  }

  async close(session: BrowserSession): Promise<void> {
    try {
      await this.command(session, ["close"]);
    } finally {
      session.lastSnapshot = null;
    }
  }
}
