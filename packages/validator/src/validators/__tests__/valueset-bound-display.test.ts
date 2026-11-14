import { afterEach, describe, expect, it } from 'vitest';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import type { ValueSet, ValueSetComposeInclude } from '../valueset-types.js';
import { matchesBoundValueSetDisplay } from '../valueset-bound-display.js';

const system = 'http://snomed.info/sct';
const edition = `${system}/11000274103/version/20240515`;
const url = 'https://example.test/ValueSet/context-labels';
const original = getProfileSource();
afterEach(() => setProfileSource(original));
function valueSet(): ValueSet {
  return { resourceType: 'ValueSet', url, version: '1.7.0', status: 'active', compose: { include: [{ system, version: edition,
    concept: [{ code: '763158003', display: 'Medicinal product (product)', designation: [{ language: 'de', value: 'Medizinprodukt' }] }] }] } };
}
function validator(selected = valueSet()) {
  setProfileSource({});
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', reportUnverifiedBindings: true });
  expect(values.registerExternalTerminologyResource(selected, 'R4')).toBe(true);
  return values;
}
async function displayIssues(values: ValueSetValidator, display = 'Medicinal product (product)', version?: string,
  displayLanguage?: string, reference = `${url}|1.7.0`) {
  return (await values.validateBinding({ system, code: '763158003', display, ...(version ? { version } : {}) },
    { strength: 'required', valueSet: reference }, 'Observation.code', { fhirVersion: 'R4', displayLanguage }))
    .filter(issue => issue.code.startsWith('terminology-display-'));
}

describe('explicit ValueSet-owned labels without CodeSystem authority', () => {
  it.each([undefined, edition])('accepts its declared label in binding edition %s cold/warm', async version => {
    const values = validator();
    for (let round = 0; round < 2; round++) expect(await displayIssues(values, undefined, version)).toEqual([]);
    expect(await values.validateCodeInLocalCodeSystemWithLanguage('763158003', system, undefined, 'R4', edition)).toBeNull();
  });
  it('accepts its explicit designation but retains an unavailable display language', async () => {
    const values = validator();
    expect(await displayIssues(values, 'Medizinprodukt', undefined, 'de')).toEqual([]);
    expect(await displayIssues(values, 'Medizinprodukt', undefined, 'fr')).toContainEqual(
      expect.objectContaining({ code: 'terminology-display-unverified' }));
  });
  it('does not turn an unlisted synonym into an authoritative mismatch or an acceptance', async () => {
    expect(await displayIssues(validator(), 'A possible external synonym')).toEqual([
      expect.objectContaining({ code: 'terminology-display-unverified' })]);
  });
  it.each([`${system}/11000274103/version/20250515`, `${system}/900000000000207008/version/20240501`])(
    'retains an unavailable Coding.version %s as unknown', async version => {
      expect(await displayIssues(validator(), undefined, version)).toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
    });
  it('does not borrow another ValueSet version', async () => {
    expect(await displayIssues(validator(), undefined, undefined, undefined, `${url}|9.9.9`))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });
  it.each(['filter', 'intersection', 'wildcard', 'modifier', 'exclude'] as const)('keeps unresolved %s context unverified', async kind => {
    const selected = valueSet(); const entry = selected.compose!.include![0];
    if (kind === 'filter') entry.filter = [{ property: 'unsupported', op: '=', value: 'x' }];
    if (kind === 'intersection') entry.valueSet = ['https://example.test/ValueSet/missing'];
    if (kind === 'wildcard') entry.version = '*';
    if (kind === 'exclude') selected.compose!.exclude = [{ system, filter: [{ property: 'unsupported', op: '=', value: 'x' }] }];
    if (kind === 'modifier') Object.assign(entry, { modifierExtension: [{ url: 'https://example.test/unknown', valueBoolean: true }] });
    expect(await displayIssues(validator(selected))).toContainEqual(expect.objectContaining({ code: 'terminology-display-unverified' }));
  });
  it('keeps a selected CodeSystem display mismatch authoritative', async () => {
    const values = validator();
    expect(values.registerExternalTerminologyResource({ resourceType: 'CodeSystem', url: system, version: edition,
      content: 'complete', language: 'en', concept: [{ code: '763158003', display: 'Selected source label' }] }, 'R4')).toBe(true);
    expect(await displayIssues(values)).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });
  it('does not transfer a declared label to another code or CodeSystem', async () => {
    const selected = valueSet();
    const includes = selected.compose!.include as ValueSetComposeInclude[];
    includes[0].system = 'https://example.test/CodeSystem/other';
    const values = validator(selected);
    expect(await matchesBoundValueSetDisplay({ codeInfo: { system, code: '763158003', display: 'Medicinal product (product)' },
      reference: `${url}|1.7.0`, loader: values.getDefinitionLookup().packageLoader,
      fhirVersion: 'R4', resolveMembership: async () => 'valid' })).toBe(false);
    const issues = await values.validateBinding({ system, code: '763158003', display: 'Medicinal product (product)' },
      { strength: 'required', valueSet: `${url}|1.7.0` }, 'Observation.code', { fhirVersion: 'R4' });
    expect(issues.some(issue => issue.severity === 'error')).toBe(true);
  });
});
