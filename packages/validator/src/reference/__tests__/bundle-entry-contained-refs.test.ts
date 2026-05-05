import { describe, expect, it } from 'vitest';
import { ReferenceValidator } from '../reference-validator-refactored';

async function validateAndCollect(bundle: any) {
  const validator = new ReferenceValidator();
  const result = await validator.validate(bundle, { resourceType: 'Bundle', fhirVersion: 'R4' });
  return result.issues;
}

describe('ReferenceValidator — Bundle entry contained-ref scoping', () => {
  it('does not flag a #-ref inside Bundle.entry[].resource against the empty Bundle.contained', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: 'urn:uuid:abc',
          resource: {
            resourceType: 'AuditEvent',
            id: 'a1',
            agent: [{ who: { reference: '#contained-org' } }],
            contained: [
              { resourceType: 'Organization', id: 'contained-org' },
            ],
          },
        },
      ],
    };
    const issues = await validateAndCollect(bundle);
    const containedErrors = issues.filter(
      (i: any) =>
        i.code === 'reference-contained-unresolved'
        || i.code === 'reference-ref1-invariant',
    );
    expect(containedErrors).toHaveLength(0);
  });

  it('still flags a top-level #-ref that does not match the Bundle.contained', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      contained: [],
      meta: {
        extension: [
          { url: 'http://example.org/ref', valueReference: { reference: '#missing-id' } },
        ],
      },
    };
    const issues = await validateAndCollect(bundle);
    const containedErrors = issues.filter(
      (i: any) =>
        (i.code === 'reference-contained-unresolved' || i.code === 'reference-ref1-invariant')
        && /missing-id/.test(i.message || ''),
    );
    expect(containedErrors.length).toBeGreaterThan(0);
  });
});
