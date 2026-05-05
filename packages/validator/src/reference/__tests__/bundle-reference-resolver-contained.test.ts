import { describe, expect, it } from 'vitest';
import { BundleReferenceResolver } from '../bundle-reference-resolver';

describe('BundleReferenceResolver — contained reference handling', () => {
  const resolver = new BundleReferenceResolver();

  it('does not flag a contained "#xxx" reference as missing in the Bundle', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'http://example.org/Observation/o1',
          resource: {
            resourceType: 'Observation',
            id: 'o1',
            status: 'final',
            code: { text: 'x' },
            device: { reference: '#contained-device' },
            contained: [
              { resourceType: 'Device', id: 'contained-device', status: 'active' },
            ],
          },
        },
      ],
    };
    const { issues } = resolver.validateBundleReferencesOptimized(bundle);
    const unresolved = issues.filter(i => i.code === 'unresolved-bundle-reference');
    expect(unresolved).toHaveLength(0);
  });

  it('still flags a non-contained relative reference that is missing', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'http://example.org/Observation/o1',
          resource: {
            resourceType: 'Observation',
            id: 'o1',
            status: 'final',
            code: { text: 'x' },
            subject: { reference: 'Patient/missing' },
          },
        },
      ],
    };
    const { issues } = resolver.validateBundleReferencesOptimized(bundle);
    const unresolved = issues.filter(i => i.code === 'unresolved-bundle-reference');
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved[0].message).toContain('Patient/missing');
  });
});
