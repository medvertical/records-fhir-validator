import { logger } from '../logger.js';
import type { EpochSingleflight } from './epoch-singleflight.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import type { ValueSetCache } from './valueset-cache.js';
import { cloneTerminologyDiagnostics } from './valueset-diagnostics.js';
import { KNOWN_VALUE_SET_EXPANSIONS } from './valueset-known-expansions.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { TwoPhaseShadowEvaluator } from './valueset-two-phase-shadow.js';
import type { CodeBindingOutcome, TerminologyDiagnostics } from './valueset-types.js';

interface CacheOperationDeps {
  bindingResolutions: EpochSingleflight<CodeBindingOutcome>;
  cache: ValueSetCache;
  packageLoader: ValueSetPackageLoader;
  operationCache: TerminologyOperationCache;
  terminologyDiagnostics: TerminologyDiagnostics;
  twoPhaseShadow: TwoPhaseShadowEvaluator;
}

export function clearValueSetValidatorCaches(deps: CacheOperationDeps): void {
  deps.cache.clear();
  deps.packageLoader.clearLookupState();
  deps.operationCache.clear();
  deps.twoPhaseShadow.clearExpansion();
  deps.bindingResolutions.clear();
}

export function getValueSetValidatorCacheStats(deps: CacheOperationDeps) {
  const stats = deps.cache.getStats();
  const operationStats = deps.operationCache.getStats();
  return {
    valueSetCount: stats.valueSetCount,
    codeSystemCount: stats.codeSystemCount,
    validateCodeResultCount: operationStats.validateCodeResultCount,
    subsumesResultCount: operationStats.subsumesResultCount,
    terminologyDiagnostics: cloneTerminologyDiagnostics(deps.terminologyDiagnostics),
    twoPhaseExpansion: deps.twoPhaseShadow.getStats(),
  };
}

export async function preloadCommonValueSets(
  expand: (valueSetUrl: string) => Promise<Set<string>>,
): Promise<void> {
  const urls = Object.keys(KNOWN_VALUE_SET_EXPANSIONS);
  for (const url of urls) await expand(url);
  logger.info(`[ValueSetValidator] Preloaded ${urls.length} common value sets`);
}
