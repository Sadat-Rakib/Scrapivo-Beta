import { buildSpec, type SearchSpec, type SpecEntity, type SpecField } from '../search/search-spec';
import { extractSearchSpec, normalizeRole } from '../search/search-spec-extract';
import { resolveCanonicalLocation } from '../search/location-resolver';
import { extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import type { OpenValue, UnderstandingFrame } from './frame';

const clean = (value: string) => value.trim().replace(/[.!?]+$/, '').trim();
const valueOf = (value: OpenValue | null | undefined) => value ? clean(value.normalized ?? value.value) : '';
const GLOBAL = /\b(?:globally|global|worldwide|anywhere|all countries)\b/i;
const MODAL_NEED = /\b(?:may|might|could)\s+(?:potentially\s+)?(?:need|benefit from)\b|\b(?:relevant|suitable|a good fit)\s+for\b/i;
const SOCIAL_TOPIC = /\b(?:talk(?:s|ing)?|post(?:s|ing)?|writ(?:e|es|ing)|discuss(?:es|ing)?)\s+(?:about\s+)?(.+?)(?=[.!?]?$)/i;

/** Repair only distinctions that the legacy grammar cannot represent. Raw spans stay attached. */
export function normalizeSearchFrame(input: UnderstandingFrame): UnderstandingFrame {
  const frame = structuredClone(input);
  const raw = frame.input.raw;
  const modal = raw.match(MODAL_NEED);
  const hardClause = /\b(?:and|but|also)\s+(?:who\s+|that\s+)?(?:are\s+)?(?:need|seeking|hiring|asking|looking for)\b/i.test(raw);
  if (modal && !hardClause && ['needs_service', 'asking_for_help', 'none', 'unknown'].includes(frame.relation.type.value)) {
    const offer = clean(raw.slice((modal.index ?? 0) + modal[0].length).replace(/^\s*(?:help\s+with\s+|a\s+|an\s+)/i, ''));
    frame.user_context.selling ??= { service: null, product: null };
    frame.user_context.selling.service = { value: offer || valueOf(frame.relation.object) || 'services', raw: modal[0], normalized: null, confidence: 0.85 };
    frame.relation = { type: { value: 'none', raw: modal[0], confidence: 0.95 }, direction: { value: 'none', raw: modal[0], confidence: 0.95 }, label: null, object: null };
    frame.prospecting_mode = { value: 'fit_based', raw: modal[0], confidence: 0.95 };
    frame.evidence.intent_signal_required = false;
    frame.meta.notes.push('Modal need describes potential fit; expressed buying intent is not required.');
  }
  const social = raw.match(SOCIAL_TOPIC);
  if (social) {
    const topic = clean(social[1]);
    frame.constraints = frame.constraints.filter((c) => c.field !== 'content_topic');
    frame.constraints.push({ field: 'content_topic', operator: 'eq', value: topic, raw: social[0], confidence: 1, negated: false, unit: null });
    if (!frame.evidence.intent_signal_required) {
      frame.prospecting_mode = { value: 'social_signal_based', raw: social[0], confidence: 1 };
    }
  }
  return frame;
}

/** Existing readers consume SearchSpec; the authoritative frame supplies its semantic fields. */
export function frameToSearchSpec(input: UnderstandingFrame): SearchSpec {
  const frame = normalizeSearchFrame(input);
  const raw = frame.input.raw;
  const legacy = extractSearchSpec(raw);
  const supported = ['person', 'company', 'business', 'investor', 'job'];
  // An explicit SaaS company request is an organization search even when the
  // understanding provider labels the city-scoped target as a local business.
  const entity: SpecEntity = /\bSaaS\s+compan(?:y|ies)\b/i.test(raw)
    ? 'company'
    : supported.includes(frame.target.entity_type.value)
      ? frame.target.entity_type.value as SpecEntity
      : frame.target.entity_type.value === 'organization' ? 'company' : legacy.entity;
  const semanticFields = new Set(['role', 'industry', 'category', 'requested_service', 'requested_role', 'requested_product']);
  const criteria: SpecField[] = legacy.criteria.filter((c) => !semanticFields.has(c.field));
  const put = (field: string, value: string, confidence = 1, stated = true) => {
    if (!value) return;
    const index = criteria.findIndex((c) => c.field === field);
    const next = { field, value, stated, confidence };
    if (index < 0) criteria.push(next); else criteria[index] = next;
  };
  const descriptor = (field: string, value: OpenValue | null | undefined, transform = (s: string) => s) => {
    if (value) put(field, transform(valueOf(value)), value.confidence, !!value.raw);
  };
  const deterministicTarget = extractFrameDeterministic(raw).target;
  let role = valueOf(frame.target.job_title ?? frame.target.role) ||
    (entity === 'person' && deterministicTarget.role?.raw && raw.includes(deterministicTarget.role.raw)
      ? valueOf(deterministicTarget.role) : '');
  const statedIndustry = valueOf(frame.target.industry) || legacy.criteria.find((c) => c.field === 'industry')?.value || '';
  const topicStart = raw.search(SOCIAL_TOPIC);
  const industryStart = statedIndustry ? raw.toLowerCase().indexOf(statedIndustry.toLowerCase()) : -1;
  const industry = topicStart >= 0 && industryStart >= topicStart ? '' : statedIndustry;
  // "SaaS founders" has separate industry and role slots downstream.
  if (industry && role.toLowerCase().startsWith(industry.toLowerCase() + ' ')) role = role.slice(industry.length).trim();
  if (!role && entity === 'job') {
    const titlePhrase = frame.target.category ??
      (deterministicTarget.category?.raw && raw.includes(deterministicTarget.category.raw) ? deterministicTarget.category : null);
    role = valueOf(titlePhrase).replace(/\b(?:remote|jobs?|positions?|openings?|roles?)\b/gi, '').replace(/\s+/g, ' ').trim();
  }
  if (role) put('role', normalizeRole(role), (frame.target.role ?? frame.target.job_title ?? frame.target.category)?.confidence ?? 1);
  if (industry) put(entity === 'business' ? 'category' : entity === 'investor' ? 'investor_sector' : 'industry', industry);
  // A provider can identify the entity and geography but omit an explicit trade
  // that the deterministic frame found verbatim in the target phrase.
  const deterministicCategory = !frame.target.category && ['company', 'business'].includes(entity)
    ? deterministicTarget.category
    : null;
  const safeCategory = deterministicCategory?.raw && raw.indexOf(deterministicCategory.raw) >= 0 &&
    (!MODAL_NEED.test(raw) || raw.indexOf(deterministicCategory.raw) < (raw.search(MODAL_NEED)))
    ? deterministicCategory : null;
  const category = valueOf(frame.target.category ?? frame.target.business_type ?? safeCategory).replace(/\s+(?:companies|company|businesses|business)$/i, '');
  if (category && ['company', 'business'].includes(entity)) put(entity === 'company' ? 'industry' : 'category', industry || category);
  descriptor('company_stage', frame.target.company_stage);
  if (frame.target.technologies.length) put('technology', frame.target.technologies.map(valueOf).join(', '));

  if (frame.location) {
    const location = frame.location.canonical ?? frame.location.value;
    if (GLOBAL.test(location)) {
      for (let i = criteria.length - 1; i >= 0; i--) if (criteria[i].field.startsWith('location')) criteria.splice(i, 1);
      put('geo_scope', 'worldwide');
    } else if (!legacy.locationSuggestion) {
      const geo = resolveCanonicalLocation(location.replace(/^the\s+/i, ''));
      for (let i = criteria.length - 1; i >= 0; i--) if (criteria[i].field.startsWith('location')) criteria.splice(i, 1);
      put('location', geo?.name ?? location, frame.location.confidence);
      if (geo) {
        put('location_id', geo.id);
        put('location_kind', geo.kind);
        if (geo.country_code) put('location_country', geo.country_code);
        if (geo.scope) put('location_scope', geo.scope);
        if (geo.parent_ids.length) put('location_parents', geo.parent_ids.join(','));
      }
    }
  }

  const object = valueOf(frame.relation.object);
  // Tentative help-seeking ("may need help with X") is a curiosity frame, not
  // an explicit buying ask — never demand service_request evidence for it.
  // Explicit asks (looking for / seeking / hiring / needing <service>) keep
  // their frame-level intent.
  const tentativeHelp = /\b(?:may|might|could)\s+(?:need|benefit\s+from)\s+help\b/i.test(raw);
  if (frame.evidence.intent_signal_required && object && !tentativeHelp) {
    put(frame.relation.type.value === 'hiring' ? 'requested_role' : 'requested_service', object);
  }
  const offer = valueOf(frame.user_context.selling?.service ?? frame.user_context.selling?.product);
  if (offer) { put('offer', offer); put('mode', 'selling'); }
  // A tentative need for a BETTER website never states that no website exists.
  if (MODAL_NEED.test(raw) && !/\b(?:without|no|lacks?|missing)\s+(?:a\s+|any\s+)?website/i.test(raw)) {
    const index = criteria.findIndex((c) => c.field === 'opportunity');
    if (index >= 0) criteria.splice(index, 1);
  }
  for (const constraint of frame.constraints) {
    if (constraint.field === 'content_topic' && typeof constraint.value === 'string' && !constraint.negated) {
      put('content_topic', constraint.value);
      put('needs_live', 'true');
    }
  }
  if (frame.temporal?.relation === 'within_last' && frame.temporal.window) put('needs_live', 'true');
  const eventSignal = ['hiring', 'received_funding', 'seeking_funding'].includes(frame.relation.type.value);
  const signalRequired = !tentativeHelp && (frame.evidence.intent_signal_required || eventSignal);
  const signalTypes = signalRequired ? legacy.signal_types.length ? legacy.signal_types : [frame.relation.type.value === 'hiring' ? 'hiring' : frame.relation.type.value === 'received_funding' ? 'funding' : 'service_request'] : [];
  return {
    ...buildSpec({ entity, criteria, raw_query: raw, signal_required: signalRequired, signal_types: signalTypes,
      signal_recency: frame.temporal?.window ?? legacy.signal_recency, locationSuggestion: legacy.locationSuggestion }),
    understanding: frame,
  };
}

/** A known target with usable scope can search without optional sales coaching. */
export function isActionableFrame(spec: SearchSpec): boolean {
  const frame = spec.understanding;
  if (!frame || frame.clarification.needed || frame.compound.is_compound || spec.missing.length || spec.locationSuggestion) return false;
  return !!(frame.target.role || frame.target.job_title || frame.target.industry || frame.target.category || frame.target.business_type || frame.relation.object);
}

/** Server extraction is bounded; a provider failure returns the existing deterministic frame. */
export async function understandSearchSpec(query: string, context: Record<string, string>, signal?: AbortSignal | null): Promise<SearchSpec> {
  if (process.env.VITEST) return frameToSearchSpec(validateFrame(extractFrameDeterministic(query)).frame);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const fallback = (reason: string) => {
    const frame = extractFrameDeterministic(query);
    frame.meta.fallback_used = true;
    frame.meta.notes.push(reason);
    return frame;
  };
  try {
    const bounded = new Promise<UnderstandingFrame>((resolve) => {
      timer = setTimeout(() => resolve(fallback('Understanding provider exceeded 12 second search budget.')), 12_000);
      abort = () => resolve(fallback('Understanding interrupted by search cancellation.'));
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    const extraction = import('./extract.server').then(({ extractFrameLLM }) => extractFrameLLM(query, { context, waitForSlotMs: 250 }))
      .then((result) => result.frame).catch(() => fallback('Understanding provider failed; deterministic fallback used.'));
    return frameToSearchSpec(validateFrame(await Promise.race([extraction, bounded])).frame);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
