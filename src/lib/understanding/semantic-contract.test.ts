import { describe, expect, it } from 'vitest';
import { extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import { applyClarificationToFrame, frameToSearchSpec } from './to-search-spec';

const read = (query: string) => {
  const frame = validateFrame(extractFrameDeterministic(query)).frame;
  return { frame, spec: frameToSearchSpec(frame) };
};
const field = (query: string, name: string) => read(query).spec.criteria.find((c) => c.field === name)?.value;

describe('canonical semantic contract', () => {
  it('separates formatted salary from result count', () => {
    const { frame, spec } = read('Find remote startup jobs using React and TypeScript paying at least $120,000 per year');
    expect(frame.quantity?.requested ?? null).toBeNull();
    expect(spec.criteria.find((c) => c.field === 'salary_min')?.value).toBe('120000');
    expect(spec.criteria.find((c) => c.field === 'technology')?.value).toContain('React');
    expect(spec.criteria.find((c) => c.field === 'employment')?.value).toBe('remote');
    expect(read('Find 25 plumbers in Austin').frame.quantity?.requested).toBe(25);
  });

  it('understands colloquial brands and uncommon or corrected places', () => {
    const brand = read('D2C skincare guys around Dhaka who posted recently');
    expect(brand.frame.target.entity_type.value).toBe('company');
    expect(brand.frame.target.industry?.value).toContain('skincare');
    expect(read('Camrose Alberta businesses with no website').frame.location?.value).toContain('Camrose');
    expect(read('cafes in Bandar Seri Begawan wait no make that Muscat, with websites').spec.criteria.find((c) => c.field === 'location')?.value).toBe('Muscat');
    expect(read('investors across Southeast Asia actively writing checks').frame.location?.value.toLowerCase()).toContain('southeast asia');
    const typo = read('companies in fyetteville needing voiceover').spec;
    expect(typo.criteria.find((c) => c.field === 'location')?.value).toBe('fyetteville');
  });

  it('preserves OR geography as one target and two executable locations', () => {
    for (const [query, expected] of [
      ['D2C brands in Chattogram or Dhaka, not agencies', ['Chattogram', 'Dhaka']],
      ['heads of growth in Cluj-Napoca or Tbilisi', ['Cluj-Napoca', 'Tbilisi']],
    ] as const) {
      const { frame, spec } = read(query);
      expect(frame.compound.is_compound).toBe(false);
      expect(spec.locations).toEqual(expected);
      expect(spec.criteria.find((c) => c.field === 'location')?.value).toBe(expected[0]);
    }
  });

  it('keeps negation negative', () => {
    expect(field('D2C brands in Dhaka, not agencies', 'exclude_category')).toBe('agency');
    expect(field('firms in Kigali, exclude staffing agencies', 'exclude_category')).toBe('staffing agency');
    const funded = read('founders in Medellín raising seed, NOT already funded');
    expect(funded.spec.criteria.find((c) => c.field === 'exclude_funding_status')?.value).toBe('funded');
    expect(funded.spec.criteria.find((c) => c.field === 'funding_status')?.value).toBe('seeking');
  });

  it('blocks explicit missing values and accepts an answer in the prior frame', () => {
    const jobs = read('remote React jobs paying this much');
    expect(jobs.frame.location?.value).not.toBe('paying');
    expect(jobs.spec.missing).toContain('salary_min');
    const answered = frameToSearchSpec(applyClarificationToFrame(jobs.frame, { salary_min: '$120,000' }));
    expect(answered.missing).not.toContain('salary_min');
    expect(answered.criteria.find((c) => c.field === 'salary_min')?.value).toBe('120000');
    expect(read('companies around Pune, around this size').spec.missing).toContain('employee_count');
  });

  it('distinguishes website service demand from website absence', () => {
    const service = read('find plumbers in Austin that need website services').spec;
    expect(service.criteria.find((c) => c.field === 'requested_service')?.value).toMatch(/website/);
    expect(service.criteria.find((c) => c.field === 'opportunity')).toBeUndefined();
    expect(read('find plumbers in Austin with no website').spec.criteria.find((c) => c.field === 'opportunity')?.value).toBe('no_website');
  });

  it('preserves output fields, recent social checks and stated purpose', () => {
    const requested = read('D2C brands in Dhaka; give me email, phone, website and socials; check when they last posted').spec;
    for (const name of ['email', 'phone', 'website', 'socials']) {
      expect(requested.criteria.find((c) => c.field === `require_${name}`)?.value).toBe('true');
    }
    expect(requested.criteria.find((c) => c.field === 'needs_live')?.value).toBe('true');
    expect(read('find plumbers in Austin').spec.purpose).toBeNull();
    expect(read('find plumbers in Austin that need website services').spec.purpose).toBe('prospecting');
    expect(read('research only: restaurants in Lusaka with websites, no outreach').spec.purpose).toBe('research');
  });

  it('merges a follow-up without reinterpreting the original request', () => {
    const first = read('find businesses that need websites').frame;
    const continued = frameToSearchSpec(applyClarificationToFrame(first, { location: 'Alberta', purpose: 'prospecting' }));
    expect(continued.criteria.find((c) => c.field === 'location')?.value).toBe('Alberta');
    expect(continued.criteria.find((c) => c.field === 'requested_service')?.value).toMatch(/website/);
    expect(continued.criteria.find((c) => c.field === 'opportunity')).toBeUndefined();
    expect(continued.purpose).toBe('prospecting');
  });
});
