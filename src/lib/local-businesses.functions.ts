/**
 * Dedicated Local Businesses search (sidebar page — not Discover).
 * Places/maps listings → website contact harvest → email verification.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import type { LocalBusinessRow } from "@/lib/search/lead-segments";
import type { ExpandedQueries } from "@/lib/search/query-expander";
import {
  isJunkLocalListing,
  isRealBusinessWebsite,
  matchesLocalCraft,
} from "@/lib/search/place-disambiguate.server";

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

  return {
    key: name.toLowerCase(),
    name,
    category,
    phone: l.phones?.[0],
    email: l.emails?.[0],
    website,
    domain,
    description: cleanDescription(
      l.why_match || l.snippet || "",
      name,
      category,
      location,
    ),
    source: l.source,
    sample_url: website || "",
    score: l.score ?? 50,
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
    const location = data.location.trim();
    const qx = toQx(category, location);

    const { searchOsmLocalBusinesses } = await import("./search/osm-local-businesses.server");
    const { searchLocalBusinesses } = await import("./search/foursquare-places.server");

    const [osm, places] = await Promise.all([
      searchOsmLocalBusinesses(qx, location).catch(() => []),
      searchLocalBusinesses(qx, location, { directoryMode: true, min: 8 }).catch(() => []),
    ]);

    const byKey = new Map<string, LocalBusinessRow>();
    for (const l of [...osm, ...places]) {
      const row = leadToRow(l as Parameters<typeof leadToRow>[0], category, location);
      if (!row) continue;
      const prev = byKey.get(row.key);
      if (!prev || row.score > prev.score) byKey.set(row.key, row);
    }

    let businesses = [...byKey.values()].sort((a, b) => {
      const aw = a.website ? 1 : 0;
      const bw = b.website ? 1 : 0;
      return bw - aw || b.score - a.score;
    }).slice(0, 80);

    if (data.enrichEmails !== false) {
      const { extractEmailsWithCheerio } = await import("./contact/cheerio-email.server");
      const { verifyEmailDeep } = await import("./contact/verify-contact.server");
      // Deep-harvest top 5 with real websites first.
      const targets = businesses.filter((b) => b.website && isRealBusinessWebsite(b.website)).slice(0, 5);
      await Promise.race([
        Promise.allSettled(
          targets.map(async (b) => {
            try {
              const needEmail = !b.email;
              const needPhone = !b.phone;
              if (needEmail || needPhone) {
                const { emails, phones } = await extractEmailsWithCheerio(b.website!);
                if (needEmail && emails[0]) b.email = emails[0];
                if (needPhone && phones[0]) b.phone = phones[0];
              }
              if (b.email) {
                const v = await verifyEmailDeep(b.email);
                b.email_verified = v.tier === "verified";
                delete b.verify_note;
              }
            } catch {
              /* skip one */
            }
          }),
        ),
        new Promise((r) => setTimeout(r, 50_000)),
      ]);
      businesses = [...businesses].sort((a, b) => {
        const ae = a.email ? (a.email_verified ? 2 : 1) : 0;
        const be = b.email ? (b.email_verified ? 2 : 1) : 0;
        const ap = a.phone ? 1 : 0;
        const bp = b.phone ? 1 : 0;
        return be - ae || bp - ap || b.score - a.score;
      });
    }

    const sources = [
      ...new Set([
        ...(osm.length ? ["osm"] : []),
        ...(places.length ? ["geoapify", "foursquare"] : []),
      ]),
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
      message: null as string | null,
      businesses,
      sources,
    };
  });
