import { ensureJobAdaptersRegistered } from "./ats-adapters";
import { ensureRemoteJobAdaptersRegistered } from "./remote-adapters";

let ready = false;

/** Register ATS + remote/GitHub/RSS adapters once. Used by /jobs and Discover. */
export function ensureJobCatalogRegistered(): void {
  if (ready) return;
  ensureJobAdaptersRegistered();
  ensureRemoteJobAdaptersRegistered();
  ready = true;
}
