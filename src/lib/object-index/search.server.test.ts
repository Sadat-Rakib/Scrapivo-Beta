import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpec } from "@/lib/search/search-spec";
import type { SearchIndexObjectStore } from "./object-store.server";
import { clearObjectIndexCaches, queryObjectIndexForSpec } from "./search.server";
import { postingBucket } from "./normalization";

const aiComplete = vi.fn(() => { throw new Error("AI called during stored retrieval"); });
vi.mock("@/lib/ai/router.server", () => ({ aiComplete }));

vi.mock("hyparquet", async (original) => {
  const actual = await original<typeof import("hyparquet")>();
  return {
    ...actual,
    parquetMetadataAsync: vi.fn(async () => ({ num_rows: 1n, row_groups: [] })),
    parquetReadObjects: vi.fn(async () => [{
      doc_id: 10, entity: "business", registry_key: "business:10", name: "Toronto HVAC",
      category: "hvac", country: "CA", city: "Toronto", website: "https://hvac.example",
      phone: "+14165550100", quality_score: 90, source_object: "canonical.parquet", source_row: 9,
      latitude: 43.65, longitude: -79.38,
    }]),
  };
});

function varint(value: number): number[] {
  const out: number[] = [];
  while (value >= 128) { out.push((value & 127) | 128); value = Math.floor(value / 128); }
  out.push(value); return out;
}

function posting(term: string, dimension: string): Uint8Array {
  const body = Uint8Array.from([...varint(20), 90, 5]);
  const header = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1, entity: "business", dimension,
    entries: [[term, 0, body.length, 1]],
  }));
  const out = new Uint8Array(8 + header.length + body.length);
  out.set(new TextEncoder().encode("SPI1"));
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8); out.set(body, 8 + header.length); return out;
}

describe("stored object-index retrieval", () => {
  beforeEach(() => { clearObjectIndexCaches(); aiComplete.mockClear(); });

  it("discovers, hydrates, and filters with zero AI calls", async () => {
    const terms = [{ dimension: "city", term: "toronto" }, { dimension: "category", term: "hvac" }];
    const keys = await Promise.all(terms.map(async ({ dimension, term }) =>
      `derived/search-index/versions/test-v1/postings/business/${dimension}/${await postingBucket(term, 3)}.pidx`));
    const encoder = new TextEncoder();
    const objects = new Map<string, Uint8Array>([
      ["derived/search-index/active.json", encoder.encode(JSON.stringify({ version: "test-v1", manifestKey: "manifest.json", activatedAt: "now" }))],
      ["manifest.json", encoder.encode(JSON.stringify({
        version: "test-v1", status: "complete", createdAt: "now", schemaVersion: 1,
        normalizerVersion: "gate2b-final-v1", sourceBucket: "fixture", sourceObjects: [],
        counts: {}, postingBucketHexChars: 3,
        postingObjects: keys.map((key) => ({ key, bytes: 100, sha256: "fixture" })),
        documentObjects: [{ key: "documents.parquet", bytes: 100, sha256: "fixture", rows: 1,
          entity: "business", startId: 10, endId: 11, sourceObject: "canonical.parquet" }],
        build: { completedPartitions: 1, totalPartitions: 1, aiCalls: 0 },
      }))],
      ...terms.map(({ dimension, term }, index) => [keys[index], posting(term, dimension)] as const),
      ["documents.parquet", new Uint8Array(100)],
    ]);
    const store: SearchIndexObjectStore = {
      async getObject(objectKey, range) {
        const value = objects.get(objectKey);
        if (!value) throw new Error(`missing fixture ${objectKey}`);
        return value.slice(range?.start ?? 0, range?.end === undefined ? undefined : range.end + 1);
      },
      async headObject(objectKey) { return { bytes: objects.get(objectKey)?.length ?? 0 }; },
      async listVersionPrefix() { return []; },
    };
    const spec = buildSpec({ entity: "business", raw_query: "fixture", criteria: [
      { field: "category", value: "HVAC", stated: true, confidence: 1 },
      { field: "location", value: "Toronto", stated: true, confidence: 1 },
    ] });
    const result = await queryObjectIndexForSpec(spec, 25, 0, store);
    expect(result?.rows).toHaveLength(1);
    expect(result?.meta).toMatchObject({ engine: "s3-object-index", canonicalRowsRead: 0 });
    expect(aiComplete).not.toHaveBeenCalled();
  });
});
