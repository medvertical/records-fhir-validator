import { findImportedInventoryConcept, isImportedNamedCodeRejection } from './imported-terminology-inventory.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { CodeBindingOutcome, ValueSetComposeInclude } from './valueset-types.js';
import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';
import { fhirVersionToPackageMajor, findCodeSystemConcept, isAssertableCodeSystem } from './valueset-code-system-rules.js';

import { createConceptFilterEvaluator, hasUnknownTerminologyModifiers, type ConceptMembership } from './valueset-concept-filter-membership.js';

type Membership = ConceptMembership;
type Loader = Pick<ValueSetPackageLoader, 'loadCodeSystem' | 'loadValueSetResource'>;
export type LocalCodeSystemLookup = (code: string, system: string, fhirVersion?: FhirVersion, requestedVersion?: string) => Promise<CodeSystemValidationResult | null>;

/**
 * Versionless expansion caches cannot establish membership for Coding.version.
 * Without the exact release, an include that pins its release and lists its
 * concepts still vouches for them (KBV pins SNOMED CT and LOINC releases no
 * terminology server still serves); a list without a release does not speak
 * for the version the coding claims. A code missing from the lists stays
 * unverified: the value set version this lookup found may not be the one the
 * profile was built on (eu base 2.0.0 dropped a laterality its ballot listed).
 * A Coding.version that differs from the include's is reported on its own.
 */
export async function resolveVersionedLocalBinding(
  loader: Loader, code: string, system: string | undefined, version: string,
  valueSetUrl: string, fhirVersion?: FhirVersion, validateLocalCodeSystem?: LocalCodeSystemLookup,
): Promise<CodeBindingOutcome> {
  if (!system) return 'unverified';
  const evaluateFilter = createConceptFilterEvaluator();
  const canonical = normalizeKnownCodeSystemCanonical(system);
  const codeSystem = await loader.loadCodeSystem(canonical, fhirVersionToPackageMajor(fhirVersion), version);
  const exact = Boolean(codeSystem && normalizeKnownCodeSystemCanonical(codeSystem.url) === canonical
    && codeSystem.version === version && isAssertableCodeSystem(codeSystem) && !hasUnknownTerminologyModifiers(codeSystem));
  let namedRejected = false;
  if (exact) {
    const imported = findImportedInventoryConcept(codeSystem!, code);
    if (!(imported === undefined ? findCodeSystemConcept(codeSystem!.concept, code) : imported)) {
      const result = await validateLocalCodeSystem?.(code, canonical, fhirVersion, version);
      namedRejected = Boolean(result && isImportedNamedCodeRejection(result, code, canonical, fhirVersion, version));
      if (!namedRejected) return 'unverified';
    }
  }

  const membership = await matchesValueSet(valueSetUrl, new Set());
  if (membership === null) return 'unverified';
  return membership ? 'valid' : exact ? 'invalid' : 'unverified';

  async function matchesValueSet(reference: string, visited: Set<string>): Promise<Membership> {
    if (visited.has(reference) || visited.size >= 20) return null;
    const valueSet = await loader.loadValueSetResource(reference, fhirVersion);
    const [url, requestedVersion] = reference.split('|');
    if (!valueSet || valueSet.url !== url || (requestedVersion && valueSet.version !== requestedVersion)
      || !valueSet.compose?.include?.length
      || hasUnknownTerminologyModifiers(valueSet as unknown as Record<string, unknown>)
      || hasUnknownTerminologyModifiers(valueSet.compose as unknown as Record<string, unknown>)) return null;
    // Named-code absence closes simple compose clauses, not unresolved filters or edition alternatives.
    if (namedRejected && [...valueSet.compose.include, ...(valueSet.compose.exclude ?? [])].some(entry => {
      const pinned = entry.version ?? entry.system?.split('|')[1];
      return hasUnknownTerminologyModifiers(entry) || entry.filter?.length || entry.valueSet?.length
        || pinned && pinned !== version;
    })) return null;
    const next = new Set(visited).add(reference);
    const included = union(await Promise.all(valueSet.compose.include.map(entry => matchesEntry(entry, next))));
    if (included === false) return false;
    const excluded = union(await Promise.all((valueSet.compose.exclude ?? []).map(entry => matchesEntry(entry, next))));
    if (excluded === true) return false;
    return included === true && excluded === false ? true : null;
  }

  async function matchesEntry(entry: ValueSetComposeInclude, visited: Set<string>): Promise<Membership> {
    if (hasUnknownTerminologyModifiers(entry)) return null;
    const piped = entry.system?.split('|')[1];
    if (piped && entry.version && piped !== entry.version) return null;
    const constraints: Membership[] = [];
    if (entry.system) {
      const [entrySystem, pipedVersion] = entry.system.split('|');
      constraints.push(normalizeKnownCodeSystemCanonical(entrySystem) === canonical);
      if (namedRejected) constraints.push(false);
      if (exact && (entry.version || pipedVersion)) constraints.push((entry.version ?? pipedVersion) === '*' || (entry.version ?? pipedVersion) === version);
      const listed = entry.concept?.length ? entry.concept.some(concept => concept.code === code) : undefined;
      if (listed !== undefined && (exact || entry.version || pipedVersion)) constraints.push(listed);
      else if (!exact) constraints.push(null);
    } else if (entry.concept?.length || entry.version) {
      return null;
    }
    if (constraints.includes(false)) return false;
    for (const filter of entry.filter ?? []) constraints.push(entry.system && exact && codeSystem
      ? evaluateFilter(codeSystem, code, filter) : null);
    for (const nested of entry.valueSet ?? []) constraints.push(await matchesValueSet(nested, visited));
    if (constraints.includes(false)) return false;
    return !constraints.length || constraints.includes(null) ? null : true;
  }
}

function union(values: Membership[]): Membership {
  if (values.includes(true)) return true;
  return values.includes(null) ? null : false;
}
