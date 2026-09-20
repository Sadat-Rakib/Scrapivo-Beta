import { describe, expect, it } from "vitest";
import { searchIndexStoreConfig } from "./object-store.server";

describe("search index object-store configuration", () => {
  it("uses AWS S3 without requiring R2", () => {
    expect(searchIndexStoreConfig({ SEARCH_INDEX_BUCKET: "derived-test", AWS_REGION: "ca-central-1" })).toMatchObject({
      kind: "s3", bucket: "derived-test", region: "ca-central-1",
    });
  });

  it("supports an explicit S3-compatible R2 endpoint", () => {
    expect(searchIndexStoreConfig({
      SEARCH_INDEX_STORE: "r2",
      R2_SEARCH_INDEX_BUCKET: "hot-index",
      R2_SEARCH_INDEX_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      R2_SEARCH_INDEX_ACCESS_KEY_ID: "fixture-key",
      R2_SEARCH_INDEX_SECRET_ACCESS_KEY: "fixture-secret",
    })).toMatchObject({ kind: "r2", bucket: "hot-index", region: "auto" });
  });
});

