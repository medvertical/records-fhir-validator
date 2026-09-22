import { TerminologyApiClient } from './terminology-api-client.js';
import type { TerminologyOperationCache } from './terminology-operation-cache.js';
import type { ValueSetCache } from './valueset-cache.js';
import { ValueSetCodeSystemOperations } from './valueset-code-system-operations.js';
import { ValueSetPackageLoader } from './valueset-package-loader.js';
import { TwoPhaseShadowEvaluator } from './valueset-two-phase-shadow.js';
import type { TerminologyResolutionConfig } from './valueset-types.js';

export interface ValueSetValidatorComponents {
  apiClient: TerminologyApiClient;
  packageLoader: ValueSetPackageLoader;
  twoPhaseShadow: TwoPhaseShadowEvaluator;
  codeSystems: ValueSetCodeSystemOperations;
}

export function createValueSetValidatorComponents(
  cache: ValueSetCache,
  operationCache: TerminologyOperationCache,
  getResolutionConfig: () => TerminologyResolutionConfig,
): ValueSetValidatorComponents {
  const config = getResolutionConfig();
  const apiClient = new TerminologyApiClient(config, cache, operationCache);
  const packageLoader = new ValueSetPackageLoader(cache);
  return {
    apiClient,
    packageLoader,
    twoPhaseShadow: new TwoPhaseShadowEvaluator(packageLoader, config.twoPhaseExpansion),
    codeSystems: new ValueSetCodeSystemOperations({
      apiClient,
      cache,
      getResolutionConfig,
      packageLoader,
    }),
  };
}
