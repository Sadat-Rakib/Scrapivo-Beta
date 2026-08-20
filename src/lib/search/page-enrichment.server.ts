/** Server client for optional scrape-worker (Crawl4AI) and stealth-worker /fetch enrichment. */
import { condensePageText, validateFetchedPage } from "./fetch-gate.server";

export type FetchedPage = {
  url: string;
  title: string;
  markdown: string;
  text: string;
  status?: number;
};

export async function fetchPageContent(url: string): Promise<FetchedPage | null> {
  const scrapeUrl = process.env.SCRAPE_WORKER_URL;
  const stealthUrl = process.env.STEALTH_WORKER_URL;
  const token = process.env.STEALTH_WORKER_TOKEN;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (scrapeUrl) {
    try {
      const res = await fetch(`${scrapeUrl.replace(/\/$/, "")}/fetch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as FetchedPage;
      if (!data?.url) return null;
      const text = condensePageText(data.text || data.markdown || "");
      const gate = validateFetchedPage({
        url,
        status: res.status,
        title: data.title || "",
        text,
      });
      if (!gate.ok) return null;
      return { ...data, text, markdown: data.markdown || text };
    } catch {
      /* fall through */
    }
  }

  if (stealthUrl) {
    try {
      const res = await fetch(`${stealthUrl.replace(/\/$/, "")}/fetch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as FetchedPage;
      if (!data?.url) return null;
      const text = condensePageText(data.text || data.markdown || "");
      const gate = validateFetchedPage({
        url,
        status: res.status,
        title: data.title || "",
        text,
      });
      if (!gate.ok) return null;
      return { ...data, text, markdown: data.markdown || text };
    } catch {
      /* skip */
    }
  }

  return null;
}

export async function enrichLeadsFromUrls(
  leads: Array<{ full_post_url: string; title: string; snippet: string }>,
  maxEnrich = 5,
  relevanceTokens?: string[],
): Promise<void> {
  const needsEnrich = leads.filter(
    (l) => l.full_post_url && (l.snippet.length < 80 || l.title.length < 20),
  );
  for (const lead of needsEnrich.slice(0, maxEnrich)) {
    const page = await fetchPageContent(lead.full_post_url);
    if (!page) continue;
    const body = page.text || page.markdown;
    const gate = validateFetchedPage({
      url: lead.full_post_url,
      title: page.title || "",
      text: body,
      relevanceTokens,
      minTextLength: 80,
    });
    if (!gate.ok) continue;
    if (page.title && page.title.length > 5) lead.title = page.title.slice(0, 200);
    if (body && body.length > lead.snippet.length) lead.snippet = body.slice(0, 600);
  }
}
