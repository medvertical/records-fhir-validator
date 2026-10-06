import { parseDefinitionCacheKey } from './valueset-package-utils.js';
import { canonicalPinCacheKey } from '../package/canonical-pin-scope.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { CodeSystem, ValueSet } from './valueset-types.js';

type ResourceType = 'ValueSet' | 'CodeSystem';
interface Registration { resource: ValueSet | CodeSystem; version?: string; }

/** Explicit administration registers definitions for one runtime and FHIR family. */
export class RegisteredTerminologyResources {
  private readonly resources: BoundedLruCache<string, Registration>;
  private readonly selections: BoundedLruCache<string, string>;

  constructor(capacity: number) {
    this.resources = new BoundedLruCache(capacity);
    this.selections = new BoundedLruCache(capacity);
  }

  register(type: ResourceType, canonical: string, version: string | undefined,
    fhirVersion: FhirVersion, resource: ValueSet | CodeSystem): void {
    const selection = canonicalPinCacheKey(JSON.stringify([type, canonical, fhirVersion]));
    const identity = canonicalPinCacheKey(JSON.stringify([type, canonical, fhirVersion, version ?? null]));
    this.resources.set(identity, { resource, version });
    this.selections.set(selection, identity);
  }

  get(type: ResourceType, key: string, fhirVersion: FhirVersion | undefined): ValueSet | CodeSystem | undefined {
    const selection = parseDefinitionCacheKey(key);
    const [legacyCanonical, suffix] = key.split('|');
    const canonical = selection?.canonical ?? legacyCanonical;
    const keyFhir = suffix === 'R4' || suffix === 'fhir4' ? 'R4'
      : suffix === 'R5' || suffix === 'fhir5' ? 'R5'
        : suffix === 'R6' || suffix === 'fhir6' ? 'R6' : undefined;
    const release = selection?.fhirVersion ?? fhirVersion ?? keyFhir;
    if (!release || (!selection && keyFhir && keyFhir !== release)) return undefined;
    const version = selection ? selection.requestedVersion : keyFhir ? undefined : suffix;
    const identity = version
      ? canonicalPinCacheKey(JSON.stringify([type, canonical, release, version]))
      : this.selections.get(canonicalPinCacheKey(JSON.stringify([type, canonical, release])));
    return identity ? this.resources.get(identity)?.resource : undefined;
  }

  getStats(): { valueSets: number; codeSystems: number } {
    let valueSets = 0, codeSystems = 0;
    for (const identity of [...this.resources.keys()]) {
      const resource = this.resources.get(identity)?.resource;
      if (resource?.resourceType === 'ValueSet') valueSets++;
      else if (resource?.resourceType === 'CodeSystem') codeSystems++;
    }
    return { valueSets, codeSystems };
  }

  clear(): void { this.resources.clear(); this.selections.clear(); }
}
