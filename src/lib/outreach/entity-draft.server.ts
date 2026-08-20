/**
 * Entity-aware outreach draft generation for the Company 360 drawer
 * (investor / business / job).
 *
 * The prompt is assembled only from fields that actually exist on the
 * entity — missing fields are omitted entirely, never rendered as "N/A"
 * and never back-filled with invented facts.
 */
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";

export type OutreachDomain = "investor" | "business" | "job";

export interface EntityOutreachContext {
  // Shared identity
  name?: string;
  subtitle?: string;
  category?: string;
  location?: string;
  description?: string;
  website?: string;
  email?: string;
  phone?: string;
  tags?: string[];

  // Investor-specific
  sectors?: string[];
  firm?: string;
  investor_type?: string;
  stage?: string;
  check_size?: string;
  thesis?: string;

  // Job-specific
  role_title?: string;
  company_name?: string;
  seniority?: string;
  salary?: string;
  source?: string;
  job_url?: string;
  remote?: boolean;

  // Business-specific
  opportunity_tags?: string[];
}

export interface SenderContext {
  name?: string | null;
  jobTitle?: string | null;
  skills?: string[] | null;
}

export interface EntityOutreachDraft {
  subject: string;
  body: string;
}

const STYLE_RULES = [
  "Write like a real person sending a cold email, not like an AI assistant.",
  "Never use em dashes or en dashes anywhere. Use commas or full stops instead.",
  "No generic openers such as 'I hope this email finds you well', 'I came across your profile', or 'I hope you're doing well'.",
  "No flattery, no compliments, no long intros. One specific observation about them is enough.",
  "Keep the body under 150 words: greeting, one-sentence observation, why you are reaching out, one ask, sign-off.",
  "Plain text only. No bullet lists, no markdown, no bold, no headers.",
  "Use only facts from the context below. If a detail is not listed, do not mention it.",
  "Never use bracketed placeholders like [company] or [describe briefly]. If a sender or company detail is missing, phrase the sentence generally instead. The only allowed placeholder is the sign-off '[Your Name]' when the sender's name is unknown.",
  "End with one low-friction ask (a short call or a reply).",
].join("\n- ");

function humanize(value: string): string {
  return value.replace(/_/g, " ").trim();
}

function clip(value: string, max: number): string {
  const s = value.trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pushLine(lines: string[], label: string, value?: string | null): void {
  const v = (value ?? "").trim();
  if (v) lines.push(`- ${label}: ${v}`);
}

/** Entity context block: only the fields that exist for this entity. */
function entityBlock(domain: OutreachDomain, e: EntityOutreachContext): string {
  const lines: string[] = [];

  if (domain === "investor") {
    pushLine(lines, "Investor", e.name);
    pushLine(lines, "Firm", e.firm);
    pushLine(lines, "Investor type", e.investor_type ? humanize(e.investor_type) : undefined);
    pushLine(lines, "Thesis", e.thesis ? clip(e.thesis, 500) : undefined);
    const sectors = e.sectors?.length ? e.sectors : e.tags;
    if (sectors?.length) pushLine(lines, "Sectors / focus", sectors.join(", "));
    pushLine(lines, "Stage", e.stage);
    pushLine(lines, "Typical check", e.check_size);
    pushLine(lines, "Geography", e.location);
    if (e.description) pushLine(lines, "About", clip(e.description, 400));
    pushLine(lines, "Website", e.website);
  } else if (domain === "business") {
    pushLine(lines, "Business", e.name);
    pushLine(lines, "Industry", e.category);
    pushLine(lines, "Location", e.location);
    if (e.description) pushLine(lines, "About", clip(e.description, 400));
    if (e.opportunity_tags?.length) {
      pushLine(lines, "Observed gaps", e.opportunity_tags.map(humanize).join(", "));
    }
    pushLine(lines, "Website", e.website);
    pushLine(lines, "Contact email on file", e.email);
    pushLine(lines, "Phone on file", e.phone);
  } else {
    pushLine(lines, "Role", e.role_title || e.name);
    pushLine(lines, "Company", e.company_name);
    pushLine(lines, "Location", e.location);
    if (e.remote !== undefined) pushLine(lines, "Remote", e.remote ? "Yes" : "No");
    pushLine(lines, "Seniority", e.seniority);
    pushLine(lines, "Salary", e.salary);
    if (e.description) pushLine(lines, "Job description excerpt", clip(e.description, 600));
    pushLine(
      lines,
      "Source",
      e.source ? humanize(e.source.replace(/^source-(ats-)?/, "")) : undefined,
    );
  }

  return lines.join("\n");
}

function senderBlock(sender: SenderContext): string {
  const lines: string[] = [];
  pushLine(lines, "Name", sender.name);
  pushLine(lines, "Role", sender.jobTitle);
  if (sender.skills?.length) pushLine(lines, "Skills", sender.skills.slice(0, 8).join(", "));
  return lines.length
    ? lines.join("\n")
    : "- (Not specified. Sign off with '[Your Name]' so the sender can fill it in.)";
}

function goalFor(domain: OutreachDomain): string {
  if (domain === "investor") {
    return "The sender is a founder or operator exploring whether this investor is a fit for their company. The reason for outreach is to start a conversation about a potential investment, referencing the investor's focus areas, stage, or thesis where available.";
  }
  if (domain === "business") {
    return "The sender offers a product or service that plausibly helps this business (web presence, design, marketing, or operations). The reason for outreach is one concrete, specific improvement tied to the business context or observed gaps above.";
  }
  return "The sender is a candidate interested in this role. The reason for outreach is a short, direct application note that connects the sender's background to the role's requirements and asks about next steps.";
}

export function buildEntityOutreachPrompt(
  domain: OutreachDomain,
  entity: EntityOutreachContext,
  sender: SenderContext,
): { system: string; user: string } {
  const system =
    "You are a cold-email copywriter. You write short, plain, specific emails that a real " +
    "founder, salesperson, or job applicant would send. You never invent facts about the " +
    "recipient. Reply with JSON only, no markdown fences.";

  const user = `${goalFor(domain)}

Style rules:
- ${STYLE_RULES}

Recipient context (${domain}):
${entityBlock(domain, entity) || "- (No context available. Keep the email generic but honest.)"}

Sender:
${senderBlock(sender)}

Return JSON exactly:
{"subject": "<=8 words, specific to the recipient, no dashes", "body": "the plain-text email"}`;

  return { system, user };
}

/** Enforce style rules even when a provider ignores them. */
export function sanitizeOutreachText(text: string): string {
  return (
    text
      .replace(/\s*[—–]\s*/g, ", ")
      // Strip bracketed fill-in placeholders (keep only the '[Your Name]' sign-off).
      .replace(/\[(?!Your Name\])[^\]\n]{0,60}\]/g, "")
      .replace(/,\s*,+/g, ",")
      .replace(/,\s*\./g, ".")
      .replace(/\s+\./g, ".")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export async function draftEntityOutreachEmail(
  domain: OutreachDomain,
  entity: EntityOutreachContext,
  sender: SenderContext,
): Promise<EntityOutreachDraft> {
  const { system, user } = buildEntityOutreachPrompt(domain, entity, sender);

  const raw = await aiComplete({
    task: "research",
    system,
    user,
    // Deliberately NOT provider-enforced JSON mode: long-form email bodies make
    // strict response_format brittle on some providers (Groq gpt-oss returns
    // 400 json_validate_failed). The prompt still demands a bare JSON object
    // and safeJsonParse strips fences / extracts the object.
    json: false,
    // Above the cache threshold on purpose: regenerating must produce a
    // fresh draft, not the cached one.
    temperature: 0.7,
    maxTokens: 900,
  });

  const parsed = safeJsonParse<{ subject?: string; body?: string }>(raw);
  const subject = sanitizeOutreachText(parsed?.subject ?? "");
  const body = sanitizeOutreachText(parsed?.body ?? "");
  if (!body) {
    throw new Error("AI returned an unusable draft. Please try again.");
  }
  return { subject, body };
}
