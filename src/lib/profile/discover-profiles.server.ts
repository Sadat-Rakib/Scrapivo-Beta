/**
 * Profile discovery — context-driven platform selection + public adapters.
 * Scout patterns (normalize, bio-links, registry); no LinkedIn cookie scrapers.
 */
import type {
  ProfileDiscoverContext,
  ProfileEntity,
  ProfilePlatform,
  UniversalProfile,
} from "./types";

const BIO_LINK_HOSTS = [
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "stan.store",
  "bio.link",
  "carrd.co",
];

const SOCIAL_RE: Array<{ platform: ProfilePlatform; re: RegExp }> = [
  { platform: "linkedin", re: /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^\s"'<>]+/gi },
  { platform: "twitter", re: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+/gi },
  { platform: "instagram", re: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/gi },
  { platform: "tiktok", re: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/gi },
  { platform: "github", re: /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/gi },
  { platform: "youtube", re: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)[^\s"'<>]+/gi },
  { platform: "facebook", re: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.]+/gi },
  { platform: "pinterest", re: /https?:\/\/(?:www\.)?pinterest\.com\/[A-Za-z0-9_.]+/gi },
];

function platformsForPlaybook(playbook?: string): ProfilePlatform[] {
  switch (playbook) {
    case "LOCAL_BUSINESS":
      return ["instagram", "facebook", "tiktok", "youtube", "linktree", "website"];
    case "INVESTOR_DISCOVERY":
      return ["linkedin", "twitter", "website", "github"];
    case "JOB_DISCOVERY":
      return ["linkedin", "website", "github"];
    case "CUSTOMER_DISCOVERY":
    case "COMPANY_DISCOVERY":
      return ["linkedin", "twitter", "instagram", "website", "linktree", "github"];
    case "GENERAL_PEOPLE":
      return ["twitter", "github", "instagram", "linktree", "youtube"];
    default:
      return ["website", "linktree", "github", "linkedin"];
  }
}

function usernameFromUrl(url: string, platform: ProfilePlatform): string | undefined {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (platform === "github" || platform === "instagram" || platform === "tiktok") {
      return parts[0]?.replace(/^@/, "");
    }
    if (platform === "linkedin") return parts[1] || parts[0];
    return parts[0]?.replace(/^@/, "");
  } catch {
    return undefined;
  }
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?)\]>]+$/, "").trim();
}

/** Extract social + bio-link URLs from free text / HTML. */
export function extractProfilesFromText(
  text: string,
  entityId: string,
  allowed: Set<ProfilePlatform>,
): UniversalProfile[] {
  const now = new Date().toISOString();
  const out: UniversalProfile[] = [];
  const seen = new Set<string>();

  for (const { platform, re } of SOCIAL_RE) {
    if (!allowed.has(platform) && !(platform === "twitter" && allowed.has("x"))) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const url = cleanUrl(m[0]);
      if (seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());
      out.push({
        entityId,
        platform: platform === "twitter" && /x\.com/i.test(url) ? "x" : platform,
        profileUrl: url,
        username: usernameFromUrl(url, platform),
        profileType: /\/company\//i.test(url) ? "company" : "person",
        source: "profile_discovery",
        confidence: "high",
        discoveredAt: now,
      });
    }
  }

  // Bio-link hosts
  const urlRe = /https?:\/\/[^\s"'<>]+/gi;
  let um: RegExpExecArray | null;
  while ((um = urlRe.exec(text))) {
    const url = cleanUrl(um[0]);
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    const isBio = BIO_LINK_HOSTS.some((h) => host === h || host.endsWith("." + h));
    if (!isBio) continue;
    if (!allowed.has("linktree") && !allowed.has("beacons")) continue;
    if (seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    out.push({
      entityId,
      platform: host.includes("beacon") ? "beacons" : "linktree",
      profileUrl: url,
      username: usernameFromUrl(url, "linktree"),
      profileType: "person",
      source: "profile_discovery",
      confidence: "high",
      discoveredAt: now,
    });
  }

  return out;
}

async function fetchGithubPublic(
  username: string,
  entityId: string,
): Promise<UniversalProfile | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Scrapivo-ProfileDiscovery",
      },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      html_url?: string;
      login?: string;
      name?: string;
      bio?: string;
      type?: string;
    };
    if (!j.html_url) return null;
    return {
      entityId,
      platform: "github",
      profileUrl: j.html_url,
      username: j.login,
      displayName: j.name || undefined,
      bio: j.bio || undefined,
      profileType: j.type === "Organization" ? "company" : "person",
      source: "profile_discovery",
      confidence: "high",
      discoveredAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Discover profiles for an entity using playbook-relevant platforms only.
 */
export async function discoverProfiles(
  entity: ProfileEntity,
  context: ProfileDiscoverContext = {},
): Promise<UniversalProfile[]> {
  const entityId =
    entity.id || entity.domain || entity.name?.toLowerCase().replace(/\s+/g, "-") || "unknown";
  const preferred = context.prefer?.length
    ? context.prefer
    : platformsForPlaybook(context.playbook);
  const allowed = new Set<ProfilePlatform>(preferred);

  const blobs: string[] = [];
  if (entity.bio) blobs.push(entity.bio);
  if (entity.website) blobs.push(entity.website);
  if (entity.knownUrls?.length) blobs.push(entity.knownUrls.join("\n"));

  // Light website fetch for footer/social links
  if (entity.website && allowed.has("website")) {
    try {
      const url = entity.website.startsWith("http") ? entity.website : `https://${entity.website}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Scrapivo-ProfileDiscovery" },
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 120_000);
        blobs.push(html);
        // Record website itself
      }
    } catch {
      /* best-effort */
    }
  }

  const text = blobs.join("\n");
  const profiles = extractProfilesFromText(text, entityId, allowed);

  // Optional GitHub API enrich when we already have a github username
  if (allowed.has("github")) {
    const gh = profiles.find((p) => p.platform === "github");
    if (gh?.username) {
      const enriched = await fetchGithubPublic(gh.username, entityId);
      if (enriched) {
        const i = profiles.findIndex((p) => p.profileUrl === gh.profileUrl);
        if (i >= 0) profiles[i] = { ...profiles[i], ...enriched };
        else profiles.push(enriched);
      }
    }
  }

  if (entity.website && allowed.has("website")) {
    const site = entity.website.startsWith("http") ? entity.website : `https://${entity.website}`;
    if (!profiles.some((p) => p.platform === "website")) {
      profiles.push({
        entityId,
        platform: "website",
        profileUrl: site,
        profileType: "company",
        source: "profile_discovery",
        confidence: "medium",
        discoveredAt: new Date().toISOString(),
      });
    }
  }

  return profiles;
}

/** URLs useful for contact harvest (profiles + bio links). */
export function profileUrlsForHarvest(profiles: UniversalProfile[]): string[] {
  return profiles
    .filter((p) => ["linktree", "beacons", "website", "github", "youtube"].includes(p.platform))
    .map((p) => p.profileUrl);
}
