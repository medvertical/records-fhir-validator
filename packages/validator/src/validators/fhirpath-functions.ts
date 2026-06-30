import { logger as _logger } from '../logger';
import { memberOfFunction as cachedMemberOfFunction } from './fhirpath-custom-functions';

// ============================================================================
// Types
// ============================================================================

export interface FHIRPathContext {
    /** Root resource being validated */
    rootResource: any;
    /** All resources in bundle/contained for reference resolution */
    bundleResources?: Map<string, any>;
    /** ValueSet validator for memberOf */
    valueSetValidator?: any;
}

type BundleResourceInput =
    | Map<string, any>
    | any[]
    | { entry?: any[] };

// ============================================================================
// resolve() function
// ============================================================================

/**
 * Resolves a Reference to the actual resource
 * Used in constraints like: reference.resolve().exists()
 */
export function resolveFunction(input: any[], context: FHIRPathContext): any[] {
    const results: any[] = [];

    for (const item of input) {
        if (!item || typeof item !== 'object') continue;

        // Handle Reference type
        let reference = item.reference || item;
        if (typeof reference !== 'string') continue;

        // Try to resolve from bundle
        if (context.bundleResources) {
            // Try full URL
            if (context.bundleResources.has(reference)) {
                results.push(context.bundleResources.get(reference));
                continue;
            }

            // Try relative reference (e.g., "Patient/123")
            for (const [url, resource] of context.bundleResources) {
                if (url.endsWith(reference) || url.includes(reference)) {
                    results.push(resource);
                    break;
                }
            }
        }

        // Try contained resources
        if (context.rootResource?.contained) {
            const refId = reference.startsWith('#') ? reference.substring(1) : reference;
            const contained = context.rootResource.contained.find((r: any) => r.id === refId);
            if (contained) {
                results.push(contained);
            }
        }
    }

    return results;
}

// ============================================================================
// memberOf() function
// ============================================================================

/**
 * Checks if a code is a member of a ValueSet
 * Used in constraints like: code.memberOf('http://hl7.org/fhir/ValueSet/observation-status')
 */
export function memberOfFunction(input: any[], valueSetUrl: string | string[], _context: FHIRPathContext): any[] {
    const url = Array.isArray(valueSetUrl) ? valueSetUrl[0] : valueSetUrl;
    if (!url || input.length === 0) return [];

    let sawDeterminate = false;
    for (const item of input) {
        const result = cachedMemberOfFunction.fn([item], [url]);
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
 */
export function conformsToFunction(input: any[], profileUrl: string): boolean[] {
    const results: boolean[] = [];

    for (const item of input) {
        if (!item || typeof item !== 'object') {
            results.push(false);
            continue;
        }

        // Check meta.profile
        if (item.meta?.profile && Array.isArray(item.meta.profile)) {
            results.push(item.meta.profile.includes(profileUrl));
        } else {
            // Check if resourceType matches profile
            if (profileUrl.includes(item.resourceType)) {
                results.push(true);
            } else {
                results.push(false);
            }
        }
    }

    return results.length > 0 ? results : [true];
}

// ============================================================================
// extension() function
// ============================================================================

/**
 * Gets extension by URL
 * Used in constraints like: extension('http://hl7.org/fhir/StructureDefinition/patient-birthPlace')
 */
export function extensionFunction(input: any[], extensionUrl: string): any[] {
    const results: any[] = [];

    for (const item of input) {
        if (!item || typeof item !== 'object') continue;

        const extensions = item.extension || [];
        for (const ext of extensions) {
            if (ext.url === extensionUrl) {
                results.push(ext);
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
    rootResource: any,
    bundleResources?: BundleResourceInput
): FHIRPathContext {
    const resourceMap = new Map<string, any>();

    const addResource = (resource: any, explicitReference?: string) => {
        if (!resource || typeof resource !== 'object') return;
        if (explicitReference) {
            resourceMap.set(explicitReference, resource);
        }
        if (resource.id && resource.resourceType) {
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
            addResource(entry?.resource, typeof entry?.fullUrl === 'string' ? entry.fullUrl : undefined);
        }
    }

    return {
        rootResource,
        bundleResources: resourceMap
    };
}
