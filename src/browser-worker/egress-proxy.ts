/**
 * Loopback-only egress proxy for Chromium. Every upstream socket connects to
 * the address the guard validated — never a second DNS lookup — which pins
 * validated hosts and defeats DNS rebinding. Redirects and subresources go
 * through the same check because every connection does.
 *
 * Adapted from OpenMuse `apps/worker/src/proxy.ts` (MIT, © 2026 OpenMuse
 * contributors) — see THIRD_PARTY_NOTICES.md.
 */
import { once } from "node:events";
import { createServer, type OutgoingHttpHeaders, request } from "node:http";
import { connect, type Socket } from "node:net";
import type { UrlGuard } from "./network-guard";

export async function startEgressProxy(guard: UrlGuard) {
  const sockets = new Set<Socket>();
  const server = createServer(async (incoming, response) => {
    try {
      const target = await guard(incoming.url ?? "");
      if (target.url.protocol !== "http:") throw new Error("HTTP proxy requires HTTP URL");
      const headers: OutgoingHttpHeaders = { ...incoming.headers, host: target.url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = request(
        {
          hostname: target.address,
          family: target.family,
          port: Number(target.url.port || 80),
          path: `${target.url.pathname}${target.url.search}`,
          method: incoming.method,
          headers,
          timeout: 30_000,
          agent: false,
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.on("error", () => response.destroy());
          result.pipe(response);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      incoming.on("aborted", () => upstream.destroy());
      response.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    } catch {
      response.writeHead(403);
      response.end("Destination blocked");
    }
  });
  server.on("connect", async (req, client, head) => {
    client.on("error", () => client.destroy());
    try {
      // Tunnels only to :443 (TLS). Plain HTTP uses the request path above.
      const authority = req.url ?? "";
      if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+):443$/i.test(authority)) throw new Error("Invalid tunnel");
      const target = await guard(`https://${authority}`);
      if (client.destroyed) return;
      const upstream = connect({ host: target.address, port: 443, family: target.family });
      sockets.add(upstream);
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.on("close", () => { sockets.delete(upstream); client.destroy(); });
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Proxy unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
