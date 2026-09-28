/**
 * Top-card Personal Information Extraction (PIE) for Discover demo wow.
 *
 * Waterfall (ranks 0..2 only, ≤3 paid enrich calls per Discover):
 *   1) Regex + keyword on title/snippet
 *   2) Optional cheap page text fetch for public URLs
 *   3) Phone validate via existing phone.ts heuristics
 *   4) EnrichmentAPI / ScrapingDog LinkedIn when profile URL present
 *   5) LLM extract last resort (direct prompt only — no defense-bypass)
 *
 * Does NOT implement USENIX attack/bypass patterns. Public buyer posts only.
 */
import type { Lead } from "../scoring";
import { extractInlineContacts } from "../search/lead-segments";
import { parsePhone } from "./phone";

const MAX_TOP = 3;
const MAX_PAID_ENRICH = 3;
const PAGE_BUDGET_MS = 4_500;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEYWORD_CONTACT_RE =
  /(?:e-?mail|phone|tel|telephone|mobile|contact|reach(?:\s+me)?|call)\s*[:\-–]?\s*([^\n|]{5,80})/gi;

function stripHtmlNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

function mergeInline(lead: Lead, emails: string[], phones: string[], links: string[] = []): Lead {
  const prev = lead.inline_contacts ?? { emails: [], phones: [], links: [] };
  const nextEmails = [...new Set([...prev.emails, ...emails.map((e) => e.toLowerCase())])]
    .filter((e) => !/example\.com|yourdomain|noreply|no-reply/i.test(e))
    .slice(0, 3);
  const nextPhones = [...new Set([...prev.phones, ...phones])].slice(0, 2);
  const nextLinks = [...new Set([...prev.links, ...links])].slice(0, 3);
  if (!nextEmails.length && !nextPhones.length && !nextLinks.length) return lead;
  return {
    ...lead,
    inline_contacts: { emails: nextEmails, phones: nextPhones, links: nextLinks },
  };
}

function keywordHarvest(text: string): { emails: string[]; phones: string[] } {
  const emails: string[] = [];
  const phones: string[] = [];
  for (const m of text.matchAll(KEYWORD_CONTACT_RE)) {
    const chunk = m[1] || "";
    for (const e of chunk.matchAll(EMAIL_RE)) emails.push(e[0]);
    const phoneCand = chunk.match(
      /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,5}/,
    );
    if (phoneCand) {
      const p = parsePhone(phoneCand[0]);
      if (p.status === "valid" || p.status === "possible") {
        phones.push(p.formatted || p.e164 || phoneCand[0]);
      }
    }
  }
  return { emails, phones };
}

function regexHarvest(text: string): { emails: string[]; phones: string[] } {
  const base = extractInlineContacts(text);
  const emails = base?.emails ?? [];
  const phones: string[] = [];
  for (const raw of base?.phones ?? []) {
    const p = parsePhone(raw);
    if (p.status === "valid" || p.status === "possible") {
      phones.push(p.formatted || p.e164 || raw);
    }
  }
  // Broader NA/EU digit patterns if extractInline was thin
  if (!phones.length) {
    for (const m of text.matchAll(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) {
      const p = parsePhone(m[0]);
      if (p.status === "valid" || p.status === "possible") {
        phones.push(p.formatted || p.e164 || m[0]);
      }
      if (phones.length >= 2) break;
    }
  }
  const kw = keywordHarvest(text);
  return {
    emails: [...new Set([...emails, ...kw.emails])],
    phones: [...new Set([...phones, ...kw.phones])],
  };
}

async function fetchPublicPageText(url: string): Promise<string> {
  try {
    if (!/^https?:\/\//i.test(url)) return "";
    if (/linkedin\.com|facebook\.com|instagram\.com|(^|\.)x\.com|twitter\.com/i.test(url)) {
      // Social HTML is usually login-walled — skip paid scrape here.
      return "";
    }
    const res = await fetch(url, {
      headers: { "user-agent": "ScrapivoBot/1.0 (+https://scrapivo-beta.vercel.app)" },
      signal: AbortSignal.timeout(PAGE_BUDGET_MS),
      redirect: "follow",
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ct) && ct) return "";
    const html = await res.text();
    return stripHtmlNoise(html);
  } catch {
    return "";
  }
}

async function enrichFromLinkedInUrl(
  profileUrl: string,
  budget: { used: number },
): Promise<{ emails: string[]; phones: string[]; title?: string; company?: string }> {
  if (budget.used >= MAX_PAID_ENRICH) return { emails: [], phones: [] };
  const empty = { emails: [] as string[], phones: [] as string[] };

  const enrichmentKey = process.env.ENRICHMENTAPI_KEY?.trim();
  if (enrichmentKey && /linkedin\.com\/in\//i.test(profileUrl)) {
    budget.used++;
    try {
      const linkedinId = profileUrl.replace(/\/$/, "").split("/in/")[1]?.split(/[/?#]/)[0]?.trim();
      if (linkedinId) {
        const params = new URLSearchParams({
          api_key: enrichmentKey,
          linkedin_id: linkedinId,
        });
        const res = await fetch(`https://api.enrichmentapi.io/person?${params}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const emails: string[] = [];
          const phones: string[] = [];
          const emailArr = data.email;
          if (Array.isArray(emailArr)) {
            for (const row of emailArr) {
              const e = typeof row === "string" ? row : (row as { email?: string })?.email;
              if (e) emails.push(e);
            }
          } else if (typeof emailArr === "string") {
            emails.push(emailArr);
          }
          const phone =
            (data.phone as string) ||
            (data.mobile as string) ||
            ((data.phones as string[] | undefined)?.[0] ?? "");
          if (phone) {
            const p = parsePhone(phone);
            if (p.status === "valid" || p.status === "possible") {
              phones.push(p.formatted || p.e164 || phone);
            }
          }
          return {
            emails,
            phones,
            title: (data.headline || data.job_title || data.title) as string | undefined,
            company: (data.company as any)?.name
              ? String((data.company as any).name)
              : (data.company as string | undefined),
          };
        }
      }
    } catch {
      /* try ScrapingDog next */
    }
  }

  const dogKey = process.env.SCRAPINGDOG_API_KEY?.trim();
  if (dogKey && /linkedin\.com\/in\//i.test(profileUrl) && budget.used < MAX_PAID_ENRICH) {
    budget.used++;
    try {
      const params = new URLSearchParams({
        api_key: dogKey,
        type: "profile",
        link: profileUrl,
      });
      const res = await fetch(`https://api.scrapingdog.com/linkedin?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return empty;
      const data = (await res.json()) as Record<string, unknown>;
      const emails: string[] = [];
      const phones: string[] = [];
      // ScrapingDog LinkedIn rarely returns email; harvest any contact fields present.
      const email = (data.email as string) || "";
      if (email) emails.push(email);
      const headline = String(data.headline || data.about || "");
      const harvested = regexHarvest(headline);
      return {
        emails: [...emails, ...harvested.emails],
        phones: [...phones, ...harvested.phones],
        title: (data.headline || data.job_title) as string | undefined,
        company: (data.company || (data.experience as any)?.[0]?.company) as string | undefined,
      };
    } catch {
      return empty;
    }
  }

  return empty;
}

async function llmPieExtract(cleanedText: string): Promise<{ emails: string[]; phones: string[] }> {
  if (!cleanedText || cleanedText.length < 40) return { emails: [], phones: [] };
  try {
    const { aiComplete, safeJsonParse } = await import("../ai/router.server");
    const raw = await aiComplete({
      task: "extract",
      system:
        'Extract publicly listed contact details from the document. Return JSON only: {"email":"","phone":""}. Use empty strings when not found. Do not invent contacts.',
      user: cleanedText.slice(0, 6000),
      json: true,
      temperature: 0,
      maxTokens: 120,
    });
    const parsed = safeJsonParse<{ email?: string; phone?: string }>(raw);
    const emails: string[] = [];
    const phones: string[] = [];
    if (parsed?.email && EMAIL_RE.test(parsed.email)) emails.push(parsed.email.toLowerCase());
    if (parsed?.phone) {
      const p = parsePhone(parsed.phone);
      if (p.status === "valid" || p.status === "possible") {
        phones.push(p.formatted || p.e164 || parsed.phone);
      }
    }
    return { emails, phones };
  } catch {
    return { emails: [], phones: [] };
  }
}

function profileUrlForLead(lead: Lead): string | undefined {
  const candidates = [lead.author_url, lead.full_post_url].filter(Boolean) as string[];
  for (const u of candidates) {
    if (/linkedin\.com\/in\//i.test(u)) return u.split("?")[0];
  }
  // LinkedIn posts often encode author slug: /posts/First-Last-slug_...
  const m = (lead.full_post_url || "").match(/linkedin\.com\/posts\/([A-Za-z0-9-]+?)_/i);
  if (m?.[1]) return `https://www.linkedin.com/in/${m[1]}`;
  return undefined;
}

async function enrichOneLead(lead: Lead, paidBudget: { used: number }): Promise<Lead> {
  let current = lead;
  const blob = `${lead.title || ""}\n${lead.snippet || ""}\n${lead.author || ""}`;

  // 1) Regex + keyword on snippet
  let harvested = regexHarvest(blob);
  current = mergeInline(current, harvested.emails, harvested.phones);

  const hasContact = () =>
    (current.inline_contacts?.emails?.length ?? 0) > 0 ||
    (current.inline_contacts?.phones?.length ?? 0) > 0;

  // 2) Public page fetch
  if (!hasContact() && lead.full_post_url) {
    const pageText = await fetchPublicPageText(lead.full_post_url);
    if (pageText) {
      harvested = regexHarvest(pageText);
      current = mergeInline(current, harvested.emails, harvested.phones);
    }
  }

  // 4) Paid LinkedIn enrich (credit-capped)
  if (!hasContact()) {
    const profile = profileUrlForLead(lead);
    if (profile) {
      const paid = await enrichFromLinkedInUrl(profile, paidBudget);
      current = mergeInline(current, paid.emails, paid.phones);
      if (paid.title && !current.match_reasons?.includes("Enriched profile")) {
        current = {
          ...current,
          match_reasons: [...(current.match_reasons ?? []), "Enriched profile"].slice(0, 8),
        };
      }
    }
  }

  // 5) LLM last resort — DISABLED. Contacts read out of a page by an LLM are
  // not verbatim evidence; the model invents first.last@domain addresses
  // (beta-reality: fabricated CEO emails reached users). Only regex extraction
  // from real page text (steps 1-4) may contribute inline contacts.
  // llmPieExtract is retained for a future flow that verifies its output
  // against the fetched page text before merging.

  return current;
}

/**
 * Enrich the first `MAX_TOP` ranked leads in-place (returns new array).
 * Prefer social/public leads among the top of the list for paid enrich so
 * Freelancer-only front rows don't burn EnrichmentAPI credits with empty yield.
 * Hard budget: ≤3 paid EnrichmentAPI/ScrapingDog calls for the whole batch.
 */
export async function enrichTopLeadContacts(leads: Lead[]): Promise<Lead[]> {
  if (!leads.length) return leads;
  const paidBudget = { used: 0 };

  const isSocialish = (l: Lead) =>
    /linkedin|twitter|facebook|instagram|(^|\.)x\.com|serpapi|tavily|hn|reddit/i.test(
      `${l.source} ${l.platform} ${l.full_post_url}`,
    );

  // Enrich up to MAX_TOP social-first targets from the front of the list,
  // falling back to absolute top ranks if social is thin.
  const socialTargets = leads.filter(isSocialish).slice(0, MAX_TOP);
  const targets =
    socialTargets.length >= 1
      ? [
          ...socialTargets,
          ...leads
            .filter((l) => !socialTargets.includes(l))
            .slice(0, Math.max(0, MAX_TOP - socialTargets.length)),
        ].slice(0, MAX_TOP)
      : leads.slice(0, MAX_TOP);

  const targetUrls = new Set(targets.map((l) => l.full_post_url));
  const enrichedMap = new Map<string, Lead>();
  await Promise.all(
    targets.map(async (l) => {
      const next = await enrichOneLead(l, paidBudget).catch(() => l);
      enrichedMap.set(l.full_post_url, next);
    }),
  );

  return leads.map((l) =>
    targetUrls.has(l.full_post_url) ? (enrichedMap.get(l.full_post_url) ?? l) : l,
  );
}
