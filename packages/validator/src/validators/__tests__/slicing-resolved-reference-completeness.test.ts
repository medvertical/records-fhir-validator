import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { SlicingValidator } from '../slicing-validator.js';
import { ProfileSlicingValidation } from '../../core/executors/profile-slicing-validation.js';
import { getValueAtPath } from '../../core/validation-utils.js';
import { projectSemanticAspectResult, resolveSemanticAspectPlan } from '../../core/semantic-aspect-plan.js';
import { createProfileConformanceCheck } from '../../core/multi-aspect-profile-conformance.js';
import type { MultiAspectValidateResult } from '../../core/multi-aspect-types.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import metadata from '../__fixtures__/slicing-resolved-code-mii-patho-metadata.json';

const original = metadata.report as unknown as StructureDefinition;
const targets = metadata.targets as unknown as StructureDefinition[];
const field = 'DiagnosticReport.result';
const names = ['intraoperative-observations', 'macroscopic-observations'];
const code = (index: number) => structuredClone(targets[index].snapshot!.element
  .find(element => element.path === 'Observation.code')!.patternCodeableConcept);
const kinds = ['unknown-min1', 'unknown-min2', 'two-unknown-min2', 'literal-beside-unknown-min2',
  'other-slice-proved-min', 'other-slice-proved-max', 'known-max-beside-unknown', 'known-closed-beside-unknown',
  'primitive-sidecar-unknown', 'literal-only-invalid', 'complete-valid', 'complete-invalid'] as const;
type Kind = typeof kinds[number];
function profile(type: 'value' | 'pattern', kind: Kind): StructureDefinition {
  const result = structuredClone(original); result.url = 'https://example.test/StructureDefinition/reference-completeness';
  result.snapshot!.element = result.snapshot!.element.filter(element => !element.id?.startsWith(`${field}:`)
    || names.some(name => element.id?.startsWith(`${field}:${name}`)));
  for (const element of result.snapshot!.element) {
    if (element.id === field) { element.min = 0; element.slicing = {
      discriminator: [{ type, path: 'resolve().code' }], rules: 'closed', ordered: false,
    }; }
    if (element.sliceName) { element.min = 0; element.max = '*'; }
  }
  const second = result.snapshot!.element.find(element => element.sliceName === names[1])!;
  if (kind.includes('min2')) second.min = 2;
  if (kind === 'unknown-min1' || kind === 'primitive-sidecar-unknown' || kind === 'literal-only-invalid') second.min = 1;
  if (kind === 'known-max-beside-unknown') result.snapshot!.element.find(element => element.sliceName === names[0])!.max = '1';
  if (kind === 'other-slice-proved-min' || kind === 'other-slice-proved-max') {
    if (kind === 'other-slice-proved-min') second.min = 1;
    else second.max = '1';
    result.snapshot!.element.find(element => element.id === field)!.slicing!.discriminator!.push({ type: 'value', path: 'display' });
    for (const [index, name] of names.entries()) result.snapshot!.element.push({
      id: `${field}:${name}.display`, path: `${field}.display`, min: 1, max: '1', fixedString: index === 0 ? 'left' : 'right',
    });
  }
  return result;
}
const details = (issue: Awaited<ReturnType<SlicingValidator['validateSlicing']>>[number]) =>
  typeof issue.details === 'object' && issue.details ? issue.details : {};
for (const type of ['value', 'pattern'] as const) describe(`resolved Reference truth (${type})`, () => {
  it.each(kinds)('%s retains proved findings and actual caller completeness', async kind => {
    const definition = profile(type, kind);
    const indices: Array<number | null> = kind === 'complete-valid' ? [0] : kind === 'complete-invalid' ? [4]
      : kind === 'known-max-beside-unknown' ? [0, 0, null]
      : kind === 'other-slice-proved-max' ? [1, 1, null]
      : kind === 'known-closed-beside-unknown' ? [4, null]
      : kind === 'two-unknown-min2' || kind === 'literal-beside-unknown-min2' ? [null, null] : [null];
    const references = indices.map((index, occurrence) => ({ reference: `Observation/${occurrence}`,
      display: kind === 'other-slice-proved-max' && index === 1 ? 'right' : 'left' }));
    const literals = kind === 'literal-only-invalid' ? [{ display: 'literal-absent' }]
      : kind === 'primitive-sidecar-unknown' ? [{ _reference: { extension: [{ url: 'https://example.test/missing', valueBoolean: true }] } }]
      : kind === 'literal-beside-unknown-min2' ? [{ display: 'literal-absent' }, references[1]] : references;
    const observations = new Map<string, { resourceType: string; code: ReturnType<typeof code> }>(indices.flatMap((index, occurrence) => index === null ? [] : [[`Observation/${occurrence}`, {
      resourceType: 'Observation', code: code(index),
    }] as const]));
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async canonical => structuredClone(targets.find(target => target.url === canonical) ?? null));
    const resource = { resourceType: 'DiagnosticReport', result: literals };
    const issues = await new ProfileSlicingValidation(validator).validate({
      extensionIssues: [], resource, structureDef: definition, getValueAtPath,
      referenceResolver: reference => observations.get(reference) ?? null, fhirVersion: 'R4',
    });
    const minima = issues.filter(issue => issue.code === 'profile-slice-min-cardinality');
    const provedMin = ['unknown-min2', 'literal-beside-unknown-min2', 'other-slice-proved-min', 'literal-only-invalid'].includes(kind);
    expect(minima.filter(issue => details(issue).sliceName === names[1])).toHaveLength(provedMin ? 1 : 0);
    const maxima = issues.filter(issue => issue.code === 'profile-slice-max-cardinality');
    const provedMax = kind === 'known-max-beside-unknown' || kind === 'other-slice-proved-max';
    expect(maxima).toHaveLength(provedMax ? 1 : 0);
    if (provedMax) expect(details(maxima[0]).sliceName).toBe(names[kind === 'other-slice-proved-max' ? 1 : 0]);
    const closed = ['known-closed-beside-unknown', 'literal-beside-unknown-min2', 'literal-only-invalid', 'complete-invalid'].includes(kind);
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(closed);
    const incomplete = !['literal-only-invalid', 'complete-valid', 'complete-invalid'].includes(kind);
    expect(issues.some(issue => details(issue).validationComplete === false)).toBe(incomplete);
    const isValid = !issues.some(issue => ['error', 'fatal'].includes(issue.severity));
    const result: MultiAspectValidateResult = { structureDef: definition, isValid,
      aspects: [{ aspect: 'profile', issues, evidenceIssues: issues, validationTime: 0, isValid }] };
    expect(projectSemanticAspectResult(result, resolveSemanticAspectPlan(['profile'])).isValid).toBe(kind === 'complete-valid');
    let calls = 0;
    const sdLoader = { loadProfile: async () => definition } as unknown as Parameters<typeof createProfileConformanceCheck>[0]['sdLoader'];
    const onIncomplete = vi.fn<(issue: ValidationIssue) => void>();
    const conforms = createProfileConformanceCheck({ sdLoader, onIncomplete, validateOne: async () => { calls++; return result; }, fhirVersion: 'R4', recursionDepth: 0 })!;
    const expected = provedMin || provedMax || closed ? false : incomplete ? undefined : true;
    expect(await conforms(resource, definition.url!)).toBe(expected);
    expect(await conforms(resource, definition.url!)).toBe(expected);
    expect(calls).toBe(2);
    expect(onIncomplete).toHaveBeenCalledTimes(incomplete ? 2 : 0);
    for (const [receipt] of onIncomplete.mock.calls) expect(receipt).toMatchObject({
      aspect: 'profile', code: 'profile-conformance-incomplete', severity: 'info', details: {
        validationComplete: false, profile: definition.url,
        causes: [...new Set(issues.map(issue => issue.code).filter(Boolean))],
      },
    });
  });
});
