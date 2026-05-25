import type { ValidationSettings } from '@records-fhir/validation-types';

export interface NormalizedReferenceValidationArgs {
  fhirVersion: 'R4' | 'R5' | 'R6';
  actualSettings?: ValidationSettings;
}

export function normalizeReferenceValidationArgs(
  fhirClientOrVersion?: any,
  fhirVersionOrSettings?: 'R4' | 'R5' | 'R6' | ValidationSettings,
  settings?: ValidationSettings,
): NormalizedReferenceValidationArgs {
  let fhirVersion: 'R4' | 'R5' | 'R6' = 'R4';
  let actualSettings: ValidationSettings | undefined = settings;

  if (typeof fhirVersionOrSettings === 'string') {
    fhirVersion = fhirVersionOrSettings;
  } else if (fhirVersionOrSettings && typeof fhirVersionOrSettings === 'object') {
    actualSettings = fhirVersionOrSettings;
  }

  if (typeof fhirClientOrVersion === 'string') {
    fhirVersion = fhirClientOrVersion as 'R4' | 'R5' | 'R6';
  }

  return { fhirVersion, actualSettings };
}

export function getRecursiveValidationConfig(settings?: ValidationSettings) {
  const cfg = settings?.recursiveReferenceValidation;
  return {
    enabled: cfg?.enabled ?? false,
    maxDepth: cfg?.maxDepth ?? 1,
    validateExternal: cfg?.validateExternal ?? false,
    validateContained: cfg?.validateContained ?? true,
    validateBundleEntries: cfg?.validateBundleEntries ?? true,
    excludeResourceTypes: cfg?.excludeResourceTypes,
    maxReferencesPerResource: cfg?.maxReferencesPerResource ?? 10,
    timeoutMs: cfg?.timeoutMs ?? 30000,
  };
}
