import type { StructureDefinition } from './structure-definition-types.js';
import { getDeclaredProfiles } from './declared-profile-utils.js';

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
    const types = resourceElement?.type ?? [];
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

/**
 * Choose a single parent-slice profile for an embedded entry that does not
 * declare its own meta.profile. This lets the child validation prove (or
 * explicitly fail to prove) the conformance required by the Bundle profile.
 * Ambiguous profile sets fail open here and remain owned by slicing rules.
 */
export function getBundleEntryRequiredProfile(
  child: BundleEntrySliceCandidate,
  structureDef: StructureDefinition | undefined,
): string | undefined {
  const slicing = structureDef?.snapshot?.element.find(element =>
    element.path === 'Bundle.entry' && !element.sliceName,
  )?.slicing;
  const permitsUnmatchedProfiles = slicing?.rules !== 'closed' &&
    slicing?.discriminator?.some(discriminator =>
      discriminator.type === 'profile' && discriminator.path === 'resource',
    );
  const profiles = new Set(
    getBundleEntrySliceDefinitions(structureDef)
      // An open profile discriminator allows entries outside optional slices.
      .filter(slice => !permitsUnmatchedProfiles || slice.min > 0)
      .filter(slice => childMatchesBundleEntrySliceCandidate(child, slice))
      .flatMap(slice => slice.profiles),
  );
  return profiles.size === 1 ? [...profiles][0] : undefined;
}
