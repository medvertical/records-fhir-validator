import type { ElementDefinition, StructureDefinition } from './structure-definition-types.js';

/** Bounded insertion-ordered cache for generated profile snapshots. */
export class SnapshotCache {
  private readonly entries = new Map<string, ElementDefinition[]>();
  private readonly maxEntries: number;

  constructor(maxEntries = 192) {
    this.maxEntries = Math.max(1, Math.trunc(maxEntries));
  }

  get(profile: StructureDefinition): ElementDefinition[] | undefined {
    return this.entries.get(this.keyFor(profile));
  }

  set(profile: StructureDefinition, snapshot: ElementDefinition[]): void {
    const key = this.keyFor(profile);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, snapshot);
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

  private keyFor(profile: StructureDefinition): string {
    const version = (profile as { version?: string }).version ?? 'unversioned';
    const fhirVersion = (profile as { fhirVersion?: string }).fhirVersion ?? 'fhir-any';
    return `${profile.url}|${version}|${fhirVersion}`;
  }
}
