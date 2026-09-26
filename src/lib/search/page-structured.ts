/**
 * Structured page facts — JSON-LD (schema.org) + mailto/tel links.
 *
 * Prefer deterministic structured facts before model extraction: free,
 * quote-able, and exact. NEVER invents — only values literally present in
 * the page. Used for job postings (JobPosting), organization identity, and
 * public contacts on first-party pages.
 */

export type StructuredJobPosting = {
  title: string;
  employer: string | null;
  url: string | null;
  location: string | null;
  salary: string | null;
  datePosted: string | null;
  employmentType: string | null;
};

export type StructuredPageFacts = {
  jobs: StructuredJobPosting[];
  organizationName: string | null;
  emails: string[];
  phones: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const v = value.trim();
    return v || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && "@value" in (value as Record<string, unknown>)) {
    return asText((value as Record<string, unknown>)["@value"]);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const t = asText(item);
      if (t) return t;
    }
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function collectJsonLd(node: unknown, out: unknown[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLd(item, out);
    return;
  }
  out.push(node);
  const graph = (node as Record<string, unknown>)["@graph"];
  if (graph) collectJsonLd(graph, out);
}

function salaryText(baseSalary: unknown): string | null {
  if (!baseSalary || typeof baseSalary !== "object") return asText(baseSalary);
  const bs = baseSalary as Record<string, unknown>;
  const currency = asText(bs.currency) ?? "";
  const value = bs.value;
  let amount: string | null = null;
  let unit = "";
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const min = asText(v.minValue);
    const max = asText(v.maxValue);
    const single = asText(v.value);
    unit = (asText(v.unitText) ?? "").toUpperCase();
    const sym = currency === "USD" ? "$" : currency ? `${currency} ` : "";
    if (min && max) amount = `${sym}${min}–${sym}${max}`;
    else amount = single ? `${sym}${single}` : null;
  } else {
    amount = asText(value);
  }
  if (!amount) return null;
  if (unit === "YEAR" || unit === "HOUR") unit = unit === "YEAR" ? "a year" : "an hour";
  return unit ? `${amount} ${unit}` : amount;
}

function interpretNode(node: Record<string, unknown>, facts: StructuredPageFacts): void {
  const types = asArray(node["@type"]).flatMap((t) => String(t).split(/[\s,]+/));
  const type = types[0]?.toLowerCase() ?? "";
  if (type === "jobposting") {
    const title = asText(node.title);
    if (!title) return;
    const org = node.hiringOrganization as Record<string, unknown> | undefined;
    const jobLocation = asArray(node.jobLocation)[0] as Record<string, unknown> | undefined;
    const address = (jobLocation?.address ?? node.jobLocation) as Record<string, unknown> | undefined;
    const location =
      asText(address?.addressLocality) ??
      asText(address?.addressRegion) ??
      (typeof node.jobLocation === "string" ? asText(node.jobLocation) : null) ??
      (node.jobLocationType === "TELECOMMUTE" ? "Remote" : null);
    facts.jobs.push({
      title: title.slice(0, 160),
      employer: asText(org && typeof org === "object" ? (org as Record<string, unknown>).name : org) ?? asText(node.hiringOrganization),
      url: asText(node.url) ?? asText(node["@id"]),
      location,
      salary: salaryText(node.baseSalary),
      datePosted: /^\d{4}-\d{2}-\d{2}/.test(asText(node.datePosted) ?? "")
        ? (asText(node.datePosted) ?? "").slice(0, 10)
        : null,
      employmentType: asText(node.employmentType),
    });
    return;
  }
  if (type === "organization" || type === "localbusiness" || type === "store" || type === "professionalservice") {
    const name = asText(node.name);
    if (name && !facts.organizationName) facts.organizationName = name.slice(0, 160);
    const email = asText(node.email);
    if (email && EMAIL_RE.test(email) && !facts.emails.includes(email.toLowerCase())) facts.emails.push(email.toLowerCase());
    const phone = asText(node.telephone);
    if (phone && /^[+\d\s().-]{7,}$/.test(phone) && !facts.phones.includes(phone)) facts.phones.push(phone);
    for (const cp of asArray(node.contactPoint)) {
      if (!cp || typeof cp !== "object") continue;
      const point = cp as Record<string, unknown>;
      const cpEmail = asText(point.email);
      if (cpEmail && EMAIL_RE.test(cpEmail) && !facts.emails.includes(cpEmail.toLowerCase())) facts.emails.push(cpEmail.toLowerCase());
      const cpPhone = asText(point.telephone);
      if (cpPhone && /^[+\d\s().-]{7,}$/.test(cpPhone) && !facts.phones.includes(cpPhone)) facts.phones.push(cpPhone);
    }
  }
}

/** Parse every JSON-LD block + contact links out of raw HTML. Bounded + safe. */
export function extractStructuredFacts(html: string): StructuredPageFacts {
  const facts: StructuredPageFacts = { jobs: [], organizationName: null, emails: [], phones: [] };
  if (!html) return facts;
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const nodes: unknown[] = [];
      collectJsonLd(parsed, nodes);
      for (const node of nodes) {
        if (node && typeof node === "object" && !Array.isArray(node)) {
          interpretNode(node as Record<string, unknown>, facts);
        }
      }
    } catch {
      // Malformed JSON-LD — skip; never fabricate from partial parse.
    }
  }
  for (const match of html.matchAll(/href=["']mailto:([^"'?\s>]+)/gi)) {
    const email = decodeURIComponent(match[1] ?? "").toLowerCase();
    if (EMAIL_RE.test(email) && !facts.emails.includes(email)) facts.emails.push(email);
  }
  for (const match of html.matchAll(/href=["']tel:([^"'?\s>]+)/gi)) {
    const phone = decodeURIComponent(match[1] ?? "").replace(/\s+/g, " ").trim();
    if (/^[+\d\s().-]{7,}$/.test(phone) && !facts.phones.includes(phone)) facts.phones.push(phone);
  }
  return facts;
}

/** Parse a bare JSON-LD payload (e.g. a browser extract field) — no HTML. */
export function factsFromJsonLdText(text: string): StructuredPageFacts {
  const facts: StructuredPageFacts = { jobs: [], organizationName: null, emails: [], phones: [] };
  const raw = text?.trim();
  if (!raw) return facts;
  try {
    const parsed: unknown = JSON.parse(raw);
    const nodes: unknown[] = [];
    collectJsonLd(parsed, nodes);
    for (const node of nodes) {
      if (node && typeof node === "object" && !Array.isArray(node)) {
        interpretNode(node as Record<string, unknown>, facts);
      }
    }
  } catch {
    // Malformed or concatenated payloads — skip.
  }
  return facts;
}
