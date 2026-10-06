import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { toOperationOutcome, fromOperationOutcome } from '../../core/operation-outcome-converter';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createValidatorCoreRuntime } from '../../core/validator-core-components';
import { resolveRecordsValidatorConfig } from '../../core/validator-engine-config';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import { RecordsValidator } from '../../core/validator-engine';
import { ComplexTypeValidator } from '../complex-type-validator';
import { setProfileSource } from '../../persistence';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';

const system = 'https://example.test/CodeSystem/identifier';
const baseValueSet = 'https://example.test/ValueSet/base';
const profileValueSet = 'https://example.test/ValueSet/profile';
const profileUrl = 'https://example.test/StructureDefinition/Identifiers';
const roots: string[] = [];
const identifierElement: ElementDefinition = { id: 'Patient.identifier', path: 'Patient.identifier',
  min: 0, max: '*', type: [{ code: 'Identifier' }] };
const binding = { strength: 'required' as const, valueSet: `${profileValueSet}|2.3.0` };

afterEach(async () => {
  setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(options: { sliced?: boolean; noBinding?: boolean; missing?: boolean; closed?: boolean;
  fhirVersion?: 'R4' | 'R5'; children?: ElementDefinition[]; resourceType?: 'Patient' | 'Questionnaire' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'records-effective-bindings-')); roots.push(root);
  const store = path.join(root, 'packages'); const bundled = path.join(root, 'bundled');
  const folder = path.join(store, 'test.identifier#7.0.0', 'package');
  await mkdir(folder, { recursive: true }); await mkdir(bundled);
  const fhirVersion = options.fhirVersion ?? 'R4'; const release = fhirVersion === 'R4' ? '4.0.1' : '5.0.0';
  const children: ElementDefinition[] = options.children ?? (options.sliced ? [
    { ...identifierElement, slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
    { ...identifierElement, id: 'Patient.identifier:visit', sliceName: 'visit', patternIdentifier: { system: 'https://example.test/visit' } },
    { id: 'Patient.identifier:visit.type', path: 'Patient.identifier.type', min: 0, max: '1', type: [{ code: 'CodeableConcept' }], binding },
  ] : [identifierElement, { id: 'Patient.identifier.type', path: 'Patient.identifier.type', min: 0, max: '1',
    type: [{ code: 'CodeableConcept' }], ...(options.noBinding ? {} : { binding }) }]);
  const sd = (type: string, elements: ElementDefinition[], url = `http://hl7.org/fhir/StructureDefinition/${type}`,
    version = release): StructureDefinition => ({ resourceType: 'StructureDefinition', id: type, url, version,
      name: type, status: 'active', kind: type === 'Patient' || type === 'Questionnaire' ? 'resource' : 'complex-type', abstract: false, type,
      fhirVersion: release, snapshot: { element: [{ id: type, path: type, min: 0, max: '*' }, ...elements] } });
  const profile = sd(options.resourceType ?? 'Patient', children, profileUrl, '7.0.0');
  const resources = [profile,
    sd('Identifier', [
      { id: 'Identifier.type', path: 'Identifier.type', min: 0, max: '1', type: [{ code: 'CodeableConcept' }],
        binding: { strength: 'extensible', valueSet: `${baseValueSet}|1.0.0` } },
      { id: 'Identifier.system', path: 'Identifier.system', min: 0, max: '1', type: [{ code: 'uri' }] },
      { id: 'Identifier.value', path: 'Identifier.value', min: 0, max: '1', type: [{ code: 'string' }] },
    ]),
    sd('CodeableConcept', [{ id: 'CodeableConcept.coding', path: 'CodeableConcept.coding', min: 0, max: '*', type: [{ code: 'Coding' }] }]),
    sd('Coding', [
      { id: 'Coding.system', path: 'Coding.system', min: 0, max: '1', type: [{ code: 'uri' }] },
      { id: 'Coding.code', path: 'Coding.code', min: 0, max: '1', type: [{ code: 'code' }] },
    ]),
    sd('UsageContext', [
      { id: 'UsageContext.code', path: 'UsageContext.code', min: 1, max: '1', type: [{ code: 'Coding' }] },
      { id: 'UsageContext.value[x]', path: 'UsageContext.value[x]', min: 1, max: '1', type: [{ code: 'CodeableConcept' }, { code: 'Quantity' }],
        binding: { strength: 'extensible', valueSet: `${baseValueSet}|1.0.0` } },
    ]),
    sd('Quantity', [{ id: 'Quantity.value', path: 'Quantity.value', type: [{ code: 'decimal' }] }]),
    { resourceType: 'ValueSet', id: 'base', url: baseValueSet, version: '1.0.0', status: 'active',
      compose: { include: [{ system, concept: [{ code: 'a' }] }] } },
    ...(!options.missing ? [{ resourceType: 'ValueSet', id: 'profile', url: profileValueSet, version: '2.3.0', status: 'active',
      compose: { include: [{ system, concept: [{ code: 'b' }] }] } }] : []),
    { resourceType: 'CodeSystem', id: 'identifier', url: system, version: '1.0.0', status: 'active', content: 'complete',
      caseSensitive: true, concept: [{ code: 'a' }, { code: 'b' }] },
  ];
  const coreFolder = path.join(store, `hl7.fhir.${fhirVersion.toLowerCase()}.core#${release}`, 'package');
  await mkdir(coreFolder, { recursive: true });
  for (const [directory, name, version, installed] of [
    [folder, 'test.identifier', '7.0.0', resources.filter(resource => !resource.url.startsWith('http://hl7.org/fhir/StructureDefinition/'))],
    [coreFolder, `hl7.fhir.${fhirVersion.toLowerCase()}.core`, release, resources.filter(resource => resource.url.startsWith('http://hl7.org/fhir/StructureDefinition/'))],
  ] as const) {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version, fhirVersions: [release] }));
    await Promise.all(installed.map(resource => writeFile(path.join(directory, `${resource.resourceType}-${resource.id}.json`), JSON.stringify(resource))));
    await writeFile(path.join(directory, '.index.json'), JSON.stringify({ 'index-version': 2,
      files: installed.map(resource => ({ filename: `${resource.resourceType}-${resource.id}.json`, resourceType: resource.resourceType,
        url: resource.url, version: resource.version })) }));
  }
  const runtime = createValidatorCoreRuntime(resolveRecordsValidatorConfig({ packageCachePath: store, bundledProfilesPath: bundled,
    autoDownload: false, prewarmProfileSource: false, terminologyPackageDirectories: options.closed ? [] : [store] }));
  await runtime.components.sdLoader.waitForInitialization();
  expect(await runtime.components.sdLoader.loadProfile('http://hl7.org/fhir/StructureDefinition/Identifier', fhirVersion)).toMatchObject({ type: 'Identifier', version: release });
  runtime.components.valuesetValidator.setResolutionConfig({ strategy: 'local-only', reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: true });
  const validator = new ComplexTypeValidator(runtime.components.sdLoader, runtime.components.typeValidator, runtime.components.valuesetValidator);
  const validate = async (items: ReturnType<typeof identifier>[]) => {
    const resource = { resourceType: 'Patient', identifier: items };
    return validator.validateComplexTypeSubElements(items, identifierElement, 'Patient.identifier', profileUrl,
      profile, fhirVersion, resource);
  };
  return { validate, validator, store, bundled, profile, runtime };
}
function identifier(code: string, selected = true) {
  return { system: selected ? 'https://example.test/visit' : 'https://example.test/other', value: 'test',
    type: { coding: [{ system, code }] } };
}
function complete(issues: Awaited<ReturnType<ComplexTypeValidator['validateComplexTypeSubElements']>>) {
  return !issues.some(issue => issue.details?.validationComplete === false || issue.code.includes('unverified'));
}

describe('effective datatype bindings use the selected profile and occurrence', () => {
  it.each(['R4', 'R5'] as const)('replaces the base binding with the profile binding in %s', async fhirVersion => {
    const { validate } = await fixture({ fhirVersion });
    expect(await validate([identifier('b')])).toEqual([]);
    const invalid = await validate([identifier('a')]);
    expect(invalid).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', path: 'Patient.identifier[0].type',
      message: expect.stringContaining(`${profileValueSet}|2.3.0`) })]));
    expect(complete(invalid)).toBe(true);
    expect(invalid.every(issue => !issue.message.includes(baseValueSet))).toBe(true);
  });
  it('retains the base binding when the profile does not replace it', async () => {
    const { validate } = await fixture({ noBinding: true });
    expect(await validate([identifier('a')])).toEqual([]);
    expect(await validate([identifier('b')])).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'warning',
      message: expect.stringContaining(baseValueSet) })]));
  });
  it.each([{}, { sliced: true }])('reports missing effective terminology as Unknown (%j)', async options => {
    const { validate } = await fixture({ ...options, missing: true });
    const issues = await validate([identifier('b')]);
    expect(complete(issues)).toBe(false);
    expect(issues.some(issue => issue.message.includes(`${profileValueSet}|2.3.0`))).toBe(true);
    expect(issues.every(issue => issue.severity !== 'error')).toBe(true);
    expect(issues.every(issue => !issue.message.includes(baseValueSet))).toBe(true);
  });
  it.each([false, true])('isolates a sliced override from open siblings and cached reverse order (%s)', async reverse => {
    const { validate } = await fixture({ sliced: true });
    const items = [identifier('b'), identifier('b', false)]; if (reverse) items.reverse();
    const issues = await validate(items);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', path: `Patient.identifier[${reverse ? 0 : 1}].type` });
    expect(issues[0].message).toContain(baseValueSet);
    const reversed = await validate([...items].reverse());
    expect(reversed).toHaveLength(1);
    expect(reversed[0].path).toBe(`Patient.identifier[${reverse ? 1 : 0}].type`);
    const invalid = await validate([identifier('a')]);
    expect(invalid).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', path: 'Patient.identifier[0].type',
      message: expect.stringContaining(`${profileValueSet}|2.3.0`) })]));
    expect(complete(invalid)).toBe(true);
  });
  it('does not import a colon-labelled child into the unsliced definition cache', async () => {
    const { validate } = await fixture({ children: [identifierElement,
      { id: 'Patient.identifier:unresolved.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }], binding }] });
    const issues = await validate([identifier('b', false)]);
    expect(complete(issues)).toBe(false);
    expect(issues.every(issue => !issue.message.includes(baseValueSet))).toBe(true);
  });
  it('keeps explicit empty terminology stores closed despite a global answering store', async () => {
    const scoped = await fixture({ closed: true }); const global = await fixture();
    setProfileSource({ packageDirectories: [global.store] });
    const issues = await scoped.validate([identifier('b')]);
    expect(complete(issues)).toBe(false);
    expect(issues.some(issue => issue.message.includes(profileValueSet))).toBe(true);
    expect(issues.every(issue => issue.severity !== 'error')).toBe(true);
  });
  it.each(['unknown', 'overlap', 'duplicate'] as const)('does not select a binding from %s slice identity', async kind => {
    const sliced = { ...identifierElement, slicing: { discriminator: [{ type: 'pattern' as const, path: '$this' }], rules: 'open' as const } };
    const visit = { ...identifierElement, id: 'Patient.identifier:visit', sliceName: 'visit', patternIdentifier: { system: 'https://example.test/visit' } };
    const leaf = { id: 'Patient.identifier:visit.type', path: 'Patient.identifier.type', min: 0, max: '1', type: [{ code: 'CodeableConcept' }], binding };
    const children = kind === 'duplicate' ? [sliced, visit, leaf, { ...leaf, binding: { ...binding, valueSet: baseValueSet } }]
      : [sliced, visit, leaf, { ...identifierElement, id: 'Patient.identifier:other', sliceName: 'other',
        ...(kind === 'overlap' ? { patternIdentifier: { system: 'https://example.test/visit' } } : {}) },
        { ...leaf, id: 'Patient.identifier:other.type', binding: { ...binding, valueSet: baseValueSet } }];
    const { validate } = await fixture({ children });
    const issues = await validate([identifier('b')]);
    expect(complete(issues)).toBe(false);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ details: expect.objectContaining({ reason: 'binding-slice-membership-unverified' }) })]));
    expect(issues.every(issue => issue.severity !== 'error' && issue.severity !== 'warning')).toBe(true);
  });
  it('uses a reslice own discriminator and inherits the parent binding only outside that reslice', async () => {
    const children: ElementDefinition[] = [
      { ...identifierElement, slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
      { ...identifierElement, id: 'Patient.identifier:visit', sliceName: 'visit', patternIdentifier: { system: 'https://example.test/visit' },
        slicing: { discriminator: [{ type: 'pattern', path: 'value' }], rules: 'open' } },
      { id: 'Patient.identifier:visit.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }],
        binding: { strength: 'required', valueSet: `${baseValueSet}|1.0.0` } },
      { ...identifierElement, id: 'Patient.identifier:visit/special', sliceName: 'visit/special' },
      { id: 'Patient.identifier:visit/special.value', path: 'Patient.identifier.value', patternString: 'test' },
      { id: 'Patient.identifier:visit/special.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }], binding },
    ];
    const { validate } = await fixture({ children });
    expect(await validate([identifier('b')])).toEqual([]);
    expect(await validate([{ ...identifier('a'), value: 'ordinary' }])).toEqual([]);
    const negative = await validate([identifier('a')]);
    expect(negative).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', message: expect.stringContaining(profileValueSet) })]));
    expect(await validate([identifier('a', false)])).toEqual([]);
  });
  it('keeps failed package pinning incomplete instead of testing the unpinned fallback', async () => {
    const { validate, runtime } = await fixture();
    vi.spyOn(runtime.components.valuesetValidator, 'pinBindingToProfile').mockRejectedValue(new Error('controlled test failure'));
    const issues = await validate([identifier('b')]);
    expect(complete(issues)).toBe(false);
    expect(issues.every(issue => issue.severity !== 'error')).toBe(true);
  });
  it.each(['positive', 'negative', 'unknown'] as const)('publishes real effective bindings through Single and Multi (%s)', async kind => {
    const { store, bundled } = await fixture({ sliced: true, missing: kind === 'unknown' });
    const validator = new RecordsValidator({ packageCachePath: store, bundledProfilesPath: bundled, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [store], enableCaching: false });
    await validator.waitForInitialization();
    await validator.configureTerminologyResolution({ strategy: 'local-only', reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: true });
    const resource = { resourceType: 'Patient', identifier: [identifier(kind === 'negative' ? 'a' : 'b')] };
    const single = await validator.validate(resource, `${profileUrl}|7.0.0`, 'R4');
    const multi = await validator.validateAspects(resource, { profileUrl: `${profileUrl}|7.0.0`, fhirVersion: 'R4', aspects: ['structural', 'terminology'], settings: { ...DEFAULT_VALIDATION_SETTINGS_R4, terminologyResolution: { strategy: 'local-only', reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: true } } });
    for (const issues of [single, multi.aspects.flatMap(aspect => aspect.issues)]) {
      const findings = issues.filter(issue => issue.code.startsWith('terminology-binding-'));
      if (kind === 'positive') expect(findings).toEqual([]);
      else if (kind === 'negative') {
        expect(findings.filter(issue => issue.severity === 'error')).toHaveLength(1);
        expect(findings[0].message).toContain(`${profileValueSet}|2.3.0`);
      } else {
        expect(complete(findings)).toBe(false);
        expect(findings.every(issue => issue.code === 'terminology-binding-unverified')).toBe(true);
      }
      expect(findings.every(issue => !issue.message.includes(baseValueSet))).toBe(true);
      if (kind === 'positive') continue;
      const roundTrip = fromOperationOutcome(toOperationOutcome(findings));
      expect(roundTrip.map(issue => ({ code: issue.code, severity: issue.severity, path: issue.path, message: issue.message })))
        .toEqual(findings.map(issue => ({ code: issue.code, severity: issue.severity, path: issue.path, message: issue.message })));
      if (kind === 'unknown') expect(roundTrip.some(issue => issue.details?.validationComplete === false
        && issue.details?.validationStatus === 'incomplete')).toBe(true);
      else expect(roundTrip.every(issue => issue.details?.validationComplete !== false)).toBe(true);
    }
  });

  it('selects separate bindings for repeated Coding children without leaking occurrence state', async () => {
    const children: ElementDefinition[] = [identifierElement,
      { id: 'Patient.identifier.type.coding', path: 'Patient.identifier.type.coding', type: [{ code: 'Coding' }],
        binding: { strength: 'extensible', valueSet: `${baseValueSet}|1.0.0` },
        slicing: { discriminator: [{ type: 'pattern', path: 'display' }], rules: 'open' } },
      { id: 'Patient.identifier.type.coding:chosen', path: 'Patient.identifier.type.coding', sliceName: 'chosen',
        type: [{ code: 'Coding' }], binding },
      { id: 'Patient.identifier.type.coding:chosen.display', path: 'Patient.identifier.type.coding.display', patternString: 'chosen' },
    ];
    const { validate } = await fixture({ children });
    const item = { ...identifier('a'), type: { coding: [{ system, code: 'b', display: 'chosen' }, { system, code: 'a', display: 'other' }] } };
    // One base member satisfies Identifier.type; each Coding has its own binding.
    // This membership-only CodeSystem supplies no display labels.
    for (const reverse of [false, true]) {
      const codings = reverse ? [...item.type.coding].reverse() : item.type.coding;
      const issues = await validate([{ ...item, type: { coding: codings } }]);
      expect(issues).toHaveLength(3);
      expect(issues.every(issue => issue.code === 'terminology-display-unverified'
        && issue.details?.validationComplete === false)).toBe(true);
      expect(issues.map(issue => [issue.details?.code, issue.path]).sort()).toEqual([
        ['a', `Patient.identifier[0].type.coding[${reverse ? 0 : 1}].display`],
        ['a', `Patient.identifier[0].type.coding[${reverse ? 0 : 1}].display`],
        ['b', `Patient.identifier[0].type.coding[${reverse ? 1 : 0}].display`],
      ]);
    }
    const invalid = await validate([{ ...item, type: { coding: [{ system, code: 'a', display: 'chosen' }] } }]);
    expect(invalid).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error',
      path: 'Patient.identifier[0].type.coding[0]', message: expect.stringContaining(profileValueSet) })]));
  });
  it.each([false, true])('keeps an unknown inner slice incomplete only within its proved ancestor (%s)', async reverse => {
    const children: ElementDefinition[] = [
      { ...identifierElement, slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
      { ...identifierElement, id: 'Patient.identifier:visit', sliceName: 'visit', patternIdentifier: { system: 'https://example.test/visit' } },
      { id: 'Patient.identifier:visit.type.coding', path: 'Patient.identifier.type.coding', type: [{ code: 'Coding' }],
        slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
      { id: 'Patient.identifier:visit.type.coding:unresolved', path: 'Patient.identifier.type.coding', sliceName: 'unresolved', type: [{ code: 'Coding' }], binding },
    ];
    const { validate } = await fixture({ children });
    expect(await validate([identifier('a', false)])).toEqual([]);
    const items = [identifier('a'), identifier('a', false)]; if (reverse) items.reverse();
    const issues = await validate(items);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: `Patient.identifier[${reverse ? 1 : 0}].type.coding[0]`,
      details: { reason: 'binding-slice-membership-unverified', validationComplete: false } });
  });
  it('does not prove a ValueSet-only discriminator from an unavailable expansion', async () => {
    const children: ElementDefinition[] = [
      { ...identifierElement, slicing: { discriminator: [{ type: 'value', path: 'type' }], rules: 'open' } },
      { ...identifierElement, id: 'Patient.identifier:visit', sliceName: 'visit' },
      { id: 'Patient.identifier:visit.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }], binding },
    ];
    const { validate } = await fixture({ children });
    const issues = await validate([identifier('b')]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ details: expect.objectContaining({
      reason: 'binding-slice-membership-unverified', validationComplete: false }) })]));
    expect(issues.every(issue => issue.severity !== 'warning' && issue.severity !== 'error')).toBe(true);
  });

  it.each(['R4', 'R5'] as const)('applies an effective coded choice binding only to its declared coded choice in %s', async fhirVersion => {
    const parent: ElementDefinition = { id: 'Questionnaire.useContext', path: 'Questionnaire.useContext', type: [{ code: 'UsageContext' }] };
    const { validator, profile } = await fixture({ fhirVersion, resourceType: 'Questionnaire', children: [parent,
      { id: 'Questionnaire.useContext.value[x]', path: 'Questionnaire.useContext.value[x]',
        type: [{ code: 'CodeableConcept' }, { code: 'Quantity' }], binding },
    ] });
    const validate = (value: object) => validator.validateComplexTypeSubElements(value, parent, 'Questionnaire.useContext[0]', profileUrl,
      profile, fhirVersion, { resourceType: 'Questionnaire', useContext: [value] });
    expect(await validate({ code: { code: 'focus' }, valueCodeableConcept: { coding: [{ system, code: 'b' }] } })).toEqual([]);
    expect(await validate({ code: { code: 'focus' }, valueQuantity: { value: 2 } })).toEqual([]);
    const invalid = await validate({ code: { code: 'focus' }, valueCodeableConcept: { coding: [{ system, code: 'a' }] } });
    expect(invalid).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error',
      path: 'Questionnaire.useContext[0].valueCodeableConcept', message: expect.stringContaining(profileValueSet) })]));
  });

  it('keeps duplicate unsliced binding owners incomplete', async () => {
    const leaf: ElementDefinition = { id: 'Patient.identifier.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }], binding };
    const { validate } = await fixture({ children: [identifierElement, leaf, { ...leaf, binding: { ...binding, valueSet: baseValueSet } }] });
    const issues = await validate([identifier('b')]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ details: expect.objectContaining({
      reason: 'binding-slice-membership-unverified', validationComplete: false }) })]));
    expect(issues.every(issue => issue.severity !== 'warning' && issue.severity !== 'error')).toBe(true);
  });
  it('inherits the ValueSet when a profile tightens only binding strength', async () => {
    const { validate } = await fixture({ children: [identifierElement,
      { id: 'Patient.identifier.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }], binding: { strength: 'required' } }] });
    expect(await validate([identifier('a')])).toEqual([]);
    expect(await validate([identifier('b')])).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error',
      message: expect.stringContaining(baseValueSet) })]));
  });
  it('keeps an unavailable exact ValueSet version Unknown despite another locally available version', async () => {
    const { validate } = await fixture({ children: [identifierElement,
      { id: 'Patient.identifier.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }],
        binding: { ...binding, valueSet: `${profileValueSet}|9.0.0` } }] });
    const issues = await validate([identifier('b')]);
    expect(complete(issues)).toBe(false);
    expect(issues.some(issue => issue.message.includes(`${profileValueSet}|9.0.0`))).toBe(true);
    expect(issues.every(issue => issue.severity !== 'error')).toBe(true);
  });
  it('keeps malformed choice type metadata from suppressing a valid coded choice binding', async () => {
    const parent: ElementDefinition = { id: 'Questionnaire.useContext', path: 'Questionnaire.useContext', type: [{ code: 'UsageContext' }] };
    const { validator, profile } = await fixture({ resourceType: 'Questionnaire', children: [parent,
      { id: 'Questionnaire.useContext.value[x]', path: 'Questionnaire.useContext.value[x]',
        type: [{} as never, { code: 'CodeableConcept' }], binding }] });
    const value = { code: { code: 'focus' }, valueCodeableConcept: { coding: [{ system, code: 'a' }] } };
    const issues = await validator.validateComplexTypeSubElements(value, parent, 'Questionnaire.useContext[0]', profileUrl, profile, 'R4');
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error',
      path: 'Questionnaire.useContext[0].valueCodeableConcept', message: expect.stringContaining(profileValueSet) })]));
  });
  it('carries higher slice ancestors through the public Structural Single and Multi callers', async () => {
    const children: ElementDefinition[] = [
      { ...identifierElement, slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
      { ...identifierElement, id: 'Patient.identifier:visit', sliceName: 'visit', patternIdentifier: { system: 'https://example.test/visit' } },
      { id: 'Patient.identifier:visit.type', path: 'Patient.identifier.type', type: [{ code: 'CodeableConcept' }], binding },
      { id: 'Patient.identifier:visit.type.coding', path: 'Patient.identifier.type.coding', type: [{ code: 'Coding' }], binding },
    ];
    const { store, bundled } = await fixture({ children });
    const validator = new RecordsValidator({ packageCachePath: store, bundledProfilesPath: bundled, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [store], enableCaching: false });
    await validator.waitForInitialization();
    const settings = { ...DEFAULT_VALIDATION_SETTINGS_R4, terminologyResolution: { strategy: 'local-only' as const,
      reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: true } };
    for (const items of [[identifier('b'), identifier('a', false)], [identifier('a', false), identifier('b')]]) {
      const resource = { resourceType: 'Patient', identifier: items };
      const single = await validator.validate(resource, `${profileUrl}|7.0.0`, 'R4', settings);
      const multi = await validator.validateAspects(resource, { profileUrl: `${profileUrl}|7.0.0`, fhirVersion: 'R4',
        aspects: ['structural', 'terminology'], settings });
      for (const issues of [single, multi.aspects.flatMap(aspect => aspect.issues)]) {
        expect(issues.filter(issue => issue.code.startsWith('terminology-binding-'))).toEqual([]);
        expect(complete(issues)).toBe(true);
      }
    }
  });

});
