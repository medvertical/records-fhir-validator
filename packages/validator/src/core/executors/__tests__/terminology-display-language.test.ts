import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource } from '../../../persistence/profile-source.js';
import { ValueSetCache } from '../../../validators/valueset-cache.js';
import { ValueSetValidator } from '../../../validators/valueset-validator.js';
import { UcumCodeValidator } from '../../../validators/ucum-validator.js';
import type { StructureDefinition } from '../../structure-definition-types.js';
import { validateTerminologyElement } from '../terminology-element-validator.js';
import { CodeSystemReferenceLookupCache } from '../terminology-code-system-reference-rules.js';
import { TerminologySlicePlanCache } from '../terminology-slice-plan-cache.js';

const system = 'http://loinc.org';
const path = 'Composition.section.code';
const elementDef = { path, type: [{ code: 'CodeableConcept' }] };
const structureDef: StructureDefinition = { resourceType: 'StructureDefinition', name: 'SyntheticComposition', status: 'draft', kind: 'resource', abstract: false, url: 'https://example.test/Composition', type: 'Composition', snapshot: { element: [elementDef] } };
const syntheticMessage = "Wrong Display Name 'History of past illness' for http://loinc.org#11369-6. Valid displays are 'note', 'Hx note'";

// These protocol responses establish no clinical or native edition authority.
function parameters(outcome: 'positive' | 'negative' | 'unknown') {
  return { resourceType: 'Parameters', parameter: [
    { name: 'result', valueBoolean: outcome === 'positive' },
    ...(outcome === 'positive' ? [{ name: 'display', valueString: 'History of past illness' }] : [
      { name: 'message', valueString: outcome === 'negative' ? syntheticMessage : 'Requested edition or language is not available' },
      { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: outcome === 'negative' ? 'invalid' : 'not-found',
        details: { coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: outcome === 'negative' ? 'invalid-display' : 'not-found' }],
          text: outcome === 'negative' ? syntheticMessage : 'Unable to resolve CodeSystem for requested edition or language' } }] } },
    ]),
  ] };
}

function validator() {
  const checked = new ValueSetValidator(new ValueSetCache(), undefined, []);
  checked.setResolutionConfig({ strategy: 'server-first', serverUrl: 'https://tx.example.test/r4', servers: [{ id: 'authority', url: 'https://tx.example.test/r4', enabled: true, fhirVersions: ['R4', 'R5'], preferredSystems: [system] }] });
  return checked;
}

async function validate(checked: ValueSetValidator, language?: unknown, version = '2.82') {
  const resource = { resourceType: 'Composition', ...(language === undefined ? {} : { language }), section: Array.from({ length: 4 }, (_, index) => index === 3
    ? { code: { coding: [{ system, code: '11369-6', display: 'History of past illness', version }] } } : {}) };
  return validateTerminologyElement({ resource, elementDef, structureDef, getValueAtPath: () => undefined, fhirVersion: 'R4' }, {
    valueSetCache: checked.getDefinitionLookup().cache, valueSetValidator: checked, slicePlanCache: new TerminologySlicePlanCache(),
    codeSystemReferenceLookupCache: new CodeSystemReferenceLookupCache(), ucumValidator: new UcumCodeValidator(),
  });
}

function requestParams(get: { mock: { calls: unknown[][] } }) {
  return get.mock.calls.map(call => (call[1] as { params: Record<string, string> }).params);
}

beforeEach(() => { setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false }); });
afterEach(() => { vi.restoreAllMocks(); setProfileSource({}); });

describe('CodeSystem display language context', () => {
  it.each(['positive', 'negative', 'unknown'] as const)('I-display-%s retains en-NZ and edition through the real facade and Parameters parser', async outcome => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: parameters(outcome) });
    const issues = await validate(validator(), 'en-NZ');
    expect(requestParams(get)).toEqual([{ url: system, code: '11369-6', version: '2.82', display: 'History of past illness', displayLanguage: 'en-NZ', _format: 'json' }]);
    const displays = issues.filter(issue => issue.code === 'terminology-display-mismatch');
    expect(displays).toHaveLength(outcome === 'negative' ? 1 : 0);
    if (outcome === 'negative') expect(displays[0]).toMatchObject({ severity: 'error', path: 'Composition.section[3].code.coding[0].display' });
    if (outcome === 'unknown') expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(true);
    else expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(false);
  });

  it('keeps omitted and non-string resource language requests compatible', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: parameters('positive') });
    const checked = validator();
    expect(await validate(checked)).toEqual([]);
    expect(await validate(checked, { code: 'en-NZ' })).toEqual([]);
    expect(requestParams(get)).toEqual([{ url: system, code: '11369-6', version: '2.82', display: 'History of past illness', _format: 'json' }]);
  });

  it('separates completed results for distinct languages while reusing the same language', async () => {
    const get = vi.spyOn(axios, 'get').mockImplementation(async (_url, config) => ({ data: parameters((config?.params as Record<string, unknown> | undefined)?.displayLanguage === 'de-DE' ? 'negative' : 'positive') }));
    const checked = validator();
    expect((await validate(checked, 'en-NZ')).filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(0);
    expect((await validate(checked, 'de-DE')).filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(1);
    expect((await validate(checked, 'en-NZ')).filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(0);
    expect(requestParams(get).map(params => params.displayLanguage)).toEqual(['en-NZ', 'de-DE']);
  });

  it('isolates language in-flight work and coalesces only the same request', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const get = vi.spyOn(axios, 'get').mockImplementation(async (_url, config) => { await barrier; return { data: parameters((config?.params as Record<string, unknown> | undefined)?.displayLanguage === 'de-DE' ? 'negative' : 'positive') }; });
    const checked = validator();
    const pending = [validate(checked, 'en-NZ'), validate(checked, 'de-DE'), validate(checked, 'en-NZ')];
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    release();
    const results = await Promise.all(pending);
    expect(results.map(issues => issues.filter(issue => issue.code === 'terminology-display-mismatch').length)).toEqual([0, 1, 0]);
    expect(requestParams(get).map(params => params.displayLanguage).sort()).toEqual(['de-DE', 'en-NZ']);
  });

  it('retains edition and tenant/server/FHIR scope separation for the same language', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: parameters('positive') });
    const checked = validator();
    const run = (organizationId: number, serverId: number, fhirVersion: 'R4' | 'R5', version: string) => checked.withSourceContext({ organizationId, serverId, fhirVersion }, () =>
      checked.validateCodeInCodeSystem('11369-6', system, 'History of past illness', fhirVersion, version, 'en-NZ'));
    await run(1, 10, 'R4', '2.82'); await run(1, 10, 'R4', '2.77');
    await run(2, 10, 'R4', '2.82'); await run(1, 11, 'R4', '2.82'); await run(1, 10, 'R5', '2.82');
    await run(1, 10, 'R4', '2.82');
    expect(get).toHaveBeenCalledTimes(5);
    expect(requestParams(get).map(params => params.version)).toEqual(['2.82', '2.77', '2.82', '2.82', '2.82']);
    expect(requestParams(get).every(params => params.displayLanguage === 'en-NZ')).toBe(true);
  });

  it.each(['membership', 'display', 'inactive'] as const)('preserves language and edition on the %s fallback request', async kind => {
    const get = vi.spyOn(axios, 'get').mockImplementation(async url => {
      if (String(url).startsWith('https://secondary.example.test')) return { data: parameters('positive') };
      if (kind !== 'inactive') return { data: parameters(kind === 'display' ? 'negative' : 'unknown') };
      const response = parameters('positive');
      return { data: { ...response, parameter: [...response.parameter, { name: 'inactive', valueBoolean: true }] } };
    });
    const checked = validator();
    checked.setResolutionConfig({ servers: [
      { id: 'authority', url: 'https://tx.example.test/r4', enabled: true, fhirVersions: ['R4'], preferredSystems: [system] },
      { id: 'fallback', url: 'https://secondary.example.test/r4', enabled: true, fhirVersions: ['R4'] },
    ] });
    expect(await validate(checked, 'en-NZ')).toEqual([]);
    const requests = requestParams(get);
    expect(requests).toHaveLength(2);
    expect(requests.every(params => params.displayLanguage === 'en-NZ' && params.version === '2.82')).toBe(true);
    expect(requests.map(params => params.display)).toEqual(['History of past illness', kind === 'inactive' ? undefined : 'History of past illness']);
  });

});
