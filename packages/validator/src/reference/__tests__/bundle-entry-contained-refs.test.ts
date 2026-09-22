import { describe, expect, it } from 'vitest';
import { ReferenceValidator } from '../reference-validator-refactored';

async function validateAndCollect(bundle: any) {
  const validator = new ReferenceValidator();
  return validator.validateInternal(bundle, 'Bundle', 'R4');
}

describe('ReferenceValidator — Bundle entry contained-ref scoping', () => {
  it('reports missing contained references in each entry using that entry own scope', async () => {
    const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
      { resource: { resourceType: 'Observation', subject: { reference: '#missing' } } },
      { resource: { resourceType: 'Observation', subject: { reference: '#missing' },
        contained: [{ resourceType: 'Patient', id: 'missing' }] } },
    ] };
    const issues = await validateAndCollect(bundle);
    expect(issues.filter(issue => issue.code === 'reference-ref1-invariant')).toEqual([
      expect.objectContaining({ path: 'Bundle.entry[0].resource.subject' }),
    ]);
  });

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

describe('ReferenceValidator — Parameters embedded resource contained-ref scoping', () => {
  it('does not check refs inside Parameters.parameter[].resource against Parameters.contained', async () => {
    const validator = new ReferenceValidator();
    const parameters = {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'coverage',
          resource: {
            resourceType: 'Coverage',
            contained: [{ resourceType: 'Organization', id: 'payer' }],
            status: 'active',
            beneficiary: { reference: 'Patient/p1' },
            payor: [{ reference: '#payer' }],
          },
        },
      ],
    };

    const issues = await validator.validateInternal(parameters, 'Parameters', 'R4');
    const containedErrors = issues.filter(
      (i: any) =>
        (i.code === 'reference-contained-unresolved' || i.code === 'reference-ref1-invariant')
        && /payer/.test(i.message || ''),
    );

    expect(containedErrors).toHaveLength(0);
  });
});
