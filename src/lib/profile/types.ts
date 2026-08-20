/** Normalized profile discovery record (Scout-inspired; Scrapivo adapters only). */
export type ProfilePlatform =
  | "linkedin"
  | "twitter"
  | "x"
  | "instagram"
  | "tiktok"
  | "github"
  | "youtube"
  | "facebook"
  | "pinterest"
  | "linktree"
  | "beacons"
  | "website"
  | "other";

export type UniversalProfile = {
  entityId: string;
  platform: ProfilePlatform;
  profileUrl: string;
  username?: string;
  displayName?: string;
  profileType: "person" | "company";
  source: "profile_discovery";
  confidence: "high" | "medium" | "low";
  discoveredAt: string;
  bio?: string;
};

export type ProfileEntity = {
  id?: string;
  name?: string;
  domain?: string;
  website?: string;
  bio?: string;
  knownUrls?: string[];
};

export type ProfileDiscoverContext = {
  playbook?: string;
  /** Prefer these platforms when present. */
  prefer?: ProfilePlatform[];
};
