import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { ValueSetPackageLoader } from '../valueset-package-loader.js';
import { createValidationDependencySnapshot } from '../../validation-dependency-snapshot.js';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { validateComplexTypeSubElement } from '../complex-type-sub-element-validation.js';
import { validateExtensionValueElements } from '../extension-value-profile-validation.js';
import type { TypeValidator } from '../type-validator.js';
import type { ElementRulesValidator } from '../element-rules-validator.js';
import type { CodeSystem, ValueSet } from '../valueset-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import mii from './fixtures/mii-nlp-codesystem.json';
import miiValueSet from './fixtures/mii-nlp-valueset.json';
import ihe from './fixtures/ihe-property-codesystem.json';
import hl7 from './fixtures/hl7-format-valueset.json';

const originalSource = getProfileSource();
const opaque = [{ property: 'unknown-property', op: '=' as const, value: 'opaque' }];
const modifierExtension = [{ url: 'https://example.test/opaque', valueBoolean: true }];
afterEach(() => { vi.restoreAllMocks(); setProfileSource(originalSource); });
function validator(cs: unknown = mii, vs: unknown = miiValueSet) {
  setProfileSource({});
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: true,
    serverDelegation: { validateCodes: false, expandValueSets: false } });
  if (cs) expect(values.registerExternalTerminologyResource(cs, 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource(vs, 'R4')).toBe(true);
  return values;
}
function derived(version?: string): ValueSet {
  return { ...miiValueSet, compose: { include: [{ system: mii.url, version, filter: opaque }] } };
}
function verify(issues: ValidationIssue[], display: 'P' | 'N' | 'U') {
  expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified',
    details: expect.objectContaining({ validationStatus: 'incomplete' }) }));
  expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(display === 'N' ? 1 : 0);
  expect(issues.filter(issue => issue.code === 'terminology-display-unverified')).toHaveLength(display === 'U' ? 1 : 0);
}
describe('own display and unknown filter membership', () => {
  it.each([undefined, mii.version])('sole actual edition %s preserves display P/N/U cold/warm', async version => {
    const values = validator(mii, derived(version));
    const selected = vi.spyOn(ValueSetPackageLoader.prototype, 'loadLocalTerminologyAuthority');
    for (let round = 0; round < 2; round++) for (const [language, display, verdict] of [
      ['de-DE', 'Surrogiertes Dokument', 'P'], ['de-DE', 'Surrogated document', 'N'], ['fr-FR', 'Surrogated document', 'U'],
    ] as const) {
      const raw = { system: mii.url, code: 'surrogated', display }; const before = structuredClone(raw);
      const issues = await values.validateBinding(raw, { strength: 'required', valueSet: miiValueSet.url },
        'Observation.code', { fhirVersion: 'R4', displayLanguage: language });
      verify(issues, verdict); expect(raw).toEqual(before);
    }
    const results = await Promise.all(selected.mock.results.filter(result => result.type === 'return').map(result => result.value));
    expect(results.some(result => result?.kind === 'code-system' && JSON.stringify(result.codeSystem) === JSON.stringify(mii))).toBe(true);
  });
  it.each(['P', 'N', 'U'] as const)('unchanged IHE1.4.0 and THO2.1.0 have own display %s beside membership U', async verdict => {
    const values = validator(ihe, hl7);
    for (let round = 0; round < 2; round++) verify(await values.validateBinding({ system: ihe.url,
      code: 'urn:ihe:qrph:mch:2009', display: verdict === 'N' ? 'Wrong' : 'QRPH MCH' },
    { strength: 'required', valueSet: hl7.url }, 'DocumentReference.content.format',
    { fhirVersion: 'R4', displayLanguage: verdict === 'U' ? 'fr-FR' : undefined }), verdict);
  });
  it.each(['P', 'N', 'U'] as const)('actual UN-M49 provider own display %s beside membership U', async verdict => {
    const system = 'http://unstats.un.org/unsd/methods/m49/m49.htm';
    const vs = { ...miiValueSet, compose: { include: [{ system, filter: opaque }] } };
    const values = validator(null, vs); const selected = vi.spyOn(ValueSetPackageLoader.prototype, 'loadLocalTerminologyAuthority');
    for (let round = 0; round < 2; round++) verify(await values.validateBinding({ system, code: '001',
      display: verdict === 'N' ? 'Wrong' : 'World' }, { strength: 'required', valueSet: vs.url }, 'Patient.address.country',
    { fhirVersion: 'R4', displayLanguage: verdict === 'U' ? 'fr-FR' : 'en' }), verdict);
    const results = await Promise.all(selected.mock.results.filter(result => result.type === 'return').map(result => result.value));
    expect(results.some(result => result?.kind === 'provider')).toBe(true);
  });
  it.each(['datatype', 'extension'] as const)('%s binding owner preserves separate display N', async owner => {
    const values = validator(ihe, hl7); const raw = { system: ihe.url, code: 'urn:ihe:qrph:mch:2009', display: 'Wrong' };
    const binding = { strength: 'required' as const, valueSet: hl7.url };
    const issues = owner === 'datatype' ? await validateComplexTypeSubElement({ value: { type: { coding: [raw] } },
      elementPath: 'Identifier', typeCode: 'Identifier', basePath: 'Patient.identifier', profileUrl: 'https://example.test/Profile', fhirVersion: 'R4',
      subElementDef: { path: 'Identifier.type', type: [{ code: 'CodeableConcept' }], binding } },
    { valueSetValidator: values, validateNested: async () => [] }) : await validateExtensionValueElements({
      extension: { url: 'https://example.test/Extension', valueCoding: raw }, path: 'Patient.extension[0]', profileUrl: 'https://example.test/Profile',
      valueElements: [{ path: 'Extension.value[x]', type: [{ code: 'Coding' }], binding }],
      context: { resource: { resourceType: 'Patient' }, fhirVersion: 'R4', strictMode: false, profileUrl: 'https://example.test/Profile',
        profileSD: { resourceType: 'StructureDefinition', url: 'https://example.test/Profile', name: 'Synthetic', status: 'draft', kind: 'resource', abstract: false, type: 'Patient' },
        getValueAtPath: () => undefined }, valueSetValidator: values,
      typeValidator: { validate: async () => [] } as unknown as TypeValidator,
      elementRulesValidator: { validate: () => [] } as unknown as ElementRulesValidator,
    });
    verify(issues, 'N');
  });
});
describe('own selection cannot remove edition or label uncertainty', () => {
  const scopes: Array<[string, ValueSet]> = [
    ['wildcard', derived('*')],
    ['systemless imported alternative', { ...derived(mii.version), compose: { include: [...derived(mii.version).compose!.include!, { valueSet: ['https://example.test/missing'] }] } }],
    ['matching imported constraint', { ...derived(mii.version), compose: { include: [{ ...derived(mii.version).compose!.include![0], valueSet: ['https://example.test/missing'] }] } }],
    ['contradictory editions', { ...derived(mii.version), compose: { include: [{ system: `${mii.url}|different`, version: mii.version, filter: opaque }] } }],
    ['malformed pipe canonical', { ...derived(mii.version), compose: { include: [{ system: `${mii.url}|${mii.version}|foreign`, version: mii.version, filter: opaque }] } }],
    ['empty pipe edition', { ...derived(), compose: { include: [{ system: `${mii.url}|`, filter: opaque }] } }],
    ['root modifier', { ...derived(mii.version), modifierExtension } as ValueSet],
    ['compose modifier', { ...derived(mii.version), compose: { ...derived(mii.version).compose, modifierExtension } } as ValueSet],
    ['include modifier', { ...derived(mii.version), compose: { include: [{ ...derived(mii.version).compose!.include![0], modifierExtension }] } } as ValueSet],
    ['missing actual edition', derived('missing')],
  ];
  it.each(scopes)('%s keeps display U', async (_name, vs) => {
    const issues = await validator(mii, vs).validateBinding({ system: mii.url, code: 'surrogated', display: 'Surrogiertes Dokument' },
      { strength: 'required', valueSet: vs.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
    verify(issues, 'U');
  });
  it.each(['Surrogiertes Dokument', 'Surrogated document'])('unavailable ValueSet edition cannot borrow bare body labels=%s', async display => {
    const values = validator(mii, derived(mii.version));
    const issues = await values.validateBinding({ system: mii.url, code: 'surrogated', display },
      { strength: 'required', valueSet: `${miiValueSet.url}|missing-edition` }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
    verify(issues, 'U');
  });
  it.each([{}, 0, 'opaque'])('malformed imported selector %j cannot issue a display witness', async valueSet => {
    const vs = { ...derived(mii.version), compose: { include: [{ ...derived(mii.version).compose!.include![0], valueSet }] } };
    verify(await validator(mii, vs).validateBinding({ system: mii.url, code: 'surrogated', display: 'Surrogiertes Dokument' },
      { strength: 'required', valueSet: miiValueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' }), 'U');
  });
  it.each(['Surrogiertes Dokument', 'Surrogated document'])('unknown imported exclusion keeps membership U beside own label=%s', async display => {
    const vs = derived(mii.version); vs.compose!.exclude = [{ valueSet: ['https://example.test/missing-exclusion'] }];
    verify(await validator(mii, vs).validateBinding({ system: mii.url, code: 'surrogated', display },
      { strength: 'required', valueSet: miiValueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' }),
    display === 'Surrogiertes Dokument' ? 'P' : 'N');
  });
  it.each([`${mii.url}|${mii.version}|foreign`, `${mii.url}|other-edition`])('Coding.system=%s cannot invent own selection', async system => {
    verify(await validator(mii, derived(mii.version)).validateBinding({ system, code: 'surrogated', display: 'Surrogiertes Dokument' },
      { strength: 'required', valueSet: miiValueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' }), 'U');
  });
  it('captured actual definitions keep separate own display and membership decisions', async () => {
    const values = validator(mii, derived(mii.version));
    const captured = createValidationDependencySnapshot({ requireProfileLookup: false });
    await captured.run(async () => {
      for (let round = 0; round < 2; round++) for (const [display, verdict] of [
        ['Surrogiertes Dokument', 'P'], ['Surrogated document', 'N'],
      ] as const) verify(await values.validateBinding({ system: mii.url, code: 'surrogated', display },
      { strength: 'required', valueSet: miiValueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' }), verdict);
    });
    expect(captured.evidence().status).toBe('captured');
    expect(captured.evidence().terminologyCount).toBeGreaterThan(0);
  });
  it.each(['code-system', 'concept', 'ancestor', 'duplicate'] as const)('%s cannot issue a new independent label witness', async kind => {
    const cs = structuredClone(mii) as CodeSystem; const concept = cs.concept!.find(entry => entry.code === 'surrogated')!;
    if (kind === 'code-system') Object.assign(cs, { modifierExtension });
    if (kind === 'concept') Object.assign(concept, { modifierExtension });
    if (kind === 'ancestor') cs.concept = [{ code: 'opaque-parent', concept: [concept], ...{ modifierExtension } }];
    if (kind === 'duplicate') cs.concept!.push(structuredClone(concept));
    verify(await validator(cs, derived()).validateBinding({ system: mii.url, code: 'surrogated', display: 'Surrogiertes Dokument' },
      { strength: 'required', valueSet: miiValueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' }), 'U');
  });
  it.each(['Surrogated document', 'Wrong', 'Surrogiertes Dokument'])('opaque designation cannot witness or erase own label=%s', async display => {
    const cs = structuredClone(mii); const concept = cs.concept.find(entry => entry.code === 'surrogated')!;
    Object.assign(concept.designation[0], { modifierExtension });
    const values = validator(cs, derived());
    const issues = await values.validateBinding({ system: mii.url, code: 'surrogated', display },
      { strength: 'required', valueSet: miiValueSet.url }, 'Observation.code', { fhirVersion: 'R4' });
    verify(issues, display === 'Surrogiertes Dokument' ? 'P' : 'U');
    const result = await values.validateCodeInLocalCodeSystemWithLanguage('surrogated', mii.url, display, 'R4', mii.version);
    expect(result?.reason).toBe(display === 'Surrogiertes Dokument' ? undefined : 'display-unverified');
  });
});
