import { describe, expect, it, vi } from 'vitest';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';

vi.mock('../profile-loader-utils', async importOriginal => ({
  ...await importOriginal<typeof import('../profile-loader-utils')>(),
  loadProfileOrBase: vi.fn(async (_loader, _generator, profileUrl: string, resourceType: string) => ({
    structureDef: { resourceType: 'StructureDefinition', type: resourceType,
      url: `http://hl7.org/fhir/StructureDefinition/${resourceType}`, snapshot: { element: [] } },
    declaredProfileUrl: profileUrl,
    usedBaseFallback: profileUrl === 'https://example.test/UnresolvedPatient',
  })),
}));

const child = { resourceType: 'Patient', id: 'child',
  meta: { profile: ['https://example.test/UnresolvedPatient'] } };
const cases = [
  { kind: 'contained', resource: { resourceType: 'Observation', contained: [child] } },
  { kind: 'parameters', resource: { resourceType: 'Parameters', parameter: [{ name: 'patient', resource: child }] } },
  { kind: 'bundle', resource: { resourceType: 'Bundle', type: 'collection', entry: [{ resource: child }] } },
];

function dependencies(): MultiAspectDeps {
  const empty = { validate: async () => [] };
  return {
    sdLoader: {}, snapshotGenerator: {}, strictMode: false,
    structuralExecutor: empty, profileExecutor: empty, invariantExecutor: empty,
    terminologyExecutor: empty, referenceExecutor: empty, customRuleExecutor: empty, metadataExecutor: empty,
    bestPracticeValidator: { validate: () => [] }, terminologyResourceValidator: { validate: () => [] },
  } as unknown as MultiAspectDeps;
}

describe.each(cases)('$kind unresolved child status', ({ resource }) => {
  it.each([false, true])('preserves explicit invalidity with suppression=%s', async suppressed => {
    const settings = {
      validationStrictness: 'standard', aspects: {},
      advisorRules: suppressed ? [{ id: 'suppress-fallback', enabled: true, action: 'suppress',
        match: { code: 'profile-not-resolved' } }] : [],
    } as unknown as ValidationSettings;
    const validate = buildMultiAspectValidateCallback(dependencies(), ['profile'], settings);
    const childResult = await validate(child, child.meta.profile[0], 'R4');
    const parentResult = await validate(resource, `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`, 'R4');
    const childProfile = childResult.aspects.find(aspect => aspect.aspect === 'profile')!;
    const parentProfile = parentResult.aspects.find(aspect => aspect.aspect === 'profile')!;
    expect(childResult.isValid).toBe(false);
    expect(childProfile.isValid).toBe(false);
    expect(parentProfile.issues).toHaveLength(suppressed ? 0 : 1);
    expect(parentProfile.evidenceIssues?.[0]).toMatchObject({ severity: 'warning',
      disposition: suppressed ? 'suppressed' : 'active', details: { validationComplete: false } });
    expect(parentResult.isValid).toBe(false);
    expect(parentProfile.isValid).toBe(false);
  });
});
