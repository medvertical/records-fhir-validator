import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor.js';
import { SDElementMatcher } from '../sd-element-matcher.js';

const dar = { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'masked' }] };
function profile(type = 'string', choice = false): StructureDefinition {
  const path = choice ? 'Patient.value[x]' : 'Patient.given';
  return { resourceType: 'StructureDefinition', url: 'https://records.test/Profile/array',
    name: 'PrimitiveArray', status: 'active', kind: 'resource', abstract: false, type: 'Patient',
    snapshot: { element: [{ id: 'Patient', path: 'Patient' }, { id: path, path, type: [{ code: type }],
      constraint: [{ key: 'primitive-rule', severity: 'warning', human: 'String required', expression: "matches('^A$')" }] }] } };
}
async function run(resource: Record<string, unknown>, structureDef = profile()) {
  return new SDFHIRPathExecutor().execute({ resource: { resourceType: 'Patient', ...resource }, resourceType: 'Patient', structureDef });
}
const warning = (index: number) => expect.objectContaining({ severity: 'warning', ruleId: 'primitive-rule', path: `Patient.given[${index}]` });

describe('SD primitive array constraint targets', () => {
  it('retains a metadata-only array index without inventing a null target', async () => {
    const resource = { _given: [null, dar] };
    const before = JSON.stringify(resource);
    expect(await run(resource)).toEqual([warning(1)]);
    expect(JSON.stringify(resource)).toBe(before);
  });
  it('retains real values and missing-value metadata at their aligned indices', async () => {
    expect(await run({ given: ['A', null, 'bad'], _given: [dar, dar, null] }))
      .toEqual([warning(1), warning(2)]);
  });
  it('visits a trailing metadata-only item without shifting its position', async () => {
    expect(await run({ given: ['A'], _given: [null, dar] })).toEqual([warning(1)]);
  });
  it('ignores empty primitive metadata', async () => {
    expect(await run({ _given: [{}, null] })).toEqual([]);
  });
  it('preserves definite false and true primitive values', () => {
    const result = new SDElementMatcher().match({ resourceType: 'Patient', given: [false, true], _given: [dar, dar] }, profile('boolean'));
    expect(result.constraintElements.map(match => match.data)).toEqual([false, true]);
  });
  it.each([false, 0, '', 'A', 'bad', { invalid: true }])(
    'preserves a real scalar or object %j even with malformed array metadata', value => {
      const result = new SDElementMatcher().match({ resourceType: 'Patient', given: value, _given: [dar] }, profile());
      expect(result.constraintElements).toHaveLength(1);
      expect(result.constraintElements[0].data).toBe(value);
      expect(result.constraintElements[0].resourcePath).toBe('Patient.given');
    });
  it('preserves targets independently of value/sidecar key ordering', async () => {
    expect(await run({ _given: [dar], given: ['bad'] })).toEqual([warning(0)]);
    expect(await run({ given: ['bad'], _given: [dar] })).toEqual([warning(0)]);
  });
  it('recognizes a declared primitive choice sidecar', async () => {
    expect(await run({ _valueString: dar }, profile('string', true))).toEqual([expect.objectContaining({
      severity: 'warning', path: 'Patient.valueString', ruleId: 'primitive-rule' })]);
  });
  it('does not reinterpret unknown or complex underscore properties as primitive targets', () => {
    for (const resource of [{ _given: dar }, { _valueQuantity: dar }]) {
      const result = new SDElementMatcher().match({ resourceType: 'Patient', ...resource }, profile('Quantity', true));
      expect(result.constraintElements).toEqual([]);
      expect(result.unmatchedPaths).toContain(`Patient.${Object.keys(resource)[0]}`);
    }
  });
});
