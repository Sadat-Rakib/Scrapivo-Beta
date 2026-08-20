// =====================================================================
// Contact discovery orchestrator
//
// This is the file that answers the actual question: given a company (and
// maybe a person), how do we end up with an email, a phone number, and the
// evidence that we were allowed to have them.
//
// Build order matters and is encoded here:
//   1. HARVEST first — free, legally the cleanest, and it bootstraps step 3.
//   2. PEOPLE — names + titles, because a derived address needs a name and
//      CASL needs a role.
//   3. DERIVE — infer the org's address format from what we harvested, then
//      apply it. Catch-all is checked BEFORE we believe any of it.
//   4. VERIFY — free waterfall, self-hosted backends when configured.
//   5. PAID — only for what the first four missed. Not called from here; the
//      existing Hunter/PDL/CoreClaw fallbacks in contact.functions.ts stay the
//      last tier, and this layer's job is to make them rarely necessary.
//
// Every record comes out with provenance and a consent assessment attached,
// because that bundle — not raw coverage — is the thing a customer can't
// produce for themselves.
// =====================================================================
import {
  harvestDomainContacts,
  harvestToKnownAddresses,
  type DomainHarvest,
} from "./harvest.server";
import {
  deriveEmailCandidates,
  inferOrgPattern,
  parsePersonName,
  type PatternInference,
} from "./email-patterns";
import {
  verifyCandidates,
  verifyEmailDeep,
  verifyPhone,
  type EmailVerification,
  type PhoneVerification,
} from "./verify-contact.server";
import {
  assessConsent,
  complianceRow,
  provenanceEntry,
  type ConsentAssessment,
  type ContactProvenance,
} from "./provenance";
import {
  companiesHouseOfficers,
  edgarPhoneToDiscovered,
  findPeopleViaSearch,
  osmPhoneLookup,
  peopleFromHarvest,
  secEdgarCompany,
  type DiscoveredPerson,
  type DiscoveredPhone,
} from "./people-finder.server";
import { ROLE_LOCALPARTS } from "./contact-finder.server";

export type EmailRecord = {
  email: string;
  name?: string;
  role_title?: string;
  role_account: boolean;
  /** How it was obtained — drives the consent assessment and the UI label. */
  origin: "harvested" | "derived" | "dns" | "registry";
  confidence: number;
  verification: EmailVerification;
  provenance: ContactProvenance[];
  consent: ConsentAssessment;
};

export type PhoneRecord = {
  phone: string;
  e164: string | null;
  verification: PhoneVerification;
  attribution?: string;
  provenance: ContactProvenance[];
  consent: ConsentAssessment;
};

export type ContactDiscovery = {
  domain?: string;
  harvest: DomainHarvest | null;
  pattern: PatternInference | null;
  emails: EmailRecord[];
  phones: PhoneRecord[];
  people: DiscoveredPerson[];
  /** null = we couldn't determine it, which is different from "no". */
  catch_all: boolean | null;
  mx_provider: string;
  /** Flat rows suitable for CSV export alongside the leads. */
  compliance_rows: ReturnType<typeof complianceRow>[];
  /** Operator-facing trace of what ran and what it found. */
  notes: string[];
};

export type DiscoverOptions = {
  company: string;
  domain?: string;
  /** Target person, when the lead named one. */
  personName?: string;
  /** ICP roles used to steer person search ("VP Engineering", "Head of Ops"). */
  roles?: string[];
  /** ISO-2 for phone parsing and registry scoping. */
  countryHint?: string;
  /** Free sources only — no paid provider, no search-engine person lookup. */
  freeOnly?: boolean;
  /** Page budget for the site crawl. */
  maxPages?: number;
  /** Skip registry lookups (SEC/Companies House/OSM) when speed matters. */
  skipRegistries?: boolean;
};

/** How many harvested addresses are worth an individual verification pass. */
const MAX_VERIFY_HARVESTED = 5;
/** How many derived candidates to probe for a named person. */
const MAX_DERIVED_CANDIDATES = 4;

export async function discoverContacts(opts: DiscoverOptions): Promise<ContactDiscovery> {
  const notes: string[] = [];
  const result: ContactDiscovery = {
    domain: opts.domain,
    harvest: null,
    pattern: null,
    emails: [],
    phones: [],
    people: [],
    catch_all: null,
    mx_provider: "unknown",
    compliance_rows: [],
    notes,
  };

  const companyTokens = (opts.company || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  // ── 1. Harvest ────────────────────────────────────────────────────────────
  if (opts.domain) {
    result.harvest = await harvestDomainContacts(opts.domain, {
      companyTokens,
      maxPages: opts.maxPages ?? 6,
    });
    result.mx_provider = result.harvest.mx_provider;
    notes.push(
      `Harvested ${result.harvest.pages.filter((p) => p.ok).length}/${result.harvest.pages.length} pages, ` +
        `${result.harvest.emails.length} address(es), ${result.harvest.phones.length} phone(s).`,
    );
    if (result.harvest.skipped_by_robots.length) {
      notes.push(
        `robots.txt asked us to skip ${result.harvest.skipped_by_robots.length} page(s); we did.`,
      );
    }
    if (result.harvest.anti_cem_found) {
      notes.push(
        "A source page refuses unsolicited commercial email — implied consent is unavailable for anything found there.",
      );
    }
  } else {
    notes.push("No company domain resolved — harvest and pattern derivation were skipped.");
  }

  // ── 2. People ─────────────────────────────────────────────────────────────
  const people: DiscoveredPerson[] = result.harvest ? peopleFromHarvest(result.harvest.people) : [];

  if (
    opts.personName &&
    !people.some((p) => p.name.toLowerCase() === opts.personName!.toLowerCase())
  ) {
    people.unshift({
      name: opts.personName,
      source: "team_page",
      confidence: 0.5,
      provenance: provenanceEntry("post_text", {
        locator: "lead-author",
        anti_cem_statement: null,
        note: "Person named in the source post/listing",
      }),
    });
  }

  // Search-based person discovery is only worth its latency when the site
  // didn't name anyone. It also costs SearXNG queries, which are rate-limited.
  if (!opts.freeOnly && people.filter((p) => p.role_title).length === 0) {
    const viaSearch = await findPeopleViaSearch(opts.company, opts.roles ?? []).catch(() => []);
    for (const p of viaSearch) {
      if (!people.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) people.push(p);
    }
    if (viaSearch.length)
      notes.push(
        `Found ${viaSearch.length} person(s) via public search results (profiles were not fetched).`,
      );
  }

  if (!opts.skipRegistries) {
    const officers = await companiesHouseOfficers(opts.company).catch(() => []);
    for (const o of officers) {
      if (!people.some((x) => x.name.toLowerCase() === o.name.toLowerCase())) people.push(o);
    }
    if (officers.length)
      notes.push(`${officers.length} officer(s) from the UK statutory register.`);
  }
  result.people = people;

  // ── 3. Infer the org's address format ─────────────────────────────────────
  if (result.harvest) {
    result.pattern = inferOrgPattern(harvestToKnownAddresses(result.harvest), ROLE_LOCALPARTS);
    if (result.pattern.pattern) {
      notes.push(
        `Address format looks like ${result.pattern.pattern} (${Math.round(result.pattern.confidence * 100)}% confidence): ${result.pattern.evidence[0] ?? ""}`.trim(),
      );
    } else if (result.pattern.shape_hint) {
      notes.push(
        `No name-linked address to learn from; local parts look ${result.pattern.shape_hint}.`,
      );
    }
  }

  // ── 4. Verify what we harvested ───────────────────────────────────────────
  const emailRecords: EmailRecord[] = [];

  if (result.harvest) {
    // Named individuals first — they're worth more than info@ and they're the
    // ones a campaign can actually personalise.
    const ordered = [...result.harvest.emails].sort((a, b) => {
      const aNamed = a.name && !a.role_account ? 1 : 0;
      const bNamed = b.name && !b.role_account ? 1 : 0;
      return bNamed - aNamed || b.confidence - a.confidence;
    });

    for (const h of ordered.slice(0, MAX_VERIFY_HARVESTED)) {
      const verification = await verifyEmailDeep(h.email, { freeOnly: opts.freeOnly });
      if (result.catch_all === null && verification.catch_all !== null)
        result.catch_all = verification.catch_all;

      if (verification.tier === "verified" && h.name && opts.domain) {
        const { recordPatternHit, inferPatternKeyFromEmail } =
          await import("./domain-memory.server");
        const pk = inferPatternKeyFromEmail(h.email, h.name);
        if (pk) await recordPatternHit(opts.domain, pk);
      }

      const provenance = [h.provenance];
      const consent = assessConsent({ provenance, role_title: h.role_title });
      emailRecords.push({
        email: h.email,
        name: h.name,
        role_title: h.role_title,
        role_account: h.role_account,
        origin: h.provenance.method === "dns_record" ? "dns" : "harvested",
        // Discovery confidence and deliverability are different things; the
        // record's confidence is the weaker of the two, never the flattering one.
        confidence: Number(Math.min(h.confidence, verification.confidence + 0.1).toFixed(2)),
        verification,
        provenance,
        consent,
      });
    }
  }

  // ── 5. Derive for the named person, if we still don't have their address ──
  // Only derive for a person we're actually confident exists: one the caller
  // named, or one the site/registry DECLARED (schema.org Person, statutory
  // officer). A name scraped out of prose is not enough — deriving from a
  // misread heading manufactures an address for someone who doesn't work there.
  const declaredTarget = people.find(
    (p) =>
      !p.email &&
      p.role_title &&
      (p.source === "json_ld" || p.source === "registry_officer" || p.source === "search_serp") &&
      p.confidence >= 0.6,
  );
  // Speculative derivation is only worth doing when we LEARNED the org's format.
  // With no inferred pattern, a candidate is a base-rate coin flip — it costs
  // SMTP probes and ships a ~30%-confidence guess that reads like a finding.
  // An explicitly requested person is the exception: the user asked for them,
  // so a clearly-labelled best guess is the useful answer.
  const patternKnown = (result.pattern?.confidence ?? 0) >= 0.5;
  const targetName = opts.personName || (patternKnown ? declaredTarget?.name : undefined);
  const alreadyHaveTarget =
    !!targetName &&
    emailRecords.some((r) => r.name && r.name.toLowerCase() === targetName.toLowerCase());

  if (!targetName && declaredTarget && !patternKnown) {
    notes.push(
      `Found ${declaredTarget.name}${declaredTarget.role_title ? ` (${declaredTarget.role_title})` : ""} but no published address to learn this company's format from — guessing one would be a coin flip, so we didn't.`,
    );
  }

  if (result.harvest && targetName && !alreadyHaveTarget && parsePersonName(targetName).ok) {
    const { getLearnedPatterns } = await import("./domain-memory.server");
    const learnedPatterns = await getLearnedPatterns(result.harvest.domain);
    const candidates = deriveEmailCandidates(targetName, result.harvest.domain, {
      inference: result.pattern ?? undefined,
      limit: MAX_DERIVED_CANDIDATES,
      roleLocalParts: ROLE_LOCALPARTS,
      learnedPatterns,
    });

    if (candidates.length) {
      const { best, catch_all } = await verifyCandidates(candidates, { freeOnly: opts.freeOnly });
      if (result.catch_all === null) result.catch_all = catch_all;

      if (catch_all === true) {
        notes.push(
          `${result.harvest.domain} is a catch-all domain: it accepts mail for addresses that don't exist, so a derived address can never be confirmed there. Marked inferred, not verified.`,
        );
        const { updateDomainVerifyState } = await import("./domain-memory.server");
        await updateDomainVerifyState(result.harvest.domain, {
          is_catch_all: true,
          last_status: "catch_all",
        });
      }

      if (best && best.tier !== "invalid") {
        const candidate = candidates.find((c) => c.email === best.email);
        const person = people.find((p) => p.name.toLowerCase() === targetName.toLowerCase());
        if (best.tier === "verified" && candidate?.pattern) {
          const { recordPatternHit, updateDomainVerifyState } =
            await import("./domain-memory.server");
          await recordPatternHit(result.harvest.domain, candidate.pattern);
          await updateDomainVerifyState(result.harvest.domain, {
            valid_hits: 1,
            risky_streak: 0,
            last_status: "verified",
          });
        }
        const provenance = [
          provenanceEntry("pattern_derived", {
            locator: `pattern:${candidate?.pattern ?? "unknown"}`,
            publisher: result.harvest.domain,
            role_title: person?.role_title,
            anti_cem_statement: null,
            note: candidate?.reason,
          }),
        ];
        emailRecords.push({
          email: best.email,
          name: targetName,
          role_title: person?.role_title,
          role_account: false,
          origin: "derived",
          confidence: Number(Math.min(candidate?.prior ?? 0.3, best.confidence).toFixed(2)),
          verification: best,
          provenance,
          // Always "none": a derived address was never conspicuously published,
          // so it cannot carry implied consent no matter how well it verifies.
          consent: assessConsent({ provenance, role_title: person?.role_title }),
        });
        notes.push(`Derived ${best.email} for ${targetName} — ${best.label}.`);
      } else {
        notes.push(`Tried ${candidates.length} address patterns for ${targetName}; none held up.`);
      }
    }
  }

  result.emails = emailRecords.sort((a, b) => b.confidence - a.confidence);

  // ── 6. Phones ─────────────────────────────────────────────────────────────
  const phoneCandidates: DiscoveredPhone[] = [];

  if (result.harvest) {
    for (const p of result.harvest.phones) {
      phoneCandidates.push({ raw: p.raw, source: "site", provenance: p.provenance });
    }
  }

  if (!opts.skipRegistries) {
    const edgar = await secEdgarCompany(opts.company).catch(() => null);
    if (edgar) {
      const phone = edgarPhoneToDiscovered(edgar);
      if (phone) {
        phoneCandidates.push(phone);
        notes.push(`SEC EDGAR business phone for ${edgar.name}.`);
      }
    }
    if (!phoneCandidates.length) {
      const osm = await osmPhoneLookup(
        opts.company,
        opts.countryHint ?? result.harvest?.country_hint,
      ).catch(() => []);
      phoneCandidates.push(...osm);
      if (osm.length)
        notes.push(
          `${osm.length} phone(s) from OpenStreetMap (ODbL — attribution required on export).`,
        );
    }
  }

  const seenE164 = new Set<string>();
  for (const cand of phoneCandidates.slice(0, 8)) {
    const verification = await verifyPhone(
      cand.raw,
      opts.countryHint ?? result.harvest?.country_hint,
    );
    if (!verification.e164 || seenE164.has(verification.e164)) continue;
    seenE164.add(verification.e164);
    const provenance = [cand.provenance];
    result.phones.push({
      phone: cand.raw,
      e164: verification.e164,
      verification,
      attribution: cand.attribution,
      provenance,
      consent: assessConsent({ provenance }),
    });
  }
  result.phones.sort((a, b) => b.verification.confidence - a.verification.confidence);

  // ── 7. Compliance export rows ─────────────────────────────────────────────
  result.compliance_rows = [
    ...result.emails.map((r) =>
      complianceRow(
        {
          kind: "email",
          value: r.email,
          name: r.name,
          role_title: r.role_title,
          confidence: r.confidence,
          provenance: r.provenance,
        },
        r.consent,
      ),
    ),
    ...result.phones.map((r) =>
      complianceRow(
        {
          kind: "phone",
          value: r.e164 ?? r.phone,
          confidence: r.verification.confidence,
          provenance: r.provenance,
        },
        r.consent,
      ),
    ),
  ];

  const ready = result.compliance_rows.filter((r) => r.outreach_ready).length;
  notes.push(
    `${result.emails.length} email(s), ${result.phones.length} phone(s); ${ready} carry a documented CASL implied-consent basis.`,
  );

  return result;
}
