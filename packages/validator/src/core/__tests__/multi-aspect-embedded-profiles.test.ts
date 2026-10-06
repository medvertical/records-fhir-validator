import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback.js';
import type { MultiAspectDeps } from '../multi-aspect-dependencies.js';
import type { MultiAspectResourceContext } from '../multi-aspect-resource-preparation.js';
import { validateBundleEntryResources } from '../validator-bundle-entry-validation.js';
import type { BundleEntryValidationDeps } from '../validator-bundle-entry-validation.js';
import { validateContainedResourceTree } from '../validator-contained-issues.js';
import { validateParametersResourceTree } from '../parameters-resource-validation.js';

vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: vi.fn(async (_loader, _generator, profileUrl: string, resourceType: string) => ({
    structureDef: { resourceType: 'StructureDefinition', type: resourceType, url: profileUrl, snapshot: { element: [] } },
    declaredProfileUrl: profileUrl, usedBaseFallback: false,
  })),
  loadProfileWithSnapshot: vi.fn(async () => undefined),
  createProfileFallbackIssue: vi.fn(), createProfileResourceTypeMismatchIssue: vi.fn(),
}));

const declared = 'https://example.test/Patient';
const isik = 'https://gematik.de/fhir/isik/StructureDefinition/ISiKPatient|6.0.0-rc';
const issue: ValidationIssue = {
  aspect: 'structural', severity: 'error', code: 'structural-cardinality-min',
  message: 'Missing identifier', path: 'Patient.identifier', resourceType: 'Patient',
};
const patient = (profiles: string[]) => ({ resourceType: 'Patient', id: 'p1', meta: { profile: profiles } });
const settings = { validationStrictness: 'standard', aspects: {} } as ValidationSettings;

function dependencies() {
  const empty = { validate: async () => [] };
  const validate = vi.fn(async (_resource: unknown, context: MultiAspectResourceContext) =>
    context.profileUrl === isik ? [{ ...issue }] : []);
  const deps = { sdLoader: {}, snapshotGenerator: {}, strictMode: false,
    structuralExecutor: { validate }, profileExecutor: empty, invariantExecutor: empty,
    terminologyExecutor: empty, referenceExecutor: empty, customRuleExecutor: empty, metadataExecutor: empty,
    bestPracticeValidator: { validate: () => [] }, terminologyResourceValidator: { validate: () => [] } } as unknown as MultiAspectDeps;
  return { deps, validate };
}

describe('all embedded profiles participate in validation', () => {
  it.each(['Bundle', 'Observation', 'Parameters'])('checks the added Patient profile inside %s', async resourceType => {
    const child = patient([declared, isik, isik]);
    const resource = { resourceType,
      ...(resourceType === 'Bundle' ? { type: 'collection', entry: [{ resource: child }] }
        : resourceType === 'Observation' ? { contained: [child] }
          : { parameter: [{ name: 'group', part: [{ name: 'patient', resource: child }] }] }),
    };
    const { deps, validate } = dependencies();
    const onEmbedded = vi.fn();
    const callback = buildMultiAspectValidateCallback(deps, ['structural'], settings, undefined, undefined, onEmbedded);
    const result = await callback(resource, `http://hl7.org/fhir/StructureDefinition/${resourceType}`, 'R4');
    expect(result.isValid).toBe(false);
    expect(validate.mock.calls.filter(([, context]) => context.resourceType === 'Patient')
      .map(([, context]) => context.profileUrl)).toEqual([declared, isik]);
    const findings = result.aspects.flatMap(aspect => aspect.issues);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ profile: isik, code: issue.code });
    expect(findings[0].path).toContain(resourceType === 'Bundle' ? 'Bundle.entry[0].resource'
      : resourceType === 'Observation' ? 'Observation.contained[0]' : 'Parameters.parameter[0].part[0].resource');
    if (resourceType === 'Bundle') expect(onEmbedded).toHaveBeenCalledTimes(1);
  });

  it('changes an otherwise clean Bundle result when the ISiK profile is added', async () => {
    const { deps } = dependencies();
    const callback = buildMultiAspectValidateCallback(deps, ['structural'], settings);
    const validate = (profiles: string[]) => callback({ resourceType: 'Bundle', type: 'collection',
      entry: [{ resource: patient(profiles) }] }, 'http://hl7.org/fhir/StructureDefinition/Bundle', 'R4');
    expect((await validate([declared])).isValid).toBe(true);
    expect((await validate([declared, isik])).isValid).toBe(false);
  });

  it('does not recount descendants when an embedded Bundle has multiple profiles', async () => {
    const { deps, validate } = dependencies();
    const onEmbedded = vi.fn();
    const callback = buildMultiAspectValidateCallback(deps, ['structural'], settings, undefined, undefined, onEmbedded);
    await callback({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: {
      resourceType: 'Bundle', type: 'collection', meta: { profile: ['https://example.test/Bundle', 'https://example.test/AdditionalBundle'] },
      entry: [{ resource: patient([declared, isik]) }],
    } }] }, 'http://hl7.org/fhir/StructureDefinition/Bundle', 'R4');
    expect(validate.mock.calls.filter(([, context]) => context.resourceType === 'Patient')).toHaveLength(2);
    expect(onEmbedded.mock.calls.map(([resource]) => resource.resourceType)).toEqual(['Patient', 'Bundle']);
  });

  it('retains suppressed evidence from the additional profile', async () => {
    const { deps } = dependencies();
    const callback = buildMultiAspectValidateCallback(deps, ['structural'], { ...settings,
      advisorRules: [{ id: 'suppress', enabled: true, action: 'suppress', match: { code: issue.code } }],
    });
    const result = await callback({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: patient([declared, isik]) }] },
      'http://hl7.org/fhir/StructureDefinition/Bundle', 'R4');
    expect(result.aspects.flatMap(aspect => aspect.issues)).toEqual([]);
    expect(result.aspects.flatMap(aspect => aspect.evidenceIssues ?? [])).toEqual([
      expect.objectContaining({ profile: isik, disposition: 'suppressed', rawSeverity: 'error' }),
    ]);
  });

  it('also checks every embedded profile in the single-aspect fallback', async () => {
    const validateResource = vi.fn(async (_resource, profile: string) => [{ ...issue, profile }]);
    const deps = { sdLoader: {}, profileCache: {}, snapshotGenerator: {}, maxDepth: 3,
      structuralExecutor: { validateResourceIdAndArrays: () => [] }, validateResource,
      validateNestedBundleEntries: vi.fn(async () => []) } as unknown as BundleEntryValidationDeps;
    const issues = await validateBundleEntryResources({ resourceType: 'Bundle', type: 'collection',
      entry: [{ resource: patient([declared, isik]) }] }, 'R4', 0, deps);
    expect(issues.map(finding => finding.profile)).toEqual([declared, isik]);
    expect(validateResource).toHaveBeenCalledTimes(2);
  });

  it.each(['contained', 'parameters'])('keeps all profiles in the single-aspect %s fallback', async kind => {
    const validate = vi.fn(async (_resource, profile: string) => [{ ...issue, profile }]);
    const child = patient([declared, isik]);
    const options = { recursionDepth: 0, maxDepth: 3, validate };
    const issues = kind === 'contained'
      ? await validateContainedResourceTree({ resourceType: 'Observation', contained: [child] }, options)
      : await validateParametersResourceTree({ resourceType: 'Parameters', parameter: [{ name: 'patient', resource: child }] }, options);
    expect(issues.map(finding => finding.profile)).toEqual([declared, isik]);
  });
});

describe('versioned and unversioned declarations of one profile', () => {
  it('validates X|version and X once, against the declared release', async () => {
    const { deps, validate } = dependencies();
    const run = buildMultiAspectValidateCallback(deps, ['structural'], settings);

    await run(patient([isik, isik.split('|')[0]]), isik, 'R4');

    const validatedProfiles = validate.mock.calls.map(call => (call[1] as MultiAspectResourceContext).profileUrl);
    expect(validatedProfiles).toEqual([isik]);
  });
});

describe('a finding every declared profile reports', () => {
  it('is reported once, at the strictest severity a profile gives it', async () => {
    const { deps } = dependencies();
    (deps.structuralExecutor as unknown as { validate: unknown }).validate = vi.fn(
      async (_resource: unknown, context: MultiAspectResourceContext) =>
        [{ ...issue, severity: context.profileUrl === isik ? 'error' : 'warning' }]);
    const run = buildMultiAspectValidateCallback(deps, ['structural'], settings);

    const result = await run(patient([declared, isik]), declared, 'R4');

    expect(result.aspects.flatMap(aspect => aspect.issues)).toEqual([
      expect.objectContaining({ code: issue.code, severity: 'error', profile: isik }),
    ]);
  });
});
