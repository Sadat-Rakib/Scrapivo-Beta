/**
 * Local-only launcher for the private research/browser worker.
 *
 * Loads `.env` (values are never printed), forces the local no-persist guard,
 * and starts `src/research-worker/server.ts` on 127.0.0.1. It never calls
 * `vercel` or touches any deployment configuration — unlike
 * scripts/start-mvp-testing.ps1, which must not be used for local testing.
 */
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

if (existsSync(".env")) loadEnvFile(".env");
process.env.SCRAPIVO_LOCAL_NO_PERSIST = "true";
if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("local-browser-worker is for local development only");
await import("../src/research-worker/server");
