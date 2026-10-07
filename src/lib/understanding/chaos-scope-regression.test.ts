import { afterEach, describe, expect, it } from 'vitest';
import { extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import { frameToSearchSpec, normalizeSearchFrame } from './to-search-spec';
import { openValue } from './frame';
import { registerCityGazetteer, splitMultiPlace } from '../search/location-resolver';

function read(raw: string, provider = false) {
  const frame = validateFrame(extractFrameDeterministic(raw)).frame;
  if (provider) frame.meta.extractor = 'llm';
  return frame;
}

describe('chaos scope boundaries', () => {
  afterEach(() => registerCityGazetteer(null));
  it.each([
    'Find dentists in Canada; must have verified email; phone if possible',
    'Find accountants in Ireland, email mandatory and phone where possible',
    'Find architects in Japan; email required; include phone if possible',
    'Find engineers in Singapore; email required and phone if possible',
  ])('preserves mandatory channels beside a soft channel: %s', (raw) => {
    for (const provider of [false, true]) {
      const frame = read(raw, provider);
      // A realistic provider can mark both channels required despite the hedge.
      if (provider) frame.required_fields = [openValue('email', raw), openValue('phone', raw)];
      const normalized = normalizeSearchFrame(validateFrame(frame).frame);
      expect(normalized.required_fields.map(f => f.value)).toContain('email');
      expect(normalized.required_fields.map(f => f.value)).not.toContain('phone');
    }
  });

  it.each([
    ['Find businesses in Canada, exclude US', 'Canada'],
    ['Find founders in Canada building products for UK clients', 'Canada'],
    ['Find architects in Ireland serving clients in Japan', 'Ireland'],
    ['Find founders in Canada with UK clients', 'Canada'],
    ['Find companies in Singapore exclude US', 'Singapore'],
  ])('does not promote non-target places: %s', (raw, place) => {
    for (const provider of [false, true]) {
      const frame = read(raw, provider);
      if (provider) {
        frame.location = { value: place, canonical: place, raw: `in ${place}`, scope: 'in', radius: null, radius_unit: null, country_code: null, confidence: .9 };
        frame.locations = [];
      }
      expect(frameToSearchSpec(frame).locations).toEqual([place]);
    }
  });

  it('keeps an ambiguous gazetteer city unresolved in a list', () => {
    registerCityGazetteer({ lookup: name => name.toLowerCase() === 'riverton' ? [{ name: 'Riverton', iso2: 'US' }, { name: 'Riverton', iso2: 'NZ' }] : [], fuzzy: () => null });
    expect(splitMultiPlace('Riverton and Ireland')).toBeNull();
  });

  it.each(['Email', 'email address'])('keeps mandatory provider channel aliases: %s', alias => {
    const raw = 'Find dentists in Canada; email required and phone if possible';
    const frame = read(raw, true);
    frame.required_fields = [openValue(alias, raw), openValue('phone number', raw)];
    const spec = frameToSearchSpec(validateFrame(frame).frame);
    expect(spec.requested_fields).toContain('email');
    expect(spec.requested_fields).not.toContain('phone');
  });

  it('uses the retained full location span when another source names the same country', () => {
    const raw = 'Our client in Canada wants founders in Canada and UK';
    const frame = read(raw, true);
    frame.location = { value: 'Canada', canonical: 'Canada', raw: 'in Canada and UK', scope: 'in', radius: null, radius_unit: null, country_code: 'CA', confidence: .9 };
    frame.locations = [];
    expect(frameToSearchSpec(frame).locations).toEqual(['Canada', 'UK']);
  });

  it.each([
    'Find founders and owners in UK + Ireland; get linkedin website email whatever you can actually verify',
    'Find dentists in Canada and Japan; include email and phone whatever is available',
    'Find architects around Dubai Singapore Sydney maybe Toronto too; get website email whatever you can verify',
  ])('retains positive lists and channel enrichment: %s', (raw) => {
    const frame = read(raw, true);
    if (raw.includes('UK + Ireland')) frame.location = { value: 'UK', canonical: 'UK', raw: 'in UK', scope: 'in', radius: null, radius_unit: null, country_code: 'GB', confidence: .9 };
    const normalized = normalizeSearchFrame(frame);
    expect(frameToSearchSpec(frame).locations.length).toBeGreaterThanOrEqual(2);
    expect(normalized.required_fields.some(f => ['email', 'phone', 'website', 'linkedin'].includes(f.value))).toBe(false);
    expect([...normalized.preferred_fields, ...normalized.enrichment_requirements].some(f => f.value === 'email')).toBe(true);
  });
});
