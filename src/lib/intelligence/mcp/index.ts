/**
 * Scrapivo — Model Context Protocol (MCP) Adapters
 *
 * Exposes core Scrapivo intelligence capabilities as standardized tools
 * that can be consumed by external MCP-compatible AI agents.
 */

import { providerRegistry } from "../providers/registry";
import { EntityResolver } from "../domain/entity-resolver";

export interface McpToolResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export const mcpAdapter = {
  /**
   * MCP Tool: search_local_businesses
   * Discovers local businesses given a query and location using the configured fallback chain.
   */
  async searchLocalBusinesses(query: string, location: string, limit = 10): Promise<McpToolResponse> {
    try {
      const provider = providerRegistry.getBusinessPrimary();
      if (!provider) return { success: false, error: "No business provider configured" };
      
      const results = await provider.searchBusinesses(query, location, { limit });
      return { success: true, data: results };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * MCP Tool: enrich_company
   * Hydrates a bare domain with firmographic and technographic data.
   */
  async enrichCompany(domain: string): Promise<McpToolResponse> {
    try {
      const techProvider = providerRegistry.getTechPrimary();
      const techProfile = techProvider ? await techProvider.getCompanyTechnologies(domain) : null;
      
      const webProvider = providerRegistry.getWebsitePrimary();
      const webMetadata = webProvider ? await webProvider.analyzeUrl(domain) : null;
      
      return {
        success: true,
        data: {
          domain,
          technologies: techProfile?.technologies || [],
          metadata: webMetadata,
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * MCP Tool: verify_email
   * Validates an email address via EmailSleuth / configured provider.
   */
  async verifyEmail(email: string): Promise<McpToolResponse> {
    try {
      const provider = providerRegistry.getEmailPrimary();
      if (!provider) return { success: false, error: "No email provider configured" };
      
      const result = await provider.verifyEmail(email);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * MCP Tool: score_lead
   * Generates a LeadAce intent score breakdown for a given lead.
   */
  async scoreLead(companyData: any, icp: any): Promise<McpToolResponse> {
    try {
      const provider = providerRegistry.getProspectIntel();
      if (!provider) return { success: false, error: "Prospect intel provider missing" };
      
      const breakdown = provider.matchICP(companyData, icp);
      return { success: true, data: breakdown };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};
