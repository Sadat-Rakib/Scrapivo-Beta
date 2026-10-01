import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
let respond: (path: string, body?: Record<string, unknown>) => unknown = () => ({});
vi.mock("@/lib/research-agent/browser-worker-client.server", async (original) => {
  const actual = await original<typeof import("@/lib/research-agent/browser-worker-client.server")>();
  return {
    ...actual,
    callBrowserWorker: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      calls.push({ method, path, body });
      return respond(path, body);
    }),
  };
});

import { BrowserWorkerError } from "@/lib/research-agent/browser-worker-client.server";
import { frameCoordinates } from "../scrapy-browser-control";
import { controlScrapyBrowser } from "../scrapy-browser-control.server";
import { readScrapyBrowserState, scrapySessionControl, scrapySessionFinished, scrapySessionStarted } from "../scrapy-browser.server";

const SESSION = "0b8f6a3e-5c1d-4e2f-9a7b-1c2d3e4f5a6b";
const start = (runId: string, adapter: "worker" | "playwright" = "worker", owner = "user-1") =>
  scrapySessionStarted({ sessionId: `${SESSION.slice(0, -4)}${runId.slice(-4).padStart(4, "0")}`, runId, ownerId: owner, adapter });
const frame = Buffer.from("jpeg-bytes");

beforeEach(() => {
  calls.length = 0;
  respond = (path) => (path.includes("/screenshot") ? frame : path.endsWith("/control") ? { id: SESSION, status: "active", controller: "human" } : { id: SESSION, status: "active", controller: "human", url: "https://acme.test/", title: "Acme" });
});

describe("frame coordinates", () => {
  it("maps the displayed frame to the 1280x800 viewport and ignores letterbox bars", () => {
    const box = { left: 100, top: 50, width: 640, height: 400 };
    expect(frameCoordinates({ clientX: 100, clientY: 50 }, box)).toEqual({ x: 0, y: 0 });
    expect(frameCoordinates({ clientX: 420, clientY: 250 }, box)).toEqual({ x: 640, y: 400 });
    // A frame drawn with object-contain inside a taller box: bars above/below.
    const tall = { left: 0, top: 0, width: 640, height: 600 };
    expect(frameCoordinates({ clientX: 320, clientY: 50 }, tall)).toBeNull();
    expect(frameCoordinates({ clientX: 320, clientY: 300 }, tall)).toEqual({ x: 640, y: 400 });
    expect(frameCoordinates({ clientX: 5, clientY: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe("take control / give back / close", () => {
  it("only addresses the signed-in owner's worker session", async () => {
    start("run-owner-0001");
    expect(await controlScrapyBrowser("run-owner-0001", "user-2", { type: "take" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await controlScrapyBrowser("run-owner-0001", "", { type: "take" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await controlScrapyBrowser("run-missing-0002", "user-1", { type: "take" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    start("run-legacy-0003", "playwright");
    expect(await controlScrapyBrowser("run-legacy-0003", "user-1", { type: "take" })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
    expect(calls).toEqual([]);
  });

  it("takes control, sends only in-bounds input while in control, and gives control back", async () => {
    start("run-take-0004");
    // Input before taking control never reaches the worker.
    expect(await controlScrapyBrowser("run-take-0004", "user-1", { type: "click", x: 10, y: 10 })).toMatchObject({ ok: false, code: "NOT_IN_CONTROL" });
    expect(calls).toEqual([]);
    expect(await controlScrapyBrowser("run-take-0004", "user-1", { type: "take" })).toEqual({ ok: true, controller: "human", retained: false, closed: false });
    expect(calls[0]).toMatchObject({ method: "POST", path: expect.stringMatching(/\/control$/), body: { ownerId: "user-1", mode: "human" } });
    const state = readScrapyBrowserState("run-take-0004", "user-1")!;
    expect(state).toMatchObject({ controller: "human", status: "user_control" });
    expect(state.lastScreenshotData).toBe(frame.toString("base64"));
    calls.length = 0;
    await controlScrapyBrowser("run-take-0004", "user-1", { type: "click", x: 1279.7, y: -3 });
    expect(calls[0]).toMatchObject({ path: expect.stringMatching(/\/input$/), body: { ownerId: "user-1", input: { type: "click", x: 1279, y: 0 } } });
    expect(readScrapyBrowserState("run-take-0004", "user-1")).toMatchObject({ currentUrl: "https://acme.test/", currentTitle: "Acme" });
    respond = (path) => (path.includes("/screenshot") ? frame : { id: SESSION, status: "active", controller: "agent" });
    expect(await controlScrapyBrowser("run-take-0004", "user-1", { type: "release" })).toMatchObject({ ok: true, controller: "agent" });
    expect(readScrapyBrowserState("run-take-0004", "user-1")).toMatchObject({ controller: "agent", status: "active" });
  });

  it("closes only a finished run's kept-open browser", async () => {
    start("run-close-0005");
    expect(await controlScrapyBrowser("run-close-0005", "user-1", { type: "close" })).toMatchObject({ ok: false, code: "BUSY" });
    expect(calls).toEqual([]);
    const { sessionId } = readScrapyBrowserState("run-close-0005", "user-1")!;
    scrapySessionControl(sessionId, { retained: true });
    scrapySessionFinished(sessionId, "completed");
    expect(await controlScrapyBrowser("run-close-0005", "user-1", { type: "close" })).toEqual({ ok: true, controller: "agent", retained: false, closed: true });
    expect(calls[0]).toMatchObject({ path: expect.stringMatching(/\/close$/), body: { ownerId: "user-1", retain: false } });
    // Once closed, it cannot be controlled again.
    expect(await controlScrapyBrowser("run-close-0005", "user-1", { type: "take" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("a lane re-used by the next branch of the same run keeps the person in control", async () => {
    start("run-branch-0007");
    const { sessionId } = readScrapyBrowserState("run-branch-0007", "user-1")!;
    await controlScrapyBrowser("run-branch-0007", "user-1", { type: "take" });
    scrapySessionControl(sessionId, { retained: true });
    scrapySessionStarted({ sessionId, runId: "run-branch-0007", ownerId: "user-1", adapter: "worker" });
    expect(readScrapyBrowserState("run-branch-0007", "user-1")).toMatchObject({ controller: "human", status: "user_control", retained: false });
    // A different owner never inherits it.
    scrapySessionStarted({ sessionId: `${sessionId.slice(0, -4)}9999`, runId: "run-branch-0008", ownerId: "user-2", adapter: "worker" });
    expect(readScrapyBrowserState("run-branch-0008", "user-2")).toMatchObject({ controller: "agent" });
  });

  it("reports worker failures as friendly typed errors", async () => {
    start("run-fail-0006");
    respond = () => { throw new BrowserWorkerError("WORKER_UNAVAILABLE", "down", 503); };
    expect(await controlScrapyBrowser("run-fail-0006", "user-1", { type: "take" })).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE" });
    respond = () => { throw new BrowserWorkerError("SESSION_CLOSED", "closed", 409); };
    expect(await controlScrapyBrowser("run-fail-0006", "user-1", { type: "take" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
