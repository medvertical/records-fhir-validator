import { describe, expect, it } from 'vitest';
import { validateReferenceFormat } from '../reference-format-validator';
import { parseReference } from '../reference-type-extractor';

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
});
