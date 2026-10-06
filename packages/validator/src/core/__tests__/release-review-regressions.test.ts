import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareValidatedProfileConformance } from '../../validators/slice-validated-conformance';
import { createProfileConformanceCheck } from '../multi-aspect-profile-conformance';
import { validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import { derivePackagePinContext, resolvePinnedCanonicalSource, clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { bindingPinSource, withPinnedCanonicalSource } from '../../package/canonical-pin-scope';
import { ValueSetValidator } from '../../validators/valueset-validator';
import { ValueSetCache } from '../../validators/valueset-cache';
import { ValueSetPackageResourceAccess } from '../../validators/valueset-package-resource-access';
import { rankedDeclarationsForCanonical } from '../../validators/valueset-package-declaration-search';
import { clearPackageCanonicalIndex } from '../../validators/valueset-package-search';
import { ValueSetPackageLoader } from '../../validators/valueset-package-loader';
import { loadConceptMapCodeSystems, validateConceptMapResource } from '../../validators/conceptmap-resource-validator';
import type { StructureDefinition } from '../structure-definition-types';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import type { ValidateOneFn } from '../multi-aspect-types';

const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  clearCanonicalPinCaches();
  clearPackageCanonicalIndex();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

it('a second validation cannot reuse an undecidable slice verdict from the first', async () => {
  const url = 'https://review.test/StructureDefinition/patient';
  const patient = { resourceType: 'Patient' };
  const slice = { sliceName: 'patient', path: 'Bundle.entry', min: 0, max: '*',
    childTypes: new Map([['resource', [{ code: 'Resource', profile: [url] }]]]) };
  const slicing = { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'open' } as const;
  const options = [patient].map(resource => ({ resource }));
  const resolve = async () => ({ type: 'Patient' });
  const first = await prepareValidatedProfileConformance(options, [slice], { ...slicing, discriminator: [...slicing.discriminator] }, resolve, async () => false);
  expect(first[0].validatedProfileConformance?.(patient, [url])).toBe(false);
  const second = await prepareValidatedProfileConformance(options, [slice], { ...slicing, discriminator: [...slicing.discriminator] }, resolve, async () => undefined);
  expect(second[0].validatedProfileConformance?.(patient, [url])).toBeUndefined();
});

it('an executor failure is not proof of profile non-conformance', async () => {
  const validateOne: ValidateOneFn = async () => ({ isValid: false, aspects: [{
    aspect: 'profile', isValid: false, validationTime: 0,
    issues: [{ code: 'internal-error', severity: 'error', message: 'executor unavailable' }],
  }] });
  const check = createProfileConformanceCheck({
    sdLoader: { loadProfile: async () => ({ type: 'Patient' }) } as unknown as MultiAspectDeps['sdLoader'],
    validateOne, fhirVersion: 'R4', recursionDepth: 0,
  })!;
  await expect(check({ resourceType: 'Patient' }, 'https://review.test/patient')).resolves.toBeUndefined();
});

it('a missing alternative target profile leaves the OR condition undecided', async () => {
  const a = 'https://review.test/StructureDefinition/patient-a';
  const b = 'https://review.test/StructureDefinition/patient-b';
  const issues = await validateReferenceTargetProfileConformance({
    resource: { resourceType: 'Observation', subject: { reference: 'Patient/1' } },
    structureDef: { resourceType: 'StructureDefinition', type: 'Observation', snapshot: { element: [{
      id: 'Observation.subject', path: 'Observation.subject', type: [{ code: 'Reference', targetProfile: [a, b] }],
    }] } } as StructureDefinition,
    referenceTargetValidator: new ReferenceTargetValidator(),
    resolveReference: () => ({ resourceType: 'Patient', id: '1' }),
    conformsTo: async (_resource, profile) => profile === a ? false : undefined,
  });
  expect(issues.filter(issue => issue.code === 'reference-target-profile-noncompliant')).toEqual([]);
});

it('another IG cannot overwrite the dependency source of an in-flight lookup', async () => {
  const store = await mkdtemp(path.join(tmpdir(), 'records-release-review-'));
  folders.push(store);
  const canonical = 'https://review.test/ValueSet/shared';
  const a = 'https://review.test/a/StructureDefinition/Patient';
  const b = 'https://review.test/b/StructureDefinition/Patient';
  const packages = [
    { name: 'review.a', dependencies: { 'review.codes-a': '1.0.0' }, resourceType: 'StructureDefinition', url: a },
    { name: 'review.b', dependencies: { 'review.codes-b': '1.0.0' }, resourceType: 'StructureDefinition', url: b },
    { name: 'review.codes-a', dependencies: {}, resourceType: 'ValueSet', url: canonical },
    { name: 'review.codes-b', dependencies: {}, resourceType: 'ValueSet', url: canonical },
  ];
  for (const pkg of packages) {
    const folder = path.join(store, `${pkg.name}#1.0.0`, 'package');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: pkg.name, version: '1.0.0', dependencies: pkg.dependencies, fhirVersions: ['4.0.1'] }));
    await writeFile(path.join(folder, 'resource.json'), JSON.stringify({ resourceType: pkg.resourceType, url: pkg.url, version: '1.0.0', title: pkg.name,
      expansion: { contains: [{ system: 'https://review.test/codes', code: pkg.name }] } }));
    await writeFile(path.join(folder, '.index.json'), JSON.stringify({ files: [{ filename: 'resource.json', resourceType: pkg.resourceType, url: pkg.url, version: '1.0.0' }] }));
  }
  const contexts = await Promise.all(['review.a', 'review.b'].map(name =>
    derivePackagePinContext([store], { name, version: '1.0.0' })));
  const pins = await Promise.all(contexts.map(context => resolvePinnedCanonicalSource([store], context!, canonical, 'R4')));
  const loader = new ValueSetPackageLoader(new ValueSetCache(), new ValueSetPackageResourceAccess([store]));
  for (let round = 0; round < 2; round++) {
    await Promise.all(pins.map((pin, index) => withPinnedCanonicalSource(pin!, async () => {
      const ranked = await rankedDeclarationsForCanonical([store], 'ValueSet', canonical, '4', '1.0.0');
      expect(ranked?.[0]?.declaration.packageName).toBe(`review.codes-${index ? 'b' : 'a'}#1.0.0`);
      const loaded = await loader.loadValueSetResource(`${canonical}|1.0.0`, 'R4');
      expect(loaded).toMatchObject({ title: `review.codes-${index ? 'b' : 'a'}` });
    })));
  }
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([store]);
  const validator = new ValueSetValidator();
  validator.setResolutionConfig({ strategy: 'local-only' });
  for (let round = 0; round < 2; round++) {
    const results = await Promise.all(pins.map(pin => validator.validateBinding('review.codes-a', {
      strength: 'required', valueSet: `${canonical}|1.0.0`, [bindingPinSource]: pin!,
    }, 'Patient.gender', { fhirVersion: 'R4' })));
    expect(results[0].filter(issue => issue.severity === 'error')).toEqual([]);
    expect(results[1].some(issue => issue.code === 'terminology-binding-required-code')).toBe(true);
  }

});

it('ConceptMap groups using different versions of one CodeSystem keep both versions', async () => {
  const system = 'https://review.test/CodeSystem/example';
  vi.spyOn(ValueSetPackageLoader.prototype, 'loadCodeSystem').mockImplementation(async (_url, _major, version) => ({
    resourceType: 'CodeSystem', url: system, version, content: 'complete',
    concept: [{ code: version === '1' ? 'old-code' : 'new-code' }],
  }));
  const conceptMap = { resourceType: 'ConceptMap', group: [
    { source: system, sourceVersion: '1', element: [{ code: 'old-code' }] },
    { source: system, sourceVersion: '2', element: [{ code: 'new-code' }] },
  ] };
  const codeSystems = await loadConceptMapCodeSystems(conceptMap, 'R4');
  const issues = validateConceptMapResource(conceptMap, undefined, codeSystems);
  expect(issues.filter(issue => issue.severity === 'error')).toEqual([]);
});

it('ConceptMap source and target preserve inline canonical versions', async () => {
  const url = 'https://review.test/CodeSystem/versions';
  const systems = new Map([
    [`${url}|1`, { resourceType: 'CodeSystem' as const, url, version: '1', content: 'complete' as const, concept: [{ code: 'old' }] }],
    [`${url}|2`, { resourceType: 'CodeSystem' as const, url, version: '2', content: 'complete' as const, concept: [{ code: 'new' }] }],
  ]);
  const issues = validateConceptMapResource({ resourceType: 'ConceptMap', group: [{
    source: `${url}|1`, target: `${url}|2`, element: [{ code: 'old', target: [{ code: 'new' }] }],
  }] }, undefined, systems);
  expect(issues.filter(issue => issue.severity === 'error')).toEqual([]);
});

it('ConceptMap does not judge an unavailable version using an unversioned cached definition', () => {
  const url = 'https://review.test/CodeSystem/versions';
  const cache = new ValueSetCache();
  cache.setCodeSystem(url, { resourceType: 'CodeSystem', url, version: '1', content: 'complete', concept: [{ code: 'old' }] });
  const issues = validateConceptMapResource({ resourceType: 'ConceptMap', group: [{
    source: url, sourceVersion: '2', element: [{ code: 'new' }],
  }] }, cache);
  expect(issues.filter(issue => issue.code === 'tx-conceptmap-source-code-invalid')).toEqual([]);
});
