import { isResolvedPrimitiveSidecarValue } from '../core/fhir-primitive-sidecar.js';

export function normalizePrimitiveConstraintExpression(expression: string, context: unknown): string {
  if (Array.isArray(context) || !isResolvedPrimitiveSidecarValue(context)) return expression;
  // fhirpath.js coerces an implicit matches() receiver before looking for its
  // primitive value. Keep the element for extension/context access while
  // explicitly selecting its absent value for this string operation.
  return expression.replace(/^([ \t\r\n]*)matches(?=[ \t\r\n]*\()/,
    (_match, leading: string) => `${leading}$this.getValue().matches`);
}
