// =====================================================================
// Contact provenance & CASL compliance
//
// Every contact Scrapivo emits carries the evidence for WHY it was lawful to
// collect and (for the customer) lawful to use. This is the part competitors
// don't ship: Apollo hands you a bare email with no source. We hand over the
// URL it was published on, when we saw it, a hash of what the page said, and
// whether that page carried a statement refusing commercial messages.
//
// Why CASL specifically: the user is in Alberta, so their own outbound and
// their customers' outbound are governed by it, and unlike CAN-SPAM there is
// NO B2B exemption. The relevant basis is implied consent by conspicuous
// publication — CASL s.10(9)(b) — which requires THREE things at once:
//   1. the address was conspicuously published (not behind a login, not
//      obtained from a broker, not guessed),
//   2. the publication was NOT accompanied by a statement that the person
//      does not wish to receive unsolicited commercial electronic messages,
//   3. the message is relevant to the person's business role or functions.
// The sender carries the onus of proving consent, so "we found it somewhere"
// is not a defence — the record has to be reconstructable. That's this file.
//
// NOTE: a pattern-derived address is NOT conspicuously published, no matter
// how well it verifies. It gets basis "none" here on purpose, and the UI must
// keep saying so rather than laundering a guess into a "verified contact".
// =====================================================================
import { createHash } from "node:crypto";

/** How a contact value came to us. Drives the lawful-basis assessment. */
export type ContactMethod =
  /** Read off a page the company itself published (mailto:, visible text). */
  | "harvested"
  /** schema.org JSON-LD / microdata the site published for machines to read. */
  | "structured_data"
  /** DNS: DMARC rua/ruf, security.txt contact, SOA rname. */
  | "dns_record"
  /** Company/officer registry: OpenCorporates, GLEIF, SEC EDGAR, Companies House. */
  | "registry"
  /** Generated from a name + an inferred org pattern. NOT published. */
  | "pattern_derived"
  /** A paid enrichment provider asserted it (Hunter, PDL, CoreClaw). */
  | "paid_provider"
  /** Present in the body of the post/listing that produced the lead. */
  | "post_text"
  /** Public social / link-in-bio page the person controls. */
  | "profile_harvest";

/** Methods where the value was genuinely published by/for the contact. */
const PUBLISHED_METHODS: ReadonlySet<ContactMethod> = new Set<ContactMethod>([
  "harvested",
  "structured_data",
  "dns_record",
  "registry",
  "post_text",
  "profile_harvest",
]);

export type ContactProvenance = {
  method: ContactMethod;
  /** Page/endpoint the value was read from. Absent only for derived values. */
  source_url?: string;
  /** ISO timestamp of capture — evidence decays, so the date is part of it. */
  captured_at: string;
  /** sha256 of the captured text, so "the page said this" is checkable later. */
  content_hash?: string;
  /** Where in the document it came from: "mailto:", "json-ld:Organization.email"… */
  locator?: string;
  /**
   * Did the source page carry a statement refusing commercial messages?
   * true = refusal found (implied consent is NOT available)
   * false = page assessed, no refusal found
   * null = not assessable (e.g. a DNS record has no prose to check)
   */
  anti_cem_statement: boolean | null;
  /** Role/title captured alongside, so CASL relevance is assessable. */
  role_title?: string;
  /** Host that published it (may differ from the contact's own domain). */
  publisher?: string;
  /** Free-text note for the audit trail. */
  note?: string;
};

export type ContactValueKind = "email" | "phone" | "profile_url";

/** A single contact datum plus everything needed to defend having it. */
export type ProvenancedContact = {
  kind: ContactValueKind;
  value: string;
  /** Person the value belongs to, when known. */
  name?: string;
  role_title?: string;
  /** 0..1 — how sure we are the value is correct and reachable. */
  confidence: number;
  provenance: ContactProvenance[];
};

// ── content hashing ─────────────────────────────────────────────────────────

/** Stable sha256 of page text, whitespace-normalised so trivial re-renders match. */
export function contentHash(text: string): string {
  return createHash("sha256")
    .update((text || "").replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 32);
}

// ── anti-CEM statement detection ────────────────────────────────────────────
//
// Sites that refuse commercial email say so in a small number of stock ways.
// French matters here: Canadian and EU sites frequently publish the refusal in
// French only, and missing it would be exactly the failure CASL punishes.
const ANTI_CEM_PATTERNS: RegExp[] = [
  /\bno\s+(?:unsolicited|cold)\s+(?:commercial\s+)?(?:e-?mails?|messages?|offers?|solicitations?|pitch(?:es)?)\b/i,
  /\b(?:do\s+not|don'?t|please\s+do\s+not)\s+(?:send|contact\s+us\s+with)\s+(?:any\s+)?(?:unsolicited|marketing|promotional|sales|commercial)\b/i,
  /\bunsolicited\s+(?:commercial\s+)?(?:e-?mail|message|advertis\w+|marketing)[^.]{0,40}\b(?:not\s+(?:welcome|accepted|permitted)|prohibited|forbidden|refused)\b/i,
  /\bno\s+(?:sales|marketing|vendor|recruiter|agency|solicitation)\s+(?:calls?|e-?mails?|enquiries|inquiries|pitches)\b/i,
  /\b(?:we\s+)?(?:do\s+not|don'?t)\s+(?:accept|welcome)\s+(?:unsolicited|cold)\b/i,
  /\bopt(?:ed)?[-\s]?out\s+of\s+(?:commercial|marketing)\s+(?:e-?mail|message)/i,
  /\bthis\s+(?:e-?mail\s+)?address\s+(?:is\s+not|may\s+not\s+be\s+used)\s+for\s+(?:marketing|solicitation|commercial)/i,
  // German (Impressum boilerplate — extremely common and legally explicit)
  /\bwerbe(?:mails?|zusendungen)\s+(?:sind\s+)?(?:nicht\s+erw(?:ü|ue)nscht|untersagt)\b/i,
  /\bder\s+nutzung[^.]{0,80}\bwerbe(?:zwecken|mails?)\b[^.]{0,40}\bwiderspr\w+/i,
  // French
  /\b(?:pas|aucun)\s+de?\s+(?:courriels?|messages?|sollicitations?)\s+(?:commerciaux?|non\s+sollicit(?:é|e)s?)\b/i,
  /\bne\s+(?:souhaitons?|souhaite|voulons|veux|acceptons?)\s+pas\s+(?:recevoir|de)\b[^.]{0,80}(?:commerci\w+|non\s+sollicit\w+|publicitaires?)/i,
  /\bne\s+pas\s+(?:envoyer|utiliser)[^.]{0,60}\b(?:fins?\s+commerciales?|prospection|marketing|publicit)/i,
  /\bd(?:é|e)marchage\s+(?:commercial\s+)?(?:interdit|refus(?:é|e))\b/i,
];

/**
 * Look for a published refusal of commercial messages on the source page.
 * Returns null when there is no prose to assess (DNS records, empty bodies) —
 * "not assessed" and "assessed, clean" are different facts and must not be
 * collapsed, because only the second one supports implied consent.
 */
export function detectAntiCemStatement(pageText: string | undefined | null): boolean | null {
  const text = (pageText || "").trim();
  if (text.length < 40) return null;
  return ANTI_CEM_PATTERNS.some((re) => re.test(text));
}

// ── CASL implied-consent assessment ─────────────────────────────────────────

export type ConsentBasis =
  /** s.10(9)(b) conspicuous publication — all three conditions met. */
  | "implied_conspicuous_publication"
  /** Published, but we could not assess the page for a refusal statement. */
  | "implied_unverified"
  /** No lawful basis from publication (derived, brokered, or refusal found). */
  | "none";

export type ConsentAssessment = {
  basis: ConsentBasis;
  /** Safe to include in an outbound campaign without further checks. */
  outreach_ready: boolean;
  /** Human-readable reasons — shown in the UI and exported with the record. */
  reasons: string[];
  /** The provenance entry the basis rests on, if any. */
  relied_on?: ContactProvenance;
};

export type ConsentInput = {
  provenance: ContactProvenance[];
  /** Title/role captured for the contact — CASL condition 3 needs it. */
  role_title?: string;
  /**
   * Whether the sender's offering is relevant to that role. The app can't know
   * this for certain, so it defaults to "unknown" and the reason string tells
   * the customer they own that judgement.
   */
  offeringRelevantToRole?: boolean;
};

/**
 * Assess whether CASL implied consent by conspicuous publication is available.
 * Deliberately conservative: anything derived, brokered, or published with a
 * refusal returns "none". We would rather under-claim a basis than hand a
 * customer a record that looks defensible and isn't.
 */
export function assessConsent(input: ConsentInput): ConsentAssessment {
  const reasons: string[] = [];
  const published = input.provenance.filter((p) => PUBLISHED_METHODS.has(p.method));

  if (!published.length) {
    const derived = input.provenance.some((p) => p.method === "pattern_derived");
    const paid = input.provenance.some((p) => p.method === "paid_provider");
    if (derived)
      reasons.push(
        "Address was derived from a name pattern, not published by the contact — conspicuous publication does not apply.",
      );
    if (paid)
      reasons.push(
        "Address came from a third-party data provider — publication cannot be evidenced from our own capture.",
      );
    if (!derived && !paid) reasons.push("No published source recorded for this value.");
    return { basis: "none", outreach_ready: false, reasons };
  }

  // A refusal anywhere we saw it published defeats the basis outright.
  const refused = published.find((p) => p.anti_cem_statement === true);
  if (refused) {
    reasons.push(
      `Source page states it does not accept unsolicited commercial messages${refused.source_url ? ` (${refused.source_url})` : ""} — implied consent is unavailable.`,
    );
    return { basis: "none", outreach_ready: false, reasons, relied_on: refused };
  }

  // Prefer a source we actually assessed for a refusal statement.
  const clean = published.find((p) => p.anti_cem_statement === false);
  const relied = clean ?? published[0];
  reasons.push(
    `Conspicuously published at ${relied.source_url || relied.publisher || "a public source"}${relied.captured_at ? ` (captured ${relied.captured_at.slice(0, 10)})` : ""}.`,
  );

  if (!clean) {
    reasons.push("Source could not be scanned for a refusal statement — confirm before sending.");
    return { basis: "implied_unverified", outreach_ready: false, reasons, relied_on: relied };
  }
  reasons.push("No statement refusing unsolicited commercial messages found on the source page.");

  const role = input.role_title || relied.role_title;
  if (!role) {
    reasons.push(
      "No role/title captured — CASL also requires the message to be relevant to the recipient's role, which cannot be evidenced without one.",
    );
    return { basis: "implied_unverified", outreach_ready: false, reasons, relied_on: relied };
  }
  reasons.push(`Role captured: ${role}.`);

  if (input.offeringRelevantToRole === false) {
    reasons.push("Offering marked as not relevant to this role — relevance condition fails.");
    return { basis: "none", outreach_ready: false, reasons, relied_on: relied };
  }
  if (input.offeringRelevantToRole === undefined) {
    reasons.push(
      "Relevance of your offering to this role is your assessment to make before sending.",
    );
  }

  return {
    basis: "implied_conspicuous_publication",
    outreach_ready: true,
    reasons,
    relied_on: relied,
  };
}

/** Convenience: build a provenance entry with the timestamp filled in. */
export function provenanceEntry(
  method: ContactMethod,
  fields: Omit<Partial<ContactProvenance>, "method" | "captured_at"> = {},
): ContactProvenance {
  return {
    method,
    captured_at: new Date().toISOString(),
    anti_cem_statement: fields.anti_cem_statement ?? null,
    ...fields,
  };
}

/**
 * Flatten a contact's provenance into an export row — this is the artifact a
 * customer would hand a regulator, so it stays plain and complete.
 */
export function complianceRow(contact: ProvenancedContact, consent: ConsentAssessment) {
  const first = consent.relied_on ?? contact.provenance[0];
  return {
    value: contact.value,
    kind: contact.kind,
    name: contact.name ?? "",
    role_title: contact.role_title ?? first?.role_title ?? "",
    method: first?.method ?? "",
    source_url: first?.source_url ?? "",
    captured_at: first?.captured_at ?? "",
    content_hash: first?.content_hash ?? "",
    anti_cem_statement:
      first?.anti_cem_statement === null || first?.anti_cem_statement === undefined
        ? "not assessed"
        : first.anti_cem_statement
          ? "present"
          : "absent",
    consent_basis: consent.basis,
    outreach_ready: consent.outreach_ready,
    notes: consent.reasons.join(" "),
  };
}
