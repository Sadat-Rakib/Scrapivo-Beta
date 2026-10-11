/**
 * Persistent Chromium sessions for Scrapivo's private browser worker.
 *
 * One session = one persistent Chromium profile, bound to (ownerId, runKey)
 * where runKey is the search_job_id or interactive search_run_id. Identity is
 * reserved and persisted before Chromium starts; a failed launch keeps the
 * identity (status "error", retryable) but never an unusable profile.
 *
 * Invariants:
 * - navigate→read is atomic per session (serial queue); parallelism is across
 *   sessions only.
 * - every destination (initial URL, redirects, subresources, final URL) passes
 *   the public-destination guard; Chromium itself resolves nothing (all
 *   traffic goes through the pinned-DNS egress proxy).
 * - cancellation is checked before navigation, after navigation (no read after
 *   an abort), and before returning.
 * - while a human controls a session, agent operations are refused.
 * - page content is data; no caller-supplied script is ever evaluated.
 *
 * Session lifecycle and serialization adapted from OpenMuse
 * `apps/worker/src/browser.ts` (MIT, © 2026 OpenMuse contributors) — see
 * THIRD_PARTY_NOTICES.md.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { WorkerError } from "./errors";
import { createUrlGuard, type UrlGuard } from "./network-guard";
import { startEgressProxy } from "./egress-proxy";
import { frictionOf } from "../lib/research-agent/page-friction";

export type SessionStatus = "reserved" | "active" | "retained" | "closed" | "error";
export type WorkerSession = {
  id: string;
  ownerId: string;
  runKey: string | null;
  status: SessionStatus;
  controller: "agent" | "human";
  visible: boolean;
  url: string;
  title: string;
  snapshotVersion: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};
export type WorkerElement = { ref: string; role: string; name: string; href?: string; text?: string };
export type WorkerObservation = {
  sessionId: string;
  snapshotId: string;
  requestedUrl: string | null;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  headings: string[];
  links: Array<{ ref: string; name: string; url: string }>;
  elements: WorkerElement[];
  friction: string[];
  pageType: "error" | "unknown";
  observedAt: string;
};
export type AgentAction =
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; text: string; submit?: boolean }
  | { type: "select"; ref: string; value: string }
  | { type: "key"; key: string }
  | { type: "scroll"; deltaY: number }
  | { type: "back" }
  | { type: "forward" }
  | { type: "wait"; ms: number };
export type HumanInput =
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; deltaY: number };
export type ExtractFields = Record<string, { selector: string; attribute?: string | null; all?: boolean; maxChars?: number }>;

type Running = { context: BrowserContext; page: Page; touched: number };
type LaunchFn = (profileDir: string, options: Parameters<typeof import("playwright-core").chromium.launchPersistentContext>[1]) => Promise<BrowserContext>;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = /^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Control\+a|Meta\+a|Shift\+Tab)$/;
export const VIEWPORT = { width: 1280, height: 800 } as const;
const TEXT_CAP_LITERAL = "100000";

export function validateSessionId(id: unknown): string {
  if (typeof id !== "string" || !SESSION_ID.test(id)) throw new WorkerError("INVALID_SESSION", "A valid UUID session ID is required.");
  return id.toLowerCase();
}
const cancelled = () => new WorkerError("CANCELLED", "The browser operation was cancelled.", 499);
const throwIfAborted = (signal?: AbortSignal | null) => { if (signal?.aborted) throw cancelled(); };

/** Environment for Chromium without any credential-looking variable. */
function chromiumEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null || /KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|SUPABASE|AWS|DATABASE|PRIVATE|AUTH|COOKIE|WEBHOOK|URL|URI|DSN|PROXY/i.test(key)) continue;
    // Connection strings with embedded credentials under any other name.
    if (/[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(value)) continue;
    env[key] = value;
  }
  return env;
}

type PageView = {
  url: string; title: string; text: string; truncated: boolean; headings: string[];
  elements: WorkerElement[]; links: Array<{ ref: string; name: string; url: string }>;
};
/**
 * Fixed page script (never caller supplied): assigns element refs and reads a
 * bounded view. Kept as a string so no transpiler helper can leak into the
 * page context.
 */
const SNAPSHOT_SCRIPT = `(() => {
  const L = { maxLinks: 80, maxElements: 150, textCap: ${TEXT_CAP_LITERAL} };
  const cut = (v, c) => String(v == null ? "" : v).replace(/\\s+/g, " ").trim().slice(0, c || 120);
  document.querySelectorAll("[data-scrapivo-ref]").forEach((el) => el.removeAttribute("data-scrapivo-ref"));
  const elements = []; const links = []; let n = 0;
  for (const a of Array.from(document.querySelectorAll("a[href]")).slice(0, 400)) {
    if (links.length >= L.maxLinks) break;
    if (!/^https?:\\/\\//.test(a.href)) continue;
    const ref = "e" + (n++); a.setAttribute("data-scrapivo-ref", ref);
    let host = ""; try { host = new URL(a.href).hostname; } catch (e) {}
    const name = cut(a.getAttribute("aria-label") || a.textContent) || host;
    links.push({ ref, name, url: a.href }); elements.push({ ref, role: "link", name, href: a.href });
  }
  const sel = 'button, input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"]';
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (elements.length >= L.maxElements) break;
    if (el.hasAttribute("data-scrapivo-ref")) continue;
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none") continue;
    const ref = "e" + (n++); el.setAttribute("data-scrapivo-ref", ref);
    const tag = el.tagName.toLowerCase(); const type = el.type || "";
    const role = el.getAttribute("role") || (tag === "button" ? "button" : tag === "select" ? "combobox" : tag === "textarea" ? "textbox"
      : tag === "input" ? (type === "checkbox" || type === "radio" ? type : (type === "submit" || type === "button") ? "button" : "textbox") : "generic");
    const item = { ref, role, name: cut(el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.value) };
    if (tag === "input" || tag === "textarea") item.text = cut(el.value, 200);
    elements.push(item);
  }
  const headings = Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 12).map((h) => cut(h.textContent, 160)).filter(Boolean);
  const text = document.body ? document.body.innerText : "";
  return { url: location.href, title: document.title.slice(0, 300), text: text.slice(0, L.textCap), truncated: text.length > L.textCap, elements, links, headings };
})()`;

export async function createSessionManager(options: {
  dataDir?: string;
  maxActive?: number;
  maxProfiles?: number;
  idleTimeoutMs?: number;
  retainMs?: number;
  profileRetentionMs?: number;
  sweepMs?: number;
  navTimeoutMs?: number;
  guard?: UrlGuard;
  launch?: LaunchFn;
} = {}) {
  const dataDir = options.dataDir ?? process.env.SCRAPIVO_BROWSER_WORKER_DATA_DIR ?? join(homedir(), ".scrapivo", "browser-worker");
  const maxActive = options.maxActive ?? Number(process.env.SCRAPIVO_BROWSER_WORKER_MAX_ACTIVE ?? 2);
  const maxProfiles = options.maxProfiles ?? Number(process.env.SCRAPIVO_BROWSER_WORKER_MAX_PROFILES ?? 20);
  const idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
  const retainMs = options.retainMs ?? 15 * 60_000;
  const profileRetentionMs = options.profileRetentionMs ?? 7 * 24 * 60 * 60_000;
  const navTimeoutMs = options.navTimeoutMs ?? 20_000;
  const guard = options.guard ?? createUrlGuard();
  await mkdir(dataDir, { recursive: true });
  const sessions = new Map<string, WorkerSession>();
  const running = new Map<string, Running>();
  const queues = new Map<string, Promise<unknown>>();
  const executing = new Map<string, Promise<unknown>>();
  const closing = new Map<string, Promise<WorkerSession>>();
  const proxy = await startEgressProxy(guard);

  for (const id of await readdir(dataDir).catch(() => [] as string[])) {
    if (!SESSION_ID.test(id)) continue;
    try {
      const stored = JSON.parse(await readFile(join(dataDir, id, "session.json"), "utf8")) as WorkerSession;
      // A restart ends every Chromium process: saved sessions are reopenable, not active.
      sessions.set(id, { ...stored, id, status: stored.status === "error" ? "error" : "closed", controller: "agent" });
    } catch { /* no metadata: incomplete reservation from a crash; ignored */ }
  }

  const directory = (id: string) => join(dataDir, validateSessionId(id));
  const now = () => new Date().toISOString();
  async function persist(session: WorkerSession) {
    await mkdir(directory(session.id), { recursive: true });
    const path = join(directory(session.id), "session.json");
    await writeFile(`${path}.tmp`, JSON.stringify(session));
    await rename(`${path}.tmp`, path);
  }
  async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (SESSION_ID.test(key)) key = key.toLowerCase();
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      for (let barrier = closing.get(key); barrier; barrier = closing.get(key)) await barrier;
      const operation = Promise.resolve().then(fn);
      executing.set(key, operation);
      try { return await operation; } finally { if (executing.get(key) === operation) executing.delete(key); }
    });
    queues.set(key, next);
    try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
  }
  async function afterCurrent<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await (queues.get(key) ?? Promise.resolve()).catch(() => undefined);
    return fn();
  }
  function owned(id: string, ownerId: string): WorkerSession {
    const session = sessions.get(validateSessionId(id));
    // Wrong owner and unknown id look identical: existence is not disclosed.
    if (!session || session.ownerId !== ownerId) throw new WorkerError("SESSION_NOT_FOUND", "Browser session not found.", 404);
    return session;
  }
  function live(id: string): Running {
    const value = running.get(id);
    if (!value || value.page.isClosed()) throw new WorkerError("SESSION_CLOSED", "Open this browser session before using it.", 409);
    value.touched = Date.now();
    return value;
  }
  function agentOnly(session: WorkerSession) {
    if (session.controller === "human") throw new WorkerError("HUMAN_CONTROL", "A person is controlling this browser; the agent is paused.", 409);
  }
  async function update(session: WorkerSession, patch: Partial<WorkerSession>) {
    Object.assign(session, patch, { updatedAt: now() });
    await persist(session);
    return { ...session };
  }

  async function gotoGuarded(session: WorkerSession, url: string, signal?: AbortSignal | null) {
    await guard(url);
    throwIfAborted(signal);
    const { page } = live(session.id);
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(cancelled());
          if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      await page.waitForLoadState("domcontentloaded", { timeout: 4_000 }).catch(() => undefined);
    } catch (error) {
      if (error instanceof WorkerError && error.code === "CANCELLED") {
        await page.goto("about:blank", { timeout: 5_000 }).catch(() => undefined);
        throw error;
      }
      throw new WorkerError("NAVIGATION_FAILED", "The page could not be loaded.", 502);
    } finally { if (onAbort) signal?.removeEventListener("abort", onAbort); }
    // Redirects may land anywhere: validate the final destination too.
    try { await guard(page.url()); } catch (error) { await page.goto("about:blank", { timeout: 5_000 }).catch(() => undefined); throw error; }
    session.snapshotVersion += 1;
  }

  async function observeNow(session: WorkerSession, requestedUrl: string | null): Promise<WorkerObservation> {
    const { page } = live(session.id);
    if (page.url() !== "about:blank") await guard(page.url());
    let view: PageView;
    try {
      view = await page.evaluate(SNAPSHOT_SCRIPT) as PageView;
    } catch {
      throw new WorkerError("READ_FAILED", "The page could not be read.", 502);
    }
    if (view.url !== "about:blank") await guard(view.url);
    session.snapshotVersion += 1;
    await update(session, { url: view.url, title: view.title });
    return {
      sessionId: session.id, snapshotId: String(session.snapshotVersion), requestedUrl,
      url: view.url, title: view.title, text: view.text, truncated: view.truncated, headings: view.headings,
      links: view.links, elements: view.elements, friction: frictionOf(view.title, view.text),
      pageType: /error|not found|404/i.test(view.title) ? "error" : "unknown", observedAt: now(),
    };
  }

  /** Operator log only (worker stderr): first line of the Chromium error, no page data. */
  function launchFailed(stage: "start" | "setup", id: string, error: unknown) {
    const message = String(error instanceof Error ? error.message : error).split("\n")[0]!.slice(0, 240);
    console.warn(JSON.stringify({ event: "browser_launch_failed", stage, session: id.slice(0, 8), error: message }));
  }

  async function launch(session: WorkerSession) {
    if (running.has(session.id)) return;
    const retained = [...sessions.values()].filter((item) => item.status === "retained" && running.has(item.id));
    if (running.size >= maxActive && retained.length) {
      const oldest = retained.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]!;
      // Behind that lane's own queue: an in-flight takeover input finishes first.
      await serial(oldest.id, () => closeInternal(oldest));
    }
    if (running.size >= maxActive) throw new WorkerError("SESSION_LIMIT", `The browser worker is at its active-session limit (${maxActive}).`, 409);
    const profileDir = join(directory(session.id), "profile");
    await mkdir(profileDir, { recursive: true });
    const launchFn: LaunchFn = options.launch ?? (async (dir, opts) => (await import("playwright-core")).chromium.launchPersistentContext(dir, opts));
    let context: BrowserContext;
    try {
      context = await launchFn(profileDir, {
        env: chromiumEnv(),
        headless: !session.visible,
        viewport: VIEWPORT,
        proxy: { server: proxy.url, bypass: "<-loopback>" },
        serviceWorkers: "block",
        acceptDownloads: false,
        timeout: 25_000,
        args: [
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--disable-extensions",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
          "--disable-blink-features=AutomationControlled",
        ],
      });
    } catch (error) {
      launchFailed("start", session.id, error);
      // Identity survives (retryable, same id); an unusable profile does not.
      const everOpened = session.status === "closed" || session.status === "retained";
      if (!everOpened) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
      await update(session, { status: "error", lastError: "BROWSER_UNAVAILABLE" });
      throw new WorkerError("BROWSER_UNAVAILABLE", "Chromium could not start for this session.", 503);
    }
    try {
      try {
        const state = JSON.parse(await readFile(join(directory(session.id), "storage.json"), "utf8")) as { cookies?: Parameters<BrowserContext["addCookies"]>[0] };
        if (state.cookies?.length) await context.addCookies(state.cookies);
      } catch { /* first launch: nothing saved */ }
      await context.route("**/*", async (route) => {
        try { await guard(route.request().url()); await route.continue(); }
        catch { await route.abort("blockedbyclient").catch(() => undefined); }
      });
      await context.routeWebSocket("**/*", (socket) => socket.close());
      // Open the agent tab BEFORE closing the launch tab: a headed window left
      // with zero tabs shuts down, and newPage then fails intermittently with
      // "Target.createTarget: Failed to open a new tab".
      const page = await context.newPage();
      for (const old of context.pages()) if (old !== page) await old.close().catch(() => undefined);
      page.setDefaultTimeout(10_000);
      context.on("page", (popup) => { void popup.close().catch(() => undefined); });
      page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => undefined); });
      running.set(session.id, { context, page, touched: Date.now() });
      await update(session, { status: "active", controller: "agent", lastError: null });
    } catch (error) {
      launchFailed("setup", session.id, error);
      await context.close().catch(() => undefined);
      running.delete(session.id);
      await update(session, { status: "error", lastError: "BROWSER_UNAVAILABLE" });
      throw new WorkerError("BROWSER_UNAVAILABLE", "Chromium could not start for this session.", 503);
    }
  }

  async function closeInternal(session: WorkerSession) {
    const instance = running.get(session.id);
    if (instance) {
      await instance.context.storageState({ path: join(directory(session.id), "storage.json") }).catch(() => undefined);
      await instance.context.close().catch(() => undefined);
      running.delete(session.id);
    }
    return update(session, { status: session.status === "error" ? "error" : "closed", controller: "agent" });
  }

  function closeTerminal(session: WorkerSession): Promise<WorkerSession> {
    const pending = closing.get(session.id);
    if (pending) return pending;
    const current = executing.get(session.id);
    const instance = running.get(session.id);
    if (instance) running.delete(session.id);
    // Publish the barrier before teardown starts. Interrupt only the executing
    // operation; queued steps wait here instead of acquiring the old profile.
    const terminal = Promise.resolve().then(async () => {
      if (instance) {
        await instance.context.storageState({ path: join(directory(session.id), "storage.json") }).catch(() => undefined);
        await instance.context.close().catch(() => undefined);
      }
      await current?.catch(() => undefined);
      // A launch already executing when close began may have finished meanwhile.
      return closeInternal(session);
    }).finally(() => { if (closing.get(session.id) === terminal) closing.delete(session.id); });
    closing.set(session.id, terminal);
    return terminal;
  }

  async function evictProfilesFor(newId: string) {
    const stored = [...sessions.values()].filter((item) => item.id !== newId);
    if (stored.length < maxProfiles) return;
    const removable = stored.filter((item) => item.status === "closed" || item.status === "error").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    if (!removable.length) throw new WorkerError("PROFILE_LIMIT", `The browser worker is at its saved-profile limit (${maxProfiles}).`, 409);
    const victim = removable[0]!;
    sessions.delete(victim.id);
    await rm(directory(victim.id), { recursive: true, force: true }).catch(() => undefined);
  }

  async function create(input: { id?: string; ownerId: string; runKey?: string | null; visible?: boolean }) {
    const ownerId = requireOwner(input.ownerId);
    const runKey = input.runKey ? String(input.runKey).slice(0, 120) : null;
    // Same owner + run → same lane and profile (never a new profile per turn).
    const existing = [...sessions.values()].find((item) => item.ownerId === ownerId && runKey && item.runKey === runKey);
    const id = existing?.id ?? (input.id ? validateSessionId(input.id) : randomUUID());
    return serial("create", () => serial(id, async () => {
      if (sessions.has(id) && sessions.get(id)!.ownerId !== ownerId) throw new WorkerError("SESSION_NOT_FOUND", "Browser session not found.", 404);
      // A new search clears the same owner's retained sessions from earlier runs.
      for (const other of [...sessions.values()]) {
        if (other.ownerId === ownerId && other.id !== id && other.status === "retained") await serial(other.id, () => closeInternal(other));
      }
      let session = sessions.get(id);
      if (!session) {
        await evictProfilesFor(id);
        session = { id, ownerId, runKey, status: "reserved", controller: "agent", visible: !!input.visible, url: "about:blank", title: "",
          snapshotVersion: 0, createdAt: now(), updatedAt: now(), lastError: null };
        sessions.set(id, session);
        // Reserved and persisted BEFORE Chromium starts.
        await persist(session);
      } else if (input.visible !== undefined && !running.has(id)) {
        session.visible = !!input.visible;
      }
      await launch(session);
      // A retained lane re-used by its own run (the next branch of a
      // multi-place search) is active again, but a person who is driving it
      // keeps control: the agent's steps wait on HUMAN_CONTROL until released.
      if (session.status === "retained") await update(session, { status: "active" });
      return { ...session };
    }));
  }

  function requireOwner(ownerId: unknown): string {
    if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 120) throw new WorkerError("INVALID_BODY", "ownerId is required.");
    return ownerId;
  }

  const sweeper = setInterval(() => {
    const t = Date.now();
    for (const session of sessions.values()) {
      const instance = running.get(session.id);
      const idleFor = t - Date.parse(session.updatedAt);
      if (instance && session.status === "retained" && idleFor > retainMs) void serial(session.id, () => closeInternal(session)).catch(() => undefined);
      // Any lane nobody touched for the idle window is reclaimed, including a
      // person-controlled one whose viewer went away (a watching mini-browser
      // polls frames, which counts as a touch).
      else if (instance && t - instance.touched > idleTimeoutMs) void serial(session.id, () => closeInternal(session)).catch(() => undefined);
      else if (!instance && (session.status === "closed" || session.status === "error") && idleFor > profileRetentionMs) {
        sessions.delete(session.id);
        void rm(directory(session.id), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }, options.sweepMs ?? 60_000);
  sweeper.unref();

  return {
    dataDir,
    list: (ownerId: string) => [...sessions.values()].filter((item) => item.ownerId === ownerId).map((item) => ({ ...item })),
    get: (id: string, ownerId: string) => ({ ...owned(id, ownerId) }),
    counts: () => ({ active: running.size, stored: sessions.size, maxActive, maxProfiles }),
    create,
    /** Relaunch a saved profile under the same id. */
    reopen: (id: string, ownerId: string) => afterCurrent(id, async () => serial(id, async () => {
      const session = owned(id, ownerId);
      await launch(session);
      return { ...session };
    })),
    /** Atomic navigate → read (+ element refs) for the agent lane. */
    observe: (id: string, ownerId: string, url: string, signal?: AbortSignal | null) => serial(id, async () => {
      const session = owned(id, ownerId);
      agentOnly(session);
      throwIfAborted(signal);
      await gotoGuarded(session, url, signal);
      throwIfAborted(signal); // cancelled after navigation: do not read
      const observation = await observeNow(session, url);
      throwIfAborted(signal);
      return observation;
    }),
    snapshot: (id: string, ownerId: string, signal?: AbortSignal | null) => serial(id, async () => {
      const session = owned(id, ownerId);
      agentOnly(session);
      throwIfAborted(signal);
      return observeNow(session, null);
    }),
    act: (id: string, ownerId: string, snapshotId: string | null, action: AgentAction, signal?: AbortSignal | null) => serial(id, async () => {
      const session = owned(id, ownerId);
      agentOnly(session);
      throwIfAborted(signal);
      const { page } = live(session.id);
      const usesRef = action.type === "click" || action.type === "type" || action.type === "select";
      if (usesRef && snapshotId !== String(session.snapshotVersion)) {
        throw new WorkerError("STALE_SNAPSHOT", "The page changed since that snapshot; take a new snapshot first.", 409);
      }
      const target = usesRef ? page.locator(`[data-scrapivo-ref="${String((action as { ref: string }).ref).replace(/[^a-z0-9]/gi, "")}"]`).first() : null;
      try {
        if (action.type === "click") await target!.click({ timeout: 8_000 });
        else if (action.type === "type") {
          if (typeof action.text !== "string" || action.text.length > 2_000) throw new WorkerError("INVALID_INPUT", "Text is limited to 2,000 characters.");
          await target!.fill(action.text, { timeout: 5_000 });
          if (action.submit) await target!.press("Enter", { timeout: 5_000 });
        } else if (action.type === "select") await target!.selectOption(String(action.value), { timeout: 5_000 });
        else if (action.type === "key") {
          if (!KEYS.test(action.key)) throw new WorkerError("INVALID_INPUT", "Unsupported key.");
          await page.keyboard.press(action.key);
        } else if (action.type === "scroll") {
          if (!Number.isFinite(action.deltaY) || Math.abs(action.deltaY) > 5_000) throw new WorkerError("INVALID_INPUT", "Scroll is limited to ±5,000 pixels.");
          await page.mouse.wheel(0, action.deltaY);
          await page.waitForTimeout(400);
        } else if (action.type === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: navTimeoutMs });
        else if (action.type === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: navTimeoutMs });
        else if (action.type === "wait") await page.waitForTimeout(Math.max(0, Math.min(5_000, Number(action.ms) || 0)));
        else throw new WorkerError("INVALID_INPUT", "Unsupported browser action.");
      } catch (error) {
        if (error instanceof WorkerError) throw error;
        throw new WorkerError("NAVIGATION_FAILED", "The browser action could not be completed.", 502);
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 6_000 }).catch(() => undefined);
      try { if (page.url() !== "about:blank") await guard(page.url()); } catch (error) { await page.goto("about:blank", { timeout: 5_000 }).catch(() => undefined); throw error; }
      throwIfAborted(signal);
      return observeNow(session, null);
    }),
    extract: (id: string, ownerId: string, fields: ExtractFields, signal?: AbortSignal | null) => serial(id, async () => {
      const session = owned(id, ownerId);
      agentOnly(session);
      throwIfAborted(signal);
      const { page } = live(session.id);
      const entries = Object.entries(fields ?? {});
      if (entries.length > 8) throw new WorkerError("INVALID_SELECTOR", "At most 8 extraction fields.");
      const values: Record<string, string | null> = {};
      const errors: string[] = [];
      for (const [name, field] of entries) {
        if (!field || typeof field.selector !== "string" || field.selector.length > 300 || (field.attribute && !/^[a-z][a-z0-9:-]{0,59}$/i.test(field.attribute))) {
          throw new WorkerError("INVALID_SELECTOR", "Invalid extraction field.");
        }
        const cap = Math.max(1, Math.min(Number(field.maxChars ?? 18_000), 500_000));
        try {
          if (field.all && !field.attribute) {
            const texts = await page.locator(field.selector).allTextContents();
            const joined = texts.map((text) => text.trim()).filter(Boolean).join("\u001E");
            values[name] = joined ? joined.slice(0, cap) : null;
            continue;
          }
          const locator = page.locator(field.selector).first();
          let value = (await locator.innerText({ timeout: 4_000 }).catch(() => "")) ?? "";
          if (!value) value = (await locator.textContent({ timeout: 2_000 }).catch(() => "")) ?? "";
          if (field.attribute) value = (await locator.getAttribute(field.attribute, { timeout: 2_000 }).catch(() => "")) ?? "";
          values[name] = value ? value.slice(0, cap) : null;
        } catch {
          errors.push(`${name}: unreadable`);
          values[name] = null;
        }
      }
      throwIfAborted(signal);
      return { values, sourceUrl: page.url(), observedAt: now(), errors };
    }),
    /** Organic links matching a selector, with refs valid for the current snapshot. */
    links: (id: string, ownerId: string, selector: string, timeoutMs = 5_000, signal?: AbortSignal | null) => serial(id, async () => {
      const session = owned(id, ownerId);
      agentOnly(session);
      if (typeof selector !== "string" || selector.length > 300) throw new WorkerError("INVALID_SELECTOR", "Invalid link selector.");
      const { page } = live(session.id);
      await page.waitForSelector(selector, { timeout: Math.max(0, Math.min(timeoutMs, 8_000)) }).catch(() => undefined);
      throwIfAborted(signal);
      const version = session.snapshotVersion;
      const links = await page.$$eval(selector, (anchors, start) => {
        let n = start;
        return (anchors as HTMLAnchorElement[]).slice(0, 15).filter((anchor) => /^https?:\/\//.test(anchor.href ?? "")).map((anchor) => {
          let ref = anchor.getAttribute("data-scrapivo-ref");
          if (!ref) { ref = `x${n++}`; anchor.setAttribute("data-scrapivo-ref", ref); }
          return { ref, name: (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300), url: anchor.href };
        });
      }, version * 1000).catch(() => [] as Array<{ ref: string; name: string; url: string }>);
      return { links, snapshotId: String(version) };
    }),
    screenshot: (id: string, ownerId: string) => serial(id, async () => {
      owned(id, ownerId);
      return live(id).page.screenshot({ type: "jpeg", quality: 50, timeout: 10_000 });
    }),
    /** Hand the session to a person (waits for any in-flight agent step) or back to the agent. */
    control: (id: string, ownerId: string, mode: "human" | "agent") => serial(id, async () => {
      const session = owned(id, ownerId);
      live(session.id);
      if (mode === "agent") session.snapshotVersion += 1; // every pre-takeover ref is now stale
      return update(session, { controller: mode });
    }),
    input: (id: string, ownerId: string, input: HumanInput) => serial(id, async () => {
      const session = owned(id, ownerId);
      if (session.controller !== "human") throw new WorkerError("NOT_IN_CONTROL", "Take control of the browser first.", 409);
      const { page } = live(session.id);
      if (input.type === "click" && Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.x < VIEWPORT.width && input.y >= 0 && input.y < VIEWPORT.height) await page.mouse.click(input.x, input.y);
      else if (input.type === "text" && typeof input.text === "string" && input.text.length <= 10_000) await page.keyboard.insertText(input.text);
      else if (input.type === "key" && typeof input.key === "string" && KEYS.test(input.key)) await page.keyboard.press(input.key);
      else if (input.type === "scroll" && Number.isFinite(input.deltaY) && Math.abs(input.deltaY) <= 5_000) await page.mouse.wheel(0, input.deltaY);
      else throw new WorkerError("INVALID_INPUT", "Unsupported browser input or coordinates.");
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      try { if (page.url() !== "about:blank") await guard(page.url()); } catch (error) { await page.goto("about:blank", { timeout: 5_000 }).catch(() => undefined); throw error; }
      session.snapshotVersion += 1;
      return update(session, { url: page.url(), title: (await page.title().catch(() => "")).slice(0, 300) });
    }),
    /** retain=true keeps Chromium open for viewing/takeover until retainMs or an explicit close. */
    close: async (id: string, ownerId: string, retain = false) => {
      const session = owned(id, ownerId);
      if (!retain) return closeTerminal(session);
      // A person driving the browser keeps control when the run ends. Retain
      // stays serialized so takeover/input actions finish before the viewer
      // lane becomes retained.
      return serial(id, async () => {
        const current = owned(id, ownerId);
        if (running.has(current.id)) return update(current, { status: "retained" });
        return closeInternal(current);
      });
    },
    shutdown: async () => {
      clearInterval(sweeper);
      await Promise.allSettled([...closing.values()]);
      await Promise.allSettled([...queues.values()]);
      await Promise.allSettled([...sessions.values()].filter((item) => running.has(item.id)).map((item) => closeInternal(item)));
      await proxy.close();
    },
  };
}

export type SessionManager = Awaited<ReturnType<typeof createSessionManager>>;
