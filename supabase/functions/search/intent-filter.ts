import type { Lead, SearchQuery } from "./types.ts";

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const BUYER_SIGNALS = [
  "looking for",
  "need a",
  "need someone",
  "need help",
  "hiring",
  "we need",
  "we are hiring",
  "we're hiring",
  "our team needs",
  "seeking a",
  "searching for",
  "want to hire",
  "want to find",
  "can anyone recommend",
  "anyone know a good",
  "recommend a",
  "dm me if",
  "reach out if you",
  "apply here",
  "apply at",
  "paid gig",
  "paid project",
  "paid work",
  "paying for",
  "budget:",
  "budget of",
  "budget is",
  "up to $",
  "pay $",
  "job posting",
  "job opportunity",
  "position available",
  "open role",
  "remote position",
  "freelance gig",
  "contract available",
  "help wanted",
  "work available",
  "project available",
  "looking to hire",
  "want to bring on",
  "our startup needs",
  "our company needs",
  "building something",
  "need someone to build",
  "short term project",
  "long term",
  "ongoing work",
  "urgent",
  "asap",
  "this week",
  "starting soon",
  "immediate start",
  "open to freelancers",
  "open to contractors",
  "we are looking",
  "our team is looking",
  "agency looking",
  "company seeking",
];

export function isWithin14Days(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return Date.now() - d.getTime() <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function relativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  } catch {
    return "recently";
  }
}

export function hasBuyerIntent(text: string, negativePhrases: string[]): boolean {
  const lower = (text || "").toLowerCase();
  const hasSignal = BUYER_SIGNALS.some((s) => lower.includes(s));
  if (!hasSignal) return false;
  const hasNegative = negativePhrases.some((n) => lower.includes(n));
  if (hasNegative) return false;
  return true;
}

export function detectDecisionMaker(text: string): boolean {
  return /\b(ceo|cto|coo|cpo|founder|co-founder|cofounder|owner|director|vp of|head of|president|principal|partner|hiring manager|talent|recruiter|our company|our startup|our team|we are a)\b/i.test(
    text,
  );
}

export function scoreIntent(params: {
  text: string;
  platform: string;
  postedAt: string;
  isDecisionMaker: boolean;
  platformSourceConfidence: number;
}): {
  score: number;
  tier: "hot" | "warm" | "signal";
  hasBudget: boolean;
  hasUrgency: boolean;
} {
  let score = 0;
  const text = (params.text || "").toLowerCase();

  score += Math.min(25, Math.floor(params.platformSourceConfidence * 0.25));

  const hoursOld = (Date.now() - new Date(params.postedAt).getTime()) / 3600000;
  if (hoursOld < 2) score += 30;
  else if (hoursOld < 6) score += 28;
  else if (hoursOld < 12) score += 26;
  else if (hoursOld < 24) score += 23;
  else if (hoursOld < 48) score += 18;
  else if (hoursOld < 72) score += 13;
  else if (hoursOld < 168) score += 8;
  else if (hoursOld < 336) score += 3;
  else return { score: 0, tier: "signal", hasBudget: false, hasUrgency: false };

  const hasBudget = /\$[\d,]+k?|\d+k\/(?:yr|year|month|mo|hr|hour)|budget|compensation|rate:|salary/i.test(
    params.text,
  );
  if (hasBudget) score += 12;

  const hasUrgency = /\basap\b|urgent|immediately|this week|right away|quickly|starting soon|need now|asap/i.test(
    text,
  );
  if (hasUrgency) score += 8;

  if (params.isDecisionMaker) score += 10;

  const signalCount = BUYER_SIGNALS.filter((s) => text.includes(s)).length;
  score += Math.min(15, signalCount * 3);

  score = Math.min(100, Math.max(0, score));
  const tier: "hot" | "warm" | "signal" =
    score >= 70 ? "hot" : score >= 45 ? "warm" : "signal";

  return { score, tier, hasBudget, hasUrgency };
}

export function generateSummary(title: string, body: string, skill: string): string {
  const combined = (title + " " + body).slice(0, 800);
  const sentences = combined.split(/[.!?\n]/).filter((s) => s.trim().length > 20);
  const relevant = sentences.find((s) => {
    const lower = s.toLowerCase();
    return BUYER_SIGNALS.some((sig) => lower.includes(sig)) && lower.includes(skill.toLowerCase());
  });
  return (relevant || sentences[0] || title || "").trim().slice(0, 200);
}

export function generateWhyShown(
  platform: string,
  skill: string,
  hasBudget: boolean,
  isDecisionMaker: boolean,
  _tier: string,
  postedAt: string,
): string {
  const reasons: string[] = [];
  const pl = platform.toLowerCase();
  if (pl.includes("forhire") && pl.includes("hiring")) {
    reasons.push("Posted in r/forhire with [Hiring] flair");
  } else if (pl.includes("greenhouse") || pl.includes("lever")) {
    reasons.push("Active verified job posting");
  } else if (pl.includes("hn") || pl.includes("hacker news")) {
    reasons.push("In HN's monthly Who is Hiring? thread");
  } else if (pl.includes("upwork")) {
    reasons.push("Active Upwork client job posting");
  } else if (pl.includes("linkedin")) {
    reasons.push("LinkedIn post with hiring intent");
  } else if (pl.includes("twitter") || pl.includes("x.com")) {
    reasons.push("Twitter/X post with hiring signal");
  } else {
    reasons.push(`Contains buyer-intent signals for "${skill}"`);
  }
  if (hasBudget) reasons.push("Budget or rate mentioned");
  if (isDecisionMaker) reasons.push("Decision maker detected");
  reasons.push(relativeTime(postedAt));
  return reasons.join(" · ");
}

export function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  return leads.filter((l) => {
    const key = l.post_url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isRelevantToSkill(text: string, skill: string): boolean {
  const lower = text.toLowerCase();
  const words = skill.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return true;
  return words.some((w) => lower.includes(w));
}
