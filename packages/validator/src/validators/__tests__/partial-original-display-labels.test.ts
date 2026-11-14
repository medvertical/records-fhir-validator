import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessLocalDisplay } from '../valueset-display-authority';
import type { CodeSystem, CodeSystemConcept } from '../valueset-types';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetValidator } from '../valueset-validator';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';
import { validateLocalCodeSystemCoding } from '../../core/executors/terminology-external-code-system-rules';

const coverageUrl = 'https://records-fhir.dev/StructureDefinition/imported-terminology-label-coverage';
const system: CodeSystem = { resourceType: 'CodeSystem', url: 'http://fhir.de/CodeSystem/bfarm/icd-10-gm',
  version: '2015', language: 'de', content: 'fragment', caseSensitive: true };
function concept(complete: unknown = false, count: unknown = 1) {
  return { code: 'A00.0', display: 'Originaltitel', extension: [{ url: coverageUrl, extension: [
    { url: 'completeSourceDescriptions', valueBoolean: complete },
    { url: 'sourceDescriptionCount', valueInteger: count },
  ] }] };
}

describe('explicitly partial original labels', () => {
  it.each([undefined, 'de', 'de-DE'])('accepts a supplied original title in %s', language => {
    expect(assessLocalDisplay(system, concept(), 'Originaltitel', language).outcome).toBe('accepted');
  });
  it.each([undefined, 'de', 'de-DE'])('does not reject another label against an incomplete label list in %s', language => {
    expect(assessLocalDisplay(system, concept(), 'Weitere Bezeichnung', language).outcome).toBe('unverified');
  });
  it.each(['en', 'fr', 'not_a_language'])('does not establish a requested language %s', language => {
    expect(assessLocalDisplay(system, concept(), 'Originaltitel', language).outcome).toBe('unverified');
  });
  it.each([[false, 0], [false, 2], [false, '1'], ['false', 1], [undefined, 1], [true, 1]])(
    'fails closed for unsupported coverage %s / %s', (complete, count) => {
      const selected = concept(false, count);
      selected.extension[0].extension[0].valueBoolean = complete;
      expect(assessLocalDisplay(system, selected, 'Originaltitel').outcome).toBe('unverified');
    },
  );
  it('keeps ordinary complete label behavior when the explicit partial contract is absent', () => {
    const ordinary = { code: 'A00.0', display: 'Originaltitel' };
    expect(assessLocalDisplay(system, ordinary, 'Andere Bezeichnung').outcome).toBe('mismatch');
  });
  it('rejects duplicate coverage declarations', () => {
    const selected = concept(); selected.extension.push(selected.extension[0]);
    expect(assessLocalDisplay(system, selected, 'Originaltitel').outcome).toBe('unverified');
  });
  it('fails closed for malformed extension storage', () => {
    const selected = { code: 'A00.0', display: 'Originaltitel', extension: {} };
    expect(assessLocalDisplay(system, selected, 'Originaltitel').outcome).toBe('unverified');
  });
  it('honors designations without claiming that they exhaust accepted labels', () => {
    const selected: CodeSystemConcept & ReturnType<typeof concept> = {
      ...concept(false, 2), designation: [{ value: 'Originalübersetzung', language: 'en' }],
    };
    expect(assessLocalDisplay(system, selected, 'Originalübersetzung', 'en').outcome).toBe('accepted');
    expect(assessLocalDisplay(system, selected, 'Another translation', 'en').outcome).toBe('unverified');
  });
});

afterEach(() => vi.restoreAllMocks());
for (const route of ['coding', 'binding'] as const) {
  describe(`${route} partial original labels through public registration`, () => {
    it.each([
      ['Originaltitel', undefined, '2015', false],
      ['Originaltitel', 'de-DE', '2015', false],
      ['Andere Bezeichnung', undefined, '2015', true],
      ['Andere Bezeichnung', 'de-DE', '2015', true],
      ['Originaltitel', 'en', '2015', true],
      ['Originaltitel', undefined, '1900', true],
    ] as const)('label=%s language=%s edition=%s stays incomplete=%s', async (display, language, version, incomplete) => {
      vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
      const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
      values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: true,
        serverDelegation: { validateCodes: false, expandValueSets: false } });
      const original = { ...system, count: 1, concept: [concept()] };
      const before = structuredClone(original);
      const valueSetUrl = 'http://example.org/partial-original-labels';
      expect(values.registerExternalTerminologyResource(original, 'R4')).toBe(true);
      expect(values.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSetUrl,
        compose: { include: [{ system: system.url }] } }, 'R4')).toBe(true);
      const coding = { system: system.url, code: 'A00.0', version, display };
      for (let round = 0; round < 2; round++) {
        const issues = route === 'binding'
          ? await values.validateBinding(coding, { strength: 'required', valueSet: valueSetUrl },
            'Observation.code', { fhirVersion: 'R4', displayLanguage: language })
          : await validateLocalCodeSystemCoding(coding, 'Observation.code', values, 'R4', undefined,
            { rootOwned: true, displayLanguage: language });
        expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(0);
        expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(incomplete);
      }
      expect(original).toEqual(before);
    });
  });
}
