import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { CodeSystem, ValueSet } from './valueset-types.js';

function terminologyResourceIdentity(resource: unknown): {
  resourceType: 'ValueSet' | 'CodeSystem';
  url: string;
  version?: string;
} | null {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return null;
  const candidate = resource as Record<string, unknown>;
  if (candidate.resourceType !== 'ValueSet' && candidate.resourceType !== 'CodeSystem') return null;
  if (typeof candidate.url !== 'string' || !candidate.url) return null;
  return {
    resourceType: candidate.resourceType,
    url: candidate.url,
    version: typeof candidate.version === 'string' ? candidate.version : undefined,
  };
}

export function registerExternalTerminologyResourceInCache(
  cache: ValueSetCache,
  resource: unknown,
  fhirVersion: FhirVersion,
  onRegistered?: () => void,
): boolean {
  const identity = terminologyResourceIdentity(resource);
  if (!identity) return false;

  if (identity.resourceType === 'ValueSet') {
    const valueSet = resource as ValueSet;
    cache.setValueSetFile(identity.url, valueSet);
    cache.setValueSetFile(`${identity.url}|${fhirVersion}`, valueSet);
    if (identity.version) cache.setValueSetFile(`${identity.url}|${identity.version}`, valueSet);
    onRegistered?.();
    return true;
  }

  const codeSystem = resource as CodeSystem;
  const major = fhirVersion === 'R4' ? '4' : fhirVersion === 'R5' ? '5' : '6';
  const keys = [
    identity.url,
    `${identity.url}|fhir${major}`,
    ...(identity.version ? [`${identity.url}|${identity.version}`] : []),
  ];
  for (const key of keys) {
    cache.setCodeSystemFile(key, codeSystem);
    cache.setCodeSystem(key, codeSystem);
  }
  onRegistered?.();
  return true;
}
