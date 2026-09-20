import type { SpecEntity } from "@/lib/search/search-spec";

export const SEARCH_INDEX_SCHEMA_VERSION = 1;
export const SEARCH_INDEX_NORMALIZER_VERSION = "gate2b-final-v1";

export type IndexedEntity = Exclude<SpecEntity, "job" | "unknown">;

export interface SearchIndexObjectRef {
  key: string;
  bytes: number;
  sha256: string;
  rows?: number;
}

export interface SearchDocumentRange extends SearchIndexObjectRef {
  entity: IndexedEntity;
  startId: number;
  endId: number;
  sourceObject: string;
}

export interface SearchIndexEntityCounts {
  physical: number;
  searchable: number;
  duplicate: number;
  quarantined: number;
  unindexable: number;
  failed: number;
}

export interface SearchIndexManifest {
  version: string;
  status: "building" | "complete";
  createdAt: string;
  schemaVersion: number;
  normalizerVersion: string;
  sourceBucket: string;
  sourceObjects: Array<{ key: string; bytes: number; rows: number; etag?: string | null; lastModified?: string | null }>;
  counts: Record<IndexedEntity, SearchIndexEntityCounts>;
  postingBucketHexChars: number;
  postingObjects: SearchIndexObjectRef[];
  documentObjects: SearchDocumentRange[];
  build: {
    completedPartitions: number;
    totalPartitions: number;
    aiCalls: 0;
    elapsedMs?: number;
  };
}

export interface ActiveSearchIndex {
  version: string;
  manifestKey: string;
  activatedAt: string;
  previousVersion?: string | null;
}

export interface CompactSearchDocument {
  doc_id: number;
  entity: IndexedEntity;
  registry_key: string;
  name: string;
  title?: string | null;
  role_norm?: string | null;
  employer?: string | null;
  category?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  coarse_location?: string | null;
  domain?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  sector?: string | null;
  stage?: string | null;
  kind?: string | null;
  check_min_usd?: number | null;
  check_max_usd?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  quality_score: number;
  source_object: string;
  source_row: number;
}

export interface PostingCandidate {
  docId: number;
  quality: number;
  flags: number;
}

export const CONTACT_FLAG_WEBSITE = 1;
export const CONTACT_FLAG_EMAIL = 2;
export const CONTACT_FLAG_PHONE = 4;
