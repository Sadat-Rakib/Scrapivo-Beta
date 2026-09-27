import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/integrations/my-supabase/admin.server";
import { runDueWatchesForAllUsers } from "@/lib/watch/watch-scheduler.server";

/**
 * Cron: enqueue due signal watches for ALL users (service role). The route
 * itself never returns other users' data — only aggregate counts. Protected
 * with the same CRON_SECRET convention as /api/cron/email-sequences.
 */
export const Route = createFileRoute("/api/cron/signal-watches")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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
