/**
 * Constraint Context Resolver
 *
 * Resolves the FHIRPath evaluation context (and possibly rewritten
 * expression) for a constraint attached to a given element path.
 */

import { splitConcreteChoiceProperty } from '../core/fhir-choice-property.js';
import { isFhirResource } from '../core/fhir-resource.js';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { getEvaluationContext } from './constraint-path-utils.js';
import { hasUnresolvableChoiceTypes } from './constraint-choice-context.js';
import type { FhirResource } from './constraint-validation-input.js';

/**
 * Resolve the evaluation context and (possibly rewritten) expression for a constraint.
 *
 * Two cases require special handling:
 *
 * 1. **Choice-type elements** (`effective[x]`, or its concrete form
 *    `effectiveDateTime`): fhirpath.js loses type metadata when values are
 *    extracted as raw JS primitives, so `$this as dateTime` is empty. Fix:
 *    navigate the choice element from its parent or resource
 *    (`effective.all(...)`) so FHIRPath resolves the typed value through the
 *    model.
 *
 * 2. **Backbone elements** (component, contact, etc.): extracting a backbone
 *    element as a raw JS object strips `resourceType`, so fhirpath.js can't
 *    resolve choice-type children (e.g. `value.exists()` fails because
 *    `valueQuantity` isn't found via the FHIR model). Fix: evaluate from
 *    the resource root and navigate with `pathSegments.all(expr)`.
 */
export function resolveConstraintContext(
  resource: FhirResource,
  elementPath: string,
  rawExpression: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): { context: unknown; expression: string } {
  const lastSegment = elementPath.split('.').pop() ?? '';
  if (lastSegment.endsWith('[x]')) {
    const choiceElementName = lastSegment.slice(0, -3);
    const parentPath = elementPath.split('.').slice(0, -1).join('.');
    const ctx = parentPath
      ? getEvaluationContext(resource, parentPath)
      : resource;
    return { context: ctx, expression: `${choiceElementName}.all(${rawExpression})` };
  }

  const concreteChoice = concreteChoiceNavigation(resource, elementPath, fhirVersion);
  if (concreteChoice) {
    return {
      context: concreteChoice.resource,
      expression: `${concreteChoice.navigation}.all(${rawExpression})`,
    };
  }

  const ctx = getEvaluationContext(resource, elementPath);

  // Backbone elements (no `resourceType`) lose FHIR model context,
  // so fhirpath.js can't resolve choice-type children like `value`
  // → `valueQuantity`. Only fall back to resource-root evaluation
  // when the context actually contains resolved choice-type properties
  // (e.g. `valueQuantity`, `effectiveDateTime`) that match names
  // used in the expression.
  if (Array.isArray(ctx) && ctx.some(item =>
    isRecord(item) &&
    typeof item.resourceType !== 'string' &&
    hasUnresolvableChoiceTypes(item, rawExpression)
  )) {
    const segments = elementPath.split('.');
    if (segments.length > 1 && segments[0] === resource.resourceType) {
      const fhirPathNav = segments.slice(1).join('.');
      return { context: resource, expression: `${fhirPathNav}.all(${rawExpression})` };
    }
  }

  if (
    isRecord(ctx) &&
    typeof ctx.resourceType !== 'string' &&
    ctx !== resource
  ) {
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

/**
 * The FHIRPath navigation, from the resource that contains it, of a concrete
 * choice element path such as `Observation.component[0].valueQuantity`
 * (`component[0].value`). The model decides, so `birthDate` is not mistaken
 * for a `birth[x]` choice.
 */
function concreteChoiceNavigation(
  rootResource: FhirResource,
  elementPath: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
): { resource: FhirResource; navigation: string } | null {
  const segments = elementPath.split('.');
  if (segments.length < 2) return null;
  const choice = splitConcreteChoiceProperty(stripIndex(segments[segments.length - 1]));
  if (!choice) return null;

  let resource = rootResource;
  let start = 1;
  for (let end = segments.length - 1; end > 1; end--) {
    const ancestor = getEvaluationContext(rootResource, segments.slice(0, end).join('.'));
    if (isFhirResource(ancestor)) {
      resource = ancestor;
      start = end;
      break;
    }
  }

  const parentSegments = segments.slice(start, -1);
  const model = getFhirPathModel(fhirVersion);
  const parentPath = [resource.resourceType, ...parentSegments.map(stripIndex)].join('.');
  const parentTypes = [
    parentPath,
    model.pathsDefinedElsewhere[parentPath],
    model.path2Type[parentPath],
  ].filter((path): path is string => typeof path === 'string');
  const isChoice = parentTypes.some(path =>
    model.choiceTypePaths[`${path}.${choice.baseName}`]?.includes(choice.typeSuffix));
  if (!isChoice) return null;

  return { resource, navigation: [...parentSegments, choice.baseName].join('.') };
}

function stripIndex(segment: string): string {
  return segment.replace(/\[\d+\]$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
