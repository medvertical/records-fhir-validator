import { selectedCanonicalAlias } from '../core/validation-canonical-alias-context.js';

// HL7 NamingSystem/HPO lists both active URI identifiers for the same namespace.
const CODE_SYSTEM_IDENTITY_ALIASES: ReadonlyMap<string, string> = new Map([
  ['http://purl.obolibrary.org/obo/hp.owl', 'http://human-phenotype-ontology.org'],
]);

/** Concurrent registered identifiers, excluding compatibility replacements of older canonicals. */
export function normalizeCodeSystemIdentity(systemUrl: string): string {
  const [canonical] = systemUrl.split('|');
  return CODE_SYSTEM_IDENTITY_ALIASES.get(canonical) ?? canonical;
}

export function codeSystemIdentitiesEquivalent(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && normalizeCodeSystemIdentity(left) === normalizeCodeSystemIdentity(right));
}

/**
 * Resolve published predecessor canonicals whose replacement preserves the
 * CodeSystem semantics and code namespace.
 */
export function normalizeKnownCodeSystemCanonical(systemUrl: string): string {
  const canonical = normalizeCodeSystemIdentity(systemUrl);
  return selectedCanonicalAlias('codeSystems', canonical);
}

export function codeSystemCanonicalsEquivalent(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) return false;
  return normalizeKnownCodeSystemCanonical(left) === normalizeKnownCodeSystemCanonical(right);
}

export function codeSystemCanonicalCandidates(systemUrl: string): string[] {
  const normalized = normalizeKnownCodeSystemCanonical(systemUrl);
  return normalized === systemUrl ? [systemUrl] : [systemUrl, normalized];
}
