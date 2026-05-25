import { describe, expect, it, vi } from 'vitest';
import { ComplexTypeValidator } from '../complex-type-validator';

describe('ComplexTypeValidator Period per-1', () => {
  const sdLoader = {
    loadProfile: vi.fn().mockResolvedValue(null),
  } as any;

  it('compares dateTime periods by instant so DST offsets do not look backwards', async () => {
    const validator = new ComplexTypeValidator(sdLoader);

    const issues = await validator.validateComplexTypeSubElements(
      {
        start: '2022-11-06T01:52:06-04:00',
        end: '2022-11-06T01:07:06-05:00',
      },
      {
        id: 'Encounter.period',
        path: 'Encounter.period',
        type: [{ code: 'Period' }],
      },
      'Encounter.period',
      'http://hl7.org/fhir/StructureDefinition/Encounter',
    );

    expect(issues.some(issue => issue.code === 'business-invalid-period-end')).toBe(false);
  });

  it('still reports truly backwards dateTime periods', async () => {
    const validator = new ComplexTypeValidator(sdLoader);

    const issues = await validator.validateComplexTypeSubElements(
      {
        start: '2022-11-06T01:52:06-05:00',
        end: '2022-11-06T01:07:06-05:00',
      },
      {
        id: 'Encounter.period',
        path: 'Encounter.period',
        type: [{ code: 'Period' }],
      },
      'Encounter.period',
      'http://hl7.org/fhir/StructureDefinition/Encounter',
    );

    expect(issues.some(issue => issue.code === 'business-invalid-period-end')).toBe(true);
  });
});
