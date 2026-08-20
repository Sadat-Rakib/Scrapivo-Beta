/**
 * Scrapivo — Entity Resolver Engine
 *
 * Normalizes domains, phone numbers, and names to dedup and resolve
 * entities deterministically or probabilistically across all sources.
 */

import type { Company, SourceId } from "./types";
import { normalizeDomain, normalizePhone, normalizeCompanyName } from "../security/url-validator";

export interface ResolveOptions {
  domain?: string;
  name?: string;
  phone?: string;
  sourceId?: SourceId;
}

export class EntityResolver {
  /**
   * Generates a deterministic entity ID based on available strong identifiers.
   * Priority: domain > phone > normalized name.
   */
  static generateCompanyId(opts: ResolveOptions): string {
    if (opts.domain) {
      const norm = normalizeDomain(opts.domain);
      if (norm) return `comp_domain_${norm}`;
    }
    
    if (opts.phone) {
      const norm = normalizePhone(opts.phone);
      if (norm) return `comp_phone_${norm}`;
    }
    
    if (opts.name) {
      const norm = normalizeCompanyName(opts.name);
      if (norm) return `comp_name_${norm.replace(/\s+/g, "_")}`;
    }
    
    if (opts.sourceId) {
      return `comp_src_${opts.sourceId.source}_${opts.sourceId.source_id}`;
    }
    
    return `comp_auto_${crypto.randomUUID()}`;
  }

  /**
   * Merges two company records. The 'source' argument takes precedence for
   * non-list fields, while list fields (like source_ids) are unified.
   */
  static mergeCompany(target: Company, source: Partial<Company>): Company {
    const merged: Company = { ...target };
    
    if (source.canonical_name && !target.canonical_name) merged.canonical_name = source.canonical_name;
    if (source.domain && !target.domain) merged.domain = source.domain;
    if (source.website && !target.website) merged.website = source.website;
    if (source.description) merged.description = source.description;
    if (source.industry) merged.industry = source.industry;
    if (source.employee_count) merged.employee_count = source.employee_count;
    if (source.location) merged.location = source.location;
    if (source.phone) merged.phone = source.phone;
    if (source.logo_url) merged.logo_url = source.logo_url;
    
    if (source.categories) {
      merged.categories = Array.from(new Set([...(target.categories || []), ...source.categories]));
    }
    
    if (source.source_ids) {
      const existingSources = new Set(target.source_ids.map((s) => `${s.source}:${s.source_id}`));
      const newSources = source.source_ids.filter((s) => !existingSources.has(`${s.source}:${s.source_id}`));
      merged.source_ids = [...target.source_ids, ...newSources];
    }
    
    if (source.social_profiles) {
      merged.social_profiles = { ...target.social_profiles, ...source.social_profiles };
    }
    
    merged.updated_at = new Date().toISOString();
    return merged;
  }
}
