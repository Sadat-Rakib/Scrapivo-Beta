import { extractFrameDeterministic } from '../src/lib/understanding/fallback';
import { extractSearchSpec } from '../src/lib/search/search-spec-extract';
for (const query of [
  'Find SaaS founders globally who may need help with AI automation.',
  'Find HVAC companies in the Greater Toronto Area that could need a better website or automation.',
  'Find copywriters in New York who talk about AI content or AI slop.',
  'Find remote AI automation jobs in Canada.',
]) {
  const frame = extractFrameDeterministic(query);
  console.log(JSON.stringify({ query, spec: extractSearchSpec(query), frame }));
}
