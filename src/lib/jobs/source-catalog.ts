import { ensureJobAdaptersRegistered } from "./ats-adapters";
import { ensureRemoteJobAdaptersRegistered } from "./remote-adapters";
import { ensureWorkdayAdapterRegistered } from "./workday-adapter";

let ready = false;

/** Register ATS + remote/GitHub/RSS + Workday adapters once. Used by /jobs and Discover. */
export function ensureJobCatalogRegistered(): void {
  if (ready) return;
  ensureJobAdaptersRegistered();
  ensureRemoteJobAdaptersRegistered();
  ensureWorkdayAdapterRegistered();
  ready = true;
}
