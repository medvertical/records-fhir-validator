import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordsValidator } from '../validator-engine.js';
import { createIsolatedCoreValidationFixture, expectOwnCoreProfilesResolved } from './isolated-core-validation-fixture.js';

/**
 * Every primitive in the resource tree must reach format validation, the
 * year-plausibility lint, and the string-whitespace lint — including
 * top-level primitives of standalone resources and resources embedded in
 * Parameters.parameter[].resource (mutation-testing blind spot).
 */
describe('primitive tree coverage', () => {
  let validator: RecordsValidator;
  let fixture: Awaited<ReturnType<typeof createIsolatedCoreValidationFixture>>;

  afterAll(async () => { await fixture?.dispose(); });

  beforeAll(async () => {
    fixture = await createIsolatedCoreValidationFixture({ enableCaching: true, strictMode: false });
    validator = fixture.validator;
  }, 120_000);

  it('warns on an implausible year in a standalone Patient.birthDate', async () => {
    const issues = await validator.validate(
      { resourceType: 'Patient', id: 'p1', birthDate: '2140-01-01' },
      'http://hl7.org/fhir/StructureDefinition/Patient',
      'R4',
    );

    expectOwnCoreProfilesResolved(issues);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'date-year-implausible',
        severity: 'warning',
        path: 'Patient.birthDate',
      }),
    ]));
  }, 120_000);

  it('reports a format error for a leading-space dateTime in a choice element', async () => {
    const issues = await validator.validate(
      {
        resourceType: 'DiagnosticReport',
        id: 'd1',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '58410-2' }] },
        effectiveDateTime: ' 2013-04-02T09:30:10+01:00',
      },
      'http://hl7.org/fhir/StructureDefinition/DiagnosticReport',
      'R4',
    );

    expectOwnCoreProfilesResolved(issues);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'structural-invalid-format',
        severity: 'error',
        path: 'DiagnosticReport.effectiveDateTime',
      }),
    ]));
  }, 120_000);

  it('warns on whitespace padding in a top-level Organization.name', async () => {
    const issues = await validator.validate(
      { resourceType: 'Organization', id: 'o1', name: ' Sana Klinikum ', active: true },
      'http://hl7.org/fhir/StructureDefinition/Organization',
      'R4',
    );

    expectOwnCoreProfilesResolved(issues);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'string-whitespace-padding',
        severity: 'warning',
        path: 'Organization.name',
      }),
    ]));
  }, 120_000);

  const memberMatchParameters = {
    resourceType: 'Parameters',
    id: 'member-match',
    parameter: [{
      name: 'MemberPatient',
      resource: {
        resourceType: 'Patient',
        id: 'p1',
        gender: 'female',
        birthDate: '2140-12-25',
      },
    }],
  };

  it('validates resources embedded in Parameters.parameter[].resource', async () => {
    const issues = await validator.validate(
      memberMatchParameters,
      'http://hl7.org/fhir/StructureDefinition/Parameters',
      'R4',
    );

    expectOwnCoreProfilesResolved(issues);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'date-year-implausible',
        severity: 'warning',
        path: 'Parameters.parameter[0].resource.birthDate',
        resourceType: 'Parameters',
      }),
    ]));
    expect(issues.some(issue =>
      issue.code === 'missing-meta'
      && issue.path?.startsWith('Parameters.parameter[0]')
    )).toBe(false);
  }, 120_000);

  it('runs the same Parameters recursion in the multi-aspect batch path', async () => {
    const resultMap = await validator.validateBatch([memberMatchParameters], {
      fhirVersion: 'R4',
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/Parameters',
      maxConcurrency: 1,
      aspects: ['structural', 'profile', 'reference', 'metadata'],
      settings: { validationStrictness: 'standard', aspects: {} },
    });
    const result = resultMap.get(memberMatchParameters) as {
      aspects: Array<{ aspect: string; issues: Array<{ code?: string; path?: string }> }>;
    };
    const issues = result.aspects.flatMap(aspect => aspect.issues);

    expectOwnCoreProfilesResolved(issues);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'date-year-implausible',
        path: 'Parameters.parameter[0].resource.birthDate',
      }),
    ]));
    expect(issues.some(issue =>
      issue.code === 'missing-meta'
      && issue.path?.startsWith('Parameters.parameter[0]')
    )).toBe(false);
  }, 120_000);
});
