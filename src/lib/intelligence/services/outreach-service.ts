/**
 * Scrapivo — Native Outreach Service
 *
 * Orchestrates personalized outreach via DMs, emails, and call scripts
 * using intent evidence and ICP configuration.
 */

import type { OutreachProvider, OutreachDraft, ContactResult } from "../providers/types";
import type { Lead, ICPConfig } from "../domain/types";
import { providerRegistry } from "../providers/registry";

export class OutreachService {
  /**
   * Generates a personalized outreach draft based on a lead and ICP match config.
   * This uses the LeadAce AI intelligence capabilities under the hood.
   */
  async generateDraft(lead: Partial<Lead>, icp: ICPConfig): Promise<OutreachDraft> {
    const prospectIntel = providerRegistry.getProspectIntel();
    if (!prospectIntel) {
      throw new Error("Prospect Intelligence Service not available");
    }
    return prospectIntel.generatePersonalizedOutreach(lead, icp);
  }

  /**
   * Dispatches the generated draft to the primary outreach provider.
   */
  async send(draft: OutreachDraft, recipient: ContactResult): Promise<{ sent: boolean; error?: string }> {
    const provider = providerRegistry.getOutreachProvider();
    if (!provider) {
      throw new Error("No primary outreach provider configured");
    }
    
    // Attempt sending via primary provider
    return provider.sendOutreach(draft, recipient);
  }
}

export const outreachService = new OutreachService();
