import { elementTypeProfileSource, recordElementTypeProfileSource, copyElementTypeProfileSource,
  elementTypeTargetProfileSource, recordElementTypeTargetProfileSource, copyElementTypeTargetProfileSource } from '../package/element-profile-reference-provenance.js';
import { lookupProfilePackageProvenance, lookupProfilePackageDirectory, copyProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import type { ProfileReferenceSource } from './profile-reference-authority.js';
import type { ElementDefinition } from './structure-definition-types.js';

type ElementType = NonNullable<ElementDefinition['type']>[number];
export function recordSnapshotTypeSources(elements: readonly ElementDefinition[], source: ProfileReferenceSource): void {
  const identity: ProfileReferenceSource = { url: source.url, version: source.version };
  copyProfilePackageProvenance(source, identity);
  Object.freeze(identity);
  if (!Array.isArray(elements)) return;
  for (const element of elements) {
    if (!element || !Array.isArray(element.type)) continue;
    for (const type of element.type) {
      if (type && typeof type === 'object' && !Array.isArray(type)) {
        recordElementTypeProfileSource(type, identity);
        recordElementTypeTargetProfileSource(type, identity);
      }
    }
  }
}
export function snapshotTypeSource(type: ElementType, fallback: ProfileReferenceSource): ProfileReferenceSource {
  return elementTypeProfileSource(type) ?? fallback;
}
export const copySnapshotTypeSource = copyElementTypeProfileSource;
export const copySnapshotTargetProfileSource = copyElementTypeTargetProfileSource;
export function snapshotTargetProfileSource(type: ElementType, fallback: ProfileReferenceSource): ProfileReferenceSource {
  return elementTypeTargetProfileSource(type) ?? fallback;
}
export function cloneSnapshotElements(elements: readonly ElementDefinition[]): ElementDefinition[] {
  const copies = JSON.parse(JSON.stringify(elements)) as ElementDefinition[];
  for (let index = 0; index < copies.length; index++) for (let typeIndex = 0; typeIndex < (copies[index].type?.length ?? 0); typeIndex++) {
    const original = elements[index].type?.[typeIndex];
    const copy = copies[index].type?.[typeIndex];
    if (original && copy) {
      copySnapshotTypeSource(original, copy);
      copySnapshotTargetProfileSource(original, copy);
    }
  }
  return copies;
}
export function snapshotTypeProfileKey(element: ElementDefinition): string | undefined {
  const reference = element.type?.length === 1 && element.type[0].profile?.length === 1 ? element.type[0].profile[0] : undefined;
  const id = element.id ?? element.path;
  return reference && id ? JSON.stringify([id, reference]) : undefined;
}

export function snapshotTypeRecursionKey(reference: string, source: ProfileReferenceSource, family: 'R4' | 'R5' | 'R6'): string {
  return JSON.stringify([reference, family, source.url, source.version,
    lookupProfilePackageProvenance(source), lookupProfilePackageDirectory(source)]);
}
