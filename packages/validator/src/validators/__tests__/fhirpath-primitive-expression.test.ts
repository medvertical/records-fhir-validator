import { describe, expect, it } from 'vitest';
import { getPrimitiveSidecar } from '../../core/fhir-primitive-sidecar.js';
import { normalizePrimitiveConstraintExpression } from '../fhirpath-primitive-expression.js';

const raw = { extension: [{ url: 'https://records.test/extension', valueCode: 'masked' }] };
const marked = getPrimitiveSidecar({ _value: raw }, 'value');

describe('primitive constraint expression normalization', () => {
  it('changes only the leading implicit string receiver and preserves the remainder', () => {
    expect(normalizePrimitiveConstraintExpression(" \t\n matches ('^A$') or extension('x').exists()", marked))
      .toBe(" \t\n $this.getValue().matches ('^A$') or extension('x').exists()");
  });
  it.each(["$this.matches('A')", "extension('x').valueString.matches('A')", "all(matches('A'))",
    "'matches(A)' = 'matches(A)'", "/* matches('A') */ matches('A')", "matchesFull('A')"])(
    'retains expression %s', expression => {
      expect(normalizePrimitiveConstraintExpression(expression, marked)).toBe(expression);
    });
  it.each([raw, [marked], 'A', undefined, null])('does not change an unmarked or collection context %j', context => {
    const expression = "matches('A')";
    expect(normalizePrimitiveConstraintExpression(expression, context)).toBe(expression);
  });
});
