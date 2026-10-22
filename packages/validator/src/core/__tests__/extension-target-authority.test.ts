import { describe, expect, it, vi } from 'vitest';
import { loadExtensionTargetDefinition, validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance.js';
import { ProfileReferenceUnavailableError } from '../profile-reference-authority.js';
import type { StructureDefinition } from '../structure-definition-types.js';

const url = 'https://example.test/independent-extension';
const targetUrl = 'https://example.test/target';
const owner: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://example.test/ResearchStudy',
  version: '1', name: 'Study', status: 'active', kind: 'resource', abstract: false, type: 'ResearchStudy',
  snapshot: { element: [{ id: 'ResearchStudy', path: 'ResearchStudy' }] } };
const extension: StructureDefinition = { ...owner, url, name: 'Extension', kind: 'complex-type', type: 'Extension', version: '2',
  snapshot: { element: [{ id: 'Extension.value[x]', path: 'Extension.value[x]',
    type: [{ code: 'Reference', targetProfile: [targetUrl] }] }] } };

function fixture() {
  const loader = {
    loadProfile: vi.fn(async () => extension),
    loadReferencedProfile: vi.fn(async (canonical: string) => {
      throw new ProfileReferenceUnavailableError({ canonical, source: { name: 'owner', version: '1' }, cause: 'dependency-missing' });
    }),
  };
  const generator = { generateSnapshot: vi.fn() };
  return { loader, generator };
}

describe('extension reference target authority', () => {
  it.each([true, false])('checks the independently resolved extension target with conformance %s', async accepted => {
    const { loader, generator } = fixture();
    const target = { resourceType: 'Group', id: 'target' };
    const conformsTo = vi.fn(async () => accepted);
    const issues = await validateReferenceTargetProfileConformance({
      resource: { resourceType: 'ResearchStudy', extension: [{ url, valueReference: { reference: 'Group/target' } }] },
      structureDef: owner,
      referenceTargetValidator: { collectProfiledTargetHits: () => [] } as never,
      resolveReference: () => target,
      conformsTo,
      loadExtensionDefinition: canonical => loadExtensionTargetDefinition(loader as never, generator as never, canonical, owner, 'R4'),
    });
    expect(conformsTo).toHaveBeenCalledWith(target, targetUrl, extension);
    expect(issues.filter(issue => issue.code === 'reference-target-profile-noncompliant')).toHaveLength(accepted ? 0 : 1);
    expect(loader.loadProfile).toHaveBeenCalledWith(url, 'R4');
    expect(loader.loadReferencedProfile).not.toHaveBeenCalled();
  });

  it('preserves an unavailable explicitly declared extension edition without borrowing a global definition', async () => {
    const { loader, generator } = fixture();
    const declared: StructureDefinition = { ...owner, snapshot: { element: [...owner.snapshot!.element,
      { id: 'ResearchStudy.extension:declared', path: 'ResearchStudy.extension',
        type: [{ code: 'Extension', profile: [`${url}|1`] }] }] } };
    await expect(loadExtensionTargetDefinition(loader as never, generator as never, url, declared, 'R4'))
      .rejects.toBeInstanceOf(ProfileReferenceUnavailableError);
    expect(loader.loadReferencedProfile).toHaveBeenCalledWith(`${url}|1`, declared, 'R4');
    expect(loader.loadProfile).not.toHaveBeenCalled();
  });

  it('keeps a nested reference extension with the actual parent definition that declares its edition', async () => {
    const nestedUrl = `${url}-nested`;
    const parent: StructureDefinition = { ...extension, snapshot: { element: [
      { id: 'Extension.extension:nested', path: 'Extension.extension',
        type: [{ code: 'Extension', profile: [`${nestedUrl}|1`] }] },
    ] } };
    const nested: StructureDefinition = { ...extension, url: nestedUrl, version: '1' };
    const loader = {
      loadProfile: vi.fn(async (canonical: string) => canonical === url ? parent : extension),
      loadReferencedProfile: vi.fn(async () => nested),
    };
    const target = { resourceType: 'Group', id: 'target' }, conformsTo = vi.fn(async () => false);
    const issues = await validateReferenceTargetProfileConformance({
      resource: { resourceType: 'ResearchStudy', extension: [{ url, extension: [
        { url: nestedUrl, valueReference: { reference: 'Group/target' } },
      ] }] }, structureDef: owner,
      referenceTargetValidator: { collectProfiledTargetHits: () => [] } as never,
      resolveReference: () => target, conformsTo,
      loadExtensionDefinition: (canonical, declaring) => loadExtensionTargetDefinition(loader as never,
        {} as never, canonical, declaring ?? owner, 'R4'),
    });
    expect(loader.loadProfile).toHaveBeenCalledWith(url, 'R4');
    expect(loader.loadProfile).not.toHaveBeenCalledWith(nestedUrl, 'R4');
    expect(loader.loadReferencedProfile).toHaveBeenCalledWith(`${nestedUrl}|1`, parent, 'R4');
    expect(conformsTo).toHaveBeenCalledWith(target, targetUrl, nested);
    expect(issues.filter(issue => issue.code === 'reference-target-profile-noncompliant')).toHaveLength(1);
  });
});
