/**
 * Private HTTP routes for browser sessions, mounted under /browser by the
 * research worker process. Every route requires the worker token (constant-time
 * comparison) and an ownerId; the app server enforces user auth and passes the
 * authenticated owner. Errors are typed and sanitized.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkerError } from "./errors";
import { validateSessionId, type AgentAction, type HumanInput, type SessionManager } from "./session-manager";

const MAX_BODY = 64 * 1024;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) throw new WorkerError("BODY_TOO_LARGE", "Request body exceeds 64 KiB.", 413);
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new WorkerError("INVALID_BODY", "A JSON object is required.");
  }
}

export function createBrowserRoutes(manager: SessionManager, token: string) {
  if (token.length < 32) throw new Error("The browser worker token must contain at least 32 characters.");
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  const authorized = (header: string | undefined) => timingSafeEqual(createHash("sha256").update(header ?? "").digest(), expected);

  /** Returns true when the request was a /browser route (handled or rejected). */
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://worker");
    if (!url.pathname.startsWith("/browser/")) return false;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const json = (status: number, body: unknown) => {
      if (response.headersSent || response.destroyed) return;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
    };
    // Client disconnect (fetch aborted) cancels the in-flight operation.
    const abort = new AbortController();
    response.on("close", () => { if (!response.writableEnded) abort.abort(); });
    try {
      if (!authorized(request.headers.authorization)) throw new WorkerError("UNAUTHORIZED", "Worker authentication is required.", 401);
      const method = request.method ?? "GET";
      if (url.pathname === "/browser/status" && method === "GET") { json(200, { status: "ok", ...manager.counts() }); return true; }
      const body = method === "POST" ? await readJson(request) : {};
      const ownerId = String((method === "GET" ? url.searchParams.get("ownerId") : body.ownerId) ?? "");
      if (!ownerId || ownerId.length > 120) throw new WorkerError("INVALID_BODY", "ownerId is required.");
      if (url.pathname === "/browser/sessions" && method === "GET") { json(200, manager.list(ownerId)); return true; }
      if (url.pathname === "/browser/sessions" && method === "POST") {
        const created = await manager.create({ id: typeof body.id === "string" ? body.id : undefined, ownerId, runKey: typeof body.runKey === "string" ? body.runKey : null, visible: body.visible === true });
        // The caller left while Chromium was starting (run cancelled): nobody
        // will ever close this lane, so do not leave it running.
        if (abort.signal.aborted) { await manager.close(created.id, ownerId).catch(() => undefined); return true; }
        json(201, created);
        return true;
      }
      const match = /^\/browser\/sessions\/([^/]+)(?:\/(observe|snapshot|act|extract|links|screenshot|control|input|close|reopen))?$/.exec(url.pathname);
      if (!match) throw new WorkerError("NOT_FOUND", "Worker endpoint not found.", 404);
      const id = validateSessionId(match[1]);
      const op = match[2] ?? "get";
      const text = (value: unknown, field: string, max: number) => {
        if (typeof value !== "string" || value.length > max) throw new WorkerError("INVALID_BODY", `${field} is required.`);
        return value;
      };
      if (op === "get" && method === "GET") json(200, manager.get(id, ownerId));
      else if (op === "observe" && method === "POST") json(200, await manager.observe(id, ownerId, text(body.url, "url", 8192), abort.signal));
      else if (op === "snapshot" && method === "GET") json(200, await manager.snapshot(id, ownerId, abort.signal));
      else if (op === "act" && method === "POST") json(200, await manager.act(id, ownerId, typeof body.snapshotId === "string" ? body.snapshotId : null, (body.action ?? {}) as AgentAction, abort.signal));
      else if (op === "extract" && method === "POST") json(200, await manager.extract(id, ownerId, (body.fields ?? {}) as never, abort.signal));
      else if (op === "links" && method === "POST") json(200, await manager.links(id, ownerId, text(body.selector, "selector", 300), Number(body.timeoutMs ?? 5_000), abort.signal));
      else if (op === "control" && method === "POST") {
        if (body.mode !== "human" && body.mode !== "agent") throw new WorkerError("INVALID_BODY", "mode must be human or agent.");
        json(200, await manager.control(id, ownerId, body.mode));
      } else if (op === "input" && method === "POST") json(200, await manager.input(id, ownerId, (body.input ?? {}) as HumanInput));
      else if (op === "close" && method === "POST") json(200, await manager.close(id, ownerId, body.retain === true));
      else if (op === "reopen" && method === "POST") json(200, await manager.reopen(id, ownerId));
      else if (op === "screenshot" && method === "GET") {
        const bytes = await manager.screenshot(id, ownerId);
        if (!response.headersSent) { response.writeHead(200, { "content-type": "image/jpeg", "content-length": bytes.length }); response.end(bytes); }
      } else throw new WorkerError("NOT_FOUND", "Worker endpoint not found.", 404);
    } catch (error) {
      const safe = error instanceof WorkerError ? error : new WorkerError("WORKER_FAILURE", "The browser operation failed.", 500);
      json(safe.status, { error: { code: safe.code, message: safe.message } });
    }
    return true;
  };
}
