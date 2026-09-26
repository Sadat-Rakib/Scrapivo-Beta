/**
 * Inline enrichment for incomplete SpecRows (Phase B).
 * Uses discoverContacts when a website/domain is present. Never invents
 * fields — only fills email/phone from harvested evidence. Caps + timeout
 * keep the search path responsive; failures leave the row incomplete.
 */
import type { SpecRow } from "@/lib/spec-search.functions";
import { rowIsComplete, type CompletenessRow } from "@/lib/search/completeness";
import { awaitSearchWork, throwIfAborted } from "./search-run";

export type EnrichRowFn = (row: SpecRow, signal?: AbortSignal | null) => Promise<SpecRow>;

const DEFAULT_CAP = 8;
const DEFAULT_TIMEOUT_MS = 12_000;

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Only entity sites are contact sources; discovery pages and profiles are excluded. */
export function contactSiteUrl(row: SpecRow): string | null {
  if (row.website_url && row.website_url !== row.source_url) return row.website_url;
  if (row.kind === "person" || row.kind === "job") return null;
  if (!row.url || row.url === row.source_url) return null;
  if (["list", "directory", "aggregator", "job_board", "article", "institute", "social_post"].includes(row.source_page_type ?? "")) return null;
  // When provenance exists but its page type is unknown, do not treat an
  // unrelated legacy URL as the entity's first-party site.
  if (row.source_url && row.page_type !== "entity_page" && row.page_type !== "company_page") return null;
  if (/(linkedin|facebook|crunchbase|yelp)\./i.test(domainFromUrl(row.url) ?? "")) return null;
  return row.url;
}

function nameFromTitle(title: string): string {
  // "Ada — Founder @ Co" → "Ada"; business titles are already names.
  const head = title.split("—")[0]?.trim() || title.trim();
  return head.replace(/\s+@\s+.*$/, "").trim() || title;
}

/** Production enricher: harvest contacts for rows that have a site. */
export async function enrichSpecRowFromSite(row: SpecRow, signal?: AbortSignal | null): Promise<SpecRow> {
  throwIfAborted(signal);
  // A discovery article belongs to the publisher, not the lead. Crawling it
  // for contacts wastes time and can misattribute the publisher's details.
  const domain = domainFromUrl(contactSiteUrl(row));
  if (!domain) return row;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, DEFAULT_TIMEOUT_MS);
  try {
    const { discoverContacts } = await import("@/lib/contact/discover-contacts.server");
    const discovery = await awaitSearchWork(discoverContacts({
        company: nameFromTitle(row.title),
        domain,
        personName: row.kind === "person" ? nameFromTitle(row.title) : undefined,
        freeOnly: true,
        skipRegistries: true,
        maxPages: 4,
        signal: controller.signal,
      }), controller.signal);
    throwIfAborted(signal);
    if (controller.signal.aborted) return row;
    const email =
      row.email ||
      discovery.emails?.find((e) => e.email && (e as { verification?: { tier?: string } }).verification?.tier !== "invalid")
        ?.email ||
      null;
    const phone = row.phone || discovery.phones?.[0]?.e164 || discovery.phones?.[0]?.phone || null;
    return { ...row, email: email ?? row.email, phone: phone ?? row.phone };
  } catch {
    throwIfAborted(signal);
    return row;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Enrich up to `cap` incomplete rows; return complete + still-incomplete.
 * Injectable enrichFn for tests (no network).
 */
export async function enrichIncompleteRows(
  incomplete: SpecRow[],
  opts?: { cap?: number; enrichFn?: EnrichRowFn; signal?: AbortSignal | null },
): Promise<{ complete: SpecRow[]; stillIncomplete: SpecRow[] }> {
  throwIfAborted(opts?.signal);
  const cap = opts?.cap ?? DEFAULT_CAP;
  const enrichFn = opts?.enrichFn ?? enrichSpecRowFromSite;
  const slice = incomplete.slice(0, cap);
  const rest = incomplete.slice(cap);
  const enriched = await Promise.all(slice.map(async (row) => {
    throwIfAborted(opts?.signal);
    try {
      const enrichedRow = await awaitSearchWork(enrichFn(row, opts?.signal), opts?.signal);
      throwIfAborted(opts?.signal);
      return enrichedRow;
    } catch {
      throwIfAborted(opts?.signal);
      return row;
    }
  }));
  throwIfAborted(opts?.signal);
  const complete: SpecRow[] = [];
  const stillIncomplete: SpecRow[] = [...rest];
  for (const r of enriched) {
    const check: CompletenessRow = {
      kind: r.kind,
      title: r.title,
      email: r.email,
      phone: r.phone,
      url: r.url,
      location: r.location,
      country: r.country,
      category: r.category,
      industry: r.industry,
    };
    if (rowIsComplete(check)) complete.push(r);
    else stillIncomplete.push(r);
  }
  return { complete, stillIncomplete };
}
