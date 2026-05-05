/**
 * Terminology Hierarchy Validator
 * 
 * Advanced terminology validation for hierarchical CodeSystems:
 * - SNOMED CT subsumption checking ($subsumes operation)
 * - ICD-10 parent/child relationship validation
 * - CodeSystem hierarchy traversal
 * 
 * Uses tx.fhir.org for external terminology operations.
 */

import axios from 'axios';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface SubsumptionResult {
    /**
     * Relationship outcome. `'unknown'` is returned when the terminology
     * server could not be reached — callers MUST check `checkable` before
     * treating `'not-subsumed'` as authoritative.
     */
    outcome: 'subsumes' | 'subsumed-by' | 'equivalent' | 'not-subsumed' | 'unknown';
    /** True if any subsumption relationship exists */
    related: boolean;
    /**
     * Whether this result is authoritative. `false` when the terminology
     * server returned an error or was unreachable — `outcome` will be
     * `'unknown'` in that case and `error` will carry the reason.
     */
    checkable: boolean;
    /** Error message if check failed */
    error?: string;
}

export interface HierarchyInfo {
    code: string;
    system: string;
    display?: string;
    parents?: string[];
    children?: string[];
    ancestors?: string[];
    descendants?: string[];
}

export interface HierarchyValidationResult {
    /**
     * True if the code belongs to the required hierarchy.
     *
     * When `checkable === false` this field is meaningless and should be
     * treated as "unverified" rather than "invalid" — the validator could
     * not reach the terminology server to make the determination. Without
     * this distinction the validator produces false negatives during
     * tx.fhir.org outages.
     */
    isValid: boolean;
    /**
     * Whether the underlying subsumption check was authoritative.
     * `false` means the terminology server was unreachable or returned
     * an error; callers should degrade gracefully instead of failing
     * validation.
     */
    checkable: boolean;
    message?: string;
    hierarchyInfo?: HierarchyInfo;
}

// ============================================================================
// Well-known CodeSystem URLs
// ============================================================================

const SNOMED_CT_URL = 'http://snomed.info/sct';
const ICD10_CM_URL = 'http://hl7.org/fhir/sid/icd-10-cm';
// Reserved for future WHO-ICD10 and LOINC hierarchy support.
const _ICD10_WHO_URL = 'http://hl7.org/fhir/sid/icd-10';
const _LOINC_URL = 'http://loinc.org';

// Default terminology server
const DEFAULT_TX_SERVER = 'https://tx.fhir.org/r4';

// ============================================================================
// Terminology Hierarchy Validator
// ============================================================================

export class TerminologyHierarchyValidator {
    private serverUrl: string;
    private timeout: number;
    private subsumptionCache: Map<string, SubsumptionResult> = new Map();
    private hierarchyCache: Map<string, HierarchyInfo> = new Map();

    constructor(options?: { serverUrl?: string; timeout?: number }) {
        this.serverUrl = options?.serverUrl || DEFAULT_TX_SERVER;
        this.timeout = options?.timeout || 5000;
    }

    /**
     * Configure terminology server
     */
    setServerUrl(url: string): void {
        this.serverUrl = url;
        // Clear caches when server changes
        this.subsumptionCache.clear();
        this.hierarchyCache.clear();
    }

    // ==========================================================================
    // SNOMED CT Subsumption
    // ==========================================================================

    /**
     * Check if codeA subsumes codeB in SNOMED CT
     * Uses $subsumes operation on terminology server
     * 
     * @param codeA - The potential ancestor code
     * @param codeB - The potential descendant code
     * @returns Subsumption result
     */
    async checkSnomedSubsumption(
        codeA: string,
        codeB: string
    ): Promise<SubsumptionResult> {
        const cacheKey = `${SNOMED_CT_URL}|${codeA}|${codeB}`;

        if (this.subsumptionCache.has(cacheKey)) {
            return this.subsumptionCache.get(cacheKey)!;
        }

        try {
            const params = {
                system: SNOMED_CT_URL,
                codeA,
                codeB,
                _format: 'json'
            };

            logger.debug(`[HierarchyValidator] Checking SNOMED subsumption: ${codeA} → ${codeB}`);

            const response = await axios.get(`${this.serverUrl}/CodeSystem/$subsumes`, {
                params,
                timeout: this.timeout,
                headers: { 'Accept': 'application/fhir+json' }
            });

            const parameters = response.data;
            if (parameters.resourceType === 'Parameters') {
                const outcomeParam = parameters.parameter?.find((p: any) => p.name === 'outcome');
                const outcome = outcomeParam?.valueCode as SubsumptionResult['outcome'] || 'not-subsumed';

                const result: SubsumptionResult = {
                    outcome,
                    related: outcome !== 'not-subsumed',
                    checkable: true,
                };

                this.subsumptionCache.set(cacheKey, result);
                logger.debug(`[HierarchyValidator] SNOMED subsumption result: ${outcome}`);
                return result;
            }

            // Unexpected response shape — still counts as not-checkable
            return { outcome: 'unknown', related: false, checkable: false };

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            const errorMsg = err.message || 'Unknown error';
            logger.warn(`[HierarchyValidator] SNOMED subsumption check failed: ${errorMsg}`);
            // Not cached: don't poison the cache with transient network errors
            return {
                outcome: 'unknown',
                related: false,
                checkable: false,
                error: errorMsg,
            };
        }
    }

    /**
     * Check if a SNOMED code is a descendant of a parent code.
     *
     * Returns `true` / `false` when the check is authoritative. Returns
     * `'unknown'` when the terminology server was unreachable — callers
     * should treat this case as "unverified" rather than a hard rejection
     * to avoid false negatives during tx.fhir.org outages.
     */
    async isSnomedDescendantOf(
        code: string,
        ancestorCode: string
    ): Promise<boolean | 'unknown'> {
        const result = await this.checkSnomedSubsumption(ancestorCode, code);
        if (!result.checkable) return 'unknown';
        return result.outcome === 'subsumes' || result.outcome === 'equivalent';
    }

    /**
     * Validate SNOMED code is in a specific hierarchy.
     *
     * Produces three distinguishable outcomes:
     *   - `{ isValid: true,  checkable: true }`  — in hierarchy
     *   - `{ isValid: false, checkable: true }`  — NOT in hierarchy (authoritative)
     *   - `{ isValid: false, checkable: false }` — check failed (treat as unverified)
     */
    async validateSnomedHierarchy(
        code: string,
        requiredAncestor: string,
        ancestorName?: string
    ): Promise<HierarchyValidationResult> {
        const result = await this.checkSnomedSubsumption(requiredAncestor, code);

        if (!result.checkable) {
            const ancestorDesc = ancestorName || requiredAncestor;
            return {
                isValid: false,
                checkable: false,
                message:
                    `Could not verify SNOMED hierarchy for '${code}' against ` +
                    `'${ancestorDesc}' (${requiredAncestor}): ${result.error ?? 'terminology server unavailable'}`,
            };
        }

        const isDescendant =
            result.outcome === 'subsumes' || result.outcome === 'equivalent';
        if (isDescendant) {
            return { isValid: true, checkable: true };
        }

        const ancestorDesc = ancestorName || requiredAncestor;
        return {
            isValid: false,
            checkable: true,
            message: `SNOMED code '${code}' is not a type of '${ancestorDesc}' (${requiredAncestor})`,
        };
    }

    // ==========================================================================
    // ICD-10 Hierarchy
    // ==========================================================================

    /**
     * Validate ICD-10 code format and hierarchy
     * ICD-10 codes follow hierarchical patterns (e.g., A00-A09 are intestinal diseases)
     */
    async validateIcd10Hierarchy(
        code: string,
        options?: {
            allowBillable?: boolean;  // If true, code must be a billable (leaf) code
            requiredCategory?: string;  // E.g., "A00-A09" for intestinal diseases
        }
    ): Promise<HierarchyValidationResult> {
        // Basic ICD-10 format validation
        const icd10Pattern = /^[A-TV-Z]\d{2}(\.\d{1,4})?$/i;
        if (!icd10Pattern.test(code)) {
            return {
                isValid: false,
                checkable: true,
                message: `Invalid ICD-10 code format: '${code}'`
            };
        }

        // Extract category (first 3 characters)
        const category = code.substring(0, 3).toUpperCase();

        // Check if required category matches
        if (options?.requiredCategory) {
            const categoryMatch = this.icd10CategoryMatch(category, options.requiredCategory);
            if (!categoryMatch) {
                return {
                    isValid: false,
                    checkable: true,
                    message: `ICD-10 code '${code}' is not in required category '${options.requiredCategory}'`
                };
            }
        }

        // Check billable requirement
        if (options?.allowBillable === false && code.includes('.')) {
            // Non-billable (category) codes don't have decimals in many contexts
            return {
                isValid: false,
                checkable: true,
                message: `ICD-10 code '${code}' should be a category code, not a billable code`
            };
        }

        if (options?.allowBillable === true && !code.includes('.')) {
            // Billable codes typically have decimal specificity
            return {
                isValid: false,
                checkable: true,
                message: `ICD-10 code '${code}' should be a billable (specific) code with decimal`
            };
        }

        return {
            isValid: true,
            checkable: true,
            hierarchyInfo: {
                code,
                system: ICD10_CM_URL,
                parents: [category]
            }
        };
    }

    /**
     * Check if ICD-10 category code falls within a range
     */
    private icd10CategoryMatch(category: string, range: string): boolean {
        // Handle range format like "A00-A09"
        const rangeMatch = range.match(/^([A-Z]\d{2})-([A-Z]\d{2})$/i);
        if (rangeMatch) {
            const [, start, end] = rangeMatch;
            return category >= start.toUpperCase() && category <= end.toUpperCase();
        }

        // Handle single category
        return category.toUpperCase() === range.toUpperCase();
    }

    // ==========================================================================
    // Generic Hierarchy Lookup
    // ==========================================================================

    /**
     * Look up hierarchy information for a code
     * Uses $lookup operation on terminology server
     */
    async getHierarchyInfo(
        code: string,
        system: string
    ): Promise<HierarchyInfo | null> {
        const cacheKey = `${system}|${code}`;

        if (this.hierarchyCache.has(cacheKey)) {
            return this.hierarchyCache.get(cacheKey)!;
        }

        try {
            const params = {
                system,
                code,
                property: 'parent,child',
                _format: 'json'
            };

            const response = await axios.get(`${this.serverUrl}/CodeSystem/$lookup`, {
                params,
                timeout: this.timeout,
                headers: { 'Accept': 'application/fhir+json' }
            });

            const parameters = response.data;
            if (parameters.resourceType === 'Parameters') {
                const info: HierarchyInfo = { code, system };

                // Extract display
                const displayParam = parameters.parameter?.find((p: any) => p.name === 'display');
                if (displayParam?.valueString) {
                    info.display = displayParam.valueString;
                }

                // Extract parents
                const parentParams = parameters.parameter?.filter(
                    (p: any) => p.name === 'property' && p.part?.some((pp: any) => pp.name === 'code' && pp.valueCode === 'parent')
                );
                if (parentParams?.length > 0) {
                    info.parents = parentParams.map((p: any) =>
                        p.part?.find((pp: any) => pp.name === 'value')?.valueCode
                    ).filter(Boolean);
                }

                // Extract children
                const childParams = parameters.parameter?.filter(
                    (p: any) => p.name === 'property' && p.part?.some((pp: any) => pp.name === 'code' && pp.valueCode === 'child')
                );
                if (childParams?.length > 0) {
                    info.children = childParams.map((p: any) =>
                        p.part?.find((pp: any) => pp.name === 'value')?.valueCode
                    ).filter(Boolean);
                }

                this.hierarchyCache.set(cacheKey, info);
                return info;
            }

            return null;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[HierarchyValidator] Hierarchy lookup failed: ${err.message}`);
            return null;
        }
    }

    // ==========================================================================
    // Cache Management
    // ==========================================================================

    /**
     * Get cache statistics
     */
    getCacheStats(): { subsumption: number; hierarchy: number } {
        return {
            subsumption: this.subsumptionCache.size,
            hierarchy: this.hierarchyCache.size
        };
    }

    /**
     * Clear all caches
     */
    clearCaches(): void {
        this.subsumptionCache.clear();
        this.hierarchyCache.clear();
    }
}

// Singleton instance
let hierarchyValidatorInstance: TerminologyHierarchyValidator | null = null;

export function getHierarchyValidator(): TerminologyHierarchyValidator {
    if (!hierarchyValidatorInstance) {
        hierarchyValidatorInstance = new TerminologyHierarchyValidator();
    }
    return hierarchyValidatorInstance;
}

export function resetHierarchyValidator(): void {
    hierarchyValidatorInstance = null;
}
