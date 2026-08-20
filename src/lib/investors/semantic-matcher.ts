/**
 * Semantic Sector Matcher
 *
 * Provides AI-powered semantic matching for investor sectors using free AI models.
 * Expands sector search terms to include synonyms and related terms (e.g., "AI" -> "machine learning", "artificial intelligence").
 * Uses Groq API with Llama models for zero-cost semantic understanding.
 *
 * Features:
 * - In-memory caching to minimize API calls
 * - Automatic fallback to exact matching on failures
 * - Timeout and retry mechanisms for reliability
 * - LRU cache eviction to limit memory usage
 */

import Groq from "groq-sdk";

/**
 * Configuration for the semantic matcher
 */
export interface SemanticMatcherConfig {
  /** AI model identifier (e.g., "llama-3.3-70b-versatile") */
  model: string;
  /** Groq API key from environment variable */
  apiKey: string;
  /** Enable in-memory caching of synonym expansions */
  cacheEnabled: boolean;
  /** Request timeout in milliseconds (default 2000ms) */
  timeoutMs: number;
  /** Maximum retry attempts for transient failures (default 3) */
  maxRetries: number;
  /** Maximum cache size (LRU eviction when exceeded) */
  maxCacheSize: number;
}

/**
 * Result of a semantic matching operation
 */
export interface SemanticMatchResult {
  /** Whether the semantic expansion succeeded */
  success: boolean;
  /** List of synonyms and related terms (includes original term) */
  synonyms: string[];
  /** Whether the result came from cache (true) or API call (false) */
  cached: boolean;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Cache entry with timestamp for LRU eviction
 */
interface CacheEntry {
  synonyms: string[];
  timestamp: number;
}

/**
 * Semantic Matcher Class
 *
 * Expands sector terms using AI to find semantically similar terms.
 * Caches results to minimize API calls and provides graceful fallback.
 */
export class SemanticMatcher {
  private cache: Map<string, CacheEntry>;
  private config: SemanticMatcherConfig;
  private groqClient: Groq | null;

  /**
   * Create a new SemanticMatcher instance
   * @param config Configuration for the matcher
   */
  constructor(config: SemanticMatcherConfig) {
    this.config = config;
    this.cache = new Map();

    // Initialize Groq client if API key is available
    this.groqClient = config.apiKey ? new Groq({ apiKey: config.apiKey }) : null;

    if (!this.groqClient) {
      console.warn(
        "SemanticMatcher: No API key provided, semantic matching disabled. " +
          "Set GROQ_API_KEY environment variable to enable.",
      );
    }
  }

  /**
   * Expand a sector term to include synonyms and related terms
   *
   * @param term The sector term to expand (e.g., "AI", "fintech")
   * @returns Promise resolving to match result with synonyms
   */
  async expandSectorTerm(term: string): Promise<SemanticMatchResult> {
    if (!term || !term.trim()) {
      return {
        success: false,
        synonyms: [],
        cached: false,
        error: "Empty term provided",
      };
    }

    const normalizedTerm = term.toLowerCase().trim();

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.getCached(normalizedTerm);
      if (cached) {
        return {
          success: true,
          synonyms: cached,
          cached: true,
        };
      }
    }

    // If no API client, fall back to exact matching
    if (!this.groqClient) {
      return {
        success: false,
        synonyms: [normalizedTerm],
        cached: false,
        error: "No API key configured",
      };
    }

    // Call AI model with retry logic
    try {
      const synonyms = await this.callAIModelWithRetry(normalizedTerm);

      // Cache the result
      if (this.config.cacheEnabled && synonyms.length > 0) {
        this.setCached(normalizedTerm, synonyms);
      }

      return {
        success: true,
        synonyms,
        cached: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`SemanticMatcher: Failed to expand term "${term}":`, errorMessage);

      // Fallback to exact matching
      return {
        success: false,
        synonyms: [normalizedTerm],
        cached: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Call AI model with exponential backoff retry logic
   *
   * @param term The term to expand
   * @returns Promise resolving to list of synonyms
   */
  private async callAIModelWithRetry(term: string): Promise<string[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await this.callAIModel(term);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delay = 100 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error("Unknown error in AI model call");
  }

  /**
   * Call AI model to expand a sector term
   *
   * @param term The term to expand
   * @returns Promise resolving to list of synonyms (including original term)
   */
  private async callAIModel(term: string): Promise<string[]> {
    if (!this.groqClient) {
      throw new Error("Groq client not initialized");
    }

    const prompt = `List 5-10 synonyms and related terms for the business/technology sector: "${term}".

Examples:
- For "AI": artificial intelligence, machine learning, deep learning, neural networks, computer vision, natural language processing
- For "fintech": financial technology, payments, banking, digital banking, insurtech, payments processing
- For "e-commerce": online retail, digital commerce, online shopping, marketplace

Return ONLY a comma-separated list of terms, no explanations or extra text.`;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const completion = await this.groqClient.chat.completions.create({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        model: this.config.model,
        temperature: 0.3, // Lower temperature for more consistent results
        max_tokens: 200,
      });

      clearTimeout(timeoutId);

      const content = completion.choices[0]?.message?.content || "";

      // Parse comma-separated response
      const synonyms = content
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length < 100); // Filter invalid entries

      // Always include the original term
      if (!synonyms.includes(term)) {
        synonyms.unshift(term);
      }

      return synonyms.length > 0 ? synonyms : [term];
    } catch (error) {
      clearTimeout(timeoutId);

      // Check if it's a timeout error
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.config.timeoutMs}ms`);
      }

      throw error;
    }
  }

  /**
   * Get cached synonyms for a term
   *
   * @param term The normalized term to look up
   * @returns Array of cached synonyms or null if not found
   */
  private getCached(term: string): string[] | null {
    const entry = this.cache.get(term);
    if (entry) {
      // Update timestamp for LRU
      entry.timestamp = Date.now();
      return entry.synonyms;
    }
    return null;
  }

  /**
   * Cache synonyms for a term with LRU eviction
   *
   * @param term The normalized term
   * @param synonyms The list of synonyms to cache
   */
  private setCached(term: string, synonyms: string[]): void {
    // Check if cache is full and evict oldest entry
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictOldestCacheEntry();
    }

    this.cache.set(term, {
      synonyms,
      timestamp: Date.now(),
    });
  }

  /**
   * Evict the least recently used cache entry
   */
  private evictOldestCacheEntry(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Object with cache size and max size
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance
let semanticMatcherInstance: SemanticMatcher | null = null;

/**
 * Get or create the singleton SemanticMatcher instance
 *
 * @returns The SemanticMatcher singleton
 */
export function getSemanticMatcher(): SemanticMatcher {
  if (!semanticMatcherInstance) {
    const apiKey = process.env.GROQ_API_KEY || "";

    semanticMatcherInstance = new SemanticMatcher({
      model: "openai/gpt-oss-20b", // Free Groq model
      apiKey,
      cacheEnabled: true,
      timeoutMs: 2000,
      maxRetries: 3,
      maxCacheSize: 1000,
    });
  }

  return semanticMatcherInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSemanticMatcher(): void {
  semanticMatcherInstance = null;
}
