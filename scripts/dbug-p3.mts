import { extractSearchSpec } from "@/lib/search/search-spec-extract";
const s = extractSearchSpec("companies looking for website developers");
console.log(JSON.stringify({ entity: s.entity, criteria: s.criteria, signal: s.signal_required, missing: s.missing, status: s.status }));
