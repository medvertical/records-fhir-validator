import { describe, expect, it } from 'vitest';
import { TerminologyResolutionSchema } from '../settings-terminology-schema.js';

describe('default CodeSystem edition settings', () => {
  const parse = (defaultCodeSystemVersions: unknown) => TerminologyResolutionSchema.safeParse({
    strategy: 'local-only', defaultCodeSystemVersions,
  });

  it('keeps defaults opt-in and preserves exact edition values', () => {
    expect(TerminologyResolutionSchema.parse({ strategy: 'local-only' }).defaultCodeSystemVersions).toBeUndefined();
    const editions = { 'http://snomed.info/sct': 'http://snomed.info/sct/900000000000207008/version/20250201' };
    const parsed = parse(editions);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.defaultCodeSystemVersions).toEqual(editions);
  });

  it.each([
    { '': '1' }, { '__proto__': '1', bad: '1' }, { 'not-a-canonical': '1' },
    { 'http://snomed.info/sct|1': '1' }, { 'http://snomed.info/sct': '' },
    { 'http://snomed.info/sct': ' 1' }, { 'http://snomed.info/sct': '1|2' },
    { 'http://snomed.info/sct': 1 }, { 'http://snomed.info/sct': '1'.repeat(513) },
  ])('rejects malformed canonical/version pins %#', editions => {
    expect(parse(editions).success).toBe(false);
  });

  it('bounds the configured authority map', () => {
    const editions = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`urn:system:${index}`, '1']));
    expect(parse(editions).success).toBe(false);
  });
});
