/**
 * Take control / give back / close for the visible research browser (worker
 * runtime only). The app server authenticates the user; this module only
 * addresses the session registered for (runId, ownerId), and the worker checks
 * the same owner again. The worker token never leaves the server.
 */
import { BrowserWorkerError, callBrowserWorker } from "@/lib/research-agent/browser-worker-client.server";
import {
  readScrapyBrowserState,
  scrapySessionAction,
  scrapySessionControl,
  scrapySessionScreenshotData,
  type ScrapyBrowserState,
} from "./scrapy-browser.server";
import { SCRAPY_VIEWPORT, type ScrapyControlCommand, type ScrapyControlResult } from "./scrapy-browser-control";

type WorkerSessionView = { id: string; status: string; controller: "agent" | "human"; url?: string; title?: string };

const IN_CONTROL = "You're in control. Scrapy is paused";
const FRAME_REFRESH_MS = 1_200;

async function refreshFrame(sessionId: string, ownerId: string): Promise<void> {
  try {
    const bytes = await callBrowserWorker<Buffer>("GET", `/browser/sessions/${sessionId}/screenshot?ownerId=${encodeURIComponent(ownerId)}`, undefined, { timeoutMs: 8_000, binary: true });
    scrapySessionScreenshotData(sessionId, bytes.toString("base64"));
  } catch { /* the last frame stays on screen */ }
}

/**
 * A fresh frame for a person watching a retained or human-controlled worker
 * session (throttled). While the agent drives, the adapter captures frames.
 */
export async function freshWorkerFrame(state: ScrapyBrowserState): Promise<void> {
  if (state.adapter !== "worker" || !(state.controller === "human" || state.retained)) return;
  if (state.lastScreenshotAt && Date.now() - state.lastScreenshotAt < FRAME_REFRESH_MS) return;
  await refreshFrame(state.sessionId, state.ownerId);
}

function failure(error: unknown): ScrapyControlResult {
  const code = error instanceof BrowserWorkerError ? error.code : "";
  if (code === "SESSION_NOT_FOUND" || code === "SESSION_CLOSED") return { ok: false, code: "NOT_FOUND", message: "This browser session is no longer open." };
  if (code === "NOT_IN_CONTROL") return { ok: false, code: "NOT_IN_CONTROL", message: "Take control of the browser first." };
  if (code === "INVALID_INPUT") return { ok: false, code: "INVALID_INPUT", message: "The browser did not accept that input." };
  if (code === "WORKER_UNAVAILABLE" || code === "WORKER_TIMEOUT" || code === "WORKER_UNCONFIGURED") return { ok: false, code: "WORKER_UNAVAILABLE", message: "The browser worker is not reachable right now." };
  return { ok: false, code: "FAILED", message: "The browser action could not be completed." };
}

export async function controlScrapyBrowser(runId: string, ownerId: string, command: ScrapyControlCommand): Promise<ScrapyControlResult> {
  const state = ownerId ? readScrapyBrowserState(runId, ownerId) : null;
  if (!state) return { ok: false, code: "NOT_FOUND", message: "This browser session is no longer available." };
  if (state.adapter !== "worker") return { ok: false, code: "UNSUPPORTED", message: "Taking control needs the Scrapivo browser worker." };
  const finished = state.status === "completed" || state.status === "cancelled" || state.status === "failed";
  if (finished && !state.retained) return { ok: false, code: "NOT_FOUND", message: "This browser session is closed." };
  const id = state.sessionId;
  try {
    if (command.type === "take" || command.type === "release") {
      // The worker waits for any in-flight agent step before switching.
      const session = await callBrowserWorker<WorkerSessionView>("POST", `/browser/sessions/${id}/control`,
        { ownerId, mode: command.type === "take" ? "human" : "agent" }, { timeoutMs: 60_000 });
      scrapySessionControl(id, { controller: session.controller });
      scrapySessionAction(id, { action: session.controller === "human" ? IN_CONTROL : state.retained ? "Session kept open" : "Scrapy resumed" });
      await refreshFrame(id, ownerId);
      return { ok: true, controller: session.controller, retained: state.retained, closed: false };
    }
    if (command.type === "close") {
      // Closing is for a finished run's kept-open browser, never a live run.
      if (!state.retained) return { ok: false, code: "BUSY", message: "Stop the search before closing its browser." };
      await callBrowserWorker("POST", `/browser/sessions/${id}/close`, { ownerId, retain: false }, { timeoutMs: 15_000 });
      scrapySessionControl(id, { retained: false, controller: "agent" });
      scrapySessionAction(id, { action: "Browser closed" });
      return { ok: true, controller: "agent", retained: false, closed: true };
    }
    if (state.controller !== "human") return { ok: false, code: "NOT_IN_CONTROL", message: "Take control of the browser first." };
    const input = command.type === "click"
      ? { type: "click", x: Math.min(SCRAPY_VIEWPORT.width - 1, Math.max(0, Math.round(command.x))), y: Math.min(SCRAPY_VIEWPORT.height - 1, Math.max(0, Math.round(command.y))) }
      : command;
    const session = await callBrowserWorker<WorkerSessionView>("POST", `/browser/sessions/${id}/input`, { ownerId, input }, { timeoutMs: 20_000 });
    scrapySessionAction(id, { action: IN_CONTROL, url: session.url, title: session.title });
    await refreshFrame(id, ownerId);
    return { ok: true, controller: session.controller, retained: state.retained, closed: false };
  } catch (error) {
    return failure(error);
  }
}
