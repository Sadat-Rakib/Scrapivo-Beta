import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { iniCredentialProvider } from "@/lib/canonical/read-parquet.server";

export interface SearchIndexObjectStore {
  getObject(key: string, range?: { start: number; end?: number }): Promise<Uint8Array>;
  headObject(key: string): Promise<{ bytes: number; etag?: string }>;
  listVersionPrefix(prefix: string): Promise<Array<{ key: string; bytes: number; etag?: string }>>;
  putObject?(key: string, body: Uint8Array, contentType: string): Promise<{ etag?: string }>;
}

export interface SearchIndexStoreConfig {
  kind: "s3" | "r2";
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  profile?: string;
}

export function searchIndexStoreConfig(env: NodeJS.ProcessEnv = process.env): SearchIndexStoreConfig {
  const kind = env.SEARCH_INDEX_STORE?.trim().toLowerCase() === "r2" ? "r2" : "s3";
  if (kind === "r2") {
    const bucket = env.R2_SEARCH_INDEX_BUCKET?.trim();
    const endpoint = env.R2_SEARCH_INDEX_ENDPOINT?.trim();
    const accessKeyId = env.R2_SEARCH_INDEX_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.R2_SEARCH_INDEX_SECRET_ACCESS_KEY?.trim();
    if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 search index selected but R2_SEARCH_INDEX_* configuration is incomplete");
    }
    return { kind, bucket, endpoint, accessKeyId, secretAccessKey, region: "auto" };
  }
  return {
    kind,
    bucket: env.SEARCH_INDEX_BUCKET?.trim() || env.S3_BUCKET?.trim() ||
      "scrapivo-raw-data-2026-523220341033-us-east-2-an",
    region: env.SEARCH_INDEX_REGION?.trim() || env.AWS_REGION?.trim() || "us-east-2",
    profile: env.AWS_PROFILE?.trim() || undefined,
  };
}

export class S3SearchIndexObjectStore implements SearchIndexObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: SearchIndexStoreConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : config.profile
          ? { credentials: iniCredentialProvider(config.profile) }
          : {}),
    });
  }

  async getObject(key: string, range?: { start: number; end?: number }): Promise<Uint8Array> {
    const Range = range
      ? `bytes=${range.start}-${range.end === undefined ? "" : range.end}`
      : undefined;
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key, Range }));
    if (!out.Body) throw new Error(`search index object has no body: ${key}`);
    return out.Body.transformToByteArray();
  }

  async headObject(key: string): Promise<{ bytes: number; etag?: string }> {
    const out = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return { bytes: out.ContentLength ?? 0, etag: out.ETag?.replace(/^"|"$/g, "") };
  }

  async listVersionPrefix(prefix: string): Promise<Array<{ key: string; bytes: number; etag?: string }>> {
    const rows: Array<{ key: string; bytes: number; etag?: string }> = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }));
      for (const object of page.Contents ?? []) {
        if (object.Key) rows.push({
          key: object.Key,
          bytes: object.Size ?? 0,
          etag: object.ETag?.replace(/^"|"$/g, ""),
        });
      }
      token = page.NextContinuationToken;
    } while (token);
    return rows;
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<{ etag?: string }> {
    const out = await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return { etag: out.ETag?.replace(/^"|"$/g, "") };
  }
}

let defaultStore: SearchIndexObjectStore | null = null;
export function getSearchIndexObjectStore(): SearchIndexObjectStore {
  defaultStore ??= new S3SearchIndexObjectStore(searchIndexStoreConfig());
  return defaultStore;
}

