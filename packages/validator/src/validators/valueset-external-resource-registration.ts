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

  cache.registerResource(identity.resourceType, identity.url, identity.version, fhirVersion,
    resource as ValueSet | CodeSystem);
  onRegistered?.();
  return true;
}
