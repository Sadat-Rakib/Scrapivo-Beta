import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const processUnsubscribe = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { applyUnsubscribe } = await import("@/lib/outreach/unsub-apply.server");
    return applyUnsubscribe(data.token);
  });
