/**
 * M14 — SocialArtifact: the canonical social post/comment shape.
 *
 * POST ≠ AUTHOR ≠ COMPANY. A post is evidence; the author may become a lead;
 * the author's company is a separate associated entity only with proven relationship.
 *
 * OSS collectors must adapt INTO this shape — never emit their own "lead" objects.
 */
export type SocialPlatform =
  | "reddit"
  | "linkedin"
  | "facebook"
  | "twitter"
  | "other";

/**
 * Immutable observation of a social post or comment.
 * Never treat community/group/page fields as the lead entity.
 */
export interface SocialArtifact {
  platform: SocialPlatform;
  /** Stable platform post id when known; else derived from URL. */
  post_id: string;
  post_url: string;
  /** Platform-scoped author handle/id — not a real-world entity_id. */
  author_platform_id: string | null;
  author_name: string | null;
  author_profile_url: string | null;
  text: string;
  /** Real-world event time of the post/comment. NEVER crawl/search date. */
  posted_at: string | null;
  /** When the crawler observed the post. */
  observed_at: string;
  /** Community metadata only (subreddit, group name) — not author location. */
  community: string | null;
  /** True when the artifact is a group/page listing, not an authored post. */
  is_community_container?: boolean;
}

export type SocialHitLike = {
  title: string;
  url: string;
  excerpt: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
  platform?: SocialPlatform;
  author_profile_url?: string;
  observed_at?: string;
  is_community_container?: boolean;
};

function postIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    // Reddit: /r/.../comments/<id>/...
    const m = u.pathname.match(/\/comments\/([a-z0-9]+)/i);
    if (m?.[1]) return m[1];
    const segs = u.pathname.split("/").filter(Boolean);
    return segs[segs.length - 1] || u.hostname;
  } catch {
    return url.slice(0, 64);
  }
}

function inferPlatform(url: string, explicit?: SocialPlatform): SocialPlatform {
  if (explicit) return explicit;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (h.includes("reddit.com")) return "reddit";
    if (h.includes("linkedin.com")) return "linkedin";
    if (h.includes("facebook.com") || h.includes("fb.com")) return "facebook";
    if (h.includes("twitter.com") || h.includes("x.com")) return "twitter";
  } catch {
    /* ignore */
  }
  return "other";
}

function authorPlatformId(
  platform: SocialPlatform,
  author: string | null | undefined,
): string | null {
  if (!author?.trim()) return null;
  const handle = author.trim().replace(/^u\//i, "");
  return `${platform}:u:${handle}`;
}

function authorProfileUrl(
  platform: SocialPlatform,
  author: string | null | undefined,
  explicit?: string,
): string | null {
  if (explicit?.trim()) return explicit.trim();
  if (!author?.trim()) return null;
  const handle = author.trim().replace(/^u\//i, "");
  if (platform === "reddit") return `https://reddit.com/user/${handle}`;
  return null;
}

/**
 * Adapt a provider hit into a SocialArtifact.
 * created_utc → posted_at (event). observed_at defaults to now, never substitutes for posted_at.
 */
export function socialArtifactFromHit(
  hit: SocialHitLike,
  opts?: { observed_at?: string },
): SocialArtifact {
  const platform = inferPlatform(hit.url, hit.platform);
  const author = hit.author?.trim() || null;
  const posted_at =
    typeof hit.created_utc === "number" && Number.isFinite(hit.created_utc)
      ? new Date(hit.created_utc * 1000).toISOString()
      : null;
  const text = [hit.title, hit.excerpt].filter(Boolean).join("\n").trim();
  return {
    platform,
    post_id: postIdFromUrl(hit.url),
    post_url: hit.url,
    author_platform_id: authorPlatformId(platform, author),
    author_name: author,
    author_profile_url: authorProfileUrl(
      platform,
      author,
      hit.author_profile_url,
    ),
    text,
    posted_at,
    observed_at: hit.observed_at ?? opts?.observed_at ?? new Date().toISOString(),
    community: hit.subreddit?.trim() || null,
    is_community_container: hit.is_community_container === true,
  };
}

/** Dedup key for the underlying post — re-crawls and multi-source hits collapse. */
export function socialArtifactKey(a: SocialArtifact): string {
  return `social:${a.platform}:post:${a.post_id}`;
}
