import { isFhirResource } from '../core/fhir-resource.js';
import { getEvaluationContext } from './constraint-path-utils.js';

/**
 * A boundary field belongs to its containing resource; descendants belong to
 * the embedded resource. Inlined type-profile root rules opt into the embedded
 * resource only after matching the referenced profile's root constraint.
 * Undefined when the path does not start at the root.
 */
export function focusResourceOf(root: unknown, path: string, includeSelf = false): unknown {
  if (!isFhirResource(root) || (path !== root.resourceType && !path.startsWith(`${root.resourceType}.`))) return undefined;
  const segments = path.split('.');
  for (let end = segments.length - (includeSelf ? 0 : 1); end > 1; end -= 1) {
    const candidate = getEvaluationContext(root, segments.slice(0, end).join('.'));
    if (isFhirResource(candidate)) return candidate;
  }
  return root;
}

/** A datatype keeps its explicit owner; a resource can contain another resource. */
export function constraintFocusResource(
  resource: unknown,
  rootResource: unknown,
  path: string,
  explicitFocus: unknown,
  includeSelf = false,
): unknown {
  if (explicitFocus !== undefined && explicitFocus !== resource) return explicitFocus;
  return resource === rootResource || explicitFocus === resource
    ? focusResourceOf(resource, path, includeSelf) ?? explicitFocus
    : explicitFocus;
}
