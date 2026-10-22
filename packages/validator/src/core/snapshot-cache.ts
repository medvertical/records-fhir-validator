import { profileDefinitionSourceKey } from './profile-reference-authority.js';
import type { ElementDefinition, StructureDefinition } from './structure-definition-types.js';
import { cloneSnapshotElements } from './snapshot-type-profile-authority.js';

/** Bounded insertion-ordered cache for generated profile snapshots. */
export class SnapshotCache {
  private readonly entries = new Map<string, ElementDefinition[]>();
  private readonly maxEntries: number;

  constructor(maxEntries = 192) {
    this.maxEntries = Math.max(1, Math.trunc(maxEntries));
  }

  get(key: string): ElementDefinition[] | undefined {
    const elements = this.entries.get(key);
    return elements && cloneSnapshotElements(elements);
  }

  set(key: string, snapshot: ElementDefinition[]): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, cloneSnapshotElements(snapshot));
  }

  clear(): void {
    this.entries.clear();
  }

  evict(profileUrl: string): boolean {
    let deleted = this.entries.delete(profileUrl);
    const prefix = `${profileUrl}|`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) deleted = this.entries.delete(key) || deleted;
    }
    return deleted;
  }

  stats(): { size: number; profiles: string[] } {
    return { size: this.entries.size, profiles: [...this.entries.keys()] };
  }

  keyFor(profile: StructureDefinition, ownerKey?: string, requestedFamily?: 'R4' | 'R5' | 'R6', basisKey?: string): string {
    const version = (profile as { version?: string }).version ?? 'unversioned';
    const fhirVersion = requestedFamily ?? profile.fhirVersion ?? 'fhir-any';
    const source = profileDefinitionSourceKey(profile);
    return `${profile.url}|${version}|${fhirVersion}${source ? `|${source}` : ''}${ownerKey ? `|owner:${ownerKey}` : ''}${basisKey ? `|basis:${basisKey}` : ''}`;
  }
}
