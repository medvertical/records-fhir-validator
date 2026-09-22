import type { FHIRPathExpressionCacheStats } from './fhirpath-expression-cache-core.js';

export interface CombinedFHIRPathCacheStats {
  constraint: FHIRPathExpressionCacheStats;
  sdExecutor: FHIRPathExpressionCacheStats;
  combined: FHIRPathExpressionCacheStats;
}

export function combineFHIRPathCacheStats(
  constraint: FHIRPathExpressionCacheStats,
  sdExecutor: FHIRPathExpressionCacheStats,
): CombinedFHIRPathCacheStats {
  const hits = constraint.hits + sdExecutor.hits;
  const misses = constraint.misses + sdExecutor.misses;
  const total = hits + misses;
  return {
    constraint,
    sdExecutor,
    combined: {
      hits,
      misses,
      compileErrors: constraint.compileErrors + sdExecutor.compileErrors,
      hitRate: total > 0 ? `${((hits / total) * 100).toFixed(1)}%` : '0%',
      size: constraint.size + sdExecutor.size,
    },
  };
}

export function emptyFHIRPathCacheStats(): CombinedFHIRPathCacheStats {
  const empty = (): FHIRPathExpressionCacheStats => ({
    hits: 0,
    misses: 0,
    compileErrors: 0,
    hitRate: '0%',
    size: 0,
  });
  return combineFHIRPathCacheStats(empty(), empty());
}
