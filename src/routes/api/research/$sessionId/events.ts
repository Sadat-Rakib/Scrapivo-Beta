import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

async function userIdForRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const url = process.env.MY_SUPABASE_URL;
  const key = process.env.MY_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const token = auth.slice(7);
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

export const Route = createFileRoute("/api/research/$sessionId/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // `.server` modules load dynamically — a top-level import leaks server-only
        // deps into the client route graph and breaks the vite client build.
        const { researchSessions } = await import("@/lib/research-agent/session.server");
        const userId = await userIdForRequest(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });
        try {
          const stream = researchSessions.stream(params.sessionId, userId, request.signal);
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
