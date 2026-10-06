import { describe, expect, it } from 'vitest';
import { toOperationOutcome, fromOperationOutcome } from '../../operation-outcome-converter.js';
import { buildCodeSystemResultIssues } from '../terminology-code-system-result-issues.js';
import { TerminologyCodes } from '../../../issues/codes/terminology-codes.js';
import { TerminologyExecutor } from '../terminology-executor.js';
import { getValueAtPath } from '../../validation-utils.js';
import type { StructureDefinition } from '../../structure-definition-types.js';
import { ValueSetCache } from '../../../validators/valueset-cache.js';
import { ValueSetValidator } from '../../../validators/valueset-validator.js';
import type { CodeSystemConceptProperty } from '../../../validators/valueset-types.js';

const system = 'https://example.test/CodeSystem/identifier-lifecycle';
const valueSet = 'https://example.test/ValueSet/identifier-types';
const codingPath = 'Patient.identifier[0].type.coding[0]';
const structureDef: StructureDefinition = {
  resourceType: 'StructureDefinition', id: 'Patient',
  url: 'https://example.test/StructureDefinition/Patient', name: 'Patient',
  status: 'active', kind: 'resource', abstract: false, type: 'Patient', derivation: 'constraint',
  snapshot: { element: [
    { id: 'Patient', path: 'Patient' },
    { id: 'Patient.identifier.type', path: 'Patient.identifier.type', min: 0, max: '1', type: [{ code: 'CodeableConcept' }] },
  ] },
};

function valuesHolding(properties: CodeSystemConceptProperty[]) {
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({
    strategy: 'local-only', servers: [],
    serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 },
  });
  values.registerExternalTerminologyResource({
    resourceType: 'CodeSystem', url: system, status: 'active', content: 'complete',
    concept: [{ code: 'member', display: 'Member', property: properties }],
  }, 'R4');
  return values;
}

async function execute(values: ValueSetValidator, display?: string, profile: StructureDefinition = structureDef) {
  return new TerminologyExecutor(values).validate({
    resource: {
      resourceType: 'Patient', identifier: [{ type: { coding: [{ system, code: 'member', ...(display ? { display } : {}) }] } }],
    },
    structureDef: profile, getValueAtPath, fhirVersion: 'R4',
  });
}

describe('TerminologyExecutor local lifecycle propagation', () => {
  it('publishes SDK-derived inactive and retired separately without invalidating membership', async () => {
    const values = valuesHolding([{ code: 'status', valueCode: 'retired' }]);
    const result = await values.validateCodeInLocalCodeSystemOnly('member', system, undefined, 'R4');
    const issues = await execute(values);

    expect(result?.valid).toBe(true);
    expect(result?.inactive).toBe(true);
    expect(issues).toEqual([expect.objectContaining({
      code: 'terminology-code-inactive', severity: 'warning', path: codingPath,
      details: expect.objectContaining({
        terminologySource: 'local-code-system', lifecyclePolicy: 'fhir-validator-6.9.11-properties',
        conceptPropertyPaths: ['property[0].valueCode'],
      }),
    }), expect.objectContaining({
      code: 'terminology-code-retired', severity: 'warning', path: codingPath,
      message: "The concept 'member' has a status of retired and its use should be reviewed",
      details: expect.objectContaining({ conceptStatus: 'retired', terminologySource: 'local-code-system' }),
    })]);
  });

  it('publishes two distinct lifecycle business-rule warnings with Records identity and paths', async () => {
    const issues = await execute(valuesHolding([{ code: 'status', valueCode: 'retired' }]));
    const provenance = JSON.parse(JSON.stringify(issues.map(issue => issue.details)));
    const outcome = toOperationOutcome(issues);
    const recovered = fromOperationOutcome(outcome);

    expect(outcome.issue).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'business-rule', location: [codingPath],
        diagnostics: "The concept 'member' has a status of inactive and its use should be reviewed" }),
      expect.objectContaining({ severity: 'warning', code: 'business-rule', location: [codingPath],
        diagnostics: "The concept 'member' has a status of retired and its use should be reviewed" }),
    ]);
    expect(recovered.map(issue => [issue.id, issue.code, issue.path])).toEqual(
      issues.map(issue => [issue.id, issue.code, issue.path]),
    );
    expect(new Set(recovered.map(issue => issue.id)).size).toBe(2);
    expect(issues.map(issue => issue.details)).toEqual(provenance);
    expect(issues.every(issue => typeof issue.details === 'object'
      && issue.details?.lifecyclePolicy === 'fhir-validator-6.9.11-properties')).toBe(true);
    expect(TerminologyCodes['terminology-code-retired']).toMatchObject({ aspect: 'terminology', severity: 'warning' });
  });

  it('uses explicit inactive evidence without reclassifying it as retired', async () => {
    const issues = await execute(valuesHolding([{ code: 'inactive', valueBoolean: true }]));

    expect(issues).toEqual([expect.objectContaining({
      code: 'terminology-code-inactive', severity: 'warning', path: codingPath,
      message: "The concept 'member' has a status of inactive and its use should be reviewed",
    })]);
  });

  it('preserves the legacy code path for remote and result-only inactive evidence', () => {
    const coding = { system, code: 'member' };
    for (const result of [
      { valid: true, inactive: true },
      { valid: true, issues: [{ severity: 'warning' as const, code: 'code-comment',
        message: 'Inactive server concept', source: 'terminology-server' as const }] },
    ]) {
      expect(buildCodeSystemResultIssues(coding, result, codingPath, 0, false)).toEqual([
        expect.objectContaining({ code: 'terminology-code-inactive', path: `${codingPath}.code` }),
      ]);
    }
  });

  it('keeps existing deprecated semantics and leaves active concepts quiet', async () => {
    expect(await execute(valuesHolding([{ code: 'status', valueCode: 'active' }]))).toEqual([]);
    expect(await execute(valuesHolding([{ code: 'inactive', valueBoolean: false }]))).toEqual([]);
    const deprecated = await execute(valuesHolding([{ code: 'status', valueCode: 'deprecated' }]));
    expect(deprecated).toEqual([
      expect.objectContaining({ code: 'terminology-code-deprecated', severity: 'warning', path: codingPath }),
    ]);
    expect(toOperationOutcome(deprecated).issue).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'business-rule' }),
    ]);
  });

  it.each([
    { name: 'active status before explicit true', properties: [{ code: 'status', valueCode: 'active' }, { code: 'inactive', valueBoolean: true }] },
    { name: 'explicit false before retired', properties: [{ code: 'inactive', valueBoolean: false }, { code: 'status', valueCode: 'retired' }] },
    { name: 'empty status before true and retired', properties: [{ code: 'status', valueCode: '' }, { code: 'inactive', valueBoolean: true }, { code: 'status', valueCode: 'retired' }] },
  ])('does not publish warnings when $name decides inactivity', async ({ properties }) => {
    const values = valuesHolding(properties);
    expect((await values.validateCodeInLocalCodeSystemOnly('member', system, undefined, 'R4'))?.valid).toBe(true);
    expect(await execute(values)).toEqual([]);
  });

  it('keeps a first retired status authoritative over a later explicit false', async () => {
    const issues = await execute(valuesHolding([
      { code: 'status', valueCode: 'retired' }, { code: 'inactive', valueBoolean: false },
    ]));
    expect(issues.map(issue => issue.code)).toEqual(['terminology-code-inactive', 'terminology-code-retired']);
  });

  it('publishes lifecycle and display findings independently', async () => {
    const issues = await execute(valuesHolding([
      { code: 'inactive', valueBoolean: true }, { code: 'status', valueCode: 'retired' },
    ]), 'Wrong');

    expect(issues.map(issue => issue.code).sort()).toEqual([
      'terminology-code-inactive', 'terminology-code-retired', 'terminology-display-mismatch',
    ].sort());
    expect(issues.find(issue => issue.code === 'terminology-code-inactive')?.message)
      .toBe("The concept 'member' has a status of inactive and its use should be reviewed");
    expect(issues.some(issue => issue.code === 'terminology-code-invalid')).toBe(false);
  });

  it('does not let lifecycle acceptance replace extensible ValueSet membership', async () => {
    const values = valuesHolding([{ code: 'status', valueCode: 'retired' }]);
    values.registerExternalTerminologyResource({
      resourceType: 'ValueSet', url: valueSet, status: 'active',
      compose: { include: [{ system, concept: [{ code: 'other' }] }] },
    }, 'R4');

    const bindingIssues = await values.validateBinding(
      { coding: [{ system, code: 'member' }] }, { strength: 'extensible', valueSet },
      'Patient.identifier[0].type', { fhirVersion: 'R4' },
    );
    const boundProfile: StructureDefinition = {
      ...structureDef,
      snapshot: { element: (structureDef.snapshot?.element ?? []).map(element => (
        element.path === 'Patient.identifier.type'
          ? { ...element, binding: { strength: 'extensible' as const, valueSet } }
          : element
      )) },
    };
    const combinedIssues = await execute(values, undefined, boundProfile);

    expect(bindingIssues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-extensible', severity: 'warning' }));
    expect(combinedIssues.map(issue => issue.code).sort()).toEqual([
      'terminology-binding-extensible', 'terminology-code-inactive', 'terminology-code-retired',
    ].sort());
    expect(combinedIssues).toContainEqual(expect.objectContaining({ code: 'terminology-code-retired', severity: 'warning', path: codingPath }));
    expect(combinedIssues.some(issue => issue.code === 'terminology-code-invalid')).toBe(false);
    expect(toOperationOutcome(combinedIssues).issue.map(issue => issue.code).sort()).toEqual([
      'business-rule', 'business-rule', 'code-invalid',
    ].sort());
  });
});
