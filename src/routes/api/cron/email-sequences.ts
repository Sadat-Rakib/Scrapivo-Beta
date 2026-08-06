import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/integrations/my-supabase/admin.server";
import { processDueSequenceSteps } from "@/lib/outreach/sequences.server";

export const Route = createFileRoute("/api/cron/email-sequences")({
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

        const result = await processDueSequenceSteps(getAdmin());
        return Response.json(result);
      },
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && auth !== `Bearer ${cronSecret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        const result = await processDueSequenceSteps(getAdmin());
        return Response.json(result);
      },
    },
  },
});
