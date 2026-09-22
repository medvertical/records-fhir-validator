import { normalizeFhirReferenceKey } from '../core/fhir-reference-key.js';
import { makeTypedResourceNode, unwrapFhirPathValue } from './fhirpath-node-unwrap.js';

export interface FHIRPathEvaluationContext {
  rootResource: unknown;
  bundle?: unknown;
}

/**
 * Resolve contained and bundle-local FHIR references without remote I/O.
 * Unresolvable references yield EMPTY (never the Reference itself), so
 * `resolve() is X`-style constraints stay vacuously satisfiable exactly like
 * the HL7 validator's local resolve().
 */
export function resolveFunction(context: FHIRPathEvaluationContext) {
  return {
    // A regular function: fhirpath.js binds the evaluation context to `this`,
    // which the typed-node factory needs to wrap resolved resources.
    fn: function (this: unknown, inputs: unknown[]) {
      const results: unknown[] = [];
      for (const inputNode of inputs) {
        const resolved = resolveSingleReference(inputNode, context);
        if (resolved !== undefined) {
          results.push(makeTypedResourceNode(inputNode, this, resolved));
        }
      }
      return results;
    },
    arity: { 0: [] },
  };
}

function resolveSingleReference(
  inputNode: unknown,
  context: FHIRPathEvaluationContext,
): unknown {
  const reference = unwrapFhirPathValue(inputNode);
  const rawReference = isObjectRecord(reference) ? reference.reference : reference;
  if (typeof rawReference !== 'string' || rawReference.length === 0) return undefined;

  if (rawReference.startsWith('#') && isObjectRecord(context.rootResource)) {
    const containedId = rawReference.slice(1);
    const contained = Array.isArray(context.rootResource.contained)
      ? context.rootResource.contained.find(candidate =>
        isObjectRecord(candidate) && candidate.id === containedId
      )
      : undefined;
    return contained;
  }

  if (!isObjectRecord(context.bundle) || !Array.isArray(context.bundle.entry)) return undefined;
  const normalizedReference = normalizeFhirReferenceKey(rawReference);
  for (const entry of context.bundle.entry) {
    if (!isObjectRecord(entry) || !isObjectRecord(entry.resource)) continue;
    if (entry.fullUrl === rawReference) return entry.resource;
    const resource = entry.resource;
    if (
      typeof resource.resourceType === 'string'
      && typeof resource.id === 'string'
      && normalizedReference === `${resource.resourceType}/${resource.id}`
    ) return resource;
  }
  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
