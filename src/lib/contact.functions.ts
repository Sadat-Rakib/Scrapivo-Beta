// Contact resolution server fn. Given a company (and optional post text /
// known email / person name) it resolves + verifies a contact using the
// free-first waterfall, in this order:
//
//   domain verify → DEEP HARVEST (impressum/JSON-LD/security.txt/DMARC/mailto,
//   robots-respecting) → org pattern inference → derive + verify (catch-all
//   aware) → free registries → paid providers, credit-capped, last.
//
// The harvest/derive/verify core lives in contact/discover-contacts.server.ts;
// this file stays the auth-gated entry point and merges everything into the
// corroboration model the UI already renders. Every emitted contact carries
// provenance and a CASL consent assessment — see contact/provenance.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import {
  resolveCompanyDomain,
  gravatarLookup,
  rdapLookup,
  openCorporatesSearch,
  reconcileCompany,
  mergeContactRecords,
  harvestProfileContacts,
  harvestContactsViaBrowser,
  hunterEmailFinder,
  hunterDomainSearch,
  hunterCompanyEnrich,
  pdlPersonEnrich,
  spendPaidCredit,
  guessEmailPatterns,
  ROLE_LOCALPARTS,
  type ContactSignal,
  type ResolvedContact,
  type DomainResolution,
  type SocialLinks,
} from "@/lib/contact/contact-finder.server";
import { discoverContacts, type ContactDiscovery } from "@/lib/contact/discover-contacts.server";
import { verifyEmailDeep, type EmailVerification } from "@/lib/contact/verify-contact.server";
import type { complianceRow } from "@/lib/contact/provenance";
import {
  coreclawDomainEmails,
  coreclawEnabled,
  coreclawLinkedInCompany,
  coreclawLinkedInPerson,
  coreclawSocialProfileEnrich,
} from "@/lib/contact/coreclaw.server";

function nameTokens(company: string): string[] {
  return (company || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company)\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

const ROLE_EMAIL_LOCAL =
  /^(info|hello|hi|contact|support|sales|admin|team|office|mail|help|press|media)$/i;

function emailMatchesPerson(email: string, personName?: string): boolean {
  if (!personName || !email.includes("@")) return false;
  const local = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const tokens = personName
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!tokens.length) return false;
  return tokens.some((t) => local.includes(t));
}

function pushHarvestSignals(
  signals: ContactSignal[],
  harvested_phones: string[],
  harvest: { emails: string[]; phones: string[] },
  note: string,
  personName?: string,
  domain?: string,
) {
  for (const email of harvest.emails) {
    const local = email.split("@")[0] || "";
    const personHit = emailMatchesPerson(email, personName);
    const roleish = ROLE_EMAIL_LOCAL.test(local);
    signals.push({
      kind: "page_harvest",
      email,
      domain,
      name: personName,
      confidence: personHit ? 0.72 : roleish ? 0.35 : 0.55,
      note: personHit ? `${note} (matches person name)` : note,
    });
  }
  for (const phone of harvest.phones) {
    harvested_phones.push(phone);
    signals.push({
      kind: "page_harvest",
      phone,
      domain,
      name: personName,
      confidence: 0.5,
      note: `${note} (phone)`,
    });
  }
}

function bestSignalEmail(
  signals: ContactSignal[],
  kinds: ContactSignal["kind"][],
): string | undefined {
  return signals
    .filter((s) => s.email && kinds.includes(s.kind))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]?.email;
}

/** True when we already have a non-role outreach email (mailto/person/paid). */
function hasOutreachEmail(signals: ContactSignal[], discovery?: ContactDiscovery | null): boolean {
  const roleLocal = (email: string) => {
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    if (ROLE_LOCALPARTS.has(local)) return true;
    return local.split(/[._-]+/).some((p) => ROLE_LOCALPARTS.has(p));
  };
  if (
    signals.some(
      (s) =>
        s.email &&
        !roleLocal(s.email) &&
        !/dmarc|security\.txt|dns_record|dns:/i.test(s.note || ""),
    )
  ) {
    return true;
  }
  if (
    discovery?.emails.some(
      (e) => e.email && !e.role_account && e.origin !== "dns" && !roleLocal(e.email),
    )
  ) {
    return true;
  }
  return false;
}

export function verificationLabel(tier: string | undefined, method?: string): string | undefined {
  if (!tier) return undefined;
  const m = (method || "").toLowerCase();
  if (tier === "verified") {
    if (m.includes("zerobounce")) return "ZeroBounce verified";
    if (m.includes("smtp")) return "SMTP verified";
    return "MX verified";
  }
  if (tier === "probable") return "MX ok (probable)";
  if (tier === "risky") return "Risky / pattern only";
  if (tier === "invalid") return "Invalid email";
  // Catch-all domains accept mail for addresses that don't exist, so nothing
  // can be "verified" there. Say that plainly instead of implying a check passed.
  if (tier === "unconfirmable") return "Catch-all domain — cannot be confirmed";
  return tier;
}

const Input = z.object({
  company: z.string().min(1),
  postText: z.string().optional(),
  knownEmail: z.string().optional(),
  personName: z.string().optional(),
  jurisdictionCode: z.string().optional(),
  /** Auto-enrichment passes set this — paid providers are never consulted. */
  freeOnly: z.boolean().optional(),
  /** Public profile / website URLs for Scout-style bio harvest. */
  profileUrls: z.array(z.string().min(1).max(500)).max(8).optional(),
  /** Opt-in stealth/browser fetch for thin HTTP harvest — never for search fan-out. */
  deepEnrich: z.boolean().optional(),
  /** ICP role titles used to steer person discovery ("VP Engineering", …). */
  roles: z.array(z.string().min(1).max(80)).max(5).optional(),
  /** ISO-2 country hint for phone parsing and registry scoping. */
  countryHint: z.string().min(2).max(2).optional(),
});

export type ContactResolutionResult = {
  domain: DomainResolution | null;
  contacts: ResolvedContact[];
  verification: EmailVerification | null;
  registry_verified: boolean;
  harvested_phones: string[];
  /** Social profiles found on the company's own site (self-hosted extractor). */
  socials: SocialLinks;
  /**
   * Full discovery trace: harvested pages, inferred address format, per-record
   * provenance and consent. Present whenever a domain was resolved.
   */
  discovery: ContactDiscovery | null;
  /** Flat, exportable evidence rows — the CASL artifact customers can't self-produce. */
  compliance_rows: ReturnType<typeof complianceRow>[];
  /** Domain accepts mail for non-existent addresses (null = undetermined). */
  catch_all: boolean | null;
  /** Human-readable trace of what ran, for the UI's "how we found this" panel. */
  discovery_notes: string[];
};

export const resolveLeadContact = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<ContactResolutionResult> => {
    const domain = await resolveCompanyDomain(data.company, data.postText ?? "");
    const signals: ContactSignal[] = [];
    const harvested_phones: string[] = [];
    let socials: SocialLinks = {};

    if (domain) {
      signals.push({
        kind: "domain_guess",
        domain: domain.domain,
        confidence: domain.verified ? 0.5 : 0.2,
        note: `domain via ${domain.via}`,
      });
    }

    // ── Discovery core: harvest → infer format → derive → verify ────────────
    // This replaces the old "fetch /contact and regex it" harvest. Auto-enrich
    // passes (freeOnly) skip registries and search-based person lookup so a
    // Discover run doesn't pay their latency; manual Resolve gets the lot.
    let discovery: ContactDiscovery | null = null;
    if (domain?.domain && (domain.verified || domain.via === "post_text")) {
      discovery = await discoverContacts({
        company: data.company,
        domain: domain.domain,
        personName: data.personName,
        roles: data.roles,
        countryHint: data.countryHint,
        freeOnly: data.freeOnly,
        maxPages: data.freeOnly ? 4 : 7,
        skipRegistries: !!data.freeOnly,
      });
      socials = { ...discovery.harvest?.socials, ...socials };

      for (const rec of discovery.emails) {
        // Derived addresses stay distinguishable from published ones all the
        // way through the merge — the UI must never show them as equivalent.
        const derived = rec.origin === "derived";
        signals.push({
          kind: derived ? "pattern_guess" : "page_harvest",
          email: rec.email,
          name: rec.name,
          domain: domain.domain,
          confidence: rec.confidence,
          note: `${rec.verification.label}${rec.provenance[0]?.source_url ? ` — ${rec.provenance[0].source_url}` : ""}`,
        });
      }
      for (const rec of discovery.phones) {
        const value = rec.e164 ?? rec.phone;
        harvested_phones.push(value);
        signals.push({
          kind: "page_harvest",
          phone: value,
          domain: domain.domain,
          confidence: rec.verification.confidence,
          note: `${rec.verification.label}${rec.attribution ? ` (${rec.attribution})` : ""}`,
        });
      }
      for (const person of discovery.people) {
        if (!person.role_title && !person.profile_url) continue;
        signals.push({
          kind: person.source === "registry_officer" ? "opencorporates" : "team_page",
          name: person.name,
          domain: domain.domain,
          url: person.profile_url,
          confidence: person.confidence,
          note: person.role_title
            ? `${person.role_title} — ${person.provenance.note ?? ""}`.trim()
            : person.provenance.note,
        });
      }
    }

    // Scout-style profile / bio / link-in-bio harvest (HTTP, no LinkedIn cookies)
    const profileUrls = [
      ...(data.profileUrls ?? []),
      socials.instagram,
      socials.tiktok,
      socials.github,
      socials.youtube,
      socials.twitter,
      socials.facebook,
    ].filter((u): u is string => !!u);
    if (profileUrls.length) {
      const profileHarvest = await harvestProfileContacts(profileUrls);
      socials = { ...profileHarvest.socials, ...socials };
      pushHarvestSignals(
        signals,
        harvested_phones,
        profileHarvest,
        "Harvested from public profile / link-in-bio",
        data.personName,
        domain?.domain,
      );
    }

    // Opt-in browser deep enrich when HTTP harvest is thin
    if (data.deepEnrich) {
      const deepUrls = [
        ...profileUrls,
        ...(domain?.domain ? [`https://${domain.domain.replace(/^https?:\/\//, "")}`] : []),
        ...(data.profileUrls ?? []),
      ].filter(Boolean);
      const browserHarvest = await harvestContactsViaBrowser(deepUrls);
      socials = { ...browserHarvest.socials, ...socials };
      pushHarvestSignals(
        signals,
        harvested_phones,
        browserHarvest,
        "Deep enrich via browser worker",
        data.personName,
        domain?.domain,
      );
    }

    const { wikidataCompanyLookup, wikidataToSignals, gleifLookup, wikidataPersonLookup } =
      await import("@/lib/contact/free-registries.server");
    const [rdap, reconcile, ocFallback, grav, wikidata, gleif, wikidataPerson] = await Promise.all([
      domain ? rdapLookup(domain.domain) : Promise.resolve(null),
      reconcileCompany(data.company, data.jurisdictionCode),
      openCorporatesSearch(data.company),
      data.knownEmail ? gravatarLookup(data.knownEmail) : Promise.resolve(null),
      wikidataCompanyLookup(data.company),
      gleifLookup(data.company),
      data.personName ? wikidataPersonLookup(data.personName) : Promise.resolve(null),
    ]);
    if (rdap) signals.push(rdap);
    if (reconcile) signals.push(reconcile);
    else signals.push(...ocFallback);
    if (grav) signals.push(grav);
    if (wikidata) {
      signals.push(...wikidataToSignals(wikidata));
      // Wikidata socials fill gaps the own-crawler didn't find.
      socials = { ...wikidata.socials, ...socials };
    }
    if (gleif) signals.push(gleif);
    if (wikidataPerson) {
      socials = { ...wikidataPerson.socials, ...socials };
      signals.push({
        kind: "post_text",
        confidence: 0.45,
        url: wikidataPerson.wikidata_url,
        note: `Wikidata person: ${wikidataPerson.name}`,
      });
    }
    if (data.knownEmail) {
      signals.push({
        kind: "post_text",
        email: data.knownEmail,
        confidence: 0.3,
        note: "supplied email",
      });
    }
    if (data.personName) {
      signals.push({
        kind: "manual",
        name: data.personName,
        confidence: 0.15,
        note: "person from lead author",
      });
    }

    // Paid enrichment (manual Resolve / Deep enrich only). CoreClaw helpful
    // Workers first, then Hunter → PDL. Never in Discover auto-enrich.
    const enrichUrls = [
      ...(data.profileUrls ?? []),
      socials.linkedin,
      socials.instagram,
      socials.youtube,
      socials.tiktok,
      socials.github,
      socials.twitter,
    ].filter((u): u is string => !!u);

    if (!data.freeOnly && coreclawEnabled()) {
      if (enrichUrls.some((u) => /linkedin\.com\/company\//i.test(u)) && spendPaidCredit()) {
        const liCo = await coreclawLinkedInCompany(enrichUrls);
        signals.push(...liCo.signals);
        socials = { ...liCo.socials, ...socials };
      }
      if (
        data.personName &&
        enrichUrls.some((u) => /linkedin\.com\/in\//i.test(u)) &&
        spendPaidCredit()
      ) {
        const liPe = await coreclawLinkedInPerson(enrichUrls, data.personName);
        signals.push(...liPe.signals);
        socials = { ...liPe.socials, ...socials };
      }
      // One of IG / YouTube / TikTok profile (first match) when URL present
      if (
        enrichUrls.some((u) =>
          /instagram\.com\/|youtube\.com\/|youtu\.be\/|tiktok\.com\/@/i.test(u),
        ) &&
        spendPaidCredit()
      ) {
        const social = await coreclawSocialProfileEnrich(enrichUrls);
        signals.push(...social.signals);
        socials = { ...social.socials, ...socials };
      }
      if (!hasOutreachEmail(signals, discovery) && domain?.domain && spendPaidCredit()) {
        signals.push(...(await coreclawDomainEmails(domain.domain)));
      }
    }

    // People path: post email already in knownEmail/signals; else first.last@domain guess.
    if (data.personName && domain?.domain && !hasOutreachEmail(signals, discovery)) {
      const guesses = guessEmailPatterns(data.personName, domain.domain);
      for (const g of guesses.slice(0, 3)) {
        const v = await verifyEmailDeep(g, { freeOnly: data.freeOnly });
        if (v.tier === "invalid" || v.disposable) continue;
        signals.push({
          kind: "pattern_guess",
          email: g,
          name: data.personName,
          domain: domain.domain,
          confidence: v.tier === "verified" ? 0.55 : v.tier === "probable" ? 0.4 : 0.28,
          note: `Pattern guess from ${data.personName} (${v.method})`,
        });
        if (v.tier === "verified" || v.tier === "probable") break;
      }
    }

    // Hunter / PDL — only when still no outreach email (credit-capped, sequential).
    // Role/DNS inboxes (DMARC, security.txt, info@) do NOT block paid enrich.
    if (!data.freeOnly && !hasOutreachEmail(signals, discovery) && domain?.domain) {
      let found = false;
      if (data.personName) {
        const hunterPerson = await hunterEmailFinder(domain.domain, data.personName);
        if (hunterPerson) {
          signals.push(hunterPerson);
          found = true;
        }
        if (!found) {
          const pdl = await pdlPersonEnrich(data.personName, data.company, domain.domain);
          if (pdl) {
            signals.push(pdl);
            found = !!pdl.email;
          }
        }
      }
      if (!found) {
        const co = await hunterCompanyEnrich(domain.domain);
        if (co) {
          signals.push(...co.signals);
          socials = {
            ...{ linkedin: co.linkedin_url, twitter: co.twitter_url, facebook: co.facebook_url },
            ...socials,
          };
          found = co.signals.some(
            (s) => s.email && !ROLE_LOCALPARTS.has(s.email.split("@")[0] || ""),
          );
        }
        if (!found) signals.push(...(await hunterDomainSearch(domain.domain)));
      }
    }

    // Verification: reuse what discovery already established rather than
    // re-probing the same mailbox (SMTP probes are the slow part, and hammering
    // a mail server twice for one answer is exactly the behaviour that gets an
    // IP blocked). Only addresses discovery never saw get a fresh check.
    const discoveryBest = discovery?.emails[0];
    const paidEmail = bestSignalEmail(signals, ["hunter", "pdl", "coreclaw"]);
    let verification: EmailVerification | null = null;
    if (data.knownEmail) {
      verification =
        discovery?.emails.find((r) => r.email === data.knownEmail!.trim().toLowerCase())
          ?.verification ?? (await verifyEmailDeep(data.knownEmail, { freeOnly: data.freeOnly }));
    } else if (discoveryBest) {
      verification = discoveryBest.verification;
    } else if (paidEmail) {
      verification = await verifyEmailDeep(paidEmail, { freeOnly: data.freeOnly });
    }

    const contacts = mergeContactRecords(signals);
    for (const c of contacts) {
      const best = c.corroborating_sources
        .filter((s) => s.email)
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      if (best?.email) c.email = best.email;
    }
    // Prefer named / non-role outreach emails over info@ / DNS leftovers.
    contacts.sort((a, b) => {
      const roleScore = (c: ResolvedContact) => {
        const local = (c.email || "").split("@")[0]?.toLowerCase() ?? "";
        if (!local) return 0;
        if (ROLE_LOCALPARTS.has(local)) return -2;
        if (local.split(/[._-]+/).some((p) => ROLE_LOCALPARTS.has(p))) return -1;
        return c.name ? 2 : 1;
      };
      return roleScore(b) - roleScore(a) || b.confidence - a.confidence;
    });

    const registry_verified = signals.some(
      (s) => s.kind === "opencorporates" && (s.confidence ?? 0) >= 0.5,
    );

    return {
      domain,
      contacts,
      verification,
      registry_verified,
      harvested_phones,
      socials,
      discovery,
      compliance_rows: discovery?.compliance_rows ?? [],
      catch_all: discovery?.catch_all ?? null,
      discovery_notes: discovery?.notes ?? [],
    };
  });
