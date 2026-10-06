import { describe, expect, it, vi } from 'vitest';
import { StructuralExecutor } from '../structural-executor';
import type { StructureDefinition } from '../../structure-definition-types';

const coreUrl = (type: string) => 'http://hl7.org/fhir/StructureDefinition/' + type;
const definition = (type: string, version: 'R4' | 'R5'): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: coreUrl(type), name: type, status: 'active',
  kind: 'resource', abstract: type === 'DomainResource' || type === 'Resource', type,
  fhirVersion: version === 'R4' ? '4.0.1' : '5.0.0', snapshot: { element: [{ id: type, path: type }] },
});

describe('direct StructuralExecutor declared-profile fallback', () => {
  it.each([
    ['R4', 'supplied'], ['R4', 'loaded'], ['R5', 'supplied'], ['R5', 'loaded'],
  ] as const)('executes the concrete base rule for %s %s incompatible DomainResource', async (version, mode) => {
    const domain = definition('DomainResource', version);
    domain.snapshot!.element.push({ id: 'DomainResource.forbidden', path: 'DomainResource.forbidden', min: 1, max: '1' });
    const bundle = definition('Bundle', version);
    bundle.snapshot!.element.push({ id: 'Bundle.type', path: 'Bundle.type', min: 1, max: '1', type: [{ code: 'code' }] });
    const loader = {
      loadProfile: vi.fn(async (url: string) => url === domain.url ? domain : bundle),
      getBaseResourceType: (url: string) => url.split('/').at(-1),
    };
    const resource = { resourceType: 'Bundle', id: 'synthetic-fallback' };
    const original = structuredClone(domain);
    const issues = await new StructuralExecutor(loader as never).validate({ resource, resourceType: 'Bundle',
      profileUrl: domain.url, fhirVersion: version, ...(mode === 'supplied' ? { structureDef: domain } : {}) });
    expect(issues.filter(issue => issue.code === 'structural-resource-type-mismatch')).toHaveLength(1);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-cardinality-min', path: 'Bundle.type', profile: bundle.url,
    }));
    expect(issues.some(issue => issue.path === 'DomainResource.forbidden')).toBe(false);
    expect(loader.loadProfile.mock.calls.map(([url]) => url)).toEqual(
      mode === 'supplied' ? [bundle.url] : [domain.url, bundle.url],
    );
    expect(domain).toEqual(original);
  });

  it.each(['absent', 'wrong-type', 'wrong-canonical', 'empty', 'abstract', 'wrong-kind', 'wrong-family', 'throw'] as const)(
    'retains mismatch and incomplete evidence when the base is %s', async reason => {
      const domain = definition('DomainResource', 'R4');
      domain.snapshot!.element.push({ path: 'DomainResource.forbidden', min: 1, max: '1' });
      const base = definition('Bundle', 'R4');
      if (reason === 'wrong-type') base.type = 'DomainResource';
      if (reason === 'wrong-canonical') base.url = 'https://example.test/OtherBundle';
      if (reason === 'empty') base.snapshot = { element: [] };
      if (reason === 'abstract') base.abstract = true;
      if (reason === 'wrong-kind') base.kind = 'complex-type';
      if (reason === 'wrong-family') base.fhirVersion = '5.0.0';
      const loader = {
        loadProfile: vi.fn(async () => {
          if (reason === 'throw') throw new Error('Synthetic base failure');
          return reason === 'absent' ? null : base;
        }),
        getBaseResourceType: (url: string) => url.split('/').at(-1),
      };
      const issues = await new StructuralExecutor(loader as never).validate({ resource: { resourceType: 'Bundle' },
        resourceType: 'Bundle', profileUrl: domain.url, fhirVersion: 'R4', structureDef: domain });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'structural-resource-type-mismatch',
        details: expect.objectContaining({ validatedAgainstBase: false, validationComplete: false }) }));
      expect(issues.some(issue => issue.path === 'DomainResource.forbidden')).toBe(false);
      expect(issues.some(issue => issue.code === 'structural-cardinality-min')).toBe(false);
      if (reason === 'throw') expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-unreadable' }));
      expect(loader.loadProfile).toHaveBeenCalledExactlyOnceWith(coreUrl('Bundle'), 'R4');
    },
  );

  it.each([
    ['DomainResource', 'Patient'], ['Resource', 'Bundle'],
  ] as const)('does not switch legitimate %s/%s controls to a concrete base', async (type, resourceType) => {
    const profile = definition(type, 'R4');
    const original = structuredClone(profile);
    const loader = { loadProfile: vi.fn(async () => { throw new Error('Unexpected concrete fallback'); }),
      getBaseResourceType: (url: string) => url.split('/').at(-1) };
    const issues = await new StructuralExecutor(loader as never).validate({ resource: { resourceType },
      resourceType, profileUrl: profile.url, fhirVersion: 'R4', structureDef: profile });
    expect(issues.some(issue => issue.code === 'structural-resource-type-mismatch')).toBe(false);
    expect(loader.loadProfile).not.toHaveBeenCalled();
    expect(profile).toEqual(original);
  });

  it('does not manufacture a declared R6 mismatch from the R5 model', async () => {
    const profile = definition('DomainResource', 'R5');
    const loader = { loadProfile: vi.fn(async () => null), getBaseResourceType: () => undefined };
    const issues = await new StructuralExecutor(loader as never).validate({ resource: { resourceType: 'Bundle' },
      resourceType: 'Bundle', profileUrl: profile.url, fhirVersion: 'R6', structureDef: profile });
    expect(issues.some(issue => issue.code === 'structural-resource-type-mismatch')).toBe(false);
    expect(loader.loadProfile).not.toHaveBeenCalled();
  });
});
