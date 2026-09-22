import { isSnomedNationalExtensionCode } from './terminology-api-client.js';
import type { TerminologyUnverifiedReason } from './valueset-types.js';
import { codeSystemCanonicalsEquivalent } from './code-system-canonical-aliases.js';

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
    if (system && !codeSystemCanonicalsEquivalent(filter.system, system)) return false;
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
    codeSystemCanonicalsEquivalent(filter.system, system)
    && filter.property === 'concept'
    && (filter.op === 'is-a' || filter.op === 'descendent-of')
  );
}

export function classifyUnverifiableFilterReason(
  system: string | undefined,
  code: string,
  filters: IncludeConceptFilter[],
): TerminologyUnverifiedReason | undefined {
  if (hasUnsupportedFilterForSystem(filters, system)) {
    return 'unsupported-filter';
  }
  if (isUnresolvableSnomedExtensionFilterCode(system, code, filters)) {
    return 'unresolvable-snomed-extension-filter';
  }
  return undefined;
}

/**
 * Full compose-level classification: filter-based reasons first, then
 * whole-system includes whose CodeSystem the local stores cannot enumerate.
 * A code from (or without) such a system may be valid despite a local miss.
 */
export function classifyUnverifiableComposeReason(
  system: string | undefined,
  code: string,
  filters: IncludeConceptFilter[],
  unenumerableIncludeSystems: string[],
): TerminologyUnverifiedReason | undefined {
  const filterReason = classifyUnverifiableFilterReason(system, code, filters);
  if (filterReason) return filterReason;
  const systemUnenumerable = unenumerableIncludeSystems.some(includeSystem =>
    !system || codeSystemCanonicalsEquivalent(includeSystem, system));
  return systemUnenumerable ? 'unenumerable-system-include' : undefined;
}

/**
 * Reasons that make the local expansion provably incomplete for the coded
 * system, so even a required-binding miss cannot be asserted without a
 * terminology server. The SNOMED-extension reason is excluded: no available
 * source could confirm those codes, so the required miss stands.
 */
export function isLocallyUnprovableMissReason(
  reason: TerminologyUnverifiedReason | undefined,
): boolean {
  return reason === 'unsupported-filter' || reason === 'unenumerable-system-include';
}
