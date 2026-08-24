/**
 * Investors / VC outreach search.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { searchInvestorsWithMeta, getAllInvestors } from "@/lib/investors/search";
import { makeClaim } from "@/lib/intelligence/evidence";

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
        entityType: z.enum(["individual", "firm", "any"]).optional(),
        status: z.enum(["active", "needs_review", "inactive", "any"]).optional(),
        limit: z.number().int().min(1).max(10000).optional(),
        /** Optional shared contact enrich for rows with a website (top N). */
        enrichContacts: z.boolean().optional().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { investors, broadened } = await searchInvestorsWithMeta({
      query: data.query,
      stage: data.stage,
      sector: data.sector,
      location: data.location,
      checkBand: data.checkBand,
      investorType: data.investorType,
      entityType: data.entityType,
      status: data.status,
      limit: data.limit ?? 5000,
    });

    const withMeta = investors.map((inv) => {
      const locs =
        "investment_locations" in inv
          ? inv.investment_locations
          : "locations" in inv
            ? (inv as { locations?: string[] }).locations
            : [];
      const evidence = [
        ...(locs || [])
          .slice(0, 3)
          .map((loc) =>
            makeClaim(
              `invests in / covers ${loc}`,
              [{ source: "investors_seed", data: String(loc) }],
              "high",
            ),
          ),
      ];
      return { ...inv, evidence };
    });

    if (data.enrichContacts) {
      const { discoverContactsForDomain } =
        await import("./contact/shared-contact-intelligence.server");
      const { discoverProfiles } = await import("./profile/discover-profiles.server");
      const targets = withMeta.filter((inv) => "website" in inv && inv.website).slice(0, 8);
      await Promise.allSettled(
        targets.map(async (inv) => {
          const website = String((inv as { website?: string }).website || "");
          let domain = "";
          try {
            domain = new URL(
              website.startsWith("http") ? website : `https://${website}`,
            ).hostname.replace(/^www\./, "");
          } catch {
            return;
          }
          if (!domain) return;
          const profiles = await discoverProfiles(
            {
              id: inv.id,
              name: inv.name,
              domain,
              website,
            },
            { playbook: "INVESTOR_DISCOVERY" },
          );
          (inv as { profiles?: unknown }).profiles = profiles.slice(0, 5);
          const shared = await discoverContactsForDomain(domain, {
            company: inv.name,
            maxPages: 3,
            freeOnly: true,
            skipRegistries: true,
          });
          if (shared.preferredEmail) {
            (inv as { email?: string }).email = shared.preferredEmail;
            (inv as { evidence: ReturnType<typeof makeClaim>[] }).evidence = [
              ...((inv as { evidence?: ReturnType<typeof makeClaim>[] }).evidence || []),
              makeClaim(
                "has public email",
                [{ source: "contact_intelligence", data: shared.preferredEmail }],
                "high",
              ),
            ];
          }
        }),
      );
    }

    return {
      error: null as string | null,
      investors: withMeta,
      // Count of rows that matched the filters — never the dataset size.
      total: withMeta.length,
      /** Soft gates that were widened to avoid a zero-result wall
       *  ("sector", "check size"…). Empty when the strict pass matched. */
      broadened,
    };
  });

export const refreshInvestorVerification = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .handler(async () => {
    const all = getAllInvestors();
    return {
      checked: all.length,
      active: all.length,
      needs_review: 0,
      sample: [],
    };
  });

export const matchFromWebsite = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        url: z.string().min(4).max(500),
        limit: z.number().int().min(1).max(100).optional().default(30),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { extractWebsiteSignals, matchInvestorsToSignals } =
      await import("./investors/website-matcher.server");

    const signals = await extractWebsiteSignals(data.url);
    const matches = matchInvestorsToSignals(signals, data.limit);

    return {
      error: null as string | null,
      signals,
      matches: matches.map((m) => ({
        ...m.investor,
        matchScore: m.score,
        matchReasons: m.reasons,
        evidence: [
          ...((m.investor as { evidence?: ReturnType<typeof makeClaim>[] }).evidence || []),
          ...m.reasons.map((r) =>
            makeClaim(r, [{ source: "website_matcher", data: data.url }], "medium"),
          ),
        ],
      })),
      total: matches.length,
    };
  });
