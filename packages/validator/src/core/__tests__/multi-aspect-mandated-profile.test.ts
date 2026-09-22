import { describe, expect, it, vi } from 'vitest';
import { appendMandatedProfileValidationResults } from '../multi-aspect-mandated-profile.js';
import type { AspectResult, MultiAspectValidateResult } from '../multi-aspect-types.js';

const systolicObservation = {
  resourceType: 'Observation',
  status: 'final',
  meta: { profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
  code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
  valueQuantity: { value: 133, unit: 'mm[Hg]', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
};

function aspect(issues: AspectResult['issues']): AspectResult {
  return { aspect: 'structural', issues, validationTime: 0, isValid: issues.length === 0 };
}

describe('mandated profile validation', () => {
  it('preserves governed warnings and suppressed evidence without reapplying policy', async () => {
    const warning = { severity: 'warning' as const, rawSeverity: 'error' as const,
      code: 'structural-cardinality-min', path: 'Observation.component', message: 'Missing components',
      aspect: 'structural' as const };
    const suppressed = { ...warning, path: 'Observation.category', disposition: 'suppressed' as const };
    const collected: AspectResult[] = [{ ...aspect([]), evidenceIssues: [] }];
    const containing = { resourceType: 'Patient' };
    const validate = vi.fn(async () => ({ isValid: true, aspects: [{
      ...aspect([warning]), isValid: true, evidenceIssues: [warning, suppressed],
    }] }));

    await appendMandatedProfileValidationResults(systolicObservation, 'urn:declared', 'R4', 0,
      validate, collected, undefined, undefined, containing);

    expect(collected[0].issues).toMatchObject([{ severity: 'warning', rawSeverity: 'error' }]);
    expect(collected[0].evidenceIssues).toMatchObject([warning, suppressed]);
    expect(collected[0].isValid).toBe(true);
    expect(validate).toHaveBeenCalledWith(systolicObservation,
      'http://hl7.org/fhir/StructureDefinition/bp', 'R4', 1, undefined, true, containing);
  });

  it('keeps an audit-only finding when the mandated result was suppressed', async () => {
    const suppressed = { severity: 'error' as const, rawSeverity: 'error' as const,
      code: 'structural-cardinality-min', path: 'Observation.component', message: 'Missing components',
      aspect: 'structural' as const, disposition: 'suppressed' as const };
    const collected: AspectResult[] = [];
    await appendMandatedProfileValidationResults(systolicObservation, 'urn:declared', 'R4', 0,
      async () => ({ isValid: true, aspects: [{ ...aspect([]), evidenceIssues: [suppressed] }] }),
      collected, undefined, undefined);
    expect(collected[0].issues).toEqual([]);
    expect(collected[0].evidenceIssues).toMatchObject([suppressed]);
    expect(collected[0].isValid).toBe(true);
  });

  it('does not turn a failed mandated-profile evaluation into successful validation', async () => {
    const failure = new Error('validator unavailable');
    await expect(appendMandatedProfileValidationResults(systolicObservation, 'urn:declared', 'R4', 0,
      async () => { throw failure; }, [], undefined, undefined)).rejects.toBe(failure);
  });

  it('validates a vital-sign Observation against the profile its code mandates', async () => {
    const seen: string[] = [];
    const collected: AspectResult[] = [aspect([])];
    await appendMandatedProfileValidationResults(
      systolicObservation,
      'http://hl7.org/fhir/StructureDefinition/vitalsigns',
      'R4',
      0,
      async (_resource, profileUrl) => {
        seen.push(profileUrl);
        return {
          isValid: false,
          aspects: [aspect([{
            severity: 'error', code: 'structural-cardinality-min', path: 'Observation.component',
            message: 'Element Observation.component has too few values: expected at least 2, found 0',
            aspect: 'structural',
          } as never])],
        } as MultiAspectValidateResult;
      },
      collected,
      undefined,
      undefined,
    );
    expect(seen).toEqual(['http://hl7.org/fhir/StructureDefinition/bp']);
    expect(collected[0].issues.map(issue => issue.code)).toEqual(['structural-cardinality-min']);
    expect(collected[0].isValid).toBe(false);
  });

  it('does not run a second pass when the applied profile is the mandated one', async () => {
    const seen: string[] = [];
    await appendMandatedProfileValidationResults(
      systolicObservation,
      'http://hl7.org/fhir/StructureDefinition/bp|4.0.1',
      'R4',
      0,
      async (_resource, profileUrl) => {
        seen.push(profileUrl);
        return { isValid: true, aspects: [] } as MultiAspectValidateResult;
      },
      [],
      undefined,
      undefined,
    );
    expect(seen).toEqual([]);
  });

  it('keeps a finding the declared pass already made out of the merge', async () => {
    const duplicate = {
      severity: 'error', code: 'terminology-code-invalid', path: 'Observation.valueQuantity.code',
      message: "Invalid UCUM code 'x'", aspect: 'terminology',
    } as never;
    const collected: AspectResult[] = [aspect([duplicate])];
    await appendMandatedProfileValidationResults(
      systolicObservation,
      'http://hl7.org/fhir/StructureDefinition/vitalsigns',
      'R4',
      0,
      async () => ({ isValid: false, aspects: [aspect([duplicate])] }) as MultiAspectValidateResult,
      collected,
      undefined,
      undefined,
    );
    expect(collected[0].issues).toHaveLength(1);
  });
});
