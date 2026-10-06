import { describe, expect, it } from 'vitest';
import { BatchedReferenceChecker } from '../batched-reference-checker';
import { extractReferences, validateReferenceFormat } from '../reference-format-validator';
import { parseReference } from '../reference-type-extractor';
import {
  getReferenceTypeConstraintValidator,
  REFERENCE_TYPE_CONSTRAINTS,
  ReferenceTypeConstraintValidator,
} from '../reference-type-constraint-validator';

describe('Reference parsing', () => {
  it('preserves a typed diagnostic for invalid references', () => {
    expect(parseReference('patient/1')).toMatchObject({
      isValid: false,
      referenceType: 'invalid',
      metadata: {
        error: 'Resource type must start with uppercase letter',
      },
    });
  });

  it('accepts a bare contained back-reference to the containing resource', () => {
    expect(validateReferenceFormat('#')).toMatchObject({
      isValid: true,
      referenceType: 'contained',
      resourceId: '',
      issues: [],
    });
  });

  it.each([
    ['urn:', 'error'],
    ['urn:uuid:not-a-uuid', 'warning'],
  ] as const)('rejects malformed logical references %s', (reference, severity) => {
    const result = validateReferenceFormat(reference);

    expect(result).toMatchObject({
      isValid: false,
      referenceType: 'logical',
    });
    expect(result.issues[0]).toMatchObject({
      code: 'reference-invalid-format',
      severity,
    });
  });

  it('does not infer a FHIR resource type from an opaque absolute URL', () => {
    expect(validateReferenceFormat('https://example.org/baseR4Patient/id')).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: undefined,
    });
  });

  it('creates deterministic issue IDs for identical standalone findings', () => {
    const first = validateReferenceFormat('Patient/').issues[0];
    const second = validateReferenceFormat('Patient/').issues[0];

    expect(first.id).toBe(second.id);
  });

  it('handles non-string reference inputs without throwing', () => {
    expect(validateReferenceFormat(Symbol('bad-reference'))).toMatchObject({
      isValid: false,
      referenceType: 'invalid',
      issues: [{
        code: 'reference-empty',
        details: {
          reference: 'bad-reference',
        },
      }],
    });
  });

  it.each([
    ['__proto__', 'polluted'],
    ['constructor', 'polluted'],
    ['Patient', '__proto__'],
  ])('rejects unsafe custom constraint keys %s.%s', (resourceType, fieldPath) => {
    const validator = new ReferenceTypeConstraintValidator();

    expect(() => validator.setConstraints(resourceType, fieldPath, {
      fieldPath,
      targetTypes: ['Patient'],
    })).toThrow(/object prototypes/);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.getPrototypeOf(REFERENCE_TYPE_CONSTRAINTS.Patient)).toBe(Object.prototype);
  });

  it('accepts absolute versioned FHIR references with UUID version ids', () => {
    const reference = 'https://server.fire.ly/R4/Patient/43355a34-d174-466e-a7bf-ee08db1bf597/_history/e4149b5f-4052-43bb-a6c9-66058e5a9ae3';

    expect(validateReferenceFormat(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Patient',
      resourceId: '43355a34-d174-466e-a7bf-ee08db1bf597',
      version: 'e4149b5f-4052-43bb-a6c9-66058e5a9ae3',
    });

    expect(parseReference(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Patient',
      resourceId: '43355a34-d174-466e-a7bf-ee08db1bf597',
      version: 'e4149b5f-4052-43bb-a6c9-66058e5a9ae3',
    });
  });

  it('extracts the resource type after FHIR version path segments', () => {
    const reference = 'https://api.service.nhs.uk/personal-demographics/FHIR/R4/Patient/9449306753';

    expect(parseReference(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Patient',
      resourceId: '9449306753',
      baseUrl: 'https://api.service.nhs.uk/personal-demographics/FHIR/R4',
    });

    const result = getReferenceTypeConstraintValidator()
      .validateReferenceType(reference, 'Encounter', 'subject');

    expect(result).toMatchObject({
      isValid: true,
      actualType: 'Patient',
    });
  });

  it('keeps opaque absolute URLs valid while skipping target type checks', () => {
    const reference = 'https://hapi.fhir.org/baseR4Patient/ff55ca8e-c43d-11ee-9941-072968e13370';

    expect(parseReference(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: null,
    });

    const result = getReferenceTypeConstraintValidator()
      .validateReferenceType(reference, 'Encounter', 'subject');

    expect(result).toMatchObject({
      isValid: true,
      code: 'absolute-reference-type-unknown',
    });
  });

  it('parses conditional relative references for target type checks', () => {
    const reference = 'Patient?identifier=9000951';

    expect(parseReference(reference)).toMatchObject({
      isValid: true,
      referenceType: 'relative',
      resourceType: 'Patient',
      resourceId: null,
    });

    const result = getReferenceTypeConstraintValidator()
      .validateReferenceType(reference, 'Encounter', 'subject');

    expect(result).toMatchObject({
      isValid: true,
      actualType: 'Patient',
    });
  });

  it('normalizes known resource type segments in absolute lowercase URLs', () => {
    const reference = 'https://server.fire.ly/practitioner/639d8b80-ec81-3647-9b23-f4563c23b0b8';

    expect(validateReferenceFormat(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Practitioner',
      resourceId: '639d8b80-ec81-3647-9b23-f4563c23b0b8',
    });

    expect(parseReference(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Practitioner',
      resourceId: '639d8b80-ec81-3647-9b23-f4563c23b0b8',
    });

    const result = getReferenceTypeConstraintValidator()
      .validateReferenceType(reference, 'Patient', 'generalPractitioner');

    expect(result).toMatchObject({
      isValid: true,
      actualType: 'Practitioner',
    });
  });

  it('normalizes lowercase versioned absolute reference paths', () => {
    const reference = 'https://server.fire.ly/r4/patient/43355a34-d174-466e-a7bf-ee08db1bf597/_history/e4149b5f-4052-43bb-a6c9-66058e5a9ae3';

    expect(validateReferenceFormat(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Patient',
      resourceId: '43355a34-d174-466e-a7bf-ee08db1bf597',
      version: 'e4149b5f-4052-43bb-a6c9-66058e5a9ae3',
    });

    expect(parseReference(reference)).toMatchObject({
      isValid: true,
      referenceType: 'absolute',
      resourceType: 'Patient',
      resourceId: '43355a34-d174-466e-a7bf-ee08db1bf597',
      version: 'e4149b5f-4052-43bb-a6c9-66058e5a9ae3',
    });
  });

  it('accepts relative versioned FHIR references with UUID version ids', () => {
    const reference = 'Patient/43355a34-d174-466e-a7bf-ee08db1bf597/_history/e4149b5f-4052-43bb-a6c9-66058e5a9ae3';

    expect(validateReferenceFormat(reference)).toMatchObject({
      isValid: true,
      referenceType: 'relative',
      resourceType: 'Patient',
      resourceId: '43355a34-d174-466e-a7bf-ee08db1bf597',
      version: 'e4149b5f-4052-43bb-a6c9-66058e5a9ae3',
    });
  });

  it('accepts relative references with underscore ids used by IG example fixtures', () => {
    expect(validateReferenceFormat('Patient/P_0000000')).toMatchObject({
      isValid: true,
      referenceType: 'relative',
      resourceType: 'Patient',
      resourceId: 'P_0000000',
    });
  });

  it('tolerates bare local relative URI references as non-typed references', () => {
    expect(validateReferenceFormat('UKCore-Observation-Group-FullBloodCount-Example')).toMatchObject({
      isValid: true,
      referenceType: 'relative',
      resourceId: 'UKCore-Observation-Group-FullBloodCount-Example',
      issues: [],
    });
  });

  it('does not extract Expression.reference as a FHIR Reference.reference', () => {
    const resource = {
      resourceType: 'PlanDefinition',
      action: [{
        condition: [{
          expression: {
            language: 'text/cql',
            reference: 'cql/QuestionnaireLogicLibrary|1.0',
          },
        }],
      }],
      subjectReference: {
        reference: 'Patient/example',
      },
    };

    expect(extractReferences(resource, 'PlanDefinition')).toEqual([
      {
        path: 'PlanDefinition.subjectReference',
        reference: 'Patient/example',
      },
    ]);
  });

  it('does not probe absolute references on a different origin by default', async () => {
    const checker = new BatchedReferenceChecker({
      baseUrl: 'https://server.fire.ly/R4',
    });

    const result = await checker.checkBatch([
      'https://other.example/fhir/Patient/43355a34-d174-466e-a7bf-ee08db1bf597',
    ]);

    expect(result.failedCount).toBe(1);
    expect(result.results[0]).toMatchObject({
      exists: false,
      errorMessage: 'Cannot build URL for reference',
    });
  });
});

describe('relative references with a path before ResourceType/id', () => {
  it('reads the type and id from the last segments, as the reference validator does', () => {
    expect(parseReference('/fhir/Patient/5e55/_history/1')).toMatchObject({
      isValid: true, referenceType: 'relative', resourceType: 'Patient', resourceId: '5e55', version: '1',
      originalReference: '/fhir/Patient/5e55/_history/1',
    });
    expect(parseReference('/fhir/patient/5e55')).toMatchObject({ isValid: false });
    expect(validateReferenceFormat('/fhir/Patient/5e55/_history/1')).toMatchObject({
      isValid: true, referenceType: 'relative', resourceType: 'Patient', resourceId: '5e55', version: '1', issues: [],
    });
    expect(validateReferenceFormat('/fhir/Unknownthing/5e55').isValid).toBe(false);
  });
});


// SMART Health Cards name Bundle entries `resource:0` and reference them so.
describe('references to absolute URIs of other schemes', () => {
  it('accepts a lower-case scheme the reference validator reads as absolute, without a type', () => {
    expect(validateReferenceFormat('resource:0')).toMatchObject({ isValid: true, referenceType: 'absolute', issues: [] });
    expect(parseReference('resource:0')).toMatchObject({ isValid: true, referenceType: 'absolute', resourceType: null });
    expect(validateReferenceFormat('Patient:123').isValid).toBe(false);
  });
});
