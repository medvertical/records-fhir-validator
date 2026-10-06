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
import type { ProfileConformanceLookup } from './sd-fhirpath-profile-conformance.js';
import { createConformsToFunction } from './fhirpath-conforms-to.js';

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

export { conformsToFunction, createConformsToFunction } from './fhirpath-conforms-to.js';

/**
 * Missing local evidence stays unknown; any proved Coding member is sufficient.
 */
export function createMemberOfFunction(cache: ValueSetCache) {
    return {
      fn: (inputs: unknown[], args: unknown) => {
        if (inputs.length !== 1) return [];
        const valueSetUrl = Array.isArray(args) ? args[0] : args;
        if (typeof valueSetUrl !== 'string' || valueSetUrl.length === 0) return [];

        const isoCodes = valueSetUrl.includes('iso3166-1-2') ? ISO_3166_1_ALPHA2
            : valueSetUrl.includes('iso3166-1-3') ? ISO_3166_1_ALPHA3 : undefined;
        const expandedCodes = isoCodes ?? cache.getExpandedCodesForMembership(valueSetUrl);
        if (!expandedCodes || expandedCodes.size === 0) return [];

        let unknownCoding = false;
        for (const coding of extractCodesForMemberOf(inputs[0])) {
            if (!coding) {
                unknownCoding = true;
                continue;
            }
            if (isoCodes && coding.system && coding.system !== 'urn:iso:std:iso:3166') continue;
            const membershipKey = isoCodes || !coding.system ? coding.code : `${coding.system}|${coding.code}`;
            if (expandedCodes.has(membershipKey)) return [true];
        }
        return unknownCoding ? [] : [false];
      },
      arity: { 0: [], 1: ['String'] },
    };
}

type MemberOfCoding = { code: string; system?: string };

function* extractCodesForMemberOf(rawValue: unknown): Generator<MemberOfCoding | null> {
    try {
        const value = unwrapMemberOfValue(rawValue);
        if (typeof value === 'string') { yield { code: value }; return; }
        if (!isObjectRecord(value)) { yield null; return; }
        if (Object.getOwnPropertyDescriptor(value, 'code')) {
            yield extractMemberOfCoding(value);
            return;
        }
        const coding = Object.getOwnPropertyDescriptor(value, 'coding');
        if (!coding || !('value' in coding) || !Array.isArray(coding.value) || coding.value.length === 0) {
            yield null;
            return;
        }
        // Do not inspect later entries once a member has already been proved.
        for (let index = 0; index < coding.value.length; index++) {
            const entry = Object.getOwnPropertyDescriptor(coding.value, String(index));
            yield entry && 'value' in entry ? extractMemberOfCoding(entry.value) : null;
        }
    } catch { yield null; }
}

function extractMemberOfCoding(rawValue: unknown): MemberOfCoding | null {
    try {
        const value = unwrapMemberOfValue(rawValue);
        if (!isObjectRecord(value)) return null;
        const code = Object.getOwnPropertyDescriptor(value, 'code');
        const system = Object.getOwnPropertyDescriptor(value, 'system');
        if (!code || !('value' in code) || typeof code.value !== 'string') return null;
        if (system && (!('value' in system) || typeof system.value !== 'string' || system.value.length === 0)) return null;
        if (!system && 'system' in value) return null;
        return { code: code.value, system: system?.value };
    } catch { return null; }
}

function unwrapMemberOfValue(value: unknown): unknown {
    if (!isObjectRecord(value)) return value;
    const nodeType = Object.getOwnPropertyDescriptor(value, 'fhirNodeDataType');
    const nodeValue = Object.getOwnPropertyDescriptor(value, 'data');
    if (!nodeType || !nodeValue) return value;
    return 'value' in nodeType && 'value' in nodeValue ? nodeValue.value : undefined;
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
    profileConformance?: ProfileConformanceLookup,
) {
    const ctx: FHIRPathEvaluationContext = { rootResource, bundle };
    // Only functions fhirpath.js cannot provide itself (they need bundle
    // context, terminology caches, or raw-object navigation). Natively
    // implemented functions (hasValue, descendants, aggregate, subsetOf,
    // supersetOf) must NOT be overridden with weaker approximations.
    return {
        resolve: resolveFunction(ctx),
        extension: extensionInvocationEntry,
        conformsTo: createConformsToFunction(profileConformance),
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
