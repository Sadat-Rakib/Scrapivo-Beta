/**
 * Website contact extraction for Local Businesses.
 * Fetches public HTML (contact/about/home) and pulls published emails + phones.
 */
import * as cheerio from "cheerio";
import { parsePhone } from "./phone";

const MAILTO_RE = /mailto:([a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const PLAIN_EMAIL_RE = /\b[a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const TEL_HREF_RE = /tel:([+\d()\s.\-]{7,})/gi;
const PLAIN_PHONE_RE =
  /(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?)?\d{3,4}[\s.\-]?\d{3,4}(?:\s*(?:ext|x|#)\s*\d{1,6})?/gi;
const JUNK_LOCAL = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "mailer-daemon",
  "postmaster",
  "webmaster",
  "example",
  "test",
  "privacy",
  "abuse",
]);

function scoreEmail(email: string): number {
  const local = email.split("@")[0]?.toLowerCase() || "";
  if (JUNK_LOCAL.has(local)) return 0;
  if (/^(info|hello|contact|office|admin|sales|support)$/i.test(local)) return 40;
  if (local.includes(".")) return 85; // first.last style
  return 60;
}

function emailsFromHtml(html: string): Array<{ email: string; score: number }> {
  const $ = cheerio.load(html || "");
  const found = new Map<string, number>();

  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") || "";
    for (const m of href.matchAll(MAILTO_RE)) {
      const e = m[1].toLowerCase();
      found.set(e, Math.max(found.get(e) ?? 0, scoreEmail(e) + 20));
    }
  });

  const text = $("body").text() || "";
  for (const m of text.matchAll(PLAIN_EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e)) continue;
    found.set(e, Math.max(found.get(e) ?? 0, scoreEmail(e)));
  }

  // Prefer footer / contact blocks
  $("footer, [class*='contact'], [id*='contact'], [class*='footer']").each((_, el) => {
    const t = $(el).text();
    for (const m of t.matchAll(PLAIN_EMAIL_RE)) {
      const e = m[0].toLowerCase();
      found.set(e, Math.max(found.get(e) ?? 0, scoreEmail(e) + 10));
    }
  });

  return [...found.entries()]
    .map(([email, score]) => ({ email, score }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

function phonesFromHtml(html: string): string[] {
  const $ = cheerio.load(html || "");
  const scored = new Map<string, { display: string; score: number }>();

  const consider = (raw: string, boost = 0) => {
    const cleaned = (raw || "").trim();
    if (!cleaned || cleaned.replace(/\D/g, "").length < 7) return;
    const p = parsePhone(cleaned);
    if (p.status === "not_a_number" || p.status === "fictional") return;
    if (p.confidence < 0.25 && !p.e164) return;
    const digits = (p.e164 || cleaned).replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return;
    const display = p.e164 || p.national || cleaned;
    const score = (p.confidence || 0.3) + boost;
    const prev = scored.get(digits);
    if (!prev || score > prev.score) scored.set(digits, { display, score });
  };

  $("a[href^='tel:']").each((_, el) => {
    const href = $(el).attr("href") || "";
    for (const m of href.matchAll(TEL_HREF_RE)) {
      consider(m[1], 0.3);
    }
  });

  // WhatsApp click-to-chat
  $("a[href*='wa.me'], a[href*='whatsapp']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/i);
    if (m) consider(m[1].startsWith("+") ? m[1] : `+${m[1]}`, 0.25);
  });

  const preferBlocks = $("footer, [class*='contact'], [id*='contact'], [class*='footer']").text();
  for (const m of preferBlocks.matchAll(PLAIN_PHONE_RE)) {
    consider(m[0], 0.15);
  }

  const body = $("body").text() || "";
  for (const m of body.matchAll(PLAIN_PHONE_RE)) {
    consider(m[0], 0);
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map((x) => x.display)
    .slice(0, 5);
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Scrapivo/1.0 (local-business contact discovery; +https://scrapivo-beta.vercel.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!/html|xml/i.test(ct) && ct) return "";
    return (await res.text()).slice(0, 400_000);
  } catch {
    return "";
  }
}

function contactPaths(base: string): string[] {
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return [base];
  }
  return [
    base,
    `${origin}/contact`,
    `${origin}/contact-us`,
    `${origin}/about`,
    `${origin}/about-us`,
  ];
}

/**
 * Visit a business website (home + contact/about) and extract published emails + phones.
 */
export async function extractEmailsWithCheerio(
  website: string,
): Promise<{ emails: string[]; phones: string[]; pagesFetched: number }> {
  let url = (website || "").trim();
  if (!url) return { emails: [], phones: [], pagesFetched: 0 };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const rankedEmails = new Map<string, number>();
  const phones = new Set<string>();
  let pagesFetched = 0;
  const paths = contactPaths(url).slice(0, 3);

  for (const path of paths) {
    const html = await fetchHtml(path);
    if (!html) continue;
    pagesFetched += 1;
    for (const { email, score } of emailsFromHtml(html)) {
      rankedEmails.set(email, Math.max(rankedEmails.get(email) ?? 0, score));
    }
    for (const phone of phonesFromHtml(html)) {
      phones.add(phone);
    }
    if (rankedEmails.size >= 3 && phones.size >= 1) break;
  }

  const emails = [...rankedEmails.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
    .slice(0, 5);

  return { emails, phones: [...phones].slice(0, 5), pagesFetched };
}
