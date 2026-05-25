import fhirpath from 'fhirpath';
import { getFhirPathModel } from './fhirpath-model-resolver';

class FHIRPathExpressionCache {
  private cache: Map<string, any> = new Map();
  private maxSize: number = 500;
  private hits: number = 0;
  private misses: number = 0;

  getOrCompile(expression: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
    const cacheKey = `${fhirVersion}|${expression}`;
    if (this.cache.has(cacheKey)) {
      this.hits++;
      const compiled = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, compiled);
      return compiled;
    }

    this.misses++;
    const compiled = fhirpath.compile(expression, getFhirPathModel(fhirVersion));
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, compiled);
    return compiled;
  }

  getStats(): { hits: number; misses: number; hitRate: string; size: number } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%';
    return { hits: this.hits, misses: this.misses, hitRate, size: this.cache.size };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
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
  hitRate: string;
  size: number;
} {
  return expressionCache.getStats();
}

export function clearConstraintExpressionCache(): void {
  expressionCache.clear();
}
