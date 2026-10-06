import { normalizeFhirReferenceKey } from '../core/fhir-reference-key.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import { makeTypedResourceNode, unwrapFhirPathValue } from './fhirpath-node-unwrap.js';

export interface FHIRPathEvaluationContext {
  rootResource: unknown;
  bundle?: unknown;
}

/**
 * Resolve contained and bundle-local FHIR references without remote I/O.
 *
 * The reference validator fetches an absolute http(s) reference it cannot
 * resolve locally, so an invariant such as `provider.all(resolve() is
 * Practitioner)` sees the target's type. Without I/O the type is taken from
 * the URL itself (`…/Practitioner/123`): the stub answers type tests, while
 * content predicates on it stay empty. Relative references that miss the
 * bundle and contained resources yield EMPTY, as they do in the reference
 * validator.
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

  const normalizedReference = normalizeFhirReferenceKey(rawReference);
  // A Bundle's own invariants resolve against its entries, whatever batch it
  // came in (Da Vinci PCT's `Bundle.entry.descendants().reference
  // .all(resolve().exists())`).
  const ownEntries = isObjectRecord(context.rootResource) && context.rootResource.resourceType === 'Bundle'
    ? context.rootResource
    : undefined;
  for (const bundle of [context.bundle, ownEntries]) {
    const target = bundleEntryResource(bundle, rawReference, normalizedReference);
    if (target !== undefined) return target;
  }
  return absoluteReferenceStub(rawReference, normalizedReference);
}

function bundleEntryResource(bundle: unknown, rawReference: string, normalizedReference: string | null): unknown {
  if (!isObjectRecord(bundle) || !Array.isArray(bundle.entry)) return undefined;
  for (const entry of bundle.entry) {
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

function absoluteReferenceStub(rawReference: string, normalizedReference: string | null): unknown {
  if (!/^https?:\/\//i.test(rawReference) || !normalizedReference) return undefined;
  const [resourceType, id] = normalizedReference.split('/');
  if (!resourceType || !id || !KNOWN_FHIR_RESOURCE_TYPES.has(resourceType)) return undefined;
  return { resourceType, id };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
