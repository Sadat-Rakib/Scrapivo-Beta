/**
 * Jobs search — live ATS JSON + remote APIs + GitHub/RSS.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { ensureJobCatalogRegistered } from "@/lib/jobs/source-catalog";
import { fetchAllJobSourcesWithMeta, listJobSources } from "@/lib/jobs/registry";
import { ALL_JOB_SOURCE_IDS } from "@/lib/jobs/types";
import { awaitProviderSlot } from "@/lib/intelligence/provider-rate-limit.server";

export const runJobSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        query: z.string().max(120).optional().default(""),
        location: z.string().max(120).optional().default(""),
        remoteOnly: z.boolean().optional().default(false),
        seniority: z.string().max(40).optional().default("any"),
        region: z
          .enum(["any", "remote", "north_america", "europe", "asia", "middle_east"])
          .optional()
          .default("any"),
        sources: z.array(z.string().max(40)).optional().default(ALL_JOB_SOURCE_IDS),
        limit: z.number().int().min(1).max(500).optional().default(100),
        contactRoles: z.array(z.string().max(60)).max(8).optional().default([]),
        enrichEmployers: z.boolean().optional().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    ensureJobCatalogRegistered();
    await awaitProviderSlot("greenhouse", { n: 1 });
    await awaitProviderSlot("lever", { n: 1 });
    await awaitProviderSlot("ashby", { n: 1 });

    const { jobs, fetched } = await fetchAllJobSourcesWithMeta({
      query: data.query,
      location: data.location,
      remoteOnly: data.remoteOnly,
      seniority: data.seniority === "any" ? undefined : data.seniority,
      region: data.region,
      sources: data.sources as typeof ALL_JOB_SOURCE_IDS,
      limit: data.limit,
      contactRoles: data.contactRoles,
    });
    const limited = jobs.slice(0, data.limit).map((j) => ({
      ...j,
      company_domain: j.company_domain ?? null,
      contacts: j.contacts ?? [],
    }));

    if (data.enrichEmployers && data.contactRoles.length) {
      const { discoverContactsForDomain } =
        await import("./contact/shared-contact-intelligence.server");
      const sample = limited.filter((j) => j.company_domain).slice(0, 5);
      await Promise.allSettled(
        sample.map(async (j) => {
          if (!j.company_domain) return;
          const shared = await discoverContactsForDomain(j.company_domain, {
            company: j.company,
            maxPages: 3,
            freeOnly: true,
            skipRegistries: true,
          });
          if (shared.preferredEmail) {
            j.contacts = [
              {
                title: data.contactRoles[0],
                email: shared.preferredEmail,
              },
            ];
          }
        }),
      );
    }

    return {
      error: null as string | null,
      jobs: limited,
      total: limited.length,
      fetched,
      contactRoles: data.contactRoles,
      sources: listJobSources().map((s) => ({ id: s.id, label: s.label })),
    };
  });
