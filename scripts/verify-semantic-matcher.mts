/**
 * Verification script for semantic matcher setup
 * Checks that Groq API key is configured and semantic matcher is working
 */

import { getSemanticMatcher } from "../src/lib/investors/semantic-matcher";

async function verifySetup() {
  console.log("🔍 Verifying Semantic Matcher Setup...\n");

  // Check environment variable
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("❌ GROQ_API_KEY not found in environment variables");
    console.log("   Please set GROQ_API_KEY in your .env file");
    process.exit(1);
  }
  console.log("✅ GROQ_API_KEY found in environment");

  // Initialize semantic matcher
  const matcher = getSemanticMatcher();
  console.log("✅ Semantic matcher initialized");

  // Test with a simple query
  console.log("\n🧪 Testing semantic expansion for 'AI'...");
  try {
    const result = await matcher.expandSectorTerm("AI");

    if (result.success) {
      console.log("✅ Semantic expansion successful!");
      console.log(`   Cached: ${result.cached}`);
      console.log(
        `   Synonyms (${result.synonyms.length}):`,
        result.synonyms.slice(0, 5).join(", "),
      );
      if (result.synonyms.length > 5) {
        console.log(`   ... and ${result.synonyms.length - 5} more`);
      }
    } else {
      console.warn("⚠️  Semantic expansion failed (falling back to exact match)");
      console.log(`   Error: ${result.error}`);
      console.log(`   Fallback synonyms:`, result.synonyms);
    }
  } catch (error) {
    console.error("❌ Error testing semantic matcher:", error);
    process.exit(1);
  }

  // Check cache stats
  const stats = matcher.getCacheStats();
  console.log(`\n📊 Cache Stats: ${stats.size}/${stats.maxSize} entries`);

  console.log("\n✅ Semantic Matcher setup verified successfully!");
}

verifySetup().catch((error) => {
  console.error("❌ Setup verification failed:", error);
  process.exit(1);
});
