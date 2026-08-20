// =====================================================================
// Government / public-data sources (Phase 2, Task 2.3)
//
// These surface companies about to have budget/hiring need — a LEADING
// INDICATOR, not a direct "someone is asking right now" signal. Per the spec
// they are WARM by design: every lead here is tagged `signal_type:
// "leading_indicator"`, which the scorer (sources.server.ts scoreAndReason)
// hard-caps to the top of the warm band so a filing that happens to match
// high-specificity/urgency keywords can never slip into HOT and mislead the
// user into thinking someone is actively waiting to hear from them.
//
// Follows the standard new-source pattern documented in ats-sources.server.ts:
// standard input (ExpandedQueries), standard output (SourceLead), standard
// resilience (timeout + logged try/catch), standard registration (fan-out).
//
// SEC EDGAR full-text search — free, public, no key. Form D = a private
// fundraise notice = a strong "about to hire/spend" signal.
// =====================================================================
import type { Lead } from "../scoring";
import type { ExpandedQueries } from "./query-expander";

type SourceLead = Lead & { intentBoost?: number };

// SEC requires a descriptive User-Agent with contact info on all requests.
const SEC_UA = "Scrapivo Lead Discovery (contact: hello@scrapivo.com)";
const SEC_TIMEOUT_MS = 10000;
const SEC_MAX_AGE_DAYS = 30; // Form D "about to spend" window

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

function cleanCompanyName(displayName: string): string {
  // "Acme AI Fund-A, L.P.  (CIK 0002096208)" → "Acme AI Fund-A, L.P."
  return displayName.replace(/\s*\(CIK\s+\d+\)\s*$/i, "").trim();
}

function edgarFilingUrl(cik: string, adsh: string): string {
  const cikTrimmed = String(cik).replace(/^0+/, "");
  const adshNoDashes = adsh.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikTrimmed}/${adshNoDashes}/${adsh}-index.htm`;
}

function withinDays(fileDate: string, days: number): boolean {
  const t = new Date(fileDate).getTime();
  if (isNaN(t)) return false;
  const age = (Date.now() - t) / 86_400_000;
  return age >= 0 && age <= days;
}

/**
 * SEC EDGAR full-text Form D search. Uses the classifier's skill/related terms
 * as the query so "AI engineer" surfaces recent AI-company fundraises.
 */
export async function searchSecEdgar(qx: ExpandedQueries): Promise<SourceLead[]> {
  const out: SourceLead[] = [];
  // Keep the query specific enough to be useful but broad enough to hit filings.
  const term = (qx.skill || qx.role || qx.raw || "").trim();
  if (!term) return out;

  const q = encodeURIComponent(`"${term}"`);
  const url = `https://efts.sec.gov/LATEST/search-index?q=${q}&forms=D`;
  try {
    const data = await withTimeout(
      (async () => {
        const res = await fetch(url, {
          headers: { "User-Agent": SEC_UA, Accept: "application/json" },
        });
        if (!res.ok) return null;
        return (await res.json()) as any;
      })(),
      SEC_TIMEOUT_MS,
      null,
    );
    const hits = data?.hits?.hits ?? [];
    const seen = new Set<string>();
    for (const h of hits) {
      const s = h?._source;
      if (!s) continue;
      const fileDate = s.file_date || "";
      if (!withinDays(fileDate, SEC_MAX_AGE_DAYS)) continue;
      const cik = (s.ciks && s.ciks[0]) || "";
      const adsh = s.adsh || "";
      if (!cik || !adsh || seen.has(adsh)) continue;
      seen.add(adsh);
      const company = cleanCompanyName((s.display_names && s.display_names[0]) || "Private filer");
      const loc = (s.biz_locations && s.biz_locations[0]) || "";
      out.push({
        source: "secedgar",
        platform: "SEC Form D (private fundraise)",
        title: `${company} filed a Form D (private fundraise)`,
        snippet: [
          `${company} just filed a Form D private-placement notice with the SEC`,
          loc ? `(${loc})` : "",
          `— a leading indicator they are raising capital and likely to increase hiring/spend soon. Filed ${fileDate}.`,
        ]
          .filter(Boolean)
          .join(" ")
          .slice(0, 400),
        full_post_url: edgarFilingUrl(cik, adsh),
        author: company,
        posted_at: fileDate ? new Date(fileDate).toISOString() : new Date().toISOString(),
        engagement: 30,
        is_decision_maker: true,
        // Structural warm-cap (Task 2.3): never hot regardless of keyword match.
        signal_type: "leading_indicator",
        intentBoost: 10,
      });
    }
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[secedgar] failed:", (err as Error)?.message);
    }
  }
  return out;
}
