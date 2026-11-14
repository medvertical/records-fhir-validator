import fhirpath from 'fhirpath';
import { describe, expect, it } from 'vitest';
import { comparisonValues, rewritePrimitiveComparisons } from '../fhirpath-primitive-comparison';
import { getFhirPathModel } from '../../core/fhirpath-context';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';
import { ConstraintValidator } from '../constraint-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

const extension = 'http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-additionalLocator';
const expression = `address.line[1].extension('${extension}').exists() implies address.line[1] = (address.line[1].extension('${extension}').value as string)`;
const resource = { resourceType: 'Organization', address: [{ line: ['Street 2', 'Ground floor'],
  _line: [null, { extension: [{ url: extension, valueString: 'Ground floor' }] }] }] };
function profile(rule: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'http://example.org/Organization', name: 'Organization',
    status: 'active', kind: 'resource', abstract: false, type: 'Organization', snapshot: { element: [{
      id: 'Organization', path: 'Organization', constraint: [{ key: 'primitive-equality', severity: 'error', human: 'Compare actual values', expression: rule }],
    }] } };
}
const runners = {
  snapshot: (r: Record<string, unknown>, sd: StructureDefinition) => new SDFHIRPathExecutor().execute({ resource: r, resourceType: 'Organization', structureDef: sd }),
  constraint: (r: Record<string, unknown>, sd: StructureDefinition) => new ConstraintValidator().validate(r, sd.snapshot!.element, sd.url),
};
describe.each(Object.entries(runners))('%s primitive equality', (_name, run) => {
  it('compares primitive values while retaining their extension navigation', async () => {
    const before = JSON.stringify(resource); expect(await run(resource, profile(expression))).toEqual([]);
    expect(JSON.stringify(resource)).toBe(before);
  });
  it('still rejects a value that differs from its accompanying extension', async () => {
    const bad = structuredClone(resource); bad.address[0].line[1] = 'Upper floor';
    const issues = await run(bad, profile(expression));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', ruleId: 'primitive-equality' }));
    expect(issues.some(i => i.code === 'profile-constraint-evaluation-error')).toBe(false);
  });
  it('keeps complex-element metadata significant', async () => {
    const r = { resourceType: 'Organization', address: [{ city: 'Berlin', id: 'a' }, { city: 'Berlin', id: 'b' }] };
    expect(await run(r, profile('address[0] != address[1]'))).toEqual([]);
  });
});

describe('comparison operand rewrite', () => {
  it.each([
    ["'x' = 'x'", [true]], ["('x' = 'x') and ('Y' != 'y')", [true]],
    ["'a=b' = 'a=b'", [true]], ["'😀' = '😀'", [true]],
    ["1 = 1 and 0.1 + 0.2 = 0.3", [true]], ["(1 | 2) = (1 | 2)", [true]],
    ['{} = {}', []], ['true = (true = false)', [false]],
    ["'a' /* = ignored */ =\n'a'", [true]],
    ["toString() = '{}'", [false]], ["%resource.id = 'a'", [true]],
    ["('a'.substring(0, 1)) = 'a'", [true]],
  ])('preserves literal, collection and nested semantics: %s', (source, expected) => {
    const rewritten = rewritePrimitiveComparisons(source);
    expect(fhirpath.evaluate({}, rewritten, { resource: { id: 'a' } }, getFhirPathModel('R4'), { preciseMath: true,
      userInvocationTable: { recordsComparisonValue: { fn: comparisonValues, arity: { 0: [] }, internalStructures: true } } })).toEqual(expected);
  });
});
