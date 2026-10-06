import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConceptMapCodeSystems } from '../conceptmap-resource-validator';
import { TerminologyResourceValidator } from '../terminology-resource-validator';
import { ValueSetCache } from '../valueset-cache';

// Core example cm-administrative-gender-v3 maps 'unknown' to 'UNK', which
// v3-AdministrativeGender does not define (F, M, UN).
const V3_GENDER = 'http://terminology.hl7.org/CodeSystem/v3-AdministrativeGender';
const FHIR_GENDER = 'http://hl7.org/fhir/administrative-gender';
const codeSystem = (url: string, content: string, concepts: Array<[string, string]>) => ({
  resourceType: 'CodeSystem', url, version: '4.0.0', content,
  concept: concepts.map(([code, display]) => ({ code, display })),
});
const conceptMap = (group: Record<string, unknown>) => ({ resourceType: 'ConceptMap', status: 'active', group: [group] });
const genderMap = conceptMap({
  source: FHIR_GENDER,
  target: V3_GENDER,
  element: [
    { code: 'male', display: 'Man', target: [{ code: 'M', equivalence: 'equal' }] },
    { code: 'unknown', target: [{ code: 'UNK', equivalence: 'equal' }] },
  ],
});

describe('ConceptMap codes', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  function validatorWith(...codeSystems: Array<Record<string, unknown>>): TerminologyResourceValidator {
    const cache = new ValueSetCache();
    for (const cs of codeSystems) cache.setCodeSystem(String(cs.url), cs as never);
    return new TerminologyResourceValidator(cache);
  }

  it('fails a mapped code its complete CodeSystem does not define, and warns about a wrong display', () => {
    const issues = validatorWith(
      codeSystem(FHIR_GENDER, 'complete', [['male', 'Male'], ['unknown', 'Unknown']]),
      codeSystem(V3_GENDER, 'complete', [['F', 'Female'], ['M', 'Male'], ['UN', 'Undifferentiated']]),
    ).validate(genderMap);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'tx-conceptmap-source-display-invalid',
        severity: 'warning',
        path: 'ConceptMap.group[0].element[0].code',
      }),
      expect.objectContaining({
        code: 'tx-conceptmap-target-code-invalid',
        severity: 'error',
        path: 'ConceptMap.group[0].element[1].target[0].code',
        message: `The target code 'UNK' is not valid in the code system ${V3_GENDER}|4.0.0`,
      }),
    ]);
  });

  it('leaves codes of an incomplete CodeSystem unjudged and says why a side goes unchecked', () => {
    const fragment = validatorWith(codeSystem(V3_GENDER, 'fragment', [['M', 'Male']])).validate(genderMap);
    const unnamed = validatorWith().validate(conceptMap({ element: [{ code: 'a', target: [{ code: 'b' }] }] }));
    const snomed = validatorWith().validate(conceptMap({ source: FHIR_GENDER, target: 'http://snomed.info/sct', element: [] }));

    expect(fragment).toEqual([]);
    expect(unnamed.map(issue => [issue.code, issue.severity])).toEqual([
      ['tx-conceptmap-source-missing', 'warning'],
      ['tx-conceptmap-target-missing', 'warning'],
    ]);
    expect(snomed.map(issue => [issue.code, issue.path])).toEqual([['tx-conceptmap-target-tx-only', 'ConceptMap.group[0].target']]);
  });

  it('reads the CodeSystems it maps between from the local packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conceptmap-codes-'));
    roots.push(root);
    const packageDir = join(root, 'hl7.terminology.r4#9.9.9', 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'hl7.terminology.r4', version: '9.9.9', fhirVersions: ['4.0.1'] }));
    await writeFile(join(packageDir, 'CodeSystem-v3-AdministrativeGender.json'),
      JSON.stringify(codeSystem(V3_GENDER, 'complete', [['F', 'Female'], ['M', 'Male'], ['UN', 'Undifferentiated']])));
    vi.stubEnv('FHIR_PACKAGE_CACHE_PATH', root);

    const codeSystems = await loadConceptMapCodeSystems(genderMap, 'R4');
    const issues = new TerminologyResourceValidator(new ValueSetCache()).validate(genderMap, 'R4', codeSystems);

    expect(issues.map(issue => issue.code)).toContain('tx-conceptmap-target-code-invalid');
  });
});
