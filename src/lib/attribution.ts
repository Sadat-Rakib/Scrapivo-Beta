/**
 * Outbound attribution: append utm_source=scrapivo.com (plus optional
 * medium/campaign/content) using proper URL parsing — never string concat,
 * so existing params, fragments, and encoded characters survive intact.
 */
export function withScrapivoAttribution(
  rawUrl: string,
  opts?: { medium?: string; campaign?: string; content?: string },
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl; // not parseable — return untouched, never corrupt
  }
  url.searchParams.set("utm_source", "scrapivo.com");
  if (opts?.medium) url.searchParams.set("utm_medium", opts.medium);
  if (opts?.campaign) url.searchParams.set("utm_campaign", opts.campaign);
  if (opts?.content) url.searchParams.set("utm_content", opts.content);
  return url.toString();
}
