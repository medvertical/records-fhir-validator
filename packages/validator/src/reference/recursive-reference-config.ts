import { extractReferencesToValidate } from './recursive-reference-helpers.js';

export interface RecursiveValidationConfig {
  enabled: boolean;
  maxDepth: number;
  validateExternal: boolean;
  validateContained: boolean;
  validateBundleEntries: boolean;
  excludeResourceTypes?: string[];
  maxReferencesPerResource?: number;
  timeoutMs?: number;
}

const DEFAULT_RECURSIVE_VALIDATION_CONFIG: RecursiveValidationConfig = {
  enabled: false,
  maxDepth: 1,
  validateExternal: false,
  validateContained: true,
  validateBundleEntries: true,
  excludeResourceTypes: [],
  maxReferencesPerResource: 10,
  timeoutMs: 30_000,
};

export function createSafeRecursiveValidationConfig(
  config: Partial<RecursiveValidationConfig>,
): RecursiveValidationConfig {
  return {
    ...DEFAULT_RECURSIVE_VALIDATION_CONFIG,
    ...config,
    excludeResourceTypes: [...(config.excludeResourceTypes ?? DEFAULT_RECURSIVE_VALIDATION_CONFIG.excludeResourceTypes ?? [])],
    maxDepth: clampFinite(config.maxDepth, DEFAULT_RECURSIVE_VALIDATION_CONFIG.maxDepth, 0, 3),
    maxReferencesPerResource: clampFinite(
      config.maxReferencesPerResource,
      DEFAULT_RECURSIVE_VALIDATION_CONFIG.maxReferencesPerResource ?? 10,
      1,
      20,
    ),
    timeoutMs: clampFinite(config.timeoutMs, DEFAULT_RECURSIVE_VALIDATION_CONFIG.timeoutMs ?? 30_000, 1, 60_000),
  };
}

export function getDefaultRecursiveValidationConfig(): RecursiveValidationConfig {
  return createSafeRecursiveValidationConfig({});
}

export function estimateRecursiveValidationCost(
  resource: unknown,
  config: Partial<RecursiveValidationConfig>,
): {
  estimatedResources: number;
  estimatedReferences: number;
  estimatedTimeMs: number;
  wouldExceedLimits: boolean;
} {
  const safeConfig = createSafeRecursiveValidationConfig(config);
  const references = extractReferencesToValidate(resource, 'root', 0);
  const estimatedResources = Math.min(references.length * safeConfig.maxDepth, 100);
  return {
    estimatedResources,
    estimatedReferences: references.length,
    estimatedTimeMs: estimatedResources * 100,
    wouldExceedLimits: estimatedResources > 50 || references.length > 20,
  };
}

function clampFinite(value: number | undefined, fallback: number, min: number, max: number): number {
  const finite = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(Math.trunc(finite), min), max);
}
