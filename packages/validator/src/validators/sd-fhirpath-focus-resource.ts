import { isFhirResource } from '../core/fhir-resource.js';
import { getEvaluationContext } from './constraint-path-utils.js';

/**
 * FHIRPath's %resource is the resource that contains the node under test: a
 * Bundle entry's own resource rather than the Bundle (KBV Impfpass'
 * gender-amtlich-1 reads %resource.gender on a bundled Patient), a contained
 * resource rather than its container. %rootResource stays the outer one.
 * Undefined when the path does not start at the root.
 */
export function focusResourceOf(root: unknown, path: string): unknown {
  if (!isFhirResource(root) || (path !== root.resourceType && !path.startsWith(`${root.resourceType}.`))) return undefined;
  const segments = path.split('.');
  for (let end = segments.length; end > 1; end -= 1) {
    const candidate = getEvaluationContext(root, segments.slice(0, end).join('.'));
    if (isFhirResource(candidate)) return candidate;
  }
  return root;
}
