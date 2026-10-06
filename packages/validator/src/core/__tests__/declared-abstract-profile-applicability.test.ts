import { describe, expect, it, vi } from 'vitest';
import { getIncompatibleProfileResourceType } from '../profile-resource-type';
import { loadProfileOrBase } from '../profile-loader-utils';
import { prepareSingleResourceProfile } from '../single-resource-profile-preparation';
import { MultiAspectResourcePreparation } from '../multi-aspect-resource-preparation';
import type { StructureDefinition } from '../structure-definition-types';

type FhirVersion = 'R4' | 'R5' | 'R6';
const coreUrl = (type: string) => 'http://hl7.org/fhir/StructureDefinition/' + type;
const definition = (type: string, version: FhirVersion = 'R4'): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: coreUrl(type), name: type, status: 'active',
  kind: 'resource', abstract: type === 'Resource' || type === 'DomainResource', type,
  fhirVersion: version === 'R4' ? '4.0.1' : version === 'R5' ? '5.0.0' : '6.0.0',
  snapshot: { element: [{ id: type, path: type }] },
});
const catalog = (...definitions: StructureDefinition[]) => ({
  loadProfile: vi.fn(async (url: string) => definitions.find(profile => profile.url === url) ?? null),
  getAvailableProfiles: () => definitions.map(profile => profile.url),
  getPackageSources: () => [],
  setProfileResolutionContext: vi.fn(),
});

describe('declared abstract resource profile compatibility', () => {
  it.each([
    ['R4', 'DomainResource', 'Bundle'], ['R4', 'DomainResource', 'Binary'],
    ['R4', 'DomainResource', 'Parameters'], ['R5', 'DomainResource', 'Bundle'],
    ['R5', 'DomainResource', 'Binary'], ['R5', 'DomainResource', 'Parameters'],
    ['R4', 'Resource', 'Identifier'], ['R5', 'Resource', 'Identifier'],
    ['R4', 'Resource', 'Resource'], ['R5', 'DomainResource', 'DomainResource'],
  ] as const)('rejects %s declared %s for %s using the actual family hierarchy', (version, type, resourceType) => {
    expect(getIncompatibleProfileResourceType(definition(type, version), resourceType, version)).toBe(type);
  });

  it.each([
    ['R4', 'DomainResource', 'Patient'], ['R5', 'DomainResource', 'Patient'],
    ['R5', 'DomainResource', 'ActorDefinition'], ['R4', 'Resource', 'Bundle'],
    ['R5', 'Resource', 'Binary'], ['R4', 'Resource', 'Parameters'],
  ] as const)('retains %s declared %s for its known subtype %s', (version, type, resourceType) => {
    expect(getIncompatibleProfileResourceType(definition(type, version), resourceType, version)).toBeUndefined();
  });

  it.each([
    ['R6', 'DomainResource', 'Bundle'], ['R6', 'DomainResource', 'Patient'],
    ['R4', 'DomainResource', 'ActorDefinition'], ['R4', 'Resource', 'SyntheticUnknown'],
  ] as const)('does not invent a mismatch for unknown %s ancestry %s/%s', (version, type, resourceType) => {
    expect(getIncompatibleProfileResourceType(definition(type, version), resourceType, version)).toBeUndefined();
  });

  it('retains root-path type inference without mutating the selected definition', () => {
    const profile = definition('DomainResource');
    Reflect.deleteProperty(profile, 'type');
    const before = structuredClone(profile);
    expect(getIncompatibleProfileResourceType(profile, 'Bundle', 'R4')).toBe('DomainResource');
    expect(profile).toEqual(before);
  });

  it.each(['empty', 'wrong-type', 'wrong-canonical', 'abstract', 'wrong-kind', 'wrong-family'] as const)(
    'rejects an unusable %s base after an incompatible declaration', async reason => {
      const declared = definition('DomainResource');
      const base = definition('Bundle');
      if (reason === 'empty') base.snapshot = { element: [] };
      if (reason === 'wrong-type') base.type = 'DomainResource';
      if (reason === 'wrong-canonical') base.url = 'https://example.test/StructureDefinition/OtherBundle';
      if (reason === 'abstract') base.abstract = true;
      if (reason === 'wrong-kind') base.kind = 'complex-type';
      if (reason === 'wrong-family') base.fhirVersion = '5.0.0';
      const sdLoader = {
        loadProfile: vi.fn(async (url: string) => url === declared.url ? declared : base),
      };
      const loaded = await loadProfileOrBase(sdLoader as never, {} as never, declared.url, 'Bundle', 'R4');
      expect(loaded).toEqual({ structureDef: null, declaredProfileUrl: declared.url,
        usedBaseFallback: false, incompatibleProfileType: 'DomainResource' });
    },
  );
});

describe('declared-type admission in maintained single and batch preparation', () => {
  it.each(['single', 'multi'] as const)('selects the concrete Bundle definition in %s preparation', async lane => {
    const declared = definition('DomainResource');
    const base = definition('Bundle');
    const sdLoader = catalog(declared, base);
    const resource = { resourceType: 'Bundle', meta: { profile: [declared.url] }, type: 'collection' };
    const snapshotGenerator = { generateSnapshot: vi.fn() };
    let selected: StructureDefinition | null;
    let mismatch: unknown;
    if (lane === 'single') {
      const result = await prepareSingleResourceProfile({ resource, explicitProfileUrl: declared.url,
        fhirVersion: 'R4', profileSourceContext: { fhirVersion: 'R4' } },
      { sdLoader: sdLoader as never, snapshotGenerator: snapshotGenerator as never });
      selected = result.structureDef;
      mismatch = result.profileFallbackIssue;
      expect(result.declaredProfileUrl).toBe(declared.url);
    } else {
      const preparation = new MultiAspectResourcePreparation({ settings: undefined, deps: {
        sdLoader: sdLoader as never, snapshotGenerator: snapshotGenerator as never,
        strictMode: false, fhirClient: undefined, profileCache: undefined, questionnaireRegistry: {} as never,
      } });
      const result = await preparation.prepare(resource, declared.url, 'R4');
      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw new Error('Concrete base preparation was not ready');
      selected = result.context.structureDef;
      mismatch = result.profileFallbackIssue;
      expect(result.context.profileUrl).toBe(declared.url);
      expect(result.context.settings).toBeUndefined();
    }
    expect(selected).toBe(base);
    expect(mismatch).toMatchObject({ code: 'structural-resource-type-mismatch', severity: 'error',
      path: 'meta.profile', details: { profile: declared.url, profileResourceType: 'DomainResource', resourceType: 'Bundle' } });
    expect(sdLoader.loadProfile.mock.calls.map(([url]) => url)).toEqual([declared.url, base.url]);
  });

  it.each([
    ['single', 'DomainResource', 'Patient'], ['multi', 'DomainResource', 'Patient'],
    ['single', 'Resource', 'Bundle'], ['multi', 'Resource', 'Bundle'],
  ] as const)('preserves %s legitimate %s/%s selection without a fallback', async (lane, type, resourceType) => {
    const profile = definition(type);
    const before = structuredClone(profile);
    const sdLoader = catalog(profile);
    const resource = { resourceType, meta: { profile: [profile.url] } };
    if (lane === 'single') {
      const result = await prepareSingleResourceProfile({ resource, explicitProfileUrl: profile.url,
        fhirVersion: 'R4', profileSourceContext: { fhirVersion: 'R4' } },
      { sdLoader: sdLoader as never, snapshotGenerator: {} as never });
      expect(result.structureDef).toBe(profile);
      expect(result.profileFallbackIssue).toBeNull();
    } else {
      const preparation = new MultiAspectResourcePreparation({ settings: undefined, deps: {
        sdLoader: sdLoader as never, snapshotGenerator: {} as never,
        strictMode: false, fhirClient: undefined, profileCache: undefined, questionnaireRegistry: {} as never,
      } });
      const result = await preparation.prepare(resource, profile.url, 'R4');
      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw new Error('Legitimate declaration preparation was not ready');
      expect(result.context.structureDef).toBe(profile);
      expect(result.profileFallbackIssue).toBeNull();
    }
    expect(sdLoader.loadProfile.mock.calls.map(([url]) => url)).toEqual([profile.url]);
    expect(profile).toEqual(before);
  });
});
