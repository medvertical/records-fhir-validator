import type { SubsumptionOutcome } from './terminology-api-types';

interface ValidateCodeCacheEntry {
    result: boolean;
    cachedAt: number;
}

interface SubsumesCacheEntry {
    result: Exclude<SubsumptionOutcome, 'unknown'>;
    cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 5000;
const validateCodeCache = new Map<string, ValidateCodeCacheEntry>();
const subsumesCache = new Map<string, SubsumesCacheEntry>();

export function makeValidateCodeCacheKey(
    serverUrl: string,
    system: string | undefined,
    code: string,
    valueSetUrl: string,
): string {
    return `${serverUrl}|${system ?? ''}|${code}|${valueSetUrl}`;
}

export function getFromValidateCodeCache(key: string): boolean | undefined {
    const entry = validateCodeCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        validateCodeCache.delete(key);
        return undefined;
    }
    validateCodeCache.delete(key);
    validateCodeCache.set(key, entry);
    return entry.result;
}

export function storeInValidateCodeCache(key: string, result: boolean): void {
    if (validateCodeCache.size >= MAX_CACHE_SIZE) {
        const oldest = validateCodeCache.keys().next().value;
        if (oldest) validateCodeCache.delete(oldest);
    }
    validateCodeCache.set(key, { result, cachedAt: Date.now() });
}

export function clearValidateCodeCache(): void {
    validateCodeCache.clear();
}

export function getValidateCodeCacheSize(): number {
    return validateCodeCache.size;
}

export function makeSubsumesCacheKey(serverUrl: string, system: string, codeA: string, codeB: string): string {
    return `${serverUrl}|${system}|${codeA}|${codeB}`;
}

export function getFromSubsumesCache(key: string): SubsumptionOutcome | undefined {
    const entry = subsumesCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        subsumesCache.delete(key);
        return undefined;
    }
    subsumesCache.delete(key);
    subsumesCache.set(key, entry);
    return entry.result;
}

export function storeInSubsumesCache(key: string, result: SubsumptionOutcome): void {
    if (result === 'unknown') return;
    if (subsumesCache.size >= MAX_CACHE_SIZE) {
        const oldest = subsumesCache.keys().next().value;
        if (oldest) subsumesCache.delete(oldest);
    }
    subsumesCache.set(key, { result, cachedAt: Date.now() });
}

export function getCachedSubsumesOutcome(
    system: string,
    codeA: string,
    codeB: string,
    serverUrl?: string,
): SubsumptionOutcome | undefined {
    if (serverUrl) {
        return getFromSubsumesCache(makeSubsumesCacheKey(serverUrl, system, codeA, codeB));
    }

    const suffix = `|${system}|${codeA}|${codeB}`;
    for (const key of Array.from(subsumesCache.keys())) {
        if (!key.endsWith(suffix)) continue;
        const cached = getFromSubsumesCache(key);
        if (cached !== undefined) return cached;
    }

    return undefined;
}

export function clearSubsumesCache(): void {
    subsumesCache.clear();
}

export function getSubsumesCacheSize(): number {
    return subsumesCache.size;
}
