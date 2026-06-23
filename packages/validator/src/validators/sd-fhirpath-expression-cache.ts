import fhirpath from 'fhirpath';

import { getFhirPathModel } from '../core/fhirpath-context';
import { rewriteCollectionTypeOperators } from './fhirpath-as-operator-rewrite';
import { logger } from '../logger';

class ExpressionCache {
    private cache = new Map<string, any | null>();
    private maxSize = 1000;
    private hits = 0;
    private misses = 0;
    private compileErrors = 0;

    getOrCompile(expression: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
        const cacheKey = `${fhirVersion}:${expression}`;
        if (this.cache.has(cacheKey)) {
            this.hits++;
            const compiled = this.cache.get(cacheKey);
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, compiled);
            return compiled;
        }

        this.misses++;
        try {
            const compiled = fhirpath.compile(rewriteCollectionTypeOperators(expression), getFhirPathModel(fhirVersion));
            this.set(cacheKey, compiled);
            return compiled;
        } catch (err) {
            this.compileErrors++;
            this.set(cacheKey, null);
            logger.warn(`[SDFHIRPathExecutor] Failed to compile: ${expression}`, err);
            return null;
        }
    }

    private set(cacheKey: string, compiled: any | null): void {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }

        this.cache.set(cacheKey, compiled);
    }

    getStats(): { hits: number; misses: number; compileErrors: number; hitRate: string; size: number } {
        const total = this.hits + this.misses;
        const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0%';
        return { hits: this.hits, misses: this.misses, compileErrors: this.compileErrors, hitRate, size: this.cache.size };
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.compileErrors = 0;
    }
}

export const sdFHIRPathExpressionCache = new ExpressionCache();
