/**
 * Authenticated server function for Take control / Give back / Close on the
 * visible research browser. Only the signed-in owner of a run can address its
 * browser; the command set is closed (no URLs, no scripts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { SCRAPY_KEYS, SCRAPY_SCROLL_MAX, SCRAPY_TEXT_MAX, SCRAPY_VIEWPORT, type ScrapyControlResult } from "./scrapy-browser-control";

const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("take") }),
  z.object({ type: z.literal("release") }),
  z.object({ type: z.literal("close") }),
  z.object({ type: z.literal("click"), x: z.number().min(0).max(SCRAPY_VIEWPORT.width - 1), y: z.number().min(0).max(SCRAPY_VIEWPORT.height - 1) }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(SCRAPY_TEXT_MAX) }),
  z.object({ type: z.literal("key"), key: z.enum(SCRAPY_KEYS) }),
  z.object({ type: z.literal("scroll"), deltaY: z.number().int().min(-SCRAPY_SCROLL_MAX).max(SCRAPY_SCROLL_MAX) }),
]);

export const controlScrapyBrowserFn = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator(z.object({ search_run_id: z.string().min(1).max(80), command }))
  .handler(async ({ data, context }): Promise<ScrapyControlResult> => {
    const { controlScrapyBrowser } = await import("./scrapy-browser-control.server");
    return controlScrapyBrowser(data.search_run_id, String(context?.userId ?? ""), data.command);
  });
