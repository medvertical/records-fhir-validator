import type { ValidationSettings } from '@records-fhir/validation-types';

/**
 * Settings predicates that decide whether an optional validation pass runs.
 *
 * They live in a leaf module because every fan-out path has to agree on them:
 * a path that answers one of these differently produces different findings for
 * the same resource and the same settings.
 */

export function shouldValidateBundleEntryResources(settings?: ValidationSettings): boolean {
  return settings?.recursiveReferenceValidation?.validateBundleEntries !== false;
}

export function shouldValidateBestPractices(settings?: ValidationSettings): boolean {
  return settings?.enableBestPracticeChecks !== false;
}

/**
 * Tenant custom rules run only when the tenant switched them on. The setting
 * defaults to false in both the settings defaults and the database column, so
 * a path that skips this check applies tenant policy nobody enabled.
 */
export function shouldRunCustomRules(settings?: ValidationSettings): boolean {
  return settings?.autoApplyCustomRules === true;
}
