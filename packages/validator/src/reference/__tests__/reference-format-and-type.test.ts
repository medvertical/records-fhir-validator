import { describe, expect, it } from 'vitest';
import { BatchedReferenceChecker } from '../batched-reference-checker';
import { validateReferenceFormat } from '../reference-format-validator';
import { parseReference } from '../reference-type-extractor';
import { getReferenceTypeConstraintValidator } from '../reference-type-constraint-validator';

describe('Reference parsing', () => {
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

  it('normalizes known resource type segments in absolute lowercase URLs', () => {
    const reference = 'https://server.fire.ly/practitioner/639d8b80-ec81-3647-9b23-f4563c23b0b8';

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
