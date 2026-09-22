import axios from 'axios';
import { logger } from '../logger.js';
import {
    parseHierarchyResponse,
    parseSubsumptionResponse,
} from './terminology-hierarchy-response.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';

export interface SubsumptionResult {
    /**
     * Relationship outcome. `'unknown'` is returned when the terminology
     * server could not be reached — callers MUST check `checkable` before
     * treating `'not-subsumed'` as authoritative.
     */
    outcome: 'subsumes' | 'subsumed-by' | 'equivalent' | 'not-subsumed' | 'unknown';
    related: boolean;
    /**
     * Whether this result is authoritative. `false` when the terminology
     * server returned an error or was unreachable — `outcome` will be
     * `'unknown'` in that case and `error` will carry the reason.
     */
    checkable: boolean;
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

const SNOMED_CT_URL = 'http://snomed.info/sct';
const ICD10_CM_URL = 'http://hl7.org/fhir/sid/icd-10-cm';
const _ICD10_WHO_URL = 'http://hl7.org/fhir/sid/icd-10';
const _LOINC_URL = 'http://loinc.org';
const DEFAULT_TX_SERVER = 'https://tx.fhir.org/r4';
const DEFAULT_CACHE_ENTRIES = 2_000;
export class TerminologyHierarchyValidator {
    private serverUrl: string;
    private timeout: number;
    private subsumptionCache: BoundedLruCache<string, SubsumptionResult>;
    private hierarchyCache: BoundedLruCache<string, HierarchyInfo>;

    constructor(options?: { serverUrl?: string; timeout?: number; maxCacheEntries?: number }) {
        this.serverUrl = normalizeServerUrl(options?.serverUrl);
        this.timeout = isPositiveFiniteNumber(options?.timeout) ? options.timeout : 5000;
        const maxCacheEntries = isPositiveFiniteNumber(options?.maxCacheEntries)
            ? options.maxCacheEntries
            : DEFAULT_CACHE_ENTRIES;
        this.subsumptionCache = new BoundedLruCache(maxCacheEntries);
        this.hierarchyCache = new BoundedLruCache(maxCacheEntries);
    }

    setServerUrl(url: string): void {
        this.serverUrl = normalizeServerUrl(url);
        this.subsumptionCache.clear();
        this.hierarchyCache.clear();
    }

    async checkSnomedSubsumption(
        codeA: string,
        codeB: string
    ): Promise<SubsumptionResult> {
        const cacheKey = `${SNOMED_CT_URL}|${codeA}|${codeB}`;

        const cached = this.subsumptionCache.get(cacheKey);
        if (cached) return { ...cached };

        try {
            const params = {
                system: SNOMED_CT_URL,
                codeA,
                codeB,
                _format: 'json'
            };

            logger.debug(
                '[HierarchyValidator] Checking SNOMED subsumption',
                terminologyTargetMetadata(SNOMED_CT_URL, codeA, codeB),
            );

            const response = await axios.get(`${this.serverUrl}/CodeSystem/$subsumes`, {
                params,
                timeout: this.timeout,
                headers: { 'Accept': 'application/fhir+json' }
            });

            const outcome = parseSubsumptionResponse(response.data);
            if (outcome) {

                const result: SubsumptionResult = {
                    outcome,
                    related: outcome !== 'not-subsumed',
                    checkable: true,
                };

                this.subsumptionCache.set(cacheKey, { ...result });
                logger.debug(`[HierarchyValidator] SNOMED subsumption result: ${outcome}`);
                return { ...result };
            }

            return {
                outcome: 'unknown',
                related: false,
                checkable: false,
                error: 'Terminology server returned an unexpected response',
            };

        } catch (error: unknown) {
            logger.warn(
                '[HierarchyValidator] SNOMED subsumption check failed',
                validationFailureMetadata(error),
            );
            return {
                outcome: 'unknown',
                related: false,
                checkable: false,
                error: 'Terminology server unavailable',
            };
        }
    }

    async isSnomedDescendantOf(
        code: string,
        ancestorCode: string
    ): Promise<boolean | 'unknown'> {
        const result = await this.checkSnomedSubsumption(ancestorCode, code);
        if (!result.checkable) return 'unknown';
        return result.outcome === 'subsumes' || result.outcome === 'equivalent';
    }

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

    async validateIcd10Hierarchy(
        code: string,
        options?: {
            allowBillable?: boolean;
            requiredCategory?: string;
        }
    ): Promise<HierarchyValidationResult> {
        const icd10Pattern = /^[A-TV-Z]\d{2}(\.\d{1,4})?$/i;
        if (!icd10Pattern.test(code)) {
            return {
                isValid: false,
                checkable: true,
                message: `Invalid ICD-10 code format: '${code}'`
            };
        }

        const category = code.substring(0, 3).toUpperCase();

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

        if (options?.allowBillable === false && code.includes('.')) {
            return {
                isValid: false,
                checkable: true,
                message: `ICD-10 code '${code}' should be a category code, not a billable code`
            };
        }

        if (options?.allowBillable === true && !code.includes('.')) {
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

    private icd10CategoryMatch(category: string, range: string): boolean {
        const rangeMatch = range.match(/^([A-Z]\d{2})-([A-Z]\d{2})$/i);
        if (rangeMatch) {
            const [, start, end] = rangeMatch;
            return category >= start.toUpperCase() && category <= end.toUpperCase();
        }

        return category.toUpperCase() === range.toUpperCase();
    }

    async getHierarchyInfo(
        code: string,
        system: string
    ): Promise<HierarchyInfo | null> {
        const cacheKey = `${system}|${code}`;

        const cached = this.hierarchyCache.get(cacheKey);
        if (cached) return cloneHierarchyInfo(cached);

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

            const parsed = parseHierarchyResponse(response.data);
            if (parsed) {
                const info: HierarchyInfo = { code, system };

                if (parsed.display) info.display = parsed.display;
                if (parsed.parents.length > 0) info.parents = parsed.parents;
                if (parsed.children.length > 0) info.children = parsed.children;

                this.hierarchyCache.set(cacheKey, cloneHierarchyInfo(info));
                return cloneHierarchyInfo(info);
            }

            return null;

        } catch (error: unknown) {
            logger.warn(
                '[HierarchyValidator] Hierarchy lookup failed',
                validationFailureMetadata(error),
            );
            return null;
        }
    }

    getCacheStats(): { subsumption: number; hierarchy: number } {
        return {
            subsumption: this.subsumptionCache.size,
            hierarchy: this.hierarchyCache.size
        };
    }

    clearCaches(): void {
        this.subsumptionCache.clear();
        this.hierarchyCache.clear();
    }
}

function cloneHierarchyInfo(info: HierarchyInfo): HierarchyInfo {
    return {
        ...info,
        ...(info.parents ? { parents: [...info.parents] } : {}),
        ...(info.children ? { children: [...info.children] } : {}),
        ...(info.ancestors ? { ancestors: [...info.ancestors] } : {}),
        ...(info.descendants ? { descendants: [...info.descendants] } : {}),
    };
}

function normalizeServerUrl(value: unknown): string {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim().replace(/\/+$/, '')
        : DEFAULT_TX_SERVER;
}

function isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function getHierarchyValidator(): TerminologyHierarchyValidator {
    return new TerminologyHierarchyValidator();
}

export function resetHierarchyValidator(): void {
    // Compatibility no-op: validator instances are caller-owned.
}
