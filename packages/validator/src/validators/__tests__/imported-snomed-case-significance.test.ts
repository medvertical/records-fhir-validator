import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { ValueSetValidator } from '../valueset-validator.js';
import type { CodeSystem } from '../valueset-types.js';

const system = 'http://snomed.info/sct';
const version = `${system}/900000000000207008/version/20250201`;
const prefix = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const valueSet = 'https://example.test/ValueSet/case-significance';
const sensitive = '900000000000017005';
const initial = '900000000000020002';
const insensitive = '900000000000448009';
const scalar = (url: string, value: unknown, type = 'valueString') => ({ url, [type]: value });
type Label = { value: string; significance?: unknown; active?: boolean; duplicate?: boolean; wrongType?: boolean };

// Synthetic descriptions test interpretation of the source contract, not a terminology edition's contents.
function projection(labels: Label[]): CodeSystem {
  const descriptions = labels.map((label, index) => ({ url: prefix + 'description', extension: [
    scalar('id', String(index)), scalar('language', 'en', 'valueCode'),
    scalar('kind', '900000000000013009', 'valueCode'), scalar('value', label.value),
    scalar('active', label.active !== false, 'valueBoolean'),
    ...(label.significance === undefined ? [] : [scalar('caseSignificance', label.significance, label.wrongType ? 'valueString' : 'valueCode')]),
    ...(label.duplicate ? [scalar('caseSignificance', insensitive, 'valueCode')] : []),
  ] }));
  return { resourceType: 'CodeSystem', url: system, version, content: 'fragment', caseSensitive: true,
    extension: [{ url: prefix + 'source', extension: [
      scalar('contract', 'records.fhirsmith.terminology-projection.v1', 'valueCode'),
      scalar('format', 'snomed', 'valueCode'), scalar('sha256', '0'.repeat(64)),
      scalar('businessVersion', version), scalar('displayLanguageMatch', 'base-language', 'valueCode'),
    ] }], concept: [{ code: '123456', designation: labels.flatMap((label, index) => label.active === false ? [] : [{
      language: 'en', value: label.value, extension: [descriptions[index]],
    }]), extension: [{ url: prefix + 'label-coverage', extension: [
      scalar('completeSourceDescriptions', true, 'valueBoolean'), scalar('sourceDescriptionCount', labels.length, 'valueInteger'),
    ] }, ...descriptions.filter((_entry, index) => labels[index].active === false)] }],
  } as unknown as CodeSystem;
}

afterEach(() => vi.restoreAllMocks());
function validator(labels: Label[]) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: true,
    serverDelegation: { validateCodes: false, expandValueSets: false } });
  expect(values.registerExternalTerminologyResource(projection(labels), 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSet,
    compose: { include: [{ system, version }] } }, 'R4')).toBe(true);
  return values;
}

const cases: Array<{ name: string; labels: Label[]; display: string; expected: 'accepted' | 'mismatch' | 'unverified'; inactive?: boolean }> = [
  { name: 'case-sensitive exact label', labels: [{ value: 'DNA variant', significance: sensitive }], display: 'DNA variant', expected: 'accepted' },
  { name: 'case-sensitive acronym mutation', labels: [{ value: 'DNA variant', significance: sensitive }], display: 'dna variant', expected: 'mismatch' },
  { name: 'case-sensitive initial mutation', labels: [{ value: 'DNA variant', significance: sensitive }], display: 'dNA variant', expected: 'mismatch' },
  { name: 'initial-only first character', labels: [{ value: 'DNA variant', significance: initial }], display: 'dNA variant', expected: 'accepted' },
  { name: 'initial-only Unicode character', labels: [{ value: '𐐀 variant', significance: initial }], display: '𐐨 variant', expected: 'accepted' },
  { name: 'initial-only internal acronym', labels: [{ value: 'DNA variant', significance: initial }], display: 'Dna variant', expected: 'mismatch' },
  { name: 'initial-only later word', labels: [{ value: 'DNA variant', significance: initial }], display: 'DNA Variant', expected: 'mismatch' },
  { name: 'fully insensitive', labels: [{ value: 'Measurement procedure', significance: insensitive }], display: 'MEASUREMENT PROCEDURE', expected: 'accepted' },
  { name: 'no whitespace permission', labels: [{ value: 'Measurement procedure', significance: insensitive }], display: 'Measurement  procedure', expected: 'mismatch' },
  { name: 'legacy exact label', labels: [{ value: 'DNA variant' }], display: 'DNA variant', expected: 'accepted' },
  { name: 'legacy case mutation', labels: [{ value: 'DNA variant' }], display: 'dna variant', expected: 'unverified' },
  { name: 'unknown significance', labels: [{ value: 'DNA variant', significance: 'unknown' }], display: 'dna variant', expected: 'unverified' },
  { name: 'unknown significance unrelated spelling', labels: [{ value: 'DNA variant' }], display: 'RNA variant', expected: 'mismatch' },
  { name: 'malformed significance datatype', labels: [{ value: 'DNA variant', significance: sensitive, wrongType: true }], display: 'dna variant', expected: 'unverified' },
  { name: 'non-string significance', labels: [{ value: 'DNA variant', significance: 42 }], display: 'dna variant', expected: 'unverified' },
  { name: 'duplicate significance', labels: [{ value: 'DNA variant', significance: sensitive, duplicate: true }], display: 'dna variant', expected: 'unverified' },
  { name: 'another accepted active description', labels: [{ value: 'DNA variant', significance: sensitive }, { value: 'dna variant', significance: sensitive }], display: 'dna variant', expected: 'accepted' },
  { name: 'inactive insensitive alias', labels: [{ value: 'New label', significance: insensitive }, { value: 'Old label', significance: insensitive, active: false }], display: 'OLD LABEL', expected: 'mismatch', inactive: true },
  { name: 'inactive sensitive mutation is not an inactive match', labels: [{ value: 'New label', significance: insensitive }, { value: 'DNA variant', significance: sensitive, active: false }], display: 'dna variant', expected: 'mismatch', inactive: false },
  { name: 'unknown active case prevents inactive rejection', labels: [{ value: 'DNA variant' }, { value: 'dna variant', significance: insensitive, active: false }], display: 'dna variant', expected: 'unverified' },
];

for (const route of ['coding', 'binding'] as const) {
  describe(`${route} honors imported SNOMED description case significance`, () => {
    it.each(cases)('$name', async ({ labels, display, expected, inactive }) => {
      const values = validator(labels), coding = { system, version, code: '123456', display };
      for (let round = 0; round < 2; round++) {
        const issues = route === 'binding'
          ? await values.validateBinding(coding, { strength: 'required', valueSet }, 'Observation.code', { fhirVersion: 'R4' })
          : buildCodeSystemResultIssues(coding,
            await values.validateCodeInCodeSystem(coding.code, system, display, 'R4', version), 'Observation.code', 0, false);
        const mismatches = issues.filter(issue => issue.code === 'terminology-display-mismatch');
        expect(mismatches).toHaveLength(expected === 'mismatch' ? 1 : 0);
        expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(expected === 'unverified');
        if (inactive !== undefined) expect(mismatches[0]?.message.startsWith('Inactive Display Name')).toBe(inactive);
      }
    });
  });
}
