/**
 * Scrapivo — Provider Registry
 *
 * Central registry for provider instances with configurable primary/fallback routing.
 * Providers are registered by capability and resolved at runtime.
 */

import type {
  BusinessDiscoveryProvider,
  TechnographicProvider,
  WebsiteIntelligenceProvider,
  EmailIntelligenceProvider,
  DemandSignalProvider,
  EventSignalProvider,
  InvestorProvider,
  OutreachProvider,
  ProspectIntelligenceService,
} from "./types";

type ProviderSlot<T> = {
  primary: T | null;
  fallbacks: T[];
};

class ProviderRegistryImpl {
  business: ProviderSlot<BusinessDiscoveryProvider> = { primary: null, fallbacks: [] };
  technographics: ProviderSlot<TechnographicProvider> = { primary: null, fallbacks: [] };
  website: ProviderSlot<WebsiteIntelligenceProvider> = { primary: null, fallbacks: [] };
  contacts: ProviderSlot<EmailIntelligenceProvider> = { primary: null, fallbacks: [] };
  demand: ProviderSlot<DemandSignalProvider> = { primary: null, fallbacks: [] };
  events: ProviderSlot<EventSignalProvider> = { primary: null, fallbacks: [] };
  investors: ProviderSlot<InvestorProvider> = { primary: null, fallbacks: [] };
  outreach: ProviderSlot<OutreachProvider> = { primary: null, fallbacks: [] };

  private prospectIntel: ProspectIntelligenceService | null = null;

  registerBusiness(provider: BusinessDiscoveryProvider, asFallback = false) {
    if (asFallback) this.business.fallbacks.push(provider);
    else this.business.primary = provider;
  }

  registerTechnographics(provider: TechnographicProvider, asFallback = false) {
    if (asFallback) this.technographics.fallbacks.push(provider);
    else this.technographics.primary = provider;
  }

  registerWebsite(provider: WebsiteIntelligenceProvider, asFallback = false) {
    if (asFallback) this.website.fallbacks.push(provider);
    else this.website.primary = provider;
  }

  registerContacts(provider: EmailIntelligenceProvider, asFallback = false) {
    if (asFallback) this.contacts.fallbacks.push(provider);
    else this.contacts.primary = provider;
  }

  registerDemand(provider: DemandSignalProvider, asFallback = false) {
    if (asFallback) this.demand.fallbacks.push(provider);
    else this.demand.primary = provider;
  }

  registerEvents(provider: EventSignalProvider, asFallback = false) {
    if (asFallback) this.events.fallbacks.push(provider);
    else this.events.primary = provider;
  }

  registerInvestors(provider: InvestorProvider, asFallback = false) {
    if (asFallback) this.investors.fallbacks.push(provider);
    else this.investors.primary = provider;
  }

  registerOutreach(provider: OutreachProvider, asFallback = false) {
    if (asFallback) this.outreach.fallbacks.push(provider);
    else this.outreach.primary = provider;
  }

  registerProspectIntel(service: ProspectIntelligenceService) {
    this.prospectIntel = service;
  }

  // ─── Getter shortcuts used by MCP adapter & services ────────────────

  getBusinessPrimary(): BusinessDiscoveryProvider | null {
    return this.business.primary;
  }

  getTechPrimary(): TechnographicProvider | null {
    return this.technographics.primary;
  }

  getWebsitePrimary(): WebsiteIntelligenceProvider | null {
    return this.website.primary;
  }

  getEmailPrimary(): EmailIntelligenceProvider | null {
    return this.contacts.primary;
  }

  getProspectIntel(): ProspectIntelligenceService | null {
    return this.prospectIntel;
  }

  getOutreachProvider(): OutreachProvider | null {
    return this.outreach.primary;
  }

  /** Resolve provider with fallback chain: try primary, then each fallback. */
  async resolveWithFallback<T extends { readonly name: string }>(
    slot: ProviderSlot<T>,
    operation: (provider: T) => Promise<unknown>,
  ): Promise<{ provider: T; result: unknown } | null> {
    const candidates = [slot.primary, ...slot.fallbacks].filter(
      (p): p is T => p !== null,
    );

    for (const provider of candidates) {
      try {
        const result = await operation(provider);
        return { provider, result };
      } catch (err) {
        console.warn(
          `[ProviderRegistry] ${provider.name} failed, trying next fallback`,
          err,
        );
      }
    }
    return null;
  }

  /** Health-check summary of all registered providers. */
  status(): Record<string, string> {
    const slots: Record<string, ProviderSlot<{ readonly name: string }>> = {
      business: this.business,
      technographics: this.technographics,
      website: this.website,
      contacts: this.contacts,
      demand: this.demand,
      events: this.events,
      investors: this.investors,
      outreach: this.outreach,
    };

    const out: Record<string, string> = {};
    for (const [key, slot] of Object.entries(slots)) {
      const names: string[] = [];
      if (slot.primary) names.push(`${slot.primary.name} (primary)`);
      for (const f of slot.fallbacks) names.push(`${f.name} (fallback)`);
      out[key] = names.length ? names.join(", ") : "none registered";
    }
    return out;
  }
}

/** Singleton provider registry. */
export const providerRegistry = new ProviderRegistryImpl();

