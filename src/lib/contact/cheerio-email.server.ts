/**
 * Cheerio-based website email extraction for Local Businesses.
 * Fetches public HTML (contact/about/home) and pulls published mailto + text emails.
 */
import * as cheerio from "cheerio";

const MAILTO_RE = /mailto:([a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const PLAIN_EMAIL_RE = /\b[a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
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
 * Visit a business website (home + contact/about) and extract published emails.
 */
export async function extractEmailsWithCheerio(
  website: string,
): Promise<{ emails: string[]; pagesFetched: number }> {
  let url = (website || "").trim();
  if (!url) return { emails: [], pagesFetched: 0 };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const ranked = new Map<string, number>();
  let pagesFetched = 0;
  const paths = contactPaths(url).slice(0, 3);

  for (const path of paths) {
    const html = await fetchHtml(path);
    if (!html) continue;
    pagesFetched += 1;
    for (const { email, score } of emailsFromHtml(html)) {
      ranked.set(email, Math.max(ranked.get(email) ?? 0, score));
    }
    if (ranked.size >= 3) break;
  }

  const emails = [...ranked.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
    .slice(0, 5);

  return { emails, pagesFetched };
}
