/**
 * Synchronous FHIRPath custom functions used by fhirpath.js constraints.
 * Cache misses return `[]` so callers report an undetermined constraint
 * instead of silently passing.
 */

import { findConcreteChoiceProperty } from '../core/fhir-choice-property.js';
import { unwrapFhirPathNavigable, unwrapFhirPathValue } from './fhirpath-node-unwrap.js';
import { ISO_3166_1_ALPHA2, ISO_3166_1_ALPHA3 } from './iso3166-country-codes.js';
import { ValueSetCache } from './valueset-cache.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import { makeSubsumesCacheSuffix } from './terminology-subsumes-cache.js';
import { resolveFunction, type FHIRPathEvaluationContext } from './fhirpath-custom-resolve-function.js';

export { resolveFunction, type FHIRPathEvaluationContext } from './fhirpath-custom-resolve-function.js';

type ObjectRecord = Record<string, unknown>;

export const hasValueFunction = {
    fn: (inputs: unknown[]) => {
        if (inputs.length === 0) return [false];

        const value = inputs[0];
        if (value === null || value === undefined) return [false];
        if (typeof value === 'string' && value.trim() === '') return [false];
        if (Array.isArray(value) && value.length === 0) return [false];

        return [true];
    },
    arity: { 0: [] }
};

/**
 * Gets extension by URL
 * Used in constraints like: extension('http://hl7.org/fhir/StructureDefinition/patient-birthPlace')
 */
export function extensionFunction(input: unknown[], extensionUrl: string): unknown[] {
    const results: unknown[] = [];

    for (const item of input) {
        const rawItem = unwrapFhirPathNavigable(item);
        if (!isObjectRecord(rawItem)) continue;

        const extensions = Array.isArray(rawItem.extension) ? rawItem.extension : [];
        for (const ext of extensions) {
            if (isObjectRecord(ext) && ext.url === extensionUrl) {
                results.push(withNavigableChoiceValue(ext));
            }
        }
    }

    return results;
}

/**
 * fhirpath.js cannot map `.value` to the concrete `value[x]` key on the raw
 * objects this function returns (no TypeInfo), so expressions like
 * `extension(url).value.exists()` would always come back empty. Mirror the
 * concrete choice property onto `value` to keep navigation working.
 */
function withNavigableChoiceValue(ext: ObjectRecord): ObjectRecord {
    if ('value' in ext) return ext;
    const concreteKey = findConcreteChoiceProperty(ext, 'value');
    if (!concreteKey) return ext;
    return { ...ext, value: ext[concreteKey] };
}

export const extensionInvocationEntry = {
    fn: extensionFunction,
    arity: { 1: ['String'] },
};

export const conformsToFunction = {
    fn: (inputs: unknown[], args: unknown) => {
        // Empty input propagates to empty (vacuously satisfied constraint),
        // matching the HL7 validator, instead of asserting non-conformance.
        if (inputs.length === 0) return [];

        const resource = unwrapFhirPathValue(inputs[0]);
        if (!isObjectRecord(resource)) return [false];

        const profileUrl = Array.isArray(args) ? args[0] : args;
        if (typeof profileUrl !== 'string' || profileUrl.length === 0) return [false];

        const meta = isObjectRecord(resource.meta) ? resource.meta : null;
        const profiles = meta?.profile ?? [];
        if (!Array.isArray(profiles)) return [false];

        const matches = profiles.some(profile =>
            typeof profile === 'string' &&
            (profile === profileUrl || profile.startsWith(profileUrl + '|'))
        );

        return [matches];
    },
    arity: { 1: ['String'] }
};

/**
 * memberOf() — Check if code is a member of a ValueSet.
 *
 * Resolution order:
 *   1. ISO-3166-1 Alpha-2 / Alpha-3 (hardcoded, no server needed)
 *   2. `valueSetCache.getExpandedCodes(url)` — every ValueSet previously
 *      expanded by the TerminologyExecutor is available here. Checks both
 *      `system|code` and bare `code` forms.
 *   3. `[]` (undetermined) — the constraint will log a
 *      `profile-constraint-evaluation-error` warning and skip.
 */
export function createMemberOfFunction(cache: ValueSetCache) {
    return {
      fn: (inputs: unknown[], args: unknown) => {
        if (inputs.length === 0) return [];

        const value = inputs[0];
        const valueSetUrl = Array.isArray(args) ? args[0] : args;

        const codeInfo = extractCodeForMemberOf(value);
        if (!codeInfo) return [];

        if (typeof valueSetUrl === 'string' && valueSetUrl.includes('iso3166-1-2')) {
            return ISO_3166_1_ALPHA2.has(codeInfo.code) ? [true] : [false];
        }
        if (typeof valueSetUrl === 'string' && valueSetUrl.includes('iso3166-1-3')) {
            return ISO_3166_1_ALPHA3.has(codeInfo.code) ? [true] : [false];
        }

        if (typeof valueSetUrl === 'string' && valueSetUrl.length > 0) {
            const baseUrl = valueSetUrl.split('|')[0];
            const expandedCodes = cache.getExpandedCodes(baseUrl)
                ?? cache.getExpandedCodes(valueSetUrl);

            if (expandedCodes && expandedCodes.size > 0) {
                const fullCode = codeInfo.system
                    ? `${codeInfo.system}|${codeInfo.code}`
                    : codeInfo.code;
                if (expandedCodes.has(fullCode) || expandedCodes.has(codeInfo.code)) {
                    return [true];
                }
                return [false];
            }
        }

        return [];
      },
      arity: { 0: [], 1: ['String'] },
    };
}

/**
 * subsumes() — Check if codeA subsumes codeB (SNOMED-CT hierarchy).
 *
 * This is a **synchronous best-effort** implementation. It checks the
 * `TerminologyHierarchyValidator` subsumption cache (populated during
 * previous validations or explicit $subsumes calls). When the pair is
 * not cached, returns `[]` (undetermined).
 *
 * The async SNOMED $subsumes call happens in the TerminologyExecutor;
 * FHIRPath constraints that rely on `subsumes()` should degrade
 * gracefully when the cache is cold.
 */
export function createSubsumesFunction(operationCache?: TerminologyOperationCache) {
    return {
      fn: (inputs: unknown[], args: unknown) => {
        if (inputs.length === 0) return [];

        const codeA = extractCodeForMemberOf(inputs[0]);
        const codeBArg = Array.isArray(args) ? args[0] : args;
        const codeB = extractCodeForMemberOf(codeBArg);
        if (!codeA || !codeB) return [];

        const system = codeA.system ?? codeB.system;
        if (!system || (codeA.system && codeB.system && codeA.system !== codeB.system)) {
            return [];
        }

        const outcome = operationCache?.findSubsumesBySuffix(
            makeSubsumesCacheSuffix(system, codeA.code, codeB.code),
        );
        if (outcome === undefined || outcome === 'unknown') return [];
        return [outcome === 'subsumes' || outcome === 'equivalent'];
      },
      // 'Any' (an evaluated value): fhirpath.js has no 'Coding' parameter
      // type, and an unknown name makes the whole invocation table invalid.
      arity: { 1: ['Any'] },
    };
}

/** Stateless compatibility function; composed validators inject their operation cache. */
export const subsumesFunction = createSubsumesFunction();

/**
 * Extract a `{code, system?}` pair from a FHIRPath value which may be a
 * plain string, a `Coding` object, or a `CodeableConcept`.
 */
function extractCodeForMemberOf(
    rawValue: unknown,
): { code: string; system?: string } | null {
    const value = unwrapFhirPathValue(rawValue);
    if (typeof value === 'string') return { code: value };
    if (!value || typeof value !== 'object') return null;

    const obj = value as Record<string, unknown>;

    if (typeof obj.code === 'string') {
        return {
            code: obj.code,
            system: typeof obj.system === 'string' ? obj.system : undefined,
        };
    }

    if (Array.isArray(obj.coding) && obj.coding.length > 0) {
        const first = obj.coding[0];
        if (isObjectRecord(first) && typeof first.code === 'string') {
            return {
                code: first.code,
                system: typeof first.system === 'string' ? first.system : undefined,
            };
        }
    }

    return null;
}

export const descendantsFunction = {
    fn: (inputs: unknown[]) => {
        if (inputs.length === 0) return [];

        const result: unknown[] = [];
        const visited = new WeakSet<object>();
        const stack = inputs
            .slice()
            .reverse()
            .map(value => ({ value, emit: false }));
        while (stack.length > 0) {
            const frame = stack.pop()!;
            const value = frame.value;
            if (value === null || value === undefined) continue;
            if (frame.emit) result.push(value);
            if (typeof value !== 'object' || visited.has(value)) continue;
            visited.add(value);

            const children = Array.isArray(value)
                ? value
                : Object.entries(value)
                    .filter(([key]) => !key.startsWith('_'))
                    .map(([, child]) => child);
            for (let index = children.length - 1; index >= 0; index--) {
                stack.push({ value: children[index], emit: true });
            }
        }

        return result;
    },
    arity: { 0: [] }
};

export const aggregateFunction = {
    fn: (inputs: unknown[], args: unknown) => {
        if (inputs.length === 0) return [];

        const requestedInit = Array.isArray(args) ? args[0] : args;
        const init = typeof requestedInit === 'number' ? requestedInit : 0;

        if (inputs.every((value): value is number => typeof value === 'number')) {
            return [inputs.reduce((acc, value) => acc + value, init)];
        }

        return inputs;
    },
    // 'Expr' is fhirpath.js's name for an unevaluated expression argument;
    // the misspelt 'Expression' invalidated the entire invocation table.
    arity: { 1: ['Expr'], 2: ['Expr', 'Any'] }
};

export const subsetOfFunction = {
    fn: (inputs: unknown[], args: unknown) => {
        if (inputs.length === 0) return [true]; // Empty is subset of everything
        const other = Array.isArray(args) ? args : [args];
        const collectionKey = createCollectionKey();
        const otherSet = new Set(other.map(collectionKey));
        return [inputs.every(value => otherSet.has(collectionKey(value)))];
    },
    arity: { 1: ['Any'] }
};

export const supersetOfFunction = {
    fn: (inputs: unknown[], args: unknown) => {
        const other = Array.isArray(args) ? args : [args];
        if (other.length === 0) return [true]; // Everything is superset of empty
        const collectionKey = createCollectionKey();
        const inputSet = new Set(inputs.map(collectionKey));
        return [other.every(value => inputSet.has(collectionKey(value)))];
    },
    arity: { 1: ['Any'] }
};

/**
 * Build the `userInvocationTable` for fhirpath.js `evaluate()` options.
 */
export function buildUserInvocationTable(
    rootResource: unknown,
    bundle?: unknown,
    cache: ValueSetCache = new ValueSetCache(),
    operationCache?: TerminologyOperationCache,
) {
    const ctx: FHIRPathEvaluationContext = { rootResource, bundle };
    // Only functions fhirpath.js cannot provide itself (they need bundle
    // context, terminology caches, or raw-object navigation). Natively
    // implemented functions (hasValue, descendants, aggregate, subsetOf,
    // supersetOf) must NOT be overridden with weaker approximations.
    return {
        resolve: resolveFunction(ctx),
        extension: extensionInvocationEntry,
        conformsTo: conformsToFunction,
        memberOf: createMemberOfFunction(cache),
        subsumes: createSubsumesFunction(operationCache),
    };
}

function isObjectRecord(value: unknown): value is ObjectRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createCollectionKey(): (value: unknown) => string {
    const identities = new WeakMap<object, number>();
    let nextIdentity = 1;
    return value => {
        try {
            const serialized = JSON.stringify(value);
            if (serialized !== undefined) return `json:${serialized}`;
        } catch {
            // Cyclic in-memory graphs fall back to stable invocation-local identity.
        }
        if (typeof value === 'object' && value !== null) {
            let identity = identities.get(value);
            if (identity === undefined) {
                identity = nextIdentity++;
                identities.set(value, identity);
            }
            return `object:${identity}`;
        }
        return `${typeof value}:${String(value)}`;
    };
}
