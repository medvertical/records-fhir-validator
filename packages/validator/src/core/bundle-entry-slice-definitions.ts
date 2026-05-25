import type { StructureDefinition } from './structure-definition-types';

interface BundleEntrySliceCandidate {
  resourceType: string;
  entryResource: Record<string, unknown>;
}

export interface BundleEntrySliceDefinition {
  sliceName: string;
  min: number;
  max: string;
  resourceTypes: string[];
  profiles: string[];
}

export function getBundleEntrySliceDefinitions(
  structureDef: StructureDefinition | undefined,
): BundleEntrySliceDefinition[] {
  const elements = structureDef?.snapshot?.element;
  if (!elements?.length) return [];

  const slices: BundleEntrySliceDefinition[] = [];
  for (const element of elements) {
    if (element.path !== 'Bundle.entry' || !element.sliceName) continue;
    const resourceElement = elements.find(candidate =>
      candidate.id === `Bundle.entry:${element.sliceName}.resource` &&
      candidate.path === 'Bundle.entry.resource',
    );
    const resourceTypes = new Set<string>();
    const profiles = new Set<string>();
    const types = Array.isArray((resourceElement as any)?.type)
      ? (resourceElement as any).type
      : [];
    for (const type of types) {
      if (typeof type?.code === 'string' && type.code !== 'Resource') {
        resourceTypes.add(type.code);
      }
      const typeProfiles = Array.isArray(type?.profile) ? type.profile : [];
      for (const profile of typeProfiles) {
        if (typeof profile === 'string') profiles.add(profile);
      }
    }

    slices.push({
      sliceName: element.sliceName,
      min: element.min ?? 0,
      max: element.max ?? '*',
      resourceTypes: [...resourceTypes],
      profiles: [...profiles],
    });
  }

  return slices;
}

export function childMatchesBundleEntrySliceCandidate(
  child: BundleEntrySliceCandidate,
  slice: BundleEntrySliceDefinition,
): boolean {
  if (slice.resourceTypes.length > 0 && slice.resourceTypes.includes(child.resourceType)) {
    return true;
  }
  const declaredProfiles = getDeclaredProfiles(child.entryResource);
  return slice.profiles.some(profile => declaredProfiles.includes(profile));
}

function getDeclaredProfiles(resource: Record<string, unknown>): string[] {
  const profiles = (resource.meta as any)?.profile;
  return Array.isArray(profiles)
    ? profiles.filter((profile: unknown): profile is string => typeof profile === 'string')
    : [];
}
