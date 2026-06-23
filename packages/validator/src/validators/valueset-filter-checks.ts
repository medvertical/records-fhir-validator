import { isSnomedNationalExtensionCode } from './terminology-api-client';

/**
 * Pure include-filter predicates shared by the ValueSet membership paths.
 *
 * Extracted from valueset-validator.ts: these decide when a ValueSet's
 * `compose.include.filter` set cannot be resolved locally and the validator
 * must fail open rather than emit a false-positive binding issue.
 */

type IncludeConceptFilter = { system: string; property: string; op: string };

/**
 * True when any applicable include filter uses a `concept` operation other
 * than the locally supported `=`, `is-a`, `descendent-of` (or a non-concept
 * property), meaning local membership cannot be verified.
 */
export function hasUnsupportedFilterForSystem(
  filters: IncludeConceptFilter[],
  system: string | undefined,
): boolean {
  return filters.some(filter => {
    if (system && filter.system !== system) return false;
    if (filter.property !== 'concept') return true;
    return filter.op !== '=' && filter.op !== 'is-a' && filter.op !== 'descendent-of';
  });
}

/**
 * True for a SNOMED national-extension code constrained by an `is-a` /
 * `descendent-of` filter: an International Edition terminology server cannot
 * subsume it, so the binding cannot be confirmed locally or remotely.
 */
export function isUnresolvableSnomedExtensionFilterCode(
  system: string | undefined,
  code: string,
  filters: IncludeConceptFilter[],
): boolean {
  if (system !== 'http://snomed.info/sct') return false;
  if (!isSnomedNationalExtensionCode(code)) return false;
  return filters.some(filter =>
    filter.system === system
    && filter.property === 'concept'
    && (filter.op === 'is-a' || filter.op === 'descendent-of')
  );
}
