// =====================================================================
// Vision OCR — read the posts that are pictures
//
// A large share of real demand never appears as text. Someone posts a poster,
// a screenshot of a brief, or a story graphic reading "LOOKING FOR A DESIGNER
// — DM me, budget $500". To the demand classifier that post has an empty body
// and a title like "[Hiring]" or nothing at all, so it scores as noise and is
// dropped. This module transcribes the image so the SAME classifier can judge
// it on what it actually says.
//
// Free vision models only, tried in order — verified live 2026-08-02 against
// an image reading "LOOKING FOR A DESIGNER / DM me | budget $500":
//   ✓ nvidia/nemotron-nano-12b-v2-vl:free  → exact transcription
//   ~ google/gemma-4-31b-it:free           → HTTP 429 (works, rate-limited)
//   ~ google/gemma-4-26b-a4b-it:free       → same family, used as third
// Free tiers rate-limit constantly, so failover between models is the whole
// design, not a nicety.
// =====================================================================

/** Ordered by measured reliability; first success wins. */
const VISION_MODELS = [
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
];

const PROMPT =
  "Transcribe ALL visible text in this image, verbatim, preserving line breaks. " +
  "Do not describe the image, do not summarise, do not add commentary. " +
  "If the image contains no readable text, reply with exactly: NONE";

const TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 500;
/** Cap per search — free models are slow and rate-limited; this is a top-up. */
export const MAX_VISION_CALLS_PER_SEARCH = 6;

const cache = new Map<string, { at: number; text: string }>();

function readCache(url: string): string | null {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit.text;
}

function writeCache(url: string, text: string): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of oldest.slice(0, Math.floor(CACHE_MAX / 4))) cache.delete(k);
  }
  cache.set(url, { at: Date.now(), text });
}

const IMAGE_URL_RE = /\.(?:png|jpe?g|webp|gif|bmp)(?:\?|#|$)/i;
const IMAGE_HOST_RE = /(?:i\.redd\.it|i\.imgur\.com|imgur\.com|preview\.redd\.it|pbs\.twimg\.com)/i;

/** Does this URL plausibly point at an image we can transcribe? */
export function looksLikeImageUrl(url: string): boolean {
  if (!url) return false;
  // Reddit galleries and video are not single transcribable frames.
  if (/v\.redd\.it|\/gallery\//i.test(url)) return false;
  return IMAGE_URL_RE.test(url) || IMAGE_HOST_RE.test(url);
}

/**
 * Transcribe one image. Returns "" when there is no text, the model refuses,
 * or every provider is rate-limited — callers must treat "" as "no signal",
 * never as "no demand".
 */
export async function extractImageText(imageUrl: string): Promise<string> {
  if (!looksLikeImageUrl(imageUrl)) return "";
  const cached = readCache(imageUrl);
  if (cached !== null) return cached;

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return "";

  for (const model of VISION_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PROMPT },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
      });
      // 429/502 are the normal free-tier failures — fall through to next model.
      if (!res.ok) continue;

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = (data.choices?.[0]?.message?.content ?? "").trim();
      if (!raw) continue;

      const text = /^none\b/i.test(raw) ? "" : raw.slice(0, 1200);
      writeCache(imageUrl, text);
      return text;
    } catch {
      // timeout / network — try the next model
    }
  }
  return "";
}

type VisionLead = {
  title?: string;
  snippet?: string;
  image_url?: string;
  full_post_url?: string;
  vision_text?: string;
};

/** A post is "thin" when there is not enough text to classify demand from. */
function isThin(l: VisionLead): boolean {
  return `${l.title ?? ""} ${l.snippet ?? ""}`.trim().length < 80;
}

/**
 * Top up image-only posts with their transcribed text.
 *
 * Deliberately narrow: only leads that are BOTH thin and have an image get a
 * call, newest first, capped per search. Transcribing everything would cost
 * minutes per search against free rate-limited providers for no gain — a post
 * with a full text body already classifies fine.
 */
export async function enrichLeadsWithVision<T extends VisionLead>(
  leads: T[],
  limit = MAX_VISION_CALLS_PER_SEARCH,
): Promise<T[]> {
  if (!process.env.OPENROUTER_API_KEY) return leads;

  const candidates = leads.filter((l) => isThin(l) && looksLikeImageUrl(l.image_url ?? ""));
  if (!candidates.length) return leads;

  const targets = candidates.slice(0, limit);
  const texts = await Promise.all(targets.map((l) => extractImageText(l.image_url!)));

  const byUrl = new Map<string, string>();
  targets.forEach((l, i) => {
    if (texts[i]) byUrl.set(l.full_post_url ?? l.image_url!, texts[i]);
  });
  if (!byUrl.size) return leads;

  return leads.map((l) => {
    const text = byUrl.get(l.full_post_url ?? l.image_url ?? "");
    if (!text) return l;
    return {
      ...l,
      vision_text: text,
      // Append rather than replace: the original snippet may hold a flair or
      // tag the classifier uses, and overwriting it loses that.
      snippet: `${l.snippet ? `${l.snippet} ` : ""}${text}`.slice(0, 1200),
    };
  });
}
