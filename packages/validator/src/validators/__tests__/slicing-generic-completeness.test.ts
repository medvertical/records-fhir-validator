import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateSlicingMatchSet } from '../slicing-match-set-validation.js';
import { assessSlicingVerifiability } from '../slicing-verifiability.js';
import type { SliceDefinition } from '../slice-types.js';
import type { SlicingDiscriminator, StructureDefinition } from '../../core/structure-definition-types.js';
import { createProfileConformanceCheck } from '../../core/multi-aspect-profile-conformance.js';
import type { MultiAspectDeps } from '../../core/multi-aspect-dependencies.js';
import type { ValidateOneFn } from '../../core/multi-aspect-types.js';
import { projectSemanticAspectResult, resolveSemanticAspectPlan } from '../../core/semantic-aspect-plan.js';

const profile = 'https://example.test/StructureDefinition/synthetic-list';
const definition: StructureDefinition = { resourceType: 'StructureDefinition', url: profile, name: 'SyntheticList',
  status: 'active', kind: 'resource', abstract: false, type: 'List' };
const slice = (sliceName = 'A'): SliceDefinition => ({ sliceName, path: `List.entry:${sliceName}`, min: 1, max: '*' });
const sdLoader = { loadProfile: async () => definition } as unknown as MultiAspectDeps['sdLoader'];
const completeIssues = (severity: ValidationIssue['severity']): ValidationIssue[] => [{ aspect: 'profile', severity,
  code: severity === 'warning' ? 'constraint-violation-dom-6' : 'synthetic-complete-diagnostic', message: 'Synthetic complete diagnostic' }];
function collected(issues: ValidationIssue[], evidenceIssues = issues) {
  const accepted = !issues.some(issue => ['error', 'fatal'].includes(issue.severity));
  return { isValid: accepted, structureDef: definition,
    aspects: [{ aspect: 'profile', isValid: accepted, issues, evidenceIssues, validationTime: 0 }] };
}
const unknownReferenceIssues = (discriminator: SlicingDiscriminator) => validateSlicingMatchSet({
  elements: [{ item: { reference: 'urn:uuid:synthetic-unreadable' } }], elementPath: 'List.entry', slices: [slice()],
  slicing: { rules: 'closed', discriminator: [discriminator] }, cardinalityMatches: new Map(), unmatchedElementCount: 1,
  hasUnresolvedReferenceDiscriminator: true, unresolvedDiscriminatorReadsTarget: discriminator.type !== 'type',
  hasUnresolvedSliceIdentity: false, referenceResolver: () => null,
});
async function assertUnknownThenRecovery(issues: ValidationIssue[]) {
  expect(issues[0]?.details).toMatchObject({ validationComplete: false, validationStatus: 'incomplete' });
  expect(projectSemanticAspectResult(collected(issues), resolveSemanticAspectPlan(['profile'])).isValid).toBe(false);
  let calls = 0; let recovered = false;
  const validateOne: ValidateOneFn = async () => { calls++; return collected(recovered ? completeIssues('warning') : issues); };
  const incomplete: ValidationIssue[] = [];
  const check = createProfileConformanceCheck({ sdLoader, validateOne, onIncomplete: issue => incomplete.push(issue), fhirVersion: 'R4', recursionDepth: 0 })!;
  const resource = { resourceType: 'List' };
  await expect(check(resource, profile)).resolves.toBeUndefined();
  await expect(check(resource, profile)).resolves.toBeUndefined();
  expect(calls).toBe(2); expect(incomplete).toHaveLength(2);
  recovered = true;
  await expect(check(resource, profile)).resolves.toBe(true);
  await expect(check(resource, profile)).resolves.toBe(true);
  expect(calls).toBe(3);
}

describe('Generic unresolved slicing preserves explicit completeness', () => {
  const cases: Array<[string, SlicingDiscriminator, ValidationIssue['severity']]> = [
    ['profile', { type: 'profile', path: 'item.resolve()' }, 'warning'],
    ['type', { type: 'type', path: 'item.resolve()' }, 'information'],
    ['value-status', { type: 'value', path: 'item.resolve().status' }, 'warning'],
    ['pattern-status', { type: 'pattern', path: 'item.resolve().status' }, 'warning'],
  ];
  it.each(cases)('%s reference remains unknown without changing severity', async (_name, discriminator, severity) => {
    const issues = unknownReferenceIssues(discriminator);
    expect(issues).toHaveLength(1); expect(issues[0]).toMatchObject({ code: 'profile-slice-validation-incomplete', severity,
      details: { reason: 'unresolved-reference-discriminator' } });
    await assertUnknownThenRecovery(issues);
  });
  it.each([
    ['resolved-exists', { type: 'exists', path: 'item.resolve().specimen' }],
    ['generic-value', { type: 'value', path: 'status' }],
  ] as const)('%s unresolved metadata cannot establish conformance', async (_name, discriminator) => {
    const assessed = assessSlicingVerifiability({ elementPath: 'List.entry', slices: [slice()],
      slicing: { rules: 'closed', discriminator: [discriminator] } });
    expect(assessed.blockingIssues).toHaveLength(1);
    expect(assessed.blockingIssues[0]).toMatchObject({ severity: 'information', details: { reason: 'unresolved-discriminator-metadata' } });
    await assertUnknownThenRecovery(assessed.blockingIssues);
  });
  it('partial slice metadata remains incomplete despite other loaded evidence', async () => {
    const assessed = assessSlicingVerifiability({ elementPath: 'List.entry', slices: [
      { ...slice(), childFixed: new Map([['status', 'final']]) }, slice('B'),
    ], slicing: { rules: 'closed', discriminator: [{ type: 'value', path: 'status' }] } });
    expect(assessed.blockingIssues).toEqual([]); expect(assessed.advisoryIssues).toHaveLength(1);
    expect(assessed.advisoryIssues[0]).toMatchObject({ severity: 'information', details: { reason: 'unresolved-slice-discriminator-metadata' } });
    await assertUnknownThenRecovery(assessed.advisoryIssues);
  });
});

describe('Completeness flags do not redefine ordinary findings or cache scope', () => {
  it.each(['warning', 'information', 'error'] as const)('complete %s retains its known severity verdict and cache', async severity => {
    let calls = 0; const issues = completeIssues(severity);
    const validateOne: ValidateOneFn = async () => { calls++; return collected(issues); };
    const check = createProfileConformanceCheck({ sdLoader, validateOne, fhirVersion: 'R4', recursionDepth: 0 })!;
    const resource = { resourceType: 'List' };
    await expect(check(resource, profile)).resolves.toBe(severity !== 'error');
    await expect(check(resource, profile)).resolves.toBe(severity !== 'error'); expect(calls).toBe(1);
    expect(issues[0].details).toBeUndefined();
  });
  it('suppressed unknown evidence still prevents cached complete true', async () => {
    let calls = 0; const evidence = unknownReferenceIssues({ type: 'type', path: 'item.resolve()' });
    const validateOne: ValidateOneFn = async () => { calls++; return collected([], evidence); };
    const check = createProfileConformanceCheck({ sdLoader, validateOne, fhirVersion: 'R4', recursionDepth: 0 })!;
    const resource = { resourceType: 'List' };
    await expect(check(resource, profile)).resolves.toBeUndefined(); await expect(check(resource, profile)).resolves.toBeUndefined(); expect(calls).toBe(2);
  });
  it('FHIR context does not reuse an unrelated complete verdict', async () => {
    let calls = 0;
    const validateOne: ValidateOneFn = async (_resource, _profile, version) => { calls++;
      return collected(version === 'R4' ? completeIssues('information') : unknownReferenceIssues({ type: 'type', path: 'item.resolve()' })); };
    const r4 = createProfileConformanceCheck({ sdLoader, validateOne, fhirVersion: 'R4', recursionDepth: 0 })!;
    const r5 = createProfileConformanceCheck({ sdLoader, validateOne, fhirVersion: 'R5', recursionDepth: 0 })!;
    const resource = { resourceType: 'List' };
    await expect(r4(resource, profile)).resolves.toBe(true); await expect(r4(resource, profile)).resolves.toBe(true);
    await expect(r5(resource, profile)).resolves.toBeUndefined(); await expect(r5(resource, profile)).resolves.toBeUndefined(); expect(calls).toBe(3);
  });
  it('nested depth does not reuse an unrelated complete verdict', async () => {
    let calls = 0;
    const validateOne: ValidateOneFn = async (_resource, _profile, _version, depth) => { calls++;
      return collected(depth === 1 ? completeIssues('information') : unknownReferenceIssues({ type: 'type', path: 'item.resolve()' })); };
    const shallow = createProfileConformanceCheck({ sdLoader, validateOne, fhirVersion: 'R4', recursionDepth: 0 })!;
    const deeper = createProfileConformanceCheck({ sdLoader, validateOne, fhirVersion: 'R4', recursionDepth: 1 })!;
    const resource = { resourceType: 'List' };
    await expect(shallow(resource, profile)).resolves.toBe(true); await expect(deeper(resource, profile)).resolves.toBeUndefined(); await expect(deeper(resource, profile)).resolves.toBeUndefined(); expect(calls).toBe(3);
  });
});
