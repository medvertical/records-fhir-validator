import { describe, expect, it } from 'vitest';
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
const names = ['intraoperative-observations', 'macroscopic-observations', 'diagnostic-conclusion'];
const unavailable = 'https://example.test/StructureDefinition/unavailable-code';
const code = (index: number) => structuredClone(targets[index].snapshot!.element
  .find(element => element.path === 'Observation.code')!.patternCodeableConcept);
function profile(type: 'value' | 'pattern', composite = true, third = false): StructureDefinition {
  const result = structuredClone(original);
  result.url = 'https://example.test/StructureDefinition/unknown-code-bounds';
  result.snapshot!.element = result.snapshot!.element.filter(element => !element.id?.startsWith(`${field}:`)
    || names.slice(0, third ? 3 : 2).some(name => element.id?.startsWith(`${field}:${name}`)));
  for (const element of result.snapshot!.element) {
    if (element.id === field) {
      element.min = 0;
      element.slicing = { discriminator: [{ type, path: 'resolve().code' }], rules: 'closed', ordered: false };
      if (composite) element.slicing.discriminator!.push({ type: 'value', path: 'display' });
    }
    if (element.sliceName) { element.min = 0; element.max = '*'; }
  }
  result.snapshot!.element.find(element => element.sliceName === names[1])!.type![0].targetProfile = [unavailable];
  if (composite) for (const name of names.slice(0, third ? 3 : 2)) result.snapshot!.element.push({
    id: `${field}:${name}.display`, path: `${field}.display`, min: 1, max: '1', fixedString: name === names[2] ? 'other' : 'same',
  });
  return result;
}
async function run(definition: StructureDefinition, indices: number[], otherDisplay = false, omitReference = false) {
  const references = indices.map((index, occurrence) => ({
    ...(omitReference ? {} : { reference: `Observation/${occurrence}` }), display: otherDisplay && index === 4 ? 'other' : 'same',
  }));
  const values = new Map(indices.map((index, occurrence) => [`Observation/${occurrence}`, { resourceType: 'Observation', code: code(index) }]));
  const resolver = (reference: string) => values.get(reference) ?? null;
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => structuredClone(targets.find(target => target.url === canonical) ?? null));
  const resource = { resourceType: 'DiagnosticReport', result: references };
  const issues = await new ProfileSlicingValidation(validator).validate({
    extensionIssues: [], resource, structureDef: definition, getValueAtPath, referenceResolver: resolver, fhirVersion: 'R4',
  });
  return { issues, resource };
}
const details = (issue: Awaited<ReturnType<typeof run>>['issues'][number]) =>
  typeof issue.details === 'object' && issue.details ? issue.details : {};
function profileLoader(definition: StructureDefinition): Parameters<typeof createProfileConformanceCheck>[0]['sdLoader'] {
  return { loadProfile: async () => definition } as unknown as Parameters<typeof createProfileConformanceCheck>[0]['sdLoader'];
}
function collected(issues: Awaited<ReturnType<typeof run>>['issues'], definition: StructureDefinition): MultiAspectValidateResult {
  const isValid = !issues.some(issue => ['error', 'fatal'].includes(issue.severity));
  return { structureDef: definition, isValid, aspects: [{ aspect: 'profile', issues, evidenceIssues: issues, validationTime: 0, isValid }] };
}

for (const type of ['value', 'pattern'] as const) describe(`resolved-code unknown bounds (${type})`, () => {
  it.each([0, 4])('does not claim an unknown slice minimum absent beside known code %s', async index => {
    const definition = profile(type); definition.snapshot!.element.find(element => element.sliceName === names[1])!.min = 1;
    const { issues } = await run(definition, [index]);
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(false);
    expect(issues.some(issue => details(issue).validationComplete === false)).toBe(true);
  });
  it.each([0, 4])('retains the proved missing bound when one occurrence cannot fill minimum2 beside code %s', async index => {
    const definition = profile(type); definition.snapshot!.element.find(element => element.sliceName === names[1])!.min = 2;
    const { issues } = await run(definition, [index]);
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(1);
  });
  it('does not claim an unknown parent absent when its known child is present', async () => {
    const definition = profile(type);
    for (const element of definition.snapshot!.element) for (const [from, to] of [[names[0], 'observations/known-child'], [names[1], 'observations']]) {
      if (element.id?.startsWith(`${field}:${from}`)) { element.id = element.id.replace(`:${from}`, `:${to}`); if (element.sliceName) element.sliceName = to; }
    }
    const parent = definition.snapshot!.element.find(element => element.sliceName === 'observations')!;
    parent.min = 1; parent.slicing = { discriminator: [{ type, path: 'resolve().code' }, { type: 'value', path: 'display' }], rules: 'open', ordered: false };
    expect((await run(definition, [0])).issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(false);
  });
  it('retains unrelated proved minima and maxima beside unknown membership', async () => {
    const definition = profile(type, true, true), other = definition.snapshot!.element.find(element => element.sliceName === names[2])!;
    other.min = 1;
    const minimum = (await run(definition, [0])).issues.filter(issue => issue.code === 'profile-slice-min-cardinality');
    expect(minimum).toHaveLength(1); expect(details(minimum[0]).sliceName).toBe(names[2]);
    other.min = 0; other.max = '1';
    const maximum = (await run(definition, [4, 4, 0], true)).issues.filter(issue => issue.code === 'profile-slice-max-cardinality');
    expect(maximum).toHaveLength(1); expect(details(maximum[0]).sliceName).toBe(names[2]); expect(details(maximum[0]).actual).toBe(2);
  });
  it('retains empty and required-literal negative minima', async () => {
    const definition = profile(type); definition.snapshot!.element.find(element => element.sliceName === names[1])!.min = 1;
    expect((await run(definition, [])).issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(1);
    const issues = (await run(definition, [0], false, true)).issues;
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(1);
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(true);
  });
  it.each(['composite', 'advisory', 'blocking'])('keeps %s metadata uncertainty incomplete through semantic projection and conformance', async kind => {
    const definition = profile(type, kind === 'composite');
    if (kind === 'blocking') definition.snapshot!.element.find(element => element.sliceName === names[0])!.type![0].targetProfile = [unavailable];
    const { resource, issues } = await run(definition, [0]);
    const result = collected(issues, definition);
    expect(issues.some(issue => details(issue).validationComplete === false)).toBe(true);
    expect(projectSemanticAspectResult(result, resolveSemanticAspectPlan(['profile'])).isValid).toBe(false);
    let calls = 0;
    const conforms = createProfileConformanceCheck({ sdLoader: profileLoader(definition),
      validateOne: async () => { calls++; return result; }, fhirVersion: 'R4', recursionDepth: 0 })!;
    expect(await conforms(resource, definition.url!)).toBeUndefined(); expect(await conforms(resource, definition.url!)).toBeUndefined(); expect(calls).toBe(2);
  });
  it.each(['advisory', 'blocking', 'required-literal'])('retains proved code-only %s cardinality bounds', async kind => {
    const definition = profile(type, false);
    definition.snapshot!.element.find(element => element.sliceName === names[1])!.min = kind === 'required-literal' ? 1 : 2;
    if (kind === 'blocking') definition.snapshot!.element.find(element => element.sliceName === names[0])!.type![0].targetProfile = [unavailable];
    const { issues } = await run(definition, [0], false, kind === 'required-literal');
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality' && details(issue).sliceName === names[1])).toBe(true);
  });
  it('retains complete known conformance and its session cache', async () => {
    const definition = profile(type);
    definition.snapshot!.element.find(element => element.sliceName === names[1])!.type![0].targetProfile = [targets[1].url!];
    const { resource, issues } = await run(definition, [0]);
    expect(issues.some(issue => details(issue).validationComplete === false)).toBe(false);
    const result = collected(issues, definition); expect(projectSemanticAspectResult(result, resolveSemanticAspectPlan(['profile'])).isValid).toBe(true);
    let calls = 0;
    const conforms = createProfileConformanceCheck({ sdLoader: profileLoader(definition),
      validateOne: async () => { calls++; return result; }, fhirVersion: 'R4', recursionDepth: 0 })!;
    expect(await conforms(resource, definition.url!)).toBe(true); expect(await conforms(resource, definition.url!)).toBe(true); expect(calls).toBe(1);
  });
});
