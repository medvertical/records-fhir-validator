/**
 * Constraint Context Resolver
 *
 * Resolves the FHIRPath evaluation context (and possibly rewritten
 * expression) for a constraint attached to a given element path.
 */

import { getEvaluationContext } from './constraint-path-utils';
import {
  choiceContextHasOnlyOtherTypes,
  expressionStartsAtResourceRoot,
  getThisCastType,
  hasUnresolvableChoiceTypes,
} from './constraint-choice-context';

/**
 * Resolve the evaluation context and (possibly rewritten) expression for a constraint.
 *
 * Two cases require special handling:
 *
 * 1. **Choice-type elements (`[x]`)**: fhirpath.js loses type metadata when
 *    values are extracted as raw JS primitives, so `$this as dateTime` etc.
 *    fail. Fix: keep the parent as context and wrap the expression with
 *    element navigation (`effective.all(...)`) so FHIRPath resolves the
 *    typed value through the model.
 *
 * 2. **Backbone elements** (component, contact, etc.): extracting a backbone
 *    element as a raw JS object strips `resourceType`, so fhirpath.js can't
 *    resolve choice-type children (e.g. `value.exists()` fails because
 *    `valueQuantity` isn't found via the FHIR model). Fix: evaluate from
 *    the resource root and navigate with `pathSegments.all(expr)`.
 */
export function resolveConstraintContext(
  resource: any,
  elementPath: string,
  rawExpression: string,
): { context: any; expression: string } {
  if (expressionStartsAtResourceRoot(rawExpression, resource.resourceType)) {
    return { context: resource, expression: rawExpression };
  }

  const lastSegment = elementPath.split('.').pop() ?? '';
  if (lastSegment.endsWith('[x]')) {
    const choiceElementName = lastSegment.slice(0, -3);
    const parentPath = elementPath.split('.').slice(0, -1).join('.');
    const ctx = parentPath
      ? getEvaluationContext(resource, parentPath)
      : resource;
    const castType = getThisCastType(rawExpression);
    if (castType && choiceContextHasOnlyOtherTypes(ctx, choiceElementName, castType)) {
      return { context: ctx, expression: 'true' };
    }
    return { context: ctx, expression: `${choiceElementName}.all(${rawExpression})` };
  }

  const ctx = getEvaluationContext(resource, elementPath);

  // Backbone elements (no `resourceType`) lose FHIR model context,
  // so fhirpath.js can't resolve choice-type children like `value`
  // → `valueQuantity`. Only fall back to resource-root evaluation
  // when the context actually contains resolved choice-type properties
  // (e.g. `valueQuantity`, `effectiveDateTime`) that match names
  // used in the expression.
  if (Array.isArray(ctx) && ctx.some(item =>
    item && typeof item === 'object' && !item.resourceType && hasUnresolvableChoiceTypes(item, rawExpression)
  )) {
    const segments = elementPath.split('.');
    if (segments.length > 1 && segments[0] === resource.resourceType) {
      const fhirPathNav = segments.slice(1).join('.');
      return { context: resource, expression: `${fhirPathNav}.all(${rawExpression})` };
    }
  }

  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx) && !ctx.resourceType && ctx !== resource) {
    if (hasUnresolvableChoiceTypes(ctx, rawExpression)) {
      const segments = elementPath.split('.');
      if (segments.length > 1 && segments[0] === resource.resourceType) {
        const fhirPathNav = segments.slice(1).join('.');
        return { context: resource, expression: `${fhirPathNav}.all(${rawExpression})` };
      }
    }
  }

  return { context: ctx, expression: rawExpression };
}
