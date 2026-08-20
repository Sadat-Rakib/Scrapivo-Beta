/**
 * Scrapivo — Demand Signal Provider
 *
 * Implements the DemandSignalProvider interface to classify
 * buyer pain language and extract intent signals.
 */

import type { DemandSignalProvider, ProviderConfig } from "../types";
import type { DemandSignalResult } from "../../domain/types";
import { validateExternalUrl } from "../../security/url-validator";

export class LlmDemandSignalProvider implements DemandSignalProvider {
  readonly name = "LLMDemandClassifier";
  private config: ProviderConfig;
  private endpoint: string;
  private apiKey: string;

  constructor(endpoint: string, apiKey: string, config?: Partial<ProviderConfig>) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.config = {
      timeout_ms: config?.timeout_ms ?? 15_000,
      max_retries: config?.max_retries ?? 2,
      backoff_base_ms: config?.backoff_base_ms ?? 500,
      concurrency_limit: config?.concurrency_limit ?? 5,
      rate_limit_per_minute: config?.rate_limit_per_minute ?? 60,
    };
  }

  async healthCheck(): Promise<boolean> {
    return !!this.apiKey && !!this.endpoint;
  }

  async searchDemandSignals(
    query: string,
    platforms: ("reddit" | "linkedin")[],
  ): Promise<DemandSignalResult[]> {
    const signals = await this.analyzeText(query);
    return signals.map((s) => ({
      platform: platforms[0] ?? "reddit",
      author: "anonymous",
      post_url: `${this.endpoint}/signal/${s.id}`,
      post_text: query,
      detected_problem: s.title,
      intent_category: (s.type as any) || "buyer",
      confidence: s.confidence,
      detected_at: s.detected_at,
    }));
  }

  async analyzeText(text: string): Promise<
    {
      id: string;
      type: string;
      source: string;
      title: string;
      confidence: number;
      evidence_text: string;
      detected_at: string;
    }[]
  > {
    if (!text || text.trim().length < 10) return [];

    const url = validateExternalUrl(`${this.endpoint}/v1/chat/completions`);
    if (!url.valid) throw new Error(url.error);

    const systemPrompt = `You are a B2B intent classifier. Analyze the provided text and extract demand signals.
Classify the intent into one of: 'buyer_pain', 'peer_competitor_mention', 'kol_endorsement', or 'noise'.
Return a JSON array of objects with keys: { "type": "buyer_pain" | "peer_competitor_mention" | "kol_endorsement", "confidence": number (0-100), "evidence_text": string, "summary": string }.
If it's noise, return an empty array [].`;

    try {
      const response = await fetch(url.sanitized_url!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });

      if (!response.ok) return [];

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return [];

      let parsed: any;
      try {
        parsed = JSON.parse(content);
        if (parsed.signals && Array.isArray(parsed.signals)) {
           parsed = parsed.signals;
        }
      } catch (_e) {
        return [];
      }

      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: any) => ({
        id: `sig_${crypto.randomUUID()}`,
        type: item.type,
        source: this.name,
        title: item.summary || "Intent Signal Detected",
        confidence: item.confidence || 50,
        evidence_text: item.evidence_text,
        detected_at: new Date().toISOString(),
      }));

    } catch (err) {
      console.error(`[${this.name}] analysis failed:`, err);
      return [];
    }
  }
}

