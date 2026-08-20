/**
 * Setup Verification Test
 *
 * Validates that all infrastructure for Task 1 is correctly set up:
 * - Dependencies are installed
 * - Modules can be imported
 * - Basic functionality works
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import Groq from "groq-sdk";
import { getSemanticMatcher, resetSemanticMatcher } from "../semantic-matcher";

describe("Task 1: Semantic Matching Infrastructure Setup", () => {
  describe("Dependencies", () => {
    it("should have groq-sdk installed and importable", () => {
      expect(Groq).toBeDefined();
      expect(typeof Groq).toBe("function");
    });

    it("should have fast-check installed and importable", () => {
      expect(fc).toBeDefined();
      expect(fc.assert).toBeDefined();
      expect(fc.property).toBeDefined();
    });
  });

  describe("Semantic Matcher Module", () => {
    it("should export getSemanticMatcher function", () => {
      expect(getSemanticMatcher).toBeDefined();
      expect(typeof getSemanticMatcher).toBe("function");
    });

    it("should create SemanticMatcher instance", () => {
      const matcher = getSemanticMatcher();
      expect(matcher).toBeDefined();
      expect(matcher.expandSectorTerm).toBeDefined();
      expect(matcher.getCacheStats).toBeDefined();
      expect(matcher.clearCache).toBeDefined();
    });

    it("should return singleton instance", () => {
      const matcher1 = getSemanticMatcher();
      const matcher2 = getSemanticMatcher();
      expect(matcher1).toBe(matcher2);
    });

    it("should have cache initialized", () => {
      const matcher = getSemanticMatcher();
      const stats = matcher.getCacheStats();
      expect(stats).toBeDefined();
      expect(stats.maxSize).toBe(1000);
      expect(typeof stats.size).toBe("number");
    });

    it("should handle empty term gracefully", async () => {
      const matcher = getSemanticMatcher();
      const result = await matcher.expandSectorTerm("");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return result for valid term (with or without API)", async () => {
      const matcher = getSemanticMatcher();
      const result = await matcher.expandSectorTerm("fintech");

      expect(result).toBeDefined();
      expect(result.synonyms).toBeDefined();
      expect(Array.isArray(result.synonyms)).toBe(true);
      expect(result.synonyms.length).toBeGreaterThan(0);

      // Should include the original term (normalized)
      expect(result.synonyms).toContain("fintech");
    });
  });

  describe("Environment Configuration", () => {
    it("should load environment variables (GROQ_API_KEY optional)", () => {
      // API key is optional - matcher falls back gracefully
      const apiKey = process.env.GROQ_API_KEY;

      if (apiKey) {
        expect(typeof apiKey).toBe("string");
        expect(apiKey.length).toBeGreaterThan(0);
        console.log("✓ GROQ_API_KEY is configured");
      } else {
        console.warn("⚠ GROQ_API_KEY not set (will use fallback mode)");
      }
    });
  });

  describe("Property-Based Testing Setup", () => {
    it("should run basic property test with fast-check", () => {
      fc.assert(
        fc.property(fc.string(), (str) => {
          // Basic property: string length is non-negative
          expect(str.length).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 10 }, // Quick verification
      );
    });

    it("should generate arbitrary strings for testing", () => {
      const sample = fc.sample(fc.string(), 5);
      expect(sample).toHaveLength(5);
      expect(Array.isArray(sample)).toBe(true);
    });
  });

  describe("Integration Readiness", () => {
    it("should be able to expand multiple terms without errors", async () => {
      const matcher = getSemanticMatcher();
      const terms = ["AI", "fintech", "healthcare"];

      for (const term of terms) {
        const result = await matcher.expandSectorTerm(term);
        expect(result).toBeDefined();
        expect(result.synonyms).toBeDefined();
        expect(result.synonyms.length).toBeGreaterThan(0);
      }
    });

    it("should cache results after first call", async () => {
      // Reset to clean state
      resetSemanticMatcher();
      const matcher = getSemanticMatcher();
      matcher.clearCache();

      const term = "blockchain";

      // First call
      const result1 = await matcher.expandSectorTerm(term);
      const cached1 = result1.cached;

      // Second call should be cached (if first succeeded)
      const result2 = await matcher.expandSectorTerm(term);
      const cached2 = result2.cached;

      if (result1.success) {
        // If first call succeeded, second should be cached
        expect(cached1).toBe(false);
        expect(cached2).toBe(true);
      } else {
        // If first call failed (no API key), both will be uncached fallbacks
        expect(result1.success).toBe(false);
        expect(result2.success).toBe(false);
      }

      // Both should return results
      expect(result1.synonyms.length).toBeGreaterThan(0);
      expect(result2.synonyms.length).toBeGreaterThan(0);
    });
  });
});
