/**
 * CoreClaw Discover sources — only high-value Workers:
 *  - google-maps-lead-finder (local/SMB with contacts)
 *  - google-search-scraper (SERP backup when SerpAPI thin/missing)
 *
 * Gated by CORECLAW_API_KEY. Not e-commerce / comment scrapers.
 */
import type { Lead } from "../scoring";
import { isBuyerContent, type ExpandedQueries } from "./query-expander";
import { runCoreClawWorker, coreclawEnabled } from "../contact/coreclaw.server";

type SourceLead = Lead & { intentBoost?: number };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function pickUrl(row: Record<string, unknown>): string | undefined {
  return (
    str(row.website) ||
    str(row.website_url) ||
    str(row.url) ||
    str(row.link) ||
    str(row.maps_url) ||
    str(row.google_maps_url) ||
    str(row.place_url)
  );
}

function pickPhone(row: Record<string, unknown>): string | undefined {
  const p = row.phone ?? row.phone_number ?? row.telephone;
  return typeof p === "string" ? p : undefined;
}

function pickEmail(row: Record<string, unknown>): string | undefined {
  const e = row.email ?? row.email_address ?? row.business_email;
  if (typeof e === "string" && e.includes("@")) return e.toLowerCase();
  const emails = row.emails;
  if (Array.isArray(emails) && typeof emails[0] === "string")
    return String(emails[0]).toLowerCase();
  return undefined;
}

/** Local business leads from Google Maps Lead Finder. */
export async function searchCoreClawMapsLeads(
  qx: ExpandedQueries,
  locationHint?: string | null,
): Promise<SourceLead[]> {
  if (!coreclawEnabled()) return [];
  const skill = (qx.skill || qx.role || "").trim();
  if (!skill) return [];
  // ExpandedQueries carries no location field — the hint is the only source.
  const loc = (locationHint || "").trim() || "United States";
  const keyword = `${skill} ${loc}`.trim().slice(0, 120);

  const rows = await runCoreClawWorker(
    "coreclaw/google-maps-lead-finder",
    {
      industry: {
        query: true,
        keywords: [keyword],
        place_ids: [],
        categories: [],
        exact_match: false,
        google_map_urls: [],
      },
      base_location: loc.includes(",") ? loc : `${loc},USA`,
      max_results: 12,
      lang: "en",
      lead_gen_packs: "lead_enrichment",
      comment_config: false,
      active_filters: { max_leads_per_place: 2, min_rating: "", leads_seniority: "" },
    },
    { limit: 20, timeoutMs: 12_000 },
  );

  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name =
      str(row.name) ||
      str(row.business_name) ||
      str(row.title) ||
      str(row.company_name) ||
      str(row.place_name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const website = pickUrl(row);
    const phone = pickPhone(row);
    const email = pickEmail(row);
    const address = str(row.address) || str(row.full_address) || str(row.location);
    const mapsUrl =
      str(row.maps_url) ||
      str(row.google_maps_url) ||
      str(row.place_url) ||
      website ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + loc)}`;

    const snippetParts = [
      address ? `Address: ${address}` : "",
      phone ? `Phone: ${phone}` : "",
      email ? `Email: ${email}` : "",
      website ? `Website: ${website}` : "",
      "Local business via CoreClaw Maps Lead Finder",
    ].filter(Boolean);

    out.push({
      source: "coreclaw_maps",
      platform: "Google Maps Lead",
      platform_label: "Maps Lead",
      title: name,
      snippet: snippetParts.join("\n"),
      full_post_url: mapsUrl,
      author: name,
      author_url: website,
      posted_at: undefined,
      engagement: 25,
      is_decision_maker: true,
      intentBoost: email || phone ? 18 : 12,
      match_reasons: ["CoreClaw Google Maps Lead Finder", ...(email ? ["Email found"] : [])],
      signal_type: "leading_indicator",
    });
    if (out.length >= 15) break;
  }
  return out;
}

/** SERP backup — one buyer-intent query when SerpAPI is missing or thin. */
export async function searchCoreClawSerp(qx: ExpandedQueries): Promise<SourceLead[]> {
  if (!coreclawEnabled()) return [];
  const skill = (qx.skill || qx.role || "").trim();
  if (!skill) return [];

  const week = new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
  const keyword =
    `"looking for" "${skill}" (freelancer OR contractor OR hire OR "need a") after:${week}`.slice(
      0,
      200,
    );

  const rows = await runCoreClawWorker(
    "coreclaw/google-search-scraper",
    {
      keyword,
      max_pages: 1,
      domain: "https://www.google.com/",
      gl: "us",
      hl: "en",
      safe: "off",
    },
    { limit: 15, timeoutMs: 10_000 },
  );

  const out: SourceLead[] = [];
  const seen = new Set<string>();

  // Flatten nested organic results if present
  const organic: Record<string, unknown>[] = [];
  for (const row of rows) {
    const nested = row.organic_results ?? row.organic ?? row.results;
    if (Array.isArray(nested)) {
      for (const n of nested) {
        if (n && typeof n === "object") organic.push(n as Record<string, unknown>);
      }
    } else if (row.link || row.url || row.title) {
      organic.push(row);
    }
  }

  for (const r of organic) {
    const link = str(r.link) || str(r.url) || str(r.href);
    const title = str(r.title) || str(r.name) || "";
    const snippet = (str(r.snippet) || str(r.description) || "").slice(0, 400);
    if (!link || !title) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    if (!isBuyerContent(`${title} ${snippet}`, qx.negativePhrases)) continue;
    out.push({
      source: "coreclaw_serp",
      platform: "Google: Buyer Post",
      platform_label: "CoreClaw SERP",
      title,
      snippet,
      full_post_url: link,
      posted_at: undefined,
      engagement: 10,
      is_decision_maker: false,
      intentBoost: 5,
      match_reasons: ["CoreClaw Google Search scraper"],
    });
    if (out.length >= 10) break;
  }
  return out;
}
