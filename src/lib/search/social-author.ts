/**
 * M14 — Author identity resolution for social artifacts.
 *
 * Platform identity established ≠ real-world entity resolved.
 * Never silently treat u/random as a QualifiedLead person when Spec requires
 * a resolved person (fail closed via provisional / unresolved).
 */
import { mintProvisionalEntityId } from "@/lib/search/canonical-contract";
import type { SocialArtifact } from "@/lib/search/social-artifact";

export type SocialAuthorResolution =
  | {
      status: "resolved";
      entity_id: string;
      platform_id: string;
      real_world: true;
      display_name: string | null;
    }
  | {
      status: "platform_only";
      /** Provisional id — cannot satisfy M4 resolved-person contract. */
      entity_id: string;
      platform_id: string;
      real_world: false;
      display_name: string | null;
    }
  | {
      status: "unresolved";
      reason: string;
    };

export type SocialAuthorResolver = (
  platform_id: string,
  artifact: SocialArtifact,
) => string | null;

/**
 * Resolve the post author.
 * `resolveRealWorld` may map a platform id → stable person entity_id when known
 * (enrichment / registry). Absent that, authors stay platform_only.
 */
export function resolveSocialAuthor(
  artifact: SocialArtifact,
  opts?: { resolveRealWorld?: SocialAuthorResolver },
): SocialAuthorResolution {
  if (artifact.is_community_container) {
    return {
      status: "unresolved",
      reason: "community_container_is_not_an_author",
    };
  }
  const platformId = artifact.author_platform_id?.trim() || null;
  if (!platformId) {
    return { status: "unresolved", reason: "missing_author_platform_id" };
  }

  const real = opts?.resolveRealWorld?.(platformId, artifact)?.trim() || null;
  if (real && !real.toLowerCase().startsWith("provisional:")) {
    // Guard: never accept company ids as person authors from social posts.
    if (/^(company|business|org):/i.test(real)) {
      return {
        status: "unresolved",
        reason: "resolved_id_is_organization_not_author",
      };
    }
    return {
      status: "resolved",
      entity_id: real,
      platform_id: platformId,
      real_world: true,
      display_name: artifact.author_name,
    };
  }

  return {
    status: "platform_only",
    entity_id: mintProvisionalEntityId(`social:${platformId}`),
    platform_id: platformId,
    real_world: false,
    display_name: artifact.author_name,
  };
}

/**
 * Person Specs that demand a QualifiedLead person require real-world resolution.
 * Platform-only handles fail closed.
 */
export function socialAuthorSatisfiesPersonSpec(
  resolution: SocialAuthorResolution,
): boolean {
  return resolution.status === "resolved" && resolution.real_world === true;
}
