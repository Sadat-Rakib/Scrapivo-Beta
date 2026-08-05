/**
 * Paid Discover APIs (SerpAPI, Tavily, ScrapeCreators, CoreClaw) are OFF unless
 * USE_PAID_SOURCES=true. Keys alone do not auto-enable them.
 */
export function paidDiscoveryEnabled(): boolean {
  return process.env.USE_PAID_SOURCES === "true";
}
