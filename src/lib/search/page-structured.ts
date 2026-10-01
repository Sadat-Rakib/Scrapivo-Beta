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

/** A literal schema.org local-business node (standalone, @graph, or ItemList entry). */
export type StructuredLocalBusiness = {
  name: string;
  /** Literal @type values, e.g. ["Restaurant"]. */
  types: string[];
  url: string | null;
  telephone: string | null;
  streetAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  /** Where on the page it came from: a list entry or a standalone node. */
  source: "item_list" | "node";
};

export type StructuredPageFacts = {
  jobs: StructuredJobPosting[];
  organizationName: string | null;
  /** Canonical postal place of the organization ("City, Region"/country). */
  organizationLocation: string | null;
  emails: string[];
  phones: string[];
  /** Local businesses literally described by JSON-LD (directory lists included). */
  businesses?: StructuredLocalBusiness[];
};

/** Separator a browser adapter uses when returning several JSON-LD blocks. */
export const JSONLD_BLOCK_SEPARATOR = "\u001E";
const MAX_BUSINESSES = 150;
/** schema.org LocalBusiness and its common subclasses (never plain Organization). */
const LOCAL_BUSINESS_TYPE = /^(?:LocalBusiness|Restaurant|FoodEstablishment|FastFoodRestaurant|CafeOrCoffeeShop|Bakery|BarOrPub|Brewery|Winery|Distillery|IceCreamShop|Store|\w+Store|AutoRepair|AutomotiveBusiness|AutoDealer|AutoBodyShop|HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|GeneralContractor|HousePainter|Locksmith|MovingCompany|ProfessionalService|LegalService|Attorney|Notary|AccountingService|FinancialService|InsuranceAgency|RealEstateAgent|TravelAgency|Dentist|MedicalBusiness|MedicalClinic|Physician|Pharmacy|Optician|Physiotherapy|HealthAndBeautyBusiness|BeautySalon|HairSalon|NailSalon|DaySpa|TattooParlor|SportsActivityLocation|ExerciseGym|HealthClub|ChildCare|DryCleaningOrLaundry|EntertainmentBusiness|LodgingBusiness|Hotel|Motel|BedAndBreakfast|VeterinaryCare|AnimalShelter|EmploymentAgency|RecyclingCenter|SelfStorage|ShoppingCenter|TouristInformationCenter|GovernmentOffice|PostOffice|Library|EmergencyService)$/;

function localBusinessOf(node: Record<string, unknown>, source: StructuredLocalBusiness["source"]): StructuredLocalBusiness | null {
  const types = asArray(node["@type"]).flatMap((t) => String(t).split(/[\s,]+/)).map((t) => t.replace(/^.*[/#]/, "")).filter(Boolean);
  if (!types.some((t) => LOCAL_BUSINESS_TYPE.test(t))) return null;
  const name = asText(node.name);
  if (!name || name.length < 2) return null;
  const address = node.address && typeof node.address === "object" && !Array.isArray(node.address)
    ? (node.address as Record<string, unknown>) : asArray(node.address)[0] as Record<string, unknown> | undefined;
  const country = address && typeof address === "object" ? address.addressCountry : null;
  const telephone = asText(node.telephone);
  return {
    name: name.slice(0, 160),
    types: types.filter((t) => LOCAL_BUSINESS_TYPE.test(t)),
    url: asText(node.url),
    telephone: telephone && /^[+\d\s().-]{7,}$/.test(telephone) ? telephone : null,
    streetAddress: address && typeof address === "object" ? asText(address.streetAddress) : null,
    locality: address && typeof address === "object" ? asText(address.addressLocality) : null,
    region: address && typeof address === "object" ? asText(address.addressRegion) : null,
    postalCode: address && typeof address === "object" ? asText(address.postalCode) : null,
    country: country && typeof country === "object" ? asText((country as Record<string, unknown>).name) : asText(country),
    source,
  };
}

function pushBusiness(facts: StructuredPageFacts, business: StructuredLocalBusiness | null): void {
  if (!business) return;
  facts.businesses ??= [];
  if (facts.businesses.length >= MAX_BUSINESSES) return;
  const key = `${business.name.toLowerCase()}|${(business.streetAddress ?? business.locality ?? "").toLowerCase()}`;
  if (facts.businesses.some((b) => `${b.name.toLowerCase()}|${(b.streetAddress ?? b.locality ?? "").toLowerCase()}` === key)) return;
  facts.businesses.push(business);
}

function orgAddressText(address: unknown): string | null {
  if (!address || typeof address !== "object") return asText(address);
  const a = address as Record<string, unknown>;
  return [asText(a.addressLocality), asText(a.addressRegion), asText(a.addressCountry)]
    .filter(Boolean)
    .join(", ") || null;
}

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
  // Directory lists describe many businesses. Their entries are collected as
  // businesses only; they never become the page's own organization/contacts.
  if (types.some((t) => /^itemlist$/i.test(t))) {
    for (const element of asArray(node.itemListElement)) {
      if (!element || typeof element !== "object") continue;
      const entry = element as Record<string, unknown>;
      const item = entry.item && typeof entry.item === "object" && !Array.isArray(entry.item) ? entry.item as Record<string, unknown> : entry;
      pushBusiness(facts, localBusinessOf(item, "item_list"));
    }
    return;
  }
  pushBusiness(facts, localBusinessOf(node, "node"));
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
    if (!facts.organizationLocation) {
      facts.organizationLocation = orgAddressText(node.address) ?? null;
    }
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
  const facts: StructuredPageFacts = { jobs: [], organizationName: null, organizationLocation: null, emails: [], phones: [] };
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

/**
 * Parse a bare JSON-LD payload (e.g. a browser extract field) — no HTML.
 * Several blocks may be joined by JSONLD_BLOCK_SEPARATOR; each parses alone,
 * so one malformed block never hides the others.
 */
export function factsFromJsonLdText(text: string): StructuredPageFacts {
  const facts: StructuredPageFacts = { jobs: [], organizationName: null, organizationLocation: null, emails: [], phones: [] };
  if (!text?.trim()) return facts;
  for (const block of text.split(JSONLD_BLOCK_SEPARATOR)) {
    const raw = block.trim();
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
      // Malformed or truncated block — skip it; never fabricate from a partial parse.
    }
  }
  return facts;
}
