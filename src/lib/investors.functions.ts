/**
 * Investors / VC outreach search.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { searchInvestors, verifyInvestorRecords, getAllInvestors } from "@/lib/investors/search";
import type { InvestorRecord } from "@/lib/investors/types";

export const runInvestorSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        query: z.string().max(200).optional().default(""),
        stage: z.string().max(40).optional(),
        sector: z.string().max(80).optional(),
        location: z.string().max(120).optional(),
        checkBand: z.enum(["angel", "seed", "growth", "any"]).optional(),
        investorType: z.enum(["vc", "angel", "scout", "unknown", "any"]).optional(),
        status: z.enum(["active", "needs_review", "inactive", "any"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const investors = searchInvestors({
      query: data.query,
      stage: data.stage,
      sector: data.sector,
      location: data.location,
      checkBand: data.checkBand,
      investorType: data.investorType,
      status: data.status,
      limit: data.limit ?? 80,
    });
    return {
      error: null as string | null,
      investors,
      total: getAllInvestors().length,
    };
  });

export const refreshInvestorVerification = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .handler(async () => {
    const verified = verifyInvestorRecords(getAllInvestors());
    const needsReview = verified.filter((v) => v.status === "needs_review").length;
    const active = verified.filter((v) => v.status === "active").length;
    return {
      checked: verified.length,
      active,
      needs_review: needsReview,
      sample: verified.filter((v) => v.status === "needs_review").slice(0, 10) as InvestorRecord[],
    };
  });
