import fhirpath from 'fhirpath';
import { describe, expect, it } from 'vitest';
import { getFhirPathModel } from '../fhirpath-context';

const compare = (authoredOn: string, lastModified: string) => fhirpath.evaluate(
  { resourceType: 'Task', status: 'draft', intent: 'order', authoredOn, lastModified },
  'lastModified >= authoredOn',
  undefined,
  getFhirPathModel('R4'),
);

describe('FHIRPath fractional seconds', () => {
  it('compares microsecond timestamps by their instant, not their digit count', () => {
    expect(compare('2026-09-23T02:13:58.566000+00:00', '2026-09-23T02:14:00.365000+00:00')).toEqual([true]);
    expect(compare('2026-09-23T02:14:00.365000+00:00', '2026-09-23T02:13:58.566000+00:00')).toEqual([false]);
  });

  it('keeps millisecond comparisons unchanged', () => {
    expect(compare('2026-09-23T02:13:58.566+00:00', '2026-09-23T02:13:58.567+00:00')).toEqual([true]);
    expect(compare('2026-09-23T02:13:58.567+00:00', '2026-09-23T02:13:58.566+00:00')).toEqual([false]);
  });

  it('applies to time values as well', () => {
    expect(fhirpath.evaluate({}, "@T10:00:00.123456 < @T10:00:01.1", undefined, getFhirPathModel('R4'))).toEqual([true]);
  });
});
