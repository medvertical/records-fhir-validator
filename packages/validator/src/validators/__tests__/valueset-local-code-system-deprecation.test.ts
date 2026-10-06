import { describe, expect, it, vi } from 'vitest';
import { validateDeepLocalCodings } from '../../core/executors/terminology-local-coding-rules';
import { validateCodeInLocalCodeSystem } from '../valueset-local-code-system-validation';
import { ValueSetCache } from '../valueset-cache';
import type { ValueSetPackageLoader } from '../valueset-package-loader';
import type { CodeSystem, CodeSystemConceptProperty } from '../valueset-types';

const V2_0078 = 'http://terminology.hl7.org/CodeSystem/v2-0078';

function depsHolding(codeSystem: CodeSystem) {
  const cache = new ValueSetCache();
  vi.spyOn(cache, 'getCodeSystem').mockReturnValue(codeSystem);
  vi.spyOn(cache, 'getCodeSystemFile').mockReturnValue(undefined);
  return {
    cache,
    packageLoader: { loadCodeSystem: vi.fn() } as unknown as ValueSetPackageLoader,
  };
}

describe('deprecated CodeSystem concepts', () => {
  const codeSystem: CodeSystem = {
    resourceType: 'CodeSystem',
    url: V2_0078,
    content: 'complete',
    concept: [
      { code: 'H', display: 'High', property: [{ code: 'status', valueCode: 'deprecated' }] },
      { code: 'L', display: 'Low', property: [{ code: 'deprecated', valueBoolean: true }] },
      { code: 'N', display: 'Normal', property: [{ code: 'status', valueCode: 'active' }] },
    ],
  } as CodeSystem;

  it('flags a concept whose status or legacy flag says deprecated', async () => {
    const deps = depsHolding(codeSystem);

    expect(await validateCodeInLocalCodeSystem(deps, 'H', V2_0078, 'High')).toMatchObject({
      valid: true,
      issues: [{ code: 'code-deprecated', message: "The concept 'H' is deprecated and its use should be reviewed" }],
    });
    expect((await validateCodeInLocalCodeSystem(deps, 'L', V2_0078))?.issues).toHaveLength(1);
    expect((await validateCodeInLocalCodeSystem(deps, 'N', V2_0078))?.issues).toBeUndefined();
    // A wrong display on a deprecated concept is reported alongside.
    expect((await validateCodeInLocalCodeSystem(deps, 'H', V2_0078, 'Hi'))?.issues?.map(issue => issue.code))
      .toEqual(['invalid-display', 'code-deprecated']);
  });

  it('reports it as a warning on the Coding', async () => {
    const validateCodeInLocalCodeSystemOnly = vi.fn((code: string, system: string, display?: string) =>
      validateCodeInLocalCodeSystem(depsHolding(codeSystem), code, system, display));
    const observation = {
      resourceType: 'Observation',
      interpretation: [{ coding: [{ system: V2_0078, code: 'H', display: 'High' }] }],
    };

    const issues = await validateDeepLocalCodings(observation, [], { validateCodeInLocalCodeSystemOnly }, 'R4');

    expect(issues).toEqual([expect.objectContaining({
      code: 'terminology-code-deprecated',
      severity: 'warning',
      path: 'Observation.interpretation[0].coding[0]',
      message: "The concept 'H' is deprecated and its use should be reviewed",
    })]);
  });
});

describe('local CodeSystem lifecycle evidence', () => {
  const system = 'https://example.test/CodeSystem/lifecycle';
  const cases: Array<{
    name: string;
    properties: CodeSystemConceptProperty[];
    issueCodes: string[];
    inactive?: true;
  }> = [
    { name: 'active', properties: [{ code: 'status', valueCode: 'active' }], issueCodes: [] },
    { name: 'unmarked', properties: [], issueCodes: [] },
    { name: 'retired', properties: [{ code: 'status', valueCode: 'retired' }], issueCodes: ['code-comment', 'code-retired'], inactive: true },
    { name: 'explicitly inactive', properties: [{ code: 'inactive', valueBoolean: true }], issueCodes: ['code-comment'], inactive: true },
    { name: 'explicitly not inactive', properties: [{ code: 'inactive', valueBoolean: false }], issueCodes: [] },
    { name: 'deprecated status', properties: [{ code: 'status', valueCode: 'deprecated' }], issueCodes: ['code-deprecated'] },
    { name: 'legacy deprecated flag', properties: [{ code: 'deprecated', valueBoolean: true }], issueCodes: ['code-deprecated'] },
    { name: 'inactive status', properties: [{ code: 'status', valueCode: 'inactive' }], issueCodes: ['code-comment'], inactive: true },
    { name: 'string inactive status', properties: [{ code: 'status', valueString: 'inactive' }], issueCodes: ['code-comment'], inactive: true },
    { name: 'string retired status', properties: [{ code: 'status', valueString: 'retired' }], issueCodes: ['code-comment', 'code-retired'], inactive: true },
    { name: 'code inactive true', properties: [{ code: 'inactive', valueCode: 'true' }], issueCodes: ['code-comment'], inactive: true },
    { name: 'code inactive false', properties: [{ code: 'inactive', valueCode: 'false' }], issueCodes: [] },
    { name: 'string inactive flag is unsupported', properties: [{ code: 'inactive', valueString: 'true' }], issueCodes: [] },
    { name: 'active before explicit true', properties: [{ code: 'status', valueCode: 'active' }, { code: 'inactive', valueBoolean: true }], issueCodes: [] },
    { name: 'explicit false before retired', properties: [{ code: 'inactive', valueBoolean: false }, { code: 'status', valueCode: 'retired' }], issueCodes: [] },
    { name: 'retired before explicit false', properties: [{ code: 'status', valueCode: 'retired' }, { code: 'inactive', valueBoolean: false }], issueCodes: ['code-comment', 'code-retired'], inactive: true },
    { name: 'code false before inactive', properties: [{ code: 'inactive', valueCode: 'false' }, { code: 'status', valueCode: 'inactive' }], issueCodes: [] },
    { name: 'empty status before later true and retired', properties: [{ code: 'status', valueCode: '' }, { code: 'inactive', valueBoolean: true }, { code: 'status', valueCode: 'retired' }], issueCodes: [] },
    { name: 'empty string status before later true', properties: [{ code: 'status', valueString: '' }, { code: 'inactive', valueBoolean: true }], issueCodes: [] },
    { name: 'inactive before a later retired status', properties: [{ code: 'status', valueCode: 'inactive' }, { code: 'status', valueCode: 'retired' }], issueCodes: ['code-comment'], inactive: true },
    { name: 'unknown property before retired', properties: [{ code: 'unknown', valueBoolean: false }, { code: 'status', valueCode: 'retired' }], issueCodes: ['code-comment', 'code-retired'], inactive: true },
  ];

  function conceptSystem(properties: CodeSystemConceptProperty[]): CodeSystem {
    return {
      resourceType: 'CodeSystem', url: system, content: 'complete',
      concept: [{ code: 'member', display: 'Member', property: properties }],
    };
  }

  it.each(cases)('preserves membership for $name evidence', async ({ properties, issueCodes, inactive }) => {
    const result = await validateCodeInLocalCodeSystem(depsHolding(conceptSystem(properties)), 'member', system, 'Member');

    expect(result).toMatchObject({ valid: true, display: 'Member' });
    expect(result?.issues?.map(issue => issue.code) ?? []).toEqual(issueCodes);
    expect(result?.inactive).toBe(inactive);
    expect(result?.issues?.every(issue => issue.source === 'local-code-system') ?? true).toBe(true);
  });

  it('keeps retired evidence alongside an independent display mismatch', async () => {
    const result = await validateCodeInLocalCodeSystem(
      depsHolding(conceptSystem([{ code: 'status', valueCode: 'retired' }])), 'member', system, 'Wrong',
    );

    expect(result).toMatchObject({ valid: false, reason: 'display-mismatch', display: 'Member' });
    expect(result?.issues?.map(issue => issue.code)).toEqual(['invalid-display', 'code-comment', 'code-retired']);
    expect(result?.inactive).toBe(true);
  });

  it('records the first property that derived inactivity separately from retired status', async () => {
    const result = await validateCodeInLocalCodeSystem(depsHolding(conceptSystem([
      { code: 'inactive', valueBoolean: true }, { code: 'status', valueCode: 'retired' },
    ])), 'member', system);

    expect(result?.issues).toEqual([
      expect.objectContaining({ code: 'code-comment', expression: ['property[0].valueBoolean'] }),
      expect.objectContaining({ code: 'code-retired', expression: ['property[1].valueCode'] }),
    ]);
  });

  it('uses the declared standard status property for the separate retired finding', async () => {
    const codeSystem = conceptSystem([
      { code: 'status', valueCode: 'retired' }, { code: 'lifecycle', valueCode: 'active' },
    ]);
    codeSystem.property = [{ code: 'lifecycle', uri: 'http://hl7.org/fhir/concept-properties#status', type: 'code' }];
    const result = await validateCodeInLocalCodeSystem(depsHolding(codeSystem), 'member', system);

    expect(result?.inactive).toBe(true);
    expect(result?.issues?.map(issue => issue.code)).toEqual(['code-comment']);
  });

  it('preserves independently declared inactive and retired evidence', async () => {
    const result = await validateCodeInLocalCodeSystem(depsHolding(conceptSystem([
      { code: 'inactive', valueBoolean: true }, { code: 'status', valueCode: 'retired' },
    ])), 'member', system);

    expect(result?.valid).toBe(true);
    expect(result?.inactive).toBe(true);
    expect(result?.issues?.map(issue => issue.code)).toEqual(['code-comment', 'code-retired']);
  });
});
