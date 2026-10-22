import { rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { setProfileSource } from '../../persistence/profile-source.js';
import { RecordsValidator } from '../validator-engine.js';
import type { StructureDefinition, ElementDefinition } from '../structure-definition-types.js';
import type { ProfileExecutor, ProfileValidationContext } from '../executors/profile-executor.js';
import type { ProfileConformanceCheck } from '../../validators/sd-fhirpath-profile-conformance.js';
import { createIsolatedConstraintStore, expectIsolatedConstraintProfilesLoaded } from './portable-core-constraint-profiles.js';

const rootUrl = 'http://example.test/StructureDefinition/';
const bundleUrl = rootUrl + 'receipt-bundle';
const compositionUrl = rootUrl + 'receipt-composition';
const patientUrl = rootUrl + 'receipt-patient';

function definition(url: string, type: string, elements: ElementDefinition[]): StructureDefinition {
  return { resourceType: 'StructureDefinition', url, name: type, status: 'active', kind: 'resource',
    abstract: false, type, version: '1', fhirVersion: '4.0.1',
    snapshot: { element: [{ id: type, path: type }, ...elements] } };
}

function profiles(): StructureDefinition[] {
  return [
    definition(bundleUrl, 'Bundle', [
      { id: 'Bundle.entry', path: 'Bundle.entry', min: 1, max: '*',
        slicing: { rules: 'open', discriminator: [{ type: 'profile', path: 'resource' }] } },
      { id: 'Bundle.entry:Composition', path: 'Bundle.entry', sliceName: 'Composition', min: 1, max: '1' },
      { id: 'Bundle.entry:Composition.resource', path: 'Bundle.entry.resource',
        type: [{ code: 'Composition', profile: [compositionUrl] }] },
    ]),
    definition(compositionUrl, 'Composition', [
      { path: 'Composition.subject', type: [{ code: 'Reference', targetProfile: [patientUrl] }] },
      { path: 'Composition.type', type: [{ code: 'CodeableConcept' }] },
    ]),
    definition(patientUrl, 'Patient', [{ path: 'Patient.identifier', min: 1, max: '*', type: [{ code: 'Identifier' }] }]),
  ];
}

function coreProfiles(): StructureDefinition[] {
  const field = (path: string, code: string, max = '1'): ElementDefinition => ({
    id: path, path, min: 0, max, type: [{ code }],
  });
  const children: Record<string, ElementDefinition[]> = {
    Bundle: [field('Bundle.type', 'code'), field('Bundle.entry', 'BackboneElement', '*'),
      field('Bundle.entry.fullUrl', 'uri'), field('Bundle.entry.resource', 'Resource')],
    Composition: [field('Composition.status', 'code'), field('Composition.subject', 'Reference'),
      field('Composition.type', 'CodeableConcept')],
    Patient: [field('Patient.identifier', 'Identifier', '*')],
    List: [field('List.status', 'code'), field('List.mode', 'code'), field('List.entry', 'BackboneElement', '*'),
      field('List.entry.item', 'Reference')],
    Observation: [field('Observation.status', 'code')],
    Parameters: [field('Parameters.parameter', 'BackboneElement', '*'),
      field('Parameters.parameter.name', 'string'), field('Parameters.parameter.resource', 'Resource')],
  };
  return Object.entries(children).map(([type, elements]) => ({
    ...definition(`http://hl7.org/fhir/StructureDefinition/${type}`, type, elements), version: '4.0.1',
  }));
}

function fixture(identifier: boolean, incompleteTerminology = true) {
  const patient = { resourceType: 'Patient', id: 'p1', ...(identifier ? { identifier: [{ value: 'p1' }] } : {}) };
  const composition = { resourceType: 'Composition', id: 'c1', status: 'final', meta: { profile: [compositionUrl] },
    subject: { reference: 'Patient/p1' }, type: incompleteTerminology ? { coding: [{ system: 'http://snomed.info/sct', code: '721912009' }] } : { text: 'Fixture' } };
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { fullUrl: 'https://example.test/fhir/Composition/c1', resource: composition }, { fullUrl: 'https://example.test/fhir/Patient/p1', resource: patient },
  ] };
  return { bundle, composition, patient };
}

async function withValidator(
  test: (validator: RecordsValidator, settings: typeof DEFAULT_VALIDATION_SETTINGS_R4) => Promise<void>,
) {
  const core = coreProfiles();
  const directory = await createIsolatedConstraintStore(core);
  try {
    const validator = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: directory,
      terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false });
    await validator.waitForInitialization();
    await expectIsolatedConstraintProfilesLoaded(validator, core);
    for (const profile of profiles()) validator.getSdLoader().registerExternalProfile(profile, 'R4');
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
    settings.profileSources = { simplifier: false, packageRegistry: false };
    settings.packageDownload = { ...settings.packageDownload, autoDownload: false };
    settings.terminologyServers = [];
    settings.terminologyResolution = { ...settings.terminologyResolution, strategy: 'local-only',
      serverDelegation: { ...settings.terminologyResolution?.serverDelegation, validateCodes: false, expandValueSets: false,
        cacheResults: true, cacheTTLSeconds: 60 } };
    settings.imposedProfiles = { enabled: false, policies: [] };
    settings.aspects.custom_rule.enabled = false;
    settings.bestPracticeSeverity = 'warning';
    await test(validator, settings);
  } finally { vi.restoreAllMocks(); setProfileSource({}); await rm(directory, { recursive: true, force: true }); }
}

function observe(validator: RecordsValidator, root: unknown) {
  const components = Reflect.get(validator, 'components') as { profileExecutor: ProfileExecutor };
  const executor = components.profileExecutor;
  const execute = executor.validate.bind(executor);
  const verdicts: Array<{ resource: unknown; profile: string; verdict: unknown }> = [];
  const evaluations: unknown[] = [];
  let rootCheck: ProfileConformanceCheck | undefined;
  vi.spyOn(executor, 'validate').mockImplementation(async (context: ProfileValidationContext) => {
    evaluations.push(context.resource);
    const check = context.profileConformance;
    if (context.resource === root) rootCheck = check;
    return execute({ ...context, profileConformance: check && (async (resource, profile) => {
      const verdict = await check(resource, profile);
      verdicts.push({ resource, profile, verdict });
      return verdict;
    }) });
  });
  return { verdicts, evaluations, check: () => rootCheck };
}


function siblingProfiles() {
  const listUrl = rootUrl + 'sibling-list';
  const observationUrl = rootUrl + 'sibling-observation';
  const list = { resourceType: 'List', id: 'list', meta: { profile: [listUrl] }, status: 'current', mode: 'working',
    entry: [{ item: { reference: '#observation' } }] };
  const observation = { resourceType: 'Observation', id: 'observation', status: 'final',
    meta: { profile: [observationUrl] } };
  const definitions = [
    definition(listUrl, 'List', [
      { id: 'List.entry', path: 'List.entry', min: 1, max: '*', slicing: {
        rules: 'open', discriminator: [{ type: 'profile', path: 'item.resolve()' }],
      } },
      { id: 'List.entry:observation', path: 'List.entry', sliceName: 'observation', min: 1, max: '1' },
      { id: 'List.entry:observation.item', path: 'List.entry.item',
        type: [{ code: 'Reference', targetProfile: [observationUrl] }] },
    ]),
    definition(observationUrl, 'Observation', [{ path: 'Observation.status', min: 1, type: [{ code: 'code' }] }]),
  ];
  return { list, observation, definitions };
}

function observeSiblingResolver(validator: RecordsValidator, list: unknown) {
  const components = Reflect.get(validator, 'components') as { profileExecutor: ProfileExecutor };
  const execute = components.profileExecutor.validate.bind(components.profileExecutor);
  const resolved: unknown[] = [];
  vi.spyOn(components.profileExecutor, 'validate').mockImplementation(context => {
    if (context.resource === list) resolved.push(context.referenceResolver?.('#observation'));
    return execute(context);
  });
  return resolved;
}
describe('single-resource recursive profile conformance', () => {
  it('proves a nested target failure despite independently incomplete terminology', async () => withValidator(async (validator, settings) => {
    const { bundle, patient, composition } = fixture(false);
    const observed = observe(validator, bundle);
    const issues = await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.check()).toBeTypeOf('function');
    await expect(observed.check()!(patient, patientUrl)).resolves.toBe(false);
    expect(observed.verdicts).toContainEqual({ resource: composition, profile: compositionUrl, verdict: false });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'reference-target-profile-noncompliant' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-min-cardinality' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-conformance-incomplete', severity: 'info',
      details: expect.objectContaining({ validationComplete: false }) }));
  }));

  it('keeps an identifier-positive Composition unknown while terminology is incomplete', async () => withValidator(async (validator, settings) => {
    const { bundle, patient, composition } = fixture(true);
    const observed = observe(validator, bundle);
    const issues = await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.check()).toBeTypeOf('function');
    await expect(observed.check()!(patient, patientUrl)).resolves.toBe(true);
    expect(observed.verdicts).toContainEqual({ resource: composition, profile: compositionUrl, verdict: undefined });
    expect(issues.some(issue => issue.code === 'reference-target-profile-noncompliant')).toBe(false);
  }));

  it('keeps an unavailable target profile unknown on the exact original target object', async () => withValidator(async (validator, settings) => {
    const { bundle, patient } = fixture(true);
    const loader = validator.getSdLoader();
    const load = loader.loadReferencedProfile.bind(loader);
    vi.spyOn(loader, 'loadReferencedProfile').mockImplementation((url, source, version) => url.split('|')[0] === patientUrl
      ? Promise.resolve(null) : load(url, source, version));
    const observed = observe(validator, bundle);
    const issues = await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.check()).toBeTypeOf('function');
    await expect(observed.check()!(patient, patientUrl)).resolves.toBeUndefined();
    expect(issues.some(issue => issue.code === 'reference-target-profile-noncompliant')).toBe(false);
  }));

  it('rechecks an unavailable profile and later completed verdict in the same callback', async () => withValidator(async (validator, settings) => {
    const { bundle, patient } = fixture(true);
    const observed = observe(validator, bundle);
    await validator.validate(bundle, bundleUrl, 'R4', settings);
    const probe = { ...patient };
    const check = observed.check();
    expect(check).toBeTypeOf('function');
    const loader = validator.getSdLoader();
    const load = loader.loadReferencedProfile.bind(loader);
    let unavailable = true;
    const reads = vi.spyOn(loader, 'loadReferencedProfile').mockImplementation((url, source, version) => url.split('|')[0] === patientUrl && unavailable
      ? Promise.resolve(null) : load(url, source, version));
    await expect(check!(probe, patientUrl)).resolves.toBeUndefined();
    unavailable = false;
    await expect(check!(probe, patientUrl)).resolves.toBe(true);
    const count = reads.mock.calls.length;
    await expect(check!(probe, patientUrl)).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(count + 1);
    expect(observed.evaluations.filter(resource => resource === probe)).toHaveLength(2);
  }));

  it('uses governed findings rather than suppressed raw errors to disprove conformance', async () => withValidator(async (validator, settings) => {
    const { bundle, patient, composition } = fixture(false);
    settings.advisorRules = [{ id: 'suppress-fixture-identifier', enabled: true, action: 'suppress',
      match: { code: 'structural-cardinality-min' } }];
    const observed = observe(validator, bundle);
    await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.check()).toBeTypeOf('function');
    await expect(observed.check()!(patient, patientUrl)).resolves.toBe(true);
    expect(observed.verdicts).toContainEqual({ resource: composition, profile: compositionUrl, verdict: undefined });
  }));

  it('retains initiating source scope and the conformance recursion bound', async () => withValidator(async (validator, settings) => {
    const { bundle, patient } = fixture(true);
    const selected = profiles();
    const scopes: unknown[] = [];
    setProfileSource({ resolveProfile: async (url, _version, _settings, context) => {
      scopes.push(context);
      return selected.find(profile => profile.url === url) ?? null;
    } });
    const observed = observe(validator, bundle);
    await validator.validate(bundle, bundleUrl, 'R4', settings, undefined, undefined, 17, 23);
    expect(observed.check()).toBeTypeOf('function');
    expect(scopes).not.toContainEqual(expect.objectContaining({ organizationId: undefined }));
    expect(scopes).toContainEqual({ organizationId: 17, serverId: 23, fhirVersion: 'R4' });
    const limitedIssues = await validator.validate(bundle, bundleUrl, 'R4', settings, undefined, undefined, 17, 23, 5);
    expect(observed.check()).toBeTypeOf('function');
    const readsAtLimit = scopes.length;
    await expect(observed.check()!(patient, patientUrl)).resolves.toBeUndefined();
    expect(scopes).toHaveLength(readsAtLimit);
    expect(limitedIssues).toContainEqual(expect.objectContaining({
      severity: 'info', code: 'profile-conformance-incomplete',
      details: expect.objectContaining({ validationComplete: false, causes: ['profile-conformance-depth-limit'] }),
    }));
  }));
  it('accepts complete conformance and reevaluates the same content under publication policy', async () => withValidator(async (validator, settings) => {
    const { bundle, composition } = fixture(true, false);
    const observed = observe(validator, bundle);
    const issues = await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(issues.filter(issue => ['profile-unreadable', 'profile-not-found', 'profile-not-resolved'].includes(issue.code))).toEqual([]);
    expect(observed.verdicts).toContainEqual({ resource: composition, profile: compositionUrl, verdict: true });
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(false);
    settings.forPublication = true;
    await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.verdicts.at(-1)).toEqual({ resource: composition, profile: compositionUrl, verdict: false });
  }));

  it('does not borrow a target definition registered for R5 during R4 conformance', async () => withValidator(async (validator, settings) => {
    const { bundle, patient } = fixture(true);
    const loader = validator.getSdLoader();
    loader.clearExternalProfiles();
    for (const profile of profiles()) loader.registerExternalProfile(
      profile.url === patientUrl ? { ...profile, fhirVersion: '5.0.0' } : profile,
      profile.url === patientUrl ? 'R5' : 'R4',
    );
    const observed = observe(validator, bundle);
    const issues = await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.check()).toBeTypeOf('function');
    await expect(observed.check()!(patient, patientUrl)).resolves.toBeUndefined();
    expect(issues.some(issue => issue.code === 'reference-target-profile-noncompliant')).toBe(false);
  }));

  it('pins recursive references relative to the selected declaring profile', async () => withValidator(async (validator, settings) => {
    const { bundle } = fixture(true);
    const loader = validator.getSdLoader();
    const pins = vi.spyOn(loader, 'loadReferencedProfile');
    await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(pins).toHaveBeenCalledWith(patientUrl, expect.objectContaining({
      url: compositionUrl, version: '1', fhirVersion: '4.0.1',
    }), 'R4');
  }));

  it('revalidates an incomplete known failure without treating it as completed false', async () => withValidator(async (validator, settings) => {
    const { bundle, composition } = fixture(false);
    const observed = observe(validator, bundle);
    await validator.validate(bundle, bundleUrl, 'R4', settings);
    expect(observed.check()).toBeTypeOf('function');
    const reads = vi.spyOn(validator.getSdLoader(), 'loadReferencedProfile');
    await expect(observed.check()!(composition, compositionUrl)).resolves.toBe(false);
    const count = reads.mock.calls.length;
    await expect(observed.check()!(composition, compositionUrl)).resolves.toBe(false);
    expect(reads.mock.calls.length).toBeGreaterThan(count);
  }));

  it('resolves a contained sibling for real profile slicing in the parent container', async () => withValidator(async (validator, settings) => {
    const { list, observation, definitions } = siblingProfiles();
    const parentUrl = rootUrl + 'containing-patient';
    for (const profile of [...definitions, definition(parentUrl, 'Patient', [])]) {
      validator.getSdLoader().registerExternalProfile(profile, 'R4');
    }
    const parent = { resourceType: 'Patient', id: 'parent', contained: [list, observation] };
    const resolved = observeSiblingResolver(validator, list);
    const issues = await validator.validate(parent, parentUrl, 'R4', settings);
    expect(resolved).toContain(observation);
    expect(issues.filter(issue => issue.code?.startsWith('profile-slice-'))).toEqual([]);
  }));

  it('uses the Parameters embedded resource as its own contained-reference container', async () => withValidator(async (validator, settings) => {
    const { list, observation, definitions } = siblingProfiles();
    const payload = { ...list, contained: [observation] };
    const parametersUrl = rootUrl + 'receipt-parameters';
    const envelopeUrl = rootUrl + 'parameter-envelope';
    for (const profile of [...definitions, definition(parametersUrl, 'Parameters', []), definition(envelopeUrl, 'Bundle', [])]) {
      validator.getSdLoader().registerExternalProfile(profile, 'R4');
    }
    const parameters = { resourceType: 'Parameters', id: 'parameters', meta: { profile: [parametersUrl] },
      parameter: [{ name: 'payload', resource: payload }] };
    const envelope = { resourceType: 'Bundle', type: 'collection', entry: [
      { fullUrl: 'https://example.test/fhir/Parameters/parameters', resource: parameters },
    ] };
    const resolved = observeSiblingResolver(validator, payload);
    const issues = await validator.validate(envelope, envelopeUrl, 'R4', settings);
    expect(resolved).toContain(observation);
    expect(issues.filter(issue => issue.code?.startsWith('profile-slice-'))).toEqual([]);
  }));

});
