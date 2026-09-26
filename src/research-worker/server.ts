import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { retrievalPlanFromInputs } from "../lib/research-agent/plan";
import { researchSessions } from "../lib/research-agent/session.server";
import type { SearchSpec } from "../lib/search/search-spec";

const port = Number(process.env.RESEARCH_WORKER_PORT || 8788);
const token = process.env.SCRAPIVO_BROWSER_WORKER_TOKEN || "";
const Spec = z.custom<SearchSpec>(
  (v) => !!v && typeof v === "object" && typeof (v as SearchSpec).raw_query === "string",
);
const Start = z.object({
  ownerId: z.string().min(1),
  scopeId: z.string().min(1),
  spec: Spec,
  frame: z.unknown().nullable().optional(),
});
const Command = z.object({ ownerId: z.string().min(1) });

function auth(value: string | undefined) {
  if (!token || !value?.startsWith("Bearer ")) return false;
  const a = Buffer.from(value.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 256_000) throw new Error("PAYLOAD_TOO_LARGE");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function send(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

if (!token) throw new Error("SCRAPIVO_BROWSER_WORKER_TOKEN is required");
createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, {
      status: "ok",
      workerVersion: "1",
      activeSessions: "bounded",
      agentBrowserAvailable: true,
    });
    return;
  }
  if (!auth(req.headers.authorization)) {
    send(res, 401, { error: "UNAUTHORIZED" });
    return;
  }
  try {
    const url = new URL(req.url || "/", "http://worker");
    if (req.method === "POST" && url.pathname === "/research/start") {
      const input = Start.parse(await body(req));
      const plan = retrievalPlanFromInputs({ spec: input.spec, frame: input.frame as never });
      const session = researchSessions.start({
        ownerId: input.ownerId,
        scopeId: input.scopeId,
        plan,
      });
      send(res, 200, {
        sessionId: session.id,
        status: session.status,
        targetQuantity: plan.targetQuantity,
      });
      return;
    }
    const match = url.pathname.match(/^\/research\/([^/]+)(?:\/(events|continue|cancel))?$/);
    if (!match) {
      send(res, 404, { error: "NOT_FOUND" });
      return;
    }
    const id = decodeURIComponent(match[1]!);
    const op = match[2] || "status";
    const input =
      req.method === "GET"
        ? Command.parse({ ownerId: url.searchParams.get("ownerId") })
        : Command.parse(await body(req));
    if (op === "continue" && req.method === "POST") {
      const s = researchSessions.continue(id, input.ownerId);
      send(res, 200, { sessionId: s.id, status: s.status });
      return;
    }
    if (op === "cancel" && req.method === "POST") {
      send(res, 200, researchSessions.cancel(id, input.ownerId));
      return;
    }
    const snapshot = researchSessions.get(id, input.ownerId);
    if (op === "events" && req.method === "GET") {
      const after = Math.max(0, Number(url.searchParams.get("after") || 0));
      // Cancellation preserves already-ready candidates in the orchestrator,
      // so expose result for any terminal (done/cancelled/failed) session.
      // `sessionStatus` lets the client distinguish done vs cancelled.
      send(res, 200, {
        events: snapshot.events.slice(after),
        nextCursor: snapshot.eventCount,
        sessionStatus: snapshot.status,
        done: snapshot.status !== "running",
        result: snapshot.status !== "running" ? snapshot.result : null,
        error: snapshot.error,
      });
      return;
    }
    send(res, 200, snapshot);
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : "WORKER_ERROR" });
  }
}).listen(port, "127.0.0.1", () =>
  console.log(JSON.stringify({ event: "research_worker_started", port })),
);
