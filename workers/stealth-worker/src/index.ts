import http from "node:http";
import { runScrape } from "./scraper.ts";
import type { ScrapeRequest } from "./types.ts";

const PORT = Number(process.env.STEALTH_WORKER_PORT || 3099);
const TOKEN = process.env.STEALTH_WORKER_TOKEN;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/fetch") {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    try {
      const body = JSON.parse(await readBody(req)) as { url?: string };
      if (!body.url) {
        res.writeHead(400);
        res.end("url required");
        return;
      }
      const { fetchPageUrl } = await import("./scraper.ts");
      const page = await fetchPageUrl(body.url);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(page));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return;
  }

  if (req.method !== "POST" || req.url !== "/scrape") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  try {
    const body = JSON.parse(await readBody(req)) as ScrapeRequest;
    if (!body.query || !Array.isArray(body.platforms)) {
      res.writeHead(400);
      res.end("Invalid request: query and platforms required");
      return;
    }
    const posts = await runScrape(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ posts }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ posts: [], error: (e as Error).message }));
  }
});

server.listen(PORT, () => {
  console.info(`[stealth-worker] listening on http://localhost:${PORT}`);
});
