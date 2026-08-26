/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Paste-a-URL intelligence — inline extraction for Jobs / Local Businesses /
 * Investors pages. Free fetch stack + multi-model AI with schema validation.
 * Capped per user per day (URL_INTEL_DAILY_LIMIT, default 10).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { extractWebsiteIntel, generateFollowUps } from "./url-intel/extract.server";

const URL_INTEL_DAILY_LIMIT = Number(process.env.URL_INTEL_DAILY_LIMIT ?? 10);

async function consumeIntelQuota(supabase: { from: (t: string) => any }, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("url_intel_used, url_intel_reset_at")
    .eq("id", userId)
    .maybeSingle();
  let used = profile?.url_intel_used ?? 0;
  const resetAt = profile?.url_intel_reset_at ? new Date(profile.url_intel_reset_at) : null;
  if (!resetAt || Date.now() - resetAt.getTime() > 86_400_000) used = 0;
  if (used >= URL_INTEL_DAILY_LIMIT) {
    return { ok: false as const, used, limit: URL_INTEL_DAILY_LIMIT };
  }
  await supabase
    .from("profiles")
    .update({
      url_intel_used: used + 1,
      url_intel_reset_at: resetAt ?? new Date().toISOString(),
    })
    .eq("id", userId);
  return { ok: true as const, used: used + 1, limit: URL_INTEL_DAILY_LIMIT };
}

export const extractWebsiteIntelFn = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        url: z.string().url().max(500),
        variant: z.enum(["jobs", "local", "investors"]).default("jobs"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const quota = await consumeIntelQuota(context.supabase, context.userId);
    if (!quota.ok) {
      return {
        error: "limit" as const,
        message: `Free plan: ${quota.limit} URL extractions per day. Try again tomorrow.`,
      };
    }

    try {
      const { intel, source } = await extractWebsiteIntel(data.url, data.variant);
      const followUps = await generateFollowUps(intel, data.variant);
      return {
        error: null as string | null,
        intel,
        followUps,
        source,
        remaining: Math.max(0, quota.limit - quota.used),
      };
    } catch (e) {
      return {
        error: "failed" as const,
        message: e instanceof Error ? e.message : "Extraction failed",
      };
    }
  });
