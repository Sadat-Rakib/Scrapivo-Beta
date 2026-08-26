/**
 * Dedicated Local Businesses search (sidebar page — not Discover).
 * Places/maps listings → website contact harvest → email verification.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { LocalBusinessRow } from "@/lib/search/lead-segments";
import { deriveOpportunityTags } from "@/lib/search/lead-segments";
import type { ExpandedQueries } from "@/lib/search/query-expander";
import {
  isJunkLocalListing,
  isRealBusinessWebsite,
  matchesLocalCraft,
} from "@/lib/search/place-disambiguate.server";
import { normalizeLocalLocation } from "@/lib/local/city-gazetteer";

function toQx(category: string, location: string): ExpandedQueries {
  return {
    raw: `${category} in ${location}`,
    skill: category,
    role: category,
    queryType: "skill",
    relatedSkills: [],
    buyerIntentQueries: [],
    buyerPhrases: [],
    jobBoardQueries: [],
    jobBoardTerms: [],
    socialQueries: [],
    redditBuyerQueries: [],
    booleanWebQueries: [],
    customerPhrases: [],
    subreddits: [],
    negativePhrases: [],
    negativeSignals: [],
  };
}

function cleanDescription(raw: string, name: string, category: string, location: string): string {
  const cleaned = (raw || "")
    .replace(/\b(OpenStreetMap|OSM|Geoapify|Foursquare|Overpass|Jurisdiction hint:?\s*\S+)\b/gi, "")
    .replace(/\b(service|building|office|amenity|craft):[a-z0-9_.-]+/gi, "")
    .replace(/\bLocal business:\s*/gi, "")
    .replace(/\b(City|Location|Address|Website|Phone|Email):\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n+/g, " · ")
    .trim();
  if (cleaned && cleaned.length > 8 && cleaned.toLowerCase() !== name.toLowerCase()) {
    return cleaned.slice(0, 220);
  }
  return `${name} — ${category} in ${location}`;
}

function leadToRow(
  l: {
    source: string;
    title?: string;
    author?: string;
    company?: string;
    snippet?: string;
    full_post_url?: string;
    company_domain?: string;
    platform?: string;
    platform_label?: string;
    why_match?: string;
    score?: number;
    emails?: string[];
    phones?: string[];
    address?: string;
  },
  category: string,
  location: string,
): LocalBusinessRow | null {
  const name = (l.company || l.author || (l.title || "").split(" — ")[0] || "").trim();
  if (!name || name.length < 2) return null;
  if (isJunkLocalListing(name, category)) return null;
  if (!matchesLocalCraft(name, category)) return null;

  const website = isRealBusinessWebsite(l.full_post_url) ? l.full_post_url : undefined;
  let domain = l.company_domain;
  if (!domain && website) {
    try {
      domain = new URL(website).hostname.replace(/^www\./, "");
    } catch {
      /* ignore */
    }
  }

  const phone = l.phones?.[0];
  const email = l.emails?.[0];
  const address = (l.address || "").trim() || undefined;

  return {
    key: [name.toLowerCase(), phone || "", domain || ""].join("|"),
    name,
    category,
    address,
    phone,
    email,
    website,
    domain,
    description: cleanDescription(
      address || l.why_match || l.snippet || "",
      name,
      category,
      location,
    ),
    source: l.source,
    sample_url: website || "",
    score: l.score ?? 50,
    website_status: website ? "listed" : "verified_no_website",
    opportunity_tags: deriveOpportunityTags({
      website,
      email,
      phone,
      address,
      website_status: website ? "listed" : "verified_no_website",
    }),
  };
}

export const runLocalBusinessSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        category: z.string().min(2).max(120),
        location: z.string().min(2).max(120),
        enrichEmails: z.boolean().optional().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, searches_used, searches_reset_at")
      .eq("id", userId)
      .maybeSingle();

    const plan = profile?.plan ?? "free";
    let used = profile?.searches_used ?? 0;
    const resetAt = profile?.searches_reset_at ? new Date(profile.searches_reset_at) : new Date(0);
    if (resetAt < new Date(Date.now() - 86400_000)) used = 0;
    if (plan === "free" && used >= 5) {
      return {
        error: "limit" as const,
        message: "Free plan: 5 searches per day. Try again tomorrow.",
        businesses: [] as LocalBusinessRow[],
        sources: [] as string[],
      };
    }

    const category = data.category.trim();
    const location = normalizeLocalLocation(data.location.trim());
    const qx = toQx(category, location);

    const { searchOsmLocalBusinesses } = await import("./search/osm-local-businesses.server");

    // OSM (Nominatim + Overpass) is PRIMARY and fully free. The paid-optional
    // Places chain only fires when OSM comes back thin AND a key exists.
    const osm = await searchOsmLocalBusinesses(qx, location).catch((err) => {
      console.warn(`[local-businesses] OSM search failed for ${category} in ${location}:`, err);
      return [];
    });

    let places: Awaited<ReturnType<typeof import("./search/foursquare-places.server")["searchLocalBusinesses"]>> = [];
    const anyPlacesKey = !!(process.env.GEOAPIFY_API_KEY || process.env.FOURSQUARE_API_KEY);
    if (osm.length < 12 && anyPlacesKey) {
      const { searchLocalBusinesses } = await import("./search/foursquare-places.server");
      places = await searchLocalBusinesses(qx, location, { directoryMode: true, min: 10 }).catch(
        (err) => {
          console.warn(
            `[local-businesses] Places top-up failed for ${category} in ${location}:`,
            err,
          );
          return [] as typeof places;
        },
      );
    }

    console.info(
      `[local-businesses] ${category} in ${location}: OSM=${osm.length}, PlacesTopUp=${places.length}`,
    );

    const byKey = new Map<string, LocalBusinessRow>();
    for (const l of [...osm, ...places]) {
      const row = leadToRow(l as Parameters<typeof leadToRow>[0], category, location);
      if (!row) continue;
      const prev = byKey.get(row.key);
      if (!prev || row.score > prev.score) byKey.set(row.key, row);
    }

    let businesses = [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 100);

    if (!businesses.length) {
      const { searchOsmLocalBusinesses: osmRetry } =
        await import("./search/osm-local-businesses.server");
      const broader = await osmRetry({ ...qx, skill: category, role: category }, location).catch(
        () => [],
      );
      for (const l of broader) {
        const row = leadToRow(l as Parameters<typeof leadToRow>[0], category, location);
        if (!row) continue;
        byKey.set(row.key, row);
      }
      businesses = [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 100);
    }

    const { claimsFromWebsiteSignals } = await import("./intelligence/evidence");
    const { resolveEntity, dedupeByEntity } = await import("./intelligence/entity-resolve.server");
    businesses = dedupeByEntity(
      businesses.map((b) => ({
        ...b,
        name: b.name,
        domain: b.domain,
        phone: b.phone,
      })),
    );

    // Website provenance: listing had no URL vs unreachable vs present.
    for (const b of businesses) {
      if (b.website && isRealBusinessWebsite(b.website)) b.website_status = "listed";
      else if (!b.website) b.website_status = "verified_no_website";
      else b.website_status = "unknown";
      b.opportunity_tags = deriveOpportunityTags(b);
      b.entity_id = resolveEntity({
        name: b.name,
        domain: b.domain,
        phone: b.phone,
        entityType: "business",
      }).id;
      b.evidence = claimsFromWebsiteSignals({
        website: b.website,
        website_status: b.website_status,
        email: b.email,
        phone: b.phone,
      });
    }

    if (data.enrichEmails !== false) {
      const { discoverContactsForDomain } =
        await import("./contact/shared-contact-intelligence.server");
      const { extractEmailsWithCheerio } = await import("./contact/cheerio-email.server");
      const targets = businesses
        .filter((b) => b.website && isRealBusinessWebsite(b.website))
        .slice(0, 28);
      await Promise.race([
        Promise.allSettled(
          targets.map(async (b) => {
            try {
              const needEmail = !b.email;
              const needPhone = !b.phone;
              let https = true;
              let thinPage = false;
              let missingMeta = false;
              let noViewport: boolean | undefined;
              let hasSocial: boolean | undefined;
              let hasForm: boolean | undefined;
              if (b.website) {
                try {
                  https = new URL(b.website).protocol === "https:";
                } catch {
                  https = false;
                }
              }
              let sharedEmails: { email: string; verified: boolean }[] | undefined;
              if ((needEmail || needPhone) && b.domain) {
                const shared = await discoverContactsForDomain(b.domain, {
                  company: b.name,
                  maxPages: 4,
                  freeOnly: true,
                  skipRegistries: true,
                });
                sharedEmails = shared.emails.map((e) => ({
                  email: e.email,
                  verified: e.verified,
                }));
                if (needEmail && shared.preferredEmail) b.email = shared.preferredEmail;
                if (needPhone && shared.preferredPhone) b.phone = shared.preferredPhone;
                const pagesOk = shared.discovery.harvest?.pages?.filter((p) => p.ok).length ?? 0;
                if (pagesOk === 0) {
                  thinPage = true;
                  b.website_status = "unreachable";
                } else {
                  b.website_status = "listed";
                }
              }
              if ((needEmail && !b.email) || (needPhone && !b.phone)) {
                const { emails, phones } = await extractEmailsWithCheerio(b.website!);
                if (needEmail && !b.email && emails[0]) b.email = emails[0];
                if (needPhone && !b.phone && phones[0]) b.phone = phones[0];
                if (!emails.length && !phones.length) missingMeta = true;
                const htmlBlob = `${emails.join(" ")} ${phones.join(" ")}`;
                void htmlBlob;
              }
              if (b.website) {
                try {
                  const res = await fetch(b.website, {
                    signal: AbortSignal.timeout(8_000),
                    headers: { Accept: "text/html" },
                  });
                  if (res.ok) {
                    const html = (await res.text()).slice(0, 80_000);
                    noViewport = !/name=["']viewport["']/i.test(html);
                    hasSocial = /facebook\.com|instagram\.com|linkedin\.com/i.test(html);
                    hasForm = /<form[\s>]/i.test(html);
                    if (!/<title>[^<]{3,}/i.test(html) || !/name=["']description["']/i.test(html)) {
                      missingMeta = true;
                    }
                    if (html.replace(/<[^>]+>/g, " ").trim().length < 400) thinPage = true;
                  }
                } catch {
                  /* harvest page optional */
                }
              }
              if (b.email) {
                const matched = sharedEmails?.find(
                  (e) => e.email.toLowerCase() === b.email!.toLowerCase(),
                );
                b.email_verified = matched?.verified ?? false;
                delete b.verify_note;
              }
              b.opportunity_tags = deriveOpportunityTags({
                ...b,
                https,
                thinPage,
                missingMeta,
                noViewport,
                hasSocial,
                hasForm,
              });
              b.evidence = claimsFromWebsiteSignals({
                website: b.website,
                website_status: b.website_status,
                email: b.email,
                phone: b.phone,
                https,
                thinPage,
              });
              // Light profile discovery for contact harvest URLs
              if (b.website) {
                try {
                  const { discoverProfiles, profileUrlsForHarvest } =
                    await import("./profile/discover-profiles.server");
                  const profiles = await discoverProfiles(
                    {
                      id: b.entity_id || b.key,
                      name: b.name,
                      domain: b.domain,
                      website: b.website,
                    },
                    { playbook: "LOCAL_BUSINESS" },
                  );
                  const urls = profileUrlsForHarvest(profiles);
                  if (urls.length && needEmail && !b.email) {
                    const { harvestProfileContacts } =
                      await import("./contact/contact-finder.server");
                    const harvested = await harvestProfileContacts(urls.slice(0, 3));
                    if (harvested.emails?.[0]) b.email = harvested.emails[0];
                    if (needPhone && !b.phone && harvested.phones?.[0]) {
                      b.phone = harvested.phones[0];
                    }
                  }
                } catch {
                  /* optional */
                }
              }
            } catch {
              if (b.website) b.website_status = "unreachable";
              b.opportunity_tags = deriveOpportunityTags(b);
            }
          }),
        ),
        new Promise((r) => setTimeout(r, 55_000)),
      ]);
      for (const b of businesses) {
        if (!b.opportunity_tags?.length) b.opportunity_tags = deriveOpportunityTags(b);
      }
      businesses = [...businesses].sort((a, b) => {
        const ae = a.email ? (a.email_verified ? 2 : 1) : 0;
        const be = b.email ? (b.email_verified ? 2 : 1) : 0;
        const ap = a.phone ? 1 : 0;
        const bp = b.phone ? 1 : 0;
        return be - ae || bp - ap || b.score - a.score;
      });
    }

    // Honest labels: only sources that actually contributed rows.
    const sources: string[] = [
      ...new Set([...osm, ...places].map((l) => (l as { source?: string }).source || "osm")),
    ];

    await supabase
      .from("profiles")
      .update({ searches_used: used + 1 })
      .eq("id", userId);
    await supabase.from("search_history").insert({
      user_id: userId,
      query: `local: ${category} in ${location}`,
      results_count: businesses.length,
      sources_searched: sources,
    });

    return {
      error: null as string | null,
      message: businesses.length
        ? null
        : (`No live listings found for ${category} in ${location}. Try a nearby city or a broader category.` as
            | string
            | null),
      businesses,
      sources,
    };
  });
