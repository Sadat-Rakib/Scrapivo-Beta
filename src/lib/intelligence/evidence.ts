/**
 * Shared evidence claims for personalization and opportunity scoring.
 */
export type EvidenceConfidence = "high" | "medium" | "low";

export type EvidenceItem = {
  source: string;
  data: string;
  url?: string;
  observedAt?: string;
};

export type EvidenceClaim = {
  claim: string;
  evidence: EvidenceItem[];
  confidence: EvidenceConfidence;
  observedAt: string;
};

export function makeClaim(
  claim: string,
  evidence: EvidenceItem[],
  confidence: EvidenceConfidence = "medium",
): EvidenceClaim {
  return {
    claim,
    evidence,
    confidence,
    observedAt: new Date().toISOString(),
  };
}

export function mergeClaims(...lists: Array<EvidenceClaim[] | undefined>): EvidenceClaim[] {
  const out: EvidenceClaim[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const c of list || []) {
      const key = `${c.claim}|${c.evidence[0]?.source || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** Build common opportunity evidence for local / company rows. */
export function claimsFromWebsiteSignals(row: {
  website?: string;
  website_status?: string;
  email?: string;
  phone?: string;
  https?: boolean;
  thinPage?: boolean;
}): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  if (!row.website || row.website_status === "verified_no_website") {
    claims.push(
      makeClaim(
        "business has no first-party website",
        [{ source: "listing", data: row.website_status || "no website URL" }],
        row.website_status === "verified_no_website" ? "high" : "medium",
      ),
    );
  }
  if (row.website_status === "unreachable") {
    claims.push(
      makeClaim("website unreachable", [
        { source: "http_probe", data: "no successful page fetches" },
      ]),
    );
  }
  if (row.https === false && row.website) {
    claims.push(makeClaim("weak HTTPS", [{ source: "url_parse", data: "website uses http://" }]));
  }
  if (row.thinPage) {
    claims.push(
      makeClaim("thin website", [{ source: "crawl", data: "zero successful harvest pages" }]),
    );
  }
  if (row.email) {
    claims.push(
      makeClaim("has public email", [{ source: "contact_intelligence", data: row.email }], "high"),
    );
  }
  if (row.phone) {
    claims.push(
      makeClaim("has phone", [{ source: "listing_or_harvest", data: row.phone }], "high"),
    );
  }
  return claims;
}
