import { buildSpec, type SearchSpec, type SpecEntity, type SpecField } from '../search/search-spec';
import { normalizeRole } from '../search/search-spec-extract';
import { resolveCanonicalLocation, splitMultiPlace } from '../search/location-resolver';
import { initState, patchFrame, syncClarification, type BlockingField } from './clarify-state';
import { extractFrameDeterministic } from './fallback';
import { openValue, type FrameLocation, type OpenValue, type UnderstandingFrame } from './frame';
import { classifyHead, LOCATIVE_PREP_TOKENS, opensWithExclusion } from './lexicon';
import { validateFrame } from './validate';
import { purposeFromFrame, repairExplicitPurpose } from './purpose';
import { tradeFamiliesOf } from '../canonical/businesses.server';
import { stripUrlsFromText } from '../stage1/url-utils';

const clean = (value: string) => value.trim().replace(/[.!?]+$/, '').trim();
const valueOf = (value: OpenValue | null | undefined) => value ? clean(value.normalized ?? value.value) : '';
const MODAL_NEED = /\b(?:may|might|could)\s+(?:potentially\s+)?(?:need|use|benefit from)\b|\b(?:relevant|suitable|a good fit)\s+for\b/i;
// A discussion clause, not a compound noun: "grant writing agencies" and
// "actively writing checks" are not topics. Requires `about`/`on`, a relative
// clause ("who write ..."), a talking/discussing participle — or an expressed
// complaint/frustration/switch the topic is about. The capture ends where a
// trailing locative begins ("payroll in Toronto" is not a topic).
const SOCIAL_TOPIC = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:talk|post|writ|discuss|blog|tweet)\w*\s+(?:about|on the topic of)\s+` +
    String.raw`|(?:who|that)\s+(?:(?:often|regularly|recently|publicly|actively|frequently|openly)\s+)?(?:talk|post|write|wrote|discuss|blog|tweet)\w*\s+(?:about\s+|on\s+)?` +
    String.raw`|(?:talking|discussing)\s+` +
    String.raw`|(?:complain|complains|complaining|complained|rant|rants|ranting|ranted)\s+about\s+` +
    String.raw`|(?:frustrated|stuck)\s+(?:with|by|about|over)\s+` +
    String.raw`|struggling\s+(?:with|to)\s+` +
    String.raw`|(?:tired\s+of|sick\s+of|fed\s+up\s+with)\s+` +
    String.raw`|switching\s+(?:away\s+)?from\s+` +
    String.raw`|(?:asking\s+for|looking\s+for)\s+recommendations?\s+(?:for|on|about|to)\s+(?:a\s+|an\s+|some\s+)?` +
  String.raw`)(.+?)(?=\s+(?:in|near|around|across|throughout)\s+\S+[.!?]*\s*$|[.!?]?$)`,
  "i",
);
/** A place span that names every place: a worldwide scope, never a location to match. */
const WORLDWIDE_PLACE = /^(?:(?:in|across)\s+)?(?:the\s+)?(?:globe|world|whole\s+world|entire\s+world|world\s*-?\s*wide|global(?:ly)?|international(?:ly)?|anywhere(?:\s+in\s+the\s+world)?|everywhere|all\s+over\s+the\s+world|any\s+(?:country|location|where))$/i;
/** A generic contact deliverable, not a contact page/form/person/center or "contacts at X". */
const GENERIC_CONTACT_ASK = /\b(?:public\s+contacts?|contact\s+(?:details?|info(?:rmation)?|channels?)|(?:with|incl(?:uding)?|plus|and|\+)\s+(?:their\s+|a\s+)?(?:public\s+)?contacts?(?!\s+(?:page|form|person|persons|people|names?|at|in|from|with|to|cent(?:er|re)s?|lens(?:es)?|us)\b))\b/i;
/** "without contact info", "no email", "don't need phone numbers": the opposite of an ask. */
const NEGATED_CONTACT_SOURCE = String.raw`\b(?:without|w/o|no|lacking|missing|minus|excluding|(?:do\s*n[o']?t|dont|doesn'?t)\s+(?:need|want|require))\s+(?:any\s+|a\s+|their\s+|public\s+)*(?:contacts?(?:\s+(?:details?|info(?:rmation)?))?|e-?mails?(?:\s+address(?:es)?)?|phones?(?:\s+numbers?)?)\b`;
const NEGATED_CONTACT = new RegExp(NEGATED_CONTACT_SOURCE, 'i');
const NEGATED_CONTACT_GLOBAL = new RegExp(NEGATED_CONTACT_SOURCE, 'gi');
/** The offered service after a modal need, bounded at the clause edge. */
const modalOffer = (tail: string) => clean(tail
  .replace(/^\s*(?:help\s+with\s+|help\s+from\s+|some\s+|a\s+|an\s+)/i, '')
  .split(/[,;.!?]|\s(?:and|but|with|verify|check|give|include|plus)\s/i)[0]
  .replace(/\s+(?:help|support)\s*$/i, ''));
const investorStage = (value: string) => {
  const text = clean(value);
  if (!/\b(?:investors?|funds?|capital|vc|venture)\b/i.test(text)) return null;
  if (/\bpre[ -]?seed\b/i.test(text)) return 'pre-seed';
  const series = /\bseries\s*([a-f])\b/i.exec(text);
  if (series) return `series-${series[1].toLowerCase()}`;
  if (/\bseed\b/i.test(text)) return 'seed';
  if (/\bgrowth\b/i.test(text)) return 'growth';
  return null;
};
const investorBeneficiarySector = (value: string) => {
  const sector = clean(value)
    .replace(/\b(?:startups?|companies|businesses|ventures)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sector && !/^(?:startup|company|business|venture)$/i.test(sector) ? sector : null;
};

/**
 * "Seed investors in fintech in London": the first "in" introduced a sector,
 * so the place span swallowed it ("fintech in London"). When only the part
 * after an inner locative is a real place, that part is the place and the
 * rest describes the target. Nothing changes when both or neither resolve.
 */
function splitInnerPlace(frame: UnderstandingFrame): void {
  const place = frame.location;
  if (!place) return;
  const inner = /^(.+?)\s+(?:in|near|around|across)\s+(.+)$/i.exec(clean(place.value));
  if (!inner) return;
  const [, head, tail] = inner;
  const isPlace = (value: string) => {
    const geo = resolveCanonicalLocation(value, { gazetteer: true, correctTypos: true });
    return geo && geo.kind !== 'stated' ? geo : null;
  };
  const tailGeo = isPlace(tail);
  if (!tailGeo || isPlace(head)) return;
  frame.location = { ...place, value: tail, canonical: tailGeo.name, country_code: tailGeo.country_code ?? place.country_code ?? null };
  // Only a word that is structurally a sector becomes the industry; anything
  // else ("Shoreditch in London") may be a district, so the city stands and
  // the words are kept in the notes rather than invented into a category.
  const sector = /^(?:[a-z]+tech|saas|ai|crypto|web3|blockchain|e-?commerce)$/i.test(head.trim());
  if (sector && !frame.target.industry) {
    frame.target.industry = openValue(head.toLowerCase(), head, null, 0.6);
    frame.meta.notes.push(`"${head}" is the sector; the place is ${tailGeo.name}`);
  } else {
    frame.meta.notes.push(`"${place.value}": searching ${tailGeo.name}; "${head}" kept as stated context`);
  }
}

/** Narrow validation repair: tentative fit is not observed buying intent. */
export function normalizeSearchFrame(input: UnderstandingFrame): UnderstandingFrame {
  const frame = repairExplicitPurpose(structuredClone(input));
  const raw = frame.input.raw;
  splitInnerPlace(frame);
  const modal = raw.match(MODAL_NEED);
  const hardClause = /\b(?:and|but|also)\s+(?:who\s+|that\s+)?(?:are\s+)?(?:need|seeking|hiring|asking|looking for)\b/i.test(raw);
  if (modal && !hardClause && ['needs_service', 'asking_for_help', 'none', 'unknown'].includes(frame.relation.type.value)) {
    const offer = modalOffer(raw.slice((modal.index ?? 0) + modal[0].length));
    frame.user_context.selling ??= { service: null, product: null };
    // An explicit "I sell X" statement outranks the prospect-fit tail.
    frame.user_context.selling.service ??= { value: offer || valueOf(frame.relation.object) || 'services', raw: modal[0], normalized: null, confidence: 0.85 };
    frame.relation = { type: { value: 'none', raw: modal[0], confidence: 0.95 }, direction: { value: 'none', raw: modal[0], confidence: 0.95 }, label: null, object: null };
    frame.prospecting_mode = { value: 'fit_based', raw: modal[0], confidence: 0.95 };
    frame.evidence.intent_signal_required = false;
  }
  // "public contact details" / "contact info" is one canonical deliverable:
  // any public channel (email, phone, or a first-party contact page).
  const CONTACT_ANY = /^(?:public\s+)?contact(?:\s+(?:details?|info(?:rmation)?|channels?))?$/i;
  frame.required_fields = frame.required_fields.map((item) =>
    CONTACT_ANY.test(valueOf(item)) ? openValue('contact', item.raw ?? valueOf(item), 'contact', item.confidence) : item);
  frame.required_fields = frame.required_fields.filter((item, index, all) => all.findIndex((other) => valueOf(other) === valueOf(item)) === index);
  // "with recent hiring evidence" asks for proof of hiring (any role), not a
  // role named "evidence". Evidence/recency words are never a hiring object.
  const HIRING_META = /^(?:(?:recent|recently|active|actively|current|currently|new|public|verified|visible)\s+)*(?:hiring\s+)?(?:evidence|signals?|proof|activity|posts?|postings?|news)$/i;
  if (frame.relation.type.value === 'hiring' && frame.relation.object && HIRING_META.test(valueOf(frame.relation.object))) {
    const metaRaw = frame.relation.object.raw ?? valueOf(frame.relation.object);
    frame.relation = { ...frame.relation, object: null };
    frame.evidence.intent_signal_required = true;
    const recentHiring = /\b(?:recent|recently|new|current|currently)\s+(?:hiring|job)\b/i.test(raw) || /\bhiring\b[^.,;]{0,24}\b(?:recent|recently)\b/i.test(raw);
    if ((recentHiring || /\b(?:recent|recently|current|currently)\b/i.test(metaRaw)) && !frame.temporal) {
      frame.temporal = { relation: 'recent', window: null, year: null, raw: metaRaw, confidence: 0.8 };
    }
    frame.meta.notes.push('treated hiring evidence wording as a signal requirement');
  }
  const social = raw.match(SOCIAL_TOPIC);
  if (social && !/^(?:\s*(?:and|or)\s+(?:emails?|phones?|socials?)|\s*(?:this|last|next)\s+(?:week|month|year))\b/i.test(social[1])) {
    frame.constraints = frame.constraints.filter((c) => c.field !== 'content_topic');
    frame.constraints.push({ field: 'content_topic', operator: 'eq', value: clean(social[1]), raw: social[0], confidence: 1, negated: false, unit: null });
    if (!frame.evidence.intent_signal_required) frame.prospecting_mode = { value: 'social_signal_based', raw: social[0], confidence: 1 };
  }
  if (frame.meta.extractor === 'llm') {
    const deterministic = validateFrame(extractFrameDeterministic(raw)).frame;
    splitInnerPlace(deterministic);
    // A provider sometimes drops the place entirely ("founders of SaaS
    // startups in Tallinn, Estonia who are hiring ..." -> no location), which
    // widens the search to the whole world. Recover the deterministic place
    // only when the provider kept none, the span sat behind a locative
    // preposition, and nothing marks it as an exclusion.
    const detPlace = deterministic.location;
    const cue = (detPlace?.raw ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!frame.location && !frame.locations.length && detPlace?.raw && LOCATIVE_PREP_TOKENS.has(cue) &&
        !opensWithExclusion(detPlace.raw) && !frame.constraints.some((c) => c.field === 'location')) {
      frame.location = structuredClone(detPlace);
      if (deterministic.locations.length > 1) frame.locations = structuredClone(deterministic.locations);
      frame.meta.notes.push(`recovered location: ${detPlace.canonical ?? detPlace.value}`);
    }
    // "uk + ireland", "dubai singapore sydney maybe toronto too" — the model
    // kept one place of several named in one breath. When the kept place's
    // span (or the whole request) names two or more known places, widen to a
    // multi-location search instead of dropping the rest of the list.
    if (frame.location && frame.locations.length < 2) {
      const splitPlaces = splitMultiPlace(frame.location.raw ?? frame.location.value) ??
        splitMultiPlace(frame.input.raw);
      if (splitPlaces) {
        frame.locations = splitPlaces.map((geo) => ({
          value: geo.name, raw: geo.name, scope: 'in' as const, radius: null, radius_unit: null,
          country_code: geo.country_code, canonical: geo.name, confidence: 0.8,
        }));
        if (frame.location.value !== splitPlaces[0]!.name && !splitPlaces.some((p) => p.name === frame.location!.value)) {
          frame.location = { ...frame.location, value: splitPlaces[0]!.name, canonical: splitPlaces[0]!.name, country_code: splitPlaces[0]!.country_code };
        }
        frame.meta.notes.push(`split a multi-place phrase into ${splitPlaces.map((p) => p.name).join(', ')}`);
      }
    }
    // A provider sometimes returns the right entity with NO descriptor at all
    // ("B2B SaaS founders" -> person, role/industry null), which strands the
    // search behind a scope question. Recover the deterministic descriptors
    // only when the provider kept none and both agree on the entity type.
    const TARGET_KEYS = ['role', 'job_title', 'category', 'industry', 'business_type', 'entity_subtype'] as const;
    const describes = (f: UnderstandingFrame) => TARGET_KEYS.some((key) => !!f.target[key]);
    if (!describes(frame) && describes(deterministic) && frame.target.entity_type.value === deterministic.target.entity_type.value) {
      for (const key of TARGET_KEYS) frame.target[key] ??= deterministic.target[key];
      const role = frame.target.role;
      if (role && !frame.target.industry) {
        const head = classifyHead(role.raw ?? role.value);
        if (head.kind === 'person' && head.head && head.industry) {
          frame.target.industry = openValue(head.industry, role.raw ?? role.value, head.industry, 0.7);
          frame.target.role = openValue(head.head, role.raw ?? role.value, normalizeRole(head.head), 0.8);
        }
      }
      frame.meta.notes.push('recovered target descriptors from the deterministic parse');
    }
    // Providers sometimes keep an asset relation but drop its object ("with
    // official websites" -> has_asset, object null). Recover the object only
    // when the deterministic parse observed the SAME relation type.
    const assetRelation = frame.relation.type.value;
    if ((assetRelation === 'has_asset' || assetRelation === 'lacks_asset') && !frame.relation.object &&
        deterministic.relation.type.value === assetRelation && deterministic.relation.object) {
      frame.relation = { ...frame.relation, object: deterministic.relation.object };
      frame.meta.notes.push(`recovered ${assetRelation} object: ${valueOf(deterministic.relation.object)}`);
    }
    // "with public contact details" / "with emails" are requested outputs.
    // When the provider reads them as an object-less (or contact-object)
    // has_asset relation and the deterministic parse sees no relation, the
    // requirement belongs in required_fields (recovered below), not a relation.
    const CONTACT_OUTPUT = /^(?:public\s+)?(?:contact(?:\s+(?:details?|info(?:rmation)?))?|e-?mails?(?:\s+address(?:es)?)?|phone(?:\s+numbers?)?|numbers?|socials?|social\s+(?:media|profiles?|links?))$/i;
    if (frame.relation.type.value === 'has_asset' && deterministic.relation.type.value === 'none' &&
        (!frame.relation.object || CONTACT_OUTPUT.test(valueOf(frame.relation.object)))) {
      frame.relation = { type: { value: 'none', raw: frame.relation.type.raw, confidence: 0.85 },
        direction: { value: 'none', raw: null, confidence: 0.85 }, label: null, object: null };
      frame.meta.notes.push('treated requested contact output as output fields, not a relation');
    }
    if (frame.target.entity_type.value === 'business' && deterministic.target.entity_type.value === 'company' &&
        /\b(?:compan(?:y|ies)|firms?|startups?|brands?|d2c|dtc|direct.to.consumer)\b/i.test(raw)) {
      frame.target.entity_type = { ...deterministic.target.entity_type, confidence: 0.85 };
      frame.meta.notes.push('repaired company target from explicit organization wording');
    }
    if (/\b(?:d2c|dtc|direct.to.consumer)\b/i.test(raw) &&
        !/\b(?:d2c|dtc|direct.to.consumer)\b/i.test(valueOf(frame.target.business_type))) {
      frame.target.business_type = openValue('d2c', 'D2C', 'd2c', 0.95);
      frame.meta.notes.push('recovered explicit D2C model');
    }
    if (frame.target.entity_type.value === 'company' && /\bbrands?\b/i.test(raw) &&
        frame.relation.type.value === 'offers_service' && frame.relation.object && !frame.target.industry) {
      frame.target.industry = frame.relation.object;
      frame.meta.notes.push('treated sold product as brand industry');
    }
    for (const negative of deterministic.constraints.filter((item) => item.negated || item.operator === 'neq')) {
      if (!frame.constraints.some((item) => item.field === negative.field && (item.negated || item.operator === 'neq'))) {
        frame.constraints = frame.constraints.filter((item) => item.field !== negative.field);
        frame.constraints.push(negative);
        frame.meta.notes.push(`recovered exclusion: ${negative.field}`);
      }
    }
    for (const required of deterministic.required_fields) {
      if (required.value === 'name' || required.value === 'evidence') continue;
      if (!frame.required_fields.some((item) => item.value === required.value)) {
        frame.required_fields.push(required);
        frame.meta.notes.push(`recovered requested field: ${required.value}`);
      }
    }
    if (/\bsocials?\b/i.test(raw) && /\b(?:give|need|want|include|with|pls|please|n)\b/i.test(raw) &&
        !frame.required_fields.some((item) => item.value === 'socials')) {
      frame.required_fields.push(openValue('socials', 'socials', null, 0.9));
      frame.meta.notes.push('recovered requested field: socials');
    }
    if (frame.relation.type.value === 'custom' && /\bdoing marketing\b/i.test(frame.relation.label ?? '') &&
        !/\b(?:provides?|offers?|sells?)\s+marketing\b/i.test(raw)) {
      frame.relation = { type: { value: 'none', raw: null, confidence: 0.85 },
        direction: { value: 'none', raw: null, confidence: 0.85 }, label: null, object: null };
      frame.meta.notes.push('treated marketing activity as a target attribute');
    }
    if (frame.relation.type.value === 'partnered_with' && !frame.relation.object &&
        /\bfor partnership opportunities\b/i.test(raw)) {
      frame.relation = { type: { value: 'none', raw: null, confidence: 0.9 },
        direction: { value: 'none', raw: null, confidence: 0.9 }, label: null, object: null };
      frame.meta.notes.push('treated partnership as user purpose');
    }
  }
  // "with public contact" / "contact details" asks for ANY public channel. A
  // provider (or the deterministic "contact info" rule, recovered above) that
  // split it into email AND phone made the ask stricter than the words: a
  // channel the user never named is not required. Runs after the recovery
  // loop so both paths agree. "Without contact info" is no ask at all.
  const negatedContact = NEGATED_CONTACT.test(raw);
  // The words that remain once every negated contact phrase is removed.
  const named = negatedContact ? raw.replace(NEGATED_CONTACT_GLOBAL, ' ') : raw;
  const genericContact = named.match(GENERIC_CONTACT_ASK);
  if (genericContact || negatedContact) {
    // "all/full/every contact details" asks for every channel: keep them.
    const everyChannel = !!genericContact && /\b(?:all|every|full|complete)\s+(?:(?:their|the|public)\s+)?contacts?\b/i.test(named);
    const namesEmail = everyChannel || /\be-?mails?\b/i.test(named);
    const namesPhone = everyChannel || /\b(?:phones?|numbers?|mobiles?|tel(?:ephone)?s?|call(?:able)?)\b/i.test(named);
    const before = frame.required_fields.length;
    frame.required_fields = frame.required_fields.filter((item) =>
      !((valueOf(item) === 'email' && !namesEmail) || (valueOf(item) === 'phone' && !namesPhone) || (valueOf(item) === 'contact' && !genericContact)));
    if (frame.required_fields.length < before) {
      frame.meta.notes.push(negatedContact && !genericContact ? 'negated contact ask is not a requirement' : 'generic contact ask: dropped channels the user did not name');
    }
    if (genericContact && !frame.required_fields.some((item) => valueOf(item) === 'contact')) {
      frame.required_fields.push(openValue('contact', genericContact[0], 'contact', 0.9));
      frame.meta.notes.push('recovered requested field: contact');
    }
  }
  // A provider glues the scope word onto the place span ("worldwide building
  // fintech"): the prefix is a scope, never a location, and the words after it
  // are activity to re-read — not a town nobody named. The scope lands as
  // geo_scope; only a word that is structurally a sector becomes the industry.
  const gluedTail = (place: FrameLocation | null | undefined) => {
    const m = place ? /^(?:the\s+)?(?:world\s*-?\s*wide|globally|global|globe|world)\s+(?:the\s+)?(.+)$/i.exec(clean(place.value)) : null;
    return m ? clean(m[1]) : null;
  };
  const gluedMain = gluedTail(frame.location);
  const gluedList = frame.locations.filter((place) => gluedTail(place) !== null);
  if (gluedMain !== null || gluedList.length) {
    const tail = gluedMain ?? gluedTail(gluedList[0]!) ?? "";
    frame.locations = frame.locations.filter((place) => gluedTail(place) === null);
    if (gluedMain !== null) frame.location = frame.locations[0] ?? null;
    if (!frame.constraints.some((c) => c.field === 'geo_scope')) {
      frame.constraints.push({ field: 'geo_scope', operator: 'eq', value: 'worldwide', raw: null, confidence: 1, negated: false, unit: null });
    }
    const rest = tail.replace(/^(?:building|working|doing|developing|creating|focusing\s+on|operating|launching)\s+/i, '').trim();
    if (/^(?:[a-z]+tech|saas|ai|crypto|web3|blockchain|e-?commerce)$/i.test(rest) && !frame.target.industry) {
      frame.target.industry = openValue(rest.toLowerCase(), rest, null, 0.6);
      frame.meta.notes.push(`"${tail}" is the activity; the scope is worldwide`);
    } else if (rest) {
      frame.meta.notes.push(`"${tail}" follows a worldwide scope — kept as stated context, not a location`);
    }
    frame.meta.notes.push('worldwide wording is a search scope, not a place');
  }
  // "founders globally" / "worldwide" / "anywhere in the world" is a scope.
  // As a stated place it made every candidate fail a location nobody can be
  // in ("globally"), demoting valid leads to potential matches. Runs last so
  // a place recovered from the deterministic parse is normalized too.
  const everywhere = (place: FrameLocation | null | undefined) => !!place && WORLDWIDE_PLACE.test(clean(place.value));
  if (everywhere(frame.location) || frame.locations.some(everywhere)) {
    const raw = (everywhere(frame.location) ? frame.location : frame.locations.find(everywhere))!.raw ?? null;
    frame.locations = frame.locations.filter((place) => !everywhere(place));
    if (everywhere(frame.location)) frame.location = frame.locations[0] ?? null;
    if (!frame.constraints.some((c) => c.field === 'geo_scope')) {
      frame.constraints.push({ field: 'geo_scope', operator: 'eq', value: 'worldwide', raw, confidence: 1, negated: false, unit: null });
    }
    frame.meta.notes.push('worldwide wording is a search scope, not a place');
  }
  // Trade-service reconcile: "yo need 7 hvac guys gta sites + nums" — a TRADE
  // role combined with contact-proof requirements (phone/site) and no hiring
  // intent is a hunt for that trade's PROVIDERS, not its employees. The
  // discovered entities define the pipeline: re-type person → business with
  // the trade as category. Recruiting wording keeps the person reading.
  {
    const roleText = valueOf(frame.target.role ?? frame.target.job_title);
    const families = tradeFamiliesOf(roleText);
    const asksContactProof = frame.required_fields.some((f) =>
      /^(?:phone|website|site|contact|email)$/i.test(valueOf(f)),
    );
    // "sites" in the ask means company websites — a provider hunt even when
    // the wording reads like hiring ("need 7 hvac guys ... sites + nums").
    const siteAsk = /\b(?:sites?|websites?)\b/i.test(frame.input.raw) ||
      frame.required_fields.some((f) => /^(?:website|site)$/i.test(valueOf(f)));
    const recruiting =
      (["hiring", "seeking_work", "partnered_with"].includes(frame.relation.type.value) ||
        /\b(?:hire|hiring|recruit|vacanc)/i.test(frame.input.raw)) &&
      !siteAsk;
    if (
      frame.target.entity_type.value === "person" &&
      families.length > 0 &&
      asksContactProof &&
      !recruiting
    ) {
      const trade = families[0];
      frame.target.entity_type = {
        value: "business",
        raw: frame.target.role?.raw ?? roleText,
        confidence: 0.75,
      };
      if (!frame.target.category)
        frame.target.category = openValue(trade, roleText, trade, 0.8);
      frame.target.role = null;
      frame.target.job_title = null;
      frame.meta.notes.push(`trade-service reconcile: "${roleText}" + contact-proof ask → business/${trade}`);
    }
  }
  // A "no website" hunt contradicts a required website: "instagram-only
  // businesses are okay … dont make no website a reason to discard them" —
  // the ask wants businesses WITHOUT a proper site, so demanding a website
  // field would drop every qualifying lead. Contact channels that can exist
  // on an instagram-only business (phone, instagram, socials) stay required.
  if (frame.constraints.some((c) => c.field === 'opportunity' && c.value === 'no_website' && !c.negated)) {
    const before = frame.required_fields.length;
    frame.required_fields = frame.required_fields.filter((f) => !/^(?:website|site)$/i.test(valueOf(f)));
    if (frame.required_fields.length !== before) {
      frame.meta.notes.push('dropped required website/site — the ask hunts businesses without one');
    }
  }
  // "get linkedin website email whatever you can actually verify" — the
  // verifiability hedge ("whatever you can verify", "if possible") makes the
  // channel list an ANY-of enrichment wish, not an ALL-of gate: demanding
  // every channel dropped 5-6 of every 12 founder candidates for missing
  // whichever one they lacked. Hedged channels move to
  // enrichment_requirements (still hunted, no longer delivery-gating); a
  // plain enumeration ("give me email, phone, website and socials") stays
  // required per the established contract.
  {
    const CONTACT_CHANNEL = /^(?:e-?mails?(?:\s+address(?:es)?)?|phones?(?:\s+numbers?)?|websites?|sites?|linkedin|socials?|social\s+(?:media|profiles?|links?)|instagram|ig|contact(?:\s+(?:details?|info(?:rmation)?))?)$/i;
    const VERIFIABILITY_HEDGE = /\b(?:whatever\s+(?:you\s+)?(?:can\s+)?(?:actually\s+)?(?:verif\w*|works?|findable)|whatever\s+(?:is\s+)?available|if\s+possible|where\s+possible|when\s+possible)\b/i.test(frame.input.raw);
    if (VERIFIABILITY_HEDGE) {
      const channelRequirements = frame.required_fields.filter((f) => CONTACT_CHANNEL.test(valueOf(f)));
      if (channelRequirements.length) {
        frame.required_fields = frame.required_fields.filter((f) => !CONTACT_CHANNEL.test(valueOf(f)));
        for (const channel of channelRequirements) {
          if (!frame.enrichment_requirements.some((item) => valueOf(item) === valueOf(channel))) {
            frame.enrichment_requirements.push(channel);
          }
        }
        frame.meta.notes.push(
          `${channelRequirements.length} contact channels hedged ("whatever you can verify") — treated as enrichment targets, not delivery gates`,
        );
      }
    }
  }
  return syncClarification(frame);
}

/** The single entity-type → SpecEntity mapping (used by the full spec build
 *  AND the Stage-1 carry spec — one source, no second interpreter). */
export const entityFromFrame = (frame: UnderstandingFrame): SpecEntity => {
  const kind = frame.target.entity_type.value;
  if (kind === 'organization') return 'company';
  return ['person', 'company', 'business', 'investor', 'job'].includes(kind) ? kind as SpecEntity : 'unknown';
};
const entityOf = entityFromFrame;

/**
 * Minimal carry spec for Stage-1 rounds (clarify/confirm): enough for the
 * clarify UI to phrase its question (entity + known places) and to carry the
 * frame across the HTTP boundary. NOT the Stage-2 SearchSpec — that is built
 * by frameToSearchSpec after resolveStage says READY only (INV-5).
 */
export function lightSpecFromFrame(frame: UnderstandingFrame, status: SearchSpec['status']): SearchSpec {
  const places = (frame.locations.length ? frame.locations : frame.location ? [frame.location] : [])
    .filter((p) => p.scope !== 'remote');
  const spec = buildSpec({
    entity: entityFromFrame(frame),
    criteria: places.length
      ? [{ field: 'location', value: places[0]!.canonical ?? places[0]!.value, stated: true, confidence: places[0]!.confidence }]
      : [],
    raw_query: frame.input.raw,
    signal_required: false,
    signal_types: [],
    signal_recency: null,
    locationSuggestion: null,
  });
  spec.understanding = frame;
  spec.locations = places.map((p) => p.canonical ?? p.value);
  spec.status = status;
  return spec;
}

/** Convert the validated interpretation, with no second raw-query extractor. */
export function frameToSearchSpec(input: UnderstandingFrame): SearchSpec {
  const frame = normalizeSearchFrame(input);
  const entity = entityOf(frame);
  const criteria: SpecField[] = [];
  const put = (field: string, value: string | number | boolean | null | undefined, confidence = 1, stated = true) => {
    if (value == null || String(value).trim() === '') return;
    const next = { field, value: String(value), stated, confidence };
    const index = criteria.findIndex((c) => c.field === field);
    if (index < 0) criteria.push(next); else criteria[index] = next;
  };
  const descriptor = (field: string, value: OpenValue | null | undefined) => {
    if (value) put(field, valueOf(value), value.confidence, !!value.raw);
  };

  const role = frame.target.job_title ?? frame.target.role;
  const anyInvestorStage = /^(?:any|all|none|no preference|skip)$/i.test(frame.clarification.answered?.investor_stage ?? '');
  if (role) put('role', normalizeRole(valueOf(role)), role.confidence, !!role.raw);
  else if (entity === 'job' && frame.target.category) {
    put('role', normalizeRole(valueOf(frame.target.category).replace(/\b(?:remote|jobs?|positions?|openings?|roles?)\b/gi, '').trim()), frame.target.category.confidence);
  }
  const trade = frame.target.industry ?? frame.target.category ?? frame.target.business_type;
  if (trade) {
    if (entity === 'business') put('category', valueOf(trade), trade.confidence, !!trade.raw);
    else if (entity === 'investor') {
      if (frame.target.industry) put('investor_sector', valueOf(frame.target.industry), frame.target.industry.confidence, !!frame.target.industry.raw);
    } else put('industry', valueOf(trade), trade.confidence, !!trade.raw);
  }
  if (entity === 'investor') {
    if (!anyInvestorStage) descriptor('investor_stage', frame.target.company_stage);
  }
  else descriptor('company_stage', frame.target.company_stage);
  if (frame.target.technologies.length) put('technology', frame.target.technologies.map(valueOf).join(', '));
  const modelText = [frame.target.business_type, frame.target.category, frame.target.entity_subtype].map(valueOf).join(' ');
  if (/\b(?:d2c|direct.to.consumer)\b/i.test(modelText)) put('business_model', 'd2c');
  if (/\b(?:b2b|business.to.business)\b/i.test(modelText)) put('business_model', 'b2b');

  const places = frame.locations.length ? frame.locations : frame.location ? [frame.location] : [];
  const locationNames = places.filter((p) => p.scope !== 'remote').map((p) => p.canonical ?? p.value);
  let locationSuggestion: SearchSpec['locationSuggestion'] = null;
  if (locationNames.length) {
    const first = places[0]!;
    const geo = resolveCanonicalLocation(locationNames[0]!, { gazetteer: true, correctTypos: true, countryHint: first.country_code ?? null });
    if (geo?.resolution === 'provisional' && geo.name.toLowerCase() !== locationNames[0]!.toLowerCase()) {
      locationSuggestion = { typed: locationNames[0]!, suggestion: geo.name, confidence: geo.confidence };
    } else {
      put('location', geo?.name ?? locationNames[0], first.confidence, !!first.raw);
    }
    if (geo && !locationSuggestion) {
      put('location_id', geo.id);
      put('location_kind', geo.kind);
      if (geo.country_code) put('location_country', geo.country_code);
      if (geo.scope) put('location_scope', geo.scope);
      if (geo.parent_ids.length) put('location_parents', geo.parent_ids.join(','));
    }
  }
  if (frame.location?.scope === 'remote') {
    put('employment', 'remote');
    put('geo_scope', 'worldwide');
  }
  if (entity === 'job' && /\bremote\b/i.test(frame.target.category?.value ?? '')) {
    put('employment', 'remote');
    put('geo_scope', 'worldwide');
  }

  const relation = frame.relation.type.value;
  const object = valueOf(frame.relation.object);
  if (entity === 'investor' && relation === 'investing_in') {
    const sector = investorBeneficiarySector(object);
    if (!criteria.some((c) => c.field === 'investor_sector') && sector) {
      put('investor_sector', sector, frame.relation.object?.confidence ?? 1, !!frame.relation.object?.raw);
    }
    if (!anyInvestorStage && !criteria.some((c) => c.field === 'investor_stage')) {
      const categoryStage = investorStage(frame.target.category?.raw ?? '');
      if (categoryStage) put('investor_stage', categoryStage, frame.target.category?.confidence ?? 1, !!frame.target.category?.raw);
    }
  }
  if (relation === 'needs_service' || relation === 'asking_for_help') put('requested_service', object);
  if (relation === 'hiring') put('requested_role', object);
  if (relation === 'seeking_funding') put('funding_status', 'seeking');
  if (relation === 'has_asset' && /\b(?:website|site)\b/i.test(object)) {
    put('website', 'true');
    put('require_website', 'true');
  }
  if (relation === 'lacks_asset' && /\b(?:website|site)\b/i.test(object)) put('opportunity', 'no_website');
  const offer = valueOf(frame.user_context.selling?.service ?? frame.user_context.selling?.product);
  if (offer) { put('offer', offer); put('mode', 'selling'); }

  for (const constraint of frame.constraints) {
    const value = Array.isArray(constraint.value) ? constraint.value.join('|') : constraint.value;
    if (constraint.field === 'website' && constraint.operator === 'exists') {
      if (constraint.negated) put('opportunity', 'no_website');
      else {
        put('website', 'true');
        put('require_website', 'true');
      }
      continue;
    }
    if (constraint.negated || constraint.operator === 'neq') {
      put(`exclude_${constraint.field}`, value);
      continue;
    }
    if (constraint.field === 'work_mode') { put('employment', value); continue; }
    if (entity === 'investor' && constraint.field === 'company_stage') {
      if (!anyInvestorStage) put('investor_stage', value, constraint.confidence, !!constraint.raw);
      continue;
    }
    if (entity === 'job' && ['price', 'salary', 'annual_salary'].includes(constraint.field) && ['gte', 'gt', 'eq'].includes(constraint.operator)) {
      put('salary_min', value); continue;
    }
    if (constraint.field === 'content_topic') { put('content_topic', value); put('needs_live', 'true'); continue; }
    put(constraint.field, value, constraint.confidence, !!constraint.raw);
  }
  if (frame.temporal?.relation === 'within_last' && frame.temporal.window) put('needs_live', 'true');
  if (frame.verification.some((v) => /last social post|recent social|last posted/i.test(v.label ?? '') || /last posted|last social post/i.test(v.raw ?? ''))) {
    put('needs_live', 'true');
    put('verify_last_social_post', 'true');
  }

  const requestedFields = [...new Set(frame.required_fields.map(valueOf))];
  for (const field of requestedFields) {
    put(`require_${field}`, 'true');
    criteria.push({ field: 'required_field', value: field, stated: true, confidence: 1 });
  }
  for (const field of frame.preferred_fields.map(valueOf)) put(`prefer_${field}`, 'true');
  for (const item of frame.verification) put(`verify_${item.kind}`, item.label ?? 'true');
  for (const item of frame.output) put(`output_${item.kind}`, item.label ?? 'true');
  if (frame.quantity?.requested) put('requested_count', frame.quantity.requested);
  if (frame.quantity?.minimum) put('minimum_count', frame.quantity.minimum);

  const signalRequired = frame.evidence.intent_signal_required ||
    ['hiring', 'received_funding', 'seeking_funding', 'needs_service', 'asking_for_help', 'custom'].includes(relation);
  const signalTypes = signalRequired ? [['received_funding', 'seeking_funding', 'investing_in'].includes(relation) ? 'funding' : relation === 'hiring' ? 'hiring' : 'service_request'] : [];
  const purpose = purposeFromFrame(frame);
  const spec = buildSpec({ entity, criteria, raw_query: stripUrlsFromText(frame.input.raw), signal_required: signalRequired, signal_types: signalTypes,
    signal_recency: frame.temporal?.window ?? null, locationSuggestion });
  spec.understanding = frame;
  spec.locations = locationNames;
  spec.unresolved = frame.unresolved;
  spec.purpose = purpose;
  spec.requested_fields = requestedFields;
  for (const item of frame.unresolved) if (!spec.missing.includes(item.field)) spec.missing.push(item.field);
  if (locationSuggestion && !spec.missing.includes('location')) spec.missing.push('location');
  if (spec.missing.length) spec.status = 'needs_clarification';
  return spec;
}

/** Apply a dialog answer to the prior frame, without extracting the original request again. */

/**
 * E2E-C3: an answer closes the question it answered — recorded in the frame's
 * clarification block so the state machine (which seeds from it) never asks
 * the same field again, even when the answer's axis differs from the blocker's
 * preferred one (a location answering a where-or-what-kind scope question).
 */
function markAnswered(frame: UnderstandingFrame, field: string, answer: string): void {
  const block = frame.clarification;
  block.answered = { ...(block.answered ?? {}), [field]: answer.slice(0, 300) };
  if (!block.asked?.includes(field)) block.asked = [...(block.asked ?? []), field];
}

export function applyClarificationToFrame(input: UnderstandingFrame, answers: Record<string, string>): UnderstandingFrame {
  let frame = structuredClone(input);
  for (const [key, rawAnswer] of Object.entries(answers)) {
    const answer = rawAnswer.trim();
    if (!answer) continue;
    // Confirm marker: the user accepted (or edited) the externally derived
    // context. Minimal monotonic state — the confirm gate never re-fires.
    if (key === 'confirm') {
      frame.confirmation = { resolved: true };
      frame.meta.notes = [...frame.meta.notes, 'confirm: user accepted derived context'].slice(-20);
      continue;
    }
    const canonical = key === 'entity' ? 'target.entity_type' : key === 'entity_scope' ? 'target.scope' : key === 'entity_relation' ? 'relation.type' : key;
    if (['target.entity_type', 'target.scope', 'relation.type', 'relation.object', 'relation.direction'].includes(canonical)) {
      frame = patchFrame(initState(frame), canonical as BlockingField, answer).state.frame;
      continue;
    }
    if (canonical === 'purpose' || canonical === 'mode') {
      const purpose = /\b(?:sell|selling|prospect(?:ing)?|outreach)\b/i.test(answer) ? 'prospecting' : /\b(?:recruit|hire)\b/i.test(answer) ? 'recruiting' : /\bpartner\b/i.test(answer) ? 'partnership' : 'research';
      frame.user_context.objective = openValue(purpose, answer, purpose, 1);
      markAnswered(frame, 'user_context.objective', answer);
      continue;
    }
    if (canonical === 'geo_scope' || /^(worldwide|global|globally|everywhere|anywhere|international)$/i.test(answer)) {
      // The panel's Global/Worldwide choice arrives as geo_scope=worldwide
      // (or a bare worldwide answer): record the where-axis as answered and
      // carry the scope as a constraint, never as a fabricated place.
      frame.constraints = frame.constraints.filter((c) => c.field !== 'geo_scope');
      frame.constraints.push({ field: 'geo_scope', operator: 'eq', value: 'worldwide', raw: answer, confidence: 1, negated: false, unit: null });
      markAnswered(frame, 'target.scope', answer);
      continue;
    }
    if (canonical === 'location') {
      const geo = resolveCanonicalLocation(answer, { gazetteer: true, correctTypos: true });
      const location: FrameLocation = { value: geo?.name ?? answer, raw: answer, scope: 'in', radius: null, radius_unit: null,
        country_code: geo?.country_code ?? null, canonical: geo?.resolution === 'resolved' ? geo.name : null, confidence: 1 };
      frame.location = location;
      frame.locations = [location];
      markAnswered(frame, 'target.scope', answer);
      continue;
    }
    if (canonical === 'category' || canonical === 'industry' || canonical === 'investor_sector' || canonical === 'role') {
      const targetField = canonical === 'investor_sector' ? 'industry' : canonical;
      frame.target[targetField] = openValue(answer, answer, null, 1);
      // A kind answer closes the what-axis of the scope question.
      markAnswered(frame, 'target.scope', answer);
      continue;
    }
    if (canonical === 'offer') {
      frame.user_context.selling ??= { service: null, product: null };
      frame.user_context.selling.service = openValue(answer, answer, null, 1);
      frame.user_context.objective ??= openValue('prospecting', answer, 'prospecting', 1);
      markAnswered(frame, 'user_context.objective', answer);
      continue;
    }
    // Any other named slot (investor_stage, investor_check, opportunity, site,
    // channel, …) is an optional refinement: record it so nothing re-asks it,
    // then let the amount branch handle numeric fields.
    if (!['salary_min', 'revenue', 'employee_count', 'amount'].includes(canonical.replace(/^unresolved\./, ''))) {
      markAnswered(frame, canonical.replace(/^unresolved\./, ''), answer);
    }
    const field = canonical.replace(/^unresolved\./, '');
    if (field === 'investor_stage' || field === 'investor_check') {
      frame.constraints = frame.constraints.filter((c) => c.field !== field);
      frame.unresolved = frame.unresolved.filter((u) => u.field !== field);
      if (/^(?:any|all|none|no preference|skip)$/i.test(answer)) continue;
      frame.constraints.push({ field, operator: 'eq', value: answer, unit: null, negated: false, raw: answer, confidence: 1 });
      continue;
    }
    if (frame.unresolved.some((u) => u.field === field) || ['salary_min', 'revenue', 'employee_count', 'amount'].includes(field)) {
      const short = /(-?\d+(?:\.\d+)?)\s*([kmb])\b/i.exec(answer.replace(/,/g, ''));
      const amount = short ? Number(short[1]) * ({ k: 1_000, m: 1_000_000, b: 1_000_000_000 }[short[2].toLowerCase() as 'k' | 'm' | 'b']) : Number(answer.replace(/[^\d.]/g, ''));
      if (Number.isFinite(amount) && amount > 0) {
        frame.constraints = frame.constraints.filter((c) => c.field !== field);
        frame.constraints.push({ field, operator: 'gte', value: amount, unit: null, negated: false, raw: answer, confidence: 1 });
        frame.unresolved = frame.unresolved.filter((u) => u.field !== field);
      }
    }
  }
  return syncClarification(frame);
}

/** A known target with usable scope can search without optional sales coaching. */
export function isActionableFrame(spec: SearchSpec): boolean {
  const frame = spec.understanding;
  if (!frame || frame.clarification.needed || frame.compound.is_compound || spec.missing.length || spec.locationSuggestion) return false;
  return !!(frame.target.role || frame.target.job_title || frame.target.industry || frame.target.category || frame.target.business_type || frame.relation.object);
}

/** Server extraction is bounded; provider failure returns the deterministic frame.
 *  Returns the FRAME only — frameToSearchSpec runs after the Stage-1 decision
 *  says ready (INV-5: SearchSpec never feeds the Stage-1 decision). */
export async function understandFrame(
  query: string,
  context: Record<string, string>,
  signal?: AbortSignal | null,
  resolvedContext?: import('./input-envelope').ResolvedInputContext | null,
): Promise<UnderstandingFrame> {
  if (process.env.VITEST) return applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, context);
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
    const extraction = import('./extract.server')
      .then(({ extractFrameLLM }) => extractFrameLLM(query, { context, waitForSlotMs: 250, resolvedContext }))
      .then((result) => result.frame).catch(() => fallback('Understanding provider failed; deterministic fallback used.'));
    return applyClarificationToFrame(validateFrame(await Promise.race([extraction, bounded])).frame, context);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

/** Compat wrapper: full spec build for callers outside the Stage-1 core path. */
export async function understandSearchSpec(query: string, context: Record<string, string>, signal?: AbortSignal | null): Promise<SearchSpec> {
  return frameToSearchSpec(await understandFrame(query, context, signal));
}
