import { unwrapFhirPathValue } from './fhirpath-node-unwrap.js';
import type { ProfileConformanceLookup } from './sd-fhirpath-profile-conformance.js';

/** Conformance the validator established beforehand decides; otherwise the declared profiles do. */
export function createConformsToFunction(established?: ProfileConformanceLookup) {
    return {
        fn: (inputs: unknown[], args: unknown) => conformsTo(inputs, args, established),
        arity: { 1: ['String'] },
    };
}

export const conformsToFunction = createConformsToFunction();

function conformsTo(inputs: unknown[], args: unknown, established?: ProfileConformanceLookup): boolean[] {
    // Empty input propagates to empty (vacuously satisfied constraint),
    // matching the HL7 validator, instead of asserting non-conformance.
    if (inputs.length === 0) return [];

    const resource = unwrapFhirPathValue(inputs[0]);
    if (!isObjectRecord(resource)) return [false];

    const profileUrl = Array.isArray(args) ? args[0] : args;
    if (typeof profileUrl !== 'string' || profileUrl.length === 0) return [false];
    const verdict = established?.(resource, profileUrl);
    if (verdict !== undefined) return [verdict];

    const meta = isObjectRecord(resource.meta) ? resource.meta : null;
    const profiles = meta?.profile ?? [];
    if (!Array.isArray(profiles)) return [false];

    return [profiles.some(profile =>
        typeof profile === 'string' && (profile === profileUrl || profile.startsWith(profileUrl + '|')))];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
