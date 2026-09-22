import { createHash } from 'crypto';
import { stableStringify } from '@records-fhir/validation-types';
import { inferCodeBasedProfiles } from './code-inferred-profiles.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
import { resourceTypeOf } from './fhir-resource.js';

export interface DeduplicationResult<T> {
  unique: T[];
  duplicateMap: Map<string, T[]>;
}

/** Deduplicate resources by a stable SHA-256 hash of their content. */
export function deduplicateResources<T>(
  resources: T[],
  profileSources?: readonly string[],
): DeduplicationResult<T> {
  const hashMap = new Map<string, T[]>();

  for (const [index, resource] of resources.entries()) {
    const content = stableStringify(profileSources ? [resource, profileSources[index]] : resource);
    const hash = createHash('sha256').update(content).digest('hex');
    if (!hashMap.has(hash)) hashMap.set(hash, []);
    hashMap.get(hash)!.push(resource);
  }

  const unique = Array.from(hashMap.values()).map(group => group[0]);
  return { unique, duplicateMap: hashMap };
}

/** Group resources by an explicit, declared, inferred, or core profile. */
export function groupResourcesByProfile<T>(
  resources: T[],
  explicitProfileUrl?: string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const resource of resources) {
    let profileUrl: string;
    if (explicitProfileUrl) {
      profileUrl = explicitProfileUrl;
    } else {
      profileUrl = getPrimaryDeclaredProfile(resource)
        ?? inferCodeBasedProfiles(resource)[0]
          ?? `http://hl7.org/fhir/StructureDefinition/${resourceTypeOf(resource)}`;
    }
    if (!groups.has(profileUrl)) groups.set(profileUrl, []);
    groups.get(profileUrl)!.push(resource);
  }

  return groups;
}

export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
