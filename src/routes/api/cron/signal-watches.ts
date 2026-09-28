import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: enqueue due signal watches for ALL users (service role). The route
 * itself never returns other users' data — only aggregate counts. Protected
 * with the same CRON_SECRET convention as /api/cron/email-sequences.
 */
export const Route = createFileRoute("/api/cron/signal-watches")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // `.server` modules load dynamically — a top-level import leaks server-only
        // deps into the client route graph and breaks the vite client build.
        const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
        const { runDueWatchesForAllUsers } = await import("@/lib/watch/watch-scheduler.server");
        const auth = request.headers.get("authorization") || "";
        const cronSecret = process.env.CRON_SECRET;
        const url = new URL(request.url);
        const q = url.searchParams.get("secret");

        const ok =
          (cronSecret && (auth === `Bearer ${cronSecret}` || q === cronSecret)) ||
          (!cronSecret && process.env.NODE_ENV !== "production");

        if (!ok) {
          return new Response("Unauthorized", { status: 401 });
        }

        const result = await runDueWatchesForAllUsers(getAdmin());
        return Response.json(result);
      },
      POST: async ({ request }) => {
        // `.server` modules load dynamically — a top-level import leaks server-only
        // deps into the client route graph and breaks the vite client build.
        const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
        const { runDueWatchesForAllUsers } = await import("@/lib/watch/watch-scheduler.server");
        const auth = request.headers.get("authorization") || "";
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && auth !== `Bearer ${cronSecret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        const result = await runDueWatchesForAllUsers(getAdmin());
        return Response.json(result);
      },
    },
  },
});
