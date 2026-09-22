import { logger as _logger } from '../logger.js';
import { createMemberOfFunction, extensionFunction } from './fhirpath-custom-functions.js';
import { makeTypedResourceNode, unwrapFhirPathValue } from './fhirpath-node-unwrap.js';
import { normalizeFhirReferenceKey } from '../core/fhir-reference-key.js';
import { ValueSetCache } from './valueset-cache.js';

export { extensionFunction } from './fhirpath-custom-functions.js';

// ============================================================================
// Types
// ============================================================================

export interface FHIRPathContext {
    /** Root resource being validated */
    rootResource: unknown;
    /** All resources in bundle/contained for reference resolution */
    bundleResources?: Map<string, unknown>;
    /** ValueSet validator for memberOf */
    valueSetCache?: ValueSetCache;
}

export type FHIRPathBundleInput =
    | Map<string, unknown>
    | unknown[]
    | { entry?: unknown[] };

// ============================================================================
// resolve() function
// ============================================================================

/**
 * Resolves a Reference to the actual resource
 * Used in constraints like: reference.resolve().exists()
 *
 * Unresolvable references yield EMPTY (never the Reference itself), matching
 * the HL7 validator's local resolve(). With an evaluation context the result
 * is wrapped as a typed node so `resolve() is X` / `.ofType(X)` keep working.
 */
export function resolveFunction(
    input: unknown[],
    context: FHIRPathContext,
    evaluationContext?: unknown,
): unknown[] {
    const results: unknown[] = [];

    for (const item of input) {
        const resolved = resolveReferenceValue(item, context);
        if (resolved !== undefined) {
            results.push(makeTypedResourceNode(item, evaluationContext, resolved));
        }
    }

    return results;
}

function resolveReferenceValue(item: unknown, context: FHIRPathContext): unknown {
    const referenceValue = unwrapFhirPathValue(item);
    if (!isObjectRecord(referenceValue)) return undefined;

    const reference = referenceValue.reference;
    if (typeof reference !== 'string') return undefined;

    if (context.bundleResources) {
        if (context.bundleResources.has(reference)) {
            return context.bundleResources.get(reference);
        }

        const relativeKey = normalizeFhirReferenceKey(reference);
        if (relativeKey && context.bundleResources.has(relativeKey)) {
            return context.bundleResources.get(relativeKey);
        }
    }

    if (reference.startsWith('#') && isObjectRecord(context.rootResource)) {
        const containedResources = Array.isArray(context.rootResource.contained)
            ? context.rootResource.contained
            : [];
        const refId = reference.substring(1);
        return containedResources.find(resource =>
            isObjectRecord(resource) && resource.id === refId
        );
    }

    return undefined;
}

// ============================================================================
// memberOf() function
// ============================================================================

/**
 * Checks if a code is a member of a ValueSet
 * Used in constraints like: code.memberOf('http://hl7.org/fhir/ValueSet/observation-status')
 */
export function memberOfFunction(input: unknown[], valueSetUrl: string | string[], context: FHIRPathContext): boolean[] {
    const url = Array.isArray(valueSetUrl) ? valueSetUrl[0] : valueSetUrl;
    if (!url || input.length === 0) return [];

    let sawDeterminate = false;
    for (const item of input) {
        const result = createMemberOfFunction(context.valueSetCache ?? new ValueSetCache()).fn([item], [url]);
        if (!Array.isArray(result) || result.length === 0) {
            continue;
        }
        sawDeterminate = true;
        if (result[0] === false) return [false];
    }

    return sawDeterminate ? [true] : [];
}

// ============================================================================
// conformsTo() function
// ============================================================================

/**
 * Checks if a resource conforms to a profile
 * Used in constraints like: conformsTo('http://hl7.org/fhir/StructureDefinition/Patient')
 *
 * Empty input propagates to an empty result (constraints stay vacuously
 * satisfied, matching the HL7 validator) instead of asserting conformance.
 */
export function conformsToFunction(input: unknown[], profileUrl: string): boolean[] {
    const results: boolean[] = [];

    for (const item of input) {
        const resource = unwrapFhirPathValue(item);
        if (!isObjectRecord(resource)) {
            results.push(false);
            continue;
        }

        // Check meta.profile
        const meta = isObjectRecord(resource.meta) ? resource.meta : null;
        if (meta && Array.isArray(meta.profile)) {
            results.push(meta.profile.some(profile => profile === profileUrl));
        } else {
            // Check if resourceType matches profile
            if (typeof resource.resourceType === 'string' && profileUrl.includes(resource.resourceType)) {
                results.push(true);
            } else {
                results.push(false);
            }
        }
    }

    return results;
}

// ============================================================================
// Register functions with fhirpath.js
// ============================================================================

/**
 * Custom function definitions for fhirpath.js
 * These can be passed to fhirpath.evaluate() as userInvocationTable
 */
export const fhirPathCustomFunctions = {
    resolve: {
        fn: resolveFunction,
        arity: { 0: [] }
    },
    memberOf: {
        fn: memberOfFunction,
        arity: { 1: ['String'] }
    },
    conformsTo: {
        fn: conformsToFunction,
        arity: { 1: ['String'] }
    },
    extension: {
        fn: extensionFunction,
        arity: { 1: ['String'] }
    }
};

/**
 * Create a context object with bundle resources for reference resolution
 */
export function createFHIRPathContext(
    rootResource: unknown,
    bundleResources?: FHIRPathBundleInput,
    cache: ValueSetCache = new ValueSetCache(),
): FHIRPathContext {
    const resourceMap = new Map<string, unknown>();

    const addResource = (resource: unknown, explicitReference?: string) => {
        if (!isObjectRecord(resource)) return;
        if (explicitReference) {
            resourceMap.set(explicitReference, resource);
        }
        if (typeof resource.id === 'string' && typeof resource.resourceType === 'string') {
            resourceMap.set(`${resource.resourceType}/${resource.id}`, resource);
        }
        if (typeof resource.fullUrl === 'string') {
            resourceMap.set(resource.fullUrl, resource);
        }
    };

    if (bundleResources instanceof Map) {
        for (const [reference, resource] of bundleResources) {
            addResource(resource, typeof reference === 'string' ? reference : undefined);
        }
    } else if (Array.isArray(bundleResources)) {
        for (const resource of bundleResources) {
            addResource(resource);
        }
    } else if (Array.isArray(bundleResources?.entry)) {
        for (const entry of bundleResources.entry) {
            if (!isObjectRecord(entry)) continue;
            addResource(
                entry.resource,
                typeof entry.fullUrl === 'string' ? entry.fullUrl : undefined,
            );
        }
    }

    return {
        rootResource,
        bundleResources: resourceMap,
        valueSetCache: cache,
    };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
