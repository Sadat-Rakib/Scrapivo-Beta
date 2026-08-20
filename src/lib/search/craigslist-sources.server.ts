import { parseStringPromise } from "xml2js";
import type { Lead } from "../scoring";
import { isBuyerContent, detectDecisionMaker, type ExpandedQueries } from "./query-expander";
import { personNoun } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

/**
 * Craigslist uses public RSS feeds for its search results.
 * We can query the "gigs" (cgg) and "services" (crs) sections.
 */
const CITIES = [
  "newyork",
  "losangeles",
  "chicago",
  "sfbay",
  "london",
  "toronto",
  "sydney",
  "austin",
  "seattle",
];

export async function searchCraigslist(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  // Determine the best category
  // cgg = gigs (computer, creative, event, labor, writing)
  // crs = services
  const query = qx.skill || qx.role;
  if (!query) return out;

  // We'll search across a few major cities to get a sample of global/remote-friendly demand.
  // For production, this could be localized based on user preference.
  const targetCities = CITIES.slice(0, 4);

  const craft = personNoun(query, qx.role);
  const searchTerm = encodeURIComponent(query);

  const fetchCity = async (city: string) => {
    try {
      // search in 'gigs' (computer, creative, writing, etc.)
      const url = `https://${city}.craigslist.org/search/cgg?format=rss&query=${searchTerm}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
      });
      if (!res.ok) return [];

      const xml = await res.text();
      const parsed = await parseStringPromise(xml);

      const items = parsed?.["rdf:RDF"]?.item || [];
      const leads: SourceLead[] = [];

      for (const item of items) {
        const title = item.title?.[0] || "";
        const link = item.link?.[0] || "";
        const description = item.description?.[0] || "";
        const dateStr = item["dc:date"]?.[0] || "";

        if (!link || seen.has(link)) continue;

        // Craigslist has a lot of spam. Ensure it looks like a buyer.
        const text = `${title} ${description}`;
        if (!isBuyerContent(text, qx.negativePhrases)) continue;

        // Exclude people offering services
        if (
          /\b(hire me|my portfolio|available for hire|open to work|starting at \$)\b/i.test(text)
        ) {
          continue;
        }

        seen.add(link);
        leads.push({
          source: "craigslist",
          platform: "Craigslist",
          platform_label: "Craigslist Gig",
          title: title.slice(0, 150),
          snippet: description.replace(/<[^>]*>?/gm, "").slice(0, 400),
          full_post_url: link,
          author: "Craigslist User",
          posted_at: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
          engagement: 5,
          is_decision_maker: detectDecisionMaker(text),
          intentBoost: 10,
          match_reasons: ["Craigslist gig listing matching skill"],
          demand_verified: true,
        });
      }
      return leads;
    } catch (e) {
      return [];
    }
  };

  const results = await Promise.all(targetCities.map(fetchCity));
  for (const cityLeads of results) {
    out.push(...cityLeads);
  }

  return out.slice(0, 15);
}
