import { snapshotTypeSource } from '../core/snapshot-type-profile-authority.js';
import type { ProfileReferenceSource } from '../core/profile-reference-authority.js';
import type { Constraint, StructureDefinition } from '../core/structure-definition-types.js';
import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { isFhirResource } from '../core/fhir-resource.js';

export type ResourceTypeProfileResolver = (url: string, source?: ProfileReferenceSource) => Promise<StructureDefinition | null>;

/** Published snapshots can copy a type profile's root rules onto a resource field. */
export async function findInlinedResourceConstraints(
  resource: unknown,
  profile: StructureDefinition,
  resolve?: ResourceTypeProfileResolver,
): Promise<ReadonlySet<Constraint>> {
  const inlined = new Set<Constraint>();
  if (!resolve) return inlined;
  const definitions = new Map<ProfileReferenceSource, Map<string, Promise<StructureDefinition | null>>>();
  for (const element of profile.snapshot?.element ?? []) {
    if (!element.path?.includes('.') || !element.constraint?.length) continue;
    const references = element.type?.flatMap(type => (type.profile ?? []).map(url => ({
      url, source: snapshotTypeSource(type, profile),
    }))) ?? [];
    if (!references.length || !getValidationTargets(resource, element.path).some(target => isFhirResource(target.value))) continue;
    const declared = profile.differential?.element?.find(candidate =>
      (candidate.id ?? candidate.path) === (element.id ?? element.path))?.constraint ?? [];
    for (const { url, source } of references) {
      let scoped = definitions.get(source);
      if (!scoped) { scoped = new Map(); definitions.set(source, scoped); }
      let pending = scoped.get(url);
      if (!pending) { pending = resolve(url, source); scoped.set(url, pending); }
      const definition = await pending;
      const roots = (definition?.snapshot?.element ?? definition?.differential?.element ?? [])
        .filter(candidate => candidate.path === definition?.type).flatMap(candidate => candidate.constraint ?? []);
      for (const constraint of element.constraint) {
        // A declaration on the parent profile retains its parent context even
        // if the embedded type happens to declare the same expression.
        if (!declared.some(candidate => sameRule(candidate, constraint))
          && roots.some(candidate => sameRule(candidate, constraint))) inlined.add(constraint);
      }
    }
  }
  return inlined;
}

function sameRule(left: Constraint, right: Constraint): boolean {
  return left.key === right.key && left.expression === right.expression && left.severity === right.severity;
}
