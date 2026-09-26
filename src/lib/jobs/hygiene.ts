import type { JobPosting, RawJobPosting } from "./types";

const MAX_AGE_DAYS = 30;
const PREFER_AGE_DAYS = 14;

const CLOSED_RE =
  /\b(closed|no longer accepting|position filled|no longer available|expired|this role has been filled)\b/i;

const SCAM_RE =
  /\b(telegram|gift card|crypto wallet|binance|wire transfer|earn \$?\d+\s*\/\s*(day|hr|hour)|\$\d{3,}\s*\/\s*day|no experience (needed|required).{0,40}(\$|usd|salary))\b/i;

const SHORTENER_RE = /bit\.ly|tinyurl\.com|t\.co\/|goo\.gl|ow\.ly/i;

const ATS_HOST_RE =
  /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com/i;

export function sanitizeJobText(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = String(raw);
  // 1. Decode double-encoded HTML entities if present
  text = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");

  // 2. Strip HTML tags
  text = text.replace(/<[^>]*>/g, " ");

  // 3. Decode remaining entities (named + numeric hex/decimal — ATS titles
  // often ship `&#x28;Senior&#x29;` which named-entity passes leave intact).
  text = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = Number.parseInt(h, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = Number.parseInt(d, 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : "";
    });

  // 4. Collapse whitespace
  return text.replace(/\s+/g, " ").trim();
}

export function isClosedJob(job: Pick<RawJobPosting, "title" | "description">): boolean {
  return CLOSED_RE.test(`${job.title} ${job.description || ""}`);
}

export function isScamJob(
  job: Pick<RawJobPosting, "title" | "company" | "url" | "description">,
): boolean {
  const blob = `${job.title} ${job.company} ${job.description || ""}`;
  if (SCAM_RE.test(blob)) return true;
  if (/t\.me\//i.test(job.url) && !ATS_HOST_RE.test(job.url)) return true;
  if (SHORTENER_RE.test(job.url) && !ATS_HOST_RE.test(job.url)) return true;
  return false;
}

export function isStaleDated(postedAt: string | null | undefined): boolean {
  if (!postedAt) return false;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return false;
  const ageDays = (Date.now() - t) / 86_400_000;
  return ageDays > MAX_AGE_DAYS;
}

export function recencyRank(postedAt: string | null | undefined): number {
  if (!postedAt) return 1;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return 1;
  const ageDays = (Date.now() - t) / 86_400_000;
  if (ageDays <= 2) return 4;
  if (ageDays <= PREFER_AGE_DAYS) return 3;
  if (ageDays <= MAX_AGE_DAYS) return 2;
  return 0;
}

export function isActiveJob(job: RawJobPosting | JobPosting): boolean {
  if (!job.title?.trim() || !job.company?.trim() || !job.url?.trim()) return false;
  if (isClosedJob(job)) return false;
  if (isScamJob(job)) return false;
  if (isStaleDated(job.posted_at)) return false;
  return true;
}

export function preferAtsUrl(a: JobPosting, b: JobPosting): JobPosting {
  const aAts = ATS_HOST_RE.test(a.url);
  const bAts = ATS_HOST_RE.test(b.url);
  if (aAts && !bAts) return a;
  if (bAts && !aAts) return b;
  return recencyRank(a.posted_at) >= recencyRank(b.posted_at) ? a : b;
}

export function secondaryDedupeKey(job: JobPosting): string {
  const normCompany = job.company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const normTitle = job.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const locRaw = (job.location || "").toLowerCase();
  const isRem = job.remote || /remote|anywhere|wfh/i.test(locRaw);
  const normLoc = isRem
    ? "remote"
    : locRaw
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .slice(0, 30);

  return `${normCompany}|${normTitle}|${normLoc}`;
}
