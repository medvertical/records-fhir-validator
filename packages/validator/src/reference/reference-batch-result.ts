interface ReferenceExistenceCheckLike {
  exists: boolean;
  errorMessage?: string;
  responseTimeMs?: number;
}

export interface ReferenceBatchSummary {
  existCount: number;
  notExistCount: number;
  failedCount: number;
  cacheHitCount: number;
  totalTimeMs: number;
  averageResponseTimeMs: number;
}

export function summarizeReferenceBatch(
  results: ReferenceExistenceCheckLike[],
  cacheHitCount: number,
  startTimeMs: number,
): ReferenceBatchSummary {
  const totalTimeMs = Date.now() - startTimeMs;
  const existCount = results.filter(result => result.exists).length;
  const notExistCount = results.filter(result => !result.exists && !result.errorMessage).length;
  const failedCount = results.filter(result => result.errorMessage).length;
  const responseTimes = results
    .filter(result => result.responseTimeMs !== undefined && result.responseTimeMs > 0)
    .map(result => result.responseTimeMs!);
  const averageResponseTimeMs = responseTimes.length > 0
    ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
    : 0;

  return {
    existCount,
    notExistCount,
    failedCount,
    cacheHitCount,
    totalTimeMs,
    averageResponseTimeMs,
  };
}
