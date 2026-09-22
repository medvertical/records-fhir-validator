import { describe, expect, it } from 'vitest';

import { ContainedResourceValidator } from '../contained-resource-validator';

describe('ContainedResourceValidator safety', () => {
  it('reports malformed contained entries without throwing', () => {
    const issues = new ContainedResourceValidator().validate({
      resourceType: Symbol('Patient'),
      contained: [null, 42, { id: Symbol('bad'), resourceType: [] }],
    });

    expect(issues.filter(issue => issue.code === 'contained-missing-id')).toHaveLength(3);
    expect(issues.filter(issue => issue.code === 'contained-missing-resourcetype')).toHaveLength(3);
    expect(issues[0].path).toBe('Unknown.contained[0].id');
  });

  it('contains cyclic object graphs and preserves unresolved reference paths', () => {
    const resource: Record<string, unknown> = {
      resourceType: 'Patient',
      contained: [{
        resourceType: 'Organization',
        id: 'org',
      }],
      managingOrganization: {
        reference: '#missing',
      },
    };
    resource.loop = resource;

    const issues = new ContainedResourceValidator().validate(resource);

    expect(issues.filter(issue => issue.code === 'contained-unresolved-reference'))
      .toEqual([
        expect.objectContaining({
          path: 'Patient.managingOrganization.reference',
          details: expect.objectContaining({
            reference: '#missing',
            availableIds: ['org'],
          }),
        }),
      ]);
  });

  it('fails closed when the bounded contained-resource traversal is exhausted', () => {
    const resource = {
      resourceType: 'Patient',
      contained: [{ resourceType: 'Organization', id: 'org' }],
      extension: Array.from({ length: 20_001 }, () => ({})),
    };

    expect(() => new ContainedResourceValidator().validate(resource)).toThrow(
      expect.objectContaining({ code: 'FHIR_TRAVERSAL_LIMIT' }),
    );
  });

  it('counts references between contained siblings for dom-3 usage', () => {
    const issues = new ContainedResourceValidator().validate({
      resourceType: 'Observation',
      subject: { reference: '#a' },
      contained: [
        {
          resourceType: 'Patient',
          id: 'a',
          managingOrganization: { reference: '#b' },
        },
        {
          resourceType: 'Organization',
          id: 'b',
        },
      ],
    });

    expect(issues.filter(issue => issue.code === 'contained-unreferenced')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'contained-unresolved-reference')).toEqual([]);
  });

  it('treats a bare hash in a contained resource as a reference to its container', () => {
    const issues = new ContainedResourceValidator().validate({
      resourceType: 'Observation',
      contained: [{
        resourceType: 'Provenance',
        id: 'provenance',
        target: [{ reference: '#' }],
      }],
    });

    expect(issues.filter(issue => issue.code === 'contained-unreferenced')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'contained-unresolved-reference')).toEqual([]);
  });

  it('counts fragment-valued uri primitives as contained-resource usage', () => {
    const issues = new ContainedResourceValidator().validate({
      resourceType: 'ValueSet',
      contained: [{ resourceType: 'CodeSystem', id: 'local-codes' }],
      compose: { include: [{ system: '#local-codes' }] },
    });

    expect(issues.filter(issue => issue.code === 'contained-unreferenced')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'contained-unresolved-reference')).toEqual([]);
  });

  it('keeps the first resource for duplicate ids across resolution and metadata', () => {
    const first = { resourceType: 'Patient', id: 'duplicate', active: true };
    const second = { resourceType: 'Patient', id: 'duplicate', active: false };
    const resource = {
      resourceType: 'Observation',
      subject: { reference: '#duplicate' },
      contained: [first, second],
    };
    const validator = new ContainedResourceValidator();
    const metadata = validator.validateWithMetadata(resource);

    expect(validator.resolveReference(resource, '#duplicate')).toBe(first);
    expect(metadata.containedMap.get('duplicate')).toBe(first);
    expect(metadata.issues.filter(issue => issue.code === 'contained-duplicate-id'))
      .toEqual([
        expect.objectContaining({ path: 'Observation.contained[1].id' }),
      ]);
  });

  it('returns empty metadata and null resolution for malformed roots', () => {
    const validator = new ContainedResourceValidator();

    expect(validator.resolveReference(null, '#x')).toBeNull();
    expect(validator.resolveReference({ contained: [] }, 'Patient/x')).toBeNull();
    expect(validator.validateWithMetadata({ contained: {} })).toMatchObject({
      issues: [],
      referencedIds: new Set(),
      unreferencedIds: new Set(),
    });
  });
});
