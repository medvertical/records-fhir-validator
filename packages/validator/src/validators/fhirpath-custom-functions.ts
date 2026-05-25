/**
 * FHIRPath Custom Functions
 *
 * Custom function implementations for FHIRPath evaluation in constraint validation.
 * These functions extend the base fhirpath.js library with FHIR-specific operations.
 *
 * Functions:
 *   resolve()    — resolve References (contained, bundle entries, external)
 *   hasValue()   — check if element has a value
 *   conformsTo() — check meta.profile conformance
 *   memberOf()   — **enhanced**: checks against expanded ValueSet cache
 *                   (all ValueSets previously expanded by TerminologyExecutor),
 *                   with ISO-3166 fallback for country codes
 *   subsumes()   — **new**: checks SNOMED-CT subsumption against the
 *                   TerminologyHierarchyValidator's result cache
 *   descendants() — recursively collect descendant elements
 *   aggregate()   — numeric aggregation
 *   subsetOf() / supersetOf() — set operations
 *
 * All functions are synchronous (FHIRPath userInvocationTable constraint).
 * For uncached ValueSets/codes, functions return `[]` which makes the
 * calling constraint report `profile-constraint-evaluation-error` rather
 * than silently passing.
 */

import { valueSetCache } from './valueset-cache';
import { getCachedSubsumesOutcome } from './terminology-api-client';

// ============================================================================
// ISO Country Code Sets for memberOf validation
// ============================================================================

/**
 * ISO-3166-1 Alpha-2 Codes (Commonly used for country codes)
 */
export const ISO_3166_1_ALPHA2 = new Set([
    'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
    'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
    'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
    'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
    'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
    'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP',
    'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
    'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
    'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
    'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
    'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
    'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
]);

/**
 * ISO-3166-1 Alpha-3 Codes
 */
export const ISO_3166_1_ALPHA3 = new Set([
    'ABW', 'AFG', 'AGO', 'AIA', 'ALA', 'ALB', 'AND', 'ARE', 'ARG', 'ARM', 'ASM', 'ATA', 'ATF', 'ATG', 'AUS', 'AUT', 'AZE',
    'BDI', 'BEL', 'BEN', 'BES', 'BFA', 'BGD', 'BGR', 'BHR', 'BHS', 'BIH', 'BLM', 'BLR', 'BLZ', 'BMU', 'BOL', 'BRA', 'BRB', 'BRN', 'BTN', 'BVT', 'BWA',
    'CAF', 'CAN', 'CCK', 'CHE', 'CHL', 'CHN', 'CIV', 'CMR', 'COD', 'COG', 'COK', 'COL', 'COM', 'CPV', 'CRI', 'CUB', 'CUW', 'CXR', 'CYM', 'CYP', 'CZE',
    'DEU', 'DJI', 'DMA', 'DNK', 'DOM', 'DZA', 'ECU', 'EGY', 'ERI', 'ESH', 'ESP', 'EST', 'ETH', 'FIN', 'FJI', 'FLK', 'FRA', 'FRO', 'FSM',
    'GAB', 'GBR', 'GEO', 'GGY', 'GHA', 'GIB', 'GIN', 'GLP', 'GMB', 'GNB', 'GNQ', 'GRC', 'GRD', 'GRL', 'GTM', 'GUF', 'GUM', 'GUY',
    'HKG', 'HMD', 'HND', 'HRV', 'HTI', 'HUN', 'IDN', 'IMN', 'IND', 'IOT', 'IRL', 'IRN', 'IRQ', 'ISL', 'ISR', 'ITA', 'JAM', 'JEY', 'JOR', 'JPN',
    'KAZ', 'KEN', 'KGZ', 'KHM', 'KIR', 'KNA', 'KOR', 'KWT', 'LAO', 'LBN', 'LBR', 'LBY', 'LCA', 'LIE', 'LKA', 'LSO', 'LTU', 'LUX', 'LVA',
    'MAC', 'MAF', 'MAR', 'MCO', 'MDA', 'MDG', 'MDV', 'MEX', 'MHL', 'MKD', 'MLI', 'MLT', 'MMR', 'MNE', 'MNG', 'MNP', 'MOZ', 'MRT', 'MSR', 'MTQ', 'MUS', 'MWI', 'MYS', 'MYT',
    'NAM', 'NCL', 'NER', 'NFK', 'NGA', 'NIC', 'NIU', 'NLD', 'NOR', 'NPL', 'NRU', 'NZL', 'OMN', 'PAK', 'PAN', 'PCN', 'PER', 'PHL', 'PLW', 'PNG', 'POL', 'PRI', 'PRK', 'PRT', 'PRY', 'PSE', 'PYF',
    'QAT', 'REU', 'ROU', 'RUS', 'RWA', 'SAU', 'SDN', 'SEN', 'SGP', 'SGS', 'SHN', 'SJM', 'SLB', 'SLE', 'SLV', 'SMR', 'SOM', 'SPM', 'SRB', 'SSD', 'STP', 'SUR', 'SVK', 'SVN', 'SWE', 'SWZ', 'SXM', 'SYC', 'SYR',
    'TCA', 'TCD', 'TGO', 'THA', 'TJK', 'TKL', 'TKM', 'TLS', 'TON', 'TTO', 'TUN', 'TUR', 'TUV', 'TWN', 'TZA', 'UGA', 'UKR', 'UMI', 'URY', 'USA', 'UZB', 'VAT', 'VCT', 'VEN', 'VGB', 'VIR', 'VNM', 'VUT',
    'WLF', 'WSM', 'YEM', 'ZAF', 'ZMB', 'ZWE'
]);

// ============================================================================
// Custom FHIRPath Function Implementations
// ============================================================================

/**
 * Context passed to `buildUserInvocationTable` so FHIRPath custom functions
 * can resolve references and check terminology without async I/O.
 */
export interface FHIRPathEvaluationContext {
    /** Root FHIR resource (for contained-reference resolution). */
    rootResource: any;
    /**
     * If validating inside a Bundle, the full Bundle resource. `resolve()`
     * will search `bundle.entry[].resource` by matching `fullUrl` or
     * `ResourceType/id` against the reference string.
     */
    bundle?: any;
}

/**
 * resolve() — Resolve a Reference to its target resource.
 *
 * Resolution order:
 *   1. Contained references (`#id` → `rootResource.contained`)
 *   2. Bundle-internal references (relative `ResourceType/id` or absolute
 *      `fullUrl` match against `bundle.entry[]`)
 *   3. Empty array (unresolvable — constraint skips gracefully)
 */
export function resolveFunction(ctx: FHIRPathEvaluationContext) {
    return {
        fn: (inputs: any[]) => {
            if (inputs.length === 0) return [];

            const reference = inputs[0];
            if (!reference) return [];

            const refString = typeof reference === 'object' ? reference.reference : reference;
            if (!refString || typeof refString !== 'string') return [];

            // 1. Contained references (#id)
            if (refString.startsWith('#') && ctx.rootResource?.contained) {
                const containedId = refString.substring(1);
                const contained = ctx.rootResource.contained.find(
                    (c: any) => c.id === containedId,
                );
                return contained ? [contained] : [];
            }

            // 2. Bundle-internal references
            if (ctx.bundle?.entry && Array.isArray(ctx.bundle.entry)) {
                for (const entry of ctx.bundle.entry) {
                    if (!entry.resource) continue;
                    // Match by fullUrl
                    if (entry.fullUrl === refString) return [entry.resource];
                    // Match by relative reference (ResourceType/id)
                    const res = entry.resource;
                    if (res.resourceType && res.id) {
                        if (refString === `${res.resourceType}/${res.id}`) {
                            return [entry.resource];
                        }
                    }
                }
            }

            // 3. Unresolvable
            return [];
        },
        arity: { 0: [] },
    };
}

/**
 * hasValue() - Check if element has a value
 */
export const hasValueFunction = {
    fn: (inputs: any[]) => {
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
 * conformsTo() - Check if resource conforms to a profile
 */
export const conformsToFunction = {
    fn: (inputs: any[], args: any[]) => {
        if (inputs.length === 0) return [false];

        const resource = inputs[0];
        if (!resource || typeof resource !== 'object') return [false];

        const profileUrl = Array.isArray(args) ? args[0] : args;
        if (!profileUrl) return [false];

        // Check meta.profile array
        const profiles = resource.meta?.profile || [];
        if (!Array.isArray(profiles)) return [false];

        // Check if any profile matches (exact or starts with for versioned profiles)
        const matches = profiles.some((p: string) =>
            p === profileUrl || p.startsWith(profileUrl + '|')
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
export const memberOfFunction = {
    fn: (inputs: any[], args: any[]) => {
        if (inputs.length === 0) return [];

        const value = inputs[0];
        const valueSetUrl = Array.isArray(args) ? args[0] : args;

        // Extract code string from whatever FHIRPath gave us:
        // could be a primitive string, a Coding, or a CodeableConcept.
        const codeInfo = extractCodeForMemberOf(value);
        if (!codeInfo) return [];

        // 1. ISO-3166-1 hardcoded check (fast path)
        if (valueSetUrl && valueSetUrl.includes('iso3166-1-2')) {
            return ISO_3166_1_ALPHA2.has(codeInfo.code) ? [true] : [false];
        }
        if (valueSetUrl && valueSetUrl.includes('iso3166-1-3')) {
            return ISO_3166_1_ALPHA3.has(codeInfo.code) ? [true] : [false];
        }

        // 2. ValueSet expansion cache lookup
        if (valueSetUrl) {
            const baseUrl = valueSetUrl.split('|')[0];
            const expandedCodes = valueSetCache.getExpandedCodes(baseUrl)
                ?? valueSetCache.getExpandedCodes(valueSetUrl);

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

        // 3. Undetermined — return empty so the caller reports a
        //    profile-constraint-evaluation-error warning instead of a
        //    silent pass.
        return [];
    },
    arity: { 0: [], 1: ['String'] },
};

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
export const subsumesFunction = {
    fn: (inputs: any[], args: any[]) => {
        if (inputs.length === 0) return [];

        const codeA = extractCodeForMemberOf(inputs[0]);
        const codeBArg = Array.isArray(args) ? args[0] : args;
        const codeB = extractCodeForMemberOf(codeBArg);
        if (!codeA || !codeB) return [];

        const system = codeA.system ?? codeB.system;
        if (!system || (codeA.system && codeB.system && codeA.system !== codeB.system)) {
            return [];
        }

        const outcome = getCachedSubsumesOutcome(system, codeA.code, codeB.code);
        if (outcome === undefined || outcome === 'unknown') return [];
        return [outcome === 'subsumes' || outcome === 'equivalent'];
    },
    arity: { 1: ['Coding'] },
};

/**
 * Extract a `{code, system?}` pair from a FHIRPath value which may be a
 * plain string, a `Coding` object, or a `CodeableConcept`.
 */
function extractCodeForMemberOf(
    value: unknown,
): { code: string; system?: string } | null {
    if (typeof value === 'string') return { code: value };
    if (!value || typeof value !== 'object') return null;

    const obj = value as Record<string, unknown>;

    // Coding
    if (typeof obj.code === 'string') {
        return {
            code: obj.code,
            system: typeof obj.system === 'string' ? obj.system : undefined,
        };
    }

    // CodeableConcept — use first coding
    if (Array.isArray(obj.coding) && obj.coding.length > 0) {
        const first = obj.coding[0];
        if (first && typeof first.code === 'string') {
            return {
                code: first.code,
                system: typeof first.system === 'string' ? first.system : undefined,
            };
        }
    }

    return null;
}

/**
 * descendants() - Returns all descendant elements (recursively flattened)
 */
export const descendantsFunction = {
    fn: (inputs: any[]) => {
        if (inputs.length === 0) return [];

        const result: any[] = [];
        const collectDescendants = (obj: any) => {
            if (obj === null || obj === undefined) return;
            if (typeof obj !== 'object') return;

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    result.push(item);
                    collectDescendants(item);
                }
            } else {
                for (const key of Object.keys(obj)) {
                    if (key.startsWith('_')) continue; // Skip FHIR extension properties
                    const value = obj[key];
                    if (value !== null && value !== undefined) {
                        result.push(value);
                        collectDescendants(value);
                    }
                }
            }
        };

        for (const input of inputs) {
            collectDescendants(input);
        }

        return result;
    },
    arity: { 0: [] }
};

/**
 * aggregate() - Aggregation function for collections
 */
export const aggregateFunction = {
    fn: (inputs: any[], args: any[]) => {
        if (inputs.length === 0) return [];

        // Simple sum aggregation for numeric arrays
        // Full FHIRPath aggregate is complex - this handles common cases
        const init = args?.[0] ?? 0;

        if (inputs.every((i: any) => typeof i === 'number')) {
            return [inputs.reduce((acc: number, val: number) => acc + val, init as number)];
        }

        // Default: return input for non-numeric
        return inputs;
    },
    arity: { 1: ['Any'], 2: ['Expression', 'Any'] }
};

/**
 * subsetOf() - Check if collection is subset of another
 */
export const subsetOfFunction = {
    fn: (inputs: any[], args: any[]) => {
        if (inputs.length === 0) return [true]; // Empty is subset of everything
        const other = Array.isArray(args) ? args : [args];
        const otherSet = new Set(other.map((o: any) => JSON.stringify(o)));
        return [inputs.every((i: any) => otherSet.has(JSON.stringify(i)))];
    },
    arity: { 1: ['Any'] }
};

/**
 * supersetOf() - Check if collection is superset of another
 */
export const supersetOfFunction = {
    fn: (inputs: any[], args: any[]) => {
        const other = Array.isArray(args) ? args : [args];
        if (other.length === 0) return [true]; // Everything is superset of empty
        const inputSet = new Set(inputs.map((i: any) => JSON.stringify(i)));
        return [other.every((o: any) => inputSet.has(JSON.stringify(o)))];
    },
    arity: { 1: ['Any'] }
};

// ============================================================================
// User Invocation Table Builder
// ============================================================================

/**
 * Build the `userInvocationTable` for fhirpath.js `evaluate()` options.
 *
 * @param rootResource - The root FHIR resource (for contained-reference resolution)
 * @param bundle       - (optional) The enclosing Bundle, if the resource is a Bundle entry
 * @returns userInvocationTable object compatible with fhirpath.js
 */
export function buildUserInvocationTable(rootResource: any, bundle?: any) {
    const ctx: FHIRPathEvaluationContext = { rootResource, bundle };
    return {
        resolve: resolveFunction(ctx),
        hasValue: hasValueFunction,
        conformsTo: conformsToFunction,
        memberOf: memberOfFunction,
        subsumes: subsumesFunction,
        descendants: descendantsFunction,
        aggregate: aggregateFunction,
        subsetOf: subsetOfFunction,
        supersetOf: supersetOfFunction,
    };
}
