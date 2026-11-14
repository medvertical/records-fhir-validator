import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';
import { fixKnownInvariantExpression } from '../fhirpath-expression-fixer';
import type { StructureDefinition } from '../../core/structure-definition-types';

const expression = String.raw`toString().matches('^\\S*[\/:?*\\\"<>|]\\S*$').not()`;
function profile(rule = expression): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'http://example.org/invoice-number', name: 'InvoiceNumber',
    type: 'Composition', kind: 'resource', abstract: false, status: 'active', snapshot: { element: [{
      id: 'Composition.identifier.value', path: 'Composition.identifier.value', type: [{ code: 'string' }],
      constraint: [{ key: 'char-1', expression: rule, severity: 'error', human: 'Invoice number contains prohibited characters' }],
    }] } };
}
const runners = {
  snapshot: (resource: Record<string, unknown>, sd: StructureDefinition) => new SDFHIRPathExecutor().execute({ resource, resourceType: 'Composition', structureDef: sd }),
  constraint: (resource: Record<string, unknown>, sd: StructureDefinition) => new ConstraintValidator().validate(resource, sd.snapshot!.element, sd.url),
};
describe.each(Object.entries(runners))('%s published invoice number regex', (_name, run) => {
  it.each(['INV-2026.123', 'Ärztin-2026', '漢字123', 'INV 2026', 'INV /2026', 'INV\\2026'])('evaluates an accepted value without skipping the constraint: %s', async value => {
    const resource = { resourceType: 'Composition', identifier: { value } }, sd = profile();
    const before = JSON.stringify({ resource, sd });
    expect(await run(resource, sd)).toEqual([]);
    expect(JSON.stringify({ resource, sd })).toBe(before);
  });
  it.each(['/', ':', '?', '*', '"', '<', '>', '|'])('retains the intended rejection of %s', async character => {
    const issues = await run({ resourceType: 'Composition', identifier: { value: 'INV'+character+'2026' } }, profile());
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', ruleId: 'char-1' }));
    expect(issues.some(issue => issue.code === 'profile-constraint-evaluation-error')).toBe(false);
  });
  it('keeps other malformed patterns explicitly incomplete', async () => {
    const issues = await run({ resourceType: 'Composition', identifier: { value: 'INV' } }, profile("toString().matches('[unterminated')"));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-constraint-evaluation-error' }));
  });
});
it('does not rewrite another constraint merely because its key is char-1', () => {
  const other = "toString().matches('A[B]')";
  expect(fixKnownInvariantExpression(other, 'char-1', 'R4')).toBe(other);
});
