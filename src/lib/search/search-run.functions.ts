import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

export const cancelSearchRun = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((data: unknown) => z.object({ search_run_id: z.string().min(1).max(80) }).parse(data))
  .handler(async ({ data, context }) => {
    const { cancelRegisteredSearchRun } = await import("./search-run.server");
    const { finishSearchBrowserProgress } = await import("./search-browser-progress.server");
    cancelRegisteredSearchRun(context.userId, data.search_run_id);
    finishSearchBrowserProgress(data.search_run_id, context.userId);
    return { cancelled: true };
  });
