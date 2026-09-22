import type { RecordsValidator } from './core/validator-engine.js';
import {
  combineFHIRPathCacheStats,
  emptyFHIRPathCacheStats,
} from './validators/fhirpath-cache-diagnostics.js';
import type { FHIRPathExpressionCacheStats } from './validators/fhirpath-expression-cache-core.js';

type CombinedStats = ReturnType<RecordsValidator['getFHIRPathCacheStats']>;

export function mergeFHIRPathCacheStats(reports: CombinedStats[]): CombinedStats {
  if (reports.length === 0) return emptyFHIRPathCacheStats();
  return combineFHIRPathCacheStats(
    mergeExpressionStats(reports.map(report => report.constraint)),
    mergeExpressionStats(reports.map(report => report.sdExecutor)),
  );
}

function mergeExpressionStats(
  reports: FHIRPathExpressionCacheStats[],
): FHIRPathExpressionCacheStats {
  const totals = reports.reduce((merged, report) => ({
    hits: merged.hits + report.hits,
    misses: merged.misses + report.misses,
    compileErrors: merged.compileErrors + report.compileErrors,
    size: merged.size + report.size,
  }), { hits: 0, misses: 0, compileErrors: 0, size: 0 });
  const requests = totals.hits + totals.misses;
  return {
    ...totals,
    hitRate: requests > 0 ? `${((totals.hits / requests) * 100).toFixed(1)}%` : '0%',
  };
}
