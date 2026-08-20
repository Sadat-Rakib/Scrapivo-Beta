import * as cheerio from "cheerio";
import type { Lead } from "../scoring";
import { isBuyerContent, detectDecisionMaker, type ExpandedQueries } from "./query-expander";
import { personNoun } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

export async function searchQuora(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  const query = qx.skill || qx.role;
  if (!query) return out;

  const craft = personNoun(query, qx.role);

  // High-intent questions on Quora often take these forms:
  const searchQueries = [
    `"looking for a ${craft}"`,
    `"where can I hire a ${craft}"`,
    `"need a ${craft}"`,
  ];

  const fetchQuora = async (searchQuery: string) => {
    try {
      const url = `https://www.quora.com/search?q=${encodeURIComponent(searchQuery)}&type=question`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      if (!res.ok) return [];

      const html = await res.text();
      const $ = cheerio.load(html);
      const leads: SourceLead[] = [];

      // Quora search results have specific classes, but we can look for links that are questions
      $("a.q-box.Link___StyledBox-t2xg9c-0").each((_, el) => {
        const href = $(el).attr("href");
        if (!href || !href.startsWith("https://www.quora.com/")) return;

        // Exclude profiles, topics, etc.
        if (href.includes("/profile/") || href.includes("/topic/")) return;

        const title = $(el).text().trim();
        if (!title || title.length < 10 || seen.has(href)) return;

        // Ensure it's asking a buying/hiring question
        if (!isBuyerContent(title, qx.negativePhrases)) return;

        seen.add(href);
        leads.push({
          source: "quora",
          platform: "Quora",
          platform_label: "Quora Question",
          title: title,
          snippet: `Quora Question: ${title}`,
          full_post_url: href,
          author: "Quora User",
          posted_at: new Date().toISOString(), // Search doesn't easily expose date in HTML
          engagement: 5,
          is_decision_maker: detectDecisionMaker(title),
          intentBoost: 9,
          match_reasons: ["Quora question indicating buying intent"],
          demand_verified: true,
        });
      });
      return leads;
    } catch (e) {
      return [];
    }
  };

  const results = await Promise.all(searchQueries.map(fetchQuora));
  for (const queryLeads of results) {
    out.push(...queryLeads);
  }

  return out.slice(0, 10);
}
