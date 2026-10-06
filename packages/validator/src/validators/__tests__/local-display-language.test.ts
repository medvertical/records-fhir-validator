import { afterEach, describe, expect, it, vi } from 'vitest';
import codeSystem from './fixtures/mii-nlp-codesystem.json';
import valueSet from './fixtures/mii-nlp-valueset.json';
import ingredients from './fixtures/mii-ingredient-codesystem.json';
import ingredientValueSet from './fixtures/mii-ingredient-valueset.json';
import { ValueSetValidator } from '../valueset-validator.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

const system = codeSystem.url;
const code = 'surrogated';
const coding = (display?: string, version = codeSystem.version) => ({ system, code, display, version });
const incomplete = (issues: ValidationIssue[]) => issues.some(issue => issue.details?.validationComplete === false);
afterEach(() => vi.restoreAllMocks());
function validator(cs: unknown = codeSystem, vs: unknown = valueSet) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: { validateCodes: false, expandValueSets: false } });
  expect(values.registerExternalTerminologyResource(cs, 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource(vs, 'R4')).toBe(true);
  return values;
}
const cases = [
  ['de-DE', 'Surrogiertes Dokument', 'P'], ['de-DE', 'Surrogated document', 'N'],
  ['en-NZ', 'Surrogated document', 'P'], ['en-NZ', 'Surrogiertes Dokument', 'N'],
  [undefined, 'Surrogiertes Dokument', 'P'], [undefined, 'Surrogated document', 'P'],
  ['fr-FR', 'Surrogiertes Dokument', 'U'], ['fr-FR', 'Surrogated document', 'U'],
] as const;
async function owner(values: ValueSetValidator, route: string, display: string | undefined, language?: string, version = codeSystem.version) {
  if (route === 'binding') return values.validateBinding(coding(display, version),
    { strength: 'required', valueSet: valueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: language });
  const result = await values.validateCodeInCodeSystem(code, system, display, 'R4', version, language);
  return buildCodeSystemResultIssues(coding(display, version), result, 'Observation.code', 0, false, false);
}
for (const route of ['coding', 'binding']) {
  describe(`${route} genuine MII language authority`, () => {
    it.each(cases)('language=%s display=%s => %s cold/warm', async (language, display, verdict) => {
      const values = validator();
      for (let round = 0; round < 2; round++) {
        const issues = await owner(values, route, display, language);
        const mismatches = issues.filter(issue => issue.code === 'terminology-display-mismatch');
        expect(mismatches).toHaveLength(verdict === 'N' ? 1 : 0);
        expect(incomplete(issues)).toBe(verdict === 'U');
        if (verdict === 'U') expect(issues).toContainEqual(expect.objectContaining({
          code: 'terminology-display-unverified', path: 'Observation.code.display',
          details: expect.objectContaining({ validationStatus: 'incomplete' }),
        }));
        if (verdict === 'N') expect(mismatches[0]).toMatchObject({ severity: 'error', path: 'Observation.code.display' });
      }
    });
    it('does not require language authority when no display was supplied', async () => {
      expect(await owner(validator(), route, undefined, 'fr-FR')).toEqual([]);
    });
    it('does not reuse missing opaque edition2026.0 as2026.0.1', async () => {
      const values = validator();
      if (route === 'coding') {
        expect(await values.validateCodeInLocalCodeSystemOnly(code, system, 'Wrong', 'R4', '2026.0')).toBeNull();
      } else {
        const issues = await owner(values, route, 'Wrong', 'de-DE', '2026.0');
        expect(issues.some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
        expect(incomplete(issues)).toBe(true);
      }
    });
    it('does not erase a complete CodeSystem unknown-code N when language coverage is absent', async () => {
      const values = validator();
      const result = await values.validateCodeInCodeSystem('not-a-published-code', system, 'Anything', 'R4', codeSystem.version, 'fr-FR');
      expect(result).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: false });
      expect(buildCodeSystemResultIssues({ system, code: 'not-a-published-code' }, result, 'Observation.code', 0, false))
        .toContainEqual(expect.objectContaining({ severity: 'error', code: 'terminology-code-invalid' }));
    });
    it('keeps actual unknown-language default distinct from a known requested designation', async () => {
      const values = validator(ingredients, ingredientValueSet);
      const raw = { system: ingredients.url, code: 'MIN', display: 'multiple ingredients', version: ingredients.version };
      const result = await values.validateCodeInCodeSystem(raw.code, raw.system, raw.display, 'R4', raw.version, 'de-DE');
      const issues = route === 'binding'
        ? await values.validateBinding(raw, { strength: 'required', valueSet: ingredientValueSet.url }, 'Medication.ingredient', { fhirVersion: 'R4', displayLanguage: 'de-DE' })
        : buildCodeSystemResultIssues(raw, result, 'Medication.ingredient', 0, false, false);
      expect(result.valid).toBe(true);
      expect(issues.some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
      expect(incomplete(issues)).toBe(true);
    });
  });
}
describe('versioned display lookup and label source boundaries', () => {
  it('uses Coding.version instead of a warmer bare neighboring edition', async () => {
    const values = validator({ ...codeSystem, version: 'edition-A', concept: [{ code, display: 'Edition A' }] });
    expect(values.registerExternalTerminologyResource({ ...codeSystem, version: 'edition-B', concept: [{ code, display: 'Edition B' }] }, 'R4')).toBe(true);
    for (const display of ['Edition A', 'Edition B']) {
      const issues = await owner(values, 'binding', display, 'de-DE', 'edition-A');
      expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(display === 'Edition A' ? 0 : 1);
      if (display === 'Edition B') expect(issues.find(issue => issue.code === 'terminology-display-mismatch')?.details?.expectedDisplay).toBe('Edition A');
    }
  });
  it('inherits untagged designation language from the actual CodeSystem', async () => {
    const values = validator({ ...codeSystem, concept: [{ code, display: 'Primary', designation: [{ value: 'Untagged' }, { language: 'en', value: 'English' }] }] });
    for (const route of ['coding', 'binding']) {
      expect(await owner(values, route, 'Untagged', 'de-DE')).toEqual([]);
      expect((await owner(values, route, 'Untagged', 'en-NZ')).filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(1);
    }
  });
  it('does not treat an en-prefix lookalike as English authority', async () => {
    const values = validator();
    for (const route of ['coding', 'binding']) expect(incomplete(await owner(values, route, 'Surrogated document', 'enochian'))).toBe(true);
  });
  it('does not pass an arbitrary supplied display when no label exists', async () => {
    const values = validator({ ...codeSystem, concept: [{ code }] });
    for (const route of ['coding', 'binding']) expect(incomplete(await owner(values, route, 'Arbitrary label'))).toBe(true);
  });
});

describe('alternative declared CodeSystem editions', () => {
  it.each(['P', 'U', 'N'] as const)('all includes participate; display decision=%s', async verdict => {
    const otherVersion = verdict === 'U' ? 'unavailable' : 'edition-B';
    const values = validator({ ...codeSystem, version: 'edition-A', concept: [{ code, display: 'Edition A' }] },
      { ...valueSet, compose: { include: [{ system, version: 'edition-A' }, { system, version: otherVersion }] } });
    if (verdict !== 'U') values.registerExternalTerminologyResource({ ...codeSystem, version: 'edition-B', concept: [{ code, display: 'Edition B' }] }, 'R4');
    const issues = await values.validateBinding({ system, code, display: verdict === 'P' ? 'Edition B' : 'Other' },
      { strength: 'required', valueSet: valueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
    expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(verdict === 'N' ? 1 : 0);
    expect(incomplete(issues)).toBe(verdict === 'U');
  });
});

describe('reviewed display authority branches', () => {
  it.each(['en-0', 'en-US-US', 'en-', 'english', 'EN-nz'])('malformed/canonical language %s cannot fabricate prefix P', async language => {
    const values = validator();
    for (const route of ['coding', 'binding']) {
      const issues = await owner(values, route, 'Surrogated document', language);
      expect(incomplete(issues)).toBe(language !== 'EN-nz');
      expect(issues.some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
    }
  });
  it.each([true, false])('only applicable include concepts can provide alternative P; member=%s', async applies => {
    const values = validator({ ...codeSystem, version: 'edition-A', concept: [{ code, display: 'Edition A' }] },
      { ...valueSet, compose: { include: [{ system, version: 'edition-A', concept: [{ code }] },
        { system, version: 'edition-B', concept: [{ code: applies ? code : 'other' }] }] } });
    values.registerExternalTerminologyResource({ ...codeSystem, version: 'edition-B', concept: [{ code, display: 'Edition B' }] }, 'R4');
    const issues = await values.validateBinding({ system, code, display: 'Edition B' },
      { strength: 'required', valueSet: valueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
    expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(applies ? 0 : 1);
    expect(incomplete(issues)).toBe(false);
  });
  it.each(['complete', 'fragment'] as const)('absent code in alternative %s definition has the right authority', async content => {
    const values = validator({ ...codeSystem, content, version: 'edition-A', concept: [{ code: 'other', display: 'Other' }] },
      { ...valueSet, compose: { include: [{ system, version: 'edition-A' }, { system, version: 'edition-B' }] } });
    values.registerExternalTerminologyResource({ ...codeSystem, version: 'edition-B', concept: [{ code, display: 'Edition B' }] }, 'R4');
    const issues = await values.validateBinding({ system, code, display: 'Wrong' },
      { strength: 'required', valueSet: valueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
    expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(content === 'complete' ? 1 : 0);
    expect(incomplete(issues)).toBe(content === 'fragment');
  });
  it('does not interpret an all-versions wildcard as a literal CS version', async () => {
    const values = validator(codeSystem, { ...valueSet, compose: { include: [{ system, version: '*' }] } });
    const issues = await values.validateBinding({ system, code, display: 'Surrogated document' },
      { strength: 'required', valueSet: valueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'en-NZ' });
    expect(issues.some(issue => issue.code === 'terminology-display-unverified' || issue.code === 'terminology-display-mismatch')).toBe(false);
  });
  it('retains known lifecycle N beside language U and display N', async () => {
    const values = validator({ ...codeSystem, concept: [{ code, display: 'German', designation: [{ language: 'en', value: 'English' }],
      property: [{ code: 'status', valueCode: 'retired' }, { code: 'deprecated', valueBoolean: true }] }] });
    for (const [language, verdict] of [['fr-FR', 'U'], ['en-NZ', 'N']] as const) {
      const issues = await owner(values, 'coding', 'German', language);
      expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['terminology-code-inactive', 'terminology-code-retired', 'terminology-code-deprecated']));
      expect(incomplete(issues)).toBe(verdict === 'U');
      expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(verdict === 'N' ? 1 : 0);
    }
  });
});

describe('display candidate membership belongs to its selected edition', () => {
  it.each([undefined, '*'] as const)('opaque %s branch cannot borrow allowed edition A membership', async version => {
    const values = validator({ ...codeSystem, version: 'edition-A', concept: [{ code, display: 'Edition A' }] },
      { ...valueSet, compose: { include: [{ system, version: 'edition-A' },
        { system, version, filter: [{ property: 'unknown-property', op: '=', value: 'opaque' }] }] } });
    values.registerExternalTerminologyResource({ ...codeSystem, version: 'edition-B', concept: [{ code, display: 'Edition B' }] }, 'R4');
    const issues = await values.validateBinding({ system, code, display: 'Edition B' },
      { strength: 'required', valueSet: valueSet.url }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
    expect(issues.filter(issue => issue.code === 'terminology-display-unverified')).toHaveLength(1);
    expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(0);
  });
});


describe('caller CodeSystem defaults keep membership and labels in the same edition', () => {
  it.each([
    [undefined, undefined, 'Edition A', false],
    [undefined, undefined, 'Edition B', true],
    ['edition-B', undefined, 'Edition B', false],
    [undefined, 'edition-B', 'Edition B', false],
    [undefined, 'edition-B', 'Edition A', true],
  ] as const)('Coding.version=%s compose.version=%s display=%s', async (codingVersion, composeVersion, display, mismatch) => {
    const values = validator({ ...codeSystem, version: 'edition-A', concept: [{ code, display: 'Edition A' }] },
      { ...valueSet, compose: { include: [{ system, ...(composeVersion ? { version: composeVersion } : {}) }] } });
    expect(values.registerExternalTerminologyResource({ ...codeSystem, version: 'edition-B', concept: [{ code, display: 'Edition B' }] }, 'R4')).toBe(true);
    values.setResolutionConfig({ strategy: 'local-only', servers: [], defaultCodeSystemVersions: { [system]: 'edition-A' },
      serverDelegation: { validateCodes: false, expandValueSets: false } });
    const original = { system, code, display, ...(codingVersion ? { version: codingVersion } : {}) };
    const bytes = JSON.stringify(original);
    for (let round = 0; round < 2; round++) {
      const issues = await values.validateBinding(original, { strength: 'required', valueSet: valueSet.url },
        'Observation.code', { fhirVersion: 'R4', displayLanguage: 'de-DE' });
      expect(incomplete(issues)).toBe(false);
      expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(mismatch ? 1 : 0);
      if (mismatch) expect(issues.find(issue => issue.code === 'terminology-display-mismatch')?.details?.expectedDisplay)
        .toBe((composeVersion ?? codingVersion) ? 'Edition B' : 'Edition A');
    }
    expect(JSON.stringify(original)).toBe(bytes);
  });
});
