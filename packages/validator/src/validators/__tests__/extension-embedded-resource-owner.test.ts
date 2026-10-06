import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import { getValueAtPath } from '../../core/validation-utils';
import { ExtensionValidator } from '../extension-validator';
import { walkResourceExtensions } from '../extension-resource-walk';
import type { ExtensionValidationContext } from '../extension-types';

const childUrl = 'https://acme.test/fhir/StructureDefinition/child';
const extensionUrl = 'https://acme.test/fhir/StructureDefinition/owned-extension';
const unknownUrl = 'https://acme.test/fhir/StructureDefinition/unknown-extension';

function profile(type: string, url: string, elements: ElementDefinition[] = []): StructureDefinition {
  return { resourceType: 'StructureDefinition', url, name: type, status: 'active', kind: 'resource',
    abstract: false, type, version: '1.0.0', fhirVersion: '4.0.1',
    snapshot: { element: [{ id: type, path: type }, ...elements] } };
}

function declaration(type: string, key: 'extension' | 'modifierExtension', url = extensionUrl): ElementDefinition {
  return { id: `${type}.${key}:owned`, path: `${type}.${key}`, sliceName: 'owned',
    min: 0, max: '*', isModifier: key === 'modifierExtension', type: [{ code: 'Extension', profile: [url] }] };
}

function bundleProfile(rootDeclarations: ElementDefinition[] = [], slotType = 'Resource'): StructureDefinition {
  return profile('Bundle', 'https://acme.test/fhir/StructureDefinition/bundle', [
    { id: 'Bundle.entry', path: 'Bundle.entry', type: [{ code: 'BackboneElement' }] },
    { id: 'Bundle.entry.resource', path: 'Bundle.entry.resource', type: [{ code: slotType }] },
    ...rootDeclarations,
  ]);
}

function context(resource: unknown, sd: StructureDefinition): ExtensionValidationContext {
  return { resource, profileSD: sd, strictMode: false, fhirVersion: 'R4', profileUrl: sd.url, getValueAtPath };
}

function harness(definitions: Map<string, StructureDefinition | null> = new Map()) {
  const loadProfile = vi.fn(async (url: string, _family: string) => definitions.get(url) ?? null);
  const loadReferencedProfile = vi.fn(async (url: string, _source: unknown, _family: string) => definitions.get(url) ?? null);
  const execute = vi.fn(async (_options: unknown) => []);
  const validator = new ExtensionValidator(
    { loadProfile, loadReferencedProfile } as any,
    { validate: vi.fn(async () => []) } as any,
    { validate: vi.fn(async () => []), validateBinding: vi.fn(async () => []) } as any,
    { validate: vi.fn(() => []) } as any,
    { execute } as any,
  );
  async function validate(child: Record<string, unknown>, sd = bundleProfile()) {
    const resource = { resourceType: 'Bundle', entry: [{ resource: child }] };
    return { issues: await validator.validateExtensions(resource, sd, context(resource, sd)), resource };
  }
  return { validate, loadProfile, loadReferencedProfile, execute };
}

function unknownErrors(issues: ValidationIssue[]) {
  return issues.filter(issue => issue.code === 'profile-extension-not-found');
}

function unavailable(issues: ValidationIssue[]) {
  return issues.filter(issue => issue.code === 'profile-reference-unavailable');
}

describe('embedded resource extension ownership', () => {

  it.each(['declared-owner', 'missing-slot', 'cyclic'] as const)('does not demand extension authority for an extension-free %s child', async mode => {
    const h = harness();
    const sd = bundleProfile();
    if (mode === 'missing-slot') sd.snapshot!.element = sd.snapshot!.element.filter(element => element.path !== 'Bundle.entry.resource');
    const child: Record<string, unknown> = { resourceType: 'Patient', meta: { profile: [childUrl] },
      name: [{ given: ['sample'] }], extension: [], modifierExtension: [] };
    if (mode === 'cyclic') child.self = child;
    const { issues } = await h.validate(child, sd);
    expect(issues).toEqual([]);
    expect(h.loadProfile).not.toHaveBeenCalled();
    expect(h.loadReferencedProfile).not.toHaveBeenCalled();
  });

  it.each(['extension', 'modifierExtension'] as const)('uses the child declaration for %s without requiring its external definition', async key => {
    const sd = profile('Patient', childUrl, [declaration('Patient', key)]);
    const h = harness(new Map([[childUrl, sd]]));
    const { issues } = await h.validate({ resourceType: 'Patient', meta: { profile: [childUrl] },
      [key]: [{ url: extensionUrl, valueString: 'owned' }] });
    expect(unknownErrors(issues)).toEqual([]);
    expect(unavailable(issues)).toEqual([]);
    expect(h.loadProfile).toHaveBeenCalledWith(childUrl, 'R4');
    expect(h.loadReferencedProfile.mock.calls.every(([, source]) => source === sd)).toBe(true);
  });

  it.each(['extension', 'modifierExtension'] as const)('does not borrow a Bundle-known URL for an unclaimed child %s', async key => {
    const h = harness();
    const { issues } = await h.validate({ resourceType: 'Patient', [key]: [{ url: extensionUrl, valueString: 'unknown' }] },
      bundleProfile([declaration('Bundle', key)]));
    expect(unknownErrors(issues)).toEqual([expect.objectContaining({ severity: 'error',
      path: `Bundle.entry[0].resource.${key}[0]`, resourceType: 'Patient' })]);
    expect(unavailable(issues)).toEqual([]);
    expect(h.loadReferencedProfile.mock.calls.every(([, source]) => source === undefined || (source as StructureDefinition).type === 'Patient')).toBe(true);
  });

  it.each(['extension', 'modifierExtension'] as const)('still rejects a truly unknown child %s under its available own profile', async key => {
    const sd = profile('Patient', childUrl);
    const h = harness(new Map([[childUrl, sd]]));
    const { issues } = await h.validate({ resourceType: 'Patient', meta: { profile: [childUrl] },
      [key]: [{ url: unknownUrl, valueString: 'unknown' }] });
    expect(unknownErrors(issues)).toEqual([expect.objectContaining({ severity: 'error', resourceType: 'Patient' })]);
    expect(unavailable(issues)).toEqual([]);
  });

  it.each([
    ['missing', null],
    ['foreign canonical', profile('Patient', `${childUrl}-foreign`, [declaration('Patient', 'modifierExtension')])],
    ['wrong version', { ...profile('Patient', childUrl), version: '2.0.0' }],
    ['foreign family', { ...profile('Patient', childUrl), fhirVersion: '5.0.0' }],
    ['wrong resource type', profile('Observation', childUrl)],
    ['datatype kind', { ...profile('Patient', childUrl), kind: 'complex-type' }],
    ['abstract profile', { ...profile('Patient', childUrl), abstract: true }],
  ])('preserves unknown authority for a %s child profile and still checks URL shape', async (_reason, definition) => {
    const canonical = `${childUrl}|1.0.0`;
    const h = harness(new Map([[canonical, definition as StructureDefinition | null]]));
    const { issues } = await h.validate({ resourceType: 'Patient', meta: { profile: [canonical] },
      modifierExtension: [{ url: extensionUrl, valueString: 'unknown' }, { valueString: 'missing-url' }] },
    bundleProfile([declaration('Bundle', 'modifierExtension')]));
    expect(unknownErrors(issues)).toEqual([]);
    expect(unavailable(issues)).toEqual([expect.objectContaining({ path: 'Bundle.entry[0].resource.meta.profile',
      details: expect.objectContaining({ validationComplete: false }) })]);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-extension-url-missing', severity: 'error',
      path: 'Bundle.entry[0].resource.modifierExtension[1]', resourceType: 'Patient' }));
    expect(h.loadReferencedProfile).not.toHaveBeenCalled();
  });

  it('preserves a failed child profile load as incomplete authority', async () => {
    const h = harness();
    h.loadProfile.mockRejectedValue(new Error('offline'));
    const { issues } = await h.validate({ resourceType: 'Patient', meta: { profile: [childUrl] },
      modifierExtension: [{ url: unknownUrl, valueString: 'unknown' }] });
    expect(unknownErrors(issues)).toEqual([]);
    expect(unavailable(issues)[0]?.details).toMatchObject({ validationComplete: false });
  });

  it('retains declarations from all verified child profiles and unavailable sibling evidence', async () => {
    const otherUrl = `${childUrl}-other`;
    const sd = profile('Patient', otherUrl, [declaration('Patient', 'extension')]);
    const h = harness(new Map([[otherUrl, sd]]));
    const { issues } = await h.validate({ resourceType: 'Patient', meta: { profile: [childUrl, otherUrl] },
      extension: [{ url: extensionUrl, valueString: 'owned' }] });
    expect(unknownErrors(issues)).toEqual([]);
    expect(unavailable(issues)).toHaveLength(1);
  });

  it('uses the original root and child focus for a globally resolved unclaimed extension', async () => {
    const sd = { ...profile('Extension', extensionUrl), kind: 'complex-type' };
    const h = harness(new Map([[extensionUrl, sd]]));
    const child = { resourceType: 'Patient', extension: [{ url: extensionUrl, valueString: 'resolved' }] };
    const { issues, resource } = await h.validate(child);
    expect(unknownErrors(issues)).toEqual([]);
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ rootResource: resource, focusResource: child,
      resourceType: 'Extension', structureDef: sd, fhirVersion: 'R4' }));
    expect(h.loadReferencedProfile).toHaveBeenCalledWith(extensionUrl, undefined, 'R4');
  });

  it('keeps existence, context and definition with the same selected child owner', async () => {
    const otherUrl = `${childUrl}-other`;
    const first = profile('Patient', childUrl);
    const second = profile('Patient', otherUrl);
    const selected = { ...profile('Extension', extensionUrl), kind: 'complex-type' };
    const conflicting = { ...selected, version: '2.0.0', context: [{ type: 'element', expression: 'Bundle' }] };
    const h = harness(new Map([[childUrl, first], [otherUrl, second]]));
    h.loadReferencedProfile.mockImplementation(async (_url, source) => source === first ? selected : conflicting);
    const { issues } = await h.validate({ resourceType: 'Patient', meta: { profile: [childUrl, otherUrl] },
      extension: [{ url: extensionUrl, valueString: 'resolved' }] });
    expect(issues.some(issue => issue.code === 'profile-extension-context-wrong')).toBe(false);
    expect(h.loadReferencedProfile.mock.calls.every(([, source]) => source === first)).toBe(true);
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ structureDef: selected }));
  });

  it('does not start resource ownership at ExampleScenario.instance.resourceType', async () => {
    const h = harness();
    const sd = profile('ExampleScenario', 'https://acme.test/fhir/StructureDefinition/scenario', [
      { id: 'ExampleScenario.instance', path: 'ExampleScenario.instance', type: [{ code: 'BackboneElement' }] },
      declaration('ExampleScenario', 'extension'),
    ]);
    const resource = { resourceType: 'ExampleScenario', instance: [{ resourceType: 'Patient',
      meta: { profile: [childUrl] }, extension: [{ url: extensionUrl, valueString: 'scenario' }] }] };
    const validator = new ExtensionValidator({ loadProfile: h.loadProfile, loadReferencedProfile: h.loadReferencedProfile } as any,
      {} as any, {} as any, {} as any);
    const issues = await validator.validateExtensions(resource, sd, context(resource, sd));
    expect(unknownErrors(issues)).toEqual([]);
    expect(unavailable(issues)).toEqual([]);
    expect(h.loadProfile).not.toHaveBeenCalledWith(childUrl, 'R4');
    expect(h.loadReferencedProfile.mock.calls.every(([, source]) => source === sd)).toBe(true);
  });

  it.each(['missing', 'mixed', 'fallback'] as const)('retains U for %s slot authority without borrowing owner callbacks', async mode => {
    const sd = bundleProfile();
    if (mode === 'missing') sd.snapshot!.element = sd.snapshot!.element.filter(element => element.path !== 'Bundle.entry.resource');
    if (mode === 'mixed') sd.snapshot!.element[2].type!.push({ code: 'BackboneElement' });
    const child = { resourceType: 'Patient', modifierExtension: [
      { url: extensionUrl, valueString: 'root-known' }, { valueString: 'missing-url' },
    ] };
    const resource = { resourceType: 'Bundle', entry: [{ resource: child }] };
    const resolveExtensionUrl = vi.fn(async () => 'resolvable' as const);
    const getDeclaredContexts = vi.fn(async () => [{ type: 'element' as const, expression: 'Bundle' }]);
    const validateAgainstDefinition = vi.fn(async () => []);
    const resolveResourceScope = vi.fn();
    const issues: ValidationIssue[] = [];
    await walkResourceExtensions(resource, 'Bundle', context(resource, sd), new Set([extensionUrl]), new Set(), issues, {
      maxNestedExtensionDepth: 5, resolveExtensionUrl, getDeclaredContexts, validateAgainstDefinition,
      ...(mode !== 'fallback' ? { resolveResourceScope } : {}),
    });
    expect(unavailable(issues)).toEqual([expect.objectContaining({ path: 'Bundle.entry[0].resource',
      details: expect.objectContaining({ validationComplete: false }) })]);
    expect(unknownErrors(issues)).toEqual([]);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-extension-url-missing', resourceType: 'Patient' }));
    expect(resolveExtensionUrl).not.toHaveBeenCalled();
    expect(getDeclaredContexts).not.toHaveBeenCalled();
    expect(validateAgainstDefinition).not.toHaveBeenCalled();
    expect(resolveResourceScope).not.toHaveBeenCalled();
  });
});
