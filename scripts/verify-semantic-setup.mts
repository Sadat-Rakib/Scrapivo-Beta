/**
 * Verification script for semantic matching infrastructure setup
 * Checks that all dependencies are available and basic functionality works
 */

import { getSemanticMatcher } from "../src/lib/investors/semantic-matcher.js";

async function verifySetup() {
  console.log("🔍 Verifying semantic matching infrastructure setup...\n");

  // Check 1: Verify Groq SDK is available
  console.log("✓ Check 1: Groq SDK dependency");
  try {
    await import("groq-sdk");
    console.log("  ✓ groq-sdk is installed\n");
  } catch (error) {
    console.error("  ✗ groq-sdk is NOT installed");
    console.error("  Run: npm install groq-sdk\n");
    process.exit(1);
  }

  // Check 2: Verify fast-check is available
  console.log("✓ Check 2: fast-check dependency");
  try {
    await import("fast-check");
    console.log("  ✓ fast-check is installed\n");
  } catch (error) {
    console.error("  ✗ fast-check is NOT installed");
    console.error("  Run: npm install --save-dev fast-check\n");
    process.exit(1);
  }

  // Check 3: Verify GROQ_API_KEY is configured
  console.log("✓ Check 3: Environment configuration");
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) {
    const maskedKey = apiKey.substring(0, 7) + "..." + apiKey.substring(apiKey.length - 4);
    console.log(`  ✓ GROQ_API_KEY is configured (${maskedKey})\n`);
  } else {
    console.warn("  ⚠ GROQ_API_KEY is not set");
    console.warn("  Semantic matching will fall back to exact matching");
    console.warn("  To enable: Set GROQ_API_KEY in .env file\n");
  }

  // Check 4: Verify semantic matcher can be instantiated
  console.log("✓ Check 4: Semantic matcher module");
  try {
    const matcher = getSemanticMatcher();
    console.log("  ✓ SemanticMatcher instance created");

    const stats = matcher.getCacheStats();
    console.log(`  ✓ Cache initialized (0/${stats.maxSize} entries)\n`);
  } catch (error) {
    console.error("  ✗ Failed to create SemanticMatcher");
    console.error("  Error:", error);
    process.exit(1);
  }

  // Check 5: Test basic functionality (without API call)
  console.log("✓ Check 5: Basic functionality");
  try {
    const matcher = getSemanticMatcher();

    // This should work even without API key (falls back to exact match)
    const result = await matcher.expandSectorTerm("fintech");

    if (result.synonyms.length > 0) {
      console.log("  ✓ expandSectorTerm() works");
      console.log(`  ✓ Returned ${result.synonyms.length} terms for "fintech"`);
      console.log(`  ✓ Success: ${result.success}, Cached: ${result.cached}`);

      if (result.success && !apiKey) {
        console.log("  ℹ Note: Semantic expansion working despite no API key");
      } else if (!result.success && !apiKey) {
        console.log("  ℹ Note: Fallback to exact matching (no API key)");
      }
      console.log();
    } else {
      console.error("  ✗ expandSectorTerm() returned no results");
      process.exit(1);
    }
  } catch (error) {
    console.error("  ✗ Basic functionality test failed");
    console.error("  Error:", error);
    process.exit(1);
  }

  console.log("✅ All checks passed! Semantic matching infrastructure is ready.\n");

  console.log("Summary:");
  console.log("- Dependencies: groq-sdk ✓, fast-check ✓");
  console.log("- Environment: GROQ_API_KEY " + (apiKey ? "✓" : "⚠ (optional)"));
  console.log("- Module: semantic-matcher.ts ✓");
  console.log("- Functionality: Basic operations ✓\n");

  console.log("Next steps:");
  console.log("1. Run tests: npm test");
  console.log("2. Proceed with implementation tasks");
}

verifySetup().catch((error) => {
  console.error("\n❌ Verification failed:", error);
  process.exit(1);
});
