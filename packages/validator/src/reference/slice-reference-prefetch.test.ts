import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../core/structure-definition-types';
import { SlicingValidator } from '../validators/slicing-validator';
import {
  collectSliceDiscriminatorReferences,
  prefetchSliceReferenceTargets,
  sliceReferencePrefetchLimits,
} from './slice-reference-prefetch';

const PRIMAERTUMOR = 'https://example.org/StructureDefinition/diagnose-primaertumor';

function medicationRequestProfile(discriminatorPath: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: 'https://example.org/StructureDefinition/therapieempfehlung',
    name: 'Therapieempfehlung',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'MedicationRequest',
    snapshot: {
      element: [
        { path: 'MedicationRequest' },
        {
          path: 'MedicationRequest.reasonReference',
          min: 1,
          slicing: { discriminator: [{ type: 'profile', path: discriminatorPath }], rules: 'open' },
          type: [{ code: 'Reference', targetProfile: [PRIMAERTUMOR] }],
        },
        {
          path: 'MedicationRequest.reasonReference',
          sliceName: 'Primaertumor',
          min: 1,
          max: '1',
          type: [{ code: 'Reference', targetProfile: [PRIMAERTUMOR] }],
        },
        { path: 'MedicationRequest.subject', type: [{ code: 'Reference' }] },
      ],
    },
  };
}

const RESOURCE = {
  resourceType: 'MedicationRequest',
  reasonReference: [{ reference: 'Condition/primaertumor-example' }],
  subject: { reference: 'Patient/kim' },
};

const LIMITS = { maxReferences: 10, timeoutMs: 5_000, allowAbsolute: false };

describe('collectSliceDiscriminatorReferences', () => {
  it('collects references only from target-dependent sliced elements', () => {
    expect(collectSliceDiscriminatorReferences(RESOURCE, medicationRequestProfile('$this.resolve()')))
      .toEqual(['Condition/primaertumor-example']);
  });

  it('ignores slicing whose discriminators never depend on the target', () => {
    const profile = medicationRequestProfile('$this.resolve()');
    profile.snapshot!.element[1].slicing = {
      discriminator: [{ type: 'value', path: 'reference' }],
      rules: 'open',
    };
    expect(collectSliceDiscriminatorReferences(RESOURCE, profile)).toEqual([]);
  });

  it('returns nothing when the profile carries no snapshot or differential', () => {
    const profile = medicationRequestProfile('$this.resolve()');
    delete profile.snapshot;
    expect(collectSliceDiscriminatorReferences(RESOURCE, profile)).toEqual([]);
  });
});

describe('prefetchSliceReferenceTargets', () => {
  const profile = medicationRequestProfile('$this.resolve()');

  it('resolves the fetched target for the slicing matcher', async () => {
    const target = { resourceType: 'Condition', id: 'primaertumor-example', meta: { profile: [PRIMAERTUMOR] } };
    const fetcher = vi.fn().mockResolvedValue(target);

    const resolver = await prefetchSliceReferenceTargets({
      resource: RESOURCE, structureDef: profile, fetcher, limits: LIMITS,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resolver?.('Condition/primaertumor-example')).toBe(target);
  });

  it('leaves the slice unverifiable when the target cannot be fetched', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('404'));

    const resolver = await prefetchSliceReferenceTargets({
      resource: RESOURCE, structureDef: profile, fetcher, limits: LIMITS,
    });

    expect(resolver).toBeNull();
  });

  it('never fetches a reference the bundle already answers', async () => {
    const fetcher = vi.fn().mockResolvedValue({ resourceType: 'Condition' });

    const resolver = await prefetchSliceReferenceTargets({
      resource: RESOURCE,
      structureDef: profile,
      fetcher,
      limits: LIMITS,
      alreadyResolved: () => ({ resourceType: 'Condition', id: 'bundled' }),
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(resolver).toBeNull();
  });

  it('skips contained and absolute references unless external access is allowed', async () => {
    const fetcher = vi.fn().mockResolvedValue({ resourceType: 'Condition' });
    const resource = {
      resourceType: 'MedicationRequest',
      reasonReference: [
        { reference: '#local' },
        { reference: 'https://other.example.org/fhir/Condition/remote' },
      ],
    };

    expect(await prefetchSliceReferenceTargets({
      resource, structureDef: profile, fetcher, limits: LIMITS,
    })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();

    await prefetchSliceReferenceTargets({
      resource, structureDef: profile, fetcher, limits: { ...LIMITS, allowAbsolute: true },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://other.example.org/fhir/Condition/remote',
      expect.anything(),
    );
  });

  it('caps the number of fetched references', async () => {
    const fetcher = vi.fn().mockResolvedValue({ resourceType: 'Condition' });
    const resource = {
      resourceType: 'MedicationRequest',
      reasonReference: Array.from({ length: 8 }, (_, index) => ({ reference: `Condition/c${index}` })),
    };

    await prefetchSliceReferenceTargets({
      resource, structureDef: profile, fetcher, limits: { ...LIMITS, maxReferences: 3 },
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('sliceReferencePrefetchLimits', () => {
  it('stays off without recursive reference settings', () => {
    expect(sliceReferencePrefetchLimits(undefined)).toBeNull();
  });

  it('treats enabled recursive reference validation alone as no consent to fetch', () => {
    expect(sliceReferencePrefetchLimits({ enabled: true })).toBeNull();
  });

  it('stays off when recursive reference validation is disabled outright', () => {
    expect(sliceReferencePrefetchLimits({ enabled: false, validateTargetProfiles: true })).toBeNull();
  });

  it('clamps the configured bounds', () => {
    expect(sliceReferencePrefetchLimits({
      enabled: true,
      validateTargetProfiles: true,
      maxReferencesPerResource: 500,
      timeoutMs: 10_000_000,
      validateExternal: true,
    })).toEqual({ maxReferences: 20, timeoutMs: 60_000, allowAbsolute: true });
  });

  it('keeps absolute references out unless external validation is on', () => {
    expect(sliceReferencePrefetchLimits({ enabled: true, validateTargetProfiles: true })?.allowAbsolute)
      .toBe(false);
  });
});

describe('prefetched targets drive slice cardinality', () => {
  const profile = medicationRequestProfile('$this.resolve()');

  async function validateWithPrefetch(target: unknown) {
    const validator = new SlicingValidator();
    validator.setReferenceResolver(await prefetchSliceReferenceTargets({
      resource: RESOURCE,
      structureDef: profile,
      fetcher: vi.fn().mockResolvedValue(target),
      limits: LIMITS,
    }));
    return validator.validateSlicing(
      RESOURCE.reasonReference,
      'MedicationRequest.reasonReference',
      profile,
    );
  }

  it('reports the missing slice once the fetched target lacks the required profile', async () => {
    const issues = await validateWithPrefetch({
      resourceType: 'Condition',
      id: 'primaertumor-example',
      meta: { profile: ['https://example.org/StructureDefinition/some-other-condition'] },
    });

    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).not.toHaveLength(0);
  });

  it('accepts the slice once the fetched target carries the required profile', async () => {
    const issues = await validateWithPrefetch({
      resourceType: 'Condition',
      id: 'primaertumor-example',
      meta: { profile: [PRIMAERTUMOR] },
    });

    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(0);
  });

  it('stays unverifiable when no target could be fetched', async () => {
    const validator = new SlicingValidator();
    validator.setReferenceResolver(null);

    const issues = await validator.validateSlicing(
      RESOURCE.reasonReference,
      'MedicationRequest.reasonReference',
      profile,
    );

    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(0);
  });
});
