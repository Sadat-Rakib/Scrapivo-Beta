/**
 * Browser worker acceptance (real Chromium, local fixture pages only).
 * Loopback is reachable ONLY through the test-injected guard allowlist.
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUrlGuard } from "../network-guard";
import { createSessionManager, type SessionManager } from "../session-manager";
import { createBrowserRoutes } from "../routes";

const chromiumInstalled = existsSync(join(process.env.LOCALAPPDATA ?? process.env.HOME ?? "", "ms-playwright"));
const html = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
let hits = 0;
let fixture: Server;
let base = "";
let dataDir = "";

function startFixture(): Promise<void> {
  fixture = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const send = (status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers }); res.end(body); };
    if (url.pathname === "/count") { hits++; return send(200, html("Count", "<p>counted</p>")); }
    if (url.pathname === "/a") return send(200, html("Page A", "<h1>Alpha</h1><p>Alpha company builds finance software.</p><a href=\"/contact\">Contact</a>"));
    if (url.pathname === "/b") return send(200, html("Page B", "<h1>Beta</h1><p>Beta page text.</p>"));
    if (url.pathname === "/slow-a") { setTimeout(() => send(200, html("Page A", "<h1>Alpha</h1><p>slow alpha</p>")), 1200); return; }
    if (url.pathname === "/slow") { setTimeout(() => send(200, html("Slow", "<p>late</p>")), 4000); return; }
    if (url.pathname === "/contact") return send(200, html("Contact Alpha", "<p>Get in touch: hello@alpha.test</p>"));
    if (url.pathname === "/redirect-ok") return send(302, "", { location: "/b" });
    if (url.pathname === "/redirect-private") return send(302, "", { location: "http://169.254.169.254/latest/meta-data/" });
    if (url.pathname === "/set-cookie") return send(200, html("Set", "<p>cookie set</p>"), { "set-cookie": "sid=abc123; Path=/; Max-Age=3600" });
    if (url.pathname === "/echo-cookie") return send(200, html("Echo", `<p>cookie: ${req.headers.cookie ?? "none"}</p>`));
    if (url.pathname === "/form") return send(200, html("Search", "<form action=\"/results\"><input name=\"q\" aria-label=\"Search box\"><button type=\"submit\">Go</button></form>"));
    if (url.pathname === "/results") return send(200, html("Results", `<p>results for ${url.searchParams.get("q") ?? ""}</p>`));
    if (url.pathname === "/button") return send(200, html("Button", "<button id=\"b\" style=\"position:absolute;left:100px;top:100px;width:200px;height:80px\" onclick=\"this.textContent='Clicked by human'\">Press</button>"));
    return send(404, html("Not found", "<p>404</p>"));
  });
  return new Promise((resolve) => fixture.listen(0, "127.0.0.1", () => {
    const address = fixture.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    resolve();
  }));
}

const OWNER = "owner-a";
const guardFor = () => createUrlGuard({ resolve: async () => [{ address: "93.184.216.34", family: 4 }], testAllow: new Set([base.replace("http://", "")]) });

// One fixture server for the whole file.
beforeAll(async () => { await startFixture(); });
afterAll(async () => { await new Promise<void>((resolve) => fixture.close(() => resolve())); });

describe.skipIf(!chromiumInstalled)("browser worker sessions (real Chromium)", { timeout: 120_000 }, () => {
  let manager: SessionManager;
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "scrapivo-worker-test-"));
    manager = await createSessionManager({ dataDir, maxActive: 2, guard: guardFor(), sweepMs: 60_000 });
  });
  afterAll(async () => {
    await manager?.shutdown();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates a session, reads a page atomically, and reuses the same lane for the same run", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-1" });
    expect(session.status).toBe("active");
    expect(existsSync(join(dataDir, session.id, "session.json"))).toBe(true);
    const view = await manager.observe(session.id, OWNER, `${base}/a`);
    expect(view).toMatchObject({ title: "Page A", url: `${base}/a`, requestedUrl: `${base}/a` });
    expect(view.text).toContain("Alpha company builds finance software.");
    expect(view.links.map((link) => link.name)).toContain("Contact");
    const again = await manager.create({ ownerId: OWNER, runKey: "run-1" });
    expect(again.id).toBe(session.id);
    await manager.close(session.id, OWNER);
  });

  it("follows a valid redirect and keeps the final URL", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-redirect" });
    const view = await manager.observe(session.id, OWNER, `${base}/redirect-ok`);
    expect(view).toMatchObject({ title: "Page B", url: `${base}/b`, requestedUrl: `${base}/redirect-ok` });
    await manager.close(session.id, OWNER);
  });

  it("rejects private destinations and unsafe redirects without reading them", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-unsafe" });
    await expect(manager.observe(session.id, OWNER, "http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(manager.observe(session.id, OWNER, "http://127.0.0.1:9/")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(manager.observe(session.id, OWNER, "file:///C:/Windows/win.ini")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(manager.observe(session.id, OWNER, "not a url")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(manager.observe(session.id, OWNER, `${base}/redirect-private`)).rejects.toMatchObject({ code: "BLOCKED_URL" });
    expect((await manager.snapshot(session.id, OWNER)).url).toBe("about:blank");
    await manager.close(session.id, OWNER);
  });

  it("refuses another owner's session and unknown ids identically", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-owner" });
    await expect(manager.observe(session.id, "owner-b", `${base}/a`)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(manager.snapshot("3f2504e0-4f89-41d3-9a0c-0305e82c3301", OWNER)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(manager.create({ id: session.id, ownerId: "owner-b" })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(manager.list("owner-b")).toEqual([]);
    await manager.close(session.id, OWNER);
  });

  it("serializes navigate+read per session so concurrent callers never swap pages", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-race" });
    const [slow, fast] = await Promise.all([manager.observe(session.id, OWNER, `${base}/slow-a`), manager.observe(session.id, OWNER, `${base}/b`)]);
    expect(slow.title).toBe("Page A");
    expect(slow.text).toContain("slow alpha");
    expect(fast.title).toBe("Page B");
    await manager.close(session.id, OWNER);
  });

  it("does not request a page when cancelled before navigation, and does not read after a cancelled navigation", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-cancel" });
    const before = hits;
    const aborted = new AbortController();
    aborted.abort();
    await expect(manager.observe(session.id, OWNER, `${base}/count`, aborted.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(hits).toBe(before);
    const midway = new AbortController();
    const started = Date.now();
    setTimeout(() => midway.abort(), 300);
    await expect(manager.observe(session.id, OWNER, `${base}/slow`, midway.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(Date.now() - started).toBeLessThan(3500);
    expect((await manager.snapshot(session.id, OWNER)).url).toBe("about:blank");
    await manager.close(session.id, OWNER);
  });

  it("terminal close interrupts an in-flight navigation and leaves the lane reopenable", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-terminal-close" });
    const started = Date.now();
    const navigating = manager.observe(session.id, OWNER, `${base}/slow`);
    const rejected = expect(navigating).rejects.toMatchObject({ code: "NAVIGATION_FAILED" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(manager.close(session.id, "owner-b")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    const closed = await manager.close(session.id, OWNER);
    expect(closed.status).toBe("closed");
    expect(Date.now() - started).toBeLessThan(3500);
    await rejected;
    expect(manager.get(session.id, OWNER).status).toBe("closed");
    const reopened = await manager.reopen(session.id, OWNER);
    expect(reopened).toMatchObject({ id: session.id, status: "active", controller: "agent" });
    await manager.close(session.id, OWNER);
  });

  it("runs structured ref actions with a stale-snapshot guard (list -> Contact -> read; form fill + submit)", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-actions" });
    const list = await manager.observe(session.id, OWNER, `${base}/a`);
    const contact = list.elements.find((element) => element.role === "link" && element.name === "Contact")!;
    const next = await manager.act(session.id, OWNER, list.snapshotId, { type: "click", ref: contact.ref });
    expect(next).toMatchObject({ title: "Contact Alpha" });
    expect(next.text).toContain("hello@alpha.test");
    // The old snapshot's refs are stale now.
    await expect(manager.act(session.id, OWNER, list.snapshotId, { type: "click", ref: contact.ref })).rejects.toMatchObject({ code: "STALE_SNAPSHOT" });
    const back = await manager.act(session.id, OWNER, null, { type: "back" });
    expect(back.title).toBe("Page A");
    const form = await manager.observe(session.id, OWNER, `${base}/form`);
    const box = form.elements.find((element) => element.role === "textbox")!;
    const results = await manager.act(session.id, OWNER, form.snapshotId, { type: "type", ref: box.ref, text: "saas founders", submit: true });
    expect(results.text).toContain("results for saas founders");
    await manager.close(session.id, OWNER);
  });

  it("hands control to a person exclusively, applies human input to the real page, and resumes the agent only from a fresh snapshot", async () => {
    const session = await manager.create({ ownerId: OWNER, runKey: "run-takeover" });
    const view = await manager.observe(session.id, OWNER, `${base}/button`);
    await manager.control(session.id, OWNER, "human");
    await expect(manager.snapshot(session.id, OWNER)).rejects.toMatchObject({ code: "HUMAN_CONTROL" });
    await expect(manager.observe(session.id, OWNER, `${base}/a`)).rejects.toMatchObject({ code: "HUMAN_CONTROL" });
    await manager.input(session.id, OWNER, { type: "click", x: 150, y: 130 });
    const shot = await manager.screenshot(session.id, OWNER);
    expect(shot.length).toBeGreaterThan(1000);
    const released = await manager.control(session.id, OWNER, "agent");
    expect(released.controller).toBe("agent");
    await expect(manager.act(session.id, OWNER, view.snapshotId, { type: "click", ref: view.elements[0]?.ref ?? "e0" })).rejects.toMatchObject({ code: "STALE_SNAPSHOT" });
    const fresh = await manager.snapshot(session.id, OWNER);
    expect(fresh.text).toContain("Clicked by human");
    await expect(manager.input(session.id, OWNER, { type: "click", x: 5, y: 5 })).rejects.toMatchObject({ code: "NOT_IN_CONTROL" });
    await manager.close(session.id, OWNER);
  });

  it("retains a finished session for viewing, and a new run of the same owner clears it", async () => {
    const first = await manager.create({ ownerId: OWNER, runKey: "run-retain-1" });
    await manager.observe(first.id, OWNER, `${base}/b`);
    expect((await manager.close(first.id, OWNER, true)).status).toBe("retained");
    expect((await manager.screenshot(first.id, OWNER)).length).toBeGreaterThan(1000);
    const second = await manager.create({ ownerId: OWNER, runKey: "run-retain-2" });
    expect(manager.get(first.id, OWNER).status).toBe("closed");
    await manager.close(second.id, OWNER);
  });

  it("keeps a person in control when the same run re-creates its lane (next branch of a multi-place search)", async () => {
    const first = await manager.create({ ownerId: OWNER, runKey: "run-branches" });
    await manager.observe(first.id, OWNER, `${base}/b`);
    await manager.control(first.id, OWNER, "human");
    expect((await manager.close(first.id, OWNER, true)).controller).toBe("human");
    const again = await manager.create({ ownerId: OWNER, runKey: "run-branches" });
    expect(again).toMatchObject({ id: first.id, status: "active", controller: "human" });
    await expect(manager.snapshot(first.id, OWNER)).rejects.toMatchObject({ code: "HUMAN_CONTROL" });
    await manager.control(first.id, OWNER, "agent");
    await manager.close(first.id, OWNER);
  });

  it("enforces the active-session limit", async () => {
    const one = await manager.create({ ownerId: OWNER, runKey: "run-limit-1" });
    const two = await manager.create({ ownerId: OWNER, runKey: "run-limit-2" });
    await expect(manager.create({ ownerId: OWNER, runKey: "run-limit-3" })).rejects.toMatchObject({ code: "SESSION_LIMIT" });
    await manager.close(one.id, OWNER);
    await manager.close(two.id, OWNER);
  });
});

describe.skipIf(!chromiumInstalled)("browser worker persistence and failure", { timeout: 120_000 }, () => {
  let dir = "";
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrapivo-worker-persist-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it.each(["reopen", "create"] as const)("waits for terminal teardown before %s acquires the same profile", async (acquire) => {
    let release!: () => void;
    let teardownStarted!: () => void;
    const teardown = new Promise<void>((resolve) => { teardownStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let launches = 0;
    const manager = await createSessionManager({ dataDir: dir, guard: guardFor(), launch: async (profileDir, options) => {
      const context = await (await import("playwright-core")).chromium.launchPersistentContext(profileDir, options);
      launches++;
      if (launches === 1) {
        const close = context.close.bind(context);
        context.close = async (...args) => { teardownStarted(); await gate; await close(...args); };
      }
      return context;
    } });
    try {
      const runKey = `run-close-acquire-${acquire}`;
      const session = await manager.create({ ownerId: OWNER, runKey });
      await manager.observe(session.id, OWNER, `${base}/set-cookie`);
      const closed = manager.close(session.id, OWNER);
      await teardown;
      // Duplicate closes share the barrier rather than finalizing metadata early.
      const duplicate = manager.close(session.id, OWNER);
      const opened = acquire === "reopen" ? manager.reopen(session.id.toUpperCase(), OWNER) : manager.create({ ownerId: OWNER, runKey });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(launches).toBe(1);
      release();
      expect((await closed).status).toBe("closed");
      expect((await duplicate).status).toBe("closed");
      expect(await opened).toMatchObject({ id: session.id, status: "active" });
      expect(manager.get(session.id, OWNER).status).toBe("active");
      expect(JSON.parse(readFileSync(join(dir, session.id, "session.json"), "utf8")).status).toBe("active");
      expect((await manager.observe(session.id, OWNER, `${base}/echo-cookie`)).text).toContain("sid=abc123");
    } finally {
      release();
      await manager.shutdown();
    }
  });

  it("reopens the same session id with its cookies after a worker restart", async () => {
    const a = await createSessionManager({ dataDir: dir, guard: guardFor() });
    const session = await a.create({ ownerId: OWNER, runKey: "run-persist" });
    await a.observe(session.id, OWNER, `${base}/set-cookie`);
    await a.close(session.id, OWNER);
    await a.shutdown();
    const b = await createSessionManager({ dataDir: dir, guard: guardFor() });
    expect(b.get(session.id, OWNER).status).toBe("closed");
    await b.reopen(session.id, OWNER);
    const echo = await b.observe(session.id, OWNER, `${base}/echo-cookie`);
    expect(echo.text).toContain("sid=abc123");
    await b.shutdown();
  });

  it("keeps a failed launch retryable under the same id without leaving an unusable profile", async () => {
    let fail = true;
    const manager = await createSessionManager({ dataDir: dir, guard: guardFor(), launch: async (profileDir, options) => {
      if (fail) { fail = false; throw new Error("chromium failed to start"); }
      return (await import("playwright-core")).chromium.launchPersistentContext(profileDir, options);
    } });
    const id = "6f1c2b8e-3a4d-4c5e-8f9a-0b1c2d3e4f50";
    await expect(manager.create({ id, ownerId: OWNER })).rejects.toMatchObject({ code: "BROWSER_UNAVAILABLE" });
    expect(manager.get(id, OWNER)).toMatchObject({ status: "error", lastError: "BROWSER_UNAVAILABLE" });
    expect(existsSync(join(dir, id, "profile"))).toBe(false);
    const retried = await manager.reopen(id, OWNER);
    expect(retried).toMatchObject({ id, status: "active" });
    await manager.shutdown();
  });

  it("opens the agent tab before closing the launch tab, so a headed window never runs out of tabs", async () => {
    // Headed Chromium quits once its last tab closes; a new tab then fails.
    const open = new Set<object>();
    const makePage = () => {
      const page = { close: async () => { open.delete(page); }, setDefaultTimeout: () => {}, on: () => {} };
      open.add(page);
      return page;
    };
    const headedContext = () => {
      makePage(); // the tab a headed launch opens
      return {
        pages: () => [...open],
        newPage: async () => {
          if (!open.size) throw new Error("browserContext.newPage: Protocol error (Target.createTarget): Failed to open a new tab");
          return makePage();
        },
        route: async () => {}, routeWebSocket: async () => {}, addCookies: async () => {}, on: () => {},
        close: async () => { open.clear(); }, storageState: async () => ({ cookies: [], origins: [] }),
      };
    };
    const manager = await createSessionManager({ dataDir: dir, guard: guardFor(), launch: async () => headedContext() as never });
    const session = await manager.create({ ownerId: OWNER, runKey: "run-headed-tab", visible: true });
    expect(session.status).toBe("active");
    expect(open.size).toBe(1);
    await manager.shutdown();
  });

  it("closes idle sessions, including a person-controlled one whose viewer went away", async () => {
    const manager = await createSessionManager({ dataDir: dir, guard: guardFor(), idleTimeoutMs: 200, sweepMs: 150 });
    const session = await manager.create({ ownerId: OWNER, runKey: "run-idle" });
    const abandoned = await manager.create({ ownerId: "owner-idle-human", runKey: "run-idle-human" });
    await manager.control(abandoned.id, "owner-idle-human", "human");
    // Closing Chromium takes a moment under load: wait for the outcome, not a fixed time.
    const closed = () => manager.get(session.id, OWNER).status === "closed" && manager.get(abandoned.id, "owner-idle-human").status === "closed";
    for (const deadline = Date.now() + 20_000; !closed() && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(manager.get(session.id, OWNER).status).toBe("closed");
    expect(manager.get(abandoned.id, "owner-idle-human").status).toBe("closed");
    expect(manager.counts().active).toBe(0);
    await manager.shutdown();
  });
});

describe("browser worker routes", () => {
  it("requires a long token, authenticates every request, and exposes no script evaluation", async () => {
    const fake = { counts: () => ({ active: 0, stored: 0, maxActive: 1, maxProfiles: 1 }), get: () => { throw new Error("unreachable"); } } as unknown as SessionManager;
    expect(() => createBrowserRoutes(fake, "short")).toThrow(/32 characters/);
    const token = "t".repeat(40);
    const handle = createBrowserRoutes(fake, token);
    const server = createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    expect((await fetch(`${url}/browser/status`)).status).toBe(401);
    expect((await fetch(`${url}/browser/status`, { headers: { authorization: `Bearer ${"x".repeat(40)}` } })).status).toBe(401);
    expect((await fetch(`${url}/browser/status`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    const evaluate = await fetch(`${url}/browser/sessions/3f2504e0-4f89-41d3-9a0c-0305e82c3301/evaluate`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ownerId: "o", script: "1+1" }),
    });
    expect(evaluate.status).toBe(404);
    const body = await evaluate.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
