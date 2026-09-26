/** Phase 1.1 verification: the app's own S3 reader path (LIST only, zero DB RU).
 * Run with AWS_PROFILE=scrapivo + AWS_REGION=us-east-2 in env (dev server gets
 * the same values from .env, which is gitignored). Never prints credentials.
 */
import { listPartitionFilesBySize } from "@/lib/canonical/read-parquet.server";

const files = await listPartitionFilesBySize("processed/local-businesses/by_country/");
const bd = files.filter((f) => f.key.endsWith("/bd.parquet"));
console.log(JSON.stringify({
  profile: process.env.AWS_PROFILE ?? null,
  region: process.env.AWS_REGION ?? null,
  byCountryFiles: files.length,
  bdPresent: bd.length > 0,
  bdSize: bd[0]?.size ?? null,
}, null, 2));
if (!files.length) throw new Error("S3 LIST returned nothing — creds still broken");
console.log("PHASE1.1 S3-CREDS OK");
