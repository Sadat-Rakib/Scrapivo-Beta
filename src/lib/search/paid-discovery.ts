/**
 * Paid Discover APIs (Serper / ScrapingDog / SerpAPI, Tavily, ScrapeCreators,
 * CoreClaw) are OFF unless USE_PAID_SOURCES=true. Keys alone do not enable them.
 */
export function paidDiscoveryEnabled(): boolean {
  return process.env.USE_PAID_SOURCES === "true";
}
