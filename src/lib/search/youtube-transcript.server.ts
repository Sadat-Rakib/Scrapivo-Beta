/**
 * YouTube Transcript Analysis - AgentReach Equivalent
 *
 * Extracts buyer intent from YouTube video transcripts and comments.
 * Enriches video discoveries from SearXNG/SERP with actual speech analysis.
 *
 * Flow:
 * 1. Receive YouTube URLs from existing searchYouTubeSignals()
 * 2. Fetch transcripts via youtube-transcript package (no API key needed)
 * 3. Scan for buyer intent phrases ("looking for", "need a", "hiring")
 * 4. Extract context windows around matches
 * 5. Return enriched signals with transcript snippets
 */

import type { Lead } from "../scoring";

type YouTubeSignal = {
  videoId: string;
  title: string;
  url: string;
  publishedDate?: string;
  buyerSignals: Array<{
    text: string;
    timestamp?: number;
    matchedPhrase: string;
    score: number;
  }>;
  transcriptSnippet?: string;
};

// Buyer intent patterns - detect hiring/outsourcing language
const BUYER_PATTERNS = [
  /\b(looking for|need a|need to hire|want to hire|hiring|seeking)\s+(?:a\s+)?([a-z\s]{3,40})\b/gi,
  /\b(can anyone recommend|who should i hire|where can i find|who do you recommend)\s+(?:a\s+)?([a-z\s]{3,40})\b/gi,
  /\b(need help with|looking to outsource|want to outsource)\s+([a-z\s]{3,40})\b/gi,
  /\b(help me find|recommend a|suggest a)\s+(?:good\s+)?([a-z\s]{3,40})\b/gi,
];

// Urgency indicators that boost signal scores
const URGENCY_PATTERNS = {
  high: /\b(urgent|asap|immediately|right now|today|this week)\b/i,
  medium: /\b(soon|quickly|within \d+ days|this month)\b/i,
  budget: /\b(budget|pay|rate|price|\$\d+|€\d+|£\d+)\b/i,
};

/**
 * Extract video ID from various YouTube URL formats
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Fetch transcript from YouTube's internal API
 * Uses youtube-transcript package - no API key required
 */
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Dynamic import to avoid bundling if not used
    const { YoutubeTranscript } = await import("youtube-transcript");
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    return transcript.map((t) => t.text).join(" ");
  } catch (err) {
    // Video may have no captions, be age-restricted, or deleted
    return null;
  }
}

/**
 * Detect buyer intent phrases in transcript text
 * Returns context windows around matches with scoring
 */
function detectBuyerIntent(
  transcript: string,
  skill: string,
): Array<{ text: string; matchedPhrase: string; score: number }> {
  const matches: Array<{ text: string; matchedPhrase: string; score: number }> = [];
  const lowerSkill = skill.toLowerCase();

  for (const pattern of BUYER_PATTERNS) {
    // Reset regex lastIndex for global flag
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(transcript)) !== null) {
      const matchedPhrase = match[0];
      const mentionedTerm = match[1] || match[2] || "";

      // Check if the match is relevant to the skill
      if (
        !mentionedTerm.toLowerCase().includes(lowerSkill) &&
        !lowerSkill.includes(mentionedTerm.toLowerCase())
      ) {
        continue; // Skip irrelevant matches
      }

      // Extract context window (200 chars before and after)
      const start = Math.max(0, match.index - 200);
      const end = Math.min(transcript.length, match.index + 200);
      const context = transcript.slice(start, end).trim();

      // Calculate urgency score
      const score = calculateUrgencyScore(context);

      matches.push({
        text: context,
        matchedPhrase,
        score,
      });
    }
  }

  return matches;
}

/**
 * Calculate urgency score based on temporal and budget indicators
 */
function calculateUrgencyScore(text: string): number {
  let score = 1;

  if (URGENCY_PATTERNS.high.test(text)) score += 3;
  if (URGENCY_PATTERNS.medium.test(text)) score += 2;
  if (URGENCY_PATTERNS.budget.test(text)) score += 2;

  return score;
}

/**
 * Main function: Enrich YouTube URLs with transcript analysis
 *
 * @param videoUrls - Array of YouTube URLs discovered by SearXNG/SERP
 * @param skill - The skill/craft being searched for
 * @returns Array of enriched signals with buyer intent
 */
export async function enrichYouTubeWithTranscripts(
  videoUrls: string[],
  skill: string,
): Promise<YouTubeSignal[]> {
  const results: YouTubeSignal[] = [];

  // Limit to prevent timeouts (transcripts can take 1-2s each)
  const urlsToProcess = videoUrls.slice(0, 10);

  for (const url of urlsToProcess) {
    const videoId = extractVideoId(url);
    if (!videoId) continue;

    // Fetch transcript
    const transcript = await fetchTranscript(videoId);
    if (!transcript || transcript.length < 100) continue; // Skip very short transcripts

    // Detect buyer intent
    const buyerSignals = detectBuyerIntent(transcript, skill);
    if (buyerSignals.length === 0) continue; // No buyer intent found

    // Store result
    results.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: "", // Will be filled by caller if available
      buyerSignals,
      transcriptSnippet: transcript.slice(0, 500) + "...", // First 500 chars
    });
  }

  return results;
}

/**
 * Convert YouTube signals to standard Lead format
 * Integrates with existing scoring system
 */
export function youtubeSignalsToLeads(signals: YouTubeSignal[], existingLeads: Lead[]): Lead[] {
  const leads: Lead[] = [];
  const seen = new Set(existingLeads.map((l) => l.full_post_url));

  for (const signal of signals) {
    if (seen.has(signal.url)) continue; // Avoid duplicates

    // Find highest scoring buyer signal
    const topSignal = signal.buyerSignals.sort((a, b) => b.score - a.score)[0];

    leads.push({
      source: "youtube",
      platform: "YouTube",
      identity_name: "", // Will be extracted from video metadata
      identity_handle: "",
      full_post_url: signal.url,
      title: signal.title || `YouTube Video - ${signal.videoId}`,
      snippet: topSignal.text,
      lead_text: `${topSignal.matchedPhrase}\n\n${topSignal.text}`,
      posted_at: signal.publishedDate || new Date().toISOString(),
      discovered_at: new Date().toISOString(),
      context_tags: ["video", "transcript", "buyer-intent"],
      urgency_score: topSignal.score,
    } as Lead);

    seen.add(signal.url);
  }

  return leads;
}

/**
 * Integration point for existing searchYouTubeSignals()
 * Call this function after getting video URLs from SearXNG
 */
export async function enhanceYouTubeLeads(existingLeads: Lead[], skill: string): Promise<Lead[]> {
  // Extract YouTube URLs from existing leads
  const youtubeUrls = existingLeads
    .filter((l) => l.source === "youtube" || l.full_post_url?.includes("youtube.com"))
    .map((l) => l.full_post_url || "");

  if (youtubeUrls.length === 0) return existingLeads;

  // Enrich with transcripts
  const signals = await enrichYouTubeWithTranscripts(youtubeUrls, skill);
  if (signals.length === 0) return existingLeads;

  // Convert to leads
  const enrichedLeads = youtubeSignalsToLeads(signals, existingLeads);

  // Merge with existing, replacing YouTube leads with enriched versions
  const nonYoutube = existingLeads.filter((l) => l.source !== "youtube");
  return [...nonYoutube, ...enrichedLeads];
}
