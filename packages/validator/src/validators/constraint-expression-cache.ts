import fhirpath from 'fhirpath';
import { getFhirPathModel } from './fhirpath-model-resolver';
import { rewriteCollectionTypeOperators } from './fhirpath-as-operator-rewrite';

type CacheEntry =
  | { kind: 'compiled'; compiled: any }
  | { kind: 'error'; error: Error };

class FHIRPathExpressionCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number = 500;
  private hits: number = 0;
  private misses: number = 0;
  private compileErrors: number = 0;

  getOrCompile(expression: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
    const cacheKey = `${fhirVersion}|${expression}`;
    if (this.cache.has(cacheKey)) {
      this.hits++;
      const cached = this.cache.get(cacheKey)!;
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      if (cached.kind === 'error') throw cached.error;
      return cached.compiled;
    }

    this.misses++;
    try {
      const compiled = fhirpath.compile(rewriteCollectionTypeOperators(expression), getFhirPathModel(fhirVersion));
      this.set(cacheKey, { kind: 'compiled', compiled });
      return compiled;
    } catch (error) {
      this.compileErrors++;
      const cachedError = error instanceof Error ? error : new Error(String(error));
      this.set(cacheKey, { kind: 'error', error: cachedError });
      throw cachedError;
    }
  }

  private set(cacheKey: string, entry: CacheEntry): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, entry);
  }

  getStats(): { hits: number; misses: number; compileErrors: number; hitRate: string; size: number } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%';
    return { hits: this.hits, misses: this.misses, compileErrors: this.compileErrors, hitRate, size: this.cache.size };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.compileErrors = 0;
  }
}

const expressionCache = new FHIRPathExpressionCache();

export function getOrCompileFHIRPathExpression(
  expression: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): any {
  return expressionCache.getOrCompile(expression, fhirVersion);
}

export function getConstraintExpressionCacheStats(): {
  hits: number;
  misses: number;
  compileErrors: number;
  hitRate: string;
  size: number;
} {
  return expressionCache.getStats();
}

export function clearConstraintExpressionCache(): void {
  expressionCache.clear();
}
